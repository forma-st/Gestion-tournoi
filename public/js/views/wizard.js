// Assistant de création guidé : modèles vides, une question à la fois, aide et aperçu de la journée à chaque étape.
import { html, raw, toast, fmtDate, plural } from '../ui.js';
import { newTournament, uid, SPORTS, COURT_COLORS, makeTeam } from '../engine.js';
import { buildDemo } from '../demo.js';
import { suggestFormats } from '../club.js';
import { tournamentRules } from '../rules.js';
import { shell } from './shell.js';
import { sectionFormat, sectionRegistration, applyField, previewDay, previewCard, courtStepper, FORMATS, sportRulesBlock, applySportRule } from './settings.js';
import { createTournament } from './home.js';

// ------------------------------------------------------------------ modèles
export const TEMPLATES = {
  multisport: { label: 'Téléthon multisport', desc: '3 terrains, 3 sports (tennis de table, dodgeball, volley), matchs au temps, l’équipe au repos arbitre, buvette et cagnotte.', icon: '💛', expected: 7 },
  fluo: { label: 'Tournoi fluo', desc: 'Volley, poules de 3 puis poules de niveau et matchs de classement : chacun joue contre son niveau.', icon: '🌙', expected: 18 },
  interne: { label: 'Tournoi interne', desc: 'Inscription individuelle avec le niveau, équipes équilibrées tirées sur place, formule adaptée à l’horaire.', icon: '🔀', expected: 6 },
  double: { label: 'Double élimination', desc: 'Tableau principal et tableau de repêchage : il faut perdre deux fois pour être éliminé.', icon: '♻️', expected: 8 },
  vide: { label: 'Tournoi vierge', desc: 'Je règle tout moi-même, étape par étape.', icon: '✏️', expected: 8 },
};

/** Modèle vide : la structure d'un exemple (sports, règles, horaires, carte de la buvette), sans équipes ni données. */
export function makeTemplate(kind) {
  const t = kind === 'vide' || !TEMPLATES[kind] ? newTournament() : buildDemo(kind);
  Object.assign(t, { id: uid(6), teams: [], players: [], matches: [], pools: {}, pools2: null, sales: [], cards: [], messages: [], announcements: [], status: 'draft', version: 1 });
  if (t.charity) Object.assign(t.charity, { raised: 0, donations: [] });
  for (const i of t.ingredients || []) i.bought = null;
  for (const p of t.buvette || []) if (p.stock != null) p.stock = null;
  t._expected = TEMPLATES[kind]?.expected || 8;
  t._template = kind;
  return t;
}

// ------------------------------------------------------------------ brouillon
function getDraft() {
  try { const d = JSON.parse(sessionStorage.getItem('rot:draft')); if (d) return d; } catch { /* */ }
  const t = makeTemplate('vide');
  saveDraft(t);
  return t;
}
export function saveDraft(t) { try { sessionStorage.setItem('rot:draft', JSON.stringify(t)); } catch { /* */ } }
const expectedOf = (t) => Math.max(2, +t._expected || 8);


// ------------------------------------------------------------------ étapes

const STEPS = [
  {
    key: 'tournoi', label: 'Le tournoi',
    help: html`<p>Commencez par l’essentiel : <b>le nom, la date et les horaires</b>.</p><p>L’<b>heure de fin souhaitée</b> sert à vous proposer, plus loin, une formule qui tient dans votre soirée.</p><p><b>Par équipes</b> : chaque équipe s’inscrit déjà constituée. <b>Par joueur</b> : chacun s’inscrit seul avec son niveau, et l’application forme des équipes équilibrées le jour J.</p>`,
    body: (t) => html`<div class="stack">
      <label class="f">Nom du tournoi<input type="text" data-path="name" value="${t.name}" required maxlength="60"></label>
      <div class="grid3">
        <label class="f">Date<input type="date" data-path="date" value="${t.date}"></label>
        <label class="f">Premier match<input type="time" data-path="startTime" value="${t.startTime}"></label>
        <label class="f">Fin souhaitée<input type="time" data-path="endTime" value="${t.endTime || ''}"></label>
      </div>
      <div class="grid2">
        <label class="f">Lieu<input type="text" data-path="venue" value="${t.venue}" placeholder="Gymnase, plage…"></label>
        <label class="f">Organisateur<input type="text" data-path="organizer" value="${t.organizer}" placeholder="Club, association…"></label>
      </div>
      <div class="tiles" role="radiogroup" aria-label="Inscriptions">
        <label class="tile"><input type="radio" name="entry" data-path="entry" value="teams" ${t.entry !== 'players' ? raw('checked') : ''}><b>👥 Par équipes</b><small>Les équipes s’inscrivent déjà constituées.</small></label>
        <label class="tile"><input type="radio" name="entry" data-path="entry" value="players" ${t.entry === 'players' ? raw('checked') : ''}><b>🔀 Par joueur</b><small>Chacun s’inscrit avec son niveau ; les équipes sont tirées sur place.</small></label>
      </div>
    </div>`,
  },
  {
    key: 'sports', label: 'Sports et terrains',
    help: html`<p><b>Un terrain = un match à la fois.</b> Avec 3 terrains, 3 matchs se jouent en même temps.</p><p><b>Multisport</b> : donnez un sport à chaque terrain. Les équipes tournent d’un terrain à l’autre, et chacune joue autant de fois chaque sport.</p><p>Vous pourrez changer le nombre de terrains plus tard : le planning se recalcule.</p>`,
    body: (t) => html`<div class="stack">
      ${courtStepper(t)}
      ${t.courts.map((c, i) => html`<div class="card flat stack" style="border-left:6px solid ${c.color};gap:.6rem">
        <div class="row between"><input type="text" data-path="courts.${i}.name" value="${c.name}" style="max-width:220px" aria-label="Nom du terrain"><span class="hint">${SPORTS[c.sport]?.icon} ${SPORTS[c.sport]?.label}</span></div>
        <div class="row" role="radiogroup" aria-label="Sport du ${c.name}">${Object.entries(SPORTS).map(([k, s]) => html`<label class="chip ${c.sport === k ? 'on' : ''}"><input type="radio" name="sport${i}" data-path="courts.${i}.sport" value="${k}" ${c.sport === k ? raw('checked') : ''}>${s.icon} ${s.label}</label>`)}</div>
      </div>`)}
    </div>`,
  },
  {
    key: 'equipes', label: 'Les équipes',
    help: (t) => {
      const n = expectedOf(t), c = t.courts.length;
      const play = Math.min(Math.floor(n / 2), c);
      return html`<p>Indiquez <b>le nombre d’équipes attendu</b> : il sert à proposer la formule. Les équipes elles-mêmes s’ajoutent après la création (à la main, par import Excel ou par les inscriptions en ligne).</p>
        <p>Avec <b>${n} équipes et ${plural(c, 'terrain')}</b> : ${plural(play, 'match')} en même temps${n - play * 2 > 0 ? `, ${plural(n - play * 2, 'équipe')} au repos à chaque rotation` : ', personne n’attend'}.</p>
        <p>L’idéal : <b>${c * 2} équipes</b> (tous les terrains occupés) ou <b>${c * 2 + 1}</b> (une équipe au repos, qui arbitre).</p>`;
    },
    body: (t) => html`<div class="stack">
      <div class="row" style="gap:.6rem"><span style="font-weight:600">${t.entry === 'players' ? 'Équipes à former' : 'Équipes attendues'}</span>
        <div class="numstep"><button type="button" class="btn ghost icon" data-act="exp-dec" aria-label="Une équipe de moins">−</button><b class="num" aria-live="polite">${expectedOf(t)}</b><button type="button" class="btn ghost icon" data-act="exp-inc" aria-label="Une équipe de plus">+</button></div></div>
      <div class="grid3">
        <label class="f">Joueurs par équipe (min.)<input type="number" min="1" max="30" data-type="num" data-path="registration.minPlayers" value="${t.registration.minPlayers}"></label>
        <label class="f">Joueurs par équipe (max.)<input type="number" min="1" max="30" data-type="num" data-path="registration.maxPlayers" value="${t.registration.maxPlayers}"></label>
        <label class="f">Places maximum<input type="number" min="2" max="128" data-type="num" data-path="registration.maxTeams" value="${Math.max(t.registration.maxTeams || 0, expectedOf(t))}"></label>
      </div>
      ${t.entry === 'players' ? html`<p class="hint" style="margin:0">Tournoi par joueur : soit environ ${expectedOf(t) * (t.registration.minPlayers || 4)} joueurs. Le jour J, l’onglet <b>Joueurs</b> propose la meilleure taille d’équipe selon les présents.</p>` : ''}
    </div>`,
  },
  {
    key: 'jeu', label: 'Au temps ou aux points',
    help: html`<p><b>Au temps</b> : le match dure X minutes, le plus de points (ou de buts) gagne, le nul est possible. Le planning est très fiable.</p><p><b>Aux points</b> : on joue un set de 21 ou 25 points (ou plusieurs sets). La durée varie selon le niveau.</p><p>La <b>rotation</b>, c’est le match plus le changement de terrain : comptez 2 à 3 minutes de plus que le match.</p>`,
    body: (t) => sportRulesBlock(t, { extra: true }),
  },
  {
    key: 'formule', label: 'La formule',
    help: (t) => html`<p>Voici les formules possibles avec <b>${expectedOf(t)} équipes</b> et <b>${plural(t.courts.length, 'terrain')}</b>, des rotations de ${t.slotMinutes} min${t.endTime ? `, entre ${t.startTime} et ${t.endTime}` : ''}.</p><p>Elles sont classées par nombre de matchs garantis à chaque équipe. Celles qui finissent trop tard sont grisées.</p><p>Vous pourrez affiner (nombre de poules, qualifiés, consolante…) dans les <b>réglages avancés</b>, ou plus tard dans <i>Format & planning</i>.</p>`,
    body: (t) => {
      const n = expectedOf(t);
      const ghost = { ...t, teams: Array.from({ length: n }, (_, i) => makeTeam(`É${i + 1}`, { seed: i + 1 })) };
      const sugg = suggestFormats(ghost, n).slice(0, 7);
      const key = (f) => [f.type, f.legs || 1, f.finalsTop || 0, f.pools || 0, f.poolSize || 0, f.finals || ''].join('|');
      const same = (f) => key(f) === key(t.format);
      const best = sugg.find((x) => x.fits);
      // la formule du modèle (ou choisie dans les réglages avancés) reste visible même si elle n'est pas dans la liste
      if (!sugg.some((x) => same(x.format))) {
        const p = previewDay(t, n);
        if (p) sugg.unshift({ format: t.format, label: `Formule actuelle : ${FORMATS[t.format.type]?.label || ''}${t.format.legs > 1 ? ` (${t.format.legs} manches)` : ''}${t.format.finalsTop ? ' + phase finale' : ''}`, matches: p.matches, minPerTeam: p.minM, end: p.end, fits: !p.late });
      }
      return html`<div class="stack">
        <div class="stack" style="gap:.5rem">${sugg.map((x) => {
          const on = same(x.format);
          return html`<button type="button" class="tile ${on ? 'on' : ''}" data-act="pick" data-f="${JSON.stringify(x.format)}" style="${x.fits ? '' : 'opacity:.55'}">
            <span class="row between"><b>${FORMATS[x.format.type]?.icon || ''} ${x.label}</b><span class="row" style="gap:.3rem">${x === best ? html`<span class="pill">Conseillée</span>` : ''}${on ? html`<span class="pill chosen">✓ Choisie</span>` : ''}</span></span>
            <small>${x.matches} matchs · au moins ${x.minPerTeam} par équipe · fin vers <b>${x.end}</b>${x.fits ? '' : ' (trop tard)'}</small></button>`;
        })}</div>
        <details><summary class="small" style="cursor:pointer">Réglages avancés de la formule</summary><div style="margin-top:.8rem">${sectionFormat(t)}</div></details>
      </div>`;
    },
  },
  {
    key: 'argent', label: 'Inscriptions et argent',
    help: html`<p><b>Prix</b> : par équipe ou par joueur (avec un minimum de joueurs facturés). Mettez 0 pour un tournoi gratuit.</p><p>La <b>carte buvette en option</b> se paie avec l’inscription et se crédite automatiquement au paiement.</p><p>Un <b>tournoi solidaire</b> affiche la cagnotte en direct sur le grand écran. Le club collecte les dons, puis les reverse.</p>`,
    body: (t) => html`<div class="stack">${sectionRegistration(t)}
      <div class="card flat stack"><label class="check"><input type="checkbox" data-path="charity.enabled" ${t.charity?.enabled ? raw('checked') : ''}> <span><b>Tournoi solidaire</b> (Téléthon, association…) <span class="hint">cagnotte en direct, défis par paliers</span></span></label>
        ${t.charity?.enabled ? html`<div class="grid2"><label class="f">Cause<input type="text" data-path="charity.label" value="${t.charity.label}" placeholder="Téléthon"></label><label class="f">Objectif (€)<input type="number" min="0" data-type="num" data-path="charity.goal" value="${t.charity.goal}"></label></div>` : ''}
      </div></div>`,
  },
  {
    key: 'recap', label: 'Récapitulatif',
    help: html`<p>Relisez : ce sont les <b>règles qui seront affichées</b> aux joueurs sur le grand écran et dans le portail.</p><p>Après la création, ajoutez vos équipes (ou vos joueurs), puis générez le planning dans <i>Format & planning</i>.</p>`,
    body: (t) => html`<div class="stack">
      <p style="margin:0"><b>${t.name}</b> · ${fmtDate(t.date)} · ${t.startTime}${t.endTime ? `–${t.endTime}` : ''}${t.venue ? ` · ${t.venue}` : ''}</p>
      <div class="rules-list">${tournamentRules({ ...t, matches: [] }).filter((r) => r.title !== 'À savoir').map((r) => html`<div><span class="wic">${r.icon}</span><div><b>${r.title}</b><p>${r.text}</p></div></div>`)}</div>
      <p class="hint" style="margin:0">Code organisateur de ce tournoi : <b class="num" style="font-size:1.2rem;color:var(--ink)">${t.adminPin}</b>.</p>
    </div>`,
  },
];

// ------------------------------------------------------------------ vue
export async function wizardView(ctx) {
  const t = getDraft();
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === (ctx.route.params[0] || 'tournoi')));
  const step = STEPS[idx];
  const n = expectedOf(t);
  const p = previewDay(t, n);
  const help = typeof step.help === 'function' ? step.help(t) : step.help;
  return {
    title: 'Nouveau tournoi',
    html: html`${shell({ title: 'Nouveau tournoi' })}
    <main class="wrap">
      <nav class="stepper" aria-label="Étapes">${STEPS.map((s, i) => html`<a href="#/new/${s.key}" class="${i === idx ? 'on' : i < idx ? 'done' : ''}" ${i === idx ? raw('aria-current="step"') : ''}><b>${i < idx ? '✓' : i + 1}</b>${s.label}</a>`)}</nav>
      <div class="wizard section" style="margin-top:1.2rem">
        <form class="card stack" id="wform" onsubmit="return false">
          <div><span class="small muted">Étape ${idx + 1} sur ${STEPS.length}${t._template && t._template !== 'vide' ? ` · modèle « ${TEMPLATES[t._template]?.label} »` : ''}</span><h2 style="margin:.2rem 0 0">${step.label}</h2></div>
          ${step.body(t)}
          <div class="row between" style="margin-top:.5rem">
            ${idx > 0 ? html`<a class="btn ghost" href="#/new/${STEPS[idx - 1].key}">Précédent</a>` : html`<a class="btn ghost" href="#/">Changer de modèle</a>`}
            ${idx < STEPS.length - 1 ? html`<a class="btn" href="#/new/${STEPS[idx + 1].key}">Suivant</a>` : html`<button type="button" class="btn ball" data-act="create">Créer le tournoi</button>`}
          </div>
        </form>
        <div class="stack">
          <aside class="card stack helpbox"><h3 style="margin:0">💡 Aide</h3>${help}</aside>
          ${previewCard(t, p, n)}
        </div>
      </div>
    </main>`,
    mount(root) {
      const save = () => { saveDraft(t); ctx.rerender(); };
      root.addEventListener('change', (e) => {
        const el = e.target;
        if (el.matches('[data-preview-teams]')) { t._expected = Math.max(2, +el.value || 2); return save(); }
        if (applySportRule(t, el)) return save();
        if (!el.dataset.path) return;
        applyField(t, el);
        if (el.dataset.path === 'scoring.ranking') for (const c of t.courts) if (c.scoring) c.scoring.ranking = el.value;
        save();
      });
      root.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-act]');
        if (!a || a.tagName === 'INPUT') return;
        const act = a.dataset.act;
        if (act === 'courts-dec' || act === 'courts-inc') { applyField(t, { dataset: { path: 'courtCount' }, value: t.courts.length + (act === 'courts-inc' ? 1 : -1), type: 'number' }); t.courts.forEach((c, i) => { c.color ||= COURT_COLORS[i % COURT_COLORS.length]; }); save(); }
        if (act === 'exp-dec' || act === 'exp-inc') { t._expected = Math.min(128, Math.max(2, expectedOf(t) + (act === 'exp-inc' ? 1 : -1))); if (t.registration.maxTeams < t._expected) t.registration.maxTeams = t._expected; save(); }
        if (act === 'pick') { const f = JSON.parse(a.dataset.f); delete f.label; t.format = f; save(); }
        if (act === 'add-break') { t.breaks.push({ afterSlot: 3, minutes: 30, label: 'Pause' }); save(); }
        if (act === 'rm-break') { t.breaks.splice(+a.dataset.i, 1); save(); }
        if (act === 'create') {
          if (!t.name.trim()) return toast('Donnez un nom au tournoi (étape 1)', 'err');
          a.disabled = true;
          const doc = structuredClone(t);
          doc.registration.maxTeams = Math.max(doc.registration.maxTeams || 0, expectedOf(t));
          delete doc._expected; delete doc._template;
          doc.id = `${slug(doc.name)}-${uid(4)}`;
          doc.status = 'ready';
          try {
            await createTournament(doc);
            sessionStorage.removeItem('rot:draft');
            toast('Tournoi créé : ajoutez maintenant vos équipes', 'ok');
            location.hash = `#/admin/${doc.id}/${doc.entry === 'players' ? 'joueurs' : 'equipes'}`;
          } catch (err) { toast(err.message, 'err'); a.disabled = false; }
        }
      });
    },
  };
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'tournoi';
