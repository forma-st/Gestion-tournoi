import { store } from '../store.js';
import { html, raw, toStr, toast, modal, fmtDate, euros, plural, $, $$ } from '../ui.js';
import { newTournament, buildSchedule, uid, SPORTS, setArchived } from '../engine.js';
import { buildDemo, simulate, DEMOS } from '../demo.js';
import { shell } from './shell.js';
import { TEMPLATES, makeTemplate, saveDraft } from './wizard.js';
import { sectionEssentials, sectionCourts, sectionFormat, sectionRules, sectionRegistration, applyField, previewDay, previewCard, formulaCompare, FORMATS } from './settings.js';

// ------------------------------------------------------------------ accueil
let showArch = false;

export async function homeView(ctx) {
  const list = await store.list();
  const isArch = (t) => !!t.archived;
  const active = list.filter((t) => !isArch(t));
  const archived = list.filter(isArch).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const canEdit = (t) => store.mode === 'local' || !!store.pin(t.id) || !!store.adminKey();
  const card = (t) => html`<div class="tcard" style="--c:${t.theme || '#0B6E2E'};${isArch(t) ? 'opacity:.85' : ''}" data-tid="${t.id}" data-name="${t.name}">
    <a href="#/admin/${t.id}" style="text-decoration:none;color:inherit;display:grid;gap:.5rem">
      <h3>${t.name}</h3>
      <span class="muted">${fmtDate(t.date)}${t.venue ? ` · ${t.venue}` : ''}</span>
      <div class="row">${isArch(t) ? html`<span class="pill">Archivé</span>` : ''}<span class="pill">${plural(Array.isArray(t.teams) ? t.teams.filter((x) => x.status === 'confirmed').length : t.teams, 'équipe')}</span><span class="pill">${plural(Array.isArray(t.courts) ? t.courts.length : t.courts, 'terrain')}</span>${!isArch(t) && (t.registration?.fee ?? t.fee) ? html`<span class="pill">${euros(t.registration?.fee ?? t.fee)}</span>` : ''}</div>
    </a>
    ${canEdit(t) ? html`<div class="row"><button class="linkbtn small" data-act="${isArch(t) ? 'unarchive' : 'archive'}">${isArch(t) ? 'Désarchiver' : 'Archiver'}</button></div>` : ''}
  </div>`;
  const demoCourts = [
    { c: '#0B6E2E', s: '🏐 Volley', a: 'Les Smasheurs', b: 'Block Party', pa: 6, pb: 4, t: '08:12' },
    { c: '#00897B', s: '⚽ Football', a: 'Filet Mignon', b: 'Ace Ventura', pa: 2, pb: 2, t: '05:40' },
    { c: '#5A7D3A', s: '🏀 Basket', a: 'Les Manchettes', b: 'Service Gagnant', pa: 14, pb: 9, t: '10:03' },
  ];
  return {
    title: '',
    html: html`${shell()}
    <section class="hero"><div class="in">
      <div>
        <h1>Votre tournoi, du premier service au <mark>podium</mark>.</h1>
        <p class="lead">Poules, rotations multisport, phases finales et repêchage. Les joueurs saisissent les scores sur leur téléphone par QR code, le grand écran suit en direct. Fonctionne même sans Internet.</p>
        <div class="row"><button class="btn ball" data-act="tpl" data-kind="vide">Créer un tournoi</button><button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="demo" data-kind="multisport" data-sim="3">Voir le Téléthon en direct</button></div>
      </div>
      <div class="court-art stack" aria-hidden="true">
        ${demoCourts.map((d, i) => html`<div class="court ${d.light ? 'light' : ''}" style="--c:${d.c}">
          <div class="ch"><span>Terrain ${i + 1} · ${d.s}</span></div>
          <div class="halves"><div class="half"><div class="tn">${d.a}</div><div class="pts">${d.pa}</div></div><div class="half"><div class="tn">${d.b}</div><div class="pts">${d.pb}</div></div></div>
          <div class="foot"><span>⏱ ${d.t}</span></div></div>`)}
      </div>
    </div></section>
    <main class="wrap">
      <section>
        <div class="row between"><h2>Mes tournois</h2><button class="btn" data-act="tpl" data-kind="vide">Nouveau tournoi</button></div>
        ${active.length ? html`<div class="tlist">${active.map(card)}</div>`
        : html`<div class="empty"><p><b>${archived.length ? 'Aucun tournoi en cours.' : 'Aucun tournoi pour l’instant.'}</b></p><p>Créez le vôtre en quelques minutes à partir d’un modèle ci-dessous.</p></div>`}
        ${archived.length ? html`<details class="section" ${showArch ? raw('open') : ''} data-arch><summary style="cursor:pointer;font-weight:600">Archives (${archived.length})</summary>
          <div class="stack" style="margin-top:.8rem">${archived.length > 6 ? html`<input type="search" data-arch-q placeholder="Rechercher dans les archives" style="max-width:360px">` : ''}
          <div class="tlist" data-arch-list>${archived.map(card)}</div></div></details>` : ''}
      </section>
      <section class="section">
        <h2>Créer un tournoi à partir d’un modèle</h2>
        <p class="muted" style="margin-top:-.4rem">La structure est prête (sports, règles, horaires, carte de la buvette) ; un assistant vous guide ensuite étape par étape.</p>
        <div class="tiles">
          ${Object.entries(TEMPLATES).map(([k, m]) => html`<div class="tile" style="cursor:default"><b>${m.icon} ${m.label}</b><small>${m.desc}</small>
            <div class="row" style="margin-top:.5rem"><button class="btn sm" data-act="tpl" data-kind="${k}">Utiliser ce modèle</button>${DEMOS[k] ? html`<button class="linkbtn small" data-act="demo" data-kind="${k}" data-sim="${k === 'interne' ? -1 : k === 'fluo' ? 7 : 3}">Voir la démo</button>` : ''}</div></div>`)}
        </div>
      </section>
      <section class="section">
        <h2>Tout le tournoi dans un seul outil</h2>
        <div class="feature-list">
          ${[
            ['🔁', 'Rotations multisport', 'Chaque équipe joue autant de fois chaque sport. Une seule équipe au repos, qui arbitre.'],
            ['📱', 'Feuilles de match par QR code', 'Un QR code par terrain : les joueurs comptent les points sur leur téléphone, le classement suit.'],
            ['📺', 'Grand écran', 'Terrains en cours, prochains matchs et classement défilent sur la TV de la salle.'],
            ['🏆', 'Poules, tableaux, repêchage', 'Poules puis phases finales, consolante, double élimination avec tableau de repêchage.'],
            ['⏱️', 'Aux points ou au temps', 'Sets de 25, 2 sets de 21, ou matchs chronométrés : chaque terrain a sa règle.'],
            ['💳', 'Inscriptions et paiement', 'Formulaire en ligne, liste d’attente, paiement HelloAsso, Stripe ou sur place.'],
            ['📣', 'Page de promotion', 'Une page à partager et une affiche prête pour Instagram et Facebook.'],
            ['📶', 'Hors ligne', 'Un ordinateur suffit : le réseau local du gymnase fait le reste, sans Internet.'],
          ].map(([ic, b, s]) => html`<div class="feature"><span class="ic">${ic}</span><b>${b}</b><span>${s}</span></div>`)}
        </div>
      </section>
      ${store.keyRequired ? html`<p class="small section" style="margin-bottom:0">${store.adminKey() ? '🔑 Clé organisateur enregistrée sur cet appareil.' : '🔑 Pour créer un tournoi, la clé organisateur vous sera demandée.'} <button class="linkbtn small" data-act="admin-key">${store.adminKey() ? 'Changer' : 'Saisir la clé'}</button></p>` : ''}
      <p class="small muted section">${store.mode === 'local' ? 'Mode autonome : vos tournois sont enregistrés dans ce navigateur. Lancez le serveur Rotation pour partager les scores entre téléphones.' : 'Connecté au serveur Rotation : les scores sont partagés en direct entre tous les appareils du réseau.'}</p>
    </main>`,
    mount(root) {
      root.querySelector('[data-arch]')?.addEventListener('toggle', (e) => { showArch = e.target.open; });
      root.querySelector('[data-arch-q]')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        root.querySelectorAll('[data-arch-list] [data-tid]').forEach((el) => { el.hidden = q && !el.dataset.name.toLowerCase().includes(q); });
      });
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act=admin-key]')) { await askAdminKey(); return ctx.rerender(); }
        const ar = e.target.closest('[data-act=archive],[data-act=unarchive]');
        if (ar) {
          const c = ar.closest('[data-tid]');
          const on = ar.dataset.act === 'archive';
          try { await store.mutate(c.dataset.tid, (d) => setArchived(d, on)); toast(on ? `« ${c.dataset.name} » archivé` : `« ${c.dataset.name} » remis dans les tournois en cours`, 'ok'); showArch = !on ? showArch : true; ctx.rerender(); }
          catch (err) { toast(err.message, 'err'); }
          return;
        }
        const tp = e.target.closest('[data-act=tpl]');
        if (tp) { saveDraft(makeTemplate(tp.dataset.kind)); location.hash = '#/new/tournoi'; return; }
        const b = e.target.closest('[data-act=demo]');
        if (!b) return;
        b.disabled = true;
        try {
          let t = buildSchedule(buildDemo(b.dataset.kind));
          t.id = `${b.dataset.kind === 'multisport' ? 'telethon' : b.dataset.kind}-${uid(4)}`;
          if (b.dataset.kind === 'interne') t = { ...buildDemo('interne'), id: `interne-${uid(4)}` };
          else if (+b.dataset.sim >= 0) { simulate(t, +b.dataset.sim); t.status = 'live'; }
          else t.status = 'ready';
          await createTournament(t);
          toast('Démo créée : données fictives, à supprimer ou archiver après', 'ok');
          location.hash = `#/admin/${t.id}${b.dataset.kind === 'interne' ? '/joueurs' : ''}`;
        } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      });
    },
  };
}

/** Crée le tournoi ; si le serveur est en ligne, demande la clé organisateur affichée à son démarrage. */
/** Demande la clé organisateur, la vérifie auprès du serveur et la garde sur cet appareil. Renvoie true si elle est bonne. */
export async function askAdminKey() {
  let error = '';
  for (let i = 0; i < 5; i++) {
    const r = await modal({ title: 'Clé organisateur', ok: 'Valider', body: html`<p style="margin:0">Seule l’organisation peut créer un tournoi. ${store.hosted ? 'La clé est celle de la variable ADMIN_KEY du projet Vercel.' : 'La clé s’affiche dans la fenêtre du serveur, au démarrage.'} Elle est ensuite gardée sur cet appareil.</p>
      ${error ? html`<p class="pill no" style="justify-self:start">${error}</p>` : ''}
      <label class="f">Clé organisateur<input type="text" name="key" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" value="${store.adminKey()}"></label>` });
    if (!r) return false;
    error = await store.checkAdminKey(r.key);
    if (!error) { store.setAdminKey(r.key); toast('Clé organisateur enregistrée sur cet appareil', 'ok'); return true; }
  }
  return false;
}

/** Crée le tournoi ; si le serveur est en ligne, demande (et vérifie) la clé organisateur. */
export async function createTournament(t) {
  try { return await store.create(t); }
  catch (e) {
    if (e.status !== 401) throw e;
    if (!(await askAdminKey())) throw new Error('Création annulée : clé organisateur manquante');
    return store.create(t);
  }
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'tournoi';

export function compareTable(opts, t) {
  return html`<div class="card flat stack">
    <div><h3 style="margin:0">Trouver la bonne durée</h3><p class="hint" style="margin:0">Même nombre d’équipes et de terrains, plusieurs formules. Choisissez celle qui tient dans votre journée.</p></div>
    <div class="tscroll"><table class="t">
      <thead><tr><th>Formule</th><th class="n">Matchs</th><th class="n">Par équipe</th><th class="n">Durée</th><th class="n">Fin</th><th></th></tr></thead>
      <tbody>${opts.map((o) => {
        const on = (t.format.legs || 1) === o.legs && (t.format.finalsTop || 0) === o.top;
        return html`<tr class="${on ? 'chosen-row' : ''}">
          <td><b>${o.legs === 1 ? 'Chacun se rencontre 1 fois' : `Chacun se rencontre ${o.legs} fois`}</b>${o.top ? ' + demi-finales et finale' : ''}<br><span class="hint">${new Set(t.courts.map((c) => c.sport)).size < 2 ? (o.legs === 2 ? 'aller-retour' : o.legs === 3 ? 'trois fois' : 'une fois') : o.legs === 1 ? 'dans un seul sport, réparti équitablement' : `dans ${o.legs} sports différents`}</span></td>
          <td class="n">${o.matches}</td><td class="n">${o.minM === o.maxM ? o.minM : `${o.minM}–${o.maxM}`}${o.top ? '+' : ''}</td>
          <td class="n">${Math.floor(o.playMin / 60)} h ${String(o.playMin % 60).padStart(2, '0')}</td><td class="n"><b>${o.end}</b></td>
          <td>${on ? html`<span class="pill chosen">✓ Choisie</span>` : html`<button type="button" class="btn ghost sm" data-act="pick-formula" data-legs="${o.legs}" data-top="${o.top}">Choisir</button>`}</td></tr>`;
      })}</tbody></table></div>
  </div>`;
}
