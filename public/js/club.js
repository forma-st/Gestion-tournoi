// Tournoi interne du club : joueurs inscrits individuellement → équipes équilibrées → formule adaptée à l'horaire.
import { makeTeam, buildSchedule, scheduleStats, slotTime, uid } from './engine.js';

export const LEVELS = { 1: 'Débutant', 2: 'Loisir', 3: 'Confirmé', 4: 'Compétition' };

const TEAM_NAMES = ['Les Smasheurs', 'Block Party', 'Filet Mignon', 'Les Manchettes', 'Ace Ventura', 'Les Libéros', 'Service Gagnant', 'Les Passeurs Fous', 'Les Tie-Breakers', 'Bloc Opératoire', 'Les Rotations', 'Pas de Côté', 'Les Kangourous', 'Sable Chaud', 'Les Contres', 'Volley Gones'];

/** Tailles d'équipes possibles pour N joueurs et C terrains. */
export function teamOptions(nPlayers, nCourts, minSize = 4, maxSize = 6) {
  const out = [];
  for (let size = minSize; size <= maxSize; size++) {
    const teams = Math.floor(nPlayers / size);
    if (teams < 2) continue;
    const extra = nPlayers - teams * size; // joueurs en plus, répartis (équipes de size+1)
    const playing = Math.min(teams - (teams % 2), nCourts * 2);
    out.push({ size, teams, extra, resting: teams - playing, label: `${teams} équipes de ${size}${extra ? ` (${extra} à ${size + 1})` : ''}`, fit: teams === nCourts * 2 ? 2 : teams === nCourts * 2 + 1 ? 1 : 0 });
  }
  return out.sort((a, b) => b.fit - a.fit || a.extra - b.extra);
}

/**
 * Répartit les joueurs en N équipes équilibrées : serpentin par niveau (hommes et femmes séparément
 * si mixité), puis échanges successifs pour rapprocher les totaux de niveau.
 */
export function balanceTeams(players, nTeams, { mixed = true, seed = 1 } = {}) {
  let r = seed;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const teams = Array.from({ length: nTeams }, () => []);
  const groups = mixed ? [players.filter((p) => p.gender === 'F'), players.filter((p) => p.gender !== 'F')] : [players];
  let offset = 0;
  for (const g of groups) {
    const sorted = g.slice().sort((a, b) => (+b.level || 2) - (+a.level || 2) || rand() - 0.5);
    sorted.forEach((p, i) => {
      const row = Math.floor((i + offset) / nTeams), col = (i + offset) % nTeams;
      teams[row % 2 ? nTeams - 1 - col : col].push(p);
    });
    offset += sorted.length;
  }
  const sum = (t) => t.reduce((a, p) => a + (+p.level || 2), 0);
  // Améliorations locales : échanger deux joueurs de même genre si l'écart max diminue
  for (let it = 0; it < 200; it++) {
    const sums = teams.map(sum);
    const hi = sums.indexOf(Math.max(...sums)), lo = sums.indexOf(Math.min(...sums));
    if (sums[hi] - sums[lo] <= 1) break;
    let done = false;
    for (const a of teams[hi]) {
      for (const b of teams[lo]) {
        const d = (+a.level || 2) - (+b.level || 2);
        if (d > 0 && d < sums[hi] - sums[lo] && (!mixed || (a.gender === 'F') === (b.gender === 'F'))) {
          teams[hi].splice(teams[hi].indexOf(a), 1, b);
          teams[lo].splice(teams[lo].indexOf(b), 1, a);
          done = true; break;
        }
      }
      if (done) break;
    }
    if (!done) break;
  }
  return teams.map((members, i) => ({ name: TEAM_NAMES[i] || `Équipe ${i + 1}`, members, total: sum(members), avg: members.length ? sum(members) / members.length : 0 }));
}

/** Crée les équipes du tournoi à partir d'une répartition. */
export function applyTeams(t, split) {
  t.teams = split.map((s, i) => makeTeam(s.name, {
    seed: i + 1, level: Math.max(1, Math.min(3, 5 - Math.round(s.avg))), players: s.members.map((p) => p.name),
    playerIds: s.members.map((p) => p.id), status: 'confirmed', payment: 'free', source: 'tirage',
  }));
  t.matches = []; t.pools = {}; t.pools2 = null;
  return t;
}

const toMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };

/** Formules candidates qui tiennent entre l'heure de début et l'heure de fin, les plus riches en matchs d'abord. */
export function suggestFormats(t, nTeams) {
  const n = Math.max(2, nTeams || t.teams.filter((x) => x.status === 'confirmed').length);
  const nC = t.courts.filter((c) => c.active !== false).length || 1;
  const cands = [
    { type: 'roundrobin', legs: 1, label: 'Championnat : tout le monde se rencontre' },
    { type: 'roundrobin', legs: 1, finalsTop: 2, label: 'Championnat + finale' },
    { type: 'roundrobin', legs: 1, finalsTop: 4, thirdPlace: true, label: 'Championnat + demi-finales' },
    { type: 'roundrobin', legs: 2, label: 'Championnat aller-retour' },
    { type: 'levels', poolSize: 3, placement: true, label: 'Poules de 3 + niveaux + classement' },
    { type: 'levels', poolSize: 4, placement: true, label: 'Poules de 4 + niveaux + classement' },
    ...[2, 3, 4].map((p) => ({ type: 'pools', pools: p, qualifiers: 2, finals: 'single', thirdPlace: true, label: `${p} poules + phases finales` })),
    { type: 'single', thirdPlace: true, label: 'Élimination directe' },
    { type: 'double', label: 'Double élimination avec repêchage' },
  ].filter((f) => !(f.type === 'pools' && n / f.pools < 3) && !(f.type === 'roundrobin' && n > 10 && f.legs === 1 && !f.finalsTop) && !(f.legs === 2 && n > 8) && !(f.type === 'levels' && n < 6));
  const start = toMin(t.startTime);
  const wrap = (x) => (x < start ? x + 1440 : x); // tournois qui finissent après minuit
  const end = wrap(toMin(t.endTime || '23:59'));
  const fakeTeams = Array.from({ length: n }, (_, i) => makeTeam(`É${i + 1}`, { seed: i + 1 }));
  const res = [];
  for (const f of cands) {
    try {
      const s = buildSchedule({ ...t, teams: fakeTeams, format: f });
      const st = scheduleStats(s);
      const finish = start + st.slots * (t.slotMinutes || 20) + (t.breaks || []).filter((b) => b.afterSlot < st.slots - 1).reduce((a, b) => a + b.minutes, 0);
      const per = Object.values(st.perTeam);
      const playing = s.matches.filter((m) => m.status !== 'bye');
      const counts = {};
      for (const m of playing) for (const id of [m.teamA, m.teamB]) if (id) counts[id] = (counts[id] || 0) + 1;
      const minM = per.length ? Math.min(...per) : 0;
      res.push({ format: f, label: f.label, matches: playing.length, slots: st.slots, end: slotTime(t, st.slots), minPerTeam: minM + (f.type !== 'roundrobin' || f.finalsTop ? 1 : 0), spare: end - finish });
    } catch { /* formule impossible avec ce nombre d'équipes */ }
  }
  res.forEach((r) => { r.fits = r.spare >= 0; });
  void nC;
  return res.sort((a, b) => (b.fits - a.fits) || (a.fits ? b.minPerTeam - a.minPerTeam || a.spare - b.spare : b.spare - a.spare));
}

export function newPlayer(name, over = {}) {
  return { id: uid(6), name, level: 2, gender: '', present: false, paid: false, source: 'admin', createdAt: new Date().toISOString(), ...over };
}

export { toMin };
