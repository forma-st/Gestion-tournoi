import { store } from '../store.js';
import { html, logo } from '../ui.js';

/** Barre supérieure commune. */
export function shell({ title = '', right = '' } = {}) {
  const net = store.mode === 'local'
    ? html`<span class="net local" title="Les données restent dans ce navigateur"><i></i>Mode autonome</span>`
    : store.online
      ? html`<span class="net" title="${store.reach() === 'internet' ? 'Accessible depuis Internet (4G)' : 'Réseau local (Wi-Fi)'}"><i></i>${store.reach() === 'internet' ? 'En ligne' : 'Réseau local'}${store.pending.length ? ` · ${store.pending.length} en attente` : ''}</span>`
      : html`<span class="net off"><i></i>Hors ligne${store.pending.length ? ` · ${store.pending.length} en attente` : ''}</span>`;
  return html`<header class="topbar"><div class="in">
    <a class="brand" href="#/">${logo}<span>Rotation</span></a>
    ${title ? html`<span class="tname">${title}</span>` : ''}
    <span class="spacer"></span>${net}${right}
  </div></header>`;
}

