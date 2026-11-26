import { store } from '../store.js';
import { html, logo } from '../ui.js';

/** Barre supérieure commune. */
/** Voyant de connexion : vert (à jour), orange (pas de nouvelles depuis 30 s), rouge (coupé) + envois en attente. */
export function netBadge() {
  if (store.mode === 'local') return html`<span class="net local" title="Les données restent dans ce navigateur"><i></i>Mode autonome</span>`;
  const h = store.health();
  const wait = h.pending ? ` · ${h.pending} en attente` : '';
  if (h.state === 'off') return html`<span class="net off" title="Les saisies sont gardées sur cet appareil et partiront au retour du réseau"><i></i>Hors ligne${wait}</span>`;
  if (h.state === 'slow') return html`<span class="net slow" title="Le serveur n'a pas répondu depuis ${Math.round(h.age / 1000)} s"><i></i>Connexion lente${wait}</span>`;
  return html`<span class="net" title="${store.reach() === 'internet' ? 'Accessible depuis Internet (4G)' : 'Réseau local (Wi-Fi)'}"><i></i>${store.reach() === 'internet' ? 'En ligne' : 'Réseau local'}${wait}</span>`;
}

export function shell({ title = '', right = '' } = {}) {
  const net = netBadge();
  return html`<header class="topbar"><div class="in">
    <a class="brand" href="#/">${logo}<span>Rotation</span></a>
    ${title ? html`<span class="tname">${title}</span>` : ''}
    <span class="spacer"></span>${net}${right}
  </div></header>`;
}

