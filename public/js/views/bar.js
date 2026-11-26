// Buvette (caisse tactile + gestion) et cagnotte solidaire.
import { store } from '../store.js';
import { html, raw, toast, modal, confirmBox, euros, plural, qrSvg, download, logo, $ } from '../ui.js';
import { uid } from '../engine.js';
import { buvetteStats, charityTotals, feesSummary, PAY_METHODS, ingredientStats, productCost, productPoints, DEFAULT_PACKS, cardsSummary, filRougeOn } from '../money.js';

const CATS = ['Boissons', 'Snacks', 'Sucré', 'Salé', 'Autre'];
const CAT_COLORS = { Boissons: '#00A6D6', Snacks: '#F2545B', Sucré: '#8E6CEF', Salé: '#FF8C42', Autre: '#3BB273' };

export const charityOf = (t) => t._charity || charityTotals(t);

// ------------------------------------------------------------------ widget cagnotte (portail, promo)
export function charityCard(t, { donate = true } = {}) {
  const c = t.charity;
  if (!c?.enabled) return '';
  const x = charityOf(t);
  return html`<div class="card stack dark" style="background:var(--ink);color:#fff">
    <h3 style="color:var(--ball);margin:0">${c.label || 'Cagnotte solidaire'}</h3>
    <div class="num" style="font-size:2.6rem;line-height:1">${euros(x.total)} ${x.goal ? html`<span style="font-size:1.1rem;opacity:.7">sur ${euros(x.goal)}</span>` : ''}</div>
    ${x.goal ? html`<div class="places"><i style="width:${x.pct}%"></i></div>` : ''}
    ${x.pledgeOn ? html`<p style="margin:0">🏐 Chaque point marqué rapporte ${euros(c.pointPledge)}${c.pledgeSponsor ? ` grâce à ${c.pledgeSponsor}` : ''} : <b>${x.points} points</b> marqués, soit <b>${euros(x.pledge)}</b>.</p>` : ''}
    ${x.next ? html`<p style="margin:0">Prochain palier : <b>${euros(x.next.amount)}</b> → ${x.next.label}</p>` : ''}
    ${x.reached.length ? html`<p style="margin:0;opacity:.85">Défis débloqués : ${x.reached.map((m) => m.label).join(' · ')}</p>` : ''}
    ${donate ? html`<div class="row"><a class="btn ball" href="#/don/${t.id}">Faire un don</a><button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.35)" data-act="declare-don">J’ai donné, je le signale</button></div>` : ''}
  </div>`;
}

/** Réglages : comment les dons sont versés au club (qui collecte puis reverse). */
export function donSettings(t) {
  const c = t.charity || {};
  return html`<div class="card flat stack"><b>Recevoir les dons (le club collecte, puis reverse)</b>
    <label class="f">Lien de paiement du club <span class="hint">HelloAsso (formulaire de don, 0 % de frais), SumUp, Lydia Pro, PayPal…</span><input type="url" data-path="charity.payUrl" value="${c.payUrl || ''}" placeholder="https://www.helloasso.com/associations/…/formulaires/…"></label>
    <label class="f">Numéro Wero / Lydia du club <span class="hint">facultatif : les donateurs envoient au numéro affiché</span><input type="tel" data-path="charity.payPhone" value="${c.payPhone || ''}" placeholder="06 12 34 56 78"></label>
    <label class="f">Bénéficiaire affiché <span class="hint">à qui libeller le paiement</span><input type="text" data-path="charity.payee" value="${c.payee || ''}" placeholder="${t.organizer || 'Nom du club'}"></label>
    <div class="qrbox"><div class="qr" style="width:140px">${qrSvg(`${store.baseUrl()}#/don/${t.id}`)}</div><span class="hint">QR affiché sur le grand écran : il ouvre la page « Faire un don » du tournoi, avec ces moyens de paiement.</span> <a class="small" href="#/don/${t.id}" target="_blank">Voir la page</a></div>
  </div>`;
}

/** Page publique « Faire un don » : paiement au club (lien, Wero/Lydia, sur place) puis signalement du don. */
export async function donView(ctx) {
  const { t } = ctx;
  const c = t.charity || {};
  if (!c.enabled) return { title: 'Dons', html: html`<main class="sheet"><div class="empty">Pas de cagnotte pour ce tournoi.</div></main>` };
  const payee = c.payee || t.organizer || 'le club';
  return {
    title: `Faire un don · ${t.name}`,
    html: html`<main class="sheet" style="max-width:520px">
      ${charityCard(t, { donate: false })}
      <div class="card stack"><h2 style="margin:0">Faire un don</h2>
        <p style="margin:0">Les dons sont collectés par <b>${payee}</b>, qui reverse l’intégralité au ${c.label || 'profit de la cause'}.</p>
        ${c.payUrl ? html`<a class="btn ball block" style="min-height:54px;font-size:1.1rem" href="${c.payUrl}" target="_blank" rel="noopener">Donner en ligne (carte bancaire)</a>` : ''}
        ${c.payPhone ? html`<div class="card flat stack" style="gap:.4rem"><b>Par Wero ou Lydia</b><span>Envoyez votre don au <b class="num" style="font-size:1.4rem">${c.payPhone}</b> (${payee}), avec « ${c.label || 'Don'} » en message.</span><div><button class="btn ghost sm" data-copy="${c.payPhone.replace(/\s/g, '')}">Copier le numéro</button></div></div>` : ''}
        <div class="card flat stack" style="gap:.4rem"><b>Sur place</b><span>En espèces ou par carte, à l’accueil ou à la buvette.</span></div>
        <button class="btn ghost block" data-act="declare-don">J’ai donné : je le signale pour l’afficher à l’écran</button>
        <p class="hint" style="margin:0">Votre don apparaît sur le grand écran après vérification par l’organisation.</p>
      </div>
      <p class="small muted" style="text-align:center"><a href="#/t/${t.id}">Matchs et classements</a></p>
    </main>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act=declare-don]')) declareDonation(t);
        const cp = e.target.closest('[data-copy]');
        if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Numéro copié', 'ok'); } catch { toast(cp.dataset.copy); } }
      });
    },
  };
}

export async function declareDonation(t) {
  const r = await modal({
    title: `Signaler un don au ${t.charity.label || 'profit de la cause'}`,
    body: html`<p class="hint" style="margin:0">Vous avez donné en ligne, dans l’urne ou à la buvette ? Signalez-le : après vérification, votre don s’affiche sur le grand écran.</p>
      <div class="grid2"><label class="f">Prénom ou équipe<input type="text" name="name" maxlength="60" required></label><label class="f">Montant (€)<input type="number" name="amount" min="1" step="1" required></label></div>
      <label class="f">Comment ?<select name="method"><option value="online">En ligne</option><option value="cash">Espèces (urne)</option><option value="card">Carte</option><option value="lydia">Lydia / Wero</option></select></label>
      <label class="f">Un petit mot <span class="hint">Facultatif, affiché sur l’écran</span><input type="text" name="message" maxlength="140"></label>
      <label class="check"><input type="checkbox" name="anonymous"> Rester anonyme à l’écran</label>`,
    ok: 'Signaler mon don',
  });
  if (!r) return;
  try { await store.donate(t.id, { name: r.name, amount: +r.amount, method: r.method, message: r.message, anonymous: r.anonymous }); toast('Merci ! Votre don sera affiché après vérification 💛', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

// ------------------------------------------------------------------ caisse tactile
let cart = {};
let method = null;

const recentKey = (tid) => `rot:recentcards:${tid}`;
const recentCards = (tid) => { try { return JSON.parse(sessionStorage.getItem(recentKey(tid))) || []; } catch { return []; } };
function rememberCard(tid, c) {
  const list = [{ code: c.code, name: c.name || '', balance: c.balance }, ...recentCards(tid).filter((x) => x.code !== c.code)].slice(0, 6);
  try { sessionStorage.setItem(recentKey(tid), JSON.stringify(list)); } catch { /* */ }
}

/** URL de la carte virtuelle (le même QR sert au joueur et au scan de la buvette). */
export const cardUrl = (t, c) => `${store.baseUrl()}#/carte/${t.id}/${c.code}?k=${c.key}`;
const parseCode = (txt) => (String(txt).match(/carte\/[^/]+\/(\d{4,6})/) || String(txt).match(/^\s*(\d{4,6})\s*$/) || [])[1] || null;

/** Scan du QR d'une carte avec la caméra (Android/Chrome) ; sinon on tape le code. */
export function scanCard() {
  return new Promise(async (resolve) => {
    if (!('BarcodeDetector' in self) || !navigator.mediaDevices?.getUserMedia) { toast('Scan non disponible sur cet appareil : tapez le code de la carte', 'err'); return resolve(null); }
    let stream;
    const d = document.createElement('dialog');
    d.innerHTML = '<div class="dh"><h3>Scanner la carte</h3></div><div class="db"><video playsinline muted style="width:100%;border-radius:12px;background:#000"></video></div><div class="df"><button class="btn ghost" data-x>Annuler</button></div>';
    document.body.append(d); d.showModal();
    let done = false;
    const close = (v) => { if (done) return; done = true; stream?.getTracks().forEach((x) => x.stop()); d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-x]').onclick = () => close(null);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = d.querySelector('video'); v.srcObject = stream; await v.play();
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (done) return;
        try { const r = await det.detect(v); const code = r.map((x) => parseCode(x.rawValue)).find(Boolean); if (code) { navigator.vibrate?.(60); return close(code); } } catch { /* */ }
        setTimeout(loop, 200);
      };
      loop();
    } catch { toast('Caméra inaccessible : tapez le code de la carte', 'err'); close(null); }
  });
}

/** Demande le code d'une carte : clavier numérique, cartes récentes en un geste, ou scan. */
async function askCard(t, { title, total = '', allowNew = false }) {
  const recent = recentCards(t.id);
  let scanned = null;
  const r = await modal({
    title, ok: allowNew ? 'Valider' : 'Débiter la carte',
    body: html`${total ? html`<p class="num" style="font-size:2.6rem;text-align:center;margin:0">${total}</p>` : ''}
      <label class="f">Code de la carte${allowNew ? html` <span class="hint">laisser vide pour une nouvelle carte virtuelle</span>` : ''}<input type="text" name="code" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" ${allowNew ? '' : raw('required')} autocomplete="off" style="font-size:2rem;text-align:center;letter-spacing:.3em" autofocus></label>
      <button type="button" class="btn ghost block" data-scan>📷 Scanner le QR de la carte</button>
      ${recent.length ? html`<div class="stack" style="gap:.4rem"><span class="small muted">Cartes récentes</span><div class="row">${recent.map((c) => html`<button type="button" class="btn ghost sm" data-code="${c.code}">${c.code}${c.name ? ` · ${c.name}` : ''}</button>`)}</div></div>` : ''}`,
    onOpen(d) {
      const input = d.querySelector('input[name=code]');
      d.querySelectorAll('[data-code]').forEach((x) => { x.onclick = () => { input.value = x.dataset.code; d.querySelector('form').requestSubmit(); }; });
      d.querySelector('[data-scan]').onclick = async () => { const c = await scanCard(); if (c) { input.value = c; scanned = c; d.querySelector('form').requestSubmit(); } };
    },
  });
  if (!r) return undefined;
  return (r.code || scanned || '').replace(/\D/g, '');
}

/** Vente ou recharge d'une carte à points. */
async function sellCard(ctx, pin, presetCode = '') {
  const { t } = ctx;
  const packs = t.cardPacks?.length ? t.cardPacks : DEFAULT_PACKS;
  const r = await modal({
    title: 'Vendre ou recharger une carte', ok: 'Encaisser et créditer',
    body: html`<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${packs.map((p, i) => html`<label class="tile"><input type="radio" name="pack" value="${i}" ${i === Math.min(1, packs.length - 1) ? raw('checked') : ''}><b style="font-size:1.6rem">${euros(p.price)}</b><small>${p.points} points${p.points > p.price ? ` (+${p.points - p.price} offerts)` : ''}</small></label>`)}</div>
      <div class="grid2"><label class="f">Code d’une carte existante <span class="hint">vide = nouvelle carte</span><input type="text" name="code" value="${presetCode}" inputmode="numeric" maxlength="6" autocomplete="off"></label>
      <label class="f">Prénom <span class="hint">facultatif</span><input type="text" name="name" maxlength="40" autocomplete="off"></label></div>
      <button type="button" class="btn ghost sm" data-scan>📷 Scanner une carte</button>
      <label class="f">Paiement<select name="method"><option value="cash">Espèces</option><option value="card">Carte bancaire (TPE)</option><option value="lydia">Lydia / Wero</option><option value="free">Offerte (bénévole)</option></select></label>`,
    onOpen(d) { d.querySelector('[data-scan]').onclick = async () => { const c = await scanCard(); if (c) d.querySelector('input[name=code]').value = c; }; },
  });
  if (!r) return;
  const pack = packs[+r.pack] || packs[0];
  if (r.method === 'card') {
    const ok = await modal({ title: 'Paiement par carte bancaire', body: html`<p style="text-align:center;margin:0">Tapez sur le TPE :</p><p class="num" style="text-align:center;font-size:4.5rem;margin:0;line-height:1">${euros(pack.price)}</p>`, ok: 'Paiement accepté', cancel: 'Paiement refusé / annulé' });
    if (!ok) return;
  }
  try {
    const c = await store.card(t.id, 'issue', { code: r.code.replace(/\D/g, '') || undefined, price: pack.price, points: pack.points, method: r.method, name: r.name, sid: `top-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` }, pin);
    rememberCard(t.id, c);
    await showCard(t, c);
    ctx.rerender();
  } catch (e) { toast(e.message, 'err'); }
}

/** Affiche une carte à points : solde, QR à scanner par le joueur, code à noter. */
export function showCard(t, c, title) {
  return modal({ title: title || `Carte ${c.code}${c.name ? ` · ${c.name}` : ''}`, ok: 'Terminé', cancel: '',
    body: html`<p class="num" style="text-align:center;font-size:3rem;margin:0;line-height:1">${c.balance} points</p>
      <div class="qrbox"><div class="qr" style="width:220px">${qrSvg(cardUrl(t, c))}</div>
      <p style="margin:0">Le capitaine (ou le joueur) <b>scanne ce QR</b> : la carte s’ouvre sur son téléphone, avec le solde à jour.</p>
      <p class="small muted" style="margin:0">Sans téléphone : notez le code <b class="num" style="font-size:1.3rem;color:var(--ink)">${c.code}</b> sur une carte papier.</p></div>` });
}

export async function caisseView(ctx) {
  const { t } = ctx;
  const pinKey = `rot:barpin:${t.id}`;
  const pin = sessionStorage.getItem(pinKey) || '';
  const isAdmin = store.isAdmin(t) && store.mode === 'server' ? true : store.mode === 'local';
  if (!isAdmin && !pin) {
    return {
      title: 'Caisse buvette',
      html: html`<main class="wrap narrow"><form class="card stack" id="barlogin" style="max-width:420px;margin:2rem auto"><h2>Caisse de la buvette</h2><p>${t.name}</p>
        <label class="f">Code buvette ou bénévole<input type="text" name="pin" inputmode="numeric" required autofocus></label><button class="btn">Ouvrir la caisse</button></form></main>`,
      mount(root) { $('#barlogin', root).addEventListener('submit', (e) => { e.preventDefault(); sessionStorage.setItem(pinKey, e.target.pin.value.trim()); ctx.rerender(); }); },
    };
  }
  const cardsOn = t.pointsCards !== false;
  const methods = Object.fromEntries(Object.entries(PAY_METHODS).filter(([k]) => k !== 'points' || cardsOn));
  if (!method || !methods[method]) method = cardsOn ? 'points' : 'cash';
  const prods = (t.buvette || []).filter((p) => p.id && p.name && p.active !== false);
  const st = t.sales ? buvetteStats(t) : null;
  const left = Object.fromEntries((st?.stock || []).map((p) => [p.id, p.left]));
  const total = Object.entries(cart).reduce((a, [pid, q]) => a + q * (+prods.find((p) => p.id === pid)?.price || 0), 0);
  const pts = Object.entries(cart).reduce((a, [pid, q]) => a + q * productPoints(prods.find((p) => p.id === pid)), 0);
  const any = Object.values(cart).some(Boolean);
  const cats = [...new Set(prods.map((p) => p.category || 'Autre'))];
  const recent = (t.sales || []).filter((s) => !s.cancelled).slice(-6).reverse();
  const payLabel = method === 'points' ? `Débiter ${pts} pt${pts > 1 ? 's' : ''}` : `Encaisser ${euros(total)}`;
  return {
    title: 'Caisse buvette',
    html: html`<header class="topbar"><div class="in"><a class="brand" href="#/admin/${t.id}/buvette">${logo}<span>Buvette</span></a><span class="tname">${t.name}</span><span class="spacer"></span>
      ${cardsOn ? html`<button class="btn ball sm" data-act="sell-card">💳 Vendre / recharger une carte</button><button class="btn ghost sm" data-act="check-card">Solde d’une carte</button>` : ''}
      ${store.pending.filter((p) => p.kind === 'sale').length ? html`<span class="net off"><i></i>${store.pending.filter((p) => p.kind === 'sale').length} en attente de réseau</span>` : ''}</div></header>
    <main class="pos">
      <section class="pos-grid">${cats.map((c) => html`<h3 class="pos-cat">${c}</h3>${prods.filter((p) => (p.category || 'Autre') === c).map((p) => {
        const l = left[p.id];
        const out = l != null && l <= (cart[p.id] || 0);
        return html`<button class="pos-item" style="--c:${CAT_COLORS[p.category] || CAT_COLORS.Autre}" data-add="${p.id}" ${out ? raw('disabled') : ''}>
          ${cart[p.id] ? html`<span class="pos-q">${cart[p.id]}</span>` : ''}<b>${p.name}</b><span>${cardsOn ? html`<span class="pos-pts">${productPoints(p)} pt${productPoints(p) > 1 ? 's' : ''}</span> · ` : ''}${euros(p.price)}</span>${l != null ? html`<small>${out ? 'Épuisé' : `Reste ${l - (cart[p.id] || 0)}`}</small>` : ''}</button>`;
      })}`)}${!prods.length ? html`<div class="empty">Aucun produit. Ajoutez la carte dans l’administration (onglet Buvette).</div>` : ''}</section>
      <aside class="pos-cart card">
        <h3>Panier</h3>
        <div class="stack" style="gap:.4rem">${Object.entries(cart).filter(([, q]) => q).map(([pid, q]) => { const p = prods.find((x) => x.id === pid); return p ? html`<div class="row between"><span>${q} × ${p.name}</span><span class="row"><b>${method === 'points' ? `${q * productPoints(p)} pt${q * productPoints(p) > 1 ? 's' : ''}` : euros(q * p.price)}</b><button class="btn danger sm icon" data-rm="${pid}" aria-label="Retirer un ${p.name}">−</button></span></div>` : ''; })}
          ${!any ? html`<p class="muted">Touchez un produit pour l’ajouter.</p>` : ''}</div>
        <div class="row between" style="border-top:1.5px solid var(--line);padding-top:.6rem"><span>Total</span><span class="num" style="font-size:2.4rem">${method === 'points' ? `${pts} pt${pts > 1 ? 's' : ''}` : euros(total)}</span></div>
        ${cardsOn && any ? html`<p class="small muted" style="margin:-.6rem 0 0;text-align:right">soit ${method === 'points' ? euros(total) : `${pts} pts`}</p>` : ''}
        <div class="seg" role="radiogroup" aria-label="Paiement" style="flex-wrap:wrap">${Object.entries(methods).map(([k, l]) => html`<button class="${method === k ? 'on' : ''}" data-method="${k}" role="radio" aria-checked="${method === k}">${l}</button>`)}</div>
        ${method === 'cash' && total ? html`<label class="f">Montant donné (pour calculer le rendu)<input type="number" step="0.5" min="0" id="given" inputmode="decimal"></label><p id="change" class="num" style="font-size:1.4rem;margin:0"></p>` : ''}
        <button class="btn ball block" style="min-height:60px;font-size:1.2rem" data-act="pay" ${any ? '' : raw('disabled')}>${payLabel}</button>
        <button class="linkbtn small" data-act="clear">Vider le panier</button>
        ${recent.length ? html`<div class="stack" style="gap:.3rem;margin-top:.5rem"><b class="small">Dernières opérations</b>${recent.map((s) => html`<div class="row between small"><span>${new Date(s.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${s.kind === 'topup' ? `Carte ${s.card} +${s.points} pts` : s.items.map((i) => `${i.qty} ${i.name}`).join(', ')}</span><span class="row">${s.method === 'points' ? `${s.pts} pts` : euros(s.total)} <button class="linkbtn small" data-cancel="${s.id}">Annuler</button></span></div>`)}</div>` : ''}
      </aside>
    </main>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]'), m = e.target.closest('[data-method]'), act = e.target.closest('[data-act]'), cancel = e.target.closest('[data-cancel]');
        if (add) { cart[add.dataset.add] = (cart[add.dataset.add] || 0) + 1; navigator.vibrate?.(10); ctx.repaint(); }
        if (rm) { cart[rm.dataset.rm] = Math.max(0, (cart[rm.dataset.rm] || 0) - 1); ctx.repaint(); }
        if (m) { method = m.dataset.method; ctx.repaint(); }
        if (act?.dataset.act === 'clear') { cart = {}; ctx.repaint(); }
        if (act?.dataset.act === 'sell-card') return sellCard(ctx, pin);
        if (act?.dataset.act === 'check-card') {
          const code = await askCard(t, { title: 'Solde d’une carte', allowNew: false });
          if (!code) return;
          try { const c = await store.card(t.id, 'lookup', { code }, pin); rememberCard(t.id, c); const again = await modal({ title: `Carte ${c.code}${c.name ? ` · ${c.name}` : ''}`, ok: 'Recharger', cancel: 'Fermer', body: html`<p class="num" style="text-align:center;font-size:3.4rem;margin:0">${c.balance} pts</p>` }); if (again) sellCard(ctx, pin, c.code); }
          catch (err) { toast(err.message, 'err'); }
        }
        if (cancel && (await confirmBox('Annuler cette opération ?', 'Elle sera retirée des comptes ; les points sont rendus (ou retirés pour une recharge).', 'Annuler l’opération'))) {
          try { await store.sale(t.id, { cancel: cancel.dataset.cancel, items: [] }, pin); toast('Opération annulée'); ctx.rerender(); } catch (err) { toast(err.message, 'err'); }
        }
        if (act?.dataset.act === 'pay') {
          const items = Object.entries(cart).filter(([, q]) => q).map(([pid, qty]) => ({ pid, qty }));
          if (!items.length) return;
          if (method === 'points') {
            const code = await askCard(t, { title: 'Paiement par carte à points', total: `${pts} pts` });
            if (!code) return;
            try {
              const r = await store.sale(t.id, { items, method: 'points', card: code }, pin);
              rememberCard(t.id, { code: r.code, name: r.name, balance: r.balance });
              toast(`✓ ${r.name ? `${r.name} : ` : `Carte ${r.code} : `}−${r.pts} pts · reste ${r.balance} pts`, 'ok');
              navigator.vibrate?.([30, 40, 30]);
              cart = {}; ctx.rerender();
            } catch (err) {
              if (err.status === 409) { const top = await modal({ title: 'Solde insuffisant', body: html`<p style="margin:0">${err.message}.</p>`, ok: 'Recharger la carte', cancel: 'Fermer' }); if (top) sellCard(ctx, pin, code); }
              else toast(err.message, 'err');
              if (err.status === 403) { sessionStorage.removeItem(pinKey); ctx.rerender(); }
            }
            return;
          }
          if (method === 'card') {
            const ok = await modal({ title: 'Paiement par carte', body: html`<p style="text-align:center;margin:0">Tapez sur le TPE :</p><p class="num" style="text-align:center;font-size:4.5rem;margin:0;line-height:1">${euros(total)}</p><p class="hint" style="text-align:center;margin:0">Validez ici une fois le ticket du TPE accepté.</p>`, ok: 'Paiement accepté', cancel: 'Paiement refusé / annulé' });
            if (!ok) return;
          }
          act.disabled = true;
          try {
            const r = await store.sale(t.id, { items, method, by: store.role(t.id)?.name || '' }, pin);
            toast(r?.queued ? `Vente enregistrée hors ligne (${euros(total)})` : `Encaissé : ${euros(total)} ✓`, r?.queued ? '' : 'ok');
            cart = {};
            ctx.rerender();
          } catch (err) { toast(err.message, 'err'); act.disabled = false; if (err.status === 403) { sessionStorage.removeItem(pinKey); ctx.rerender(); } }
        }
      });
      root.addEventListener('input', (e) => {
        if (e.target.id !== 'given') return;
        const g = +e.target.value || 0;
        $('#change', root).textContent = g ? (g >= total ? `À rendre : ${euros(g - total)}` : `Manque ${euros(total - g)}`) : '';
      });
    },
  };
}

// ------------------------------------------------------------------ carte virtuelle du joueur
export async function carteView(ctx) {
  const { t } = ctx;
  const code = ctx.route.params[1];
  const key = ctx.route.query.k || (() => { try { return JSON.parse(localStorage.getItem(`rot:card:${t.id}`))?.key; } catch { return ''; } })();
  let c = null, err = '';
  try { c = await store.myCard(t.id, code, key); } catch (e) { err = e.message; }
  if (c) try { localStorage.setItem(`rot:card:${t.id}`, JSON.stringify({ code, key })); } catch { /* */ }
  return {
    title: `Carte buvette ${code}`,
    html: html`<main class="sheet" style="max-width:460px">
      ${err ? html`<div class="empty">${err}</div>` : html`<div class="card stack dark" style="background:var(--ink);color:#fff;text-align:center">
        <span class="small" style="opacity:.8">${t.name} · carte buvette${c.name ? ` de ${c.name}` : ''}</span>
        <div class="num" style="font-size:5rem;line-height:1;color:var(--ball)">${c.balance}</div><b>points</b>
        <div class="qr" style="width:210px;margin:0 auto;background:#fff;padding:8px;border-radius:12px">${qrSvg(`${store.baseUrl()}#/carte/${t.id}/${code}?k=${key}`)}</div>
        <span>Montrez ce QR à la buvette, ou donnez le code <b class="num" style="font-size:1.6rem;color:var(--ball)">${code}</b></span></div>
      <div class="card"><h3>Historique</h3>${c.ops.length ? html`<table class="t"><tbody>${c.ops.map((o) => html`<tr><td class="small muted">${new Date(o.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td><td>${o.label}</td><td class="n num" style="color:${o.delta > 0 ? 'var(--win)' : 'var(--loss)'}">${o.delta > 0 ? '+' : ''}${o.delta}</td></tr>`)}</tbody></table>` : html`<p class="muted" style="margin:0">Pas encore d’achat.</p>`}</div>
      <p class="small muted" style="text-align:center">Astuce : ajoutez cette page à l’écran d’accueil pour retrouver votre carte. <a href="#/t/${t.id}/buvette">Voir la carte de la buvette</a></p>`}
    </main>`,
  };
}

// ------------------------------------------------------------------ admin : buvette
export function adminBuvette(ctx) {
  const { t } = ctx;
  const st = buvetteStats(t);
  const base = store.baseUrl();
  return html`<div class="stack">
    <div class="row between"><h2 style="margin:0">Buvette</h2><div class="row"><a class="btn ball" href="#/caisse/${t.id}" target="_blank">Ouvrir la caisse</a><button class="btn ghost" data-act="export-sales">Exporter les ventes</button></div></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${euros(st.revenue)}</div><div class="l">chiffre d’affaires · ${plural(st.sales, 'vente')}</div></div>
      <div class="kpi"><div class="v">${euros(st.margin)}</div><div class="l">bénéfice (prix d’achat déduit)</div></div>
      <div class="kpi"><div class="v">${euros(st.cash)}</div><div class="l">attendus dans la caisse (fond ${euros(t.cashFund || 0)} + espèces)</div></div>
      <div class="kpi"><div class="v">${st.count}</div><div class="l">articles vendus${st.offered ? ` · ${euros(st.offered)} offerts` : ''}</div></div>
    </div>
    ${st.stock.some((p) => p.low) ? html`<div class="next-step"><b>Stock bas :</b> ${st.stock.filter((p) => p.low).map((p) => `${p.name} (${p.left})`).join(', ')}</div>` : ''}
    <div class="card tscroll"><div class="row between"><h3 style="margin:0">Carte et stock</h3><button class="btn ghost sm" data-act="add-buvette">Ajouter un produit</button></div>
      <table class="t" style="margin-top:.5rem"><thead><tr><th>Produit</th><th>Catégorie</th><th class="n">Prix de vente</th>${t.pointsCards !== false ? html`<th class="n">Points</th>` : ''}<th class="n">Prix d’achat</th><th class="n">Stock de départ</th><th class="n">Vendus</th><th class="n">Reste</th><th class="n">CA</th>${t.lastYear ? html`<th class="n" title="Vendus la dernière fois">${t.lastYear.label}</th>` : ''}<th>En vente</th><th></th></tr></thead>
      <tbody>${(t.buvette || []).map((p, i) => { const s = st.stock[i] || {}; return html`<tr>
        <td><input type="text" data-path="buvette.${i}.name" value="${p.name}" style="min-width:140px"></td>
        <td><select data-path="buvette.${i}.category">${CATS.map((c) => html`<option ${p.category === c ? raw('selected') : ''}>${c}</option>`)}</select></td>
        <td><input type="number" step="0.1" min="0" data-type="num" data-path="buvette.${i}.price" value="${p.price}" style="width:90px"></td>
        ${t.pointsCards !== false ? html`<td><input type="number" step="1" min="0" data-type="nullnum" data-path="buvette.${i}.points" value="${p.points ?? ''}" placeholder="${productPoints({ price: p.price })}" style="width:70px" title="Vide = arrondi du prix"></td>` : ''}
        <td><input type="number" step="0.01" min="0" data-type="num" data-path="buvette.${i}.cost" value="${p.cost || ''}" placeholder="${productCost(t, { ...p, cost: 0 }).toFixed(2)}" style="width:90px" title="Vide = calculé depuis la recette"></td>
        <td><input type="number" step="1" min="0" data-type="nullnum" data-path="buvette.${i}.stock" value="${p.stock ?? ''}" style="width:90px" placeholder="∞"></td>
        <td class="n">${s.sold || 0}</td><td class="n" style="${s.low ? 'color:var(--loss);font-weight:700' : ''}">${s.left ?? '∞'}</td><td class="n">${euros(st.top.find((x) => x.pid === p.id)?.revenue || 0)}</td>${t.lastYear ? html`<td class="n muted">${t.lastYear.sold?.[p.id] ?? '—'}</td>` : ''}
        <td><input type="checkbox" data-path="buvette.${i}.active" ${p.active !== false ? raw('checked') : ''} aria-label="En vente"></td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn ghost sm" data-act="recipe" data-i="${i}">Recette${p.recipe?.length ? ` (${p.recipe.length})` : ''}</button><button class="btn danger sm" data-act="rm-buvette" data-i="${i}" aria-label="Supprimer">✕</button></div></td></tr>`; })}</tbody></table></div>
    ${cardsCard(t)}
    ${ingredientsCard(t)}
    <div class="grid2">
      <div class="card"><h3>Par moyen de paiement</h3><table class="t"><tbody>${Object.entries(PAY_METHODS).map(([k, l]) => html`<tr><td>${l}</td><td class="n">${euros(st.byMethod[k] || 0)}</td></tr>`)}</tbody></table></div>
      <div class="card"><h3>Meilleures ventes</h3>${st.top.length ? html`<ol style="margin:0;padding-left:1.2rem">${st.top.slice(0, 6).map((p) => html`<li>${p.name} <span class="muted">· ${p.qty} vendus · ${euros(p.revenue)}</span></li>`)}</ol>` : html`<p class="muted">Pas encore de vente.</p>`}</div>
    </div>
    <div class="grid2">
      <form class="card stack" onsubmit="return false"><h3>Caisse</h3>
        <label class="f">Fond de caisse au départ (€)<input type="number" step="0.5" min="0" data-type="num" data-path="cashFund" value="${t.cashFund || 0}"></label>
        <label class="f">Code buvette <span class="hint">Pour les bénévoles qui tiennent la caisse (le code bénévole marche aussi)</span><input type="text" data-path="buvettePin" value="${t.buvettePin || ''}" inputmode="numeric" maxlength="8"></label>
        ${t.charity?.enabled ? html`<label class="check"><input type="checkbox" data-path="charity.includeBuvette" ${t.charity.includeBuvette ? raw('checked') : ''}> Reverser la buvette à la cagnotte (${t.charity.label})</label>` : ''}
      </form>
      <div class="card qrbox"><h3>Caisse sur téléphone ou tablette</h3><div class="qr">${qrSvg(`${base}#/caisse/${t.id}`)}</div><span class="hint">Scannez, puis saisissez le code buvette.</span></div>
    </div>
  </div>`;
}

function cardsCard(t) {
  const on = t.pointsCards !== false;
  const packs = t.cardPacks?.length ? t.cardPacks : DEFAULT_PACKS;
  const cs = cardsSummary(t);
  const cards = (t.cards || []).filter((c) => c.ops?.length).sort((a, b) => b.balance - a.balance);
  return html`<div class="card stack"><div class="row between"><div><h3 style="margin:0">Cartes à points</h3><p class="hint" style="margin:0">Le joueur achète une carte (ex. 10 € = 12 points) puis paie en points : pas de monnaie à rendre, file d’attente plus rapide.</p></div>
      <label class="check"><input type="checkbox" data-path="pointsCards" ${on ? raw('checked') : ''}> Activer</label></div>
    ${on ? html`
      <div class="kpis"><div class="kpi"><div class="v">${cs.count}</div><div class="l">cartes vendues${cs.blank ? ` · ${cs.blank} vierges` : ''}</div></div><div class="kpi"><div class="v">${euros(cs.money)}</div><div class="l">encaissés en cartes</div></div>
        <div class="kpi"><div class="v">${cs.used}</div><div class="l">points dépensés sur ${cs.issued}</div></div><div class="kpi"><div class="v">${cs.left}</div><div class="l">points restants sur les cartes</div></div></div>
      <div class="stack" style="gap:.5rem"><b class="small">Formules proposées</b>
        ${packs.map((p, i) => html`<div class="row"><input type="number" min="1" step="1" data-type="num" data-path="cardPacks.${i}.price" value="${p.price}" style="width:90px" aria-label="Prix"> € =<input type="number" min="1" step="1" data-type="num" data-path="cardPacks.${i}.points" value="${p.points}" style="width:90px" aria-label="Points"> points<button class="btn danger sm" data-act="rm-pack" data-i="${i}" aria-label="Supprimer">✕</button></div>`)}
        <div><button class="btn ghost sm" data-act="add-pack">Ajouter une formule</button></div></div>
      <div class="row"><button class="btn ghost" data-act="blank-cards">Préparer 30 cartes papier à imprimer</button>${(t.cards || []).some((c) => !c.ops?.length) ? html`<a class="btn ghost" href="#/print/${t.id}/cartes" target="_blank">Imprimer les cartes vierges</a>` : ''}</div>
      ${cards.length ? html`<details><summary class="small">Voir les ${cards.length} cartes en circulation</summary><table class="t"><thead><tr><th>Code</th><th>Prénom</th><th class="n">Solde</th><th>Dernière opération</th></tr></thead><tbody>${cards.map((c) => html`<tr><td class="num">${c.code}</td><td>${c.name || '—'}</td><td class="n num">${c.balance}</td><td class="small muted">${c.ops.at(-1)?.label || ''}</td></tr>`)}</tbody></table></details>` : ''}`
    : ''}
  </div>`;
}

function ingredientsCard(t) {
  const ing = ingredientStats(t);
  return html`<div class="card tscroll"><div class="row between"><div><h3 style="margin:0">Matières premières</h3><p class="hint" style="margin:0">Consommation calculée : ventes × recettes. La suggestion = consommé + 10 %, pour vos achats de l’an prochain.</p></div>
    <div class="row"><button class="btn ghost sm" data-act="add-ing">Ajouter un ingrédient</button><button class="btn ghost sm" data-act="import-bar">Reprendre un autre tournoi</button><button class="btn ghost sm" data-act="export-ing">Liste d’achats</button></div></div>
    ${ing.length ? html`<table class="t" style="margin-top:.5rem"><thead><tr><th>Ingrédient</th><th>Unité</th><th class="n">Acheté</th><th class="n">Prix / unité</th><th class="n">Consommé</th><th class="n">Reste</th>${t.lastYear ? html`<th class="n">${t.lastYear.label}</th>` : ''}<th class="n">À prévoir</th><th></th></tr></thead>
    <tbody>${ing.map((x, i) => html`<tr>
      <td><input type="text" data-path="ingredients.${i}.name" value="${x.name}" style="min-width:130px"></td>
      <td><input type="text" data-path="ingredients.${i}.unit" value="${x.unit}" style="width:90px" placeholder="tranche, kg…"></td>
      <td><input type="number" step="any" min="0" data-type="nullnum" data-path="ingredients.${i}.bought" value="${x.bought ?? ''}" style="width:90px"></td>
      <td><input type="number" step="0.01" min="0" data-type="num" data-path="ingredients.${i}.price" value="${x.price || ''}" style="width:90px"></td>
      <td class="n">${x.used}</td><td class="n" style="${x.low ? 'color:var(--loss);font-weight:700' : ''}">${x.left ?? '—'}</td>${t.lastYear ? html`<td class="n muted">${x.last ?? '—'}</td>` : ''}<td class="n"><b>${x.suggest}</b></td>
      <td><button class="btn danger sm" data-act="rm-ing" data-i="${i}" aria-label="Supprimer">✕</button></td></tr>`)}</tbody></table>`
    : html`<p class="muted" style="margin:.5rem 0 0">Ajoutez pain, jambon, fromage… puis la recette de chaque produit : la consommation se calcule toute seule.</p>`}
  </div>`;
}

export function salesCsv(t) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Heure', 'Produits', 'Total', 'Paiement', 'Annulée']];
  for (const s of t.sales || []) rows.push([new Date(s.at).toLocaleString('fr-FR'), s.items.map((i) => `${i.qty} × ${i.name} (${i.price} €)`).join(' + '), String(s.total).replace('.', ','), PAY_METHODS[s.method] || s.method, s.cancelled ? 'oui' : '']);
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

// ------------------------------------------------------------------ admin : cagnotte
export function adminCagnotte(ctx) {
  const { t } = ctx;
  const c = t.charity || {};
  if (!c.enabled) return html`<div class="empty"><h2>Tournoi solidaire ?</h2><p>Activez la cagnotte pour afficher en direct les dons, les paliers et le défi « chaque point compte ».</p><label class="check" style="justify-content:center"><input type="checkbox" data-path="charity.enabled"> Activer la cagnotte</label></div>`;
  const x = charityTotals(t);
  const fs = feesSummary(t);
  const pending = (c.donations || []).filter((d) => !d.validated && !d.rejected);
  return html`<div class="stack">
    <div class="row between"><h2 style="margin:0">Cagnotte ${c.label}</h2><a class="btn ghost" href="#/live/${t.id}" target="_blank">Voir sur le grand écran</a></div>
    <div class="kpis">
      <div class="kpi" style="background:var(--ink);color:#fff"><div class="v" style="color:var(--ball)">${euros(x.total)}</div><div class="l" style="color:#fff;opacity:.8">${x.goal ? `${Math.round(x.pct)} % de l’objectif (${euros(x.goal)})` : 'collectés'}</div></div>
      <div class="kpi"><div class="v">${euros(x.don)}</div><div class="l">dons validés${x.pending ? ` · ${x.pending} à vérifier` : ''}</div></div>
      ${c.includeFees ? html`<div class="kpi"><div class="v">${euros(x.fees)}</div><div class="l">inscriptions encaissées</div></div>` : ''}
      ${c.includeBuvette ? html`<div class="kpi"><div class="v">${euros(x.bar)}</div><div class="l">buvette (${c.buvetteMode === 'revenue' ? 'recette' : 'bénéfice'})</div></div>` : ''}
      ${x.pledgeOn ? html`<div class="kpi"><div class="v">${euros(x.pledge)}</div><div class="l">${x.points} points × ${euros(c.pointPledge)}</div></div>` : ''}
    </div>
    ${pending.length ? html`<div class="card stack"><h3 style="margin:0">Dons à vérifier</h3>${pending.map((d) => html`<div class="row between" data-don="${d.id}"><span><b>${d.name}</b> · ${euros(d.amount)} · ${({ online: 'en ligne', cash: 'espèces', card: 'carte', lydia: 'Lydia' })[d.method] || ''}${d.message ? html` · <i>« ${d.message} »</i>` : ''}</span><span class="row"><button class="btn sm" data-act="don-ok">Valider</button><button class="btn danger sm" data-act="don-no">Refuser</button></span></div>`)}</div>` : ''}
    <div class="grid2">
      <form class="card stack" onsubmit="return false"><h3>Sources de la cagnotte</h3>
        <div class="grid2"><label class="f">Objectif (€)<input type="number" min="0" data-type="num" data-path="charity.goal" value="${c.goal}"></label>
        <label class="f">Déjà collecté avant (€)<input type="number" min="0" data-type="num" data-path="charity.raised" value="${c.raised}"></label></div>
        <label class="check"><input type="checkbox" data-path="charity.includeFees" ${c.includeFees ? raw('checked') : ''}> Inscriptions encaissées (${euros(fs.paid)} sur ${euros(fs.due)})</label>
        <label class="check"><input type="checkbox" data-path="charity.includeBuvette" ${c.includeBuvette ? raw('checked') : ''}> Buvette</label>
        ${c.includeBuvette ? html`<label class="f">Compter pour la buvette<select data-path="charity.buvetteMode"><option value="margin" ${c.buvetteMode !== 'revenue' ? raw('selected') : ''}>Le bénéfice (recette − achats)</option><option value="revenue" ${c.buvetteMode === 'revenue' ? raw('selected') : ''}>Toute la recette (produits offerts)</option></select></label>` : ''}
        ${donSettings(t)}
      </form>
      <form class="card stack" onsubmit="return false"><h3>Fil rouge de la soirée</h3>
        <label class="check"><input type="checkbox" data-path="charity.filRouge" ${filRougeOn(c) ? raw('checked') : ''}> <span><b>Activer un fil rouge</b> <span class="hint">(facultatif : rien ne s’affiche s’il n’est pas coché)</span></span></label>
        ${filRougeOn(c) ? html`
        <p class="hint" style="margin:0"><b>Chaque point compte :</b> un partenaire (ou le club) s’engage à verser une somme par point marqué. Le compteur tourne en direct sur le grand écran à chaque point saisi.</p>
        <div class="grid2"><label class="f">€ par point marqué<input type="number" min="0" step="0.01" data-type="num" data-path="charity.pointPledge" value="${c.pointPledge || 0}"></label>
        <label class="f">Plafond (€, facultatif)<input type="number" min="0" data-type="num" data-path="charity.pledgeCap" value="${c.pledgeCap || ''}"></label></div>
        <label class="f">Offert par<input type="text" data-path="charity.pledgeSponsor" value="${c.pledgeSponsor || ''}" placeholder="Nom du partenaire"></label>
        <p class="hint" style="margin:0"><b>Paliers et défis :</b> à chaque montant atteint, un défi se débloque à l’écran (l’arbitre en tutu, le président au service…).</p>
        ${(c.milestones || []).map((m, i) => html`<div class="row"><input type="number" min="0" data-type="num" data-path="charity.milestones.${i}.amount" value="${m.amount}" style="width:110px" aria-label="Montant"> €<input type="text" data-path="charity.milestones.${i}.label" value="${m.label}" style="flex:1" aria-label="Défi"><button class="btn danger sm" data-act="rm-mile" data-i="${i}">✕</button></div>`)}
        <div><button class="btn ghost sm" data-act="add-mile">Ajouter un palier</button></div>
      ` : ''}
      </form>
    </div>
    <div class="card stack"><div class="row between"><h3 style="margin:0">Dons</h3><button class="btn sm" data-act="add-don">Ajouter un don (urne, chèque…)</button></div>
      ${(c.donations || []).filter((d) => d.validated).length ? html`<table class="t"><tbody>${(c.donations || []).filter((d) => d.validated).slice().reverse().map((d) => html`<tr data-don="${d.id}"><td>${new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td><td><b>${d.name}</b>${d.anonymous ? ' (anonyme à l’écran)' : ''}${d.message ? html`<br><span class="hint">« ${d.message} »</span>` : ''}</td><td class="n">${euros(d.amount)}</td><td><button class="btn danger sm" data-act="don-del" aria-label="Supprimer">✕</button></td></tr>`)}</tbody></table>` : html`<p class="muted" style="margin:0">Aucun don enregistré pour l’instant.</p>`}
    </div>
  </div>`;
}

/** Actions admin buvette/cagnotte ; renvoie true si gérée. */
export async function barActions(ctx, act, b, save) {
  const { t } = ctx;
  const did = b.closest('[data-don]')?.dataset.don;
  switch (act) {
    case 'add-buvette': await save((d) => { (d.buvette ??= []).push({ id: uid(5), name: '', price: 1, cost: 0, stock: null, category: 'Boissons', active: true }); }); return true;
    case 'rm-buvette': await save((d) => { d.buvette.splice(+b.dataset.i, 1); }); return true;
    case 'export-sales': download(`${t.id}-buvette.csv`, salesCsv(t), 'text/csv;charset=utf-8'); return true;
    case 'add-pack': await save((d) => { d.cardPacks = [...(d.cardPacks?.length ? d.cardPacks : DEFAULT_PACKS), { price: 15, points: 18 }]; }); return true;
    case 'rm-pack': await save((d) => { d.cardPacks = (d.cardPacks?.length ? d.cardPacks : DEFAULT_PACKS).filter((_, i) => i !== +b.dataset.i); }); return true;
    case 'blank-cards':
      try { await store.card(t.id, 'blank', { n: 30 }); toast('30 cartes prêtes : imprimez-les', 'ok'); location.hash = `#/print/${t.id}/cartes`; } catch (e) { toast(e.message, 'err'); }
      return true;
    case 'add-ing': await save((d) => { (d.ingredients ??= []).push({ id: uid(5), name: '', unit: 'pièce', bought: null, price: 0 }); }); return true;
    case 'rm-ing': await save((d) => { d.ingredients.splice(+b.dataset.i, 1); }); return true;
    case 'export-ing': {
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Ingrédient', 'Unité', 'Acheté', 'Consommé', 'Reste', 'À prévoir la prochaine fois']].concat(ingredientStats(t).map((x) => [x.name, x.unit, x.bought ?? '', x.used, x.left ?? '', x.suggest]));
      download(`${t.id}-achats.csv`, '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
      return true;
    }
    case 'recipe': {
      const i = +b.dataset.i;
      const p = t.buvette[i];
      const ings = t.ingredients || [];
      if (!ings.length) { toast('Ajoutez d’abord des ingrédients (tableau Matières premières)', 'err'); return true; }
      const cur = Object.fromEntries((p.recipe || []).map((r) => [r.iid, r.qty]));
      const r = await modal({ title: `Recette : ${p.name || 'produit'}`, body: html`<p class="hint" style="margin:0">Quantité de chaque ingrédient pour <b>un</b> produit vendu (ex. 0,33 baguette, 2 tranches).</p>
        ${ings.map((x) => html`<label class="row between"><span>${x.name} <span class="muted small">(${x.unit})</span></span><input type="number" step="any" min="0" name="q_${x.id}" value="${cur[x.id] ?? ''}" style="width:110px"></label>`)}`, ok: 'Enregistrer la recette' });
      if (!r) return true;
      await save((d) => { d.buvette[i].recipe = ings.map((x) => ({ iid: x.id, qty: +r[`q_${x.id}`] || 0 })).filter((x) => x.qty > 0); }, 'Recette enregistrée');
      return true;
    }
    case 'import-bar': {
      const list = (await store.list()).filter((x) => x.id !== t.id);
      if (!list.length) { toast('Aucun autre tournoi enregistré', 'err'); return true; }
      const r = await modal({ title: 'Reprendre la buvette d’un autre tournoi', body: html`<label class="f">Tournoi<select name="src">${list.map((x) => html`<option value="${x.id}">${x.name} (${x.date || ''})</option>`)}</select></label>
        <p class="hint" style="margin:0">La carte, les recettes et les ingrédients sont copiés. Les ventes et consommations de ce tournoi s’affichent en colonne de comparaison pour ajuster vos achats.</p>`, ok: 'Reprendre' });
      if (!r) return true;
      const src = await store.get(r.src);
      if (!src) return true;
      const ist = ingredientStats(src);
      const sold = {};
      for (const sx of (src.sales || []).filter((x) => !x.cancelled)) for (const it of sx.items) sold[it.pid] = (sold[it.pid] || 0) + it.qty;
      await save((d) => {
        d.buvette = structuredClone(src.buvette || []).map((p) => ({ ...p, stock: null }));
        d.ingredients = structuredClone(src.ingredients || []).map((x) => ({ ...x, bought: ist.find((y) => y.id === x.id)?.suggest ?? null }));
        d.lastYear = { label: (src.date || '').slice(0, 4) || 'Avant', name: src.name, sold, consumed: Object.fromEntries(ist.map((x) => [x.id, x.used])) };
      }, 'Buvette reprise : quantités d’achat pré-remplies');
      return true;
    }
    case 'add-mile': await save((d) => { (d.charity.milestones ??= []).push({ amount: (d.charity.milestones?.at(-1)?.amount || 0) + 250, label: 'Nouveau défi' }); }); return true;
    case 'rm-mile': await save((d) => { d.charity.milestones.splice(+b.dataset.i, 1); }); return true;
    case 'don-ok': await save((d) => { const x = d.charity.donations.find((y) => y.id === did); x.validated = true; }, 'Don validé'); return true;
    case 'don-no': await save((d) => { const x = d.charity.donations.find((y) => y.id === did); x.rejected = true; }); return true;
    case 'don-del':
      if (!(await confirmBox('Supprimer ce don ?', 'Il sera retiré du total de la cagnotte.', 'Supprimer'))) return true;
      await save((d) => { d.charity.donations = d.charity.donations.filter((y) => y.id !== did); }); return true;
    case 'add-don': {
      const r = await modal({ title: 'Ajouter un don', body: html`<div class="grid2"><label class="f">Donateur<input type="text" name="name" required maxlength="60"></label><label class="f">Montant (€)<input type="number" name="amount" min="0.5" step="0.5" required></label></div>
        <label class="f">Moyen<select name="method"><option value="cash">Espèces (urne)</option><option value="check">Chèque</option><option value="card">Carte</option><option value="online">En ligne</option><option value="lydia">Lydia / Wero</option></select></label>
        <label class="f">Message pour l’écran<input type="text" name="message" maxlength="140"></label><label class="check"><input type="checkbox" name="anonymous"> Anonyme à l’écran</label>`, ok: 'Ajouter' });
      if (!r) return true;
      await save((d) => { (d.charity.donations ??= []).push({ id: uid(6), name: r.name, amount: +r.amount, method: r.method, message: r.message, anonymous: r.anonymous, at: new Date().toISOString(), validated: true }); }, 'Don ajouté');
      return true;
    }
    default: return false;
  }
}
