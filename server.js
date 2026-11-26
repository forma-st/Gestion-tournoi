#!/usr/bin/env node
// Serveur Tournoi — zéro dépendance. Sert la PWA, stocke les tournois en JSON,
// diffuse les mises à jour en direct (SSE). Fonctionne sans Internet sur un réseau local.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pickStorage } from './storage.js';
import { charityTotals, issueCard, cardSale, findCard, blankCards, cancelSale } from './public/js/money.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
// Hébergement Vercel : fonctions sans état, pas de connexion permanente (les pages se rafraîchissent toutes seules)
const IS_VERCEL = !!process.env.VERCEL;
// Mode en ligne : adresse publique fixe (hébergement) ou tunnel depuis l'ordinateur du gymnase
const TAILSCALE = process.argv.includes('--tailscale') || process.env.TUNNEL === 'tailscale';
const TUNNEL = TAILSCALE || process.argv.includes('--tunnel') || process.env.TUNNEL === '1';
let publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ONLINE = () => IS_VERCEL || TUNNEL || !!publicUrl;
// Clé organisateur : protège la création de tournois quand l'application est accessible depuis Internet
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim() || (TUNNEL || process.env.PUBLIC_URL ? crypto.randomBytes(3).toString('hex').toUpperCase() : '');
// Derrière un tunnel ou un hébergeur, l'adresse réelle du visiteur est dans les en-têtes
const TRUST_PROXY = IS_VERCEL || TUNNEL || process.env.TRUST_PROXY === '1';

const storage = pickStorage(DATA);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };

// ------------------------------------------------------------------ stockage
const load = (id) => storage.get(id);

// Médias (logos des partenaires, son de fin de temps) : stockés à part et servis avec un cache long.
// Le tournoi ne garde que leur adresse : il reste léger (≈ 25 Ko) et se recharge vite à chaque point marqué.
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
async function stashMedia(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
  if (dataUrl.length > 1_500_000 || !DATA_URL.test(dataUrl)) throw Object.assign(new Error('Fichier trop lourd ou illisible'), { code: 413 });
  const hash = crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 32);
  await storage.putMedia(hash, dataUrl);
  return `api/media/${hash}`;
}
/** Remplace les médias intégrés (data URL) par leur adresse. Renvoie true si le tournoi a changé. */
async function extractMedia(t) {
  let changed = false;
  for (const sp of Array.isArray(t.sponsors) ? t.sponsors : []) {
    if (typeof sp?.logo === 'string' && sp.logo.startsWith('data:')) { sp.logo = await stashMedia(sp.logo); changed = true; }
  }
  if (typeof t.sound?.data === 'string' && t.sound.data.startsWith('data:')) { t.sound.data = await stashMedia(t.sound.data); changed = true; }
  return changed;
}

const cleanSets = (a) => (Array.isArray(a) ? a : []).slice(0, 7).map((x) => [Math.max(0, Math.min(999, +x?.[0] || 0)), Math.max(0, Math.min(999, +x?.[1] || 0))]);
/**
 * Deux téléphones comptent le même match : chacun envoie ses sets et la version de départ (base).
 * Si quelqu'un a marqué entre-temps, on additionne les écarts au lieu d'écraser : aucun point perdu.
 */
export function mergeSets(cur, base, mine) {
  if (!base) return mine;
  if (JSON.stringify(cur) === JSON.stringify(base)) return mine;
  const n = Math.max(cur.length, mine.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = cur[i] || [0, 0], b = base[i] || [0, 0], m = mine[i] || b;
    out.push([Math.max(0, Math.min(999, c[0] + m[0] - b[0])), Math.max(0, Math.min(999, c[1] + m[1] - b[1]))]);
  }
  return out;
}

/** Conflit d'écriture (deux appareils en même temps) : la requête est rejouée sur la version à jour. */
class Conflict extends Error {}

async function save(t) {
  const prev = t.version || 0;
  t.version = prev + 1;
  t.updatedAt = new Date().toISOString();
  if (!(await storage.put(t, prev))) { t.version = prev; throw new Conflict('Conflit d’écriture'); }
  broadcast({ type: 'update', id: t.id, version: t.version });
  return t;
}

async function listAll() {
  return (await storage.list()).map(summary).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
}

const summary = (t) => ({ id: t.id, name: t.name, date: t.date, venue: t.venue, theme: t.theme, teams: t.teams.filter((x) => x.status === 'confirmed').length, maxTeams: t.registration?.maxTeams, courts: t.courts.length, format: t.format?.type, version: t.version, fee: t.registration?.fee || 0, open: !!t.registration?.open && !t.archived, archived: !!t.archived, archivedAt: t.archivedAt || null });

/** Vue publique : sans code admin, jetons ni coordonnées. */
function publicView(t) {
  return {
    ...t,
    adminPin: undefined,
    volunteerPin: undefined,
    courts: t.courts.map((c) => ({ ...c, token: undefined })),
    matches: t.matches.map((m) => ({ ...m, token: undefined, ops: undefined })),
    messages: undefined,
    players: (t.players || []).map((p) => ({ id: p.id, name: p.name.split(' ')[0] })),
    buvettePin: undefined,
    sales: undefined,
    cards: undefined,
    cashFund: undefined,
    buvette: (t.buvette || []).map((p) => ({ id: p.id, name: p.name, price: p.price, points: p.points, category: p.category, active: p.active, soldOut: p.stock != null && p.stock !== '' && (+p.stock - (t.sales || []).filter((x) => !x.cancelled).reduce((a, x) => a + x.items.filter((i) => i.pid === p.id).reduce((b, i) => b + i.qty, 0), 0)) <= 0 })),
    charity: t.charity ? { ...t.charity, donations: (t.charity.donations || []).filter((d) => d.validated).map((d) => ({ id: d.id, name: d.anonymous ? 'Anonyme' : d.name, amount: d.amount, message: d.message, at: d.at, validated: true })) } : t.charity,
    _charity: t.charity?.enabled ? charityTotals(t) : null,
    teams: t.teams.map((x) => ({ id: x.id, name: x.name, status: x.status, color: x.color, players: x.players, captain: x.captain ? x.captain.split(' ')[0] : '', checkedIn: x.checkedIn, seed: x.seed })),
  };
}

/** Organisateur du tournoi : son code à 4 chiffres, ou la clé organisateur générale (ADMIN_KEY) qui ouvre tous les tournois. */
const isMasterKey = (v) => !!ADMIN_KEY && !!v && String(v).length <= 80 && safeEq(String(v).trim().toUpperCase(), ADMIN_KEY.toUpperCase());
const isAdmin = (req, t) => {
  const pin = req.headers['x-admin-pin'];
  if (pin && pin.length <= 64 && safeEq(String(pin), String(t.adminPin))) return true;
  return isMasterKey(req.headers['x-admin-key']) || isMasterKey(pin);
};
function safeEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ temps réel (SSE)
const clients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ------------------------------------------------------------------ utilitaires HTTP
function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string';
  let out = json ? JSON.stringify(body) : body;
  const h = { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers };
  // Compression : le tournoi (JSON) passe de ≈ 25 Ko à ≈ 4 Ko, sur la 4G des joueurs ça compte
  if (res.gzipOk && out.length > 1024) { out = zlib.gzipSync(out, { level: 5 }); h['content-encoding'] = 'gzip'; h.vary = 'accept-encoding'; }
  res.writeHead(code, h);
  res.end(out);
}

async function readBody(req, limit = 2_000_000) {
  if (req._body !== undefined) return structuredClone(req._body); // requête rejouée après un conflit
  if (IS_VERCEL && req.body !== undefined) { // Vercel a déjà lu le corps de la requête
    const b = req.body;
    try { req._body = typeof b === 'string' ? JSON.parse(b || '{}') : Buffer.isBuffer(b) ? JSON.parse(b.toString('utf8') || '{}') : (b ?? {}); } catch { throw Object.assign(new Error('JSON invalide'), { code: 400 }); }
    return structuredClone(req._body);
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Corps trop volumineux'), { code: 413 }); chunks.push(c); }
  try { req._body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON invalide'), { code: 400 }); }
  return structuredClone(req._body);
}

const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

const isLoopback = (a) => /^(::1|127\.|::ffff:127\.)/.test(a || '');
function clientIp(req) {
  if (TRUST_PROXY || isLoopback(req.socket.remoteAddress)) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}
/** Requête faite depuis l'ordinateur qui fait tourner le serveur (et pas relayée par le tunnel). */
const isLocalRequest = (req) => !IS_VERCEL && isLoopback(req.socket?.remoteAddress)
  && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['tailscale-funnel-request']
  && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || ''); // relayé par un tunnel : l'adresse est publique

const rateBucket = new Map();
setInterval(() => { const now = Date.now(); for (const [k, b] of rateBucket) if (now - b.t > 120000) rateBucket.delete(k); }, 60000).unref();
function rateLimited(req, key, max = 30, windowMs = 60000) {
  const ip = clientIp(req);
  // Adresse inconnue (relais sans en-tête) : tous les téléphones auraient la même → limite très large
  if (!ip || isLoopback(ip)) max *= 20;
  const k = `${key}|${ip}`;
  const now = Date.now();
  const b = rateBucket.get(k) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; rateBucket.set(k, b);
  return b.n > max;
}

/** Clé organisateur (création de tournois) : null si elle est bonne ou inutile, sinon l'erreur à renvoyer. */
function checkKey(req) {
  if (!ADMIN_KEY || isLocalRequest(req)) return null;
  const given = String(req.headers['x-admin-key'] || '').trim().toUpperCase();
  if (given && safeEq(given, ADMIN_KEY.toUpperCase())) return null;
  if (rateLimited(req, 'key', 10)) return { status: 429, body: { error: 'Trop d’essais, patientez une minute' } };
  return given
    ? { status: 401, body: { error: 'Clé organisateur incorrecte', code: 'admin_key_wrong' } }
    : { status: 401, body: { error: 'Clé organisateur requise pour créer un tournoi', code: 'admin_key' } };
}

const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);

// ------------------------------------------------------------------ API
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sans "api"
  const method = req.method;

  if (parts[0] === 'ping') return send(res, 200, { ok: true, server: true, lan: lanIps(), port: PORT, time: Date.now(), publicUrl, online: ONLINE(), realtime: !IS_VERCEL, hosted: IS_VERCEL, keyRequired: IS_VERCEL || (!!ADMIN_KEY && !isLocalRequest(req)) });

  if (parts[0] === 'events' && IS_VERCEL) return send(res, 204, '');
  if (parts[0] === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Vérifier la clé organisateur sans rien créer (l'application la contrôle dès la saisie)
  if (parts[0] === 'key' && method === 'POST') {
    if (IS_VERCEL && !ADMIN_KEY) return send(res, 503, { error: 'Ajoutez la variable ADMIN_KEY dans les réglages du projet Vercel, puis redéployez.' });
    const keyErr = checkKey(req);
    return keyErr ? send(res, keyErr.status, keyErr.body) : send(res, 200, { ok: true });
  }

  if (parts[0] === 'tournaments' && method === 'GET') return send(res, 200, await listAll());

  // Médias (logos, sons) : contenu fixe pour une adresse donnée → cache d'un an dans les navigateurs
  if (parts[0] === 'media' && parts[1] && method === 'GET') {
    const d = await storage.getMedia(parts[1]);
    const m = d && DATA_URL.exec(d);
    if (!m) return send(res, 404, { error: 'Média introuvable' });
    const buf = Buffer.from(m[2], 'base64');
    res.writeHead(200, { 'content-type': m[1], 'content-length': buf.length, 'cache-control': 'public, max-age=31536000, immutable' });
    return res.end(buf);
  }

  if (parts[0] === 'tournaments' && method === 'POST') {
    if (IS_VERCEL && !ADMIN_KEY) return send(res, 503, { error: 'Ajoutez la variable ADMIN_KEY dans les réglages du projet Vercel pour pouvoir créer des tournois.' });
    const keyErr = checkKey(req);
    if (keyErr) return send(res, keyErr.status, keyErr.body);
    const t = await readBody(req);
    if (!t.id || !/^[a-z0-9_-]{3,40}$/i.test(t.id)) return send(res, 400, { error: 'Identifiant invalide' });
    if (await load(t.id)) return send(res, 409, { error: 'Ce tournoi existe déjà' });
    await extractMedia(t);
    t.version = 0;
    await save(t);
    return send(res, 201, t);
  }

  if (parts[0] !== 't' || !parts[1]) return send(res, 404, { error: 'Introuvable' });
  // Version seule : les pages hébergées sur Vercel la consultent toutes les quelques secondes
  if (parts[2] === 'v' && method === 'GET') return send(res, 200, { version: await storage.version(parts[1]) });
  let t = await load(parts[1]);
  if (!t) return send(res, 404, { error: 'Tournoi introuvable' });
  // Ancien tournoi avec logos ou son intégrés : on les range à part une fois pour toutes
  if (method === 'GET' && (t.sound?.data?.startsWith?.('data:') || (t.sponsors || []).some((x) => x?.logo?.startsWith?.('data:')))) {
    const copy = structuredClone(t);
    if (await extractMedia(copy)) { try { t = await save(copy); } catch { /* conflit : ce sera fait à la prochaine lecture */ } }
  }
  const action = parts[2];

  if (!action && method === 'GET') return send(res, 200, isAdmin(req, t) ? t : publicView(t));

  if (!action && method === 'PUT') {
    if (!isAdmin(req, t)) return send(res, 401, { error: 'Code organisateur incorrect' });
    const body = await readBody(req, 5_000_000);
    if (body.baseVersion !== t.version) return send(res, 409, { error: 'Version périmée', current: t });
    const next = { ...body.doc, id: t.id, version: t.version };
    if (!next.adminPin) next.adminPin = t.adminPin;
    await extractMedia(next);
    return send(res, 200, await save(next));
  }

  if (!action && method === 'DELETE') {
    if (!isAdmin(req, t)) return send(res, 401, { error: 'Code organisateur incorrect' });
    await storage.remove(t.id);
    broadcast({ type: 'deleted', id: t.id });
    return send(res, 200, { ok: true });
  }

  if (action === 'auth' && method === 'POST') {
    if (rateLimited(req, 'auth', 10)) return send(res, 429, { error: 'Trop d’essais, patientez une minute' });
    return isAdmin(req, t) ? send(res, 200, t) : send(res, 401, { error: 'Code organisateur incorrect' });
  }

  // Portail : connexion d'une équipe ou d'un bénévole par code PIN
  if (action === 'pin' && method === 'POST') {
    if (rateLimited(req, 'pin', 20)) return send(res, 429, { error: 'Trop d’essais, patientez une minute' });
    const b = await readBody(req, 2000);
    const pin = String(b.pin || '');
    if (pin && t.volunteerPin && safeEq(pin, String(t.volunteerPin))) return send(res, 200, { role: 'volunteer' });
    const team = pin && t.teams.find((x) => x.pin && safeEq(pin, String(x.pin)));
    if (team) return send(res, 200, { role: 'team', teamId: team.id, name: team.name });
    return send(res, 401, { error: 'Code inconnu' });
  }

  // Message d'une équipe à l'organisation
  if (action === 'message' && method === 'POST') {
    if (rateLimited(req, 'message', 10)) return send(res, 429, { error: 'Trop de messages, patientez une minute' });
    const b = await readBody(req, 5000);
    const text = str(b.text, 500);
    if (!text) return send(res, 400, { error: 'Message vide' });
    t.messages ??= [];
    t.messages.push({ id: crypto.randomBytes(4).toString('hex'), from: str(b.from, 60) || 'Anonyme', text, at: new Date().toISOString(), read: false });
    t.messages = t.messages.slice(-200);
    await save(t);
    return send(res, 201, { ok: true });
  }

  // Cagnotte : un participant déclare un don (validé ensuite par l'organisation)
  if (action === 'donation' && method === 'POST') {
    if (rateLimited(req, 'donation', 10)) return send(res, 429, { error: 'Trop de demandes, patientez une minute' });
    if (!t.charity?.enabled) return send(res, 403, { error: 'Pas de cagnotte pour ce tournoi' });
    const b = await readBody(req, 5000);
    const amount = Math.round((+b.amount || 0) * 100) / 100;
    if (!(amount > 0 && amount <= 10000)) return send(res, 400, { error: 'Montant invalide' });
    t.charity.donations ??= [];
    t.charity.donations.push({ id: crypto.randomBytes(4).toString('hex'), name: str(b.name, 60) || 'Anonyme', anonymous: !!b.anonymous, amount, message: str(b.message, 140), method: ['online', 'cash', 'card', 'lydia'].includes(b.method) ? b.method : 'online', at: new Date().toISOString(), validated: false });
    await save(t);
    return send(res, 201, { ok: true });
  }

  // Carte à points : consultation par son détenteur (lien secret de la carte virtuelle)
  if (action === 'card' && method === 'GET' && parts[3]) {
    if (rateLimited(req, 'cardview', 120)) return send(res, 429, { error: 'Trop de requêtes' });
    const c = findCard(t, parts[3]);
    if (!c || !safeEq(String(url.searchParams.get('k') || ''), String(c.key))) return send(res, 404, { error: 'Carte introuvable' });
    return send(res, 200, { code: c.code, name: c.name, balance: c.balance, ops: (c.ops || []).slice(-15).reverse() });
  }

  const barOk = (req2, b) => {
    const pin = String(b.pin || '');
    return isAdmin(req2, t) || (pin && ((t.volunteerPin && safeEq(pin, String(t.volunteerPin))) || (t.buvettePin && safeEq(pin, String(t.buvettePin)))));
  };

  // Carte à points côté buvette : vendre / recharger, consulter, créer des cartes à imprimer
  if (action === 'card' && method === 'POST') {
    const b = await readBody(req, 10000);
    if (!barOk(req, b)) return send(res, 403, { error: 'Code buvette incorrect' });
    try {
      if (b.op === 'issue') { const c = issueCard(t, { code: b.code, price: b.price, points: b.points, method: b.method, name: str(b.name, 40), sid: str(b.sid, 40), at: b.at, by: str(b.by, 40) }); await save(t); return send(res, 201, { code: c.code, key: c.key, name: c.name, balance: c.balance }); }
      if (b.op === 'lookup') { const c = findCard(t, b.code); return c ? send(res, 200, { code: c.code, key: c.key, name: c.name, balance: c.balance }) : send(res, 404, { error: 'Carte inconnue : vérifiez le code' }); }
      if (b.op === 'blank') { if (!isAdmin(req, t)) return send(res, 403, { error: 'Réservé à l’organisation' }); blankCards(t, Math.min(200, +b.n || 30)); await save(t); return send(res, 201, { ok: true }); }
    } catch (e) { return send(res, e.code || 400, { error: e.message }); }
    return send(res, 400, { error: 'Opération inconnue' });
  }

  // Buvette : enregistrement d'une vente (code organisateur, bénévole ou buvette). Idempotent via sid.
  if (action === 'sale' && method === 'POST') {
    const b = await readBody(req, 20000);
    if (!barOk(req, b)) return send(res, 403, { error: 'Code buvette incorrect' });
    if (b.method === 'points') {
      try {
        const r = cardSale(t, { code: b.card, items: b.items, sid: str(b.sid, 40), at: b.at, by: str(b.by, 40) });
        if (!r.duplicate) await save(t);
        return send(res, 201, { ok: true, pts: r.pts, balance: r.card.balance, name: r.card.name, code: r.card.code });
      } catch (e) { return send(res, e.code || 400, { error: e.message, balance: e.balance }); }
    }
    t.sales ??= [];
    if (b.cancel) { cancelSale(t, b.cancel); await save(t); return send(res, 200, { ok: true }); }
    const sid = str(b.sid, 40) || crypto.randomBytes(6).toString('hex');
    if (t.sales.some((x) => x.id === sid)) return send(res, 200, { ok: true, duplicate: true });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((it) => {
      const p = (t.buvette || []).find((x) => x.id === it.pid);
      return p && +it.qty > 0 ? { pid: p.id, name: p.name, qty: Math.min(99, Math.floor(+it.qty)), price: +p.price || 0 } : null;
    }).filter(Boolean);
    if (!items.length) return send(res, 400, { error: 'Panier vide' });
    const total = Math.round(items.reduce((a, i) => a + i.qty * i.price, 0) * 100) / 100;
    t.sales.push({ id: sid, at: b.at && !isNaN(Date.parse(b.at)) ? b.at : new Date().toISOString(), items, total, method: ['cash', 'card', 'lydia', 'check', 'free'].includes(b.method) ? b.method : 'cash', by: str(b.by, 40) });
    await save(t);
    return send(res, 201, { ok: true, total });
  }

  // Feuille de match : saisie des scores par les joueurs (jeton de match ou de terrain)
  if (action === 'score' && method === 'POST') {
    if (rateLimited(req, 'score', 240)) return send(res, 429, { error: 'Trop de requêtes' });
    const b = await readBody(req, 50_000);
    const m = t.matches.find((x) => x.id === b.matchId);
    if (!m) return send(res, 404, { error: 'Match introuvable' });
    const court = t.courts.find((c) => c.id === m.courtId);
    const pin = b.pin ? String(b.pin) : '';
    const team = pin && t.teams.find((x) => x.pin && safeEq(pin, String(x.pin)));
    const ok = isAdmin(req, t)
      || (b.token && (safeEq(String(b.token), String(m.token)) || (court?.token && safeEq(String(b.token), String(court.token)))))
      || (pin && t.volunteerPin && safeEq(pin, String(t.volunteerPin)))
      || t.openScoring === true
      || (team && [m.referee, b.teamA, b.teamB, m.teamA, m.teamB].includes(team.id));
    if (!ok) return send(res, 403, { error: 'Lien de feuille de match invalide' });
    if (m.status === 'done' && m.validated && !isAdmin(req, t)) return send(res, 409, { error: 'Score déjà validé par l’organisation' });
    // Envoi rejoué (réseau coupé pendant la réponse) : déjà pris en compte, on ne compte pas deux fois
    const op = str(b.op, 40);
    if (op && (m.ops || []).includes(op)) return send(res, 200, { ok: true, duplicate: true, match: { ...m, token: undefined, ops: undefined }, version: t.version });
    if (Array.isArray(b.sets)) m.sets = Array.isArray(b.base) ? mergeSets(cleanSets(m.sets), cleanSets(b.base), cleanSets(b.sets)) : cleanSets(b.sets);
    if (op) m.ops = [...(m.ops || []), op].slice(-20);
    if (['live', 'done', 'scheduled'].includes(b.status)) m.status = b.status;
    if (b.status === 'live' && !m.startedAt) m.startedAt = new Date().toISOString();
    if (b.status === 'done') { m.finishedAt = new Date().toISOString(); m.validated = !t.scoreValidation || isAdmin(req, t); }
    if ('tieWinner' in b) m.tieWinner = ['A', 'B'].includes(b.tieWinner) ? b.tieWinner : null;
    if ('timer' in b && (isAdmin(req, t) || t.timerControl === 'players')) m.timer = b.timer && typeof b.timer === 'object' ? { running: !!b.timer.running, elapsed: +b.timer.elapsed || 0, since: +b.timer.since || 0 } : null;
    if (b.submittedBy) m.submittedBy = str(b.submittedBy, 80);
    if (b.signatures) m.signatures = { A: str(b.signatures.A, 60), B: str(b.signatures.B, 60) };
    if (b.comment != null) m.comment = str(b.comment, 300);
    await save(t);
    return send(res, 200, { ok: true, match: { ...m, token: undefined, ops: undefined }, version: t.version });
  }

  // Inscription en ligne
  if (action === 'register' && method === 'POST') {
    if (rateLimited(req, 'register', 10)) return send(res, 429, { error: 'Trop d’inscriptions depuis cet appareil, réessayez plus tard' });
    const r = t.registration || {};
    if (!r.open || t.archived) return send(res, 403, { error: 'Les inscriptions sont fermées' });
    if (r.deadline && new Date(r.deadline + 'T23:59:59') < new Date()) return send(res, 403, { error: 'La date limite d’inscription est passée' });
    const b = await readBody(req, 20_000);
    if (b.kind === 'player') {
      const pname = str(b.name, 60);
      if (!pname) return send(res, 400, { error: 'Indiquez votre nom' });
      t.players ??= [];
      if (t.players.some((p) => p.name.toLowerCase() === pname.toLowerCase())) return send(res, 409, { error: 'Vous êtes déjà inscrit(e)' });
      t.players.push({ id: crypto.randomBytes(4).toString('hex'), name: pname, level: Math.min(4, Math.max(1, +b.level || 2)), gender: ['F', 'H'].includes(b.gender) ? b.gender : '', contact: str(b.contact, 120), present: false, paid: false, source: 'online', createdAt: new Date().toISOString() });
      await save(t);
      return send(res, 201, { ok: true });
    }
    const name = str(b.name, 40);
    if (!name) return send(res, 400, { error: 'Indiquez un nom d’équipe' });
    if (t.teams.some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Ce nom d’équipe est déjà pris' });
    const confirmed = t.teams.filter((x) => x.status === 'confirmed').length;
    const full = r.maxTeams && confirmed >= r.maxTeams;
    const team = {
      id: crypto.randomBytes(4).toString('hex'), name,
      captain: str(b.captain, 60), email: str(b.email, 120), phone: str(b.phone, 30),
      players: (Array.isArray(b.players) ? b.players : []).map((p) => str(p, 60)).filter(Boolean).slice(0, 20),
      comment: str(b.comment, 300),
      status: full ? 'waitlist' : r.requireValidation ? 'pending' : 'confirmed',
      payment: (r.fee || 0) > 0 || (r.barCard?.enabled && b.barOption) ? 'unpaid' : 'free',
      barOption: !!(t.registration?.barCard?.enabled && b.barOption),
      checkedIn: false, source: 'online', level: Math.min(3, Math.max(1, +b.level || 2)), pin: String(1000 + crypto.randomInt(9000)), createdAt: new Date().toISOString(),
      ref: `${t.id.slice(0, 3).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    };
    t.teams.push(team);
    await save(t);
    return send(res, 201, { ok: true, team: { id: team.id, name: team.name, status: team.status, ref: team.ref, payment: team.payment, pin: team.pin, players: team.players, barOption: team.barOption } });
  }

  return send(res, 404, { error: 'Introuvable' });
}

// ------------------------------------------------------------------ fichiers statiques
const origin = (req) => publicUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  // Page promo partageable : /p/<id> → index.html avec balises Open Graph
  const promo = p.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
  if (promo || p === '/' || !path.extname(p)) {
    let html;
    try { html = await fsp.readFile(path.join(PUBLIC, 'index.html'), 'utf8'); }
    catch (e) {
      // Sur Vercel, la page est servie par le CDN : la fonction la récupère à la même adresse
      if (!IS_VERCEL) throw e;
      html = await (await fetch(`https://${req.headers['x-forwarded-host'] || req.headers.host}/index.html`)).text();
    }
    if (promo) {
      const t = await load(promo[1]);
      if (t) {
        const date = t.date ? new Date(t.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
        const desc = `${date}${t.venue ? ' · ' + t.venue : ''} — ${t.tagline || t.description || 'Inscrivez votre équipe !'}`;
        const og = `<title>${esc(t.name)}</title>
<meta property="og:title" content="${esc(t.name)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(`${origin(req)}${p}`)}">
<meta property="og:image" content="${esc(`${origin(req)}/icons/og.png`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="description" content="${esc(desc)}">`;
        html = html.replace(/<title>.*?<\/title>/, og);
      }
      html = html.replace('<head>', '<head>\n<base href="/">');
    }
    return send(res, 200, html, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
  }
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Interdit');
  let st;
  try { st = await fsp.stat(full); if (!st.isFile()) throw new Error(); } catch { return send(res, 404, 'Introuvable'); }
  const ext = path.extname(full);
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const head = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.woff2' || ext === '.mp3' ? 'public, max-age=31536000, immutable' : 'no-cache', etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
  const text = /^(text|application\/(json|manifest)|image\/svg)/.test(head['content-type']);
  if (text && res.gzipOk && st.size > 1024) {
    const key = `${full}|${etag}`;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(await fsp.readFile(full), { level: 9 }); gzCache.set(key, gz); }
    res.writeHead(200, { ...head, 'content-encoding': 'gzip', vary: 'accept-encoding', 'content-length': gz.length });
    return res.end(gz);
  }
  res.writeHead(200, { ...head, 'content-length': st.size });
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
}
const gzCache = new Map();

/** Point d'entrée commun : serveur Node (ordinateur) et fonction Vercel. */
export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  // Vercel peut transmettre l'adresse réécrite (/api/index?path=… ou ?id=…) : on retrouve l'adresse d'origine
  if (url.pathname === '/api/index' || url.pathname === '/api/index.js') {
    const p = url.searchParams.get('path'), id = url.searchParams.get('id');
    url.searchParams.delete('path'); url.searchParams.delete('id');
    url.pathname = p != null ? `/api/${p}` : id != null ? `/p/${id}` : '/api/';
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      for (let attempt = 0; ; attempt++) {
        try { return await api(req, res, url); }
        catch (e) { if (!(e instanceof Conflict) || attempt >= 6) throw e; await new Promise((r) => setTimeout(r, 20 + Math.random() * 60)); }
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return await serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof Conflict) return send(res, 503, { error: 'Serveur très sollicité, réessayez' });
    if (!res.headersSent) send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message || 'Erreur serveur' });
  }
}

// ------------------------------------------------------------------ tenue sur la durée (ordinateur du gymnase)
if (!IS_VERCEL) {
  // Une erreur imprévue ne doit jamais arrêter le serveur en pleine soirée : on la note et on continue
  process.on('uncaughtException', (e) => console.error(`  ⚠️  Erreur inattendue (le serveur continue) : ${e?.stack || e}`));
  process.on('unhandledRejection', (e) => console.error(`  ⚠️  Erreur inattendue (le serveur continue) : ${e?.stack || e}`));
}

/**
 * Sauvegardes automatiques (stockage fichiers) : toutes les 2 minutes, une copie de chaque tournoi modifié
 * dans data/sauvegardes/<tournoi>/ (les 60 dernières sont gardées, soit 2 heures au moins).
 */
const BACKUP_DIR = path.join(DATA, 'sauvegardes');
const backedUp = new Map();
async function backupAll() {
  if (storage.kind !== 'file') return;
  for (const t of await storage.list()) {
    if (backedUp.get(t.id) === t.version) continue;
    const dir = path.join(BACKUP_DIR, t.id.replace(/[^a-z0-9_-]/gi, ''));
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    await fsp.writeFile(path.join(dir, `${stamp}-v${t.version}.json`), JSON.stringify(t));
    backedUp.set(t.id, t.version);
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, -60)) await fsp.rm(path.join(dir, f), { force: true });
  }
}

/** Le Mac ne se met pas en veille tant que le serveur tourne (écran compris, pour le grand écran). */
function keepAwake() {
  if (process.platform !== 'darwin' || process.env.NO_CAFFEINATE) return;
  try {
    const c = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' });
    c.on('error', () => {});
    c.unref();
    console.log('  ☕ Mise en veille du Mac désactivée tant que le serveur tourne.');
  } catch { /* facultatif */ }
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n  ⏹  Arrêt : enregistrement des données…');
  try { await storage.flush?.(); await backupAll(); } catch (e) { console.error(e); }
  for (const c of children) { try { c.kill(); } catch { /* */ } }
  process.exit(0);
}
const children = new Set();

if (!IS_VERCEL) http.createServer(handle).listen(PORT, HOST, () => {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  keepAwake();
  setInterval(() => backupAll().catch((e) => console.error('  ⚠️  Sauvegarde impossible :', e.message)), 120000).unref();
  const ips = lanIps();
  console.log('\n  🏐  Rotation : serveur prêt\n');
  console.log(`  Sur cet ordinateur : http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Même Wi-Fi ou même partage de connexion seulement : http://${ip}:${PORT}`);
  if (!TUNNEL && !publicUrl) console.log(`\n  ℹ️  Les téléphones en 4G ne peuvent PAS joindre ces adresses. Pour eux, lancez avec Tailscale ou Cloudflare\n     (double-clic sur lancer-tournoi.command, ou « npm run en-ligne:tailscale » / « npm run en-ligne »).`);
  if (publicUrl) console.log(`\n  🌍 Adresse publique : ${publicUrl}`);
  if (TUNNEL) startTunnel();
  if (ADMIN_KEY) console.log(`\n  🔑 Clé organisateur (pour créer un tournoi depuis un autre appareil) : ${ADMIN_KEY}`);
  console.log(`\n  Données : ${storage.kind === 'redis' ? 'base Redis (Upstash)' : DATA}`);
  if (storage.kind === 'file') console.log(`  Sauvegardes automatiques (toutes les 2 min) : ${BACKUP_DIR}`);
  console.log('\n  Laissez cette fenêtre ouverte pendant tout le tournoi. Ctrl+C pour arrêter.\n');
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ⚠️  Le port ${PORT} est déjà utilisé : le serveur tourne sans doute déjà dans une autre fenêtre.\n`);
  else console.error(e);
  process.exit(1);
});

/**
 * Tunnel Cloudflare : rend le serveur accessible depuis Internet (4G des joueurs) sans configurer de box.
 * - sans compte : adresse https://xxxx.trycloudflare.com, nouvelle à chaque lancement ;
 * - avec TUNNEL_TOKEN (tunnel nommé) et PUBLIC_URL : adresse fixe, QR codes imprimables à l'avance.
 */
function startTunnel() {
  if (TAILSCALE) return startTailscale();
  return startCloudflare();
}

/** Adresse publique connue : on l'annonce clairement (c'est celle des téléphones en 4G). */
function announcePublic(fixed) {
  console.log(`\n  ✅ ADRESSE POUR TOUS LES TÉLÉPHONES (4G comprise) : ${publicUrl}
     Testez-la depuis un téléphone en 4G, Wi-Fi coupé. Les QR codes l'utilisent${fixed ? ' : vous pouvez les imprimer à l\'avance' : ' (elle change à chaque lancement : imprimez les QR après le démarrage)'}.
     Sur ce Mac, ouvrez plutôt http://localhost:${PORT} (admin, grand écran) : ça continue même si Internet coupe.\n`);
}

function startCloudflare() {
  const bin = process.env.CLOUDFLARED || findBin('cloudflared', CLOUDFLARED_PLACES) || 'cloudflared';
  const args = process.env.TUNNEL_TOKEN
    ? ['tunnel', '--no-autoupdate', 'run', '--token', process.env.TUNNEL_TOKEN]
    : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`];
  console.log('  ⏳ Ouverture du tunnel Cloudflare…');
  let child;
  try { child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return tunnelMissing(); }
  children.add(child);
  let missing = false;
  child.on('error', () => { missing = true; tunnelMissing(); });
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !process.env.PUBLIC_URL && publicUrl !== m[0]) {
      publicUrl = m[0];
      announcePublic(false);
      broadcast({ type: 'net' });
    }
    if (/Registered tunnel connection/i.test(String(buf)) && process.env.TUNNEL_TOKEN) console.log(`  🌍 Tunnel connecté : ${publicUrl || '(définissez PUBLIC_URL)'}`);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping || missing) return;
    // Coupure Internet, mise en veille… : on relance le tunnel tout seul
    console.log(`  ⚠️  Le tunnel s'est arrêté (code ${code}). Nouvel essai dans 5 secondes…${process.env.TUNNEL_TOKEN ? '' : ' (adresse rapide : elle va changer, préférez Tailscale pour des QR fixes)'}`);
    setTimeout(startCloudflare, 5000);
  });
}

/**
 * Tailscale Funnel : adresse publique https fixe (https://ordinateur.nom-du-tailnet.ts.net),
 * donc des QR codes imprimables à l'avance. Il faut avoir activé Funnel une fois dans la console Tailscale.
 */
/** Trouve un programme : dans le PATH, ou aux emplacements habituels sur Mac (application, Homebrew). */
function findBin(name, extra = []) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return extra.find((f) => fs.existsSync(f)) || null;
}
const TAILSCALE_PLACES = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];
const CLOUDFLARED_PLACES = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'];

let tsFails = 0;
function startTailscale() {
  const bin = process.env.TAILSCALE || findBin('tailscale', TAILSCALE_PLACES);
  if (!bin) {
    // Pas de Tailscale : si cloudflared est installé, on bascule dessus plutôt que de rester injoignable
    if (findBin('cloudflared', CLOUDFLARED_PLACES)) { console.log('  ⚠️  Tailscale introuvable : bascule sur le tunnel Cloudflare.'); return startCloudflare(); }
    return tailscaleMissing();
  }
  console.log('  ⏳ Ouverture de Tailscale Funnel…');
  const startedAt = Date.now();
  const said = []; // ce que Tailscale a répondu (pour expliquer un refus)
  let child;
  try { child = spawn(bin, ['funnel', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return tailscaleMissing(); }
  children.add(child);
  let missing = false;
  child.on('error', () => { missing = true; tailscaleMissing(); });
  // Sans adresse au bout de 25 s : on explique les causes habituelles et l'adresse attendue
  const watchdog = setTimeout(() => {
    if (publicUrl) return;
    let dns = '';
    try {
      const st = spawn(bin, ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = ''; st.stdout.on('data', (c) => { out += c; });
      st.on('exit', () => {
        try { dns = (JSON.parse(out).Self?.DNSName || '').replace(/\.$/, ''); } catch { /* */ }
        console.log(`\n  ⚠️  Tailscale Funnel ne donne pas encore d'adresse publique. Vérifiez :
     1. l'application Tailscale est ouverte et connectée (icône dans la barre des menus) ;
     2. dans la console Tailscale (login.tailscale.com) : DNS → MagicDNS et HTTPS activés ;
     3. Funnel est autorisé pour ce Mac (Access controls : attribut « funnel ») — suivez le lien affiché ci-dessus s'il y en a un ;
     4. la première fois, l'adresse peut mettre jusqu'à 10 minutes à fonctionner.${dns ? `\n     Adresse attendue : https://${dns}` : ''}
     En attendant, le plan B sans compte : ./lancer-tournoi.command cloudflare\n`);
      });
    } catch { /* */ }
  }, 25000);
  const onData = (buf) => {
    const txt = String(buf);
    // on affiche ce que dit Tailscale (liens d'activation, erreurs) pour pouvoir agir
    for (const line of txt.split('\n').map((l) => l.trim()).filter(Boolean)) {
      said.push(line);
      if (!/^(Available on the internet|Press Ctrl\+C|\|--)/i.test(line)) console.log(`     [tailscale] ${line}`);
    }
    const m = txt.match(/https:\/\/[a-z0-9.-]+\.ts\.net/i);
    if (m && !process.env.PUBLIC_URL && publicUrl !== m[0]) {
      publicUrl = m[0];
      clearTimeout(watchdog);
      announcePublic(true);
      broadcast({ type: 'net' });
    }
    if (/funnel is not enabled|not allowed|access denied|requires|enable/i.test(txt)) console.log('     → Activez Funnel pour ce Mac (lien ci-dessus, ou console Tailscale → Access controls), puis relancez.');
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    children.delete(child);
    clearTimeout(watchdog);
    if (stopping || missing) return;
    // Refus immédiat et répété : c'est un réglage, pas une coupure réseau → inutile d'insister
    tsFails = Date.now() - startedAt < 20000 ? tsFails + 1 : 0;
    if (tsFails >= 3) {
      console.log(`\n  ❌ Tailscale refuse d'ouvrir l'adresse publique (Funnel).${said.length ? `\n     Message de Tailscale :\n${said.slice(-8).map((l) => `       ${l}`).join('\n')}` : ''}
     Causes habituelles :
       • Funnel n'est pas autorisé pour ce Mac : ouvrez le lien affiché par Tailscale, ou dans la console
         Tailscale (login.tailscale.com) → Access controls, ajoutez l'attribut « funnel » ;
       • HTTPS n'est pas activé : console Tailscale → DNS → MagicDNS et « HTTPS Certificates » ;
       • l'application Tailscale n'est pas connectée (icône dans la barre des menus).
     Pour voir l'erreur en direct : ouvrez le Terminal et tapez  ${bin.includes(' ') ? `"${bin}"` : bin} funnel ${PORT}`);
      if (findBin('cloudflared', CLOUDFLARED_PLACES)) { console.log('\n  ↪️  En attendant : bascule automatique sur le tunnel Cloudflare.\n'); return startCloudflare(); }
      console.log(`\n  ↪️  Plan B sans compte : dans le Terminal, « brew install cloudflared », puis relancez avec : ./lancer-tournoi.command cloudflare\n     (le serveur continue de fonctionner sur ce Mac : http://localhost:${PORT})\n`);
      return;
    }
    console.log(`  ⚠️  Tailscale Funnel s'est arrêté (code ${code}). Nouvel essai dans 5 secondes…`);
    setTimeout(startTailscale, 5000);
  });
}

function tailscaleMissing() {
  console.log(`
  ⚠️  Tailscale est introuvable sur ce Mac : les téléphones en 4G ne peuvent pas joindre le serveur.
     • Installez l'application Tailscale (tailscale.com/download), connectez-vous, puis relancez ;
     • ou, plan B sans compte : brew install cloudflared, puis ./lancer-tournoi.command cloudflare
`);
}

function tunnelMissing() {
  console.log(`
  ⚠️  cloudflared n'est pas installé : le serveur marche, mais seulement sur cet ordinateur et le réseau local.
     Installez-le une fois (gratuit) puis relancez « npm run en-ligne » :
       • Windows : winget install --id Cloudflare.cloudflared
       • Mac     : brew install cloudflared
       • Linux   : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
`);
}
