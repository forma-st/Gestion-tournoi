import qrcode from '../vendor/qrcode.mjs';
import { SPORTS, sourceLabel, BYE, scoringFor, matchResult, slotTime } from './engine.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Gabarit HTML : échappe les valeurs, sauf celles marquées raw() ou les tableaux de raw. */
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s ?? '') });
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return raw(out);
}
function val(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(val).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}
export const toStr = (h) => (h && typeof h === 'object' && RAW in h ? h[RAW] : String(h ?? ''));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ toasts & dialogues
export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), kind === 'ann' ? 9000 : 3500);
}

/** Ouvre une modale ; renvoie une promesse résolue avec les données du formulaire (ou null). */
export function modal({ title, body, ok = 'Enregistrer', cancel = 'Annuler', danger = false, wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    if (wide) d.style.width = 'min(94vw, 820px)';
    d.innerHTML = toStr(html`<form method="dialog">
      <div class="dh"><h3>${title}</h3><button type="button" class="btn ghost icon sm" data-x aria-label="Fermer">✕</button></div>
      <div class="db">${raw(toStr(body))}</div>
      <div class="df">${cancel ? html`<button type="button" class="btn ghost" data-x>${cancel}</button>` : ''}${ok ? html`<button class="btn ${danger ? 'danger' : ''}" value="ok">${ok}</button>` : ''}</div>
    </form>`);
    document.body.append(d);
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => close(null)));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.reportValidity()) return;
      close(formData(f));
    });
    d.showModal();
    onOpen?.(d);
  });
}
export const confirmBox = (title, text, ok = 'Confirmer', danger = true) => modal({ title, body: html`<p>${text}</p>`, ok, danger });

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.type === 'number') o[el.name] = el.value === '' ? '' : +el.value;
    else o[el.name] = el.value;
  }
  return o;
}

// ------------------------------------------------------------------ QR codes (SVG, hors-ligne)
export function qrSvg(text, { margin = 2, dark = '#0F2A17' } = {}) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), s = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return raw(`<svg viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="${dark}"/></svg>`);
}

// ------------------------------------------------------------------ icônes (traits simples)
const I = {
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3c2.5 3 3 7 1.5 10.5M3.5 9.5c3.5-.5 7.5.5 10 3.5M7 19.5c1-3.5 3.5-6.5 7-8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3"/>',
  tree: '<path d="M3 5h5v4H3zM3 15h5v4H3zM16 10h5v4h-5zM8 7h4v10H8M12 12h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  cup: '<path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8zM17 10h2a2 2 0 0 1 0 4h-2M8 3v2M11 3v2M14 3v2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`);
export const logo = raw(`<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#FFFFFF"/><path d="M16 2c4.5 4 6 10 4 17M3 12c6-1.5 12 0 17 4.5M8 28c1.5-6 6-11 13-13" fill="none" stroke="#0B6E2E" stroke-width="2.2" stroke-linecap="round"/></svg>`);

// ------------------------------------------------------------------ formatage
export const sportOf = (court) => SPORTS[court?.sport] || SPORTS.autre;
export const fmtDate = (d, opt = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) => (d ? new Date(d + 'T12:00').toLocaleDateString('fr-FR', opt) : '');
export const euros = (n) => (+n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: +n % 1 ? 2 : 0 });
export const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;

export function teamName(t, id) {
  if (!id) return null;
  if (id === BYE) return 'Exempt';
  return t.teams.find((x) => x.id === id)?.name || '?';
}

/** Libellés d'affichage d'un match (équipes résolues ou provenance). */
export function sides(t, m, resolved) {
  const r = resolved[m.id] || {};
  const a = m.phase === 'pool' ? m.teamA : r.a;
  const b = m.phase === 'pool' ? m.teamB : r.b;
  return {
    a, b,
    nameA: a ? teamName(t, a) : sourceLabel(t, m.srcA),
    nameB: b ? teamName(t, b) : sourceLabel(t, m.srcB),
    tbdA: !a, tbdB: !b,
    winner: r.winner, result: r.result,
    referee: r.referee ?? m.referee ?? null,
  };
}

/** Résumé du score : « 2-1 » et détail des sets « 25-20 · 18-25 · 15-12 ». */
export function scoreText(t, m) {
  const sc = scoringFor(t, m);
  const sets = (m.sets || []).filter((s) => s && (s[0] !== '' || s[1] !== ''));
  if (!sets.length) return { main: '', detail: '' };
  if (sc.mode === 'time' || (sc.setsToWin === 1 && sets.length === 1)) return { main: `${sets[0][0]}-${sets[0][1]}`, detail: m.tieWinner ? 'Départagé' : '' };
  const r = matchResult(m, sc);
  return { main: `${r.setsA}-${r.setsB}`, detail: sets.map((s) => `${s[0]}-${s[1]}`).join(' · ') };
}

export const matchTime = (t, m) => (m.slot != null ? slotTime(t, m.slot) : '');

export function phaseLabel(t, m) {
  if (m.phase === 'pool') return t.format.type === 'roundrobin' ? (m.leg > 1 ? `Championnat · manche ${m.leg}` : 'Championnat') : t.format.type === 'levels' ? `Brassage · poule ${m.pool}` : `Poule ${m.pool}`;
  if (m.phase === 'pool2') return `Niveau · poule ${m.pool.slice(1)}`;
  if (m.bracketId === 'place') return m.label;
  return m.bracketName && m.bracketId !== 'main' ? `${m.bracketName} · ${m.label}` : m.label;
}

/** Sauvegarde un fichier côté navigateur. */
export function download(name, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const contrastInk = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? 'light' : '';
};

/** Réduit une image (logo) et la renvoie en data URL légère, pour la stocker dans le tournoi. */
export function imageToDataUrl(file, maxW = 360, maxH = 180) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choisissez une image (PNG, JPG, SVG…)'));
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let url = c.toDataURL('image/webp', 0.85);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
      if (url.length > 120000) return reject(new Error('Image trop lourde même réduite : essayez un logo plus simple'));
      resolve(url);
    };
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

/** Partenaire : logo si disponible, sinon nom ; lien vers son site si renseigné. */
export function sponsorBadge(s, { height = 48, link = true } = {}) {
  const inner = s.logo ? html`<img src="${s.logo}" alt="${s.name || 'Partenaire'}" style="height:${height}px;width:auto;max-width:${height * 3}px;object-fit:contain;background:#fff;border-radius:6px;padding:4px">` : html`<span class="pill" style="font-size:1rem">${s.name}</span>`;
  return link && s.url ? html`<a href="${s.url}" target="_blank" rel="noopener" title="${s.name}">${inner}</a>` : inner;
}
export const activeSponsors = (t) => (t.sponsors || []).filter((s) => s.name || s.logo);
