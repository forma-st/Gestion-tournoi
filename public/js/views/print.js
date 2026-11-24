import { store } from '../store.js';
import { html, raw, fmtDate, sides, matchTime, teamName, sportOf, qrSvg, phaseLabel } from '../ui.js';
import { scoringFor, slotTime } from '../engine.js';
import { rankingsView } from './components.js';

export async function view(ctx) {
  const { t } = ctx;
  const kind = ctx.route.params[1] || 'qr';
  const base = store.baseUrl();
  const admin = store.isAdmin(t);
  const bar = html`<div class="noprint row between" style="padding:16px;max-width:1000px;margin:0 auto"><a href="#/admin/${t.id}">← Retour</a><button class="btn" onclick="window.print()">Imprimer</button></div>`;
  let body;
  if (!admin && kind !== 'classement' && kind !== 'planning') body = html`<p class="wrap">Réservé à l’organisation.</p>`;
  else if (kind === 'qr') {
    body = html`${t.courts.filter((c) => c.active !== false).map((c) => {
      const sp = sportOf(c);
      const sc = c.scoring || t.scoring;
      return html`<section class="poster page" style="--c:${c.color}">
        <h1>${c.name}</h1><div style="font-size:2.4rem;font-weight:700">${sp.icon} ${sp.label}</div>
        <div class="qr">${qrSvg(`${base}#/court/${t.id}/${c.id}?k=${c.token}`)}</div>
        <div style="font-size:1.6rem;font-weight:600">Scannez pour ouvrir la feuille de match de ce terrain</div>
        <div style="font-size:1.2rem">${sc.mode === 'time' ? `Matchs de ${sc.durationMin} minutes` : `Sets de ${sc.pointsPerSet} points${sc.setsToWin > 1 ? `, ${sc.setsToWin} sets gagnants` : ''}`} · ${t.name}</div>
      </section>`;
    })}
    <section class="poster page" style="--c:var(--ink)"><h1>${t.name}</h1><div style="font-size:2rem;font-weight:700">Vos matchs, les classements, les infos</div>
      <div class="qr">${qrSvg(`${base}#/t/${t.id}`)}</div><div style="font-size:1.5rem">Scannez pour suivre le tournoi sur votre téléphone</div></section>`;
  } else if (kind === 'feuilles') {
    const ms = t.matches.filter((m) => m.status !== 'bye' && m.slot != null).sort((a, b) => a.slot - b.slot);
    body = html`<div style="max-width:1000px;margin:0 auto;padding:0 16px"><h2>${t.name} : feuilles de match</h2>${ms.map((m) => {
      const s = sides(t, m, ctx.resolved);
      const c = t.courts.find((x) => x.id === m.courtId);
      const sc = scoringFor(t, m);
      const n = sc.mode === 'time' ? 1 : sc.setsToWin * 2 - 1;
      return html`<div class="papersheet"><div>
        <div class="row between"><b style="font-size:1.2rem">${matchTime(t, m)} · ${c?.name} ${sportOf(c).icon}</b><span>${phaseLabel(t, m)}${m.referee ? ` · Arbitre : ${teamName(t, m.referee)}` : ''}</span></div>
        <table style="margin-top:.5rem"><thead><tr><th style="width:40%">Équipe</th>${Array.from({ length: n }, (_, i) => html`<th>${sc.mode === 'time' ? 'Score' : `Set ${i + 1}`}</th>`)}<th>Signature</th></tr></thead>
        <tbody><tr><td style="text-align:left">${s.nameA}</td>${Array.from({ length: n }, () => html`<td></td>`)}<td></td></tr><tr><td style="text-align:left">${s.nameB}</td>${Array.from({ length: n }, () => html`<td></td>`)}<td></td></tr></tbody></table></div>
        <div style="text-align:center;font-size:.75rem"><div class="qr">${qrSvg(`${base}#/match/${t.id}/${m.id}?k=${m.token}`)}</div>Saisir en ligne</div></div>`;
    })}</div>`;
  } else if (kind === 'cartes') {
    const blank = (t.cards || []).filter((c) => !c.ops?.length);
    body = html`<div style="max-width:1000px;margin:0 auto;padding:0 16px"><h2 class="noprint">${blank.length} cartes vierges à découper</h2>
      <p class="noprint hint">Chaque carte a son code. À la buvette, on la charge (« Vendre / recharger une carte » → scanner ou taper le code), puis le joueur paie en points. En scannant le QR, il retrouve son solde sur son téléphone.</p>
      <div class="cardgrid">${blank.map((c) => html`<div class="paycard"><div><b style="font-size:1.1rem">${t.name}</b><div class="small">Carte buvette</div><div class="num" style="font-size:2.4rem;line-height:1.1">${c.code}</div><div class="small" style="margin-top:2mm">Prénom : ………………………</div></div><div class="qr">${qrSvg(`${base}#/carte/${t.id}/${c.code}?k=${c.key}`)}</div></div>`)}</div></div>`;
  } else if (kind === 'planning') {
    const courts = t.courts.filter((c) => c.active !== false);
    const slots = [...new Set(t.matches.filter((m) => m.slot != null).map((m) => m.slot))].sort((a, b) => a - b);
    body = html`<div style="max-width:1100px;margin:0 auto;padding:0 16px"><h2>${t.name} · planning</h2><p>${fmtDate(t.date)} · ${t.venue}</p>
      <table class="t"><thead><tr><th>Heure</th>${courts.map((c) => html`<th>${c.name} ${sportOf(c).icon}</th>`)}</tr></thead><tbody>
      ${slots.map((s) => html`<tr><td class="num">${slotTime(t, s)}</td>${courts.map((c) => { const m = t.matches.find((x) => x.slot === s && x.courtId === c.id); if (!m) return html`<td></td>`; const sd = sides(t, m, ctx.resolved); return html`<td>${sd.nameA} – ${sd.nameB}${m.referee ? html`<br><small>Arb. ${teamName(t, m.referee)}</small>` : ''}</td>`; })}</tr>`)}
      </tbody></table></div>`;
  } else {
    body = html`<div style="max-width:1000px;margin:0 auto;padding:0 16px"><h2>${t.name} · classements</h2>${rankingsView(ctx)}</div>`;
  }
  return { title: `Impression · ${t.name}`, html: html`${bar}${body}` };
}
