import { store } from '../store.js';
import { html, raw, fmtDate, sides, matchTime, teamName, sportOf, qrSvg, phaseLabel } from '../ui.js';
import { scoringFor, slotTime, slotTitle } from '../engine.js';
import { rankingsView } from './components.js';
import { tournamentRules, appSteps } from '../rules.js';

export async function view(ctx) {
  const { t } = ctx;
  const kind = ctx.route.params[1] || 'qr';
  const base = store.baseUrl();
  const admin = store.isAdmin(t);
  const bar = html`<div class="noprint row between" style="padding:16px;max-width:1000px;margin:0 auto"><a href="#/admin/${t.id}">← Retour</a><button class="btn" onclick="window.print()">Imprimer</button></div>`;
  let body;
  if (!admin && !['classement', 'planning', 'regles'].includes(kind)) body = html`<p class="wrap">Réservé à l’organisation.</p>`;
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
    const rot = ctx.route.query.rot;
    const blank = ctx.route.query.vierge === '1';
    const ms = blank ? [null, null, null] : t.matches.filter((m) => m.status !== 'bye' && m.slot != null && (rot == null || m.slot === +rot)).sort((a, b) => a.slot - b.slot || t.courts.findIndex((c) => c.id === a.courtId) - t.courts.findIndex((c) => c.id === b.courtId));
    const sheet = (m) => {
      const s = m ? sides(t, m, ctx.resolved) : null;
      const c = m ? t.courts.find((x) => x.id === m.courtId) : null;
      const sc = m ? scoringFor(t, m) : t.scoring;
      const nSets = sc.mode === 'time' ? 1 : sc.setsToWin * 2 - 1;
      const marks = sc.mode === 'time' ? 30 : Math.max(sc.pointsPerSet || 25, sc.tiebreakPoints || 15) + 5;
      const grid = () => html`<div class="tally">${Array.from({ length: marks }, (_, i) => html`<span>${i + 1}</span>`)}</div>`;
      return html`<div class="papersheet">
        <div class="ps-head"><b>${m ? `${slotTitle(t, m.slot)} · ${matchTime(t, m)}` : 'Rotation ……  · Heure ……'}</b>
          <span>${c ? html`<span class="ccourt" style="--c:${c.color}">${c.name} ${sportOf(c).icon} ${sportOf(c).label}</span>` : 'Terrain …………  Sport …………'}</span>
          <span>${m ? phaseLabel(t, m) : ''}${s?.referee ? ` · Arbitre : ${teamName(t, s.referee)}` : m ? '' : ' Arbitre : …………………'}</span></div>
        <p class="ps-rule">${sc.mode === 'time' ? `Match de ${sc.durationMin} minutes : barrez un numéro à chaque point (ou but) marqué. Score final = dernier numéro barré.` : `${sc.setsToWin > 1 ? `${sc.setsToWin} sets gagnants de ${sc.pointsPerSet} points` : `1 set de ${sc.pointsPerSet} points`}${sc.winBy2 !== false ? ', 2 points d’écart' : ''} : barrez un numéro à chaque point. Une ligne par set.`}</p>
        <div class="ps-body"><table><tbody>
          ${[['A', s?.nameA], ['B', s?.nameB]].map(([k, name]) => html`<tr><th class="ps-team">${name || 'Équipe ………………………'}</th>${Array.from({ length: nSets }, (_, i) => html`<td class="ps-grid">${nSets > 1 ? html`<small>Set ${i + 1}</small>` : ''}${grid()}</td>`)}<td class="ps-final"><small>Score</small></td></tr>`)}
        </tbody></table>
        ${m ? html`<div class="ps-qr"><div class="qr">${qrSvg(`${base}#/match/${t.id}/${m.id}?k=${m.token}`)}</div><small>Saisie en ligne</small></div>` : ''}</div>
        <div class="ps-sign"><span>Vainqueur : …………………………</span><span>Signature capitaine A : ……………</span><span>Signature capitaine B : ……………</span></div>
      </div>`;
    };
    body = html`<div style="max-width:1000px;margin:0 auto;padding:0 16px"><h2 class="noprint">${t.name} : ${blank ? 'feuilles de match vierges' : rot != null ? `feuilles : ${slotTitle(t, +rot)}` : 'toutes les feuilles de match'}</h2>
      <p class="noprint hint">${blank ? '3 feuilles vierges par page, pour un match imprévu ou un match de remplacement.' : 'Une feuille par match. Les scores notés sur papier se reportent ensuite dans l’onglet Matchs (bouton Score), ou en scannant le QR de la feuille.'}</p>
      ${ms.map(sheet)}</div>`;
  } else if (kind === 'regles') {
    body = html`<section class="poster page" style="--c:var(--court);align-content:start;text-align:left;justify-items:stretch;gap:1rem">
      <h1 style="text-align:center;font-size:3rem;margin:0">${t.name}</h1>
      <div class="grid2" style="align-items:start">
        <div class="rules-list" style="font-size:1.05rem">${tournamentRules(t).map((r) => html`<div><span class="wic">${r.icon}</span><div><b>${r.title}</b><p>${r.text}</p></div></div>`)}</div>
        <div class="stack"><div class="qr" style="width:260px;justify-self:center">${qrSvg(`${base}#/t/${t.id}`)}</div><b style="text-align:center;font-size:1.3rem">Vos matchs sur votre téléphone</b>
          <ol class="steps-list" style="font-size:1.05rem">${appSteps(t).map((s) => html`<li><b>${s.title}</b>${s.text}</li>`)}</ol></div>
      </div></section>`;
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
