#!/usr/bin/env node
// Test de charge : simule une soirée de tournoi sur un serveur, puis vérifie qu'aucun point n'a été perdu.
//   node test/charge.mjs                       → lance son propre serveur (dossier temporaire)
//   node test/charge.mjs --url https://…       → vise un serveur existant (crée un tournoi « charge-… »)
// Options : --cle CLÉ (serveur protégé) --spectateurs 40  --terrains 3  --arbitres 2  --duree 60 (s)  --rythme 1.5 (s entre deux points par arbitre)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { buildDemo } from '../public/js/demo.js';
import { buildSchedule } from '../public/js/engine.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const VIEWERS = +arg('spectateurs', 40), COURTS = +arg('terrains', 3), REFS = +arg('arbitres', 2);
const DURATION = +arg('duree', 60) * 1000, PACE = +arg('rythme', 1.5) * 1000;
let BASE = arg('url', '');
const KEY = arg('cle', ''); // clé organisateur (création du tournoi de test sur un serveur protégé)
let srv, dataDir;

const stats = { req: 0, err: 0, bytes: 0, score: [], doc: [], errors: {}, cdn: {} };
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const agentHttp = new http.Agent({ keepAlive: true, maxSockets: 512 });
const agentHttps = new https.Agent({ keepAlive: true, maxSockets: 512 });

// Derrière un proxy (variable HTTPS_PROXY), Node ne le gère que pour fetch : on passe alors par fetch
const VIA_FETCH = () => !!(process.env.HTTPS_PROXY || process.env.https_proxy) && BASE.startsWith('https:');
const countCdn = (method, u, vc) => {
  // hébergement Vercel : part des réponses servies par le cache du CDN (sans appeler le serveur)
  if (vc && method === 'GET') { const k = /\/v$/.test(u.pathname) ? 'version' : /\/pub\//.test(u.pathname) ? 'tournoi' : 'autre'; (stats.cdn[k] ||= { HIT: 0, autre: 0 })[vc === 'HIT' ? 'HIT' : 'autre']++; }
};

async function requestFetch(method, u, body, headers, timeout) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { method, headers: { ...(KEY ? { 'x-admin-key': KEY } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    const txt = await r.text();
    stats.req++; stats.bytes += +(r.headers.get('content-length') || 0) || Math.round(txt.length / 6); // compressé : estimation si la taille n'est pas donnée
    countCdn(method, u, r.headers.get('x-vercel-cache'));
    let json = null; try { json = JSON.parse(txt); } catch { /* */ }
    if (r.status >= 400) { stats.err++; stats.errors[r.status] = (stats.errors[r.status] || 0) + 1; }
    return { status: r.status, json, ms: Date.now() - t0 };
  } catch (e) {
    stats.req++; stats.err++; stats.errors[e.message] = (stats.errors[e.message] || 0) + 1;
    return { status: 0, ms: Date.now() - t0 };
  }
}

/** Requête HTTP brute (pour mesurer les octets réellement transférés, compressés). */
function request(method, p, body, { timeout = 15000, headers = {} } = {}) {
  const u = new URL(p, BASE);
  if (VIA_FETCH()) return requestFetch(method, u, body, headers, timeout);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(u, { method, agent: u.protocol === 'https:' ? agentHttps : agentHttp, timeout, headers: { 'accept-encoding': 'gzip', ...(KEY ? { 'x-admin-key': KEY } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        stats.req++; stats.bytes += raw.length;
        countCdn(method, u, res.headers['x-vercel-cache']);
        let txt = raw;
        try { if (res.headers['content-encoding'] === 'gzip') txt = zlib.gunzipSync(raw); } catch { /* */ }
        let json = null; try { json = JSON.parse(txt.toString()); } catch { /* */ }
        if (res.statusCode >= 400) { stats.err++; stats.errors[res.statusCode] = (stats.errors[res.statusCode] || 0) + 1; }
        resolve({ status: res.statusCode, json, ms: Date.now() - t0 });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { stats.req++; stats.err++; stats.errors[e.message] = (stats.errors[e.message] || 0) + 1; resolve({ status: 0, ms: Date.now() - t0 }); });
    if (data) req.write(data);
    req.end();
  });
}

/** Spectateur (téléphone sur le portail, grand écran) : connexion en direct, relit le tournoi à chaque nouvelle (au plus toutes les 0,7 s). */
function viewer(id, stopAt) {
  if (VIA_FETCH()) return pollViewer(id, stopAt);
  return new Promise((resolve) => {
    const u = new URL('api/events', BASE);
    const lib = u.protocol === 'https:' ? https : http;
    let pending = false, busy = false, last = 0, timer = null;
    const refresh = async () => {
      if (busy) { pending = true; return; }
      busy = true; last = Date.now();
      const r = await request('GET', `api/t/${id}`);
      if (r.status === 200) stats.doc.push(r.ms);
      busy = false;
      if (pending) { pending = false; schedule(); }
    };
    const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, Math.max(0, 700 - (Date.now() - last))); };
    const req = lib.get(u, { agent: false }, (res) => {
      if (res.statusCode === 204) { // hébergement sans connexion permanente : on interroge la version
        // comme un téléphone : on interroge la version, puis on relit cette version précise (mise en cache par le CDN)
        let seen = null;
        const iv = setInterval(async () => {
          const r = await request('GET', `api/t/${id}/v`);
          const v = r.json?.version;
          if (v != null && v !== seen) { seen = v; const d = await request('GET', `api/t/${id}/pub/${v}`); if (d.status === 200) stats.doc.push(d.ms); }
        }, 3000);
        setTimeout(() => { clearInterval(iv); resolve(); }, stopAt - Date.now());
        return;
      }
      res.on('data', (c) => { if (String(c).includes(id)) schedule(); });
      res.on('error', () => {});
    });
    req.on('error', () => {});
    refresh();
    setTimeout(() => { req.destroy(); clearTimeout(timer); resolve(); }, stopAt - Date.now());
  });
}

/** Spectateur sur un hébergement sans connexion permanente (Vercel) : version toutes les 3 s, puis cette version précise. */
async function pollViewer(id, stopAt) {
  let seen = null;
  await new Promise((r) => setTimeout(r, Math.random() * 3000)); // les téléphones ne sont pas synchronisés
  while (Date.now() < stopAt) {
    const r = await request('GET', `api/t/${id}/v`);
    const v = r.json?.version;
    if (v != null && v !== seen) { seen = v; const d = await request('GET', `api/t/${id}/pub/${v}`); if (d.status === 200) stats.doc.push(d.ms); }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** Arbitre : marque des points au hasard, envoie comme le téléphone (base → sets, identifiant d'envoi, un envoi à la fois). */
async function referee(id, m, stopAt, counts, who) {
  let sent = [[0, 0]], sets = [[0, 0]], n = 0;
  while (Date.now() < stopAt) {
    await new Promise((r) => setTimeout(r, PACE * (0.5 + Math.random())));
    const side = Math.random() < 0.5 ? 0 : 1;
    sets = [[sets[0][0] + (side === 0), sets[0][1] + (side === 1)]];
    counts[m.id][side]++;
    const body = { matchId: m.id, token: m.token, base: sent, sets, status: 'live', op: `${who}-${n++}` };
    sent = sets;
    // envoi rejoué jusqu'à ce qu'il passe (comme la file d'attente du téléphone)
    for (let k = 0; k < 6; k++) {
      const r = await request('POST', `api/t/${id}/score`, body);
      if (r.status === 200) { stats.score.push(r.ms); break; }
      if (r.status && r.status < 500) { counts[m.id][side]--; break; }
      await new Promise((res) => setTimeout(res, 300 * (k + 1)));
    }
  }
}

/** Organisatrice : modifie le tournoi de temps en temps (annonce), avec rejeu en cas de conflit. */
async function organizer(id, pin, stopAt) {
  while (Date.now() < stopAt) {
    await new Promise((r) => setTimeout(r, 4000));
    for (let k = 0; k < 5; k++) {
      const cur = await request('GET', `api/t/${id}`, null, { headers: { 'x-admin-pin': pin } });
      const doc = cur.json; if (!doc) break;
      doc.announcements = [...(doc.announcements || []), { id: String(Date.now()), text: 'Annonce de test', at: new Date().toISOString() }].slice(-5);
      const r = (await request('PUT', `api/t/${id}`, { baseVersion: doc.version, doc }, { headers: { 'x-admin-pin': pin } })).status;
      if (r === 409) { stats.err--; stats.errors[409]--; continue; } // conflit : on rejoue, ce n'est pas une erreur
      break;
    }
  }
}

async function main() {
  if (!BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-charge-'));
    const port = 19000 + Math.floor(Math.random() * 1000);
    BASE = `http://127.0.0.1:${port}/`;
    srv = spawn(process.execPath, ['server.js'], { cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'), env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, HOST: '127.0.0.1', NO_CAFFEINATE: '1', ADMIN_KEY: '' }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { const r = await request('GET', 'api/ping'); if (r.status === 200) break; await new Promise((r2) => setTimeout(r2, 100)); }
  }
  Object.assign(stats, { req: 0, err: 0, bytes: 0, score: [], doc: [], errors: {}, cdn: {} }); // le démarrage ne compte pas
  if (!BASE.endsWith('/')) BASE += '/';
  const t = buildSchedule(buildDemo('multisport'));
  t.id = `charge-${Date.now().toString(36)}`;
  const c = await request('POST', 'api/tournaments', t);
  if (c.status !== 201) throw new Error(`Création impossible (${c.status}) : ${JSON.stringify(c.json)} — avec --url, il faut la clé organisateur ou un serveur local.`);
  const ms = t.matches.filter((m) => m.slot === 0).slice(0, COURTS);
  const counts = Object.fromEntries(ms.map((m) => [m.id, [0, 0]]));
  console.log(`\n  Test de charge : ${VIEWERS} spectateurs, ${ms.length} terrains × ${REFS} arbitres, ${DURATION / 1000} s, un point toutes les ~${PACE / 1000} s par arbitre\n  Serveur : ${BASE}\n`);
  const stopAt = Date.now() + DURATION;
  const t0 = Date.now();
  await Promise.all([
    ...Array.from({ length: VIEWERS }, () => viewer(t.id, stopAt)),
    ...ms.flatMap((m) => Array.from({ length: REFS }, (_, k) => referee(t.id, m, stopAt, counts, `${m.id}-r${k}`))),
    organizer(t.id, t.adminPin, stopAt),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const final = (await request('GET', `api/t/${t.id}`)).json;
  const lost = ms.map((m) => {
    const got = final.matches.find((x) => x.id === m.id).sets[0];
    return { terrain: m.courtId, attendu: counts[m.id].join('-'), enregistré: got.join('-'), ok: got[0] === counts[m.id][0] && got[1] === counts[m.id][1] };
  });
  const secs = (Date.now() - t0) / 1000;
  console.log(`  Requêtes : ${stats.req} (${(stats.req / secs).toFixed(0)}/s) · erreurs : ${stats.err}${stats.err ? ' ' + JSON.stringify(stats.errors) : ''}`);
  console.log(`  Données transférées : ${(stats.bytes / 1e6).toFixed(1)} Mo (${(stats.bytes / 1e3 / Math.max(1, stats.doc.length)).toFixed(1)} Ko par relecture, compressé)`);
  console.log(`  Envoi d'un point : médiane ${pct(stats.score, 0.5)} ms · 95 % sous ${pct(stats.score, 0.95)} ms · max ${Math.max(0, ...stats.score)} ms (${stats.score.length} envois)`);
  console.log(`  Relecture du tournoi : médiane ${pct(stats.doc, 0.5)} ms · 95 % sous ${pct(stats.doc, 0.95)} ms (${stats.doc.length} relectures)`);
  console.log('  Scores :'); for (const l of lost) console.log(`    ${l.ok ? '✓' : '✗'} ${l.terrain} : attendu ${l.attendu}, enregistré ${l.enregistré}`);
  for (const [k, v] of Object.entries(stats.cdn)) console.log(`  Cache Vercel (${k}) : ${v.HIT} servies par le cache sur ${v.HIT + v.autre} (${Math.round((100 * v.HIT) / Math.max(1, v.HIT + v.autre))} %)`);
  // serveur existant : on supprime le tournoi de test
  if (!srv) {
    const d = (await request('DELETE', `api/t/${t.id}`, null, { headers: { 'x-admin-pin': t.adminPin } })).status;
    console.log(d === 200 ? '  Tournoi de test supprimé.' : `  ⚠️  Tournoi de test « ${t.id} » non supprimé (${d}) : supprimez-le depuis l'accueil.`);
  }
  const ok = lost.every((l) => l.ok);
  console.log(ok ? '\n  ✅ Aucun point perdu.\n' : '\n  ❌ Des points ont été perdus.\n');
  srv?.kill();
  if (dataDir) setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }), 300);
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error(e); srv?.kill(); process.exit(1); });
