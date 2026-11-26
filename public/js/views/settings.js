// Formulaires de réglages partagés entre l'assistant de création et l'administration.
import { html, raw, esc, euros, plural, fmtDate } from '../ui.js';
import { SPORTS, SCORING_PRESETS, RANKING_RULES, COURT_COLORS, uid, buildSchedule, scheduleStats, slotTime, makeTeam } from '../engine.js';

export const FORMATS = {
  roundrobin: { label: 'Championnat', desc: 'Tout le monde se rencontre. Idéal jusqu’à 8 équipes, multisport compris.', icon: '🔁' },
  pools: { label: 'Poules + phases finales', desc: 'Poules le matin, tableau final l’après-midi. Le classique des tournois de volley.', icon: '🏐' },
  levels: { label: 'Poules de 3 + niveaux', desc: 'Brassage en poules de 3, puis poules de niveau, puis matchs de classement. Rapide, chacun joue contre son niveau, classement complet.', icon: '🌙' },
  single: { label: 'Élimination directe', desc: 'Un tableau, on perd on sort. Court et intense.', icon: '⚡' },
  double: { label: 'Double élimination', desc: 'Un tableau principal + un tableau de repêchage. Personne n’est éliminé sur un seul match.', icon: '♻️' },
};

export const PROVIDERS = {
  helloasso: { label: 'HelloAsso', note: '0 % de frais pour l’association (contribution volontaire du payeur). Collez le lien de votre billetterie HelloAsso.' },
  stripe: { label: 'Stripe Payment Link', note: '1,5 % + 0,25 € par carte européenne. La référence de l’équipe est transmise automatiquement.' },
  sumup: { label: 'SumUp (lien de paiement)', note: '2,5 % en ligne, 1,75 % au terminal sur place.' },
  lydia: { label: 'Lydia / Sumeria', note: 'Cagnotte : gratuite depuis l’app, 4 % par carte.' },
  paypal: { label: 'PayPal', note: 'Tarif associatif ≈ 1,4 % + frais fixe, sur demande.' },
  onsite: { label: 'Sur place uniquement', note: 'Espèces, chèque ou carte le jour J ; vous pointez les paiements dans la liste des équipes.' },
};

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => { o[k] ??= /^\d+$/.test(keys[i + 1]) ? [] : {}; o = o[k]; });
  o[keys.at(-1)] = value;
}
export function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }

/** Applique la modification d'un champ (data-path) au tournoi. Renvoie true si le planning doit être régénéré. */
export function applyField(t, el) {
  const path = el.dataset.path;
  if (!path) return false;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.type === 'num') v = v === '' ? 0 : +v;
  if (el.dataset.type === 'nullnum') v = v === '' ? null : +v;
  if (el.dataset.offset) v += +el.dataset.offset;
  if (path === 'courtCount') {
    const n = Math.max(1, Math.min(12, +v || 1));
    while (t.courts.length < n) {
      const i = t.courts.length;
      t.courts.push({ id: `c${uid(4)}`, name: `Terrain ${i + 1}`, sport: t.courts[0]?.sport || 'volley', color: COURT_COLORS[i % COURT_COLORS.length], token: uid(10) });
    }
    t.courts.length = n;
    return true;
  }
  const preset = path.match(/^courts\.(\d+)\.preset$/);
  if (preset) {
    const c = t.courts[+preset[1]];
    if (!v) delete c.scoring; else c.scoring = { ...SCORING_PRESETS[v], preset: v };
    return false;
  }
  if (path === 'scoring.preset') { t.scoring = { ...SCORING_PRESETS[v], preset: v }; return false; }
  if (path === 'scoring.ranking') { t.scoring.ranking = v; for (const c of t.courts) if (c.scoring) c.scoring.ranking = v; return false; }
  if (path === 'finalsScoring.preset') { t.finalsScoring = v ? { ...SCORING_PRESETS[v], preset: v } : null; return false; }
  setPath(t, path, v);
  if (path === 'registration.barCard.enabled' && v) { t.registration.barCard.price ??= 10; t.registration.barCard.points ??= 12; t.registration.barCard.per ??= 'team'; }
  return /^(format|courts\.\d+\.active|startTime|slotMinutes|referees)/.test(path);
}

const sel = (path, value, options) => html`<select data-path="${path}">${Object.entries(options).map(([k, l]) => html`<option value="${k}" ${String(value) === String(k) ? raw('selected') : ''}>${l}</option>`)}</select>`;
const presetOptions = (withInherit) => ({ ...(withInherit ? { '': 'Comme le tournoi' } : {}), ...Object.fromEntries(Object.entries(SCORING_PRESETS).map(([k, p]) => [k, p.label])) });

export function sectionEssentials(t) {
  return html`<div class="stack">
    <label class="f">Nom du tournoi<input type="text" data-path="name" value="${t.name}" required maxlength="60"></label>
    <div class="tiles" role="radiogroup" aria-label="Inscriptions">
      <label class="tile"><input type="radio" name="entry" data-path="entry" value="teams" ${t.entry !== 'players' ? raw('checked') : ''}><b>Par équipes</b><small>Les équipes s’inscrivent déjà constituées.</small></label>
      <label class="tile"><input type="radio" name="entry" data-path="entry" value="players" ${t.entry === 'players' ? raw('checked') : ''}><b>Tournoi interne (par joueur)</b><small>Chacun s’inscrit avec son niveau ; l’application forme des équipes équilibrées.</small></label>
    </div>
    <div class="grid3">
      <label class="f">Date<input type="date" data-path="date" value="${t.date}"></label>
      <label class="f">Premier match<input type="time" data-path="startTime" value="${t.startTime}"></label>
      <label class="f">Fin souhaitée<input type="time" data-path="endTime" value="${t.endTime || ''}"></label>
      <label class="f">Lieu<input type="text" data-path="venue" value="${t.venue}" placeholder="Gymnase, plage…"></label>
    </div>
    <label class="f">Adresse<input type="text" data-path="address" value="${t.address}" placeholder="Pour l’itinéraire et la page de promotion"></label>
    <div class="grid2">
      <label class="f">Organisateur<input type="text" data-path="organizer" value="${t.organizer}" placeholder="Club, association…"></label>
      <label class="f">Contact<input type="text" data-path="contact" value="${t.contact}" placeholder="E-mail ou téléphone"></label>
    </div>
    <label class="f">Accroche<input type="text" data-path="tagline" value="${t.tagline}" maxlength="140" placeholder="Une phrase pour donner envie de venir"></label>
    <label class="f">Infos pratiques <span class="hint">Affichées dans le portail des joueurs : déroulé, parking, vestiaires, règles…</span><textarea data-path="infos">${t.infos}</textarea></label>
    <div class="card flat stack">
      <label class="check"><input type="checkbox" data-path="charity.enabled" ${t.charity?.enabled ? raw('checked') : ''}> <span>Tournoi solidaire (Téléthon, association…) <span class="hint">Affiche un compteur de dons sur le grand écran et la page de promotion.</span></span></label>
      ${t.charity?.enabled ? html`<div class="grid3">
        <label class="f">Cause<input type="text" data-path="charity.label" value="${t.charity.label}" placeholder="Téléthon"></label>
        <label class="f">Objectif (€)<input type="number" min="0" data-type="num" data-path="charity.goal" value="${t.charity.goal}"></label>
        <label class="f">Déjà collecté (€)<input type="number" min="0" data-type="num" data-path="charity.raised" value="${t.charity.raised}"></label>
      </div>
      <label class="f">Lien de paiement du club pour les dons <span class="hint">HelloAsso, SumUp, Lydia… Le club collecte puis reverse.</span><input type="url" data-path="charity.payUrl" value="${t.charity.payUrl || ''}" placeholder="https://…"></label>` : ''}
    </div>
  </div>`;
}

export function sectionCourts(t) {
  return html`<div class="stack">
    <label class="f" style="max-width:220px">Nombre de terrains<input type="number" min="1" max="12" data-path="courtCount" value="${t.courts.length}"></label>
    <div class="stack">
      ${t.courts.map((c, i) => html`<div class="card flat" style="border-left:6px solid ${c.color}">
        <div class="grid3">
          <label class="f">Nom<input type="text" data-path="courts.${i}.name" value="${c.name}"></label>
          <label class="f">Sport${sel(`courts.${i}.sport`, c.sport, Object.fromEntries(Object.entries(SPORTS).map(([k, s]) => [k, `${s.icon} ${s.label}`])))}</label>
          <label class="f">Règle de jeu${sel(`courts.${i}.preset`, c.scoring?.preset || '', presetOptions(true))}</label>
        </div>
        ${c.scoring?.mode === 'time' ? html`<div class="grid3" style="margin-top:.75rem"><label class="f">Durée du match (min)<input type="number" min="3" max="90" data-type="num" data-path="courts.${i}.scoring.durationMin" value="${c.scoring.durationMin}"></label></div>` : ''}
        <div class="row" style="margin-top:.75rem"><label class="check"><input type="checkbox" data-path="courts.${i}.active" ${c.active !== false ? raw('checked') : ''}> Terrain utilisé</label>
          <label class="row small">Couleur <input type="color" data-path="courts.${i}.color" value="${c.color}" style="width:44px;height:32px;padding:0;border:0;background:none"></label></div>
      </div>`)}
    </div>
    <p class="hint">Astuce multisport : donnez un sport différent à chaque terrain. Le planning fait tourner les équipes pour que chacune joue autant de fois chaque sport.</p>
  </div>`;
}

export function courtStepper(t) {
  const n = t.courts.length;
  return html`<div class="row" style="gap:.6rem"><span style="font-weight:600">Terrains</span>
    <div class="numstep" role="group" aria-label="Nombre de terrains"><button type="button" class="btn ghost icon" data-act="courts-dec" ${n <= 1 ? raw('disabled') : ''} aria-label="Un terrain de moins">−</button><b class="num" aria-live="polite">${n}</b><button type="button" class="btn ghost icon" data-act="courts-inc" ${n >= 12 ? raw('disabled') : ''} aria-label="Un terrain de plus">+</button></div>
    <span class="hint">${t.courts.map((c) => SPORTS[c.sport]?.icon || '').join(' ')} · le planning et les durées se recalculent</span></div>
    ${(() => { const nT = t.teams.filter((x) => x.status === 'confirmed').length || t.registration.maxTeams; const max = Math.floor(nT / 2); return t.format.type === 'roundrobin' && n > max && nT >= 2 ? html`<p class="hint" style="margin:0;color:var(--loss)">Avec ${nT} équipes, ${max} matchs au plus en même temps : ${n - max > 1 ? `${n - max} terrains ne serviront pas` : 'un terrain ne servira pas'}.</p>` : ''; })()}`;
}

export function sectionFormat(t) {
  const f = t.format;
  return html`<div class="stack">
    ${courtStepper(t)}
    <div class="tiles" role="radiogroup" aria-label="Format">
      ${Object.entries(FORMATS).map(([k, x]) => html`<label class="tile"><input type="radio" name="fmt" data-path="format.type" value="${k}" ${f.type === k ? raw('checked') : ''}><b>${x.icon} ${x.label}</b><small>${x.desc}</small></label>`)}
    </div>
    ${f.type === 'roundrobin' ? html`<div class="grid3">
      <label class="f">Rencontres entre deux équipes ${sel('format.legs', f.legs || 1, Object.fromEntries(Array.from({ length: Math.min(3, t.courts.length) }, (_, i) => [i + 1, i === 0 ? '1 fois (sport tiré au sort équitablement)' : `${i + 1} fois, dans ${i + 1} sports différents`])))}</label>
      <label class="f">Phase finale ${sel('format.finalsTop', f.finalsTop || 0, { 0: 'Aucune : classement final direct', 2: 'Finale entre les 2 premiers', 4: 'Demi-finales (4 premiers)', 8: 'Quarts de finale (8 premiers)' })}</label>
      ${f.finalsTop >= 4 ? html`<label class="check" style="align-self:end"><input type="checkbox" data-path="format.thirdPlace" ${f.thirdPlace ? raw('checked') : ''}> Match pour la 3e place</label>` : ''}
    </div>` : ''}
    ${f.type === 'pools' ? html`<div class="grid3">
      <label class="f">Nombre de poules<input type="number" min="1" max="16" data-type="num" data-path="format.pools" value="${f.pools}"></label>
      <label class="f">Qualifiés par poule<input type="number" min="1" max="8" data-type="num" data-path="format.qualifiers" value="${f.qualifiers}"></label>
      <label class="f">Tableau final ${sel('format.finals', f.finals || 'single', { single: 'Élimination directe', double: 'Double élimination (repêchage)' })}</label>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" data-path="format.thirdPlace" ${f.thirdPlace ? raw('checked') : ''}> Petite finale</label>
      <label class="check"><input type="checkbox" data-path="format.consolation" ${f.consolation ? raw('checked') : ''}> Consolante pour les non-qualifiés</label>
      <label class="check"><input type="checkbox" data-path="format.pinPoolsToCourts" ${f.pinPoolsToCourts ? raw('checked') : ''}> Une poule par terrain</label>
    </div>` : ''}
    ${f.type === 'levels' ? html`<div class="grid3">
      <label class="f">Taille des poules ${sel('format.poolSize', f.poolSize || 3, { 3: 'Poules de 3 (l’équipe au repos arbitre)', 4: 'Poules de 4' })}</label>
      <label class="check" style="align-self:end"><input type="checkbox" data-path="format.placement" ${f.placement !== false ? raw('checked') : ''}> Matchs de classement à la fin</label></div>
      <p class="hint" style="margin:0">Phase 1 : poules équilibrées par niveau (serpentin). Phase 2 : les 6 meilleures équipes en 2 poules, les 6 suivantes en 2 poules… Phase 3 : 1er contre 1er pour les places 1-2, 2e contre 2e pour 3-4, etc. Chaque équipe obtient une place de 1 à N.</p>` : ''}
    ${f.type === 'single' ? html`<label class="check"><input type="checkbox" data-path="format.thirdPlace" ${f.thirdPlace ? raw('checked') : ''}> Petite finale (3e place)</label>` : ''}
    ${f.type === 'double' || (f.type === 'pools' && f.finals === 'double') ? html`<label class="check"><input type="checkbox" data-path="format.grandFinalReset" ${f.grandFinalReset ? raw('checked') : ''}> Grande finale avec revanche si le vainqueur du repêchage gagne</label>` : ''}
  </div>`;
}


/** Durée de match estimée (minutes) : durée fixée au temps, sinon estimation selon les points à marquer. */
export function estimateMinutes(sc) {
  if (sc.mode === 'time') return +sc.durationMin || 10;
  if (sc.durationMin) return +sc.durationMin;
  const pts = (+sc.pointsPerSet || 25) * (sc.setsToWin > 1 ? sc.setsToWin * 2 - 0.5 : 1);
  return Math.round(pts * 0.55);
}

/** Règle de jeu, sport par sport : au temps (minutes saisies librement) ou aux points (format des sets). */
export function sportRulesBlock(t, { extra = false } = {}) {
      const sports = [...new Set(t.courts.map((c) => c.sport))];
      const ptsPresets = Object.fromEntries(Object.entries(SCORING_PRESETS).filter(([, p]) => p.mode === 'points').map(([k, p]) => [k, p.label]));
      return html`<div class="stack">
        ${sports.map((sp) => {
          const c = t.courts.find((x) => x.sport === sp);
          const sc = c.scoring || t.scoring;
          return html`<div class="card flat stack" style="gap:.6rem"><b>${SPORTS[sp]?.icon} ${SPORTS[sp]?.label}${t.courts.filter((x) => x.sport === sp).length > 1 ? html` <span class="hint">(${t.courts.filter((x) => x.sport === sp).length} terrains)</span>` : ''}</b>
            <div class="row" role="radiogroup">
              <label class="chip ${sc.mode === 'time' ? 'on' : ''}"><input type="radio" name="mode-${sp}" data-act="mode" data-sport="${sp}" value="time" ${sc.mode === 'time' ? raw('checked') : ''}>⏱️ Au temps</label>
              <label class="chip ${sc.mode !== 'time' ? 'on' : ''}"><input type="radio" name="mode-${sp}" data-act="mode" data-sport="${sp}" value="points" ${sc.mode !== 'time' ? raw('checked') : ''}>🔢 Aux points</label>
            </div>
            ${sc.mode === 'time'
              ? html`<label class="f" style="max-width:220px">Durée du match (minutes)<input type="number" min="3" max="90" data-act="dur" data-sport="${sp}" value="${sc.durationMin || 10}"></label>`
              : html`<label class="f">Format des sets<select data-act="preset" data-sport="${sp}">${Object.entries(ptsPresets).map(([k, l]) => html`<option value="${k}" ${sc.preset === k ? raw('selected') : ''}>${l}</option>`)}</select><span class="hint">Durée estimée : environ ${estimateMinutes(sc)} min</span></label>`}
          </div>`;
        })}
        ${extra ? html`<div class="grid3">
          <label class="f">Durée d’une rotation (min)<input type="number" min="5" max="120" data-type="num" data-path="slotMinutes" value="${t.slotMinutes}"><span class="hint">Conseillé : ${Math.max(...t.courts.map((c) => estimateMinutes(c.scoring || t.scoring))) + 2} min</span></label>
          <label class="f">Points au classement ${sel('scoring.ranking', t.scoring.ranking || 'win3', Object.fromEntries(Object.entries(RANKING_RULES).map(([k, r]) => [k, r.label])))}</label>
          <label class="f">Arbitrage ${sel('referees', t.referees || 'none', { teams: 'Par l’équipe au repos', none: 'Les équipes s’arbitrent' })}</label>
        </div>` : ''}
      </div>`;
}

/** Applique un changement de règle de jeu fait dans sportRulesBlock ; renvoie true s'il a été traité. */
export function applySportRule(t, el) {
  const act = el.dataset?.act;
  if (!['mode', 'dur', 'preset'].includes(act)) return false;
  const sp = el.dataset.sport;
  const each = (fn) => { for (const c of t.courts.filter((x) => x.sport === sp)) fn(c); t.scoring = { ...(t.courts[0].scoring || t.scoring) }; };
  const rk = t.scoring.ranking || 'win3';
  if (act === 'mode') each((c) => { c.scoring = el.value === 'time' ? { ...SCORING_PRESETS['time-12'], durationMin: (c.scoring || t.scoring).durationMin || 10, ranking: rk, preset: 'time-12' } : { ...SCORING_PRESETS['volley-1x25'], ranking: rk, preset: 'volley-1x25' }; });
  if (act === 'dur') each((c) => { c.scoring = { ...(c.scoring || t.scoring), mode: 'time', durationMin: Math.max(1, Math.min(120, +el.value || 10)) }; });
  if (act === 'preset') each((c) => { c.scoring = { ...SCORING_PRESETS[el.value], ranking: (c.scoring || t.scoring).ranking || rk, preset: el.value }; });
  return true;
}

export function sectionRules(t) {
  const sc = t.scoring;
  return html`<div class="stack">
    ${sportRulesBlock(t)}
    <label class="f" style="max-width:420px">Phases finales ${sel('finalsScoring.preset', t.finalsScoring?.preset || '', { '': 'Même règle que pendant le tournoi', ...presetOptions(false) })}</label>
    ${sc.mode === 'points' && !t.courts.some((c) => c.scoring) ? html`<div class="grid3">
      <label class="f">Sets gagnants<input type="number" min="1" max="3" data-type="num" data-path="scoring.setsToWin" value="${sc.setsToWin}"></label>
      <label class="f">Points par set<input type="number" min="5" max="50" data-type="num" data-path="scoring.pointsPerSet" value="${sc.pointsPerSet}"></label>
      <label class="f">Set décisif<input type="number" min="5" max="50" data-type="num" data-path="scoring.tiebreakPoints" value="${sc.tiebreakPoints}"></label>
      <label class="f">Plafond (0 = aucun)<input type="number" min="0" max="60" data-type="num" data-path="scoring.cap" value="${sc.cap || 0}"></label>
      <label class="check" style="align-self:end"><input type="checkbox" data-path="scoring.winBy2" ${sc.winBy2 !== false ? raw('checked') : ''}> 2 points d’écart</label>
    </div>` : ''}
    <label class="f">Points au classement ${sel('scoring.ranking', sc.ranking || 'win3', Object.fromEntries(Object.entries(RANKING_RULES).map(([k, r]) => [k, r.label])))}<span class="hint">Égalités départagées par victoires, ratio de sets, ratio de points, puis confrontation directe.</span></label>
    <div class="grid3">
      <label class="f">Durée d’une rotation (min)<input type="number" min="5" max="120" data-type="num" data-path="slotMinutes" value="${t.slotMinutes}"><span class="hint">Match + changement de terrain (conseillé : ${Math.max(...t.courts.map((c) => estimateMinutes(c.scoring || t.scoring))) + 2} min).</span></label>
      <label class="f">Arbitrage ${sel('referees', t.referees || 'none', { teams: 'Par les équipes au repos (sur tous les terrains si une seule est libre)', none: 'Auto-arbitrage / bénévoles' })}</label>
      <label class="check" style="align-self:end"><input type="checkbox" data-path="scoreValidation" ${t.scoreValidation ? raw('checked') : ''}> Valider chaque score avant publication</label>
    </div>
    ${t.scoring.mode === 'time' || t.courts.some((c) => c.scoring?.mode === 'time') ? html`<label class="f">Chrono des matchs au temps ${sel('timerControl', t.timerControl || 'organizer', { organizer: 'Géré par l’organisation (« Lancer la rotation » démarre tous les matchs)', players: 'Géré par les joueurs sur chaque feuille de match' })}</label>` : ''}
    <div class="card flat stack">
      <label class="check"><input type="checkbox" data-path="openScoring" ${t.openScoring ? raw('checked') : ''}> <span><b>Saisie libre des scores</b> : chaque joueur peut tenir le score de son match depuis son téléphone, sans code. <span class="hint">Idéal entre amis. Décochez pour un tournoi officiel : il faudra alors le QR du terrain, le PIN de l’équipe ou le code bénévole.</span></span></label>
    </div>
    <div class="card flat stack">
      <b>Pauses</b>
      ${(t.breaks || []).map((b, i) => html`<div class="row">
        <span>Après la rotation</span><input style="width:80px" type="number" min="1" data-type="num" data-path="breaks.${i}.afterSlot" value="${b.afterSlot + 1}" data-offset="-1">
        <span>pause de</span><input style="width:80px" type="number" min="5" data-type="num" data-path="breaks.${i}.minutes" value="${b.minutes}"><span>min</span>
        <input style="flex:1;min-width:140px" type="text" data-path="breaks.${i}.label" value="${b.label || ''}" placeholder="Pause déjeuner">
        <button type="button" class="btn danger sm" data-act="rm-break" data-i="${i}">Retirer</button></div>`)}
      <div><button type="button" class="btn ghost sm" data-act="add-break">Ajouter une pause</button></div>
    </div>
  </div>`;
}

export function sectionRegistration(t) {
  const r = t.registration;
  const prov = PROVIDERS[r.paymentProvider] || PROVIDERS.helloasso;
  return html`<div class="stack">
    <label class="check"><input type="checkbox" data-path="registration.open" ${r.open ? raw('checked') : ''}> Inscriptions en ligne ouvertes</label>
    <div class="grid3">
      <label class="f">Équipes max<input type="number" min="2" max="128" data-type="num" data-path="registration.maxTeams" value="${r.maxTeams}"></label>
      <label class="f">Joueurs min<input type="number" min="1" max="30" data-type="num" data-path="registration.minPlayers" value="${r.minPlayers}"></label>
      <label class="f">Joueurs max<input type="number" min="1" max="30" data-type="num" data-path="registration.maxPlayers" value="${r.maxPlayers}"></label>
      <label class="f">Date limite<input type="date" data-path="registration.deadline" value="${r.deadline}"></label>
    </div>
    <label class="check"><input type="checkbox" data-path="registration.requireValidation" ${r.requireValidation ? raw('checked') : ''}> Je valide chaque inscription avant qu’elle soit confirmée</label>
    <div class="card flat stack">
      <b>Paiement</b>
      <div class="grid3">
        <label class="f">Prix (€)<input type="number" min="0" step="0.5" data-type="num" data-path="registration.fee" value="${r.fee}"><span class="hint">0 = gratuit</span></label>
        <label class="f">Par ${sel('registration.feeMode', r.feeMode || 'team', { team: 'équipe (forfait)', player: 'joueur (minimum ' + r.minPlayers + ' joueurs facturés)' })}</label>
        <label class="f">Moyen de paiement ${sel('registration.paymentProvider', r.paymentProvider || 'helloasso', Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.label])))}</label>
      </div>
      ${r.paymentProvider !== 'onsite' ? html`<label class="f">Lien de paiement<input type="url" data-path="registration.paymentUrl" value="${r.paymentUrl}" placeholder="https://www.helloasso.com/associations/…"></label>` : ''}
      <p class="hint" style="margin:0">${prov.note}</p>
    </div>
    <div class="card flat stack">
      <label class="check"><input type="checkbox" data-path="registration.barCard.enabled" ${r.barCard?.enabled ? raw('checked') : ''}> <span><b>Carte buvette en option</b> à l’inscription <span class="hint">L’équipe la choisit en s’inscrivant (ou à l’accueil) ; elle est créditée dès le paiement et l’argent va à la buvette.</span></span></label>
      ${r.barCard?.enabled ? html`<div class="grid3">
        <label class="f">Prix (€)<input type="number" min="1" step="1" data-type="num" data-path="registration.barCard.price" value="${r.barCard.price ?? 10}"></label>
        <label class="f">Points crédités<input type="number" min="1" step="1" data-type="num" data-path="registration.barCard.points" value="${r.barCard.points ?? 12}"></label>
        <label class="f">Par ${sel('registration.barCard.per', r.barCard.per || 'team', { team: 'équipe (une carte partagée)', player: 'joueur (cumulés sur la carte de l’équipe)' })}</label>
      </div>` : ''}
    </div>
  </div>`;
}

/** Aperçu de la journée calculé avec des équipes fictives (ou réelles). */
export function previewDay(t, expectedTeams) {
  const n = Math.max(2, expectedTeams || t.teams.filter((x) => x.status === 'confirmed').length || t.registration.maxTeams || 8);
  const fake = { ...t, teams: t.teams.filter((x) => x.status === 'confirmed').length >= 2 && !expectedTeams ? t.teams : Array.from({ length: n }, (_, i) => makeTeam(`É${i + 1}`, { seed: i + 1 })) };
  let s;
  try { s = buildSchedule(fake); } catch { return null; }
  const st = scheduleStats(s);
  const per = Object.values(st.perTeam);
  const minM = per.length ? Math.min(...per) : 0, maxM = per.length ? Math.max(...per) : 0;
  const lastSlot = st.slots - 1;
  const endTime = slotTime(t, st.slots);
  const [eh] = endTime.split(':').map(Number);
  const playMin = st.slots * t.slotMinutes;
  const toM = (x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
  const s0 = toM(t.startTime), fin = s0 + playMin + (t.breaks || []).reduce((a, b) => a + (b.afterSlot < st.slots - 1 ? b.minutes : 0), 0);
  const limit = t.endTime ? toM(t.endTime) + (toM(t.endTime) < s0 ? 1440 : 0) : null;
  const late = limit != null ? fin > limit : eh >= 23 || eh < 6;
  return { teams: n, matches: st.matches, slots: st.slots, start: t.startTime, end: endTime, minM, maxM, playMin, late, limit: t.endTime, lastSlot };
}

export function previewCard(t, p, expected) {
  if (!p) return html`<div class="preview"><h3>Aperçu de la journée</h3><p>Ajoutez au moins 2 équipes.</p></div>`;
  const h = Math.floor(p.playMin / 60), m = p.playMin % 60;
  return html`<aside class="preview" aria-live="polite">
    <h3>Aperçu de la journée</h3>
    <label class="f" style="color:#fff">Équipes attendues<input type="number" min="2" max="128" data-preview-teams value="${expected || p.teams}" style="color:var(--ink)"></label>
    <div class="kv">
      <div><span class="big">${p.matches}</span><small>matchs</small></div>
      <div><span class="big">${p.slots}</span><small>rotations</small></div>
      <div><span class="big">${p.start}</span><small>début</small></div>
      <div><span class="big">${p.end}</span><small>fin estimée</small></div>
    </div>
    <p style="margin:0 0 .6rem">Chaque équipe joue ${p.minM === p.maxM ? html`<b>${p.minM} matchs</b>` : html`<b>${p.minM} à ${p.maxM} matchs</b> en poule`}${t.format.type !== 'roundrobin' || t.format.finalsTop ? ' + phases finales' : ''}. Temps de jeu total : ${h} h ${String(m).padStart(2, '0')}.</p>
    ${p.late ? html`<p class="warn">${p.limit ? `Ça dépasse la fin souhaitée (${p.limit}).` : 'La journée finit tard.'} Choisissez une formule plus courte ou réduisez la durée d’une rotation.</p>` : ''}
  </aside>`;
}

/** Comparatif des formules possibles pour un championnat multisport (Téléthon). */
export function formulaCompare(t) {
  const n = Math.max(2, t.teams.filter((x) => x.status === 'confirmed').length || t.registration.maxTeams || 7);
  const opts = [];
  const maxLegs = Math.min(3, t.courts.length);
  for (let legs = 1; legs <= maxLegs; legs++) for (const top of [0, 4]) {
    if (top && n < 5) continue;
    const p = previewDay({ ...t, format: { type: 'roundrobin', legs, finalsTop: top, thirdPlace: true } }, n);
    if (p) opts.push({ legs, top, ...p });
  }
  return opts;
}
