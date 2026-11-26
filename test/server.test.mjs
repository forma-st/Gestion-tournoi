// Tests d'intégration : un vrai serveur sur un port libre, avec un dossier de données temporaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildDemo } from '../public/js/demo.js';
import { buildSchedule } from '../public/js/engine.js';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-test-'));
let srv;

before(async () => {
  srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, HOST: '127.0.0.1', NO_CAFFEINATE: '1', ADMIN_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`${B}/api/ping`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('serveur injoignable');
});
after(async () => { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5 }); });

const j = (r) => r.json();
async function create(id) {
  const t = buildSchedule(buildDemo('multisport'));
  t.id = id;
  t.sponsors = [{ name: 'Logo', logo: 'data:image/png;base64,' + Buffer.from('fausse image').toString('base64') }];
  const r = await fetch(`${B}/api/tournaments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t) });
  assert.equal(r.status, 201);
  return t;
}
const score = (id, body) => fetch(`${B}/api/t/${id}/score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);

test('médias rangés à part : le tournoi ne contient que leur adresse, servie avec un cache long', async () => {
  const t = await create('media-test');
  const doc = await j(await fetch(`${B}/api/t/${t.id}`));
  assert.match(doc.sponsors[0].logo, /^api\/media\/[0-9a-f]{32}$/);
  const r = await fetch(`${B}/${doc.sponsors[0].logo}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /immutable/);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'fausse image');
});

test('réponses compressées quand le navigateur l’accepte', async () => {
  await create('gzip-test');
  const r = await new Promise((ok) => import('node:http').then((http) => http.get(`${B}/api/t/gzip-test`, { headers: { 'accept-encoding': 'gzip' } }, ok)));
  assert.equal(r.headers['content-encoding'], 'gzip');
  const chunks = []; for await (const c of r) chunks.push(c);
  const doc = JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString());
  assert.equal(doc.id, 'gzip-test');
});

test('deux téléphones comptent le même match : les points des deux sont gardés', async () => {
  const t = await create('merge-test');
  const m = t.matches.find((x) => x.slot === 0);
  const token = m.token;
  // les deux partent de 0-0 ; l'un marque 3 points pour A, l'autre 2 pour B, en même temps
  const [a, b] = await Promise.all([
    score(t.id, { matchId: m.id, token, base: [[0, 0]], sets: [[3, 0]], status: 'live', op: 'a1' }),
    score(t.id, { matchId: m.id, token, base: [[0, 0]], sets: [[0, 2]], status: 'live', op: 'b1' }),
  ]);
  assert.ok(a.ok && b.ok);
  const doc = await j(await fetch(`${B}/api/t/${t.id}`));
  assert.deepEqual(doc.matches.find((x) => x.id === m.id).sets, [[3, 2]]);
});

test('un envoi rejoué (réponse perdue) ne compte pas deux fois', async () => {
  const t = await create('dup-test');
  const m = t.matches.find((x) => x.slot === 0);
  const body = { matchId: m.id, token: m.token, base: [[0, 0]], sets: [[1, 0]], status: 'live', op: 'x1' };
  await score(t.id, body);
  const again = await score(t.id, body);
  assert.equal(again.duplicate, true);
  const doc = await j(await fetch(`${B}/api/t/${t.id}`));
  assert.deepEqual(doc.matches.find((x) => x.id === m.id).sets, [[1, 0]]);
  assert.equal(doc.matches.find((x) => x.id === m.id).ops, undefined, 'les identifiants d’envoi ne sont pas publiés');
});

test('rafale de 60 points sur 3 terrains en parallèle : aucun point perdu', async () => {
  const t = await create('burst-test');
  const ms = t.matches.filter((x) => x.slot === 0);
  const local = Object.fromEntries(ms.map((m) => [m.id, { base: [[0, 0]], sets: [[0, 0]] }]));
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    for (const m of ms) {
      const l = local[m.id];
      // comme le téléphone : chaque envoi part de ce qu'il a envoyé juste avant (sans attendre la réponse)
      l.sets = [[l.sets[0][0] + 1, l.sets[0][1]]];
      const body = { matchId: m.id, token: m.token, base: l.base, sets: l.sets, status: 'live', op: `${m.id}-${i}` };
      l.base = l.sets;
      jobs.push(score(t.id, body));
    }
  }
  const res = await Promise.all(jobs);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res.find((r) => !r.ok)));
  const doc = await j(await fetch(`${B}/api/t/${t.id}`));
  for (const m of ms) assert.equal(doc.matches.find((x) => x.id === m.id).sets[0][0], 20);
});

test('sauvegarde : la version publique ne contient ni codes ni jetons', async () => {
  const t = await create('public-test');
  const doc = await j(await fetch(`${B}/api/t/${t.id}`));
  assert.equal(doc.adminPin, undefined);
  assert.ok(doc.matches.every((m) => m.token === undefined));
});
