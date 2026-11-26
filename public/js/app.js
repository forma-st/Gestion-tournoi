// Rotation — routeur et coquille de l'application.
import { store } from './store.js';
import { resolve } from './engine.js';
import { html, raw, toStr, toast, $ } from './ui.js';
import { shell, netBadge } from './views/shell.js';
import * as home from './views/home.js';
import * as admin from './views/admin.js';
import * as portal from './views/portal.js';
import * as live from './views/live.js';
import * as sheet from './views/sheet.js';
import * as promo from './views/promo.js';
import * as print from './views/print.js';
import * as bar from './views/bar.js';
import * as wizard from './views/wizard.js';

const root = document.getElementById('app');
let current = null; // { view, params, query, t, cleanup }

export function parseRoute() {
  const promoPath = location.pathname.match(/\/p\/([a-z0-9_-]+)\/?$/i);
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (!parts.length && promoPath) return { name: 'promo', params: [promoPath[1]], query };
  const name = parts[0] || 'home';
  return { name, params: parts.slice(1), query };
}

const VIEWS = {
  home: home.homeView,
  new: wizard.wizardView,
  admin: admin.view,
  t: portal.view,
  live: live.view,
  court: sheet.courtView,
  match: sheet.matchView,
  p: promo.view,
  promo: promo.view,
  inscription: promo.registerView,
  print: print.view,
  caisse: bar.caisseView,
  carte: bar.carteView,
  don: bar.donView,
};

export function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

/** Contexte commun à toutes les vues. */
async function loadCtx(route) {
  const id = route.params[0];
  if (!id || route.name === 'new') { store.watch(null); return { route }; }
  const t = await store.get(id);
  store.watch(t ? id : null);
  if (!t) return { route, missing: true };
  return { route, t, ...resolve(t) };
}

let renderSeq = 0;
export async function render({ soft = false } = {}) {
  const seq = ++renderSeq;
  const route = parseRoute();
  const fn = VIEWS[route.name] || home.homeView;
  let ctx;
  try { ctx = await loadCtx(route); }
  catch (e) { return renderFailed(e, soft); }
  if (seq !== renderSeq) return;
  if (ctx.t) announce(route, ctx.t);
  ctx.rerender = () => render({ soft: true });
  ctx.go = go;
  ctx.store = store;
  if (ctx.missing) {
    document.body.className = '';
    root.replaceChildren(); root.innerHTML = toStr(html`${shell()}<main class="wrap narrow"><div class="empty"><h2>Tournoi introuvable</h2><p>Le lien est peut-être incomplet, ou le tournoi a été supprimé.</p><a class="btn" href="#/">Retour à l’accueil</a></div></main>`);
    return;
  }
  // Ne pas écraser une saisie en cours lors d'une mise à jour en arrière-plan
  if (soft && current?.view === fn && current.keep?.()) return;
  ctx.repaint = () => paint(fn, ctx, true, renderSeq).catch((e) => renderFailed(e, true));
  try { await paint(fn, ctx, soft, seq); }
  catch (e) { renderFailed(e, soft); }
}

/**
 * Une erreur d'affichage ne doit jamais laisser un écran blanc (grand écran, feuille de match) :
 * on garde ce qui est affiché et on réessaie quelques secondes plus tard.
 */
let retryTimer = null;
function renderFailed(e, soft) {
  console.error('Affichage impossible, nouvel essai dans 5 s', e);
  if (!soft && !root.childElementCount) root.innerHTML = '<main class="wrap narrow"><div class="empty"><h2>Chargement…</h2><p>Nouvel essai dans quelques secondes.</p></div></main>';
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => render({ soft: true }), 5000);
}

/**
 * Mises à jour en arrière-plan : pendant un match, il en arrive une à chaque point marqué.
 * On les regroupe (au plus un rafraîchissement toutes les 0,7 s, jamais deux en même temps).
 */
let busy = false, again = false, lastRun = 0, softTimer = null;
function scheduleSoft() {
  if (busy) { again = true; return; }
  if (softTimer) return;
  softTimer = setTimeout(async () => {
    softTimer = null;
    busy = true; lastRun = Date.now();
    try { await render({ soft: true }); } finally {
      busy = false;
      if (again) { again = false; scheduleSoft(); }
    }
  }, Math.max(0, 700 - (Date.now() - lastRun)));
}

/** Dessine une vue avec un contexte déjà chargé (repaint = sans relire les données). */
async function paint(fn, ctx, soft, seq) {
  current?.cleanup?.();
  const out = await fn(ctx);
  if (seq !== renderSeq) return;
  document.body.className = out.bodyClass || '';
  document.title = out.title ? `${out.title} · Rotation` : 'Rotation · Tournois de volley et multisport';
  const scrollY = soft ? scrollY0() : 0;
  const el = document.createElement('div');
  el.innerHTML = toStr(out.html);
  root.replaceChildren(el);
  out.mount?.(el);
  current = { view: fn, cleanup: () => out.cleanup?.(), keep: out.keep };
  if (soft) window.scrollTo(0, scrollY); else window.scrollTo(0, 0);
}
const scrollY0 = () => window.scrollY;

// ------------------------------------------------------------------ démarrage
await store.init();
store.subscribe((msg) => {
  const r = parseRoute();
  if (msg.type === 'net') return refreshNet();
  if (msg.type === 'announce') return;
  if (!msg.id || r.params[0] === msg.id || r.name === 'home') scheduleSoft();
});
addEventListener('hashchange', () => render());

/** Met à jour les voyants de connexion sans redessiner la page (et toutes les 5 s, pour l'état « lent »). */
function refreshNet() {
  const badge = toStr(netBadge());
  document.querySelectorAll('.net').forEach((n) => { if (n.outerHTML !== badge) n.outerHTML = badge; });
}
setInterval(refreshNet, 5000);
render();

// Le code est gardé sur l'appareil (service worker) et n'est retéléchargé qu'à la publication d'une nouvelle version.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // écrans allumés toute la soirée (grand écran, admin) : on regarde de temps en temps s'il y a une nouvelle version
    setInterval(() => reg.update().catch(() => {}), 30 * 60000);
  }).catch(() => { /* facultatif */ });
  // Nouvelle version installée pendant que la page est ouverte
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // première visite : rien à faire
    const r = parseRoute();
    if (r.name === 'live') location.reload(); // grand écran : on passe à la nouvelle version tout de suite
    else toast('Nouvelle version de l’application installée : elle sera utilisée au prochain chargement de la page');
  });
}

// Annonces : affichées en bandeau sur toutes les pages publiques (sans requête supplémentaire)
let lastAnn = null;
function announce(route, t) {
  if (!['t', 'live', 'court', 'match'].includes(route.name)) return;
  const a = t?.announcements?.at(-1);
  if (a && a.id !== lastAnn && Date.now() - new Date(a.at).getTime() < 120000) { lastAnn = a.id; toast(`📣 ${a.text}`, 'ann'); }
}

export { raw };
