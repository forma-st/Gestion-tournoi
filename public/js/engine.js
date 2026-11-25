// Moteur de tournoi : génération des poules, planning, classements, tableaux finaux.
// Module pur (aucune dépendance DOM) — partagé entre navigateur et tests Node.

export const uid = (n = 8) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(n));
    for (const x of b) s += a[x % a.length];
  } else for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};

export const BYE = '__BYE__';
export const POOL_LETTERS = 'ABCDEFGHIJKLMNOP';

// ---------------------------------------------------------------- Règles de score

export const SCORING_PRESETS = {
  'volley-1x25': { label: 'Volley : 1 set de 25', mode: 'points', setsToWin: 1, pointsPerSet: 25, tiebreakPoints: 15, winBy2: true, cap: 0, ranking: 'win3' },
  'volley-2x21': { label: 'Volley : 2 sets gagnants de 21 (tie-break 15)', mode: 'points', setsToWin: 2, pointsPerSet: 21, tiebreakPoints: 15, winBy2: true, cap: 0, ranking: 'beach' },
  'volley-2x25': { label: 'Volley : 2 sets gagnants de 25 (tie-break 15)', mode: 'points', setsToWin: 2, pointsPerSet: 25, tiebreakPoints: 15, winBy2: true, cap: 0, ranking: 'fivb' },
  'volley-3x25': { label: 'Volley FIVB : 3 sets gagnants de 25', mode: 'points', setsToWin: 3, pointsPerSet: 25, tiebreakPoints: 15, winBy2: true, cap: 0, ranking: 'fivb' },
  'time-12': { label: 'Au temps : 12 minutes', mode: 'time', durationMin: 12, allowDraw: true, ranking: 'win3' },
  'time-8': { label: 'Au temps : 8 minutes', mode: 'time', durationMin: 8, allowDraw: true, ranking: 'participation' },
  'time-10-21': { label: 'Set unique de 21 points ou 10 minutes', mode: 'points', setsToWin: 1, pointsPerSet: 21, tiebreakPoints: 15, winBy2: false, cap: 0, ranking: 'win3', durationMin: 10 },
  'time-15': { label: 'Au temps : 15 minutes', mode: 'time', durationMin: 15, allowDraw: true, ranking: 'win3' },
};

export const RANKING_RULES = {
  win3: { label: 'Victoire 3 · nul 1 · défaite 0', win: 3, draw: 1, loss: 0, forfeit: 0 },
  win2: { label: 'Victoire 2 · nul 1 · défaite 0', win: 2, draw: 1, loss: 0, forfeit: 0 },
  fivb: { label: 'FIVB : 3-0/3-1 = 3 · 3-2 = 2 · 2-3 = 1', fivb: true, forfeit: 0 },
  participation: { label: 'Victoire 3 · nul 2 · défaite 1 (point de participation)', win: 3, draw: 2, loss: 1, forfeit: 0 },
  beach: { label: 'Beach FIVB : victoire 2 · défaite 1 · forfait 0', win: 2, draw: 1, loss: 1, forfeit: 0 },
};

export const SPORTS = {
  volley: { label: 'Volley-ball', icon: '🏐' },
  beach: { label: 'Beach-volley', icon: '🏖️' },
  foot: { label: 'Football', icon: '⚽' },
  hand: { label: 'Handball', icon: '🤾' },
  basket: { label: 'Basket', icon: '🏀' },
  badminton: { label: 'Badminton', icon: '🏸' },
  tennistable: { label: 'Tennis de table', icon: '🏓' },
  ultimate: { label: 'Ultimate', icon: '🥏' },
  dodgeball: { label: 'Dodgeball', icon: '🔴' },
  petanque: { label: 'Pétanque', icon: '🎯' },
  autre: { label: 'Autre', icon: '🏅' },
};

export const COURT_COLORS = ['#F5B700', '#00A6D6', '#F2545B', '#3BB273', '#8E6CEF', '#FF8C42'];

/** Règles de score effectives d'un match : celles du terrain si surchargées, sinon celles du tournoi. */
export function scoringFor(t, match) {
  const court = t.courts.find((c) => c.id === match?.courtId);
  const base = { ...t.scoring };
  if (court?.scoring) Object.assign(base, court.scoring);
  if (match?.phase === 'bracket' && t.finalsScoring) Object.assign(base, t.finalsScoring);
  return base;
}

/** Points nécessaires pour gagner le set n (0-based). */
export function setTarget(sc, setIndex) {
  const deciding = sc.setsToWin > 1 && setIndex === sc.setsToWin * 2 - 2;
  return deciding ? sc.tiebreakPoints || 15 : sc.pointsPerSet || 25;
}

/** Un set est-il terminé selon les règles ? */
export function setFinished(sc, setIndex, a, b) {
  if (sc.mode === 'time') return false;
  const target = setTarget(sc, setIndex);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (sc.cap && hi >= sc.cap) return true;
  if (hi < target) return false;
  return sc.winBy2 === false ? true : hi - lo >= 2;
}

/** Calcule le résultat d'un match à partir de ses sets. */
export function matchResult(m, sc) {
  const sets = (m.sets || []).filter((s) => s && (s[0] !== '' && s[1] !== ''));
  let setsA = 0, setsB = 0, ptsA = 0, ptsB = 0;
  for (const [x, y] of sets) {
    const a = +x || 0, b = +y || 0;
    ptsA += a; ptsB += b;
    if (sc.mode === 'time') continue;
    if (a > b) setsA++; else if (b > a) setsB++;
  }
  let winner = null; // 'A' | 'B' | 'D' (nul)
  if (m.forfeit === 'A') winner = 'B';
  else if (m.forfeit === 'B') winner = 'A';
  else if (sc.mode === 'time') {
    if (ptsA > ptsB) winner = 'A';
    else if (ptsB > ptsA) winner = 'B';
    else winner = m.tieWinner || 'D';
  } else {
    if (setsA > setsB) winner = 'A';
    else if (setsB > setsA) winner = 'B';
    else winner = m.tieWinner || 'D';
  }
  if (sc.mode === 'time') { setsA = winner === 'A' ? 1 : 0; setsB = winner === 'B' ? 1 : 0; }
  return { setsA, setsB, ptsA, ptsB, winner };
}

function rankingPoints(rule, res, side) {
  const r = RANKING_RULES[rule] || RANKING_RULES.win3;
  const mine = side === 'A' ? res.setsA : res.setsB;
  const theirs = side === 'A' ? res.setsB : res.setsA;
  if (res.winner === 'D') return r.draw ?? 1;
  const won = res.winner === side;
  if (r.fivb) {
    // Victoire au set décisif (3-2 ou 2-1) : 2 pts / 1 pt ; sinon 3 / 0
    const decisive = Math.abs(mine - theirs) === 1 && Math.max(mine, theirs) >= 2;
    if (won) return decisive ? 2 : 3;
    return decisive ? 1 : 0;
  }
  return won ? r.win : r.loss;
}

// ---------------------------------------------------------------- Round-robin

/** Méthode du cercle (Berger) : renvoie des rondes de paires [a,b] ; null = exempt. */
export function roundRobin(ids) {
  const list = [...ids];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  let arr = list;
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 && i === 0 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return rounds;
}

/** Répartition en serpentin (têtes de série réparties). */
export function snakePools(teamIds, nPools) {
  const pools = Array.from({ length: nPools }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / nPools), col = i % nPools;
    pools[row % 2 ? nPools - 1 - col : col].push(id);
  });
  return pools;
}

// ---------------------------------------------------------------- Tableaux à élimination

/** Ordre standard des têtes de série dans un tableau de taille n (puissance de 2). */
export function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order;
}

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * Construit un tableau à élimination directe.
 * seeds : tableau de sources (ex. {type:'team', id} ou {type:'pool', pool:'A', rank:1}).
 * Renvoie une liste de matchs avec sources {type:'seed', i} / {type:'winner'|'loser', ref}.
 */
export function buildSingleElim(seeds, { prefix = 'W', name = 'Tableau principal', thirdPlace = false, bracketId = 'main' } = {}) {
  const size = nextPow2(Math.max(2, seeds.length));
  const order = seedOrder(size);
  const matches = [];
  const rounds = Math.log2(size);
  let prev = [];
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1), cur = [];
    for (let i = 0; i < count; i++) {
      const id = `${bracketId}-${prefix}${r + 1}-${i + 1}`;
      const m = { id, phase: 'bracket', bracketId, bracketName: name, side: prefix, round: r + 1, index: i, label: roundLabel(rounds - r, prefix) };
      if (r === 0) {
        const sa = order[i * 2], sb = order[i * 2 + 1];
        m.srcA = sa <= seeds.length ? seeds[sa - 1] : { type: 'bye' };
        m.srcB = sb <= seeds.length ? seeds[sb - 1] : { type: 'bye' };
        m.seedA = sa; m.seedB = sb;
      } else {
        m.srcA = { type: 'winner', ref: prev[i * 2].id };
        m.srcB = { type: 'winner', ref: prev[i * 2 + 1].id };
      }
      cur.push(m); matches.push(m);
    }
    prev = cur;
  }
  if (thirdPlace && rounds >= 2) {
    const semis = matches.filter((m) => m.round === rounds - 1);
    matches.push({ id: `${bracketId}-${prefix}3P`, phase: 'bracket', bracketId, bracketName: name, side: prefix, round: rounds, index: 1, label: 'Petite finale', srcA: { type: 'loser', ref: semis[0].id }, srcB: { type: 'loser', ref: semis[1].id } });
  }
  return matches;
}

function roundLabel(remaining, prefix) {
  const base = { 1: 'Finale', 2: 'Demi-finale', 3: 'Quart de finale', 4: '8e de finale', 5: '16e de finale' }[remaining] || `Tour ${remaining}`;
  return prefix === 'W' ? base : base;
}

/**
 * Double élimination avec repêchage (tableau des perdants) + grande finale.
 * Les perdants du tableau principal tombent dans le tableau de repêchage.
 */
export function buildDoubleElim(seeds, { bracketId = 'de', name = 'Double élimination', grandFinalReset = false } = {}) {
  const size = nextPow2(Math.max(4, seeds.length));
  const k = Math.log2(size);
  const W = buildSingleElim(seeds, { prefix: 'W', name, bracketId });
  W.forEach((m) => { m.label = m.round === k ? 'Finale des gagnants' : `Gagnants · tour ${m.round}`; });
  const wr = (r) => W.filter((m) => m.round === r);
  const L = [];
  let prev = null, lRound = 0;
  // LR1 : perdants WR1 deux à deux
  {
    lRound++;
    const src = wr(1), cur = [];
    for (let i = 0; i < src.length / 2; i++) {
      cur.push({ id: `${bracketId}-L${lRound}-${i + 1}`, phase: 'bracket', bracketId, bracketName: name, side: 'L', round: lRound, index: i, label: `Repêchage · tour ${lRound}`, srcA: { type: 'loser', ref: src[2 * i].id }, srcB: { type: 'loser', ref: src[2 * i + 1].id } });
    }
    L.push(...cur); prev = cur;
  }
  for (let r = 2; r <= k; r++) {
    // ronde « mineure » : vainqueurs repêchage vs perdants du tour r (ordre inversé pour éviter les revanches)
    lRound++;
    const drop = wr(r).slice().reverse(), cur = [];
    for (let i = 0; i < prev.length; i++) {
      cur.push({ id: `${bracketId}-L${lRound}-${i + 1}`, phase: 'bracket', bracketId, bracketName: name, side: 'L', round: lRound, index: i, label: `Repêchage · tour ${lRound}`, srcA: { type: 'winner', ref: prev[i].id }, srcB: { type: 'loser', ref: drop[i].id } });
    }
    L.push(...cur); prev = cur;
    if (prev.length > 1) {
      lRound++;
      const nxt = [];
      for (let i = 0; i < prev.length / 2; i++) {
        nxt.push({ id: `${bracketId}-L${lRound}-${i + 1}`, phase: 'bracket', bracketId, bracketName: name, side: 'L', round: lRound, index: i, label: `Repêchage · tour ${lRound}`, srcA: { type: 'winner', ref: prev[2 * i].id }, srcB: { type: 'winner', ref: prev[2 * i + 1].id } });
      }
      L.push(...nxt); prev = nxt;
    }
  }
  L[L.length - 1].label = 'Finale du repêchage';
  const wFinal = wr(k)[0];
  const gf = { id: `${bracketId}-GF`, phase: 'bracket', bracketId, bracketName: name, side: 'GF', round: 1, index: 0, label: 'Grande finale', srcA: { type: 'winner', ref: wFinal.id }, srcB: { type: 'winner', ref: prev[0].id } };
  const out = [...W, ...L, gf];
  if (grandFinalReset) out.push({ id: `${bracketId}-GF2`, phase: 'bracket', bracketId, bracketName: name, side: 'GF', round: 2, index: 0, label: 'Grande finale (revanche)', resetOf: gf.id, srcA: { type: 'winner', ref: gf.id }, srcB: { type: 'loser', ref: gf.id } });
  return out;
}

// ---------------------------------------------------------------- Génération complète

/**
 * Génère toutes les rencontres d'un tournoi selon son format.
 * format.type : 'roundrobin' | 'pools' (poules + phases finales) | 'single' | 'double'
 */
export function generateMatches(t) {
  const f = t.format;
  const teams = t.teams.filter((x) => x.status === 'confirmed').sort((a, b) => (a.level || 9) - (b.level || 9) || (a.seed ?? 999) - (b.seed ?? 999));
  const ids = teams.map((x) => x.id);
  let matches = [];
  const pools = {};
  const extra = {};
  if (f.type === 'roundrobin') {
    pools.A = ids;
    const legs = Math.max(1, Math.min(t.courts.length || 1, f.legs || 1));
    const rr = roundRobin(ids);
    for (let L = 1; L <= legs; L++) {
      rr.forEach((pairs, r) => pairs.forEach(([a, b], i) => matches.push({
        id: legs > 1 ? `L${L}-A-${r + 1}-${i + 1}` : `A-${r + 1}-${i + 1}`, phase: 'pool', pool: 'A', leg: L,
        round: r + 1 + (L - 1) * rr.length, teamA: L % 2 ? a : b, teamB: L % 2 ? b : a,
      })));
    }
    // Phase finale optionnelle après le championnat
    if (f.finalsTop >= 2) {
      const seeds = Array.from({ length: Math.min(f.finalsTop, ids.length) }, (_, i) => ({ type: 'pool', pool: 'A', rank: i + 1 }));
      matches.push(...buildSingleElim(seeds, { bracketId: 'main', name: 'Phase finale', thirdPlace: !!f.thirdPlace }));
    }
  } else if (f.type === 'pools') {
    const n = Math.max(1, Math.min(f.pools || 2, Math.floor(ids.length / 2)));
    snakePools(ids, n).forEach((p, i) => { pools[POOL_LETTERS[i]] = p; });
    for (const [L, p] of Object.entries(pools)) {
      roundRobin(p).forEach((pairs, r) => pairs.forEach(([a, b], i) => matches.push({ id: `${L}-${r + 1}-${i + 1}`, phase: 'pool', pool: L, round: r + 1, teamA: a, teamB: b })));
    }
    const letters = Object.keys(pools);
    const q = Math.max(1, f.qualifiers || 2);
    const seeds = [];
    for (let rank = 1; rank <= q; rank++) {
      const row = letters.map((L) => ({ type: 'pool', pool: L, rank }));
      seeds.push(...(rank % 2 ? row : row.reverse()));
    }
    const valid = seeds.filter((s) => (pools[s.pool]?.length || 0) >= s.rank);
    if (valid.length >= 2) {
      matches.push(...(f.finals === 'double'
        ? buildDoubleElim(valid, { bracketId: 'main', name: 'Phase finale', grandFinalReset: !!f.grandFinalReset })
        : buildSingleElim(valid, { bracketId: 'main', name: 'Phase finale', thirdPlace: !!f.thirdPlace })));
    }
    if (f.consolation) {
      const cons = [];
      const maxSize = Math.max(...Object.values(pools).map((p) => p.length));
      for (let rank = q + 1; rank <= maxSize; rank++) {
        const row = letters.filter((L) => pools[L].length >= rank).map((L) => ({ type: 'pool', pool: L, rank }));
        cons.push(...(rank % 2 ? row : row.reverse()));
      }
      if (cons.length >= 2) matches.push(...buildSingleElim(cons, { bracketId: 'cons', prefix: 'C', name: 'Consolante', thirdPlace: false }));
    }
  } else if (f.type === 'levels') {
    // Phase 1 : brassage en petites poules ; phase 2 : poules de niveau ; phase 3 : matchs de classement
    const size = Math.max(3, f.poolSize || 3);
    const nP = Math.max(1, Math.ceil(ids.length / size));
    snakePools(ids, nP).forEach((p, i) => { pools[POOL_LETTERS[i]] = p; });
    for (const [L, p] of Object.entries(pools)) {
      roundRobin(p).forEach((pairs, r) => pairs.forEach(([a, b], i) => matches.push({ id: `${L}-${r + 1}-${i + 1}`, phase: 'pool', pool: L, round: r + 1, teamA: a, teamB: b })));
    }
    const lens = Object.values(pools).map((p) => p.length);
    const order = [];
    for (let rank = 1; rank <= Math.max(...lens); rank++) {
      const n = lens.filter((l) => l >= rank).length;
      for (let k = 1; k <= n; k++) order.push({ type: 'cross', rank, nth: k });
    }
    // Niveaux : les 2×taille équipes suivantes sont réparties en serpentin dans 2 poules jumelles
    const pools2 = {};
    let k = 1;
    for (let i = 0; i < order.length; i += 2 * size) {
      const chunk = order.slice(i, i + 2 * size);
      if (chunk.length <= size + 1) { pools2[`N${k++}`] = chunk; continue; }
      snakePools(chunk, 2).forEach((p) => { pools2[`N${k++}`] = p; });
    }
    extra.pools2 = pools2;
    for (const [P, mem] of Object.entries(pools2)) {
      const idx = mem.map((_, i) => i);
      roundRobin(idx).forEach((pairs, r) => pairs.forEach(([a, b], i) => matches.push({
        id: `${P}-${r + 1}-${i + 1}`, phase: 'pool2', pool: P, round: r + 1, memA: a, memB: b,
        refMem: mem.length === 3 ? idx.find((x) => x !== a && x !== b) : undefined,
      })));
    }
    if (f.placement !== false) {
      const ks = Object.keys(pools2);
      let base = 1;
      for (let i = 0; i < ks.length; i += 2) {
        const P1 = ks[i], P2 = ks[i + 1];
        if (!P2) { extra.directPlaces = { pool: P1, from: base }; break; }
        const n = Math.min(pools2[P1].length, pools2[P2].length);
        for (let r = 1; r <= n; r++) {
          const place = base + 2 * (r - 1);
          matches.push({ id: `place-${place}`, phase: 'bracket', bracketId: 'place', bracketName: 'Matchs de classement', side: 'P', round: 1, index: place, place,
            label: place === 1 ? 'Finale' : place === 3 ? 'Match pour la 3e place' : `Places ${place}-${place + 1}`,
            srcA: { type: 'pool2', pool: P1, rank: r }, srcB: { type: 'pool2', pool: P2, rank: r } });
        }
        base += pools2[P1].length + pools2[P2].length;
      }
    }
  } else if (f.type === 'double') {
    matches = buildDoubleElim(ids.map((id) => ({ type: 'team', id })), { bracketId: 'main', name: 'Double élimination', grandFinalReset: !!f.grandFinalReset });
  } else {
    matches = buildSingleElim(ids.map((id) => ({ type: 'team', id })), { bracketId: 'main', name: 'Élimination directe', thirdPlace: !!f.thirdPlace });
  }
  // Matchs « exempts » connus d'avance : on les marque pour ne pas les planifier.
  markStaticByes(matches);
  for (const m of matches) {
    m.token = uid(10);
    m.sets = [];
    m.status = m.bye ? 'bye' : 'scheduled';
  }
  return { matches, pools, ...extra };
}

function markStaticByes(matches) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const state = {}; // id -> {w: 'T'|'B', l: 'T'|'B'}
  const side = (src) => {
    if (!src) return 'T';
    if (src.type === 'bye') return 'B';
    if (src.type === 'winner' || src.type === 'loser') {
      const s = evalM(byId[src.ref]);
      return src.type === 'winner' ? s.w : s.l;
    }
    return 'T';
  };
  function evalM(m) {
    if (state[m.id]) return state[m.id];
    const a = side(m.srcA), b = side(m.srcB);
    let r;
    if (a === 'B' && b === 'B') r = { w: 'B', l: 'B' };
    else if (a === 'B' || b === 'B') r = { w: 'T', l: 'B' };
    else r = { w: 'T', l: 'T' };
    r.bye = a === 'B' || b === 'B';
    state[m.id] = r;
    return r;
  }
  for (const m of matches) if (m.phase === 'bracket') { const s = evalM(m); if (s.bye) m.bye = true; }
}

// ---------------------------------------------------------------- Planification (terrains & créneaux)

/**
 * Affecte créneaux et terrains.
 * - poules : un créneau = au plus un match par équipe, max = nombre de terrains
 * - équilibrage des sports : chaque équipe tourne sur les terrains (multisport)
 * - phases finales : après les poules, dans l'ordre des dépendances
 */
export function schedule(t, matches) {
  const courts = t.courts.filter((c) => c.active !== false);
  const nC = courts.length || 1;
  const pool = matches.filter((m) => m.phase === 'pool');
  const pool2 = matches.filter((m) => m.phase === 'pool2');
  const tA = (m) => (m.phase === 'pool2' ? `${m.pool}#${m.memA}` : m.teamA);
  const tB = (m) => (m.phase === 'pool2' ? `${m.pool}#${m.memB}` : m.teamB);
  const bracket = matches.filter((m) => m.phase === 'bracket' && !m.bye);
  const usage = {}; // team -> court -> count
  const lastSlot = {};
  const bump = (team, courtId) => { usage[team] ??= {}; usage[team][courtId] = (usage[team][courtId] || 0) + 1; };
  const use = (team, courtId) => usage[team]?.[courtId] || 0;
  let slot = 0;

  // Ordre des matchs de poule : par ronde, en intercalant les poules.
  const queueOf = (list) => {
    const byRound = {};
    for (const m of list) if ((m.leg || 1) === 1) (byRound[m.round] ??= []).push(m);
    return Object.keys(byRound).sort((a, b) => a - b).flatMap((r) => byRound[r].sort((a, b) => a.pool.localeCompare(b.pool, 'fr', { numeric: true })));
  };
  const queue = [...queueOf(pool), ...queueOf(pool2)];
  const poolLetters = [...new Set(pool.map((m) => m.pool))].sort();
  const pinPools = t.format.pinPoolsToCourts && poolLetters.length === nC;

  while (queue.length) {
    const busy = new Set(), chosen = [];
    const phase = queue[0].phase; // on ne mélange pas les phases dans une rotation
    for (let i = 0; i < queue.length && chosen.length < nC; i++) {
      const m = queue[i];
      if (m.phase !== phase) break;
      if (busy.has(tA(m)) || busy.has(tB(m))) continue;
      if (pinPools && chosen.some((c) => c.pool === m.pool)) continue;
      chosen.push(m); busy.add(tA(m)); busy.add(tB(m));
      queue.splice(i, 1); i--;
    }
    if (!chosen.length) { chosen.push(queue.shift()); }
    // Affectation des terrains : meilleure permutation (équilibre sports/terrains)
    const assign = pinPools
      ? chosen.map((m) => courts[poolLetters.indexOf(m.pool)])
      : bestAssignment(chosen.map((m) => ({ teamA: tA(m), teamB: tB(m) })), courts, use);
    chosen.forEach((m, i) => {
      m.slot = slot; m.courtId = assign[i].id;
      bump(tA(m), m.courtId); bump(tB(m), m.courtId);
    });
    slot++;
  }

  if (!pinPools) balanceCourts(pool.filter((m) => !m.leg || m.leg === 1), courts);
  // Matchs aller-retour (multisport) : chaque manche reprend la 1re en décalant les terrains,
  // donc une même paire ne rejoue jamais le même sport.
  const legs = Math.max(...pool.map((m) => m.leg || 1));
  if (legs > 1) {
    const first = pool.filter((m) => (m.leg || 1) === 1);
    const perLeg = Math.max(...first.map((m) => m.slot)) + 1;
    const twin = Object.fromEntries(first.map((m) => [m.id.replace(/^L1-/, ''), m]));
    for (const m of pool.filter((x) => x.leg > 1)) {
      const o = twin[m.id.replace(/^L\d+-/, '')];
      m.slot = o.slot + perLeg * (m.leg - 1);
      m.courtId = courts[(courts.findIndex((c) => c.id === o.courtId) + m.leg - 1) % nC].id;
    }
    slot = perLeg * legs;
  }

  // Phases finales : niveau de dépendance
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const depth = {};
  const dep = (m) => {
    if (depth[m.id] != null) return depth[m.id];
    let d = 0;
    for (const s of [m.srcA, m.srcB]) if (s && (s.type === 'winner' || s.type === 'loser')) d = Math.max(d, dep(byId[s.ref]) + (byId[s.ref].bye ? 0 : 1));
    return (depth[m.id] = d);
  };
  const levels = {};
  for (const m of bracket) (levels[dep(m)] ??= []).push(m);
  // Les finales en dernier, sur le terrain principal
  let courtIdx = 0;
  for (const d of Object.keys(levels).sort((a, b) => a - b)) {
    // Matchs de classement : des dernières places vers la finale (jouée en dernier, terrain 1)
    const list = levels[d].sort((a, b) => (a.place && b.place ? b.place - a.place : 0) || (a.bracketId === 'main' ? 0 : 1) - (b.bracketId === 'main' ? 0 : 1) || a.id.localeCompare(b.id));
    if (list.every((m) => m.place)) {
      const per = nC, n = list.length, first = n % per || per;
      list.forEach((m, i) => {
        const row = i < first ? 0 : 1 + Math.floor((i - first) / per);
        const col = i < first ? per - first + i : (i - first) % per;
        m.slot = slot + row; m.courtId = courts[per - 1 - col].id;
      });
      slot += Math.ceil(n / per);
      continue;
    }
    courtIdx = 0;
    for (const m of list) {
      if (courtIdx >= nC) { slot++; courtIdx = 0; }
      m.slot = slot; m.courtId = courts[courtIdx++].id;
    }
    slot++;
  }
  if (t.referees === 'teams') assignReferees(t, matches);
  return matches;
}

/**
 * Arbitrage par les équipes au repos : pour chaque match, une équipe libre sur ce créneau
 * (de la même poule si possible), en équilibrant le nombre d'arbitrages.
 */
export function assignReferees(t, matches, onlySlots = null) {
  const confirmed = t.teams.filter((x) => x.status === 'confirmed').map((x) => x.id);
  const poolOf = {};
  for (const m of matches) if (m.phase === 'pool') { poolOf[m.teamA] = m.pool; poolOf[m.teamB] = m.pool; }
  const count = Object.fromEntries(confirmed.map((id) => [id, 0]));
  const bySlot = {};
  for (const m of matches) if (m.phase === 'pool' && m.slot != null) (bySlot[m.slot] ??= []).push(m);
  const playingAt = (s) => new Set((bySlot[s] || []).flatMap((m) => [m.teamA, m.teamB]));
  for (const s of Object.keys(bySlot).map(Number).sort((a, b) => a - b)) {
    if (onlySlots && !onlySlots.includes(s)) { for (const m of bySlot[s]) if (m.referee) count[m.referee] = (count[m.referee] || 0) + 1; continue; }
    const busy = playingAt(s);
    const used = new Set();
    for (const m of bySlot[s]) {
      const cands = confirmed.filter((id) => !busy.has(id) && !used.has(id));
      if (!cands.length) { m.referee = null; continue; }
      const nextBusy = playingAt(s + 1);
      cands.sort((a, b) =>
        (poolOf[a] === m.pool ? 0 : 1) - (poolOf[b] === m.pool ? 0 : 1) ||
        count[a] - count[b] ||
        (nextBusy.has(a) ? 1 : 0) - (nextBusy.has(b) ? 1 : 0));
      m.referee = cands[0]; used.add(cands[0]); count[cands[0]]++;
    }
  }
}

/**
 * Rééquilibrage global (multisport) : recherche par retour arrière d'une affectation
 * des terrains telle que chaque équipe passe au plus ceil(matchs/terrains) fois sur chaque terrain.
 */
function balanceCourts(pool, courts) {
  const nC = courts.length;
  if (nC < 2 || nC > 4) return;
  const slots = {};
  for (const m of pool) (slots[m.slot] ??= []).push(m);
  const list = Object.keys(slots).sort((a, b) => a - b).map((k) => slots[k]);
  const games = {};
  for (const m of pool) for (const x of [m.teamA, m.teamB]) games[x] = (games[x] || 0) + 1;
  const cap = Object.fromEntries(Object.entries(games).map(([k, g]) => [k, Math.ceil(g / nC)]));
  const cnt = {};
  const get = (x, c) => cnt[x]?.[c] || 0;
  const add = (x, c, d) => { cnt[x] ??= {}; cnt[x][c] = get(x, c) + d; };
  const perms = permutations(courts.map((c) => c.id));
  let budget = 200000;
  const result = [];
  const dfs = (i) => {
    if (i === list.length) return true;
    if (--budget < 0) return false;
    const ms = list[i];
    for (const p of perms) {
      let ok = true;
      for (let j = 0; j < ms.length && ok; j++) {
        const m = ms[j];
        if (get(m.teamA, p[j]) >= cap[m.teamA] || get(m.teamB, p[j]) >= cap[m.teamB]) ok = false;
      }
      if (!ok) continue;
      ms.forEach((m, j) => { add(m.teamA, p[j], 1); add(m.teamB, p[j], 1); });
      result[i] = p;
      if (dfs(i + 1)) return true;
      ms.forEach((m, j) => { add(m.teamA, p[j], -1); add(m.teamB, p[j], -1); });
    }
    return false;
  };
  if (dfs(0)) list.forEach((ms, i) => ms.forEach((m, j) => { m.courtId = result[i][j]; }));
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

function bestAssignment(chosen, courts, use) {
  if (courts.length > 7) return chosen.map((_, i) => courts[i]);
  let best = null, bestScore = Infinity;
  for (const perm of permutations(courts)) {
    let score = 0;
    chosen.forEach((m, i) => {
      const c = perm[i].id;
      score += (use(m.teamA, c) + 1) ** 2 + (use(m.teamB, c) + 1) ** 2;
    });
    if (score < bestScore) { bestScore = score; best = perm; }
  }
  return best.slice(0, chosen.length);
}

/** Heure d'un créneau. */
export function slotTime(t, slot) {
  const [h, m] = (t.startTime || '09:00').split(':').map(Number);
  const per = (t.slotMinutes || 20);
  let total = h * 60 + m + slot * per;
  for (const b of t.breaks || []) if (slot > b.afterSlot) total += b.minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- Résolution & classements

/** Calcule les classements de poules et résout équipes / vainqueurs de chaque match. */
export function resolve(t) {
  const byId = Object.fromEntries(t.matches.map((m) => [m.id, m]));
  const standings = {};
  for (const [L, ids] of Object.entries(t.pools || {})) standings[L] = poolStandings(t, L, ids);
  const done = (list) => list.length > 0 && list.every((m) => m.status === 'done');
  const poolDone = {};
  for (const L of Object.keys(t.pools || {})) poolDone[L] = done(t.matches.filter((m) => m.phase === 'pool' && m.pool === L));

  // Classement transversal (ex. « 2e meilleur 1er de poule ») pour former les poules de niveau
  const cross = {};
  const phase1Done = Object.keys(t.pools || {}).length > 0 && Object.values(poolDone).every(Boolean);
  if (t.pools2 && phase1Done) {
    const maxRank = Math.max(...Object.values(standings).map((r) => r.length));
    for (let rank = 1; rank <= maxRank; rank++) {
      const rows = Object.values(standings).map((r) => r[rank - 1]).filter(Boolean).map((r) => ({ ...r, avg: r.played ? r.rankPts / r.played : 0 }));
      rows.sort((x, y) => y.avg - x.avg || compareRows(x, y));
      rows.forEach((r, i) => { cross[`${rank}:${i + 1}`] = r.team; });
    }
  }
  const members2 = {};
  for (const [P, srcs] of Object.entries(t.pools2 || {})) members2[P] = srcs.map((src) => cross[`${src.rank}:${src.nth}`] || null);
  const standings2 = {};
  const pool2Done = {};
  for (const [P, mem] of Object.entries(members2)) {
    const ms = t.matches.filter((m) => m.phase === 'pool2' && m.pool === P);
    pool2Done[P] = mem.every(Boolean) && done(ms);
    if (mem.every(Boolean)) standings2[P] = poolStandings(t, P, mem, ms.filter((m) => m.status === 'done').map((m) => ({ m, a: mem[m.memA], b: mem[m.memB] })));
  }

  const cache = {};
  const fromSrc = (src) => {
    if (!src) return null;
    if (src.type === 'team') return src.id;
    if (src.type === 'bye') return BYE;
    if (src.type === 'pool') return poolDone[src.pool] ? standings[src.pool]?.[src.rank - 1]?.team ?? BYE : null;
    if (src.type === 'pool2') return pool2Done[src.pool] ? standings2[src.pool]?.[src.rank - 1]?.team ?? BYE : null;
    if (src.type === 'cross') return cross[`${src.rank}:${src.nth}`] || null;
    const r = evalM(byId[src.ref]);
    return src.type === 'winner' ? r.winner : r.loser;
  };
  function evalM(m) {
    if (cache[m.id]) return cache[m.id];
    cache[m.id] = { a: null, b: null, winner: null, loser: null }; // garde anti-cycle
    let a, b, referee = m.referee || null;
    if (m.phase === 'pool') { a = m.teamA; b = m.teamB; }
    else if (m.phase === 'pool2') { const mem = members2[m.pool] || []; a = mem[m.memA] || null; b = mem[m.memB] || null; referee = m.refMem != null ? mem[m.refMem] || null : null; }
    else { a = fromSrc(m.srcA); b = fromSrc(m.srcB); }
    let winner = null, loser = null, result = null;
    if (a === BYE && b === BYE) { winner = loser = BYE; }
    else if (a === BYE && b) { winner = b; loser = BYE; }
    else if (b === BYE && a) { winner = a; loser = BYE; }
    else if (m.status === 'done' && a && b) {
      result = matchResult(m, scoringFor(t, m));
      if (result.winner === 'A') { winner = a; loser = b; }
      else if (result.winner === 'B') { winner = b; loser = a; }
    }
    return (cache[m.id] = { a, b, winner, loser, result, referee });
  }
  const resolved = {};
  for (const m of t.matches) resolved[m.id] = evalM(m);
  // Revanche de grande finale inutile si le vainqueur des gagnants a gagné
  for (const m of t.matches) if (m.resetOf) {
    const gf = resolved[m.resetOf];
    if (gf.winner && gf.winner === gf.a) resolved[m.id] = { ...resolved[m.id], skip: true, winner: gf.a };
  }
  // Classement final 1..N (format par niveaux)
  let places = null;
  if (t.pools2) {
    places = [];
    for (const m of t.matches.filter((x) => x.bracketId === 'place')) {
      const r = resolved[m.id];
      if (r.winner && r.winner !== BYE) { places[m.place - 1] = r.winner; places[m.place] = r.loser; }
    }
    if (t.directPlaces && pool2Done[t.directPlaces.pool]) standings2[t.directPlaces.pool].forEach((row, i) => { places[t.directPlaces.from - 1 + i] = row.team; });
  }
  return { standings, standings2, members2, resolved, poolDone, pool2Done, places };
}

const ratio = (a, b) => (b === 0 ? (a > 0 ? Infinity : 0) : a / b);
function compareRows(x, y) {
  return y.rankPts - x.rankPts || y.won - x.won ||
    ratio(y.setsFor, y.setsAgainst) - ratio(x.setsFor, x.setsAgainst) ||
    (y.ptsFor - y.ptsAgainst) - (x.ptsFor - x.ptsAgainst) ||
    ratio(y.ptsFor, y.ptsAgainst) - ratio(x.ptsFor, x.ptsAgainst);
}

export function poolStandings(t, L, ids, entries) {
  const rows = Object.fromEntries(ids.map((id) => [id, { team: id, played: 0, won: 0, drawn: 0, lost: 0, setsFor: 0, setsAgainst: 0, ptsFor: 0, ptsAgainst: 0, rankPts: 0, form: [] }]));
  entries ??= t.matches.filter((m) => m.phase === 'pool' && m.pool === L && m.status === 'done').map((m) => ({ m, a: m.teamA, b: m.teamB }));
  entries = entries.slice().sort((x, y) => (x.m.slot ?? 0) - (y.m.slot ?? 0));
  const h2h = {};
  for (const { m, a: tA, b: tB } of entries) {
    const sc = scoringFor(t, m);
    const res = matchResult(m, sc);
    const A = rows[tA], B = rows[tB];
    if (!A || !B) continue;
    const rule = sc.ranking || 'win3';
    A.played++; B.played++;
    A.setsFor += res.setsA; A.setsAgainst += res.setsB; B.setsFor += res.setsB; B.setsAgainst += res.setsA;
    A.ptsFor += res.ptsA; A.ptsAgainst += res.ptsB; B.ptsFor += res.ptsB; B.ptsAgainst += res.ptsA;
    if (res.winner === 'A') { A.won++; B.lost++; A.form.push('V'); B.form.push('D'); }
    else if (res.winner === 'B') { B.won++; A.lost++; B.form.push('V'); A.form.push('D'); }
    else { A.drawn++; B.drawn++; A.form.push('N'); B.form.push('N'); }
    A.rankPts += m.forfeit === 'A' ? (RANKING_RULES[rule]?.forfeit ?? 0) : rankingPoints(rule, res, 'A');
    B.rankPts += m.forfeit === 'B' ? (RANKING_RULES[rule]?.forfeit ?? 0) : rankingPoints(rule, res, 'B');
    h2h[`${tA}|${tB}`] = res.winner === 'A' ? tA : res.winner === 'B' ? tB : null;
    h2h[`${tB}|${tA}`] = h2h[`${tA}|${tB}`];
  }
  const list = Object.values(rows);
  list.sort((x, y) =>
    y.rankPts - x.rankPts ||
    y.won - x.won ||
    ratio(y.setsFor, y.setsAgainst) - ratio(x.setsFor, x.setsAgainst) ||
    ratio(y.ptsFor, y.ptsAgainst) - ratio(x.ptsFor, x.ptsAgainst) ||
    (h2h[`${x.team}|${y.team}`] === y.team ? 1 : h2h[`${x.team}|${y.team}`] === x.team ? -1 : 0) ||
    ids.indexOf(x.team) - ids.indexOf(y.team));
  list.forEach((r, i) => { r.rank = i + 1; r.form = r.form.slice(-5); });
  return list;
}

/** Libellé d'une source non résolue (« 1er poule A », « Vainqueur Demi 1 »…). */
export function sourceLabel(t, src) {
  if (!src) return 'À définir';
  if (src.type === 'pool') return `${src.rank}${src.rank === 1 ? 'er' : 'e'} poule ${src.pool}`;
  if (src.type === 'bye') return 'Exempt';
  if (src.type === 'pool2') return `${src.rank}${src.rank === 1 ? 'er' : 'e'} niveau ${src.pool.slice(1)}`;
  if (src.type === 'cross') return `${src.nth}${src.nth === 1 ? 'er' : 'e'} meilleur ${src.rank}${src.rank === 1 ? 'er' : 'e'}`;
  if (src.type === 'team') return t.teams.find((x) => x.id === src.id)?.name || '?';
  const ref = t.matches.find((m) => m.id === src.ref);
  const lbl = ref ? `${ref.label}${ref.side !== 'GF' && sameLabelCount(t, ref) > 1 ? ' ' + (ref.index + 1) : ''}` : '?';
  return `${src.type === 'winner' ? 'Vainq.' : 'Perd.'} ${lbl}`;
}

function sameLabelCount(t, ref) { return t.matches.filter((m) => m.label === ref.label && m.bracketId === ref.bracketId).length; }

/** Classement final (après phases finales) — utile pour le podium. */
export function finalPodium(t, resolved) {
  const main = t.matches.filter((m) => m.phase === 'bracket' && m.bracketId === 'main');
  if (!main.length) {
    const st = Object.values(resolve(t).standings)[0];
    return st && t.matches.every((m) => m.status === 'done' || m.status === 'bye') ? st.slice(0, 3).map((r) => r.team) : [];
  }
  const gf2 = main.find((m) => m.resetOf);
  const gf = main.find((m) => m.side === 'GF' && !m.resetOf);
  let final = gf2 && !resolved[gf2.id]?.skip ? gf2 : gf;
  if (!final) final = main.filter((m) => m.side === 'W' && !m.id.endsWith('3P')).sort((a, b) => b.round - a.round)[0];
  const r = resolved[final.id];
  if (!r?.winner || r.winner === BYE) return [];
  const third = main.find((m) => m.id.endsWith('3P'));
  const lfinal = main.filter((m) => m.side === 'L').sort((a, b) => b.round - a.round)[0];
  const thirdTeam = third ? resolved[third.id]?.winner : lfinal ? resolved[lfinal.id]?.loser : null;
  return [r.winner, final.resetOf || gf2 === final ? (r.loser) : r.loser, thirdTeam].filter((x) => x && x !== BYE);
}

// ---------------------------------------------------------------- Création de tournoi

export function newTournament(over = {}) {
  const t = {
    id: uid(6),
    name: 'Nouveau tournoi',
    date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    startTime: '09:30',
    slotMinutes: 20,
    breaks: [],
    venue: '',
    address: '',
    organizer: '',
    contact: '',
    description: '',
    tagline: '',
    theme: '#F5B700',
    courts: [
      { id: 'c1', name: 'Terrain 1', sport: 'volley', color: COURT_COLORS[0], token: uid(10) },
      { id: 'c2', name: 'Terrain 2', sport: 'volley', color: COURT_COLORS[1], token: uid(10) },
    ],
    format: { type: 'pools', pools: 4, qualifiers: 2, finals: 'single', thirdPlace: true, consolation: false, pinPoolsToCourts: false },
    scoring: { ...SCORING_PRESETS['volley-1x25'], preset: 'volley-1x25' },
    finalsScoring: null,
    registration: { open: true, maxTeams: 16, minPlayers: 4, maxPlayers: 8, fee: 0, paymentUrl: '', paymentProvider: 'helloasso', deadline: '', requireValidation: false },
    social: { facebook: '', instagram: '', website: '' },
    charity: { enabled: false, label: '', goal: 0, raised: 0, donateUrl: '' },
    teams: [],
    matches: [],
    pools: {},
    scoreValidation: false,
    openScoring: true, // tournoi convivial : les joueurs saisissent les scores sans code
    timerControl: 'organizer', // les chronos des matchs au temps sont lancés par l'organisation
    referees: 'teams',
    volunteerPin: pin4(),
    announcements: [],
    buvette: [],
    pointsCards: true,
    cardPacks: [{ price: 5, points: 6 }, { price: 10, points: 12 }, { price: 20, points: 25 }],
    cards: [],
    sponsors: [],
    infos: '',
    status: 'draft',
    adminPin: String(Math.floor(1000 + Math.random() * 9000)),
    version: 1,
    createdAt: new Date().toISOString(),
    ...over,
  };
  return t;
}

export const pin4 = () => String(1000 + Math.floor(Math.random() * 9000));

export function makeTeam(name, over = {}) {
  return { id: uid(6), pin: pin4(), level: 2, name, captain: '', email: '', phone: '', players: [], status: 'confirmed', payment: 'unpaid', checkedIn: false, source: 'admin', createdAt: new Date().toISOString(), ...over };
}

/** (Re)génère le calendrier d'un tournoi — renvoie le tournoi modifié (copie superficielle). */
export function buildSchedule(t) {
  const { matches, pools, pools2 = null, directPlaces = null } = generateMatches(t);
  schedule(t, matches);
  return { ...t, matches, pools, pools2, directPlaces, scheduledAt: new Date().toISOString() };
}

/** Statistiques de planning pour l'aperçu (durée, matchs par équipe, attente max...). */
export function scheduleStats(t) {
  const playable = t.matches.filter((m) => m.status !== 'bye');
  const slots = Math.max(0, ...playable.map((m) => m.slot ?? 0)) + (playable.length ? 1 : 0);
  const perTeam = {}, courtPerTeam = {};
  for (const m of playable.filter((x) => x.phase === 'pool')) for (const id of [m.teamA, m.teamB]) {
    perTeam[id] = (perTeam[id] || 0) + 1;
    (courtPerTeam[id] ??= {})[m.courtId] = (courtPerTeam[id][m.courtId] || 0) + 1;
  }
  return { matches: playable.length, slots, end: slotTime(t, slots), perTeam, courtPerTeam };
}

/**
 * Équipe en retard : décale son prochain match en l'échangeant avec un match plus tardif
 * (même phase, pas encore joué) qui ne crée aucun conflit. Renvoie {moved:[...]} ou {error}.
 */
export function postponeTeam(t, teamId, { minDelay = 1 } = {}) {
  const { resolved } = resolve(t);
  const teamsOf = (m) => [resolved[m.id]?.a, resolved[m.id]?.b].filter(Boolean);
  const playing = (slot, except) => new Set(t.matches.filter((m) => m.slot === slot && m !== except && m.status !== 'bye').flatMap(teamsOf));
  const mine = t.matches.filter((m) => m.status === 'scheduled' && teamsOf(m).includes(teamId)).sort((a, b) => a.slot - b.slot);
  const m1 = mine[0];
  if (!m1) return { error: 'Cette équipe n’a plus de match à venir' };
  const live = t.matches.filter((m) => m.status === 'live' || m.status === 'done').map((m) => m.slot);
  const cands = t.matches
    .filter((m) => m !== m1 && m.status === 'scheduled' && m.phase === m1.phase && m.slot >= m1.slot + minDelay && teamsOf(m).length === 2 && !teamsOf(m).includes(teamId))
    .sort((a, b) => a.slot - b.slot || (a.courtId === m1.courtId ? -1 : 1));
  for (const m2 of cands) {
    const at1 = playing(m1.slot, m1), at2 = playing(m2.slot, m2);
    if (teamsOf(m2).some((x) => at1.has(x))) continue; // les équipes de m2 sont libres au créneau de m1 ?
    if (teamsOf(m1).some((x) => at2.has(x))) continue; // et celles de m1 au créneau de m2 ?
    if (live.includes(m1.slot) && t.matches.some((m) => m.slot === m1.slot && m.courtId === m1.courtId && m !== m1 && m.status !== 'scheduled')) continue;
    const s1 = m1.slot, c1 = m1.courtId;
    m1.slot = m2.slot; m1.courtId = m2.courtId;
    m2.slot = s1; m2.courtId = c1;
    if (t.referees === 'teams') assignReferees(t, t.matches, [m1.slot, m2.slot]);
    return { moved: [m1.id, m2.id], from: s1, to: m1.slot };
  }
  // Sinon : échanger toute la rotation avec une rotation plus tardive où l'équipe est au repos
  const slotMs = (x) => t.matches.filter((m) => m.slot === x && m.status !== 'bye');
  const untouched = (x) => slotMs(x).length > 0 && slotMs(x).every((m) => m.status === 'scheduled' && m.phase === m1.phase);
  if (untouched(m1.slot)) {
    const slots = [...new Set(t.matches.map((m) => m.slot).filter((x) => x != null && x > m1.slot))].sort((a, b) => a - b);
    for (const s2 of slots) {
      if (!untouched(s2) || slotMs(s2).some((m) => teamsOf(m).includes(teamId) || teamsOf(m).length < 2)) continue;
      const s1 = m1.slot;
      const A = slotMs(s1), Bm = slotMs(s2);
      A.forEach((m) => { m.slot = s2; });
      Bm.forEach((m) => { m.slot = s1; });
      return { moved: [...A, ...Bm].map((m) => m.id), from: s1, to: s2, rotation: true };
    }
  }
  // Dernier recours : premier terrain libre plus tard où les deux équipes sont libres, sinon une rotation de plus en fin de phase
  const courts = t.courts.filter((c) => c.active !== false).map((c) => c.id);
  const phaseSlots = t.matches.filter((m) => m.phase === m1.phase && m.slot != null).map((m) => m.slot);
  const lastPhase = Math.max(...phaseSlots);
  for (let s2 = m1.slot + minDelay; s2 <= lastPhase; s2++) {
    const used = t.matches.filter((m) => m.slot === s2).map((m) => m.courtId);
    const free = courts.find((c) => !used.includes(c));
    if (!free || teamsOf(m1).some((x) => playing(s2, m1).has(x))) continue;
    const from = m1.slot;
    m1.slot = s2; m1.courtId = free;
    return { moved: [m1.id], from, to: s2 };
  }
  const from = m1.slot;
  for (const m of t.matches) if (m.slot != null && m.slot > lastPhase) m.slot++;
  m1.slot = lastPhase + 1; m1.courtId = courts[0];
  return { moved: [m1.id], from, to: m1.slot, appended: true };
}

// ---------------------------------------------------------------- Rotations chronométrées (gérées par l'organisation)

/** Rotation en cours : la première qui a encore un match à jouer. */
export function currentSlot(t) {
  const open = t.matches.filter((m) => m.slot != null && (m.status === 'scheduled' || m.status === 'live'));
  return open.length ? Math.min(...open.map((m) => m.slot)) : null;
}

/** Lance tous les matchs prêts d'une rotation, chronos synchronisés sur le même départ. */
export function startRotation(t, slot, now) {
  const { resolved } = resolve(t);
  const started = [];
  for (const m of t.matches.filter((x) => x.slot === slot && x.status === 'scheduled')) {
    const r = resolved[m.id];
    if (!r.a || !r.b || r.a === BYE || r.b === BYE) continue;
    m.status = 'live';
    m.startedAt = new Date(now).toISOString();
    if (!m.sets?.length) m.sets = [[0, 0]];
    if (scoringFor(t, m).mode === 'time') m.timer = { running: true, elapsed: 0, since: now };
    started.push(m.id);
  }
  return started;
}

/** Pause ou reprise des chronos d'une rotation. */
export function toggleRotation(t, slot, now, run) {
  for (const m of t.matches.filter((x) => x.slot === slot && x.status === 'live' && x.timer)) {
    const tm = m.timer;
    if (run && !tm.running) m.timer = { running: true, elapsed: tm.elapsed, since: now };
    if (!run && tm.running) m.timer = { running: false, elapsed: tm.elapsed + now - tm.since, since: 0 };
  }
}
