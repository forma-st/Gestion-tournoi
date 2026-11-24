// Rotation — routeur et coquille de l'application.
import { store } from './store.js';
import { resolve } from './engine.js';
import { html, raw, toStr, toast, $ } from './ui.js';
import { shell } from './views/shell.js';
import * as home from './views/home.js';
import * as admin from './views/admin.js';
import * as portal from './views/portal.js';
import * as live from './views/live.js';
import * as sheet from './views/sheet.js';
import * as promo from './views/promo.js';
import * as print from './views/print.js';
import * as bar from './views/bar.js';

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
  new: home.wizardView,
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
};

export function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

/** Contexte commun à toutes les vues. */
async function loadCtx(route) {
  const id = route.params[0];
  if (!id || route.name === 'new') return { route };
  const t = await store.get(id);
  if (!t) return { route, missing: true };
  return { route, t, ...resolve(t) };
}

let renderSeq = 0;
export async function render({ soft = false } = {}) {
  const seq = ++renderSeq;
  const route = parseRoute();
  const fn = VIEWS[route.name] || home.homeView;
  const ctx = await loadCtx(route);
  if (seq !== renderSeq) return;
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
  ctx.repaint = () => paint(fn, ctx, true, renderSeq);
  await paint(fn, ctx, soft, seq);
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
  if (msg.type === 'net') { const n = $('.net'); if (n) n.outerHTML = toStr(shell()).match(/<span class="net[\s\S]*?<\/span>/)[0]; return; }
  if (msg.type === 'announce') return;
  if (!msg.id || r.params[0] === msg.id || r.name === 'home') render({ soft: true });
});
addEventListener('hashchange', () => render());
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* facultatif */ });
}

// Annonces : affichées en bandeau sur toutes les pages publiques
let lastAnn = null;
store.subscribe(async (msg) => {
  if (msg.type !== 'update') return;
  const r = parseRoute();
  if (!['t', 'live', 'court', 'match'].includes(r.name) || r.params[0] !== msg.id) return;
  const t = await store.get(msg.id);
  const a = t?.announcements?.at(-1);
  if (a && a.id !== lastAnn && Date.now() - new Date(a.at).getTime() < 120000) { lastAnn = a.id; toast(`📣 ${a.text}`, 'ann'); }
});

export { raw };
