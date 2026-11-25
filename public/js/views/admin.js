import { store } from '../store.js';
import { html, raw, toStr, toast, modal, confirmBox, fmtDate, euros, plural, sides, scoreText, matchTime, teamName, sportOf, qrSvg, download, $, $$, esc } from '../ui.js';
import { buildSchedule, scheduleStats, scoringFor, setTarget, makeTeam, slotTime, SPORTS, BYE, pin4, uid, postponeTeam, currentSlot, startRotation, toggleRotation } from '../engine.js';
import { clock, elapsedOf } from '../time.js';
import { shell } from './shell.js';
import { sectionEssentials, sectionCourts, sectionFormat, sectionRules, sectionRegistration, applyField, previewDay, previewCard, formulaCompare, PROVIDERS } from './settings.js';
import { compareTable } from './home.js';
import { matchRow, courtTile, rankingsView, startTimers, STATUS } from './components.js';
import { posterCanvas, drawPoster } from './promo.js';
import { adminBuvette, adminCagnotte, barActions } from './bar.js';
import { feesSummary, teamDue, charityTotals } from '../money.js';
import { LEVELS, teamOptions, balanceTeams, applyTeams, suggestFormats, newPlayer } from '../club.js';

let drawSeed = 0;
const TABS = [
  ['apercu', 'Aperçu'],
  ['joueurs', 'Joueurs'],
  ['equipes', 'Équipes'],
  ['accueil', 'Accueil'],
  ['planning', 'Format & planning'],
  ['matchs', 'Matchs'],
  ['classement', 'Classements'],
  ['terrains', 'Terrains & QR'],
  ['inscriptions', 'Inscriptions & paiement'],
  ['buvette', 'Buvette'],
  ['cagnotte', 'Cagnotte'],
  ['promo', 'Promotion'],
  ['bilan', 'Bilan & export'],
];

export async function view(ctx) {
  const { t } = ctx;
  if (!store.isAdmin(t)) return loginView(ctx);
  const tab = ctx.route.params[1] || 'apercu';
  const unread = (t.messages || []).filter((m) => !m.read).length;
  const pendingTeams = t.teams.filter((x) => x.status === 'pending').length;
  const toValidate = t.matches.filter((m) => m.status === 'done' && t.scoreValidation && !m.validated).length;
  const donsPending = (t.charity?.donations || []).filter((d) => !d.validated && !d.rejected).length;
  const render = PANELS[tab] || PANELS.apercu;
  const tabs = TABS.filter(([k]) => k !== 'joueurs' || t.entry === 'players');
  const body = await render(ctx);
  let focusKeep = false;
  return {
    title: t.name,
    html: html`${shell({ title: t.name, right: html`<a class="btn ghost sm" href="#/t/${t.id}" target="_blank" rel="noopener">Portail</a><a class="btn ghost sm" href="#/live/${t.id}" target="_blank" rel="noopener">Grand écran</a>` })}
    <nav class="adminbar" aria-label="Administration"><div class="in"><div class="tabs">
      ${tabs.map(([k, l]) => html`<a href="#/admin/${t.id}/${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'apercu' && unread ? html`<span class="badge">${unread}</span>` : ''}${k === 'equipes' && pendingTeams ? html`<span class="badge">${pendingTeams}</span>` : ''}${k === 'matchs' && toValidate ? html`<span class="badge">${toValidate}</span>` : ''}${k === 'cagnotte' && donsPending ? html`<span class="badge">${donsPending}</span>` : ''}</a>`)}
    </div></div></nav>
    <main class="wrap" id="admin">${body}</main>`,
    mount(root) {
      const stop = startTimers(root);
      const cv = $('#poster', root);
      if (cv) drawPoster(cv, t, 'post', store.baseUrl());
      root.addEventListener('focusin', (e) => { if (e.target.matches('input,textarea,select')) focusKeep = true; });
      root.addEventListener('focusout', () => { focusKeep = false; });
      root.addEventListener('change', (e) => onChange(ctx, e));
      root.addEventListener('click', (e) => onClick(ctx, e));
      root.addEventListener('submit', (e) => onSubmit(ctx, e));
      this.cleanup = stop;
    },
    cleanup: null,
    keep: () => focusKeep,
  };
}

// ------------------------------------------------------------------ connexion organisateur
function loginView(ctx) {
  const { t } = ctx;
  return {
    title: t.name,
    html: html`${shell({ title: t.name })}<main class="wrap narrow"><form class="card stack" id="login" style="max-width:420px;margin:2rem auto">
      <h2>Espace organisateur</h2><p>Saisissez le code organisateur de « ${t.name} ».</p>
      <label class="f">Code organisateur<input type="password" name="pin" inputmode="numeric" autocomplete="current-password" required autofocus></label>
      <button class="btn">Entrer</button><a href="#/t/${t.id}">Voir le portail public</a></form></main>`,
    mount(root) {
      $('#login', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await store.login(t.id, e.target.pin.value.trim()); ctx.rerender(); } catch (err) { toast(err.message, 'err'); }
      });
    },
  };
}

// ------------------------------------------------------------------ helpers d'écriture
async function save(ctx, fn, msg) {
  try {
    await store.mutate(ctx.t.id, fn);
    if (msg) toast(msg, 'ok');
    if (store.mode === 'server') ctx.rerender();
  } catch (e) { toast(e.message, 'err'); }
}
const hasResults = (t) => t.matches.some((m) => m.status === 'done' || m.status === 'live');

// ------------------------------------------------------------------ onglets
const PANELS = {
  apercu(ctx) {
    const { t, resolved } = ctx;
    const playable = t.matches.filter((m) => m.status !== 'bye');
    const done = playable.filter((m) => m.status === 'done').length;
    const live = playable.filter((m) => m.status === 'live').length;
    const conf = t.teams.filter((x) => x.status === 'confirmed');
    const arrived = conf.filter((x) => x.checkedIn).length;
    const fee = +t.registration.fee || 0;
    const fs = feesSummary(t);
    const ch = t.charity?.enabled ? charityTotals(t) : null;
    const next = nextStep(ctx);
    const phases = phaseProgress(t);
    return html`
      <div class="next-step"><div style="flex:1;min-width:220px"><h3>${next.title}</h3><p>${next.text}</p></div>${next.action || ''}</div>
      ${rotationPanel(ctx)}
      ${store.reach() !== 'internet' && t.status !== 'done' ? html`<div class="card row between" style="margin-top:1rem;border-left:6px solid var(--ball)"><span><b>Pas de Wi-Fi au gymnase ?</b> Passez en ligne pour que les joueurs utilisent leur 4G.</span><a class="btn ghost sm" href="#/admin/${t.id}/terrains">Voir comment</a></div>` : ''}
      <div class="kpis section" style="margin-top:1rem">
        <div class="kpi"><div class="v">${conf.length}<span class="muted" style="font-size:1.2rem">/${t.registration.maxTeams}</span></div><div class="l">équipes confirmées</div></div>
        <div class="kpi"><div class="v">${arrived}</div><div class="l">équipes arrivées</div></div>
        <div class="kpi"><div class="v">${done}<span class="muted" style="font-size:1.2rem">/${playable.length}</span></div><div class="l">matchs joués${live ? ` · ${live} en cours` : ''}</div></div>
        ${fee ? html`<div class="kpi"><div class="v">${euros(fs.paid)}</div><div class="l">inscriptions encaissées sur ${euros(fs.due)}</div></div>` : ''}
        ${ch ? html`<a class="kpi" href="#/admin/${t.id}/cagnotte" style="text-decoration:none;color:inherit"><div class="v">${euros(ch.total)}</div><div class="l">cagnotte ${t.charity.label || ''}${ch.goal ? ` (objectif ${euros(ch.goal)})` : ''}</div></a>` : ''}
      </div>
      ${t.matches.length ? html`<section class="section"><div class="row between"><h2>Terrains</h2><a class="btn ghost sm" href="#/admin/${t.id}/matchs">Tous les matchs</a></div>
        <div class="courts-grid">${t.courts.filter((c) => c.active !== false).map((c) => courtTile(ctx, c, { link: `#/court/${t.id}/${c.id}` }))}</div></section>` : ''}
      <div class="grid2 section">
        <div class="card stack"><h3>Avancement</h3>
          ${phases.length ? html`<div class="phases">${phases.map((p) => html`<div class="phase"><b>${p.label}</b><span class="muted small">${p.done}/${p.total}</span><div class="bar"><i style="width:${p.total ? (100 * p.done) / p.total : 0}%"></i></div></div>`)}</div>` : html`<p class="muted">Le planning n’est pas encore généré.</p>`}
        </div>
        <div class="card stack"><h3>Annonce aux participants</h3>
          <form class="stack" data-form="announce"><textarea name="text" required maxlength="200" placeholder="Ex. : Les demi-finales commencent à 16 h sur le terrain 1."></textarea><div><button class="btn">Envoyer l’annonce</button></div></form>
          ${(t.announcements || []).slice(-3).reverse().map((a) => html`<div class="small"><span class="muted">${new Date(a.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span> ${a.text}</div>`)}
        </div>
      </div>
      ${(t.messages || []).length ? html`<div class="card section stack"><div class="row between"><h3 style="margin:0">Messages des équipes</h3><button class="btn ghost sm" data-act="read-all">Tout marquer comme lu</button></div>
        ${(t.messages || []).slice().reverse().slice(0, 20).map((m) => html`<div class="row" style="align-items:flex-start">${!m.read ? html`<span class="dot" style="--c:var(--loss);margin-top:7px"></span>` : ''}<div><b>${m.from}</b> <span class="muted small">${new Date(m.at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span><br>${m.text}</div></div>`)}</div>` : ''}
      <div class="card section"><h3>Liens utiles</h3><div class="row">
        <a class="btn ghost" href="#/t/${t.id}" target="_blank">Portail des joueurs</a>
        <a class="btn ghost" href="#/live/${t.id}" target="_blank">Grand écran</a>
        <a class="btn ghost" href="#/print/${t.id}/qr" target="_blank">Affiches QR des terrains</a>
        <a class="btn ghost" href="#/print/${t.id}/feuilles" target="_blank">Feuilles de match papier</a>
        <a class="btn ghost" href="#/p/${t.id}" target="_blank">Page de promotion</a>
      </div></div>`;
  },

  joueurs(ctx) {
    const { t } = ctx;
    const ps = (t.players || []).slice().sort((a, b) => (b.present - a.present) || a.name.localeCompare(b.name));
    const present = ps.filter((p) => p.present);
    const opts = teamOptions(present.length, t.courts.filter((c) => c.active !== false).length, 3, 6);
    const byLvl = Object.keys(LEVELS).map((l) => [l, present.filter((p) => +p.level === +l).length]);
    return html`<div class="row between"><h2 style="margin:0">Joueurs <span class="muted">${present.length} présents / ${ps.length} inscrits</span></h2>
        <div class="row"><a class="btn ghost" href="#/inscription/${t.id}" target="_blank">Formulaire d’inscription</a><label class="btn ghost">Importer Excel/CSV<input type="file" accept=".csv,.txt" data-act="players-import" hidden></label></div></div>
      <form class="card row" data-form="addplayer" style="margin-top:1rem;align-items:end">
        <label class="f" style="flex:2;min-width:180px">Inscription sur place<input type="text" name="name" required placeholder="Prénom Nom" autocomplete="off"></label>
        <label class="f" style="min-width:150px">Niveau<select name="level">${Object.entries(LEVELS).map(([k, l]) => html`<option value="${k}" ${k === '2' ? raw('selected') : ''}>${k} · ${l}</option>`)}</select></label>
        <label class="f" style="min-width:110px">Genre<select name="gender"><option value="">—</option><option value="F">Femme</option><option value="H">Homme</option></select></label>
        <button class="btn">Ajouter (présent)</button></form>
      <div class="grid2 section" style="margin-top:1rem">
        <div class="card tscroll" style="padding:.5rem"><table class="t"><thead><tr><th>Joueur</th><th>Niveau</th><th>Genre</th><th>Présent</th>${t.registration.fee ? html`<th>Payé</th>` : ''}<th></th></tr></thead>
          <tbody>${ps.map((p) => html`<tr data-player="${p.id}"><td class="teamname">${p.name}${p.source === 'online' ? html` <span class="pill small">en ligne</span>` : ''}</td>
            <td><select data-player-field="level">${Object.entries(LEVELS).map(([k, l]) => html`<option value="${k}" ${+p.level === +k ? raw('selected') : ''}>${k} · ${l}</option>`)}</select></td>
            <td><select data-player-field="gender"><option value="">—</option><option value="F" ${p.gender === 'F' ? raw('selected') : ''}>F</option><option value="H" ${p.gender === 'H' ? raw('selected') : ''}>H</option></select></td>
            <td><input type="checkbox" data-player-field="present" ${p.present ? raw('checked') : ''} aria-label="Présent"></td>
            ${t.registration.fee ? html`<td><input type="checkbox" data-player-field="paid" ${p.paid ? raw('checked') : ''} aria-label="Payé"></td>` : ''}
            <td><button class="btn danger sm" data-act="player-del" aria-label="Supprimer">✕</button></td></tr>`)}</tbody></table>
          ${!ps.length ? html`<p class="muted" style="padding:.5rem">Les inscriptions en ligne et sur place apparaissent ici.</p>` : ''}</div>
        <div class="stack">
          <div class="card stack"><h3 style="margin:0">Former les équipes</h3>
            <p class="small" style="margin:0">Présents par niveau : ${byLvl.map(([l, n]) => `${LEVELS[l]} ${n}`).join(' · ')}</p>
            ${opts.length ? html`<div class="stack" style="gap:.5rem">${opts.map((o, i) => html`<label class="tile" style="padding:.7rem"><input type="radio" name="teamsize" value="${o.teams}" ${i === 0 ? raw('checked') : ''}><b style="font-size:1.1rem">${o.label}</b><small>${o.fit === 2 ? 'Idéal : tous les terrains occupés, personne n’attend' : o.fit === 1 ? 'Une équipe au repos, qui arbitre' : o.resting ? `${o.resting} équipes au repos à chaque rotation` : ''}</small></label>`)}</div>
              <label class="check"><input type="checkbox" id="mixed" checked> Répartir aussi les femmes équitablement</label>
              <button class="btn ball" data-act="draw-teams">Tirer les équipes</button>`
            : html`<p class="muted" style="margin:0">Cochez au moins 6 joueurs présents.</p>`}
            ${t.teams.some((x) => x.source === 'tirage') ? html`<p class="hint" style="margin:0">Équipes actuelles : ${t.teams.length}. Un nouveau tirage les remplace (et efface le planning).</p>` : ''}
          </div>
        </div>
      </div>`;
  },

  accueil(ctx) {
    const { t, resolved } = ctx;
    const r = t.registration;
    const q = (ctx.route.query.q || '').toLowerCase();
    const teams = t.teams.filter((x) => x.status === 'confirmed' && (!q || x.name.toLowerCase().includes(q) || (x.players || []).join(' ').toLowerCase().includes(q))).sort((a, b) => (a.checkedIn ? 1 : 0) - (b.checkedIn ? 1 : 0) || a.name.localeCompare(b.name));
    const all = t.teams.filter((x) => x.status === 'confirmed');
    const fs = feesSummary(t);
    const nextOf = (id) => t.matches.filter((m) => m.status === 'scheduled' && [resolved[m.id]?.a, resolved[m.id]?.b].includes(id)).sort((a, b) => a.slot - b.slot)[0];
    return html`<div class="row between"><h2 style="margin:0">Accueil des équipes</h2><span class="muted">${all.filter((x) => x.checkedIn).length}/${all.length} équipes complètes · ${euros(fs.paid + fs.extra)} encaissés</span></div>
      <form data-form="search" class="row" style="margin:.8rem 0"><input type="search" name="q" value="${ctx.route.query.q || ''}" placeholder="Rechercher une équipe ou un joueur" style="max-width:420px"><button class="btn ghost sm">Rechercher</button></form>
      <div class="stack">${teams.map((x) => {
        const players = x.players || [];
        const present = x.present || [];
        const n = present.length;
        const enough = n >= (r.minPlayers || 1);
        const due = teamDue(t, x);
        const paid = x.payment === 'paid' || x.payment === 'onsite' || x.payment === 'free';
        const nm = nextOf(x.id);
        return html`<div class="card" data-team="${x.id}" style="border-left:6px solid ${x.checkedIn ? 'var(--win)' : x.late ? 'var(--ball)' : 'var(--line)'}">
          <div class="row between"><div><h3 style="margin:0">${x.name}</h3><span class="muted small">${x.captain}${x.phone ? html` · <a href="tel:${x.phone.replace(/\s/g, '')}">${x.phone}</a>` : ''}${nm ? ` · prochain match ${slotTime(t, nm.slot)}` : ''}</span></div>
            <div class="row">${x.checkedIn ? html`<span class="pill ok">Équipe complète</span>` : n ? html`<span class="pill warn">${n}/${r.minPlayers} joueurs</span>` : html`<span class="pill">Pas encore arrivée</span>`}${x.late ? html`<span class="pill warn">En retard</span>` : ''}</div></div>
          <div class="row" style="margin:.7rem 0">${players.map((p) => html`<button class="btn ${present.includes(p) ? '' : 'ghost'} sm" data-act="present" data-p="${p}" aria-pressed="${present.includes(p)}">${present.includes(p) ? '✓ ' : ''}${p}</button>`)}<button class="btn ghost sm" data-act="add-player">+ Joueur</button></div>
          <div class="row between">
            <div class="row">${r.fee ? html`<b class="num" style="font-size:1.4rem">${euros(due)}</b>${r.feeMode === 'player' ? html`<span class="hint">${n || players.length} joueurs × ${euros(r.fee)}</span>` : ''}
              ${paid ? html`<span class="pill ok">${x.payment === 'free' ? 'Offert' : `Payé${x.payMethod ? ` (${({ cash: 'espèces', card: 'carte', lydia: 'Lydia', check: 'chèque', online: 'en ligne' })[x.payMethod] || x.payMethod})` : ''}`}</span>${x.extraPaid ? html`<span class="pill ok">+ ${euros(x.extraPaid)} de don</span>` : ''}<button class="linkbtn small" data-act="unpay">Annuler</button>`
              : html`<button class="btn sm" data-act="pay" data-m="cash">Espèces</button><button class="btn sm" data-act="pay" data-m="card">Carte</button><button class="btn ghost sm" data-act="pay" data-m="lydia">Lydia</button>`}` : ''}</div>
            <div class="row">${!x.checkedIn ? html`<button class="btn ${x.late ? 'ball' : 'ghost'} sm" data-act="late">${x.late ? 'Décaler encore ses matchs' : 'En retard : décaler ses matchs'}</button>` : ''}${!enough && n ? html`<button class="linkbtn small" data-act="force-in">Valider quand même</button>` : ''}</div>
          </div></div>`;
      })}${!teams.length ? html`<p class="muted">Aucune équipe${q ? ' ne correspond' : ''}.</p>` : ''}</div>`;
  },

  equipes(ctx) {
    const { t } = ctx;
    const fee = +t.registration.fee || 0;
    const order = { confirmed: 0, pending: 1, waitlist: 2, withdrawn: 3 };
    const teams = t.teams.slice().sort((a, b) => order[a.status] - order[b.status] || (a.level || 2) - (b.level || 2) || a.name.localeCompare(b.name));
    const conf = t.teams.filter((x) => x.status === 'confirmed').length;
    return html`
      <div class="row between"><h2 style="margin:0">Équipes <span class="muted">${conf}/${t.registration.maxTeams}</span></h2>
        <div class="row"><button class="btn" data-act="team-add">Ajouter une équipe</button><button class="btn ghost" data-act="team-bulk">Ajouter une liste</button><label class="btn ghost">Importer Excel/CSV<input type="file" accept=".csv,.txt,.tsv" data-act="team-import" hidden></label></div></div>
      <p class="hint">Le niveau (1 = fort, 3 = débutant) sert à répartir équitablement les équipes dans les poules. Le PIN permet à l’équipe de se connecter au portail pour saisir ses scores.</p>
      ${t.teams.length ? html`<div class="card tscroll" style="padding:.5rem">
      <table class="t">
        <thead><tr><th>Équipe</th><th>Capitaine</th><th>Niveau</th><th>Statut</th>${fee ? html`<th>Paiement</th>` : ''}<th>Arrivée</th><th>PIN</th><th></th></tr></thead>
        <tbody>${teams.map((x) => html`<tr data-team="${x.id}" style="${x.status === 'withdrawn' ? 'opacity:.5' : ''}">
          <td><span class="teamname">${x.name}</span>${x.source === 'online' ? html` <span class="pill small">en ligne</span>` : ''}<br><span class="hint">${plural(x.players?.length || 0, 'joueur')}${x.ref ? ` · réf. ${x.ref}` : ''}</span></td>
          <td>${x.captain}<br><span class="hint">${x.phone || x.email || ''}</span></td>
          <td><select data-team-field="level" style="min-width:70px">${[1, 2, 3].map((l) => html`<option value="${l}" ${+x.level === l ? raw('selected') : ''}>${l}</option>`)}</select></td>
          <td><select data-team-field="status">${Object.entries({ confirmed: 'Confirmée', pending: 'À valider', waitlist: 'Liste d’attente', withdrawn: 'Désistée' }).map(([k, l]) => html`<option value="${k}" ${x.status === k ? raw('selected') : ''}>${l}</option>`)}</select></td>
          ${fee ? html`<td><span class="small muted">${euros(teamDue(t, x))}</span><select data-team-field="payment">${Object.entries({ unpaid: 'À payer', paid: 'Payé en ligne', onsite: 'Payé sur place', free: 'Offert' }).map(([k, l]) => html`<option value="${k}" ${x.payment === k ? raw('selected') : ''}>${l}</option>`)}</select></td>` : ''}
          <td><label class="check"><input type="checkbox" data-team-field="checkedIn" ${x.checkedIn ? raw('checked') : ''}> <span class="small">${x.checkedIn ? 'Arrivée' : 'Pas encore'}</span></label></td>
          <td class="num">${x.pin}</td>
          <td><div class="row" style="flex-wrap:nowrap"><button class="btn ghost sm" data-act="team-edit">Modifier</button><button class="btn danger sm" data-act="team-del" aria-label="Supprimer ${x.name}">✕</button></div></td>
        </tr>`)}</tbody></table></div>` : html`<div class="empty"><p><b>Aucune équipe.</b> Ajoutez-les à la main, collez une liste ou ouvrez les inscriptions en ligne.</p></div>`}
      ${t.matches.length && t.teams.some((x) => x.status === 'confirmed' && !t.matches.some((m) => m.teamA === x.id || m.teamB === x.id)) ? html`<div class="next-step section"><p style="flex:1">Des équipes confirmées ne sont pas encore dans le planning.</p><a class="btn" href="#/admin/${t.id}/planning">Regénérer le planning</a></div>` : ''}`;
  },

  planning(ctx) {
    const { t } = ctx;
    const p = previewDay(t);
    const compare = t.format.type === 'roundrobin' ? formulaCompare(t) : null;
    const sugg = t.endTime && t.teams.filter((x) => x.status === 'confirmed').length >= 2 ? suggestFormats(t).slice(0, 6) : null;
    return html`<div class="wizard">
      <div class="stack">
        ${sugg ? html`<div class="card stack"><div><h2 style="margin:0">Formules conseillées</h2><p class="hint" style="margin:0">${t.teams.filter((x) => x.status === 'confirmed').length} équipes, ${t.courts.filter((c) => c.active !== false).length} terrains, de ${t.startTime} à ${t.endTime}, rotations de ${t.slotMinutes} min. Les plus riches en matchs d’abord.</p></div>
          <div class="tscroll"><table class="t"><thead><tr><th>Formule</th><th class="n">Matchs</th><th class="n">Min. par équipe</th><th class="n">Fin</th><th></th></tr></thead><tbody>
          ${sugg.map((x) => html`<tr class="${x.fits ? '' : 'muted'}"><td><b>${x.label}</b></td><td class="n">${x.matches}</td><td class="n">${x.minPerTeam}</td><td class="n"><b style="${x.fits ? '' : 'color:var(--loss)'}">${x.end}</b>${x.fits ? '' : ' (trop tard)'}</td>
            <td><button class="btn ${x.fits ? '' : 'ghost'} sm" data-act="use-format" data-f="${JSON.stringify(x.format)}">Choisir</button></td></tr>`)}</tbody></table></div></div>` : ''}
        <form class="card stack" onsubmit="return false"><h2>Format</h2>${sectionFormat(t)}${compare && !sugg ? compareTable(compare, t) : ''}</form>
        <form class="card stack" onsubmit="return false"><h2>Règles et horaires</h2>${sectionRules(t)}</form>
        <div class="card stack">
          <div class="row between"><h2 style="margin:0">Planning</h2>
            <div class="row">${t.matches.length ? html`<a class="btn ghost sm" href="#/print/${t.id}/planning" target="_blank">Imprimer</a>` : ''}<button class="btn ball" data-act="generate">${t.matches.length ? 'Regénérer le planning' : 'Générer le planning'}</button></div></div>
          ${t.matches.length ? planningGrid(ctx) : html`<p class="muted">Ajoutez vos équipes puis générez le planning : poules, terrains, horaires et arbitres sont calculés automatiquement.</p>`}
        </div>
      </div>
      ${previewCard(t, p)}
    </div>`;
  },

  matchs(ctx) {
    const { t } = ctx;
    if (!t.matches.length) return html`<div class="empty"><p>Pas encore de matchs.</p><a class="btn" href="#/admin/${t.id}/planning">Générer le planning</a></div>`;
    const f = ctx.route.query.f || 'all';
    const slots = [...new Set(t.matches.filter((m) => m.slot != null).map((m) => m.slot))].sort((a, b) => a - b);
    const filt = (m) => f === 'all' || m.status === f || (f === 'validate' && m.status === 'done' && t.scoreValidation && !m.validated);
    return html`${rotationPanel(ctx)}<div class="row between" style="margin-top:1rem"><h2 style="margin:0">Matchs</h2>
      <div class="filters">${Object.entries({ all: 'Tous', live: 'En cours', scheduled: 'À venir', done: 'Terminés', ...(t.scoreValidation ? { validate: 'À valider' } : {}) }).map(([k, l]) => html`<button class="${f === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`)}</div></div>
      ${slots.map((s) => {
        const ms = t.matches.filter((m) => m.slot === s && m.status !== 'bye' && filt(m)).sort((a, b) => t.courts.findIndex((c) => c.id === a.courtId) - t.courts.findIndex((c) => c.id === b.courtId));
        if (!ms.length) return '';
        const brk = (t.breaks || []).find((b) => b.afterSlot === s - 1);
        return html`${brk ? html`<div class="pill warn" style="margin-top:1rem">☕ ${brk.label || 'Pause'} · ${brk.minutes} min</div>` : ''}
          <div class="slot-h"><h3>Rotation ${s + 1}</h3><span class="muted">${slotTime(t, s)}</span>${restingTeams(ctx, s)}</div>
          ${ms.map((m) => matchRow(ctx, m, { action: adminActions }))}`;
      })}`;
  },

  classement(ctx) {
    return html`<div class="row between"><h2 style="margin:0">Classements</h2><a class="btn ghost sm" href="#/print/${ctx.t.id}/classement" target="_blank">Imprimer</a></div><div class="section" style="margin-top:1rem">${rankingsView(ctx)}</div>`;
  },

  terrains(ctx) {
    const { t } = ctx;
    const base = store.baseUrl();
    return html`<div class="stack">
      <form class="card stack" onsubmit="return false"><h2>Terrains</h2>${sectionCourts(t)}</form>
      <div class="card stack">
        <div class="row between"><h2 style="margin:0">QR codes des feuilles de match</h2><a class="btn" href="#/print/${t.id}/qr" target="_blank">Imprimer les affiches</a></div>
        <p class="hint">Collez une affiche au poteau de chaque terrain : en la scannant, les joueurs (ou l’arbitre) ouvrent directement la feuille du match en cours sur ce terrain et comptent les points.</p>
        <div class="grid3">${t.courts.filter((c) => c.active !== false).map((c) => {
          const url = `${base}#/court/${t.id}/${c.id}?k=${c.token}`;
          return html`<div class="qrbox card flat"><span class="pill cc" style="--c:${c.color}">${sportOf(c).icon} ${c.name}</span><div class="qr">${qrSvg(url)}</div><a class="small" href="${url}" target="_blank">Ouvrir la feuille</a></div>`;
        })}</div>
      </div>
      <div class="grid2">
        <div class="card stack"><h3>Portail joueurs et grand écran</h3>
          <div class="row" style="align-items:flex-start"><div class="qr" style="width:130px">${qrSvg(`${base}#/t/${t.id}`)}</div><div class="stack" style="flex:1"><p class="small" style="margin:0">Le portail : matchs, classements, infos. Les équipes s’y connectent avec leur PIN.</p><code class="small" style="word-break:break-all">${base}#/t/${t.id}</code></div></div>
          <p class="small" style="margin:0">Code bénévole (peut saisir tous les scores) : <b class="num" style="font-size:1.2rem">${t.volunteerPin}</b> <button class="linkbtn small" data-act="new-vpin">Changer</button></p>
        </div>
${connexionCard(t)}
      </div>
    </div>`;
  },

  inscriptions(ctx) {
    const { t } = ctx;
    const base = store.baseUrl();
    const url = `${base}#/inscription/${t.id}`;
    const fee = +t.registration.fee || 0;
    const conf = t.teams.filter((x) => x.status === 'confirmed');
    const byN = (k) => conf.filter((x) => x.payment === k).length;
    const byE = (k) => conf.filter((x) => x.payment === k).reduce((a, x) => a + teamDue(t, x), 0);
    return html`<div class="wizard">
      <form class="card stack" onsubmit="return false"><h2>Inscriptions et paiement</h2>${sectionRegistration(t)}</form>
      <aside class="stack">
        <div class="card qrbox"><h3>Formulaire d’inscription</h3><div class="qr">${qrSvg(url)}</div><a class="small" href="#/inscription/${t.id}" target="_blank">Ouvrir le formulaire</a><button class="btn ghost sm" data-act="copy" data-text="${url}">Copier le lien</button></div>
        ${fee ? html`<div class="card"><h3>Paiements</h3><table class="t"><tbody>
          <tr><td>Payé en ligne</td><td class="n">${byN('paid')}</td><td class="n">${euros(byE('paid'))}</td></tr>
          <tr><td>Payé sur place</td><td class="n">${byN('onsite')}</td><td class="n">${euros(byE('onsite'))}</td></tr>
          <tr><td>À payer</td><td class="n">${byN('unpaid')}</td><td class="n" style="color:var(--loss)">${euros(byE('unpaid'))}</td></tr>
          <tr><td>Offert</td><td class="n">${byN('free')}</td><td class="n">—</td></tr></tbody></table>
          <p class="hint">Rapprochez les paiements avec la référence de l’équipe (réf. affichée dans la liste et transmise au lien de paiement).</p></div>` : ''}
      </aside></div>`;
  },

  buvette: (ctx) => adminBuvette(ctx),
  cagnotte: (ctx) => adminCagnotte(ctx),

  promo(ctx) {
    const { t } = ctx;
    const base = store.baseUrl();
    const url = store.mode === 'server' ? `${base.replace(/\/$/, '')}/p/${t.id}`.replace(/\/\/p\//, '/p/') : `${base}#/p/${t.id}`;
    return html`<div class="wizard">
      <div class="stack">
        <form class="card stack" onsubmit="return false"><h2>Page de promotion</h2>${sectionEssentials(t)}
          <div class="grid3">
            <label class="f">Facebook<input type="url" data-path="social.facebook" value="${t.social?.facebook}" placeholder="https://facebook.com/…"></label>
            <label class="f">Instagram<input type="url" data-path="social.instagram" value="${t.social?.instagram}" placeholder="https://instagram.com/…"></label>
            <label class="f">Site web<input type="url" data-path="social.website" value="${t.social?.website}"></label>
          </div>
          <label class="f">Couleur de l’affiche<input type="color" data-path="theme" value="${t.theme || '#0B6E2E'}" style="width:60px;height:40px;padding:0;border:0"></label>
        </form>
        <div class="card stack"><h3>Partenaires</h3><p class="hint" style="margin:0">Leurs noms défilent sur le grand écran et apparaissent sur la page de promotion.</p>
          ${(t.sponsors || []).map((b, i) => html`<div class="row"><input type="text" data-path="sponsors.${i}.name" value="${b.name}" placeholder="Nom" style="flex:1"><input type="url" data-path="sponsors.${i}.url" value="${b.url || ''}" placeholder="Site (facultatif)" style="flex:1"><button class="btn danger sm" data-act="rm-sponsor" data-i="${i}">✕</button></div>`)}
          <div><button class="btn ghost sm" data-act="add-sponsor">Ajouter un partenaire</button></div></div>
      </div>
      <aside class="stack">
        <div class="card stack"><h3>Affiche réseaux sociaux</h3><canvas id="poster" width="1080" height="1350" class="poster-preview" aria-label="Aperçu de l’affiche"></canvas>
          <div class="row"><button class="btn" data-act="poster-dl" data-format="post">Télécharger (Instagram 4:5)</button><button class="btn ghost" data-act="poster-dl" data-format="story">Format story</button></div></div>
        <div class="card stack"><h3>Partager</h3><code class="small" style="word-break:break-all">${url}</code>
          <div class="share">
            <a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
            <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${t.name} — ${fmtDate(t.date)} : inscrivez votre équipe ! ${url}`)}">WhatsApp</a>
            <a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}">LinkedIn</a>
            <button class="btn ghost sm" data-act="copy" data-text="${url}">Copier le lien</button>
            <a class="btn ghost sm" href="#/p/${t.id}" target="_blank">Voir la page</a>
          </div></div>
      </aside></div>`;
  },

  bilan(ctx) {
    const { t } = ctx;
    const st = stats(ctx);
    return html`<div class="stack">
      <h2>Bilan</h2>
      <div class="kpis">
        <div class="kpi"><div class="v">${st.played}</div><div class="l">matchs joués</div></div>
        <div class="kpi"><div class="v">${st.avgDur ? `${st.avgDur} min` : '—'}</div><div class="l">durée moyenne réelle</div></div>
        <div class="kpi"><div class="v">${st.maxWait} min</div><div class="l">plus longue attente entre 2 matchs</div></div>
        <div class="kpi"><div class="v">${st.avgGap}</div><div class="l">écart moyen au score</div></div>
      </div>
      <div class="card tscroll"><h3>Par équipe</h3><table class="t"><thead><tr><th>Équipe</th><th class="n">Matchs</th><th class="n">Arbitrages</th><th class="n">Attente max</th>${t.courts.length > 1 ? t.courts.map((c) => html`<th class="n">${sportOf(c).icon}</th>`) : ''}</tr></thead>
        <tbody>${st.rows.map((r) => html`<tr><td class="teamname">${r.name}</td><td class="n">${r.matches}</td><td class="n">${r.refs}</td><td class="n">${r.wait} min</td>${t.courts.length > 1 ? t.courts.map((c) => html`<td class="n">${r.courts[c.id] || 0}</td>`) : ''}</tr>`)}</tbody></table></div>
      <div class="card stack"><h3>Exporter et sauvegarder</h3>
        <div class="row">
          <button class="btn" data-act="export-xls">Export Excel (équipes, matchs, classements)</button>
          <button class="btn ghost" data-act="export-csv">Équipes en CSV</button>
          <button class="btn ghost" data-act="export-json">Sauvegarde complète (.json)</button>
          <label class="btn ghost">Restaurer une sauvegarde<input type="file" accept=".json" data-act="import-json" hidden></label>
        </div>
        <p class="hint" style="margin:0">Faites une sauvegarde en cours de journée : c’est votre roue de secours.</p></div>
      <div class="card stack" style="border:1.5px solid #F0C4C4"><h3>Zone sensible</h3><div class="row">
        <button class="btn danger" data-act="reset-scores">Effacer tous les scores</button>
        <button class="btn danger" data-act="delete">Supprimer le tournoi</button></div>
        ${store.mode === 'server' ? html`<p class="hint" style="margin:0">Code organisateur : <b>${t.adminPin}</b></p>` : ''}</div>
    </div>`;
  },
};

// ------------------------------------------------------------------ fragments
/** Pilotage de la rotation en cours : un bouton lance tous les matchs (et leurs chronos) d'un coup. */
function rotationPanel(ctx) {
  const { t, resolved } = ctx;
  const slot = currentSlot(t);
  if (slot == null || !t.matches.length) return '';
  const ms = t.matches.filter((m) => m.slot === slot && m.status !== 'bye');
  const ready = ms.filter((m) => m.status === 'scheduled' && resolved[m.id]?.a && resolved[m.id]?.b);
  const live = ms.filter((m) => m.status === 'live');
  const timed = live.find((m) => m.timer);
  const dur = timed ? scoringFor(t, timed).durationMin : 0;
  const over = timed && elapsedOf(timed.timer) >= dur * 60000;
  const done = ms.filter((m) => m.status === 'done').length;
  return html`<div class="card row between" style="margin-top:1rem;background:var(--ink);color:#fff;gap:1rem">
    <div><div style="opacity:.75" class="small">Rotation ${slot + 1} · prévue à ${slotTime(t, slot)} · ${ms.length} matchs${done ? ` · ${done} terminés` : ''}</div>
      ${timed ? html`<div class="num" style="font-size:3rem;line-height:1;color:${over ? 'var(--ball)' : '#fff'}" data-timer="${JSON.stringify(timed.timer)}" data-dur="${dur}">⏱</div>`
      : live.length ? html`<div class="num" style="font-size:1.8rem">En cours</div>` : html`<div class="num" style="font-size:1.8rem">Prête à démarrer</div>`}</div>
    <div class="row">
      ${ready.length ? html`<button class="btn ball" style="min-height:56px;font-size:1.15rem" data-act="rot-start" data-slot="${slot}">▶ Lancer la rotation ${slot + 1}</button>` : ''}
      ${timed && timed.timer.running ? html`<button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="rot-pause" data-slot="${slot}">Pause</button>` : ''}
      ${timed && !timed.timer.running ? html`<button class="btn ball" data-act="rot-resume" data-slot="${slot}">Reprendre</button>` : ''}
      <a class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" href="#/admin/${t.id}/matchs?f=live">Scores</a>
    </div></div>`;
}

/** Comment les téléphones des joueurs rejoignent l'application (4G, Wi-Fi local, ou ce navigateur seul). */
function connexionCard(t) {
  const reach = store.reach();
  const base = store.baseUrl();
  const custom = store.LS.get('rot:baseUrl', '');
  return html`<form class="card stack" data-form="baseurl"><h3 style="margin:0">Connexion des téléphones</h3>
    ${reach === 'internet' ? html`<p class="pill ok" style="justify-self:start">En ligne : les joueurs utilisent leur 4G</p>
      <p style="margin:0">Adresse publique : <b style="word-break:break-all">${base}</b></p>
      <p class="hint" style="margin:0">Les QR codes utilisent cette adresse. Avec un tunnel sans compte, elle change à chaque lancement du serveur : imprimez les affiches QR une fois le serveur démarré.</p>`
    : reach === 'lan' ? html`<p class="pill warn" style="justify-self:start">Réseau local uniquement</p>
      <p style="margin:0">Les téléphones doivent être sur le même Wi-Fi que cet ordinateur. <b>Pas de Wi-Fi au gymnase ?</b> Connectez l’ordinateur au partage de connexion de votre téléphone, puis relancez le serveur avec <code>npm run en-ligne</code> : il devient accessible en 4G pour tout le monde.</p>`
    : html`<p class="pill warn" style="justify-self:start">Mode autonome</p>
      <p style="margin:0">Les données restent dans ce navigateur. Pour que les joueurs saisissent les scores sur leur téléphone, lancez le serveur Rotation (<code>npm run en-ligne</code>, voir le guide).</p>`}
    <details ${custom ? raw('open') : ''}><summary class="small">Forcer une autre adresse pour les QR codes</summary>
      <div class="stack" style="margin-top:.5rem"><input type="url" name="url" value="${custom}" placeholder="https://mon-tournoi.exemple.fr/"><div><button class="btn ghost sm">Enregistrer</button></div></div></details>
  </form>`;
}

function nextStep(ctx) {
  const { t } = ctx;
  const conf = t.teams.filter((x) => x.status === 'confirmed').length;
  const pending = t.teams.filter((x) => x.status === 'pending').length;
  const playable = t.matches.filter((m) => m.status !== 'bye');
  const a = (href, label) => html`<a class="btn" href="${href}">${label}</a>`;
  if (t.entry === 'players' && conf < 2) return { title: 'Inscrivez les joueurs, puis tirez les équipes', text: `${(t.players || []).length} joueurs inscrits, ${(t.players || []).filter((p) => p.present).length} présents. Pointez les présents et ajoutez ceux qui s’inscrivent sur place.`, action: a(`#/admin/${t.id}/joueurs`, 'Gérer les joueurs') };
  if (conf < 2) return { title: 'Ajoutez vos équipes', text: t.registration.open ? 'Les inscriptions en ligne sont ouvertes. Vous pouvez aussi ajouter les équipes à la main.' : 'Ajoutez les équipes à la main ou ouvrez les inscriptions en ligne.', action: a(`#/admin/${t.id}/equipes`, 'Ajouter des équipes') };
  if (pending) return { title: `${plural(pending, 'inscription')} à valider`, text: 'Des équipes attendent votre validation.', action: a(`#/admin/${t.id}/equipes`, 'Voir les équipes') };
  if (!t.matches.length) return { title: 'Générez le planning', text: `${conf} équipes confirmées. Vérifiez le format puis générez les matchs.`, action: a(`#/admin/${t.id}/planning`, 'Générer le planning') };
  const live = playable.filter((m) => m.status === 'live').length;
  const done = playable.filter((m) => m.status === 'done').length;
  if (done === playable.length) return { title: 'Tournoi terminé 🎉', text: 'Tous les matchs sont joués. Place au podium et à la sauvegarde.', action: a(`#/admin/${t.id}/classement`, 'Voir le podium') };
  if (!live && !done) return { title: 'Prêt à jouer', text: 'Pointez les arrivées, collez les QR codes sur les terrains et lancez le grand écran.', action: a(`#/print/${t.id}/qr`, 'Imprimer les QR codes') };
  const nextM = playable.filter((m) => m.status === 'scheduled').sort((a, b) => a.slot - b.slot)[0];
  return { title: `${live} match${live > 1 ? 's' : ''} en cours`, text: nextM ? `Prochaine rotation à ${slotTime(t, nextM.slot)}. ${done}/${playable.length} matchs joués.` : `${done}/${playable.length} matchs joués.`, action: a(`#/admin/${t.id}/matchs?f=live`, 'Suivre les matchs') };
}

function phaseProgress(t) {
  const groups = {};
  for (const m of t.matches.filter((x) => x.status !== 'bye')) {
    const k = m.phase === 'pool' ? (t.format.type === 'roundrobin' ? (m.leg > 1 ? `Championnat · manche ${m.leg}` : 'Championnat') : 'Poules') : m.bracketName;
    groups[k] ??= { label: k, total: 0, done: 0 };
    groups[k].total++;
    if (m.status === 'done') groups[k].done++;
  }
  return Object.values(groups);
}

function restingTeams(ctx, s) {
  const { t } = ctx;
  const ms = t.matches.filter((m) => m.slot === s);
  if (ms.some((m) => m.phase !== 'pool')) return '';
  const busy = new Set(ms.flatMap((m) => [m.teamA, m.teamB]));
  const rest = t.teams.filter((x) => x.status === 'confirmed' && !busy.has(x.id));
  return rest.length && rest.length <= 4 ? html`<span class="pill">Au repos : ${rest.map((x) => x.name).join(', ')}</span>` : '';
}

function adminActions(m, s) {
  const can = s.a && s.b && s.a !== BYE && s.b !== BYE;
  if (!can) return '';
  return html`<div class="row" style="flex-wrap:nowrap">
    ${m.status === 'scheduled' ? html`<button class="btn ghost sm" data-act="m-start">Lancer</button>` : ''}
    <button class="btn ${m.status === 'done' ? 'ghost' : ''} sm" data-act="m-score">${m.status === 'done' ? 'Corriger' : 'Score'}</button>
    ${m.status === 'done' && !m.validated ? html`<button class="btn ghost sm" data-act="m-validate">Valider</button>` : ''}
  </div>`;
}

function planningGrid(ctx) {
  const { t, resolved } = ctx;
  const courts = t.courts.filter((c) => c.active !== false);
  const slots = [...new Set(t.matches.filter((m) => m.slot != null).map((m) => m.slot))].sort((a, b) => a - b);
  const st = scheduleStats(t);
  return html`<p class="small muted" style="margin:0">${st.matches} matchs · ${st.slots} rotations · fin vers <b>${st.end}</b></p>
  <div class="tscroll"><table class="t"><thead><tr><th>Heure</th>${courts.map((c) => html`<th><span class="dot" style="--c:${c.color}"></span> ${c.name} ${sportOf(c).icon}</th>`)}</tr></thead>
  <tbody>${slots.map((s) => html`<tr><td class="num">${slotTime(t, s)}</td>${courts.map((c) => {
    const m = t.matches.find((x) => x.slot === s && x.courtId === c.id);
    if (!m) return html`<td></td>`;
    const sd = sides(t, m, resolved);
    return html`<td><span class="${sd.tbdA ? 'muted' : ''}">${sd.nameA}</span> – <span class="${sd.tbdB ? 'muted' : ''}">${sd.nameB}</span>${m.referee ? html`<br><span class="hint">Arb. ${teamName(t, m.referee)}</span>` : ''}${m.phase === 'bracket' ? html`<br><span class="hint">${m.label}</span>` : ''}</td>`;
  })}</tr>`)}</tbody></table></div>`;
}

function stats(ctx) {
  const { t } = ctx;
  const done = t.matches.filter((m) => m.status === 'done');
  const durs = done.filter((m) => m.startedAt && m.finishedAt).map((m) => (new Date(m.finishedAt) - new Date(m.startedAt)) / 60000).filter((d) => d > 0 && d < 180);
  const gaps = done.map((m) => { const s = (m.sets || []).reduce((a, x) => [a[0] + (+x[0] || 0), a[1] + (+x[1] || 0)], [0, 0]); return Math.abs(s[0] - s[1]); });
  const rows = t.teams.filter((x) => x.status === 'confirmed').map((x) => {
    const ms = t.matches.filter((m) => (m.teamA === x.id || m.teamB === x.id) && m.slot != null).sort((a, b) => a.slot - b.slot);
    let wait = 0;
    for (let i = 1; i < ms.length; i++) wait = Math.max(wait, (ms[i].slot - ms[i - 1].slot - 1) * t.slotMinutes);
    const courts = {};
    for (const m of ms) courts[m.courtId] = (courts[m.courtId] || 0) + 1;
    return { name: x.name, matches: ms.length, refs: t.matches.filter((m) => m.referee === x.id).length, wait, courts };
  });
  return {
    played: done.length,
    avgDur: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    avgGap: gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : '—',
    maxWait: Math.max(0, ...rows.map((r) => r.wait)),
    rows,
  };
}

// ------------------------------------------------------------------ événements
async function onChange(ctx, e) {
  const el = e.target;
  const { t } = ctx;
  if (el.dataset.path) {
    let regen = false;
    await save(ctx, (d) => { regen = applyField(d, el); });
    if (regen && hasResults(t)) toast('Réglage enregistré. Le planning actuel est conservé : regénérez-le pour l’appliquer.');
    if (store.mode === 'local') ctx.rerender();
    return;
  }
  if (el.dataset.teamField) {
    const id = el.closest('[data-team]').dataset.team;
    const f = el.dataset.teamField;
    const v = el.type === 'checkbox' ? el.checked : f === 'level' ? +el.value : el.value;
    await save(ctx, (d) => { const x = d.teams.find((y) => y.id === id); x[f] = v; if (f === 'status' && v === 'confirmed' && x.payment === 'free' && d.registration.fee) x.payment = 'unpaid'; });
    if (store.mode === 'local') ctx.rerender();
    return;
  }
  if (el.dataset.playerField) {
    const id = el.closest('[data-player]').dataset.player;
    const f = el.dataset.playerField;
    const v = el.type === 'checkbox' ? el.checked : f === 'level' ? +el.value : el.value;
    await save(ctx, (d) => { d.players.find((p) => p.id === id)[f] = v; });
    if (store.mode === 'local') ctx.rerender();
    return;
  }
  if (el.dataset.act === 'players-import' && el.files[0]) {
    const lines = (await el.files[0].text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
    const hasHead = /nom|name|joueur/i.test(rows[0][0]);
    await save(ctx, (d) => { d.players ??= []; for (const r of rows.slice(hasHead ? 1 : 0)) if (r[0] && !d.players.some((p) => p.name.toLowerCase() === r[0].toLowerCase())) d.players.push(newPlayer(r[0], { level: Math.min(4, Math.max(1, +r[1] || 2)), gender: /^f/i.test(r[2] || '') ? 'F' : /^[hm]/i.test(r[2] || '') ? 'H' : '' })); }, 'Joueurs importés');
    return ctx.rerender();
  }
  if (el.dataset.act === 'team-import' && el.files[0]) return importTeams(ctx, await el.files[0].text());
  if (el.dataset.act === 'import-json' && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!data.teams || !data.matches) throw new Error('Fichier non reconnu');
      if (!(await confirmBox('Restaurer la sauvegarde ?', `« ${data.name} » remplacera le contenu actuel de ce tournoi.`, 'Restaurer'))) return;
      await save(ctx, (d) => ({ ...data, id: d.id, adminPin: d.adminPin, version: d.version }), 'Sauvegarde restaurée');
      ctx.rerender();
    } catch (err) { toast(err.message, 'err'); }
  }
}

async function onSubmit(ctx, e) {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'announce') {
    const text = e.target.text.value.trim();
    if (!text) return;
    await save(ctx, (d) => { (d.announcements ??= []).push({ id: uid(5), text, at: new Date().toISOString() }); d.announcements = d.announcements.slice(-20); }, 'Annonce envoyée');
    ctx.rerender();
  }
  if (f === 'addplayer') {
    const fm = e.target;
    const name = fm.name.value.trim();
    if (!name) return;
    await save(ctx, (d) => { (d.players ??= []).push(newPlayer(name, { level: +fm.level.value, gender: fm.gender.value, present: true, source: 'surplace' })); }, `${name} ajouté`);
    ctx.rerender();
    setTimeout(() => document.querySelector('form[data-form=addplayer] input[name=name]')?.focus(), 50);
    return;
  }
  if (f === 'search') { location.hash = `#/admin/${ctx.t.id}/accueil?q=${encodeURIComponent(e.target.q.value)}`; return; }
  if (f === 'baseurl') { store.setBaseUrl(e.target.url.value.trim()); toast('Adresse enregistrée', 'ok'); ctx.rerender(); }
}

async function onClick(ctx, e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  const { t } = ctx;
  const act = b.dataset.act;
  const mid = b.closest('[data-mid]')?.dataset.mid;
  const tid = b.closest('[data-team]')?.dataset.team;
  const rr = () => ctx.rerender();

  if (await barActions(ctx, act, b, (fn, msg) => save(ctx, fn, msg).then(rr))) return;
  switch (act) {
    case 'present': case 'add-player': case 'pay': case 'unpay': case 'late': case 'force-in': {
      const x = t.teams.find((y) => y.id === tid);
      if (act === 'add-player') {
        const r = await modal({ title: `Ajouter un joueur à ${x.name}`, body: html`<label class="f">Prénom et nom<input type="text" name="p" required maxlength="60"></label>`, ok: 'Ajouter et pointer' });
        if (!r) return;
        await save(ctx, (d) => { const y = d.teams.find((z) => z.id === tid); y.players = [...(y.players || []), r.p.trim()]; y.present = [...(y.present || []), r.p.trim()]; y.checkedIn = y.present.length >= (d.registration.minPlayers || 1); });
        return rr();
      }
      if (act === 'pay') {
        const due = teamDue(t, x);
        const r = await modal({ title: `Encaisser ${x.name}`, body: html`<p class="num" style="font-size:2.6rem;text-align:center;margin:0">${euros(due)}</p>${b.dataset.m === 'card' ? html`<p class="hint" style="text-align:center;margin:0">Tapez ce montant sur le TPE, validez ici une fois accepté.</p>` : ''}
          <label class="f">Don en plus (facultatif, €)<input type="number" name="extra" min="0" step="1" value=""></label>`, ok: 'Paiement reçu' });
        if (!r) return;
        await save(ctx, (d) => { const y = d.teams.find((z) => z.id === tid); y.payment = 'onsite'; y.payMethod = b.dataset.m; y.extraPaid = +r.extra || 0; y.paidAt = new Date().toISOString(); }, 'Paiement enregistré');
        return rr();
      }
      if (act === 'late') {
        let res;
        await save(ctx, (d) => { const y = d.teams.find((z) => z.id === tid); y.late = true; res = postponeTeam(d, tid); if (res.error) throw new Error(res.error); });
        if (res && !res.error) toast(res.rotation ? `Rotations ${res.from + 1} et ${res.to + 1} échangées : ${x.name} joue plus tard` : `Match de ${x.name} décalé à ${slotTime(t, res.to)}${res.appended ? ' (rotation ajoutée en fin de phase)' : ''}`, 'ok');
        return rr();
      }
      await save(ctx, (d) => {
        const y = d.teams.find((z) => z.id === tid);
        if (act === 'present') { const p = b.dataset.p; y.present = (y.present || []).includes(p) ? y.present.filter((z) => z !== p) : [...(y.present || []), p]; }
        if (act === 'unpay') { y.payment = 'unpaid'; y.extraPaid = 0; delete y.payMethod; }
        if (act === 'force-in') y.forceIn = true;
        y.checkedIn = !!y.forceIn || (y.present || []).length >= (d.registration.minPlayers || 1);
        if (y.checkedIn) y.late = false;
      });
      return rr();
    }
    case 'rot-start': case 'rot-pause': case 'rot-resume': {
      const slot = +b.dataset.slot, now = clock.now();
      let n = 0;
      await save(ctx, (d) => {
        if (act === 'rot-start') n = startRotation(d, slot, now).length;
        else toggleRotation(d, slot, now, act === 'rot-resume');
      }, act === 'rot-start' ? `Rotation ${slot + 1} lancée` : act === 'rot-pause' ? 'Chronos en pause' : 'Chronos relancés');
      return rr();
    }
    case 'courts-dec': case 'courts-inc': {
      const n = t.courts.length + (act === 'courts-inc' ? 1 : -1);
      if (n < 1 || n > 12) return;
      const regen = !hasResults(t) && t.teams.filter((x) => x.status === 'confirmed').length >= 2;
      await save(ctx, (d) => { applyField(d, { dataset: { path: 'courtCount' }, value: n, type: 'number' }); if (regen) Object.assign(d, buildSchedule(d)); }, regen ? `${n} terrain${n > 1 ? 's' : ''} : planning recalculé` : `${n} terrain${n > 1 ? 's' : ''}`);
      return rr();
    }
    case 'use-format': {
      const f = JSON.parse(b.dataset.f); delete f.label;
      await save(ctx, (d) => { d.format = f; }, 'Formule choisie : générez le planning');
      return rr();
    }
    case 'player-del':
      await save(ctx, (d) => { d.players = d.players.filter((p) => p.id !== b.closest('[data-player]').dataset.player); }); return rr();
    case 'draw-teams': {
      const n = +($('input[name=teamsize]:checked')?.value || 0);
      if (!n) return;
      drawSeed++;
      const split = balanceTeams((t.players || []).filter((p) => p.present), n, { mixed: $('#mixed')?.checked, seed: drawSeed });
      const gap = Math.max(...split.map((x) => x.total)) - Math.min(...split.map((x) => x.total));
      const r = await modal({ title: `${n} équipes équilibrées`, wide: true, ok: 'Valider ces équipes', cancel: 'Fermer',
        body: html`<div class="grid3">${split.map((sp) => html`<div class="card flat"><b>${sp.name}</b> <span class="muted small">niveau moyen ${sp.avg.toFixed(1)}</span><ul style="margin:.4rem 0 0;padding-left:1.1rem">${sp.members.map((p) => html`<li>${p.name} <span class="muted small">${p.level}${p.gender ? ` · ${p.gender}` : ''}</span></li>`)}</ul></div>`)}</div>
          <p class="hint" style="margin:0">Écart entre l’équipe la plus forte et la plus faible : ${gap} point${gap > 1 ? 's' : ''} de niveau. Pas convaincu ? Fermez et cliquez de nouveau sur « Tirer les équipes » : une autre répartition sera proposée.</p>` });
      if (!r) return;
      await save(ctx, (d) => { applyTeams(d, split); }, 'Équipes créées');
      location.hash = `#/admin/${t.id}/planning`;
      return;
    }
    case 'filter': location.hash = `#/admin/${t.id}/matchs?f=${b.dataset.f}`; break;
    case 'add-break': await save(ctx, (d) => { d.breaks.push({ afterSlot: 3, minutes: 30, label: 'Pause' }); }); rr(); break;
    case 'rm-break': await save(ctx, (d) => { d.breaks.splice(+b.dataset.i, 1); }); rr(); break;
    case 'add-sponsor': await save(ctx, (d) => { (d.sponsors ??= []).push({ name: '', url: '' }); }); rr(); break;
    case 'rm-sponsor': await save(ctx, (d) => { d.sponsors.splice(+b.dataset.i, 1); }); rr(); break;
    case 'pick-formula': await save(ctx, (d) => { d.format = { type: 'roundrobin', legs: +b.dataset.legs, finalsTop: +b.dataset.top, thirdPlace: true }; }); rr(); break;
    case 'read-all': await save(ctx, (d) => { (d.messages || []).forEach((m) => { m.read = true; }); }); rr(); break;
    case 'new-vpin': await save(ctx, (d) => { d.volunteerPin = pin4(); }, 'Nouveau code bénévole'); rr(); break;
    case 'copy': try { await navigator.clipboard.writeText(b.dataset.text); toast('Lien copié', 'ok'); } catch { toast(b.dataset.text); } break;

    case 'generate': {
      const conf = t.teams.filter((x) => x.status === 'confirmed').length;
      if (conf < 2) return toast('Il faut au moins 2 équipes confirmées', 'err');
      if (hasResults(t) && !(await confirmBox('Regénérer le planning ?', 'Des scores ont déjà été saisis : ils seront effacés.', 'Regénérer'))) return;
      await save(ctx, (d) => { const n = buildSchedule(d); return { ...n, status: 'ready' }; }, 'Planning généré');
      rr(); break;
    }
    case 'team-add': case 'team-edit': return editTeam(ctx, act === 'team-edit' ? t.teams.find((x) => x.id === tid) : null);
    case 'team-del': {
      const x = t.teams.find((y) => y.id === tid);
      const inPlay = t.matches.some((m) => m.teamA === tid || m.teamB === tid);
      if (!(await confirmBox(`Supprimer « ${x.name} » ?`, inPlay ? 'Cette équipe est dans le planning : passez-la plutôt en « Désistée », ou regénérez le planning après suppression.' : 'Cette action est définitive.', 'Supprimer'))) return;
      await save(ctx, (d) => { d.teams = d.teams.filter((y) => y.id !== tid); }, 'Équipe supprimée'); rr(); break;
    }
    case 'team-bulk': {
      const r = await modal({ title: 'Ajouter une liste d’équipes', body: html`<label class="f">Un nom d’équipe par ligne<textarea name="list" rows="8" required placeholder="Les Smasheurs\nBlock Party\n…"></textarea></label>`, ok: 'Ajouter' });
      if (!r) return;
      const names = r.list.split('\n').map((s) => s.trim()).filter(Boolean);
      await save(ctx, (d) => { for (const n of names) if (!d.teams.some((x) => x.name.toLowerCase() === n.toLowerCase())) d.teams.push(makeTeam(n, { payment: d.registration.fee ? 'unpaid' : 'free' })); }, `${plural(names.length, 'équipe ajoutée', 'équipes ajoutées')}`);
      rr(); break;
    }
    case 'm-start': await store.submitScore(t.id, { matchId: mid, status: 'live', sets: [[0, 0]] }); rr(); break;
    case 'm-validate': await save(ctx, (d) => { d.matches.find((m) => m.id === mid).validated = true; }, 'Score validé'); rr(); break;
    case 'm-score': return editScore(ctx, t.matches.find((m) => m.id === mid));

    case 'poster-dl': {
      const c = await posterCanvas(t, b.dataset.format === 'story' ? 'story' : 'post', store.baseUrl());
      c.toBlob((blob) => download(`affiche-${t.id}-${b.dataset.format}.png`, blob));
      break;
    }
    case 'export-json': download(`${t.id}-sauvegarde.json`, JSON.stringify(t, null, 1), 'application/json'); break;
    case 'export-csv': download(`${t.id}-equipes.csv`, teamsCsv(t), 'text/csv;charset=utf-8'); break;
    case 'export-xls': download(`${t.id}.xls`, excelExport(ctx), 'application/vnd.ms-excel'); break;
    case 'reset-scores':
      if (!(await confirmBox('Effacer tous les scores ?', 'Le planning est conservé, tous les résultats sont remis à zéro.', 'Effacer'))) return;
      await save(ctx, (d) => { d.matches.forEach((m) => { if (m.status !== 'bye') { m.status = 'scheduled'; m.sets = []; delete m.tieWinner; delete m.validated; delete m.startedAt; delete m.finishedAt; delete m.timer; } }); }, 'Scores effacés'); rr(); break;
    case 'delete':
      if (!(await confirmBox('Supprimer le tournoi ?', `« ${t.name} » et tous ses résultats seront supprimés définitivement.`, 'Supprimer'))) return;
      try { await store.remove(t.id); toast('Tournoi supprimé'); location.hash = '#/'; } catch (err) { toast(err.message, 'err'); }
      break;
    default: break;
  }
}

async function editTeam(ctx, x) {
  const { t } = ctx;
  const r = await modal({
    title: x ? `Modifier « ${x.name} »` : 'Nouvelle équipe',
    body: html`<label class="f">Nom de l’équipe<input type="text" name="name" required maxlength="40" value="${x?.name || ''}"></label>
      <div class="grid2"><label class="f">Capitaine<input type="text" name="captain" value="${x?.captain || ''}"></label><label class="f">Téléphone<input type="tel" name="phone" value="${x?.phone || ''}"></label></div>
      <div class="grid2"><label class="f">E-mail<input type="email" name="email" value="${x?.email || ''}"></label><label class="f">Niveau<select name="level">${[[1, '1 · Confirmé'], [2, '2 · Intermédiaire'], [3, '3 · Débutant']].map(([v, l]) => html`<option value="${v}" ${(x?.level || 2) === v ? raw('selected') : ''}>${l}</option>`)}</select></label></div>
      <label class="f">Joueurs <span class="hint">Un par ligne</span><textarea name="players" rows="4">${(x?.players || []).join('\n')}</textarea></label>`,
    ok: x ? 'Enregistrer' : 'Ajouter l’équipe',
  });
  if (!r) return;
  const data = { name: r.name.trim(), captain: r.captain, phone: r.phone, email: r.email, level: +r.level, players: r.players.split('\n').map((s) => s.trim()).filter(Boolean) };
  await save(ctx, (d) => {
    if (d.teams.some((y) => y.id !== x?.id && y.name.toLowerCase() === data.name.toLowerCase())) throw new Error('Ce nom d’équipe existe déjà');
    if (x) Object.assign(d.teams.find((y) => y.id === x.id), data);
    else {
      const full = d.teams.filter((y) => y.status === 'confirmed').length >= d.registration.maxTeams;
      d.teams.push(makeTeam(data.name, { ...data, status: full ? 'waitlist' : 'confirmed', payment: d.registration.fee ? 'unpaid' : 'free' }));
    }
  }, x ? 'Équipe modifiée' : 'Équipe ajoutée');
  ctx.rerender();
}

async function editScore(ctx, m) {
  const { t, resolved } = ctx;
  const s = sides(t, m, resolved);
  const sc = scoringFor(t, m);
  const nSets = sc.mode === 'time' ? 1 : sc.setsToWin * 2 - 1;
  const sets = Array.from({ length: nSets }, (_, i) => m.sets?.[i] || ['', '']);
  const r = await modal({
    title: `${s.nameA} – ${s.nameB}`,
    body: html`<p class="hint" style="margin:0">${sc.mode === 'time' ? `Match au temps (${sc.durationMin} min)` : `${sc.setsToWin} set${sc.setsToWin > 1 ? 's' : ''} gagnant${sc.setsToWin > 1 ? 's' : ''} de ${sc.pointsPerSet}${sc.setsToWin > 1 ? `, set décisif à ${sc.tiebreakPoints}` : ''}`}</p>
      ${sets.map((st, i) => html`<div class="setinput"><span class="small muted" style="width:52px">${sc.mode === 'time' ? 'Score' : `Set ${i + 1}`}</span><input type="number" min="0" name="a${i}" value="${st[0]}" aria-label="${s.nameA} set ${i + 1}"><span>–</span><input type="number" min="0" name="b${i}" value="${st[1]}" aria-label="${s.nameB} set ${i + 1}"><span></span></div>`)}
      ${m.phase === 'bracket' ? html`<label class="f">En cas d’égalité, vainqueur<select name="tie"><option value="">—</option><option value="A" ${m.tieWinner === 'A' ? raw('selected') : ''}>${s.nameA}</option><option value="B" ${m.tieWinner === 'B' ? raw('selected') : ''}>${s.nameB}</option></select></label>` : ''}
      <label class="f">Forfait<select name="forfeit"><option value="">Aucun</option><option value="A" ${m.forfeit === 'A' ? raw('selected') : ''}>${s.nameA} déclare forfait</option><option value="B" ${m.forfeit === 'B' ? raw('selected') : ''}>${s.nameB} déclare forfait</option></select></label>
      <label class="f">État<select name="status"><option value="done" ${m.status !== 'live' ? raw('selected') : ''}>Terminé</option><option value="live" ${m.status === 'live' ? raw('selected') : ''}>En cours</option><option value="scheduled">À venir (effacer)</option></select></label>`,
    ok: 'Enregistrer le score',
  });
  if (!r) return;
  const newSets = sets.map((_, i) => [r[`a${i}`], r[`b${i}`]]).filter(([a, b]) => a !== '' || b !== '').map(([a, b]) => [+a || 0, +b || 0]);
  await save(ctx, (d) => {
    const x = d.matches.find((y) => y.id === m.id);
    x.sets = r.status === 'scheduled' ? [] : newSets;
    x.status = r.status;
    x.tieWinner = r.tie || null;
    x.forfeit = r.forfeit || null;
    x.validated = true;
    if (r.status === 'done') x.finishedAt ??= new Date().toISOString();
    x.submittedBy = 'Organisation';
  }, 'Score enregistré');
  ctx.rerender();
}

function importTeams(ctx, text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const hasHead = col('équipe', 'equipe', 'nom', 'team') >= 0;
  const iName = hasHead ? col('équipe', 'equipe', 'nom', 'team') : 0;
  const iCap = hasHead ? col('capitaine', 'captain', 'responsable') : -1;
  const iMail = hasHead ? col('mail') : -1;
  const iTel = hasHead ? col('tél', 'tel', 'phone', 'portable') : -1;
  const iLvl = hasHead ? col('niveau', 'level') : -1;
  const iPl = hasHead ? col('joueur', 'player') : -1;
  const data = rows.slice(hasHead ? 1 : 0).filter((r) => r[iName]);
  save(ctx, (d) => {
    for (const r of data) {
      if (d.teams.some((x) => x.name.toLowerCase() === r[iName].toLowerCase())) continue;
      d.teams.push(makeTeam(r[iName], { captain: r[iCap] || '', email: r[iMail] || '', phone: r[iTel] || '', level: +r[iLvl] || 2, players: iPl >= 0 ? r.slice(iPl).filter(Boolean) : [], payment: d.registration.fee ? 'unpaid' : 'free' }));
    }
  }, `${plural(data.length, 'équipe importée', 'équipes importées')}`).then(() => ctx.rerender());
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function teamsCsv(t) {
  const head = ['Équipe', 'Capitaine', 'E-mail', 'Téléphone', 'Niveau', 'Statut', 'Paiement', 'Arrivée', 'PIN', 'Référence', 'Joueurs'];
  const rows = t.teams.map((x) => [x.name, x.captain, x.email, x.phone, x.level, x.status, x.payment, x.checkedIn ? 'oui' : 'non', x.pin, x.ref || '', (x.players || []).join(', ')]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

/** Classeur Excel (format XML 2003, lisible par Excel, LibreOffice et Numbers) avec 3 feuilles. */
function excelExport(ctx) {
  const { t, resolved, standings } = ctx;
  const x = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cell = (v) => (typeof v === 'number' ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`);
  const sheet = (name, rows) => `<Worksheet ss:Name="${x(name)}"><Table>${rows.map((r, i) => `<Row${i === 0 ? ' ss:StyleID="h"' : ''}>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`;
  const teams = [['Équipe', 'Capitaine', 'E-mail', 'Téléphone', 'Niveau', 'Statut', 'Paiement', 'Arrivée', 'Joueurs'], ...t.teams.map((y) => [y.name, y.captain, y.email, y.phone, y.level, y.status, y.payment, y.checkedIn ? 'oui' : 'non', (y.players || []).join(', ')])];
  const matches = [['Heure', 'Terrain', 'Sport', 'Phase', 'Équipe A', 'Équipe B', 'Score', 'Détail', 'Vainqueur', 'Arbitre', 'État'], ...t.matches.filter((m) => m.status !== 'bye').sort((a, b) => a.slot - b.slot).map((m) => {
    const s = sides(t, m, resolved);
    const c = t.courts.find((y) => y.id === m.courtId);
    const sc = scoreText(t, m);
    return [matchTime(t, m), c?.name || '', c ? SPORTS[c.sport]?.label : '', m.phase === 'pool' ? (m.pool ? `Poule ${m.pool}` : '') : m.label, s.nameA, s.nameB, sc.main, sc.detail, s.winner ? teamName(t, s.winner) : '', m.referee ? teamName(t, m.referee) : '', ({ scheduled: 'À venir', live: 'En cours', done: 'Terminé' })[m.status]];
  })];
  const rank = [['Poule', 'Rang', 'Équipe', 'Points', 'Joués', 'V', 'N', 'D', 'Sets +', 'Sets -', 'Points +', 'Points -']];
  for (const [L, rows] of Object.entries(standings)) for (const r of rows) rank.push([L, r.rank, teamName(t, r.team), r.rankPts, r.played, r.won, r.drawn, r.lost, r.setsFor, r.setsAgainst, r.ptsFor, r.ptsAgainst]);
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>
${sheet('Équipes', teams)}${sheet('Matchs', matches)}${sheet('Classements', rank)}</Workbook>`;
}
