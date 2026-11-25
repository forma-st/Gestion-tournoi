import { clock } from './time.js';
import { issueCard, cardSale, findCard, blankCards, cancelSale } from './money.js';
// Couche de données : serveur (temps réel, multi-appareils) ou local (navigateur seul, hors-ligne).
// La même interface dans les deux cas. En mode serveur, les saisies de score faites hors réseau
// sont mises en file d'attente et renvoyées automatiquement au retour de la connexion.

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota ou mode privé */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const listeners = new Set();
const emit = (msg) => listeners.forEach((f) => f(msg));

export const store = {
  mode: 'local',
  online: navigator.onLine,
  lan: [],
  pending: LS.get('rot:outbox', []),
  bc: 'BroadcastChannel' in self ? new BroadcastChannel('rotation') : null,

  publicUrl: '',
  online: false,
  keyRequired: false,
  realtime: true,
  hosted: false,
  watching: null,
  lastVer: {},

  async ping() {
    try {
      const r = await fetch('api/ping', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j?.time) clock.offset = j.time - Date.now();
      if (j?.server) { this.mode = 'server'; this.lan = j.lan || []; this.publicUrl = j.publicUrl || ''; this.online = !!j.online; this.keyRequired = !!j.keyRequired; this.realtime = j.realtime !== false; this.hosted = !!j.hosted; }
    } catch { /* pas de serveur : mode local */ }
  },

  async init() {
    await this.ping();
    if (this.mode === 'server') this.connect();
    this.bc?.addEventListener('message', (e) => emit(e.data));
    addEventListener('storage', (e) => { if (e.key?.startsWith('rot:t:')) emit({ type: 'update', id: e.key.slice(6) }); });
    addEventListener('online', () => { this.online = true; this.flush(); emit({ type: 'net' }); });
    addEventListener('offline', () => { this.online = false; emit({ type: 'net' }); });
    setInterval(() => this.flush(), 15000);
    return this;
  },

  /** Tournoi affiché à l'écran : c'est lui qu'on surveille quand il n'y a pas de connexion permanente. */
  watch(id) { this.watching = id || null; },

  /** Hébergement sans connexion permanente (Vercel) : on vérifie la version toutes les 3 secondes. */
  startPolling() {
    if (this.polling) return;
    this.polling = setInterval(async () => {
      const id = this.watching;
      if (!id || document.hidden) return;
      try {
        const r = await fetch(`api/t/${encodeURIComponent(id)}/v`, { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = await r.json();
        if (!this.online) { this.online = true; emit({ type: 'net' }); this.flush(); }
        if (this.lastVer[id] != null && version != null && version !== this.lastVer[id]) { this.lastVer[id] = version; emit({ type: 'update', id }); }
        else if (version != null) this.lastVer[id] = version;
      } catch { if (this.online) { this.online = false; emit({ type: 'net' }); } }
    }, 3000);
  },

  connect() {
    if (!this.realtime) return this.startPolling();
    if (!('EventSource' in self)) return;
    const es = new EventSource('api/events');
    es.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'net') this.ping().then(() => emit({ type: 'net' })); // l'adresse publique vient d'apparaître
      else emit(msg);
    };
    es.onopen = () => { this.online = true; emit({ type: 'net' }); this.flush(); };
    es.onerror = () => { this.online = false; emit({ type: 'net' }); };
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // -------------------------------------------------------------- admin (code organisateur)
  pin(id) { return LS.get('rot:pins', {})[id] || ''; },
  setPin(id, pin) { const p = LS.get('rot:pins', {}); p[id] = pin; LS.set('rot:pins', p); },

  // -------------------------------------------------------------- portail (PIN équipe/bénévole)
  role(id) { return LS.get('rot:roles', {})[id] || null; },
  setRole(id, role) { const r = LS.get('rot:roles', {}); if (role) r[id] = role; else delete r[id]; LS.set('rot:roles', r); },

  async api(path, opt = {}, id) {
    const headers = { 'content-type': 'application/json', ...(opt.headers || {}) };
    const pin = id && this.pin(id);
    if (pin) headers['x-admin-pin'] = pin;
    const r = await fetch(`api/${path}`, { ...opt, headers, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Erreur ${r.status}`), { status: r.status, body: j });
    return j;
  },

  // -------------------------------------------------------------- lecture
  async list() {
    if (this.mode === 'server') {
      try { const l = await this.api('tournaments'); LS.set('rot:list', l); return l; } catch { return LS.get('rot:list', []); }
    }
    return LS.get('rot:index', []).map((id) => LS.get(`rot:t:${id}`)).filter(Boolean);
  },

  async get(id) {
    if (this.mode === 'server') {
      try {
        const t = await this.api(`t/${id}`, {}, id);
        LS.set(`rot:cache:${id}`, t);
        this.lastVer[id] = t.version;
        return this.applyOutbox(t);
      } catch (e) {
        if (e.status === 404) return null;
        const c = LS.get(`rot:cache:${id}`);
        return c ? this.applyOutbox(c) : null;
      }
    }
    return LS.get(`rot:t:${id}`, null);
  },

  isAdmin(t) { return this.mode === 'local' || (t && t.adminPin != null); },

  async login(id, pin) {
    if (this.mode === 'local') return true;
    this.setPin(id, pin);
    try { await this.api(`t/${id}/auth`, { method: 'POST' }, id); return true; } catch (e) { this.setPin(id, ''); throw e; }
  },

  // -------------------------------------------------------------- écriture
  async create(t) {
    if (this.mode === 'server') {
      const key = LS.get('rot:adminKey', '');
      const r = await this.api('tournaments', { method: 'POST', body: JSON.stringify(t), headers: key ? { 'x-admin-key': key } : {} });
      this.setPin(t.id, t.adminPin);
      return r;
    }
    t.version = 1;
    LS.set(`rot:t:${t.id}`, t);
    LS.set('rot:index', [...new Set([...LS.get('rot:index', []), t.id])]);
    this.notify(t.id);
    return t;
  },

  /** Applique fn(copie) puis enregistre ; en cas de conflit, relit et rejoue. */
  async mutate(id, fn) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await this.get(id);
      if (!cur) throw new Error('Tournoi introuvable');
      const next = structuredClone(cur);
      const res = fn(next) || next;
      if (this.mode === 'local') {
        res.version = (cur.version || 0) + 1;
        res.updatedAt = new Date().toISOString();
        LS.set(`rot:t:${id}`, res);
        this.notify(id);
        return res;
      }
      try {
        const saved = await this.api(`t/${id}`, { method: 'PUT', body: JSON.stringify({ baseVersion: cur.version, doc: res }) }, id);
        LS.set(`rot:cache:${id}`, saved);
        this.lastVer[id] = saved.version;
        return saved;
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
    throw new Error('Conflit de mise à jour, réessayez');
  },

  async remove(id) {
    if (this.mode === 'server') await this.api(`t/${id}`, { method: 'DELETE' }, id);
    else { LS.del(`rot:t:${id}`); LS.set('rot:index', LS.get('rot:index', []).filter((x) => x !== id)); this.notify(id); }
  },

  notify(id) { const msg = { type: 'update', id }; this.bc?.postMessage(msg); emit(msg); },

  // -------------------------------------------------------------- feuille de match
  /** payload : {matchId, token|pin, sets, status, ...} */
  async submitScore(id, payload) {
    if (this.mode === 'local') {
      return this.mutate(id, (t) => {
        const m = t.matches.find((x) => x.id === payload.matchId);
        if (!m) throw new Error('Match introuvable');
        Object.assign(m, pick(payload, ['sets', 'status', 'tieWinner', 'submittedBy', 'signatures', 'comment', 'timer', 'forfeit']));
        if (payload.status === 'live' && !m.startedAt) m.startedAt = new Date().toISOString();
        if (payload.status === 'done') { m.finishedAt = new Date().toISOString(); m.validated = !t.scoreValidation; }
      });
    }
    try {
      const r = await this.api(`t/${id}/score`, { method: 'POST', body: JSON.stringify({ ...payload, pin: payload.pin || this.role(id)?.pin }) }, id);
      return r;
    } catch (e) {
      if (e.status) throw e; // refus du serveur : on remonte l'erreur
      // réseau absent : file d'attente (la dernière saisie d'un match remplace les précédentes)
      this.pending = this.pending.filter((p) => !(p.id === id && (p.kind || 'score') === 'score' && p.payload.matchId === payload.matchId));
      this.queue(id, 'score', payload);
      return { queued: true };
    }
  },

  queue(id, kind, payload) {
    this.pending.push({ id, kind, payload, at: Date.now() });
    LS.set('rot:outbox', this.pending);
    emit({ type: 'net' });
  },

  // -------------------------------------------------------------- buvette
  /** sale : {items:[{pid, qty}], method, by} ; pin : code buvette/bénévole (ou admin). */
  async sale(id, sale, pin) {
    const payload = { ...sale, sid: sale.sid || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: sale.at || new Date().toISOString(), pin };
    if (sale.method === 'points') {
      if (this.mode === 'local') { let r; await this.mutate(id, (t) => { r = cardSale(t, { code: payload.card, items: payload.items, sid: payload.sid, at: payload.at }); }); return { ok: true, pts: r.pts, balance: r.card.balance, name: r.card.name, code: r.card.code }; }
      try { return await this.api(`t/${id}/sale`, { method: 'POST', body: JSON.stringify(payload) }, id); }
      catch (e) { if (!e.status) throw new Error('Pas de réseau : le paiement par carte a besoin de la connexion. Payez en espèces ou réessayez.'); throw e; }
    }
    if (this.mode === 'local') {
      if (payload.cancel) return this.mutate(id, (t) => { cancelSale(t, payload.cancel); });
      return this.mutate(id, (t) => {
        t.sales ??= [];
        const items = payload.items.map((it) => { const p = t.buvette.find((x) => x.id === it.pid); return p && { pid: p.id, name: p.name, qty: it.qty, price: +p.price || 0 }; }).filter(Boolean);
        t.sales.push({ id: payload.sid, at: payload.at, items, total: Math.round(items.reduce((a, i) => a + i.qty * i.price, 0) * 100) / 100, method: payload.method, by: payload.by || '' });
      });
    }
    try { return await this.api(`t/${id}/sale`, { method: 'POST', body: JSON.stringify(payload) }, id); }
    catch (e) { if (e.status) throw e; this.queue(id, 'sale', payload); return { queued: true }; }
  },

  /** Cartes à points : op = 'issue' | 'lookup' | 'blank'. */
  async card(id, op, data, pin) {
    if (this.mode === 'local') {
      let out;
      if (op === 'lookup') { const t = await this.get(id); const c = findCard(t, data.code); if (!c) throw new Error('Carte inconnue : vérifiez le code'); return { ...c }; }
      await this.mutate(id, (t) => {
        if (op === 'issue') out = { ...issueCard(t, data) };
        if (op === 'blank') { blankCards(t, data.n || 30); out = { ok: true }; }
      });
      return out;
    }
    try { return await this.api(`t/${id}/card`, { method: 'POST', body: JSON.stringify({ ...data, op, pin }) }, id); }
    catch (e) { if (!e.status) throw new Error('Pas de réseau : réessayez dans un instant.'); throw e; }
  },

  /** Carte virtuelle du joueur (lien secret). */
  async myCard(id, code, key) {
    if (this.mode === 'local') { const t = await this.get(id); const c = findCard(t, code); if (!c || c.key !== key) throw new Error('Carte introuvable'); return { code: c.code, name: c.name, balance: c.balance, ops: (c.ops || []).slice(-15).reverse() }; }
    return this.api(`t/${id}/card/${encodeURIComponent(code)}?k=${encodeURIComponent(key)}`);
  },

  // -------------------------------------------------------------- cagnotte
  async donate(id, d) {
    if (this.mode === 'local') return this.mutate(id, (t) => { (t.charity.donations ??= []).push({ id: Math.random().toString(36).slice(2, 8), ...d, at: new Date().toISOString(), validated: false }); });
    return this.api(`t/${id}/donation`, { method: 'POST', body: JSON.stringify(d) });
  },

  applyOutbox(t) {
    for (const p of this.pending.filter((x) => x.id === t.id && (x.kind || 'score') === 'score')) {
      const m = t.matches.find((x) => x.id === p.payload.matchId);
      if (m) Object.assign(m, pick(p.payload, ['sets', 'status', 'tieWinner', 'timer']), { queued: true });
    }
    return t;
  },

  async flush() {
    if (this.mode !== 'server' || !this.pending.length) return;
    const left = [];
    for (const p of this.pending) {
      const path = (p.kind || 'score') === 'sale' ? 'sale' : 'score';
      try { await this.api(`t/${p.id}/${path}`, { method: 'POST', body: JSON.stringify({ ...p.payload, pin: p.payload.pin || this.role(p.id)?.pin }) }, p.id); }
      catch (e) { if (!e.status) left.push(p); }
    }
    this.pending = left;
    LS.set('rot:outbox', left);
    emit({ type: 'net' });
  },

  // -------------------------------------------------------------- portail
  async pinLogin(id, pin) {
    if (this.mode === 'local') {
      const t = await this.get(id);
      if (pin === t.volunteerPin) return { role: 'volunteer', pin };
      const team = t.teams.find((x) => x.pin === pin);
      if (team) return { role: 'team', teamId: team.id, name: team.name, pin };
      throw new Error('Code inconnu');
    }
    const r = await this.api(`t/${id}/pin`, { method: 'POST', body: JSON.stringify({ pin }) });
    return { ...r, pin };
  },

  async message(id, from, text) {
    if (this.mode === 'local') return this.mutate(id, (t) => { (t.messages ??= []).push({ id: Math.random().toString(36).slice(2, 8), from, text, at: new Date().toISOString(), read: false }); });
    return this.api(`t/${id}/message`, { method: 'POST', body: JSON.stringify({ from, text }) });
  },

  // -------------------------------------------------------------- inscription
  async register(id, data) {
    if (this.mode === 'server') return this.api(`t/${id}/register`, { method: 'POST', body: JSON.stringify(data) });
    let out;
    if (data.kind === 'player') {
      await this.mutate(id, (t) => {
        t.players ??= [];
        if (t.players.some((p) => p.name.toLowerCase() === data.name.trim().toLowerCase())) throw new Error('Vous êtes déjà inscrit(e)');
        t.players.push({ id: Math.random().toString(36).slice(2, 8), name: data.name.trim(), level: +data.level || 2, gender: data.gender || '', contact: data.contact || '', present: false, paid: false, source: 'online', createdAt: new Date().toISOString() });
      });
      return { ok: true };
    }
    await this.mutate(id, (t) => {
      const r = t.registration || {};
      if (!r.open) throw new Error('Les inscriptions sont fermées');
      if (t.teams.some((x) => x.name.toLowerCase() === data.name.trim().toLowerCase())) throw new Error('Ce nom d’équipe est déjà pris');
      const full = r.maxTeams && t.teams.filter((x) => x.status === 'confirmed').length >= r.maxTeams;
      const team = {
        id: Math.random().toString(36).slice(2, 8), pin: String(1000 + Math.floor(Math.random() * 9000)),
        name: data.name.trim(), captain: data.captain, email: data.email, phone: data.phone, players: data.players || [], level: +data.level || 2, comment: data.comment,
        status: full ? 'waitlist' : r.requireValidation ? 'pending' : 'confirmed', payment: r.fee > 0 || (r.barCard?.enabled && data.barOption) ? 'unpaid' : 'free', barOption: !!(r.barCard?.enabled && data.barOption),
        checkedIn: false, source: 'online', createdAt: new Date().toISOString(), ref: `${t.id.slice(0, 3).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
      };
      t.teams.push(team);
      out = { ok: true, team };
    });
    return out;
  },

  setAdminKey(k) { LS.set('rot:adminKey', (k || '').trim()); },

  /**
   * Adresse à mettre dans les QR codes, par ordre de priorité :
   * adresse saisie à la main › adresse publique du serveur (tunnel / hébergement) ›
   * adresse de la page si elle est déjà publique › IP du réseau local.
   */
  baseUrl() {
    const custom = LS.get('rot:baseUrl', '');
    if (custom) return custom.replace(/\/$/, '') + '/';
    if (this.publicUrl) return this.publicUrl.replace(/\/$/, '') + '/';
    const u = new URL('.', location.href);
    if (/^(localhost|127\.)/.test(u.hostname) && this.lan[0]) u.hostname = this.lan[0];
    return u.href.split('#')[0];
  },

  /** Comment les téléphones joignent l'application. */
  reach() {
    if (this.mode === 'local') return 'local';
    if (this.hosted || this.publicUrl || !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) return 'internet';
    return 'lan';
  },
  setBaseUrl(v) { LS.set('rot:baseUrl', v || ''); },
  LS,
};

function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
