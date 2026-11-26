// Argent du tournoi : inscriptions, buvette, cagnotte solidaire (Téléthon…).
// Module pur, partagé par le navigateur et les tests.

export const PAY_METHODS = {
  points: 'Carte à points',
  cash: 'Espèces',
  card: 'Carte',
  lydia: 'Lydia / Wero',
  check: 'Chèque',
  free: 'Offert (bénévoles)',
};

const headcount = (t, team) => Math.max(team.present?.length || team.players?.length || 0, +t.registration?.minPlayers || 1);

/** Droit d'inscription seul (au forfait ou par joueur, avec un minimum). */
export function teamFee(t, team) {
  const r = t.registration || {};
  const fee = +r.fee || 0;
  if (!fee) return 0;
  return r.feeMode === 'player' ? fee * headcount(t, team) : fee;
}

/** Carte buvette en option à l'inscription : prix et points pour cette équipe (0 si non choisie). */
export function barOption(t, team) {
  const o = t.registration?.barCard;
  if (!o?.enabled || !team?.barOption) return { price: 0, points: 0 };
  const n = o.per === 'player' ? headcount(t, team) : 1;
  return { price: (+o.price || 0) * n, points: (+o.points || 0) * n };
}

/** Montant total dû par une équipe : inscription + carte buvette si elle l'a choisie. */
export function teamDue(t, team) { return teamFee(t, team) + barOption(t, team).price; }

/** Crée la carte buvette d'une équipe qui l'a prise en option (une seule fois). L'argent va à la buvette. */
export function issueTeamCard(t, team, method = 'cash') {
  const o = barOption(t, team);
  if (!o.points || team.barCard) return null;
  const c = issueCard(t, { price: o.price, points: o.points, method: method || 'cash', name: team.name, sid: `inc-${team.id}` });
  team.barCard = c.code;
  return c;
}

export function feesSummary(t) {
  const conf = t.teams.filter((x) => x.status === 'confirmed');
  let due = 0, paid = 0, extra = 0;
  for (const x of conf) {
    const d = teamFee(t, x); // l'option buvette est comptée à la buvette, pas dans les inscriptions
    due += d;
    if (x.payment === 'paid' || x.payment === 'onsite') { paid += d; extra += +x.extraPaid || 0; }
  }
  return { due, paid, extra, unpaid: due - paid };
}

// ------------------------------------------------------------------ buvette
export function productById(t, id) { return (t.buvette || []).find((p) => p.id === id); }

/** Coût de revient d'un produit : prix d'achat saisi, sinon somme de sa recette. */
export function productCost(t, p) {
  if (p?.cost !== '' && p?.cost != null && +p.cost > 0) return +p.cost;
  return (p?.recipe || []).reduce((a, r) => a + (+r.qty || 0) * (+(t.ingredients || []).find((i) => i.id === r.iid)?.price || 0), 0);
}

/** Matières premières : consommé (ventes × recettes), reste, suggestion d'achat pour la prochaine fois. */
export function ingredientStats(t) {
  const sold = {};
  for (const s of (t.sales || []).filter((x) => !x.cancelled)) for (const it of s.items) sold[it.pid] = (sold[it.pid] || 0) + it.qty;
  return (t.ingredients || []).map((ing) => {
    let used = 0;
    for (const p of t.buvette || []) for (const r of p.recipe || []) if (r.iid === ing.id) used += (sold[p.id] || 0) * (+r.qty || 0);
    used = Math.round(used * 1000) / 1000;
    const bought = ing.bought === '' || ing.bought == null ? null : +ing.bought;
    const last = t.lastYear?.consumed?.[ing.id];
    return { ...ing, used, left: bought == null ? null : Math.round((bought - used) * 1000) / 1000, suggest: Math.ceil(used * 1.1 * 10) / 10, last, low: bought != null && bought - used <= bought * 0.1 };
  });
}

/** Bilan de la buvette : chiffre d'affaires, coût, marge, par moyen de paiement, par produit, stock. */
export function buvetteStats(t) {
  const sales = (t.sales || []).filter((s) => !s.cancelled);
  const byMethod = {}, byProduct = {};
  let revenue = 0, cost = 0, count = 0, offered = 0;
  for (const s of sales) {
    if (s.kind === 'topup') { // vente de carte à points : recette en euros, pas d'article
      revenue += s.total;
      byMethod[s.method] = (byMethod[s.method] || 0) + s.total;
      continue;
    }
    for (const it of s.items) {
      const p = productById(t, it.pid);
      const line = it.qty * it.price;
      byProduct[it.pid] ??= { qty: 0, revenue: 0, name: p?.name || it.name || '?' };
      byProduct[it.pid].qty += it.qty;
      cost += it.qty * productCost(t, p);
      count += it.qty;
      if (s.method === 'free') { offered += line; continue; }
      if (s.method === 'points') continue; // payé en points : la recette a été comptée à la vente de la carte
      byProduct[it.pid].revenue += line;
      revenue += line;
    }
    if (s.method !== 'points') byMethod[s.method] = (byMethod[s.method] || 0) + (s.method === 'free' ? 0 : s.total);
  }
  const stock = (t.buvette || []).map((p) => {
    const sold = byProduct[p.id]?.qty || 0;
    const left = p.stock == null || p.stock === '' ? null : +p.stock - sold;
    return { ...p, sold, left, low: left != null && left <= Math.max(2, Math.round((+p.stock || 0) * 0.15)) };
  });
  const top = Object.entries(byProduct).sort((a, b) => b[1].qty - a[1].qty).map(([pid, v]) => ({ pid, ...v }));
  const cash = (+t.cashFund || 0) + (byMethod.cash || 0);
  return { revenue, cost, margin: revenue - cost, count, offered, byMethod, top, stock, sales: sales.length, cash };
}

// ------------------------------------------------------------------ cagnotte solidaire
/** Points (ou buts) marqués dans tous les matchs joués ou en cours : base du défi « chaque point compte ». */
export function pointsScored(t) {
  let n = 0;
  for (const m of t.matches || []) if (m.status === 'done' || m.status === 'live') for (const s of m.sets || []) n += (+s[0] || 0) + (+s[1] || 0);
  return n;
}

/** Fil rouge (« chaque point rapporte » + paliers/défis) : option à cocher. Anciennes données : actif s'il était rempli. */
export const filRougeOn = (c = {}) => c.filRouge ?? !!(+c.pointPledge || (c.milestones || []).length);

export function charityTotals(t) {
  const c = t.charity || {};
  const donations = (c.donations || []).filter((d) => d.validated);
  const don = donations.reduce((a, d) => a + (+d.amount || 0), 0);
  const fees = c.includeFees ? feesSummary(t).paid + feesSummary(t).extra : 0;
  const b = buvetteStats(t);
  const bar = c.includeBuvette ? (c.buvetteMode === 'revenue' ? b.revenue : b.margin) : 0;
  const pts = pointsScored(t);
  const fil = filRougeOn(c);
  const pledge = fil ? (+c.pointPledge || 0) * pts : 0;
  const capped = c.pledgeCap ? Math.min(pledge, +c.pledgeCap) : pledge;
  const total = (+c.raised || 0) + don + fees + bar + capped;
  const goal = +c.goal || 0;
  const miles = (fil ? c.milestones || [] : []).filter((m) => m.amount).sort((a, b) => a.amount - b.amount);
  return {
    total, goal, base: +c.raised || 0, don, fees, bar, pledge: capped, points: pts, pledgeOn: fil && +c.pointPledge > 0,
    pct: goal ? Math.min(100, (100 * total) / goal) : 0,
    reached: miles.filter((m) => total >= m.amount),
    next: miles.find((m) => total < m.amount) || null,
    pending: (c.donations || []).filter((d) => !d.validated && !d.rejected).length,
    feed: donations.slice().sort((x, y) => (y.at || '').localeCompare(x.at || '')).slice(0, 8),
  };
}

// ------------------------------------------------------------------ cartes à points (buvette)
// Le joueur achète une carte (ex. 10 € = 12 points), puis paie ses consommations en points.
// Carte physique pré-imprimée (QR + code à 4 chiffres) ou carte virtuelle sur son téléphone.

export const DEFAULT_PACKS = [{ price: 5, points: 6 }, { price: 10, points: 12 }, { price: 20, points: 25 }];
export const productPoints = (p) => (p?.points != null && p.points !== '' ? +p.points : Math.ceil(+p?.price || 0));

const rnd = (n) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => a[x % a.length]).join('');
};

export function newCardCode(t) {
  const used = new Set((t.cards || []).map((c) => c.code));
  for (let i = 0; i < 20000; i++) {
    const c = String(1000 + (globalThis.crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
    if (!used.has(c)) return c;
  }
  throw new Error('Plus de code disponible');
}

export const findCard = (t, code) => (t.cards || []).find((c) => c.code === String(code || '').replace(/\D/g, ''));

/** Crée des cartes vierges (solde 0) à imprimer à l'avance. */
export function blankCards(t, n) {
  t.cards ??= [];
  const out = [];
  for (let i = 0; i < Math.min(200, n); i++) {
    const c = { code: newCardCode(t), key: rnd(8), name: '', balance: 0, createdAt: new Date().toISOString(), ops: [] };
    t.cards.push(c); out.push(c);
  }
  return out;
}

/** Vend ou recharge une carte (nouvelle si pas de code). Enregistre l'encaissement en euros. */
export function issueCard(t, { code, price, points, method = 'cash', name = '', sid, at, by = '' }) {
  price = Math.max(0, +price || 0); points = Math.max(1, Math.round(+points || 0));
  t.cards ??= []; t.sales ??= [];
  if (sid && t.sales.some((s) => s.id === sid)) return findCard(t, t.sales.find((s) => s.id === sid).card);
  let card = code ? findCard(t, code) : null;
  if (code && !card && !/^\d{4,6}$/.test(String(code))) throw new Error('Code de carte invalide');
  if (!card) {
    card = { code: code ? String(code) : newCardCode(t), key: rnd(8), name: '', balance: 0, createdAt: new Date().toISOString(), ops: [] };
    t.cards.push(card);
  }
  if (name) card.name = String(name).slice(0, 40);
  const when = at || new Date().toISOString();
  const id = sid || `top-${rnd(8)}`;
  card.balance += points;
  card.ops.push({ at: when, delta: points, label: `Achat ${price ? `${price} €` : 'offert'}`, sid: id });
  t.sales.push({ id, at: when, kind: 'topup', card: card.code, items: [], total: method === 'free' ? 0 : price, points, method, by });
  return card;
}

/** Paiement en points : vérifie le solde, débite la carte, enregistre la vente (sans recette en euros : déjà encaissée). */
export function cardSale(t, { code, items, sid, at, by = '' }) {
  t.sales ??= [];
  if (sid && t.sales.some((s) => s.id === sid)) { const s = t.sales.find((x) => x.id === sid); return { card: findCard(t, s.card), pts: s.pts, duplicate: true }; }
  const card = findCard(t, code);
  if (!card) throw Object.assign(new Error('Carte inconnue : vérifiez le code'), { code: 404 });
  const lines = (items || []).map((it) => {
    const p = productById(t, it.pid);
    return p && +it.qty > 0 ? { pid: p.id, name: p.name, qty: Math.min(99, Math.floor(+it.qty)), price: +p.price || 0, pts: productPoints(p) } : null;
  }).filter(Boolean);
  if (!lines.length) throw Object.assign(new Error('Panier vide'), { code: 400 });
  const pts = lines.reduce((a, l) => a + l.qty * l.pts, 0);
  if (card.balance < pts) throw Object.assign(new Error(`Solde insuffisant : ${card.balance} pt${card.balance > 1 ? 's' : ''} sur la carte, il en faut ${pts}`), { code: 409, balance: card.balance });
  const id = sid || `pts-${rnd(8)}`;
  const when = at || new Date().toISOString();
  card.balance -= pts;
  card.ops.push({ at: when, delta: -pts, label: lines.map((l) => `${l.qty} ${l.name}`).join(', '), sid: id });
  card.ops = card.ops.slice(-60);
  t.sales.push({ id, at: when, method: 'points', card: card.code, items: lines, total: 0, pts, by });
  return { card, pts };
}

export function cardsSummary(t) {
  const cards = t.cards || [];
  const sold = (t.sales || []).filter((s) => s.kind === 'topup' && !s.cancelled);
  const issued = sold.reduce((a, s) => a + s.points, 0);
  const used = (t.sales || []).filter((s) => s.method === 'points' && !s.cancelled).reduce((a, s) => a + (s.pts || 0), 0);
  return { count: cards.filter((c) => c.ops?.length).length, blank: cards.filter((c) => !c.ops?.length).length, money: sold.reduce((a, s) => a + s.total, 0), issued, used, left: issued - used };
}

/** Annule une vente : rend les points d'un paiement par carte, retire ceux d'une recharge. */
export function cancelSale(t, id) {
  const x = (t.sales || []).find((y) => y.id === id);
  if (!x || x.cancelled) return x;
  x.cancelled = true;
  const card = x.card && findCard(t, x.card);
  if (card && x.method === 'points') { card.balance += x.pts || 0; card.ops.push({ at: new Date().toISOString(), delta: x.pts || 0, label: 'Vente annulée' }); }
  if (card && x.kind === 'topup') { card.balance -= x.points || 0; card.ops.push({ at: new Date().toISOString(), delta: -(x.points || 0), label: 'Recharge annulée' }); }
  return x;
}
