// Règles du tournoi rédigées automatiquement à partir des réglages, et mode d'emploi de l'application.
import { SPORTS, RANKING_RULES, scoringFor, slotTime, scheduleStats } from './engine.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const eur = (n) => (+n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: +n % 1 ? 2 : 0 });

function formatText(t) {
  const f = t.format || {};
  const n = t.teams.filter((x) => x.status === 'confirmed').length;
  const sports = [...new Set(t.courts.filter((c) => c.active !== false).map((c) => c.sport))];
  const multi = sports.length > 1;
  switch (f.type) {
    case 'roundrobin': {
      const legs = f.legs || 1;
      let s = legs === 1 ? 'Chaque équipe rencontre toutes les autres une fois' : `Chaque équipe rencontre toutes les autres ${legs} fois`;
      if (multi) s += legs === 1 ? ', les sports étant répartis équitablement : chacun joue autant de fois chaque sport.' : `, à chaque fois dans un sport différent.`;
      else s += '.';
      if (f.finalsTop >= 2) s += f.finalsTop === 2 ? ' Les 2 premiers du classement jouent la finale.' : ` Les ${f.finalsTop} premiers jouent ${f.finalsTop === 4 ? 'les demi-finales' : 'les quarts de finale'}, puis la finale${f.thirdPlace ? ' et la petite finale' : ''}.`;
      return s;
    }
    case 'pools':
      return `${plural(f.pools || 2, 'poule')}${n ? ` de ${Math.floor(n / (f.pools || 2))} à ${Math.ceil(n / (f.pools || 2))} équipes` : ''}. Les ${f.qualifiers || 2} premiers de chaque poule sont qualifiés pour ${f.finals === 'double' ? 'un tableau final en double élimination (on peut perdre une fois)' : 'le tableau final'}${f.consolation ? ' ; les autres jouent la consolante' : ''}.`;
    case 'levels':
      return `Brassage en poules de ${f.poolSize || 3}, puis poules de niveau (les équipes de niveau proche se retrouvent ensemble)${f.placement !== false ? ', puis matchs de classement : chaque équipe repart avec sa place, de la première à la dernière' : ''}.`;
    case 'double':
      return 'Double élimination : une équipe qui perd passe dans le tableau de repêchage ; il faut perdre deux fois pour être éliminé. Grande finale entre les vainqueurs des deux tableaux.';
    default:
      return `Élimination directe : le perdant est éliminé${f.thirdPlace ? ', avec une petite finale pour la 3e place' : ''}.`;
  }
}

function scoreText(t, sc) {
  if (sc.mode === 'time') return `${sc.durationMin} minutes, le plus de points (ou de buts) l’emporte${sc.allowDraw !== false ? ' ; match nul possible en championnat' : ''}`;
  const sets = sc.setsToWin > 1 ? `${sc.setsToWin} sets gagnants de ${sc.pointsPerSet} points${sc.tiebreakPoints ? `, set décisif à ${sc.tiebreakPoints}` : ''}` : `1 set de ${sc.pointsPerSet} points`;
  return `${sets}${sc.winBy2 !== false ? ', 2 points d’écart' : ''}${sc.cap ? `, plafond à ${sc.cap}` : ''}${sc.durationMin ? ` (ou ${sc.durationMin} minutes)` : ''}`;
}

/** Règles du tournoi : liste de {icon, title, text}. */
export function tournamentRules(t) {
  const out = [];
  const courts = t.courts.filter((c) => c.active !== false);
  out.push({ icon: '🏆', title: 'Le format', text: formatText(t) });
  // Règles de jeu : une ligne par sport si elles diffèrent
  // Une ligne par règle de jeu ; les sports qui partagent la même règle sont regroupés
  const groups = new Map();
  for (const c of courts) {
    const txt = scoreText(t, scoringFor(t, { courtId: c.id, phase: 'pool' }));
    const sp = SPORTS[c.sport]?.label || c.sport;
    if (!groups.has(txt)) groups.set(txt, []);
    if (!groups.get(txt).includes(sp)) groups.get(txt).push(sp);
  }
  const lines = [...groups].map(([txt, sp]) => (groups.size > 1 ? `${sp.join(', ')} : ${txt}` : txt));
  const allSports = [...new Set(courts.map((c) => SPORTS[c.sport]?.label || c.sport))];
  const intro = groups.size === 1 && allSports.length > 1 ? `${allSports.join(', ')} : ` : '';
  out.push({ icon: '⏱️', title: 'Les matchs', text: `${intro}${lines.join(' · ')}.` });
  const st = t.matches.length ? scheduleStats(t) : null;
  const rot = `Une rotation toutes les ${t.slotMinutes} minutes (match + changement de terrain)`;
  const when = st ? `, de ${t.startTime} à environ ${st.end}` : `, premier match à ${t.startTime}`;
  const brk = (t.breaks || []).map((b) => `${b.label || 'pause'} de ${b.minutes} min`).join(', ');
  out.push({ icon: '🕒', title: 'Le déroulé', text: `${rot}${when}.${brk ? ` ${brk[0].toUpperCase()}${brk.slice(1)}.` : ''}${(t.scoring.mode === 'time' || courts.some((c) => c.scoring?.mode === 'time')) && t.timerControl !== 'players' ? ' Le chrono est lancé par l’organisation pour tous les terrains en même temps.' : ''}` });
  const rr = RANKING_RULES[t.scoring.ranking] || RANKING_RULES.win3;
  out.push({ icon: '📊', title: 'Le classement', text: `${rr.label}. En cas d’égalité : nombre de victoires, puis ${t.scoring.mode === 'time' ? 'différence de buts' : 'ratio de sets et de points'}, puis confrontation directe.` });
  out.push({ icon: '🙋', title: 'L’arbitrage', text: t.referees === 'teams' ? 'L’équipe au repos arbitre un match : elle est prévenue sur son téléphone et tient le score.' : 'Les deux équipes s’arbitrent elles-mêmes et tiennent le score ensemble.' });
  if (t.pointsCards !== false && (t.buvette || []).length) {
    const packs = (t.cardPacks?.length ? t.cardPacks : []).map((p) => `${eur(p.price)} = ${p.points} pts`).join(', ');
    out.push({ icon: '🥪', title: 'La buvette', text: `Payez en espèces, par carte ou avec la carte à points${packs ? ` (${packs})` : ''} : pas de monnaie, et votre solde est sur votre téléphone.` });
  }
  if (t.charity?.enabled) {
    const c = t.charity;
    out.push({ icon: '💛', title: `Pour le ${c.label || 'cagnotte'}`, text: `${c.includeFees ? 'Les inscriptions' : ''}${c.includeFees && c.includeBuvette ? ' et ' : ''}${c.includeBuvette ? 'la buvette' : ''}${c.includeFees || c.includeBuvette ? ' sont reversées. ' : ''}${c.pointPledge ? `Chaque point marqué rapporte ${eur(c.pointPledge)}. ` : ''}${c.goal ? `Objectif : ${eur(c.goal)}.` : ''}`.trim() });
  }
  if (t.infos) out.push({ icon: 'ℹ️', title: 'À savoir', text: t.infos });
  return out;
}

/** Mode d'emploi de l'application pour les joueurs, en 4 étapes. */
export function appSteps(t) {
  return [
    { title: 'Scannez le QR code', text: 'Avec l’appareil photo de votre téléphone. Pas d’application à installer, pas de compte à créer.' },
    { title: 'Choisissez votre équipe', text: 'Touchez « Je suis une équipe » : votre poule, vos matchs et vos terrains s’affichent.' },
    { title: 'Suivez vos matchs', text: 'Le portail indique « N matchs avant le vôtre » et vous prévient quand c’est bientôt votre tour de jouer ou d’arbitrer.' },
    { title: 'Tenez le score', text: `Pendant le match${t.referees === 'teams' ? ' (ou quand vous arbitrez)' : ''} : « Score en direct », puis +1 à chaque point, −1 pour corriger, « Terminer le match » à la fin. Le grand écran et les classements suivent tout seuls.` },
  ];
}

/** Le tournoi a-t-il commencé ? (au moins un match en cours ou terminé) */
export const hasStarted = (t) => t.matches.some((m) => m.status === 'live' || m.status === 'done');
