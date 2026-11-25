#!/usr/bin/env node
// Serveur Tournoi — zéro dépendance. Sert la PWA, stocke les tournois en JSON,
// diffuse les mises à jour en direct (SSE). Fonctionne sans Internet sur un réseau local.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { charityTotals, issueCard, cardSale, findCard, blankCards, cancelSale } from './public/js/money.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
// Mode en ligne : adresse publique fixe (hébergement) ou tunnel Cloudflare depuis l'ordinateur du gymnase
const TUNNEL = process.argv.includes('--tunnel') || process.env.TUNNEL === '1';
let publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ONLINE = () => TUNNEL || !!publicUrl;
// Clé organisateur : protège la création de tournois quand l'application est accessible depuis Internet
const ADMIN_KEY = process.env.ADMIN_KEY || (TUNNEL || process.env.PUBLIC_URL ? crypto.randomBytes(3).toString('hex').toUpperCase() : '');
// Derrière un tunnel ou un hébergeur, l'adresse réelle du visiteur est dans les en-têtes
const TRUST_PROXY = TUNNEL || process.env.TRUST_PROXY === '1';

fs.mkdirSync(DATA, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// ------------------------------------------------------------------ stockage
const cache = new Map();
const file = (id) => path.join(DATA, `${id.replace(/[^a-z0-9_-]/gi, '')}.json`);

async function load(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const t = JSON.parse(await fsp.readFile(file(id), 'utf8'));
    cache.set(id, t);
    return t;
  } catch { return null; }
}

const writing = new Map();
async function save(t) {
  t.version = (t.version || 0) + 1;
  t.updatedAt = new Date().toISOString();
  cache.set(t.id, t);
  // écriture atomique, sérialisée par tournoi
  const prev = writing.get(t.id) || Promise.resolve();
  const p = prev.then(async () => {
    const tmp = file(t.id) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(t));
    await fsp.rename(tmp, file(t.id));
  }).catch((e) => console.error('Écriture impossible', e));
  writing.set(t.id, p);
  broadcast({ type: 'update', id: t.id, version: t.version });
  return t;
}

async function listAll() {
  const files = (await fsp.readdir(DATA)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const t = await load(f.slice(0, -5));
    if (t) out.push(summary(t));
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

const summary = (t) => ({ id: t.id, name: t.name, date: t.date, venue: t.venue, theme: t.theme, teams: t.teams.filter((x) => x.status === 'confirmed').length, maxTeams: t.registration?.maxTeams, courts: t.courts.length, format: t.format?.type, version: t.version, fee: t.registration?.fee || 0, open: !!t.registration?.open });

/** Vue publique : sans code admin, jetons ni coordonnées. */
function publicView(t) {
  return {
    ...t,
    adminPin: undefined,
    volunteerPin: undefined,
    courts: t.courts.map((c) => ({ ...c, token: undefined })),
    matches: t.matches.map((m) => ({ ...m, token: undefined })),
    messages: undefined,
    players: (t.players || []).map((p) => ({ id: p.id, name: p.name.split(' ')[0] })),
    buvettePin: undefined,
    sales: undefined,
    cards: undefined,
    cashFund: undefined,
    buvette: (t.buvette || []).map((p) => ({ id: p.id, name: p.name, price: p.price, points: p.points, category: p.category, active: p.active, soldOut: p.stock != null && p.stock !== '' && (+p.stock - (t.sales || []).filter((x) => !x.cancelled).reduce((a, x) => a + x.items.filter((i) => i.pid === p.id).reduce((b, i) => b + i.qty, 0), 0)) <= 0 })),
    charity: t.charity ? { ...t.charity, donations: (t.charity.donations || []).filter((d) => d.validated).map((d) => ({ id: d.id, name: d.anonymous ? 'Anonyme' : d.name, amount: d.amount, message: d.message, at: d.at, validated: true })) } : t.charity,
    _charity: t.charity?.enabled ? charityTotals(t) : null,
    teams: t.teams.map((x) => ({ id: x.id, name: x.name, status: x.status, color: x.color, players: x.players, captain: x.captain ? x.captain.split(' ')[0] : '', checkedIn: x.checkedIn, seed: x.seed })),
  };
}

const isAdmin = (req, t) => {
  const pin = req.headers['x-admin-pin'];
  return !!pin && pin.length <= 64 && safeEq(String(pin), String(t.adminPin));
};
function safeEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ temps réel (SSE)
const clients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ------------------------------------------------------------------ utilitaires HTTP
function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(code, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 2_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Corps trop volumineux'), { code: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON invalide'), { code: 400 }); }
}

const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

const isLoopback = (a) => /^(::1|127\.|::ffff:127\.)/.test(a || '');
function clientIp(req) {
  if (TRUST_PROXY || isLoopback(req.socket.remoteAddress)) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}
/** Requête faite depuis l'ordinateur qui fait tourner le serveur (et pas relayée par le tunnel). */
const isLocalRequest = (req) => isLoopback(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];

const rateBucket = new Map();
function rateLimited(req, key, max = 30, windowMs = 60000) {
  const k = `${key}|${clientIp(req)}`;
  const now = Date.now();
  const b = rateBucket.get(k) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; rateBucket.set(k, b);
  return b.n > max;
}

const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);

// ------------------------------------------------------------------ API
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sans "api"
  const method = req.method;

  if (parts[0] === 'ping') return send(res, 200, { ok: true, server: true, lan: lanIps(), port: PORT, time: Date.now(), publicUrl, online: ONLINE(), keyRequired: !!ADMIN_KEY && !isLocalRequest(req) });

  if (parts[0] === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (parts[0] === 'tournaments' && method === 'GET') return send(res, 200, await listAll());

  if (parts[0] === 'tournaments' && method === 'POST') {
    if (ADMIN_KEY && !isLocalRequest(req) && !safeEq(String(req.headers['x-admin-key'] || '').toUpperCase(), ADMIN_KEY.toUpperCase())) {
      if (rateLimited(req, 'key', 10)) return send(res, 429, { error: 'Trop d’essais, patientez une minute' });
      return send(res, 401, { error: 'Clé organisateur requise pour créer un tournoi', code: 'admin_key' });
    }
    const t = await readBody(req);
    if (!t.id || !/^[a-z0-9_-]{3,40}$/i.test(t.id)) return send(res, 400, { error: 'Identifiant invalide' });
    if (await load(t.id)) return send(res, 409, { error: 'Ce tournoi existe déjà' });
    t.version = 0;
    await save(t);
    return send(res, 201, t);
  }

  if (parts[0] !== 't' || !parts[1]) return send(res, 404, { error: 'Introuvable' });
  const t = await load(parts[1]);
  if (!t) return send(res, 404, { error: 'Tournoi introuvable' });
  const action = parts[2];

  if (!action && method === 'GET') return send(res, 200, isAdmin(req, t) ? t : publicView(t));

  if (!action && method === 'PUT') {
    if (!isAdmin(req, t)) return send(res, 401, { error: 'Code organisateur incorrect' });
    const body = await readBody(req, 5_000_000);
    if (body.baseVersion !== t.version) return send(res, 409, { error: 'Version périmée', current: t });
    const next = { ...body.doc, id: t.id, version: t.version };
    if (!next.adminPin) next.adminPin = t.adminPin;
    return send(res, 200, await save(next));
  }

  if (!action && method === 'DELETE') {
    if (!isAdmin(req, t)) return send(res, 401, { error: 'Code organisateur incorrect' });
    cache.delete(t.id);
    await fsp.rm(file(t.id), { force: true });
    broadcast({ type: 'deleted', id: t.id });
    return send(res, 200, { ok: true });
  }

  if (action === 'auth' && method === 'POST') {
    if (rateLimited(req, 'auth', 10)) return send(res, 429, { error: 'Trop d’essais, patientez une minute' });
    return isAdmin(req, t) ? send(res, 200, t) : send(res, 401, { error: 'Code organisateur incorrect' });
  }

  // Portail : connexion d'une équipe ou d'un bénévole par code PIN
  if (action === 'pin' && method === 'POST') {
    if (rateLimited(req, 'pin', 20)) return send(res, 429, { error: 'Trop d’essais, patientez une minute' });
    const b = await readBody(req, 2000);
    const pin = String(b.pin || '');
    if (pin && t.volunteerPin && safeEq(pin, String(t.volunteerPin))) return send(res, 200, { role: 'volunteer' });
    const team = pin && t.teams.find((x) => x.pin && safeEq(pin, String(x.pin)));
    if (team) return send(res, 200, { role: 'team', teamId: team.id, name: team.name });
    return send(res, 401, { error: 'Code inconnu' });
  }

  // Message d'une équipe à l'organisation
  if (action === 'message' && method === 'POST') {
    if (rateLimited(req, 'message', 10)) return send(res, 429, { error: 'Trop de messages, patientez une minute' });
    const b = await readBody(req, 5000);
    const text = str(b.text, 500);
    if (!text) return send(res, 400, { error: 'Message vide' });
    t.messages ??= [];
    t.messages.push({ id: crypto.randomBytes(4).toString('hex'), from: str(b.from, 60) || 'Anonyme', text, at: new Date().toISOString(), read: false });
    t.messages = t.messages.slice(-200);
    await save(t);
    return send(res, 201, { ok: true });
  }

  // Cagnotte : un participant déclare un don (validé ensuite par l'organisation)
  if (action === 'donation' && method === 'POST') {
    if (rateLimited(req, 'donation', 10)) return send(res, 429, { error: 'Trop de demandes, patientez une minute' });
    if (!t.charity?.enabled) return send(res, 403, { error: 'Pas de cagnotte pour ce tournoi' });
    const b = await readBody(req, 5000);
    const amount = Math.round((+b.amount || 0) * 100) / 100;
    if (!(amount > 0 && amount <= 10000)) return send(res, 400, { error: 'Montant invalide' });
    t.charity.donations ??= [];
    t.charity.donations.push({ id: crypto.randomBytes(4).toString('hex'), name: str(b.name, 60) || 'Anonyme', anonymous: !!b.anonymous, amount, message: str(b.message, 140), method: ['online', 'cash', 'card', 'lydia'].includes(b.method) ? b.method : 'online', at: new Date().toISOString(), validated: false });
    await save(t);
    return send(res, 201, { ok: true });
  }

  // Carte à points : consultation par son détenteur (lien secret de la carte virtuelle)
  if (action === 'card' && method === 'GET' && parts[3]) {
    if (rateLimited(req, 'cardview', 120)) return send(res, 429, { error: 'Trop de requêtes' });
    const c = findCard(t, parts[3]);
    if (!c || !safeEq(String(url.searchParams.get('k') || ''), String(c.key))) return send(res, 404, { error: 'Carte introuvable' });
    return send(res, 200, { code: c.code, name: c.name, balance: c.balance, ops: (c.ops || []).slice(-15).reverse() });
  }

  const barOk = (req2, b) => {
    const pin = String(b.pin || '');
    return isAdmin(req2, t) || (pin && ((t.volunteerPin && safeEq(pin, String(t.volunteerPin))) || (t.buvettePin && safeEq(pin, String(t.buvettePin)))));
  };

  // Carte à points côté buvette : vendre / recharger, consulter, créer des cartes à imprimer
  if (action === 'card' && method === 'POST') {
    const b = await readBody(req, 10000);
    if (!barOk(req, b)) return send(res, 403, { error: 'Code buvette incorrect' });
    try {
      if (b.op === 'issue') { const c = issueCard(t, { code: b.code, price: b.price, points: b.points, method: b.method, name: str(b.name, 40), sid: str(b.sid, 40), at: b.at, by: str(b.by, 40) }); await save(t); return send(res, 201, { code: c.code, key: c.key, name: c.name, balance: c.balance }); }
      if (b.op === 'lookup') { const c = findCard(t, b.code); return c ? send(res, 200, { code: c.code, key: c.key, name: c.name, balance: c.balance }) : send(res, 404, { error: 'Carte inconnue : vérifiez le code' }); }
      if (b.op === 'blank') { if (!isAdmin(req, t)) return send(res, 403, { error: 'Réservé à l’organisation' }); blankCards(t, Math.min(200, +b.n || 30)); await save(t); return send(res, 201, { ok: true }); }
    } catch (e) { return send(res, e.code || 400, { error: e.message }); }
    return send(res, 400, { error: 'Opération inconnue' });
  }

  // Buvette : enregistrement d'une vente (code organisateur, bénévole ou buvette). Idempotent via sid.
  if (action === 'sale' && method === 'POST') {
    const b = await readBody(req, 20000);
    if (!barOk(req, b)) return send(res, 403, { error: 'Code buvette incorrect' });
    if (b.method === 'points') {
      try {
        const r = cardSale(t, { code: b.card, items: b.items, sid: str(b.sid, 40), at: b.at, by: str(b.by, 40) });
        if (!r.duplicate) await save(t);
        return send(res, 201, { ok: true, pts: r.pts, balance: r.card.balance, name: r.card.name, code: r.card.code });
      } catch (e) { return send(res, e.code || 400, { error: e.message, balance: e.balance }); }
    }
    t.sales ??= [];
    if (b.cancel) { cancelSale(t, b.cancel); await save(t); return send(res, 200, { ok: true }); }
    const sid = str(b.sid, 40) || crypto.randomBytes(6).toString('hex');
    if (t.sales.some((x) => x.id === sid)) return send(res, 200, { ok: true, duplicate: true });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((it) => {
      const p = (t.buvette || []).find((x) => x.id === it.pid);
      return p && +it.qty > 0 ? { pid: p.id, name: p.name, qty: Math.min(99, Math.floor(+it.qty)), price: +p.price || 0 } : null;
    }).filter(Boolean);
    if (!items.length) return send(res, 400, { error: 'Panier vide' });
    const total = Math.round(items.reduce((a, i) => a + i.qty * i.price, 0) * 100) / 100;
    t.sales.push({ id: sid, at: b.at && !isNaN(Date.parse(b.at)) ? b.at : new Date().toISOString(), items, total, method: ['cash', 'card', 'lydia', 'check', 'free'].includes(b.method) ? b.method : 'cash', by: str(b.by, 40) });
    await save(t);
    return send(res, 201, { ok: true, total });
  }

  // Feuille de match : saisie des scores par les joueurs (jeton de match ou de terrain)
  if (action === 'score' && method === 'POST') {
    if (rateLimited(req, 'score', 240)) return send(res, 429, { error: 'Trop de requêtes' });
    const b = await readBody(req, 50_000);
    const m = t.matches.find((x) => x.id === b.matchId);
    if (!m) return send(res, 404, { error: 'Match introuvable' });
    const court = t.courts.find((c) => c.id === m.courtId);
    const pin = b.pin ? String(b.pin) : '';
    const team = pin && t.teams.find((x) => x.pin && safeEq(pin, String(x.pin)));
    const ok = isAdmin(req, t)
      || (b.token && (safeEq(String(b.token), String(m.token)) || (court?.token && safeEq(String(b.token), String(court.token)))))
      || (pin && t.volunteerPin && safeEq(pin, String(t.volunteerPin)))
      || t.openScoring === true
      || (team && [m.referee, b.teamA, b.teamB, m.teamA, m.teamB].includes(team.id));
    if (!ok) return send(res, 403, { error: 'Lien de feuille de match invalide' });
    if (m.status === 'done' && m.validated && !isAdmin(req, t)) return send(res, 409, { error: 'Score déjà validé par l’organisation' });
    if (Array.isArray(b.sets)) m.sets = b.sets.slice(0, 7).map((s) => [Math.max(0, Math.min(999, +s[0] || 0)), Math.max(0, Math.min(999, +s[1] || 0))]);
    if (['live', 'done', 'scheduled'].includes(b.status)) m.status = b.status;
    if (b.status === 'live' && !m.startedAt) m.startedAt = new Date().toISOString();
    if (b.status === 'done') { m.finishedAt = new Date().toISOString(); m.validated = !t.scoreValidation || isAdmin(req, t); }
    if ('tieWinner' in b) m.tieWinner = ['A', 'B'].includes(b.tieWinner) ? b.tieWinner : null;
    if ('timer' in b && (isAdmin(req, t) || t.timerControl === 'players')) m.timer = b.timer && typeof b.timer === 'object' ? { running: !!b.timer.running, elapsed: +b.timer.elapsed || 0, since: +b.timer.since || 0 } : null;
    if (b.submittedBy) m.submittedBy = str(b.submittedBy, 80);
    if (b.signatures) m.signatures = { A: str(b.signatures.A, 60), B: str(b.signatures.B, 60) };
    if (b.comment != null) m.comment = str(b.comment, 300);
    await save(t);
    return send(res, 200, { ok: true, match: { ...m, token: undefined }, version: t.version });
  }

  // Inscription en ligne
  if (action === 'register' && method === 'POST') {
    if (rateLimited(req, 'register', 10)) return send(res, 429, { error: 'Trop d’inscriptions depuis cet appareil, réessayez plus tard' });
    const r = t.registration || {};
    if (!r.open) return send(res, 403, { error: 'Les inscriptions sont fermées' });
    if (r.deadline && new Date(r.deadline + 'T23:59:59') < new Date()) return send(res, 403, { error: 'La date limite d’inscription est passée' });
    const b = await readBody(req, 20_000);
    if (b.kind === 'player') {
      const pname = str(b.name, 60);
      if (!pname) return send(res, 400, { error: 'Indiquez votre nom' });
      t.players ??= [];
      if (t.players.some((p) => p.name.toLowerCase() === pname.toLowerCase())) return send(res, 409, { error: 'Vous êtes déjà inscrit(e)' });
      t.players.push({ id: crypto.randomBytes(4).toString('hex'), name: pname, level: Math.min(4, Math.max(1, +b.level || 2)), gender: ['F', 'H'].includes(b.gender) ? b.gender : '', contact: str(b.contact, 120), present: false, paid: false, source: 'online', createdAt: new Date().toISOString() });
      await save(t);
      return send(res, 201, { ok: true });
    }
    const name = str(b.name, 40);
    if (!name) return send(res, 400, { error: 'Indiquez un nom d’équipe' });
    if (t.teams.some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Ce nom d’équipe est déjà pris' });
    const confirmed = t.teams.filter((x) => x.status === 'confirmed').length;
    const full = r.maxTeams && confirmed >= r.maxTeams;
    const team = {
      id: crypto.randomBytes(4).toString('hex'), name,
      captain: str(b.captain, 60), email: str(b.email, 120), phone: str(b.phone, 30),
      players: (Array.isArray(b.players) ? b.players : []).map((p) => str(p, 60)).filter(Boolean).slice(0, 20),
      comment: str(b.comment, 300),
      status: full ? 'waitlist' : r.requireValidation ? 'pending' : 'confirmed',
      payment: (r.fee || 0) > 0 || (r.barCard?.enabled && b.barOption) ? 'unpaid' : 'free',
      barOption: !!(t.registration?.barCard?.enabled && b.barOption),
      checkedIn: false, source: 'online', level: Math.min(3, Math.max(1, +b.level || 2)), pin: String(1000 + crypto.randomInt(9000)), createdAt: new Date().toISOString(),
      ref: `${t.id.slice(0, 3).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    };
    t.teams.push(team);
    await save(t);
    return send(res, 201, { ok: true, team: { id: team.id, name: team.name, status: team.status, ref: team.ref, payment: team.payment, pin: team.pin, players: team.players, barOption: team.barOption } });
  }

  return send(res, 404, { error: 'Introuvable' });
}

// ------------------------------------------------------------------ fichiers statiques
const origin = (req) => publicUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  // Page promo partageable : /p/<id> → index.html avec balises Open Graph
  const promo = p.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
  if (promo || p === '/' || !path.extname(p)) {
    let html = await fsp.readFile(path.join(PUBLIC, 'index.html'), 'utf8');
    if (promo) {
      const t = await load(promo[1]);
      if (t) {
        const date = t.date ? new Date(t.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
        const desc = `${date}${t.venue ? ' · ' + t.venue : ''} — ${t.tagline || t.description || 'Inscrivez votre équipe !'}`;
        const og = `<title>${esc(t.name)}</title>
<meta property="og:title" content="${esc(t.name)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(`${origin(req)}${p}`)}">
<meta property="og:image" content="${esc(`${origin(req)}/icons/og.png`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="description" content="${esc(desc)}">`;
        html = html.replace(/<title>.*?<\/title>/, og);
      }
      html = html.replace('<head>', '<head>\n<base href="/">');
    }
    return send(res, 200, html, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
  }
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Interdit');
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) throw new Error();
    const ext = path.extname(full);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache', 'content-length': st.size });
    fs.createReadStream(full).pipe(res);
  } catch { send(res, 404, 'Introuvable'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message || 'Erreur serveur' });
  }
});

server.listen(PORT, HOST, () => {
  const ips = lanIps();
  console.log('\n  🏐  Rotation : serveur prêt\n');
  console.log(`  Sur cet ordinateur : http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Réseau local (Wi-Fi) : http://${ip}:${PORT}`);
  if (publicUrl) console.log(`\n  🌍 Adresse publique : ${publicUrl}`);
  if (TUNNEL) startTunnel();
  if (ADMIN_KEY) console.log(`\n  🔑 Clé organisateur (pour créer un tournoi depuis un autre appareil) : ${ADMIN_KEY}`);
  console.log(`\n  Données : ${DATA}\n`);
});

/**
 * Tunnel Cloudflare : rend le serveur accessible depuis Internet (4G des joueurs) sans configurer de box.
 * - sans compte : adresse https://xxxx.trycloudflare.com, nouvelle à chaque lancement ;
 * - avec TUNNEL_TOKEN (tunnel nommé) et PUBLIC_URL : adresse fixe, QR codes imprimables à l'avance.
 */
function startTunnel() {
  const bin = process.env.CLOUDFLARED || 'cloudflared';
  const args = process.env.TUNNEL_TOKEN
    ? ['tunnel', '--no-autoupdate', 'run', '--token', process.env.TUNNEL_TOKEN]
    : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`];
  console.log('  ⏳ Ouverture du tunnel Cloudflare…');
  let child;
  try { child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return tunnelMissing(); }
  child.on('error', tunnelMissing);
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !process.env.PUBLIC_URL && publicUrl !== m[0]) {
      publicUrl = m[0];
      console.log(`\n  🌍 En ligne : ${publicUrl}\n     Ouvrez cette adresse sur l'ordinateur : les QR codes l'utiliseront.\n     (Elle change à chaque lancement : imprimez les affiches QR une fois le serveur démarré.)\n`);
      broadcast({ type: 'net' });
    }
    if (/Registered tunnel connection/i.test(String(buf)) && process.env.TUNNEL_TOKEN) console.log(`  🌍 Tunnel connecté : ${publicUrl || '(définissez PUBLIC_URL)'}`);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => { if (code) console.log(`  ⚠️  Le tunnel s'est arrêté (code ${code}). Vérifiez la connexion Internet puis relancez.`); });
  const stop = () => { try { child.kill(); } catch { /* */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function tunnelMissing() {
  console.log(`
  ⚠️  cloudflared n'est pas installé : le serveur marche, mais seulement sur cet ordinateur et le réseau local.
     Installez-le une fois (gratuit) puis relancez « npm run en-ligne » :
       • Windows : winget install --id Cloudflare.cloudflared
       • Mac     : brew install cloudflared
       • Linux   : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
`);
}
