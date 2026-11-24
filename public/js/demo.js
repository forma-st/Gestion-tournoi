// Tournois d'exemple : le multisport de la semaine prochaine, le format 18 équipes, une double élimination.
import { newTournament, makeTeam, buildSchedule, resolve, scoringFor, BYE, COURT_COLORS, SCORING_PRESETS, uid } from './engine.js';

const NAMES = ['Les Smasheurs', 'Block Party', 'Les Pieds Carrés', 'Service Gagnant', 'Filet Mignon', 'Les Manchettes', 'Ace Ventura', 'Les Libéros', 'Team Réception', 'Les Passeurs Fous', 'Sable Chaud', 'Les Contres Attaques', 'Volley Gones', 'Les Kangourous', 'Pas de Côté', 'Les Rotations', 'Bloc Opératoire', 'Les Tie-Breakers'];
const CAPTAINS = ['Camille', 'Hugo', 'Léa', 'Yanis', 'Inès', 'Mathis', 'Chloé', 'Nathan', 'Manon', 'Lucas', 'Sarah', 'Théo', 'Jade', 'Adam', 'Zoé', 'Louis', 'Emma', 'Noah'];

function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7) + 7 * (d.getDay() >= 3 ? 0 : 0));
  return d.toISOString().slice(0, 10);
}

function mkTeams(n) {
  return Array.from({ length: n }, (_, i) => makeTeam(NAMES[i], {
    seed: i + 1,
    captain: CAPTAINS[i],
    email: `${CAPTAINS[i].toLowerCase()}@exemple.fr`,
    phone: `06 ${String(10 + i).padStart(2, '0')} 42 ${String(30 + i)} ${String(50 + i)}`,
    players: [CAPTAINS[i], CAPTAINS[(i + 5) % 18], CAPTAINS[(i + 9) % 18], CAPTAINS[(i + 13) % 18]],
    payment: i % 4 === 3 ? 'unpaid' : i % 5 === 1 ? 'onsite' : 'paid',
    source: i % 3 ? 'online' : 'admin',
    checkedIn: i % 6 !== 5,
  }));
}

export const DEMOS = {
  multisport: 'Téléthon : 7 équipes, 3 sports (tennis de table, dodgeball, volley), matchs de 8 min',
  fluo: 'Tournoi fluo : 18 équipes de volley, poules de 3, puis niveaux et matchs de classement',
  double: 'Double chance : 8 équipes en double élimination avec repêchage',
};

const BAR = () => {
  const ing = [
    { id: 'pain', name: 'Baguette', unit: 'baguette', bought: 20, price: 1.1 },
    { id: 'jambon', name: 'Jambon', unit: 'tranche', bought: 60, price: 0.35 },
    { id: 'fromage', name: 'Emmental', unit: 'tranche', bought: 40, price: 0.25 },
    { id: 'beurre', name: 'Beurre', unit: 'g', bought: 500, price: 0.012 },
    { id: 'pate', name: 'Pâte à crêpes', unit: 'crêpe', bought: 80, price: 0.15 },
    { id: 'nutella', name: 'Pâte à tartiner', unit: 'g', bought: 1000, price: 0.009 },
  ];
  const prod = [
    { id: 'jb', name: 'Jambon-beurre', category: 'Salé', price: 3.5, recipe: [{ iid: 'pain', qty: 0.33 }, { iid: 'jambon', qty: 2 }, { iid: 'beurre', qty: 10 }] },
    { id: 'jf', name: 'Jambon-fromage', category: 'Salé', price: 4, recipe: [{ iid: 'pain', qty: 0.33 }, { iid: 'jambon', qty: 2 }, { iid: 'fromage', qty: 2 }, { iid: 'beurre', qty: 10 }] },
    { id: 'cs', name: 'Crêpe sucre', category: 'Sucré', price: 2, recipe: [{ iid: 'pate', qty: 1 }] },
    { id: 'cn', name: 'Crêpe chocolat', category: 'Sucré', price: 2.5, recipe: [{ iid: 'pate', qty: 1 }, { iid: 'nutella', qty: 25 }] },
    { id: 'cafe', name: 'Café', category: 'Boissons', price: 1, cost: 0.2, stock: 120 },
    { id: 'soda', name: 'Soda', category: 'Boissons', price: 1.5, cost: 0.45, stock: 48 },
    { id: 'eau', name: 'Eau', category: 'Boissons', price: 1, cost: 0.2, stock: 36 },
    { id: 'biere', name: 'Bière sans alcool', category: 'Boissons', price: 2.5, cost: 0.9, stock: 24 },
  ].map((p) => ({ active: true, cost: 0, stock: null, ...p }));
  return { ingredients: ing, buvette: prod };
};

function fakeSales(n) {
  const pick = ['jb', 'jf', 'cs', 'cn', 'cafe', 'soda', 'eau', 'biere'];
  const price = { jb: 3.5, jf: 4, cs: 2, cn: 2.5, cafe: 1, soda: 1.5, eau: 1, biere: 2.5 };
  const methods = ['cash', 'cash', 'card', 'card', 'lydia', 'cash', 'free'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const items = [{ pid: pick[(i * 5 + 3) % 8], qty: 1 + (i % 3 === 0 ? 1 : 0) }, ...(i % 2 ? [{ pid: pick[(i * 3) % 8], qty: 1 }] : [])]
      .map((it) => ({ ...it, name: it.pid, price: price[it.pid] }));
    out.push({ id: `s${i}`, at: new Date(Date.now() - (n - i) * 4 * 60e3).toISOString(), items, total: items.reduce((a, x) => a + x.qty * x.price, 0), method: methods[i % methods.length] });
  }
  return out;
}

export function buildDemo(kind = 'multisport') {
  if (kind === 'multisport') {
    const time = (min) => ({ ...SCORING_PRESETS['time-8'], durationMin: min, ranking: 'participation', preset: 'time-8' });
    return newTournament({
      name: 'Tournoi du Téléthon',
      tagline: '7 équipes, 3 sports, une seule cause : chaque inscription, chaque crêpe et chaque point marqué vont au Téléthon.',
      description: 'Une soirée conviviale et solidaire : chaque équipe rencontre les autres en tournant sur le tennis de table, le dodgeball et le volley. Matchs de 8 minutes, l’équipe au repos arbitre, buvette au profit du Téléthon.',
      date: nextSaturday(), startTime: '20:30', slotMinutes: 10,
      venue: 'Gymnase', address: '',
      organizer: 'Rambouillet Volleyball', contact: 'contact@exemple.fr',
      theme: '#0B6E2E',
      courts: [
        { id: 'c1', name: 'Terrain 1', sport: 'tennistable', color: COURT_COLORS[0], token: uid(10), scoring: time(8) },
        { id: 'c2', name: 'Terrain 2', sport: 'dodgeball', color: COURT_COLORS[1], token: uid(10), scoring: time(8) },
        { id: 'c3', name: 'Terrain 3', sport: 'volley', color: COURT_COLORS[2], token: uid(10), scoring: time(8) },
      ],
      format: { type: 'roundrobin', legs: 2, finalsTop: 2, thirdPlace: false },
      scoring: time(8),
      referees: 'teams',
      registration: { open: true, maxTeams: 7, minPlayers: 5, maxPlayers: 10, fee: 5, feeMode: 'player', paymentUrl: '', paymentProvider: 'onsite', deadline: '', requireValidation: false },
      charity: {
        enabled: true, label: 'Téléthon', goal: 1500, raised: 0, donateUrl: 'https://soutenir.afm-telethon.fr/',
        includeFees: true, includeBuvette: true, buvetteMode: 'margin', pointPledge: 0.1, pledgeSponsor: 'nos partenaires', pledgeCap: 300,
        milestones: [{ amount: 500, label: 'les arbitres jouent un match en tutu' }, { amount: 1000, label: 'le président sert les crêpes déguisé' }, { amount: 1500, label: 'match des bénévoles contre les gagnants' }],
        donations: [
          { id: 'd1', name: 'Les Smasheurs', amount: 50, message: 'Allez la recherche !', method: 'cash', at: new Date(Date.now() - 40 * 60e3).toISOString(), validated: true },
          { id: 'd2', name: 'Mamie Jo', amount: 20, message: '', method: 'online', at: new Date(Date.now() - 25 * 60e3).toISOString(), validated: true },
          { id: 'd3', name: 'Hugo', amount: 10, message: 'Bravo à tous', method: 'lydia', at: new Date(Date.now() - 5 * 60e3).toISOString(), validated: false },
        ],
      },
      ...BAR(),
      sales: fakeSales(26),
      cashFund: 100,
      buvettePin: '2024',
      infos: 'Rotation toutes les 10 minutes : 8 minutes de jeu, 2 minutes pour changer de terrain. L’équipe au repos arbitre. Inscription : 5 € minimum par joueur, reversés au Téléthon.',
      teams: mkTeams(7).map((x) => ({ ...x, players: [...x.players, 'Lina'] })),
    });
  }
  if (kind === 'fluo' || kind === '18teams') {
    return newTournament({
      name: 'Tournoi Fluo',
      tagline: 'Volley dans le noir : 18 équipes, poules de 3, des matchs qui s’enchaînent toutes les 12 minutes.',
      description: 'Lumière noire, ballons fluo et maillots qui brillent. Brassage en poules de 3, puis poules de niveau pour jouer contre des équipes de votre niveau, et matchs de classement pour finir : chaque équipe repart avec sa place.',
      date: nextSaturday(), startTime: '21:00', slotMinutes: 12,
      venue: 'Gymnase', address: '',
      organizer: 'Rambouillet Volleyball', contact: 'contact@exemple.fr',
      theme: '#D4FF00',
      courts: [0, 1, 2].map((i) => ({ id: `c${i + 1}`, name: `Terrain ${i + 1}`, sport: 'volley', color: COURT_COLORS[i], token: uid(10) })),
      format: { type: 'levels', poolSize: 3, placement: true },
      scoring: { ...SCORING_PRESETS['time-10-21'], preset: 'time-10-21' },
      referees: 'teams',
      registration: { open: true, maxTeams: 18, minPlayers: 4, maxPlayers: 6, fee: 5, feeMode: 'player', paymentUrl: '', paymentProvider: 'helloasso', deadline: '', requireValidation: true },
      ...BAR(),
      infos: '1 set de 21 points ou 10 minutes. L’équipe qui ne joue pas dans la poule arbitre. Prévoyez un haut blanc ou fluo !',
      teams: mkTeams(18).map((x, i) => ({ ...x, level: 1 + Math.floor(i / 6) })),
    });
  }
  return newTournament({
    name: 'Double Chance Volley',
    tagline: 'Perdre une fois n’élimine personne : tableau de repêchage jusqu’à la grande finale.',
    description: 'Huit équipes, double élimination : chaque perdant du tableau principal passe en repêchage.',
    date: nextSaturday(), startTime: '14:00', slotMinutes: 25,
    venue: 'Plage du Lac', theme: '#F2545B',
    courts: [0, 1].map((i) => ({ id: `c${i + 1}`, name: `Terrain ${i + 1}`, sport: 'beach', color: COURT_COLORS[i], token: uid(10) })),
    format: { type: 'double', grandFinalReset: false },
    scoring: { ...SCORING_PRESETS['volley-2x21'], preset: 'volley-2x21' },
    registration: { open: true, maxTeams: 8, minPlayers: 2, maxPlayers: 3, fee: 0, paymentUrl: '', paymentProvider: 'helloasso', deadline: '' },
    teams: mkTeams(8),
  });
}

/** Simule des résultats pour les `slots` premiers créneaux, et met le créneau suivant « en cours ». */
export function simulate(t, slots) {
  const strength = Object.fromEntries(t.teams.map((x, i) => [x.id, 100 - i * 3 + ((i * 37) % 11)]));
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  for (let s = 0; s <= slots; s++) {
    const { resolved } = resolve(t);
    for (const m of t.matches.filter((x) => x.slot === s && x.status === 'scheduled')) {
      const r = resolved[m.id];
      if (!r.a || !r.b || r.a === BYE || r.b === BYE) continue;
      const sc = scoringFor(t, m);
      const aFav = strength[r.a] + rand() * 25 > strength[r.b] + rand() * 25;
      if (s === slots) { // match en cours
        m.status = 'live';
        m.sets = sc.mode === 'time' ? [[1, 1]] : [[aFav ? 14 : 11, aFav ? 10 : 13]];
        m.startedAt = new Date(Date.now() - 6 * 60e3).toISOString();
        if (sc.mode === 'time') m.timer = { running: true, elapsed: 0, since: Date.now() - 5 * 60e3 };
        continue;
      }
      if (sc.mode === 'time') {
        const w = Math.floor(rand() * 4) + 1, l = Math.floor(rand() * w);
        m.sets = [aFav ? [w, l] : [l, w]];
      } else {
        const sets = [];
        let wa = 0, wb = 0, i = 0;
        while (wa < sc.setsToWin && wb < sc.setsToWin) {
          const target = sc.setsToWin > 1 && i === sc.setsToWin * 2 - 2 ? sc.tiebreakPoints : sc.pointsPerSet;
          const aWin = rand() < (aFav ? 0.72 : 0.28);
          const lose = Math.floor(rand() * (target - 6)) + 4;
          sets.push(aWin ? [target, lose] : [lose, target]);
          aWin ? wa++ : wb++; i++;
        }
        m.sets = sets;
      }
      m.status = 'done';
      m.submittedBy = 'Capitaines';
      m.finishedAt = new Date().toISOString();
    }
  }
  return t;
}
