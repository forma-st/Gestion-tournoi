import { store } from '../store.js';
import { html, raw, toStr, euros, sides, matchTime, teamName, sportOf, scoreText, qrSvg, logo, $ } from '../ui.js';
import { slotTime, finalPodium, currentSlot, scoringFor } from '../engine.js';
import { courtTile, startTimers, podiumView } from './components.js';
import { charityOf } from './bar.js';
import { tournamentRules, appSteps, hasStarted } from '../rules.js';

let panelIdx = 0;
let rotTimer = null;

export async function view(ctx) {
  const { t } = ctx;
  const only = ctx.route.query.terrain;
  const courts = t.courts.filter((c) => c.active !== false && (!only || c.id === only));
  const panels = buildPanels(ctx);
  const p = panels[panelIdx % panels.length];
  const ch = t.charity?.enabled ? charityOf(t) : null;
  const last = t.matches.filter((m) => m.status === 'done' && m.finishedAt).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 4);
  const ann = (t.announcements || []).at(-1);
  const annFresh = ann && Date.now() - new Date(ann.at).getTime() < 15 * 60000;
  const portal = `${store.baseUrl()}#/t/${t.id}`;
  // Avant le premier match (ou ?accueil=1) : écran d'accueil avec les règles et le mode d'emploi
  if ((ctx.route.query.accueil === '1' || !hasStarted(t)) && ctx.route.query.accueil !== '0' && !only) return welcome(ctx, portal);
  return {
    title: `${t.name} · grand écran`,
    bodyClass: 'tv',
    html: html`<div class="tvwrap">
      <header class="tvhead"><span style="width:6vh;display:block">${logo}</span><h1>${t.name}</h1>
        ${ch ? html`<div style="min-width:26vw"><div style="font-size:1.8vh;opacity:.75">${t.charity.label}${ch.goal ? ` · objectif ${euros(ch.goal)}` : ''}${t.charity.pointPledge ? ` · ${ch.points} points = ${euros(ch.pledge)}` : ''}</div><div class="num" style="font-size:4.4vh;color:var(--ball)">${euros(ch.total)}</div>${ch.goal ? html`<div class="places"><i style="width:${ch.pct}%"></i></div>` : ''}</div>` : ''}
        ${rotClock(t)}<span class="clock" data-clock></span></header>
      <div class="tvmain" style="${only ? 'grid-template-columns:1fr' : ''}">
        <section class="tvcourts" aria-label="Terrains">${courts.map((c) => courtTile(ctx, c, { big: true, qr: c.token || t.openScoring ? `${store.baseUrl()}#/court/${t.id}/${c.id}${c.token ? `?k=${c.token}` : ''}` : '' }))}</section>
        ${only ? '' : html`<section class="tvside fade-in" aria-live="polite"><h2>${p.title}</h2><div style="flex:1;min-height:0;overflow:hidden">${p.body}</div>
          <div class="row" style="gap:1.2vw;margin-top:1.2vh;align-items:center;background:#fff;color:var(--ink);border-radius:1.2vh;padding:1vh 1vw"><div style="width:19vh;flex:none">${qrSvg(portal)}</div><div style="font-size:2.3vh;line-height:1.3"><b style="font-size:2.8vh;font-family:var(--display)">Vos matchs sur votre téléphone</b><br>Scannez, puis « Je suis une équipe »</div></div></section>`}
      </div>
      <footer class="tvticker">${annFresh ? html`<b>📣</b><span>${ann.text}</span>`
        : last.length ? html`<b>Derniers résultats</b>${last.map((m) => { const s = sides(t, m, ctx.resolved); return html`<span>${s.nameA} <b class="num">${scoreText(t, m).main}</b> ${s.nameB}</span>`; })}`
        : html`<span>Bienvenue ! Les scores s’affichent ici en direct.</span>`}
        ${(t.sponsors || []).filter((s) => s.name).length ? html`<span class="spacer"></span><span style="opacity:.7">Merci à ${t.sponsors.filter((s) => s.name).map((s) => s.name).join(' · ')}</span>` : ''}</footer>
    </div>`,
    mount(root) {
      const stopTimers = startTimers(root);
      const clock = () => { const el = $('[data-clock]', root); if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
      clock();
      const h = setInterval(clock, 10000);
      clearInterval(rotTimer);
      rotTimer = setInterval(() => { panelIdx++; ctx.rerender(); }, 12000);
      // Sans serveur (mode autonome), on relit régulièrement le stockage local
      const poll = store.mode === 'local' ? setInterval(() => ctx.rerender(), 5000) : null;
      this.cleanup = () => { stopTimers(); clearInterval(h); clearInterval(poll); };
      root.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.().catch(() => {}));
    },
  };
}

// Quitter l'écran TV arrête la rotation des panneaux
addEventListener('hashchange', () => { if (!location.hash.includes('/live/')) clearInterval(rotTimer); });

/** Écran d'accueil (avant le début) : règles du tournoi, mode d'emploi en 4 étapes, très grand QR du portail. */
function welcome(ctx, portal) {
  const { t } = ctx;
  const rules = tournamentRules(t);
  const steps = appSteps(t);
  return {
    title: `${t.name} · bienvenue`,
    bodyClass: 'tv',
    html: html`<div class="tvwrap" style="grid-template-rows:auto 1fr">
      <header class="tvhead"><span style="width:6vh;display:block">${logo}</span><h1>Bienvenue au ${t.name}</h1>
        <div style="text-align:right;font-size:2.2vh;opacity:.85">Premier match à<br><b class="num" style="font-size:4vh;color:var(--ball)">${t.startTime}</b></div><span class="clock" data-clock></span></header>
      <div class="welcome">
        <section class="tvside"><h2>Les règles du tournoi</h2>
          <div class="wrules">${rules.filter((r) => r.title !== 'À savoir').map((r) => html`<div><span class="wic">${r.icon}</span><div><b>${r.title}</b><p>${r.text}</p></div></div>`)}</div></section>
        <section class="tvside"><h2>Comment ça marche ?</h2>
          <div class="wqr"><div class="qr">${qrSvg(portal)}</div><div><b>Scannez ce QR code</b><br>avec l’appareil photo de votre téléphone</div></div>
          <ol class="wsteps">${steps.map((s) => html`<li><b>${s.title}</b><span>${s.text}</span></li>`)}</ol>
          ${t.infos ? html`<div class="wrules" style="margin-top:1.6vh"><div><span class="wic">ℹ️</span><div><b>À savoir</b><p>${t.infos}</p></div></div></div>` : ''}</section>
      </div>
    </div>`,
    mount(root) {
      const clock = () => { const el = $('[data-clock]', root); if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
      clock();
      const h = setInterval(clock, 10000);
      const poll = store.mode === 'local' ? setInterval(() => ctx.rerender(), 5000) : null;
      this.cleanup = () => { clearInterval(h); clearInterval(poll); };
      root.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.().catch(() => {}));
    },
  };
}

function rotClock(t) {
  const slot = currentSlot(t);
  if (slot == null) return '';
  const m = t.matches.find((x) => x.slot === slot && x.status === 'live' && x.timer);
  if (!m) return html`<div style="text-align:right;font-size:2vh;opacity:.8">Rotation ${slot + 1}<br>${slotTime(t, slot)}</div>`;
  return html`<div style="text-align:right"><div style="font-size:1.8vh;opacity:.75">Rotation ${slot + 1}</div><div class="num" style="font-size:6vh;line-height:1;color:var(--ball)" data-timer="${JSON.stringify(m.timer)}" data-dur="${scoringFor(t, m).durationMin}">⏱</div></div>`;
}

function buildPanels(ctx) {
  const { t, resolved, standings } = ctx;
  const out = [];
  const podium = finalPodium(t, resolved);
  if (podium.length) out.push({ title: 'Podium', body: html`<div style="display:grid;gap:2vh;margin-top:2vh">${podium.map((id, i) => html`<div style="display:flex;gap:1.5vw;align-items:center"><span style="font-size:7vh">${['🥇', '🥈', '🥉'][i]}</span><span class="num" style="font-size:5vh">${teamName(t, id)}</span></div>`)}</div>` });

  const up = t.matches.filter((m) => m.status === 'scheduled').sort((a, b) => a.slot - b.slot).slice(0, 8);
  if (up.length) out.push({ title: 'Prochains matchs', body: html`${up.map((m) => { const s = sides(t, m, resolved); const c = t.courts.find((x) => x.id === m.courtId); return html`<div class="up"><span class="num">${matchTime(t, m)}</span><span class="dot" style="--c:${c?.color};width:1.4vh;height:1.4vh"></span><span>${s.nameA} – ${s.nameB} <span style="opacity:.6">· ${c?.name} ${sportOf(c).icon}${m.referee ? ` · arb. ${teamName(t, m.referee)}` : ''}</span></span></div>`; })}` });

  for (const [L, rows] of Object.entries(standings)) {
    if (!rows.some((r) => r.played)) continue;
    const top = rows.slice(0, 10);
    out.push({ title: t.format.type === 'roundrobin' ? 'Classement' : `Classement · poule ${L}`, body: html`<table><thead><tr><th>#</th><th>Équipe</th><th class="n">Pts</th><th class="n">J</th><th class="n">V</th><th class="n">Diff</th></tr></thead><tbody>${top.map((r) => html`<tr><td class="num">${r.rank}</td><td>${teamName(t, r.team)}</td><td class="n num" style="color:var(--ball)">${r.rankPts}</td><td class="n">${r.played}</td><td class="n">${r.won}</td><td class="n">${r.ptsFor - r.ptsAgainst > 0 ? '+' : ''}${r.ptsFor - r.ptsAgainst}</td></tr>`)}</tbody></table>` });
  }

  const br = t.matches.filter((m) => m.phase === 'bracket' && m.status !== 'bye' && !resolved[m.id]?.skip).sort((a, b) => a.slot - b.slot);
  if (br.length) out.push({ title: 'Phases finales', body: html`${br.slice(-8).map((m) => { const s = sides(t, m, resolved); const sc = scoreText(t, m); return html`<div class="up"><span class="num">${m.status === 'done' ? sc.main : matchTime(t, m)}</span><span></span><span><b style="${s.winner === s.a ? 'color:var(--ball)' : ''}">${s.nameA}</b> – <b style="${s.winner === s.b ? 'color:var(--ball)' : ''}">${s.nameB}</b> <span style="opacity:.6">· ${m.label}</span></span></div>`; })}` });

  const ch = t.charity?.enabled ? charityOf(t) : null;
  if (ch) {
    out.push({ title: `Cagnotte ${t.charity.label || ''}`, body: html`<div class="num" style="font-size:8vh;color:var(--ball);line-height:1">${euros(ch.total)}</div>
      ${ch.next ? html`<p style="font-size:2.3vh;margin:1vh 0">Prochain défi à <b style="color:var(--ball)">${euros(ch.next.amount)}</b> : ${ch.next.label}</p>` : ''}
      ${ch.reached.length ? html`<p style="font-size:1.9vh;opacity:.8;margin:0 0 1vh">✔ ${ch.reached.map((m) => m.label).join(' · ')}</p>` : ''}
      ${t.charity.pointPledge ? html`<p style="font-size:2.1vh;margin:0 0 1vh">🏐 Chaque point = ${euros(t.charity.pointPledge)}${t.charity.pledgeSponsor ? ` (${t.charity.pledgeSponsor})` : ''} : ${ch.points} points, ${euros(ch.pledge)}</p>` : ''}
      <div class="tvdon">${ch.feed.slice(0, 5).map((d) => html`<div><span>💛 ${d.name}${d.message ? html` <i style="opacity:.7">« ${d.message} »</i>` : ''}</span><b>${euros(d.amount)}</b></div>`)}</div>
      <div class="row" style="gap:1.2vw;margin-top:1.5vh;align-items:center;background:#fff;color:var(--ink);border-radius:1.2vh;padding:1vh 1vw"><div style="width:16vh;flex:none">${qrSvg(`${store.baseUrl()}#/don/${t.id}`)}</div><div style="font-size:2.2vh"><b style="font-family:var(--display);font-size:2.8vh">Scannez pour donner</b><br>Paiement au club, qui reverse au ${t.charity.label || 'profit de la cause'}</div></div>` });
  }
  const steps = appSteps(t);
  out.push({ title: 'Comment ça marche ?', body: html`<ol class="wsteps" style="font-size:2.1vh">${steps.map((s) => html`<li><b>${s.title}</b><span>${s.text}</span></li>`)}</ol>` });
  if (!out.length) out.push({ title: 'Bienvenue', body: html`<p style="font-size:2.4vh">Le tournoi commence à ${t.startTime}.</p>` });
  return out;
}
