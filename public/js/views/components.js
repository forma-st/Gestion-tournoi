import { html, raw, sides, scoreText, matchTime, phaseLabel, teamName, sportOf, contrastInk, esc } from '../ui.js';
import { scoringFor, matchResult, BYE, finalPodium, POOL_LETTERS } from '../engine.js';

export const STATUS = { scheduled: 'À venir', live: 'En cours', done: 'Terminé', bye: 'Exempt' };

/** Ligne de match (liste). opts: {me, admin, href} */
export function matchRow(ctx, m, opts = {}) {
  const { t, resolved } = ctx;
  const s = sides(t, m, resolved);
  const court = t.courts.find((c) => c.id === m.courtId);
  const sc = scoreText(t, m);
  const mine = opts.me && (s.a === opts.me || s.b === opts.me);
  const refMine = opts.me && s.referee === opts.me;
  const winA = m.status === 'done' && s.winner && s.winner === s.a;
  const winB = m.status === 'done' && s.winner && s.winner === s.b;
  const res = mine && m.status === 'done' ? (s.winner === opts.me ? 'win' : s.winner ? 'loss' : '') : '';
  return html`<div class="mrow ${m.status === 'live' ? 'live' : ''} ${mine || refMine ? 'mine' : ''}" data-mid="${m.id}">
    <div class="time">${matchTime(t, m)}<small>${court ? court.name : ''}</small></div>
    <div class="ta ${winA ? 'w' : ''} ${s.tbdA ? 'tbd' : ''}">${s.nameA}</div>
    <div class="sc ${res}">${m.status === 'done' || m.status === 'live' ? (sc.main || '0-0') : 'vs'}${sc.detail ? html`<small>${sc.detail}</small>` : ''}</div>
    <div class="tb ${winB ? 'w' : ''} ${s.tbdB ? 'tbd' : ''}">${s.nameB}</div>
    <div class="act">${opts.action ? opts.action(m, s) : ''}</div>
    <div class="meta">
      ${court ? html`<span class="pill cc" style="--c:${court.color}">${sportOf(court).icon} ${sportOf(court).label}</span>` : ''}
      <span class="pill">${phaseLabel(t, m)}</span>
      ${m.status === 'live' ? html`<span class="pill live">En cours</span>` : m.status === 'done' ? html`<span class="pill ${res || ''}">${res === 'win' ? 'Victoire' : res === 'loss' ? 'Défaite' : 'Terminé'}</span>` : ''}
      ${m.status === 'done' && t.scoreValidation && !m.validated ? html`<span class="pill warn">À valider</span>` : ''}
      ${m.queued ? html`<span class="pill warn">Envoi en attente</span>` : ''}
      ${s.referee ? html`<span class="pill ${refMine ? 'warn' : ''}">Arbitre : ${teamName(t, s.referee)}</span>` : ''}
    </div>
  </div>`;
}

/** Terrain vu du dessus avec le match en cours (ou le prochain). */
export function courtTile(ctx, court, { big = false, link = '' } = {}) {
  const { t, resolved } = ctx;
  const ms = t.matches.filter((m) => m.courtId === court.id && m.status !== 'bye').sort((a, b) => a.slot - b.slot);
  const live = ms.find((m) => m.status === 'live');
  const next = ms.find((m) => m.status === 'scheduled' && m !== live);
  const m = live || next;
  const sp = sportOf(court);
  const light = contrastInk(court.color);
  let inner;
  if (!m) inner = html`<div class="idle">Terrain libre</div>`;
  else {
    const s = sides(t, m, resolved);
    const sc = scoringFor(t, m);
    const sets = m.sets || [];
    const cur = sets.at(-1) || [0, 0];
    const r = matchResult(m, sc);
    inner = html`<div class="halves">
      <div class="half"><div class="tn">${s.nameA}</div><div class="pts">${live ? cur[0] : '–'}</div>${live && sc.mode === 'points' && sc.setsToWin > 1 ? html`<div class="sets">Sets ${r.setsA}</div>` : ''}</div>
      <div class="half"><div class="tn">${s.nameB}</div><div class="pts">${live ? cur[1] : '–'}</div>${live && sc.mode === 'points' && sc.setsToWin > 1 ? html`<div class="sets">Sets ${r.setsB}</div>` : ''}</div>
    </div>
    <div class="foot">${live ? (sc.mode === 'time' ? html`<span data-timer="${esc(JSON.stringify(m.timer || null))}" data-dur="${sc.durationMin}">⏱</span>` : html`<span>Set ${sets.length || 1}</span>`) : html`<span>À suivre · ${matchTime(t, m)}</span>`}${s.referee ? html`<span>Arbitre : ${teamName(t, s.referee)}</span>` : ''}</div>`;
  }
  const tag = link ? 'a' : 'div';
  return html`${raw(`<${tag} ${link ? `href="${esc(link)}" style="text-decoration:none;--c:${esc(court.color)}"` : `style="--c:${esc(court.color)}"`} class="court ${light}">`)}
    <div class="ch"><span>${court.name} · ${sp.icon} ${sp.label}</span><span class="spacer"></span>${live ? html`<span class="pill live" style="background:rgba(0,0,0,.25)">Direct</span>` : ''}</div>
    ${inner}
  ${raw(`</${tag}>`)}`;
}

/** Tableau de classement d'une poule. */
export function standingsTable(ctx, L, { me, compact = false, rows: given } = {}) {
  const { t, standings } = ctx;
  const rows = given || standings[L] || [];
  const q = given || t.format.type === 'levels' ? 0 : t.format.type === 'pools' ? t.format.qualifiers : t.format.finalsTop || 0;
  const time = t.courts.every((c) => (c.scoring || t.scoring).mode === 'time');
  return html`<div class="tscroll"><table class="t">
    <thead><tr><th>#</th><th>Équipe</th><th class="n" title="Points au classement">Pts</th><th class="n" title="Joués">J</th><th class="n" title="Victoires">V</th>${time ? html`<th class="n" title="Nuls">N</th>` : ''}<th class="n" title="Défaites">D</th>
      ${compact ? '' : html`${time ? '' : html`<th class="n" title="Sets gagnés/perdus">Sets</th>`}<th class="n" title="${time ? 'Buts / points marqués et encaissés' : 'Points marqués et encaissés'}">${time ? 'Marqués' : 'Points'}</th><th class="n">Diff</th><th>Forme</th>`}</tr></thead>
    <tbody>${rows.map((r) => html`<tr class="${r.team === me ? 'me' : ''} ${r.rank <= q ? 'q' : ''}">
      <td class="num">${r.rank}</td><td class="teamname">${teamName(t, r.team)}</td><td class="n num" style="font-size:1.15rem">${r.rankPts}</td><td class="n">${r.played}</td><td class="n">${r.won}</td>${time ? html`<td class="n">${r.drawn}</td>` : ''}<td class="n">${r.lost}</td>
      ${compact ? '' : html`${time ? '' : html`<td class="n">${r.setsFor}/${r.setsAgainst}</td>`}<td class="n">${r.ptsFor}/${r.ptsAgainst}</td><td class="n">${r.ptsFor - r.ptsAgainst > 0 ? '+' : ''}${r.ptsFor - r.ptsAgainst}</td>
      <td>${r.form.map((f) => html`<span class="pill ${f === 'V' ? 'win' : f === 'D' ? 'loss' : ''}" style="padding:0 .35rem;margin-right:2px">${f}</span>`)}</td>`}</tr>`)}</tbody>
  </table></div>
  ${q ? html`<p class="hint" style="margin:.4rem 0 0">Le liseré vert marque les qualifiés pour la phase finale.</p>` : ''}`;
}

/** Arbre d'un tableau (principal, consolante, double élimination). */
export function bracketView(ctx, bracketId, { me } = {}) {
  const { t, resolved } = ctx;
  const ms = t.matches.filter((m) => m.phase === 'bracket' && m.bracketId === bracketId);
  if (!ms.length) return '';
  const groups = [['W', 'Tableau principal'], ['C', ''], ['L', 'Tableau de repêchage'], ['GF', 'Grande finale']];
  return html`${groups.map(([side, title]) => {
    const list = ms.filter((m) => m.side === side);
    if (!list.length) return '';
    const rounds = [...new Set(list.map((m) => m.round))].sort((a, b) => a - b);
    const hasL = ms.some((m) => m.side === 'L');
    return html`${hasL || side === 'GF' ? html`<h3 style="margin-top:1rem">${title}</h3>` : ''}
    <div class="bracket">${rounds.map((r) => {
      const col = list.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
      return html`<div class="bcol"><h4>${col.find((m) => !m.id.endsWith('3P'))?.label || col[0].label}</h4>${col.map((m) => bm(ctx, m, me))}</div>`;
    })}</div>`;
  })}`;
}

function bm(ctx, m, me) {
  const { t, resolved } = ctx;
  const s = sides(t, m, resolved);
  if (m.status === 'bye') {
    const who = s.a && s.a !== BYE ? s.nameA : s.b && s.b !== BYE ? s.nameB : null;
    return html`<div class="bm" style="opacity:.55"><div class="bh"><span>${m.label}</span><span>Exempt</span></div><div class="bt ${who ? 'w' : 'tbd'}"><span>${who || (s.tbdA ? s.nameA : s.nameB)}</span><span>${who ? 'qualifié' : 'passe directement'}</span></div></div>`;
  }
  if (resolved[m.id]?.skip) return '';
  const r = s.result;
  const sc = scoringFor(t, m);
  const one = sc.mode === 'time' || sc.setsToWin === 1;
  const cur = (m.sets || []).at(-1);
  const valA = m.status === 'done' ? (one ? cur?.[0] : r?.setsA) : m.status === 'live' ? cur?.[0] ?? 0 : '';
  const valB = m.status === 'done' ? (one ? cur?.[1] : r?.setsB) : m.status === 'live' ? cur?.[1] ?? 0 : '';
  const court = t.courts.find((c) => c.id === m.courtId);
  return html`<div class="bm ${m.status === 'live' ? 'live' : ''}">
    <div class="bh"><span>${m.id.endsWith('3P') ? 'Petite finale' : ''}${court ? ` ${court.name}` : ''}</span><span>${m.slot != null ? matchTime(t, m) : ''}</span></div>
    <div class="bt ${s.winner && s.winner === s.a ? 'w' : ''} ${s.tbdA ? 'tbd' : ''}" ${s.a && s.a === me ? raw('style="background:#FFF8E1"') : ''}><span>${s.nameA}</span><span class="s">${valA ?? ''}</span></div>
    <div class="bt ${s.winner && s.winner === s.b ? 'w' : ''} ${s.tbdB ? 'tbd' : ''}" ${s.b && s.b === me ? raw('style="background:#FFF8E1"') : ''}><span>${s.nameB}</span><span class="s">${valB ?? ''}</span></div>
  </div>`;
}

export function podiumView(ctx) {
  const p = finalPodium(ctx.t, ctx.resolved);
  if (!p.length) return '';
  const medals = ['🥇', '🥈', '🥉'];
  return html`<div class="card" style="background:var(--ink);color:#fff">
    <h3 style="color:var(--ball)">Podium</h3>
    <div class="grid3">${p.map((id, i) => html`<div><div style="font-size:2rem">${medals[i]}</div><div class="num" style="font-size:1.6rem">${teamName(ctx.t, id)}</div></div>`)}</div>
  </div>`;
}

/** Toutes les vues de classement : poules + tableaux. */
export function rankingsView(ctx, { me } = {}) {
  const { t } = ctx;
  const pools = Object.keys(t.pools || {});
  const brackets = [...new Set(t.matches.filter((m) => m.phase === 'bracket').map((m) => m.bracketId))];
  return html`<div class="stack">
    ${podiumView(ctx)}
    ${t.format.type === 'levels' ? levelsView(ctx, me) : pools.map((L) => html`<div class="card"><h3>${t.format.type === 'roundrobin' ? 'Classement général' : `Poule ${L}`}</h3>${standingsTable(ctx, L, { me })}</div>`)}
    ${t.format.type === 'roundrobin' && t.courts.length > 1 ? perSportView(ctx, me) : ''}
    ${brackets.filter((b) => b !== 'place').map((b) => html`<div class="card"><h3>${t.matches.find((m) => m.bracketId === b)?.bracketName}</h3>${bracketView(ctx, b, { me })}</div>`)}
  </div>`;
}

/** Format par niveaux : brassage, poules de niveau, matchs de classement, classement final. */
function levelsView(ctx, me) {
  const { t, standings2 = {}, members2 = {}, places } = ctx;
  const final = (places || []).filter(Boolean).length;
  const placeMs = t.matches.filter((m) => m.bracketId === 'place').sort((a, b) => a.place - b.place);
  return html`
    ${final ? html`<div class="card"><h3>Classement final</h3><ol style="margin:0;padding-left:1.6rem;columns:2 220px">${(places || []).map((id) => html`<li ${id === me ? raw('style="font-weight:700"') : ''}>${id ? teamName(t, id) : '…'}</li>`)}</ol></div>` : ''}
    ${placeMs.length ? html`<div class="card"><h3>Matchs de classement</h3>${placeMs.map((m) => matchRow(ctx, m, { me }))}</div>` : ''}
    ${Object.keys(t.pools2 || {}).length ? html`<div class="card"><h3>Phase 2 · poules de niveau</h3><p class="hint">Formées automatiquement à la fin du brassage : les meilleurs ensemble, puis les suivants… Chaque paire de poules se retrouve ensuite pour les matchs de classement.</p>
      <div class="grid2">${Object.keys(t.pools2).map((P) => html`<div><b>Poule ${P.slice(1)}</b>${standings2[P] ? standingsTable(ctx, P, { me, compact: true, rows: standings2[P] }) : html`<p class="muted small">${(members2[P] || []).some(Boolean) ? (members2[P] || []).map((id) => (id ? teamName(t, id) : '?')).join(', ') : 'En attente de la fin du brassage'}</p>`}</div>`)}</div></div>` : ''}
    <div class="card"><h3>Phase 1 · brassage</h3><div class="grid2">${Object.keys(t.pools || {}).map((L) => html`<div><b>Poule ${L}</b>${standingsTable(ctx, L, { me, compact: true })}</div>`)}</div></div>`;
}

/** Classement par sport (multisport) : utile pour les prix « meilleure équipe de foot »… */
function perSportView(ctx, me) {
  const { t } = ctx;
  const done = t.matches.filter((m) => m.phase === 'pool' && m.status === 'done');
  if (!done.length) return '';
  return html`<div class="card"><h3>Par sport</h3><div class="grid3">${t.courts.map((c) => {
    const pts = {};
    for (const m of done.filter((x) => x.courtId === c.id)) {
      const r = matchResult(m, scoringFor(t, m));
      for (const [id, side] of [[m.teamA, 'A'], [m.teamB, 'B']]) {
        pts[id] ??= { p: 0, diff: 0 };
        pts[id].p += r.winner === side ? 3 : r.winner === 'D' ? 1 : 0;
        pts[id].diff += side === 'A' ? r.ptsA - r.ptsB : r.ptsB - r.ptsA;
      }
    }
    const rows = Object.entries(pts).sort((a, b) => b[1].p - a[1].p || b[1].diff - a[1].diff).slice(0, 3);
    return html`<div><span class="pill cc" style="--c:${c.color}">${sportOf(c).icon} ${sportOf(c).label}</span>
      <ol style="margin:.5rem 0 0;padding-left:1.2rem">${rows.map(([id, v]) => html`<li ${id === me ? raw('style="font-weight:700"') : ''}>${teamName(t, id)} <span class="muted small">${v.p} pts</span></li>`)}</ol></div>`;
  })}</div></div>`;
}

/** Démarre les chronos affichés (data-timer) ; renvoie la fonction d'arrêt. */
export function startTimers(root) {
  const tick = () => {
    for (const el of root.querySelectorAll('[data-timer]')) {
      let tm = null; try { tm = JSON.parse(el.dataset.timer); } catch { /* */ }
      const dur = (+el.dataset.dur || 0) * 60000;
      const elapsed = tm ? tm.elapsed + (tm.running ? Date.now() - tm.since : 0) : 0;
      const left = Math.max(0, dur - elapsed);
      el.textContent = tm ? `⏱ ${fmtClock(left)}${tm.running ? '' : ' (pause)'}` : '⏱ Chrono non lancé';
    }
  };
  tick();
  const h = setInterval(tick, 1000);
  return () => clearInterval(h);
}
export const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export { POOL_LETTERS };
