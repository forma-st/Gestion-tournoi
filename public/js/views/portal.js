import { store } from '../store.js';
import { html, raw, toast, modal, fmtDate, euros, plural, sides, matchTime, teamName, sportOf, icon, $, esc } from '../ui.js';
import { BYE, slotTime } from '../engine.js';
import { matchRow, rankingsView, startTimers } from './components.js';
import { charityCard, declareDonation } from './bar.js';

const TABS = [['matchs', 'Matchs', 'list'], ['classement', 'Classement', 'trophy'], ['infos', 'Infos', 'info'], ['buvette', 'Buvette', 'cup']];

export async function view(ctx) {
  const { t } = ctx;
  const tab = ctx.route.params[1] || 'matchs';
  const role = store.role(t.id); // {role:'team'|'volunteer'|'fan', teamId, pin}
  const me = role?.teamId || null;
  const body = tab === 'classement' ? rankingsView(ctx, { me }) : tab === 'infos' ? infos(ctx, role) : tab === 'buvette' ? buvette(ctx) : matches(ctx, role);
  return {
    title: t.name,
    html: html`<div class="portal">
      <header class="phead">
        <div class="row between"><a href="#/t/${t.id}" style="color:#fff;text-decoration:none"><h1>${t.name}</h1></a></div>
        <div class="meta">${fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' })}${t.venue ? ` · ${t.venue}` : ''}</div>
        <div class="whoami">
          ${role ? html`<span class="pill">${role.role === 'volunteer' ? '🙋 Bénévole' : role.role === 'team' ? `🏐 ${teamName(t, role.teamId)}` : `👀 Je suis ${teamName(t, role.teamId)}`}</span><button class="linkbtn" style="color:#fff" data-act="logout">Changer</button>`
          : html`<button class="btn ball sm" data-act="pick-team">Je suis une équipe</button><button class="btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="pin">J’ai un code</button>`}
        </div>
      </header>
      <main class="pbody">${body}</main>
      <nav class="bottomnav" aria-label="Portail">${TABS.map(([k, l, ic]) => html`<a href="#/t/${t.id}/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? raw('aria-current="page"') : ''}>${icon(ic)}${l}</a>`)}</nav>
    </div>`,
    mount(root) {
      const stop = startTimers(root);
      this.cleanup = stop;
      notifyIfSoon(ctx, me);
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'logout') { store.setRole(t.id, null); ctx.rerender(); }
        if (act === 'filter') { sessionStorage.setItem('rot:pf', b.dataset.f); ctx.rerender(); }
        if (act === 'pick-team') {
          const r = await modal({ title: 'Quelle est votre équipe ?', body: html`<label class="f">Équipe<select name="team" required><option value="">Choisir…</option>${t.teams.filter((x) => x.status === 'confirmed').sort((a, b) => a.name.localeCompare(b.name)).map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label><p class="hint" style="margin:0">Vous verrez vos matchs en premier. Pour saisir les scores, utilisez le code PIN de l’équipe.</p>`, ok: 'Suivre cette équipe' });
          if (r?.team) { store.setRole(t.id, { role: 'fan', teamId: r.team }); ctx.rerender(); askNotif(); }
        }
        if (act === 'pin') {
          const r = await modal({ title: 'Connexion', body: html`<label class="f">Code PIN de l’équipe ou code bénévole<input type="text" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" required autofocus></label><p class="hint" style="margin:0">Le code vous a été remis par l’organisation (à l’inscription ou à l’accueil).</p>`, ok: 'Se connecter' });
          if (!r) return;
          try { const role = await store.pinLogin(t.id, r.pin.trim()); store.setRole(t.id, role); toast(role.role === 'volunteer' ? 'Connecté en bénévole' : `Bienvenue ${role.name || ''}`, 'ok'); ctx.rerender(); askNotif(); } catch (err) { toast(err.message, 'err'); }
        }
        if (act === 'declare-don') declareDonation(t);
        if (act === 'score') location.hash = `#/match/${t.id}/${b.closest('[data-mid]').dataset.mid}`;
      });
      root.addEventListener('submit', async (e) => {
        if (e.target.dataset.form !== 'msg') return;
        e.preventDefault();
        const text = e.target.text.value.trim();
        if (!text) return;
        try { await store.message(t.id, me ? teamName(t, me) : 'Spectateur', text); e.target.reset(); toast('Message envoyé à l’organisation', 'ok'); } catch (err) { toast(err.message, 'err'); }
      });
    },
  };
}

function askNotif() {
  if ('Notification' in self && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

/** Nombre de matchs restant à jouer sur le terrain avant celui-ci. */
function before(t, m) {
  return t.matches.filter((x) => x.courtId === m.courtId && x.slot < m.slot && (x.status === 'scheduled' || x.status === 'live')).length;
}

function nextFor(ctx, me) {
  const { t, resolved } = ctx;
  const refOf = (m) => sides(t, m, resolved).referee;
  const mine = t.matches.filter((m) => m.status === 'scheduled' || m.status === 'live').filter((m) => { const s = sides(t, m, resolved); return s.a === me || s.b === me || s.referee === me; }).sort((a, b) => a.slot - b.slot);
  return { play: mine.find((m) => refOf(m) !== me), ref: mine.find((m) => refOf(m) === me) };
}

function matches(ctx, role) {
  const { t, resolved } = ctx;
  const me = role?.teamId;
  const canScore = role && (role.role === 'volunteer' || role.role === 'team');
  const f = sessionStorage.getItem('rot:pf') || (me ? 'mine' : 'all');
  if (!t.matches.length) return html`<div class="empty"><p><b>Le planning arrive bientôt.</b></p><p>Les matchs s’afficheront ici dès que l’organisation l’aura publié.</p></div>`;
  const { play, ref } = me ? nextFor(ctx, me) : {};
  const card = (m, isRef) => {
    const s = sides(t, m, resolved);
    const c = t.courts.find((x) => x.id === m.courtId);
    const n = before(t, m);
    const opp = s.a === me ? s.nameB : s.nameA;
    return html`<div class="mycard ${isRef ? 'ref' : ''}" style="--c:${c?.color}" data-mid="${m.id}">
      <span class="muted small">${isRef ? 'À arbitrer' : m.status === 'live' ? 'En cours' : 'Votre prochain match'} · ${matchTime(t, m)} · ${c?.name} ${sportOf(c).icon}</span>
      <div class="who">${isRef ? `${s.nameA} – ${s.nameB}` : `contre ${opp}`}</div>
      <div class="countdown">${m.status === 'live' ? 'C’est parti !' : n === 0 ? 'C’est à vous : rendez-vous sur le terrain' : `${plural(n, 'match')} avant le vôtre sur ce terrain`}</div>
      ${canScore && (isRef || role.role === 'team') ? html`<div><button class="btn ${isRef ? 'ball' : ''} sm" data-act="score">Ouvrir la feuille de match</button></div>` : ''}
    </div>`;
  };
  const filt = (m) => {
    if (m.status === 'bye') return false;
    if (f === 'mine') { const s = sides(t, m, resolved); return s.a === me || s.b === me || s.referee === me; }
    if (f === 'live') return m.status === 'live';
    if (f === 'next') return m.status === 'scheduled';
    if (f === 'done') return m.status === 'done';
    return true;
  };
  const list = t.matches.filter(filt).sort((a, b) => a.slot - b.slot || t.courts.findIndex((c) => c.id === a.courtId) - t.courts.findIndex((c) => c.id === b.courtId));
  const bySlot = {};
  for (const m of list) (bySlot[m.slot] ??= []).push(m);
  const action = canScore ? (m, s) => (s.a && s.b && s.a !== BYE && s.b !== BYE && m.status !== 'done' && (role.role === 'volunteer' || [s.a, s.b, s.referee].includes(me)) ? html`<button class="btn sm" data-act="score">Score</button>` : '') : null;
  return html`
    ${me ? html`<div class="stack" style="margin-bottom:1rem">${play ? card(play, false) : html`<div class="mycard"><b>Plus de match prévu pour l’instant.</b><span class="muted">Consultez le classement ou le tableau final.</span></div>`}${ref ? card(ref, true) : ''}</div>` : ''}
    <div class="filters">${Object.entries({ ...(me ? { mine: 'Mes matchs' } : {}), all: 'Tous', live: 'En cours', next: 'À venir', done: 'Terminés' }).map(([k, l]) => html`<button class="${f === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`)}</div>
    ${Object.keys(bySlot).length ? Object.entries(bySlot).map(([s, ms]) => html`<div class="slot-h"><h3>${slotTime(t, +s)}</h3><span class="muted small">Rotation ${+s + 1}</span></div>${ms.map((m) => matchRow(ctx, m, { me, action }))}`) : html`<p class="muted">Aucun match dans cette catégorie.</p>`}`;
}

function infos(ctx, role) {
  const { t } = ctx;
  const ch = t.charity;
  return html`<div class="stack">
    ${charityCard(t)}
    <div class="card"><h3>Infos pratiques</h3>
      <p><b>${fmtDate(t.date)}</b>, premier match à ${t.startTime}<br>${t.venue}${t.address ? html`<br><a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(t.address)}" target="_blank" rel="noopener">${t.address}</a>` : ''}</p>
      ${t.infos ? html`<p style="white-space:pre-line">${t.infos}</p>` : ''}
      ${(t.breaks || []).map((b) => html`<p class="small">☕ ${b.label || 'Pause'} de ${b.minutes} min vers ${slotTime(t, b.afterSlot + 1).replace(/^(\d+):(\d+)$/, (m0, h, mm) => { const x = +h * 60 + +mm - b.minutes; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; })}</p>`)}
      ${t.contact ? html`<p class="small">Contact : ${t.contact}</p>` : ''}
    </div>
    ${(t.announcements || []).length ? html`<div class="card"><h3>Annonces</h3>${t.announcements.slice().reverse().map((a) => html`<p><span class="muted small">${new Date(a.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span> ${a.text}</p>`)}</div>` : ''}
    <form class="card stack" data-form="msg"><h3>Écrire à l’organisation</h3><textarea name="text" maxlength="500" required placeholder="Une question, un retard, un problème sur un terrain…"></textarea><div><button class="btn">Envoyer</button></div></form>
    ${(t.sponsors || []).filter((s) => s.name).length ? html`<div class="card"><h3>Merci à nos partenaires</h3><div class="row">${t.sponsors.filter((s) => s.name).map((s) => (s.url ? html`<a class="pill" href="${s.url}" target="_blank" rel="noopener">${s.name}</a>` : html`<span class="pill">${s.name}</span>`))}</div></div>` : ''}
    <p class="small muted">${role?.role === 'team' ? '' : 'Organisateur ? '}<a href="#/admin/${t.id}">Espace organisateur</a></p>
  </div>`;
}

function buvette(ctx) {
  const items = (ctx.t.buvette || []).filter((b) => b.name);
  if (!items.length) return html`<div class="empty"><p>La carte de la buvette n’a pas encore été publiée.</p></div>`;
  return html`<div class="card"><h3>Buvette</h3><table class="t"><tbody>${items.map((b) => html`<tr><td>${b.name}</td><td class="n num" style="font-size:1.2rem">${euros(b.price)}</td></tr>`)}</tbody></table>
    ${ctx.t.charity?.enabled ? html`<p class="hint" style="margin:.75rem 0 0">Les bénéfices de la buvette sont reversés au ${ctx.t.charity.label}.</p>` : ''}</div>`;
}

/** Alerte (toast + vibration + notification) quand le match de l'équipe approche. */
function notifyIfSoon(ctx, me) {
  if (!me) return;
  const { play, ref } = nextFor(ctx, me);
  for (const [m, what] of [[play, 'jouer'], [ref, 'arbitrer']]) {
    if (!m || m.status !== 'scheduled') continue;
    const n = before(ctx.t, m);
    const key = `rot:notified:${m.id}:${what}`;
    if (n > 1 || sessionStorage.getItem(key)) continue;
    sessionStorage.setItem(key, '1');
    const c = ctx.t.courts.find((x) => x.id === m.courtId);
    const msg = n === 0 ? `C’est à vous de ${what} sur le ${c?.name} !` : `Préparez-vous : vous allez ${what} au prochain match sur le ${c?.name}.`;
    toast(`⏰ ${msg}`, 'ann');
    navigator.vibrate?.([200, 100, 200]);
    if ('Notification' in self && Notification.permission === 'granted') {
      try { new Notification(ctx.t.name, { body: msg, icon: 'icons/icon-192.png', tag: m.id }); } catch { /* */ }
    }
  }
}
