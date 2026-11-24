import { store } from '../store.js';
import { html, raw, toStr, toast, fmtDate, euros, plural, sportOf, qrSvg, download, logo, contrastInk, $ } from '../ui.js';
import { SPORTS } from '../engine.js';
import { FORMATS, PROVIDERS } from './settings.js';
import qrcode from '../../vendor/qrcode.mjs';
import { charityCard, declareDonation, charityOf } from './bar.js';

const placesLeft = (t) => Math.max(0, (t.registration.maxTeams || 0) - t.teams.filter((x) => x.status === 'confirmed').length);

function formatLine(t) {
  const f = t.format;
  if (f.type === 'roundrobin') return `Tout le monde se rencontre${f.legs > 1 ? ` ${f.legs} fois` : ''}${f.finalsTop ? ', puis phase finale' : ''}`;
  if (f.type === 'pools') return `Poules puis ${f.finals === 'double' ? 'double élimination' : 'phases finales'}${f.consolation ? ' et consolante' : ''}`;
  return FORMATS[f.type]?.label;
}

function ics(t) {
  const d = (t.date || '').replace(/-/g, '');
  const [h, m] = (t.startTime || '09:00').split(':');
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rotation//FR', 'BEGIN:VEVENT', `UID:${t.id}@rotation`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART:${d}T${h}${m}00`, `DTEND:${d}T${String(Math.min(23, +h + 6)).padStart(2, '0')}${m}00`, `SUMMARY:${esc(t.name)}`, `LOCATION:${esc([t.venue, t.address].filter(Boolean).join(', '))}`, `DESCRIPTION:${esc(t.tagline || t.description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export async function view(ctx) {
  const { t } = ctx;
  const left = placesLeft(t);
  const r = t.registration;
  const ink = contrastInk(t.theme || '#0B6E2E');
  const sports = [...new Set(t.courts.map((c) => c.sport))].map((k) => SPORTS[k]);
  const ch = t.charity;
  return {
    title: t.name,
    html: html`<section class="promo-hero" style="background:${t.theme || 'var(--court)'};${ink ? 'color:var(--ink)' : ''}"><div class="in">
      <div>
        <a href="#/" class="brand" style="${ink ? 'color:var(--ink)' : ''};font-size:1.1rem;margin-bottom:1.5rem">${logo}<span>${t.organizer || 'Rotation'}</span></a>
        <div class="when" style="${ink ? 'color:var(--ink)' : ''}">${fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${t.startTime.replace(':', ' h ')}</div>
        <h1>${t.name}</h1>
        ${t.tagline ? html`<p style="font-size:1.25rem;max-width:32em">${t.tagline}</p>` : ''}
        <div class="promo-facts">
          <div><b>${sports.map((s) => s.icon).join(' ')}</b><small>${sports.map((s) => s.label).join(', ')}</small></div>
          <div><b>${r.maxTeams}</b><small>équipes de ${r.minPlayers} à ${r.maxPlayers}</small></div>
          <div><b>${r.fee ? euros(r.fee) : 'Gratuit'}</b><small>${r.fee ? (r.feeMode === 'player' ? 'par joueur (minimum)' : 'par équipe') : 'participation libre'}</small></div>
          <div><b>${t.venue || '—'}</b><small>${t.address || ''}</small></div>
        </div>
        ${r.open ? html`<div class="stack" style="max-width:420px">
          <div class="places"><i style="width:${(100 * (r.maxTeams - left)) / (r.maxTeams || 1)}%"></i></div>
          <span>${left ? `${plural(left, 'place restante', 'places restantes')} sur ${r.maxTeams}` : 'Complet : inscription possible en liste d’attente'}</span>
          <div class="row"><a class="btn ${ink ? '' : 'ball'}" href="#/inscription/${t.id}" style="min-height:52px;font-size:1.1rem">Inscrire mon équipe</a><button class="btn ghost" style="${ink ? '' : 'color:#fff;border-color:rgba(255,255,255,.4)'}" data-act="ics">Ajouter à mon agenda</button></div>
        </div>` : html`<a class="btn ball" href="#/t/${t.id}">Suivre le tournoi en direct</a>`}
      </div>
      <canvas id="poster" width="1080" height="1350" class="poster-preview" aria-label="Affiche du tournoi"></canvas>
    </div></section>
    <main class="wrap narrow stack">
      ${charityCard(t)}
      ${t.description ? html`<div class="card"><h2>Le tournoi</h2><p style="white-space:pre-line">${t.description}</p><p><b>Format :</b> ${formatLine(t)}.</p>${t.infos ? html`<p style="white-space:pre-line" class="muted">${t.infos}</p>` : ''}</div>` : ''}
      <div class="card stack"><h2>Partager</h2>
        <div class="share">
          <a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}">Facebook</a>
          <a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${t.name} — ${fmtDate(t.date)} ${location.href}`)}">WhatsApp</a>
          <a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(location.href)}">LinkedIn</a>
          <button class="btn ghost sm" data-act="share">Partager…</button>
          <button class="btn ghost sm" data-act="poster">Télécharger l’affiche</button>
        </div>
        ${[t.social?.facebook, t.social?.instagram, t.social?.website].some(Boolean) ? html`<p class="small" style="margin:0">Suivez-nous : ${t.social.facebook ? html`<a href="${t.social.facebook}" target="_blank" rel="noopener">Facebook</a> ` : ''}${t.social.instagram ? html`<a href="${t.social.instagram}" target="_blank" rel="noopener">Instagram</a> ` : ''}${t.social.website ? html`<a href="${t.social.website}" target="_blank" rel="noopener">Site web</a>` : ''}</p>` : ''}
      </div>
      ${(t.sponsors || []).filter((s) => s.name).length ? html`<div class="card"><h2>Nos partenaires</h2><div class="row">${t.sponsors.filter((s) => s.name).map((s) => html`<span class="pill" style="font-size:1rem">${s.name}</span>`)}</div></div>` : ''}
      <p class="small muted">Le jour J, suivez les matchs en direct sur <a href="#/t/${t.id}">le portail du tournoi</a>. ${t.contact ? `Contact : ${t.contact}` : ''}</p>
    </main>`,
    async mount(root) {
      const cv = $('#poster', root);
      drawPoster(cv, t, 'post', store.baseUrl());
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'declare-don') declareDonation(t);
        if (b.dataset.act === 'ics') download(`${t.id}.ics`, ics(t), 'text/calendar');
        if (b.dataset.act === 'poster') (await posterCanvas(t, 'post', store.baseUrl())).toBlob((blob) => download(`affiche-${t.id}.png`, blob));
        if (b.dataset.act === 'share') {
          try { await navigator.share({ title: t.name, text: t.tagline, url: location.href }); } catch { navigator.clipboard?.writeText(location.href); toast('Lien copié', 'ok'); }
        }
      });
    },
  };
}

// ------------------------------------------------------------------ inscription
export async function registerView(ctx) {
  const { t } = ctx;
  const r = t.registration;
  const left = placesLeft(t);
  const closed = !r.open || (r.deadline && new Date(r.deadline + 'T23:59:59') < new Date());
  return {
    title: `Inscription · ${t.name}`,
    html: html`<header class="topbar" style="background:${t.theme || 'var(--ink)'}"><div class="in"><a class="brand ${contrastInk(t.theme || '#0F2A17')}" href="#/p/${t.id}" style="${contrastInk(t.theme || '#0F2A17') ? 'color:var(--ink)' : ''}">${logo}<span>${t.name}</span></a></div></header>
    <main class="wrap narrow" id="reg">
      ${closed ? html`<div class="empty"><h2>Les inscriptions sont fermées</h2><p>Contactez l’organisation : ${t.contact || t.organizer}</p></div>` : html`
      <form class="card stack" id="regform">
        <div><h2 style="margin:0">Inscrire mon équipe</h2><p class="muted" style="margin:0">${fmtDate(t.date)} · ${t.venue} · ${r.fee ? `${euros(r.fee)} par ${r.feeMode === 'player' ? 'joueur' : 'équipe'}` : 'gratuit'}</p></div>
        ${!left ? html`<p class="pill warn">Complet : votre équipe sera placée en liste d’attente.</p>` : html`<p class="small muted" style="margin:0">${plural(left, 'place restante', 'places restantes')}.${r.requireValidation ? ' L’organisation valide chaque inscription.' : ''}</p>`}
        <label class="f">Nom de l’équipe<input type="text" name="name" required maxlength="40" autocomplete="off"></label>
        <div class="grid2"><label class="f">Capitaine<input type="text" name="captain" required maxlength="60" autocomplete="name"></label><label class="f">Téléphone<input type="tel" name="phone" required autocomplete="tel"></label></div>
        <label class="f">E-mail<input type="email" name="email" required autocomplete="email"></label>
        <label class="f">Niveau de l’équipe<select name="level"><option value="1">Confirmé (compétition)</option><option value="2" selected>Intermédiaire (loisir régulier)</option><option value="3">Débutant</option></select><span class="hint">Sert à équilibrer les poules.</span></label>
        <label class="f">Joueurs <span class="hint">De ${r.minPlayers} à ${r.maxPlayers}, un prénom et nom par ligne</span><textarea name="players" rows="${Math.max(4, r.minPlayers)}" required></textarea></label>
        <label class="f">Un mot pour l’organisation <span class="hint">Facultatif</span><textarea name="comment" rows="2" maxlength="300"></textarea></label>
        <label class="check"><input type="checkbox" name="consent" required> <span class="small">J’accepte que ces informations servent uniquement à l’organisation du tournoi. Elles sont supprimées après l’événement.</span></label>
        <button class="btn ball block" style="min-height:52px">Inscrire mon équipe</button>
      </form>`}
    </main>`,
    keep: () => true, // ne jamais redessiner le formulaire (ni la confirmation) pendant la saisie
    mount(root) {
      $('#regform', root)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const players = f.players.value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (players.length < r.minPlayers || players.length > r.maxPlayers) return toast(`Indiquez entre ${r.minPlayers} et ${r.maxPlayers} joueurs`, 'err');
        const btn = f.querySelector('button');
        btn.disabled = true;
        try {
          const res = await store.register(t.id, { name: f.name.value, captain: f.captain.value, phone: f.phone.value, email: f.email.value, level: f.level.value, players, comment: f.comment.value });
          $('#reg', root).innerHTML = confirmation(t, res.team, f.email.value);
          $('#reg', root).addEventListener('click', (ev) => { if (ev.target.closest('[data-act=ics]')) download(`${t.id}.ics`, ics(t), 'text/calendar'); });
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
      });
    },
  };
}

function confirmation(t, team, email) {
  const r = t.registration;
  const status = { confirmed: ['Inscription confirmée 🎉', 'Votre équipe est inscrite.'], pending: ['Inscription reçue', 'L’organisation va valider votre inscription.'], waitlist: ['Liste d’attente', 'Le tournoi est complet. Vous serez prévenus si une place se libère.'] }[team.status];
  let pay = r.paymentUrl;
  if (pay && r.paymentProvider === 'stripe') {
    try { const u = new URL(pay); u.searchParams.set('client_reference_id', team.ref || team.id); if (email) u.searchParams.set('prefilled_email', email); pay = u.href; } catch { /* lien invalide */ }
  }
  const needPay = r.fee > 0 && team.status !== 'waitlist';
  const due = r.feeMode === 'player' ? r.fee * Math.max(team.players?.length || 0, r.minPlayers || 1) : r.fee;
  return toStr(html`<div class="card stack" style="text-align:center">
    <h2>${status[0]}</h2><p>${status[1]}</p>
    <div class="grid2" style="text-align:left">
      <div class="card flat"><span class="muted small">Référence</span><div class="num" style="font-size:1.8rem">${team.ref || '—'}</div></div>
      ${team.pin ? html`<div class="card flat"><span class="muted small">Code PIN de l’équipe</span><div class="num" style="font-size:1.8rem">${team.pin}</div><span class="hint">Pour saisir vos scores le jour J. Gardez-le !</span></div>` : ''}
    </div>
    ${needPay ? html`<div class="card flat stack"><b>Paiement : ${euros(due)}</b>${r.feeMode === 'player' ? html`<span class="hint">${euros(r.fee)} par joueur. Vous pouvez donner plus : tout va à la cause 💛</span>` : ''}
      ${pay && r.paymentProvider !== 'onsite' ? html`<a class="btn ball block" href="${pay}" target="_blank" rel="noopener">Payer avec ${PROVIDERS[r.paymentProvider]?.label || 'le lien'}</a><span class="hint">Indiquez la référence ${team.ref || ''} si elle est demandée.</span>` : html`<span>Le règlement se fait sur place, à l’accueil, le jour du tournoi.</span>`}</div>` : ''}
    <div class="row" style="justify-content:center"><button class="btn ghost" data-act="ics">Ajouter à mon agenda</button><a class="btn ghost" href="#/p/${t.id}">Retour à la page du tournoi</a></div>
  </div>`);
}

// ------------------------------------------------------------------ affiche (canvas)
export async function posterCanvas(t, format = 'post', base = '') {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = format === 'story' ? 1920 : 1350;
  await drawPoster(c, t, format, base);
  return c;
}

export async function drawPoster(c, t, format, base) {
  try { await Promise.all([document.fonts.load('800 120px "Barlow Condensed"'), document.fonts.load('700 60px "Barlow Condensed"'), document.fonts.load('500 40px Barlow')]); } catch { /* */ }
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const theme = t.theme || '#0B6E2E';
  const ink = contrastInk(theme) ? '#0F2A17' : '#FFFFFF';
  g.fillStyle = theme; g.fillRect(0, 0, W, H);
  // terrain vu du dessus en filigrane
  g.save(); g.globalAlpha = 0.18; g.strokeStyle = ink; g.lineWidth = 10;
  g.strokeRect(70, H * 0.56, W - 140, H * 0.42);
  g.beginPath(); g.moveTo(70, H * 0.77); g.lineTo(W - 70, H * 0.77); g.stroke();
  g.setLineDash([18, 14]); g.beginPath(); g.moveTo(70, H * 0.77 - 90); g.lineTo(W - 70, H * 0.77 - 90); g.stroke();
  g.restore();
  // ballon
  g.fillStyle = '#FBD600'; g.beginPath(); g.arc(W - 150, 170, 90, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0F2A17'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.arc(W - 150, 170, 90, -1.2, 0.6); g.stroke();
  g.beginPath(); g.moveTo(W - 235, 140); g.quadraticCurveTo(W - 150, 120, W - 80, 210); g.stroke();

  g.fillStyle = ink; g.textBaseline = 'alphabetic';
  let y = format === 'story' ? 300 : 210;
  g.font = '700 52px "Barlow Condensed", sans-serif';
  g.fillText(fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase() + ` · ${t.startTime.replace(':', 'H')}`, 70, y);
  y += 40;
  // Titre sur plusieurs lignes
  g.font = '800 150px "Barlow Condensed", sans-serif';
  const words = t.name.toUpperCase().split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) { const tryL = line ? `${line} ${w}` : w; if (g.measureText(tryL).width > W - 300 && line) { lines.push(line); line = w; } else line = tryL; }
  lines.push(line);
  const size = lines.length > 3 ? 110 : 150;
  g.font = `800 ${size}px "Barlow Condensed", sans-serif`;
  for (const l of lines.slice(0, 4)) { y += size * 0.95; g.fillText(l, 70, y); }
  y += 70;
  g.font = '500 40px Barlow, sans-serif';
  const sub = t.tagline || formatLine(t);
  for (const l of wrap(g, sub, W - 140).slice(0, 3)) { g.fillText(l, 70, y); y += 52; }
  // bandeau infos
  const by = H - (format === 'story' ? 560 : 420);
  g.fillStyle = '#0F2A17'; roundRect(g, 50, by, W - 100, format === 'story' ? 470 : 350, 36); g.fill();
  g.fillStyle = '#FFFFFF';
  g.font = '700 58px "Barlow Condensed", sans-serif';
  g.fillText(t.venue || '', 100, by + 95);
  g.font = '500 34px Barlow, sans-serif';
  g.fillText(t.address || '', 100, by + 145);
  const r = t.registration;
  g.font = '700 46px "Barlow Condensed", sans-serif';
  g.fillStyle = '#FBD600';
  g.fillText(`${r.maxTeams} ÉQUIPES · ${r.fee ? euros(r.fee).toUpperCase() + (r.feeMode === 'player' ? ' / JOUEUR' : ' / ÉQUIPE') : 'GRATUIT'}`, 100, by + 215);
  if (t.charity?.enabled) { g.fillText(`AU PROFIT DU ${String(t.charity.label || '').toUpperCase()}`, 100, by + 270); }
  g.fillStyle = '#FFFFFF'; g.font = '600 32px Barlow, sans-serif';
  g.fillText('Inscriptions : scannez le QR code', 100, by + (format === 'story' ? 400 : 315));
  // QR
  if (base) {
    const q = qrcode(0, 'M'); q.addData(`${base}#/inscription/${t.id}`); q.make();
    const n = q.getModuleCount(), size2 = 250, cell = size2 / (n + 4), qx = W - 100 - size2, qy = by + 50;
    g.fillStyle = '#fff'; roundRect(g, qx, qy, size2, size2, 16); g.fill();
    g.fillStyle = '#0F2A17';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) g.fillRect(qx + (j + 2) * cell, qy + (i + 2) * cell, cell + 0.5, cell + 0.5);
  }
}

function wrap(g, text, max) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) { const tl = line ? `${line} ${w}` : w; if (g.measureText(tl).width > max && line) { out.push(line); line = w; } else line = tl; }
  if (line) out.push(line);
  return out;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
