// Feuille de match sur téléphone : ouverte par le QR code d'un terrain ou depuis le portail.
import { store } from '../store.js';
import { html, raw, toStr, toast, modal, sides, matchTime, teamName, sportOf, phaseLabel, $, esc, contrastInk } from '../ui.js';
import { scoringFor, setFinished, setTarget, matchResult, BYE } from '../engine.js';
import { fmtClock } from './components.js';

/** #/court/:id/:courtId?k=jeton : le match en cours (ou le prochain) sur ce terrain. */
export async function courtView(ctx) {
  const { t, resolved } = ctx;
  const court = t.courts.find((c) => c.id === ctx.route.params[1]);
  if (ctx.route.query.k) sessionStorage.setItem(`rot:k:${court?.id}`, ctx.route.query.k);
  if (!court) return { html: html`<main class="sheet"><div class="empty">Terrain introuvable.</div></main>` };
  const ms = t.matches.filter((m) => m.courtId === court.id && m.status !== 'bye').sort((a, b) => a.slot - b.slot);
  const ready = (m) => { const s = sides(t, m, resolved); return s.a && s.b && s.a !== BYE && s.b !== BYE; };
  const m = ms.find((x) => x.status === 'live') || ms.find((x) => x.status === 'scheduled' && ready(x));
  if (!m) {
    const waiting = ms.find((x) => x.status === 'scheduled');
    return { title: court.name, html: html`<main class="sheet"><div class="court ${contrastInk(court.color)}" style="--c:${court.color}"><div class="ch"><span>${court.name}</span><span>${sportOf(court).icon} ${sportOf(court).label}</span></div><div class="idle">${waiting ? 'Le prochain match attend la fin des matchs précédents.' : 'Plus de match prévu sur ce terrain.'}</div></div>
      <p style="text-align:center;margin-top:1rem"><a href="#/t/${t.id}">Voir tous les matchs et classements</a></p></main>` };
  }
  return sheetFor(ctx, m, { token: sessionStorage.getItem(`rot:k:${court.id}`), court });
}

/** #/match/:id/:matchId?k=jeton */
export async function matchView(ctx) {
  const { t } = ctx;
  const m = t.matches.find((x) => x.id === ctx.route.params[1]);
  if (!m) return { html: html`<main class="sheet"><div class="empty">Match introuvable.</div></main>` };
  if (ctx.route.query.k) sessionStorage.setItem(`rot:mk:${m.id}`, ctx.route.query.k);
  return sheetFor(ctx, m, { token: sessionStorage.getItem(`rot:mk:${m.id}`) });
}

// État local de la feuille (survit aux mises à jour en direct)
let local = null;

function sheetFor(ctx, m, { token, court }) {
  const { t, resolved } = ctx;
  court ??= t.courts.find((c) => c.id === m.courtId);
  const s = sides(t, m, resolved);
  const sc = scoringFor(t, m);
  const role = store.role(t.id);
  const allowed = !!token || t.openScoring === true || store.isAdmin(t) || role?.role === 'volunteer' || (role?.role === 'team' && [s.a, s.b, s.referee].includes(role.teamId));
  if (!local || local.id !== m.id) local = { id: m.id, sets: structuredClone(m.sets?.length ? m.sets : [[0, 0]]), swapped: false, dirty: false, timer: m.timer || null };
  if (!local.dirty) { local.sets = structuredClone(m.sets?.length ? m.sets : [[0, 0]]); local.timer = m.timer || null; }
  const sets = local.sets;
  const cur = sets.length - 1;
  const [pa, pb] = sets[cur];
  const res = matchResult({ sets }, sc);
  const finishedSet = sc.mode === 'points' && setFinished(sc, cur, pa, pb);
  const matchOver = sc.mode === 'points' && (res.setsA >= sc.setsToWin || res.setsB >= sc.setsToWin);
  const rules = sc.mode === 'time'
    ? `Match au temps : ${sc.durationMin} minutes${m.phase === 'bracket' ? ', un vainqueur obligatoire' : ', match nul possible'}`
    : `${sc.setsToWin > 1 ? `${sc.setsToWin} sets gagnants · ` : ''}set de ${setTarget(sc, cur)} points${sc.winBy2 !== false ? ', 2 points d’écart' : ''}${sc.cap ? `, plafond ${sc.cap}` : ''}`;
  const L = local.swapped ? 'B' : 'A', R = local.swapped ? 'A' : 'B';
  const name = (k) => (k === 'A' ? s.nameA : s.nameB);
  const pts = (k) => (k === 'A' ? pa : pb);
  const setsWon = (k) => (k === 'A' ? res.setsA : res.setsB);
  const sendTo = { matchId: m.id, ...(token ? { token } : {}), ...(role?.pin ? { pin: role.pin } : {}) };

  const side = (k, cls) => html`<div class="side ${cls}">
    <div class="nm">${name(k)}</div>
    <button class="plus" data-act="plus" data-k="${k}" ${!allowed || m.status === 'done' || matchOver || finishedSet ? raw('disabled style="opacity:.55"') : ''} aria-label="Point pour ${name(k)}, score ${pts(k)}">${sc.mode === 'points' && sc.setsToWin > 1 ? html`<small>Sets ${setsWon(k)}</small>` : ''}${pts(k)}<span class="plus1">+1</span></button>
    <button class="minus" data-act="minus" data-k="${k}" ${!allowed || m.status === 'done' || !pts(k) ? raw('disabled') : ''} aria-label="Retirer un point à ${name(k)}">−1</button>
  </div>`;

  let banner = '';
  if (m.status === 'done') banner = html`<div class="card" style="text-align:center;background:var(--win-bg)"><b>Match terminé et envoyé ✓</b><br><span class="small">${m.submittedBy ? `Saisi par ${m.submittedBy}` : ''}</span></div>`;
  else if (matchOver) banner = html`<div class="next-step" style="justify-content:center;text-align:center"><b>${res.winner === 'A' ? s.nameA : s.nameB} remporte le match ${res.setsA}-${res.setsB}</b></div>`;
  else if (finishedSet) banner = html`<div class="next-step" style="justify-content:space-between"><b>Set gagné par ${pa > pb ? s.nameA : s.nameB}</b><button class="btn" data-act="next-set">Set suivant</button></div>`;

  const timerBlock = sc.mode === 'time' ? html`<div class="timer" data-dur="${sc.durationMin}"><div class="clock" data-clock>--:--</div>
    ${allowed && m.status !== 'done' ? html`<div class="row" style="justify-content:center;margin-top:.5rem"><button class="btn ball sm" data-act="timer-toggle">${local.timer?.running ? 'Pause' : local.timer?.elapsed ? 'Reprendre' : 'Lancer le chrono'}</button>${local.timer ? html`<button class="btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.3)" data-act="timer-reset">Remettre à zéro</button>` : ''}</div>` : ''}</div>` : '';

  return {
    title: `${s.nameA} – ${s.nameB}`,
    html: html`<main class="sheet">
      <div class="row between" style="margin-bottom:.5rem"><span class="pill cc" style="--c:${court?.color}">${sportOf(court).icon} ${court?.name}</span><span class="muted small">${phaseLabel(t, m)} · ${matchTime(t, m)}</span></div>
      <div class="rules">📋 ${rules}</div>
      ${s.referee ? html`<p class="small muted" style="margin:.5rem 0 0;text-align:center">Arbitre : ${teamName(t, s.referee)}</p>` : ''}
      ${timerBlock}
      ${sc.mode === 'points' && sets.length > 1 ? html`<div class="setstrip">${sets.map((x, i) => html`<span class="${i === cur ? 'cur' : ''}">${x[0]}-${x[1]}</span>`)}</div>` : ''}
      <div class="scorepad">${side(L, L === 'A' ? 'a' : 'b')}${side(R, R === 'A' ? 'a' : 'b')}</div>
      <div style="margin-top:12px">${banner}</div>
      ${allowed && m.status === 'scheduled' ? html`<p class="hint" style="text-align:center;margin:.6rem 0 0">Touchez le score d’une équipe à chaque point marqué : le match démarre au premier point${sc.mode === 'time' ? ' (lancez aussi le chrono)' : ''}.</p>` : ''}
      ${allowed ? '' : html`<div class="card" style="margin-top:1rem;text-align:center"><p><b>Lecture seule.</b> Scannez le QR code du terrain ou connectez-vous avec le code de votre équipe pour saisir le score.</p><a class="btn" href="#/t/${t.id}">Se connecter au portail</a></div>`}
      <div class="row" style="justify-content:center;margin-top:1rem"><button class="linkbtn small" data-act="swap">Inverser les côtés</button><a class="small" href="#/t/${t.id}">Matchs et classements</a></div>
      ${allowed && m.status !== 'done' ? html`<div class="stickyact">
        <button class="btn ${matchOver ? 'ball' : ''}" data-act="finish" ${sc.mode === 'points' && !matchOver ? raw('data-early="1"') : ''} ${m.status === 'scheduled' && !(pa + pb) ? raw('disabled') : ''}>Terminer le match</button>
      </div>` : ''}
    </main>`,
    keep: () => local?.busy,
    mount(root) {
      // Chrono (matchs au temps)
      let alarm = false;
      const tick = () => {
        const el = $('[data-clock]', root);
        if (!el) return;
        const dur = sc.durationMin * 60000;
        const tm = local.timer;
        const elapsed = tm ? tm.elapsed + (tm.running ? Date.now() - tm.since : 0) : 0;
        const left = dur - elapsed;
        el.textContent = fmtClock(Math.max(0, left));
        el.parentElement.classList.toggle('over', left <= 0);
        if (left <= 0 && tm?.running && !alarm) { alarm = true; navigator.vibrate?.([400, 150, 400, 150, 400]); toast('⏱ Temps écoulé !', 'ann'); }
      };
      tick();
      const h = setInterval(tick, 500);
      this.cleanup = () => clearInterval(h);

      let pushTimer = null;
      const push = (extra = {}, now = false) => {
        local.dirty = true;
        clearTimeout(pushTimer);
        const go = async () => {
          local.busy = true;
          try {
            const r = await store.submitScore(t.id, { ...sendTo, sets: local.sets, status: m.status === 'scheduled' ? 'live' : m.status, timer: local.timer, ...extra });
            if (r?.queued) toast('Pas de réseau : le score sera envoyé dès le retour de la connexion');
          } catch (e) { toast(e.message, 'err'); }
          local.busy = false; local.dirty = false;
        };
        if (now) return go();
        pushTimer = setTimeout(go, 400);
      };

      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const k = b.dataset.k === 'A' ? 0 : 1;
        local.dirty = true;
        const c = local.sets[local.sets.length - 1];
        switch (b.dataset.act) {
          case 'plus':
            c[k]++; navigator.vibrate?.(15);
            if (m.status === 'scheduled') m.status = 'live';
            ctx.repaint(); push(); break;
          case 'minus': if (c[k] > 0) { c[k]--; ctx.repaint(); push(); } break;
          case 'next-set': local.sets.push([0, 0]); ctx.repaint(); push(); break;
          case 'swap': local.swapped = !local.swapped; local.dirty = !!pushTimer || local.busy; ctx.repaint(); break;
          case 'start':
            m.status = 'live';
            if (sc.mode === 'time' && !local.timer) local.timer = { running: true, elapsed: 0, since: Date.now() };
            await push({ status: 'live' }, true); ctx.rerender(); break;
          case 'timer-toggle': {
            const tm = local.timer || { running: false, elapsed: 0, since: 0 };
            local.timer = tm.running ? { running: false, elapsed: tm.elapsed + Date.now() - tm.since, since: 0 } : { running: true, elapsed: tm.elapsed, since: Date.now() };
            if (m.status === 'scheduled') m.status = 'live';
            ctx.rerender(); push({}, true); break;
          }
          case 'timer-reset': local.timer = null; alarm = false; ctx.rerender(); push({}, true); break;
          case 'finish': {
            const r = matchResult({ sets: local.sets }, sc);
            const needTie = r.winner === 'D' && m.phase === 'bracket';
            const ok = await modal({
              title: 'Valider le score final ?',
              body: html`<p style="font-size:1.2rem;text-align:center"><b>${s.nameA}</b> <span class="num" style="font-size:1.8rem">${sc.mode === 'time' || local.sets.length === 1 ? `${local.sets[0][0]} - ${local.sets[0][1]}` : `${r.setsA} - ${r.setsB}`}</span> <b>${s.nameB}</b></p>
                ${local.sets.length > 1 ? html`<p class="small muted" style="text-align:center;margin-top:-.5rem">${local.sets.map((x) => `${x[0]}-${x[1]}`).join(' · ')}</p>` : ''}
                ${b.dataset.early ? html`<p class="pill warn">Le match n’est pas allé au bout des sets prévus : vérifiez avant de valider.</p>` : ''}
                ${needTie ? html`<label class="f">Égalité : qui gagne (tirs au but, point en or…) ?<select name="tie" required><option value="">Choisir…</option><option value="A">${s.nameA}</option><option value="B">${s.nameB}</option></select></label>` : ''}
                <div class="grid2"><label class="f">Capitaine ${s.nameA}<input type="text" name="sigA" placeholder="Prénom (facultatif)" maxlength="40"></label><label class="f">Capitaine ${s.nameB}<input type="text" name="sigB" placeholder="Prénom (facultatif)" maxlength="40"></label></div>
                <p class="hint" style="margin:0">Une fois validé, le score part au classement et sur le grand écran.</p>`,
              ok: 'Valider et envoyer',
            });
            if (!ok) return;
            clearTimeout(pushTimer);
            local.busy = true;
            try {
              const r2 = await store.submitScore(t.id, { ...sendTo, sets: local.sets, status: 'done', tieWinner: ok.tie || null, signatures: { A: ok.sigA, B: ok.sigB }, submittedBy: [ok.sigA, ok.sigB].filter(Boolean).join(' & ') || (role?.role === 'team' ? teamName(t, role.teamId) : 'Feuille du terrain'), timer: local.timer ? { ...local.timer, running: false } : null });
              toast(r2?.queued ? 'Score enregistré sur le téléphone, envoi dès le retour du réseau' : 'Score envoyé ✓', r2?.queued ? '' : 'ok');
              m.status = 'done';
              local = null;
            } catch (err) { toast(err.message, 'err'); local.busy = false; }
            ctx.rerender();
            break;
          }
          default: break;
        }
      });
    },
  };
}
