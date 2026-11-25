import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/js/engine.js';
import { buildDemo } from '../public/js/demo.js';

const teams = (n) => Array.from({ length: n }, (_, i) => E.makeTeam(`Équipe ${i + 1}`, { seed: i + 1 }));

test('round-robin 7 équipes : 21 matchs, chacun rencontre tout le monde une fois', () => {
  const ids = teams(7).map((t) => t.id);
  const rounds = E.roundRobin(ids);
  assert.equal(rounds.length, 7);
  const pairs = rounds.flat();
  assert.equal(pairs.length, 21);
  const seen = new Set(pairs.map(([a, b]) => [a, b].sort().join('|')));
  assert.equal(seen.size, 21);
  for (const r of rounds) assert.equal(r.length, 3);
});

test('multisport 7 équipes / 3 terrains : 7 créneaux, chaque équipe joue 2 fois par sport', () => {
  const base = buildDemo('multisport');
  base.format = { type: 'roundrobin', legs: 1 };
  const t = E.buildSchedule(base);
  const st = E.scheduleStats(t);
  assert.equal(st.matches, 21);
  assert.equal(st.slots, 7);
  // l'équipe au repos arbitre
  for (let s = 0; s < 7; s++) assert.equal(t.matches.filter((m) => m.slot === s && m.referee).length, 1);
  for (const [team, byCourt] of Object.entries(st.courtPerTeam)) {
    const counts = t.courts.map((c) => byCourt[c.id] || 0);
    assert.deepEqual(counts, [2, 2, 2], `répartition ${team}`);
  }
  // une seule équipe au repos par créneau
  for (let s = 0; s < 7; s++) {
    const playing = t.matches.filter((m) => m.slot === s).flatMap((m) => [m.teamA, m.teamB]);
    assert.equal(new Set(playing).size, 6);
  }
});

test('18 équipes / 3 terrains : 3 poules de 6 + tableau final 8 avec exempts', () => {
  const t = E.buildSchedule(E.newTournament({ teams: teams(18), courts: [1, 2, 3].map((i) => ({ id: `c${i}`, name: `T${i}`, sport: 'volley', color: '#000' })), format: { type: 'pools', pools: 3, qualifiers: 2, finals: 'single', thirdPlace: true, consolation: true, pinPoolsToCourts: true } }));
  const pool = t.matches.filter((m) => m.phase === 'pool');
  assert.equal(pool.length, 45);
  const bracket = t.matches.filter((m) => m.phase === 'bracket' && m.bracketId === 'main');
  assert.ok(bracket.some((m) => m.status === 'bye'));
  // aucune équipe deux fois dans le même créneau
  const bySlot = {};
  for (const m of pool) for (const id of [m.teamA, m.teamB]) {
    const k = `${m.slot}|${id}`;
    assert.ok(!bySlot[k], 'conflit de créneau'); bySlot[k] = 1;
  }
  // max 3 matchs par créneau
  const counts = {};
  for (const m of t.matches) if (m.slot != null) counts[m.slot] = (counts[m.slot] || 0) + 1;
  assert.ok(Object.values(counts).every((c) => c <= 3));
});

test('classement FIVB et résolution des phases finales', () => {
  let t = E.newTournament({ teams: teams(4), format: { type: 'pools', pools: 1, qualifiers: 2, finals: 'single', thirdPlace: false }, scoring: { ...E.SCORING_PRESETS['volley-3x25'] } });
  t = E.buildSchedule(t);
  // l'équipe 1 gagne tout, 2 gagne contre 3 et 4, 3 bat 4
  const rank = Object.fromEntries(t.teams.map((x, i) => [x.id, i]));
  for (const m of t.matches.filter((m) => m.phase === 'pool')) {
    const aWins = rank[m.teamA] < rank[m.teamB];
    m.sets = aWins ? [[25, 20], [25, 20], [25, 20]] : [[20, 25], [20, 25], [20, 25]];
    m.status = 'done';
  }
  let { standings, resolved } = E.resolve(t);
  assert.deepEqual(standings.A.map((r) => r.team), t.teams.map((x) => x.id));
  assert.equal(standings.A[0].rankPts, 9);
  const final = t.matches.find((m) => m.phase === 'bracket');
  assert.equal(resolved[final.id].a, t.teams[0].id);
  assert.equal(resolved[final.id].b, t.teams[1].id);
  final.sets = [[25, 23], [23, 25], [25, 20], [20, 25], [15, 13]];
  final.status = 'done';
  ({ resolved } = E.resolve(t));
  assert.equal(resolved[final.id].winner, t.teams[0].id);
  assert.deepEqual(E.matchResult(final, E.scoringFor(t, final)), { setsA: 3, setsB: 2, ptsA: 108, ptsB: 106, winner: 'A' });
});

test('points FIVB : 3-2 = 2 pts / 1 pt', () => {
  const t = E.newTournament({ teams: teams(2), format: { type: 'roundrobin' }, scoring: { ...E.SCORING_PRESETS['volley-3x25'] } });
  const s = E.buildSchedule(t);
  s.matches[0].sets = [[25, 20], [20, 25], [25, 20], [20, 25], [15, 10]];
  s.matches[0].status = 'done';
  const st = E.resolve(s).standings.A;
  assert.deepEqual(st.map((r) => r.rankPts), [2, 1]);
});

test('double élimination 6 équipes : repêchage et grande finale', () => {
  let t = E.newTournament({ teams: teams(6), format: { type: 'double' } });
  t = E.buildSchedule(t);
  const ids = new Set(t.matches.map((m) => m.id));
  assert.ok(ids.has('main-GF'));
  assert.ok(t.matches.some((m) => m.side === 'L'));
  // Jouer tout en faisant gagner la meilleure tête de série
  const strength = Object.fromEntries(t.teams.map((x, i) => [x.id, i]));
  for (let guard = 0; guard < 50; guard++) {
    const { resolved } = E.resolve(t);
    const next = t.matches.find((m) => m.status === 'scheduled' && resolved[m.id].a && resolved[m.id].b && resolved[m.id].a !== E.BYE && resolved[m.id].b !== E.BYE);
    if (!next) break;
    const r = resolved[next.id];
    next.sets = strength[r.a] < strength[r.b] ? [[25, 10]] : [[10, 25]];
    next.status = 'done';
  }
  const { resolved } = E.resolve(t);
  assert.equal(resolved['main-GF'].winner, t.teams[0].id);
  assert.equal(resolved['main-GF'].loser, t.teams[1].id);
  const podium = E.finalPodium(t, resolved);
  assert.deepEqual(podium, [t.teams[0].id, t.teams[1].id, t.teams[2].id]);
});

test('set terminé : écart de 2 et tie-break', () => {
  const sc = E.SCORING_PRESETS['volley-2x21'];
  assert.equal(E.setFinished(sc, 0, 21, 19), true);
  assert.equal(E.setFinished(sc, 0, 21, 20), false);
  assert.equal(E.setFinished(sc, 2, 15, 13), true);
  assert.equal(E.setFinished(sc, 2, 14, 12), false);
});

test('match au temps : nul possible, vainqueur désigné en phase finale', () => {
  const sc = E.SCORING_PRESETS['time-12'];
  assert.equal(E.matchResult({ sets: [[2, 2]] }, sc).winner, 'D');
  assert.equal(E.matchResult({ sets: [[2, 2]], tieWinner: 'B' }, sc).winner, 'B');
});

test('Téléthon : 7 équipes, 3 sports, manches 1/2/3 sans jamais rejouer le même sport contre la même équipe', () => {
  for (const legs of [1, 2, 3]) {
    const base = buildDemo('multisport');
    base.format = { type: 'roundrobin', legs };
    const t = E.buildSchedule(base);
    const st = E.scheduleStats(t);
    assert.equal(st.matches, 21 * legs);
    assert.equal(st.slots, 7 * legs);
    const seen = new Set();
    for (const m of t.matches) {
      const k = [m.teamA, m.teamB].sort().join('|') + '@' + m.courtId;
      assert.ok(!seen.has(k), `paire rejouée sur le même terrain (manches=${legs})`);
      seen.add(k);
    }
    for (const byCourt of Object.values(st.courtPerTeam)) assert.deepEqual(t.courts.map((c) => byCourt[c.id]), [2 * legs, 2 * legs, 2 * legs]);
    for (let s = 0; s < st.slots; s++) {
      const playing = t.matches.filter((m) => m.slot === s).flatMap((m) => [m.teamA, m.teamB]);
      assert.equal(new Set(playing).size, 6);
    }
  }
});

test('championnat + demi-finales (top 4)', () => {
  const base = buildDemo('multisport');
  base.format = { type: 'roundrobin', legs: 1, finalsTop: 4, thirdPlace: true };
  const t = E.buildSchedule(base);
  const st = E.scheduleStats(t);
  assert.equal(st.matches, 21 + 4);
  assert.equal(st.slots, 7 + 2);
});

test('Fluo : 18 équipes, poules de 3 → poules de niveau → matchs de classement (places 1 à 18)', () => {
  let t = E.newTournament({ teams: teams(18), courts: [1, 2, 3].map((i) => ({ id: `c${i}`, name: `T${i}`, sport: 'volley', color: '#000' })), format: { type: 'levels', poolSize: 3 }, referees: 'teams' });
  t = E.buildSchedule(t);
  const st = E.scheduleStats(t);
  const p1 = t.matches.filter((m) => m.phase === 'pool'), p2 = t.matches.filter((m) => m.phase === 'pool2'), pl = t.matches.filter((m) => m.bracketId === 'place');
  assert.equal(p1.length, 18); assert.equal(p2.length, 18); assert.equal(pl.length, 9);
  assert.equal(st.slots, 6 + 6 + 3);
  // l'arbitre en phase 1 est la 3e équipe de la poule
  for (const m of p1) assert.ok(t.pools[m.pool].includes(m.referee) && m.referee !== m.teamA && m.referee !== m.teamB);
  // jouer tout : l'équipe la mieux classée gagne toujours
  const strength = Object.fromEntries(t.teams.map((x, i) => [x.id, i]));
  for (let guard = 0; guard < 60; guard++) {
    const { resolved } = E.resolve(t);
    const next = t.matches.filter((m) => m.status === 'scheduled').sort((a, b) => a.slot - b.slot).find((m) => resolved[m.id].a && resolved[m.id].b);
    if (!next) break;
    const r = resolved[next.id];
    next.sets = strength[r.a] < strength[r.b] ? [[21, 15]] : [[15, 21]];
    next.status = 'done';
  }
  const { places, resolved } = E.resolve(t);
  assert.equal(places.filter(Boolean).length, 18);
  assert.deepEqual(places, t.teams.map((x) => x.id));
  // en phase 2, l'arbitre est le 3e membre de la poule de niveau
  for (const m of p2) assert.ok(resolved[m.id].referee && ![resolved[m.id].a, resolved[m.id].b].includes(resolved[m.id].referee));
});

test('Fluo : 15 équipes (5 poules) → la dernière poule de niveau donne directement ses places', () => {
  let t = E.newTournament({ teams: teams(15), courts: [1, 2, 3].map((i) => ({ id: `c${i}`, name: `T${i}`, sport: 'volley', color: '#000' })), format: { type: 'levels', poolSize: 3 } });
  t = E.buildSchedule(t);
  // 6+6 en poules jumelles, les 3 derniers en poule unique : places 13 à 15 directes
  assert.deepEqual(Object.values(t.pools2).map((p) => p.length), [3, 3, 3, 3, 3]);
  assert.deepEqual(t.directPlaces, { pool: 'N5', from: 13 });
});

test('équipe en retard : son prochain match est échangé avec un match plus tardif, sans conflit', () => {
  const base = buildDemo('multisport');
  base.format = { type: 'roundrobin', legs: 1 };
  const t = E.buildSchedule(base);
  const late = t.teams.find((x) => { const sl = t.matches.filter((m) => m.teamA === x.id || m.teamB === x.id).map((m) => m.slot); return !sl.includes(0) === false && [1,2,3,4,5,6].some((k) => !sl.includes(k)); }).id;
  const before = t.matches.filter((m) => m.teamA === late || m.teamB === late).map((m) => m.slot).sort((a, b) => a - b)[0];
  const r = E.postponeTeam(t, late);
  assert.ok(!r.error, r.error);
  const after = t.matches.filter((m) => m.teamA === late || m.teamB === late).map((m) => m.slot).sort((a, b) => a - b)[0];
  assert.ok(after > before);
  for (let s = 0; s < 7; s++) {
    const ids = t.matches.filter((m) => m.slot === s).flatMap((m) => [m.teamA, m.teamB]);
    assert.equal(new Set(ids).size, ids.length, `conflit au créneau ${s}`);
    const courts = t.matches.filter((m) => m.slot === s).map((m) => m.courtId);
    assert.equal(new Set(courts).size, courts.length);
  }
});

test('équipe en retard sans repos plus tard : son match part en fin de phase', () => {
  const base = buildDemo('multisport');
  base.format = { type: 'roundrobin', legs: 1 };
  const t = E.buildSchedule(base);
  const late = t.teams[0].id; // au repos à la 1re rotation, puis joue tout le temps
  const r = E.postponeTeam(t, late);
  assert.ok(!r.error && r.to > r.from);
  const slots = {};
  for (const m of t.matches) for (const x of [m.teamA, m.teamB]) { const k = m.slot + x; assert.ok(!slots[k]); slots[k] = 1; }
});

import * as C from '../public/js/club.js';
test('tournoi interne : 26 joueurs de niveaux 1 à 4 → équipes équilibrées, formule qui tient dans l’horaire', () => {
  const lv = [4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 4, 3, 2, 1];
  const players = lv.map((l, i) => C.newPlayer(`J${i}`, { level: l, gender: i % 3 ? 'H' : 'F', present: true }));
  const opts = C.teamOptions(players.length, 3, 4, 6);
  assert.equal(opts[0].teams, 6); // 6 équipes sur 3 terrains : tout le monde joue
  const split = C.balanceTeams(players, 6);
  assert.equal(split.flatMap((s) => s.members).length, 26);
  const totals = split.map((s) => s.total);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 2, totals.join(','));
  const women = split.map((s) => s.members.filter((p) => p.gender === 'F').length);
  assert.ok(Math.max(...women) - Math.min(...women) <= 1);
  const t = E.newTournament({ startTime: '19:30', endTime: '22:00', slotMinutes: 15, courts: [1, 2, 3].map((i) => ({ id: `c${i}`, name: `T${i}`, sport: 'volley', color: '#000' })) });
  C.applyTeams(t, split);
  const sug = C.suggestFormats(t);
  assert.ok(sug[0].fits);
  assert.ok(sug.every((s, i) => i === 0 || !s.fits || s.minPerTeam <= sug[0].minPerTeam));
});

test('rotation lancée par l’organisation : tous les matchs démarrent ensemble, pause et reprise', () => {
  const t = E.buildSchedule(buildDemo('multisport'));
  const slot = E.currentSlot(t);
  assert.equal(slot, 0);
  const started = E.startRotation(t, slot, 1000);
  assert.equal(started.length, 3);
  for (const m of t.matches.filter((x) => x.slot === 0)) { assert.equal(m.status, 'live'); assert.deepEqual(m.timer, { running: true, elapsed: 0, since: 1000 }); }
  E.toggleRotation(t, 0, 61000, false);
  assert.ok(t.matches.filter((x) => x.slot === 0).every((m) => !m.timer.running && m.timer.elapsed === 60000));
  E.toggleRotation(t, 0, 90000, true);
  assert.ok(t.matches.filter((x) => x.slot === 0).every((m) => m.timer.running && m.timer.since === 90000));
});

import * as M from '../public/js/money.js';
test('buvette : carte 10 € = 12 points, paiement en points, solde insuffisant refusé, recette comptée une seule fois', () => {
  const t = buildDemo('multisport');
  t.sales = [];
  const card = M.issueCard(t, { price: 10, points: 12, method: 'cash', name: 'Camille' });
  assert.match(card.code, /^\d{4}$/);
  assert.equal(card.balance, 12);
  // jambon-beurre 3,50 € = 4 pts ; café 1 € = 1 pt
  const r = M.cardSale(t, { code: card.code, items: [{ pid: 'jb', qty: 2 }, { pid: 'cafe', qty: 1 }] });
  assert.equal(r.pts, 9);
  assert.equal(M.findCard(t, card.code).balance, 3);
  assert.throws(() => M.cardSale(t, { code: card.code, items: [{ pid: 'jb', qty: 1 }] }), /Solde insuffisant/);
  // rejouer la même vente (file hors ligne) ne débite pas deux fois
  M.cardSale(t, { code: card.code, items: [{ pid: 'cafe', qty: 1 }], sid: 'x1' });
  M.cardSale(t, { code: card.code, items: [{ pid: 'cafe', qty: 1 }], sid: 'x1' });
  assert.equal(M.findCard(t, card.code).balance, 2);
  const st = M.buvetteStats(t);
  assert.equal(st.revenue, 10); // seulement l'achat de la carte
  assert.equal(st.top.find((p) => p.pid === 'jb').qty, 2); // le stock et les recettes suivent quand même
  const cs = M.cardsSummary(t);
  assert.deepEqual([cs.issued, cs.used, cs.left], [12, 10, 2]);
  // recharge d'une carte vierge pré-imprimée
  const [blank] = M.blankCards(t, 1);
  M.issueCard(t, { code: blank.code, price: 5, points: 6, method: 'card' });
  assert.equal(M.findCard(t, blank.code).balance, 6);
});

test('carte buvette en option à l’inscription : ajoutée au montant dû, créditée au paiement, comptée à la buvette', () => {
  const t = buildDemo('multisport');
  t.sales = []; t.cards = [];
  const team = t.teams.find((x) => x.barOption);
  const other = t.teams.find((x) => !x.barOption);
  // 5 joueurs × 5 € + carte 10 €
  assert.equal(M.teamFee(t, team), 25);
  assert.equal(M.teamDue(t, team), 35);
  assert.equal(M.teamDue(t, other), 25);
  assert.equal(M.issueTeamCard(t, other), null); // pas d'option, pas de carte
  const c = M.issueTeamCard(t, team, 'cash');
  assert.equal(c.balance, 12);
  assert.equal(team.barCard, c.code);
  assert.equal(M.issueTeamCard(t, team), null); // une seule fois
  team.payment = 'onsite';
  assert.equal(M.feesSummary(t).paid, 25); // l'option n'est pas comptée dans les inscriptions…
  assert.equal(M.buvetteStats(t).revenue, 10); // … mais à la buvette
  t.registration.barCard.per = 'player';
  team.barCard = null;
  assert.equal(M.barOption(t, team).points, 60); // 5 joueurs × 12 points
});

test('archivage : inscriptions fermées puis rétablies au désarchivage', () => {
  const t = buildDemo('multisport');
  assert.equal(t.registration.open, true);
  E.setArchived(t, true);
  assert.equal(t.archived, true); assert.equal(t.registration.open, false); assert.ok(t.archivedAt);
  E.setArchived(t, false);
  assert.equal(t.archived, false); assert.equal(t.registration.open, true); assert.equal(t.archivedAt, undefined);
});
