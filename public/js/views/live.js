import { store } from '../store.js';
import { html, raw, toStr, euros, sides, matchTime, teamName, sportOf, scoreText, qrSvg, logo, $ } from '../ui.js';
import { slotTime, finalPodium } from '../engine.js';
import { courtTile, startTimers, podiumView } from './components.js';
import { charityOf } from './bar.js';

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
  return {
    title: `${t.name} · grand écran`,
    bodyClass: 'tv',
    html: html`<div class="tvwrap">
      <header class="tvhead"><span style="width:6vh;display:block">${logo}</span><h1>${t.name}</h1>
        ${ch ? html`<div style="min-width:26vw"><div style="font-size:1.8vh;opacity:.75">${t.charity.label}${ch.goal ? ` · objectif ${euros(ch.goal)}` : ''}${t.charity.pointPledge ? ` · ${ch.points} points = ${euros(ch.pledge)}` : ''}</div><div class="num" style="font-size:4.4vh;color:var(--ball)">${euros(ch.total)}</div>${ch.goal ? html`<div class="places"><i style="width:${ch.pct}%"></i></div>` : ''}</div>` : ''}
        <span class="clock" data-clock></span></header>
      <div class="tvmain" style="${only ? 'grid-template-columns:1fr' : ''}">
        <section class="tvcourts" aria-label="Terrains">${courts.map((c) => courtTile(ctx, c, { big: true }))}</section>
        ${only ? '' : html`<section class="tvside fade-in" aria-live="polite"><h2>${p.title}</h2><div style="flex:1;min-height:0;overflow:hidden">${p.body}</div>
          <div class="row" style="gap:1vw;margin-top:1vh;align-items:center"><div style="width:11vh;background:#fff;padding:.5vh;border-radius:.8vh">${qrSvg(portal)}</div><div style="font-size:1.9vh;opacity:.85">Scannez pour suivre<br>vos matchs sur votre téléphone</div></div></section>`}
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
      ${t.charity.donateUrl ? html`<div class="row" style="gap:1vw;margin-top:1.5vh;align-items:center"><div style="width:12vh;background:#fff;padding:.5vh;border-radius:.8vh">${qrSvg(t.charity.donateUrl)}</div><div style="font-size:2vh">Scannez pour donner</div></div>` : ''}` });
  }
  if (!out.length) out.push({ title: 'Bienvenue', body: html`<p style="font-size:2.4vh">Le tournoi commence à ${t.startTime}.</p>` });
  return out;
}
