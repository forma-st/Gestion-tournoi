// Argent du tournoi : inscriptions, buvette, cagnotte solidaire (Téléthon…).
// Module pur, partagé par le navigateur et les tests.

export const PAY_METHODS = {
  cash: 'Espèces',
  card: 'Carte',
  lydia: 'Lydia / Wero',
  check: 'Chèque',
  free: 'Offert (bénévoles)',
};

/** Montant dû par une équipe (au forfait ou par joueur, avec un minimum). */
export function teamDue(t, team) {
  const r = t.registration || {};
  const fee = +r.fee || 0;
  if (!fee) return 0;
  if (r.feeMode === 'player') return fee * Math.max(team.present?.length || team.players?.length || 0, +r.minPlayers || 1);
  return fee;
}

export function feesSummary(t) {
  const conf = t.teams.filter((x) => x.status === 'confirmed');
  let due = 0, paid = 0, extra = 0;
  for (const x of conf) {
    const d = teamDue(t, x);
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
    for (const it of s.items) {
      const p = productById(t, it.pid);
      const line = it.qty * it.price;
      byProduct[it.pid] ??= { qty: 0, revenue: 0, name: p?.name || it.name || '?' };
      byProduct[it.pid].qty += it.qty;
      cost += it.qty * productCost(t, p);
      count += it.qty;
      if (s.method === 'free') { offered += line; continue; }
      byProduct[it.pid].revenue += line;
      revenue += line;
    }
    byMethod[s.method] = (byMethod[s.method] || 0) + (s.method === 'free' ? 0 : s.total);
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

export function charityTotals(t) {
  const c = t.charity || {};
  const donations = (c.donations || []).filter((d) => d.validated);
  const don = donations.reduce((a, d) => a + (+d.amount || 0), 0);
  const fees = c.includeFees ? feesSummary(t).paid + feesSummary(t).extra : 0;
  const b = buvetteStats(t);
  const bar = c.includeBuvette ? (c.buvetteMode === 'revenue' ? b.revenue : b.margin) : 0;
  const pts = pointsScored(t);
  const pledge = (+c.pointPledge || 0) * pts;
  const capped = c.pledgeCap ? Math.min(pledge, +c.pledgeCap) : pledge;
  const total = (+c.raised || 0) + don + fees + bar + capped;
  const goal = +c.goal || 0;
  const miles = (c.milestones || []).filter((m) => m.amount).sort((a, b) => a.amount - b.amount);
  return {
    total, goal, base: +c.raised || 0, don, fees, bar, pledge: capped, points: pts,
    pct: goal ? Math.min(100, (100 * total) / goal) : 0,
    reached: miles.filter((m) => total >= m.amount),
    next: miles.find((m) => total < m.amount) || null,
    pending: (c.donations || []).filter((d) => !d.validated && !d.rejected).length,
    feed: donations.slice().sort((x, y) => (y.at || '').localeCompare(x.at || '')).slice(0, 8),
  };
}
