// Stockage des tournois : fichiers JSON (ordinateur du gymnase) ou Redis Upstash (hébergement Vercel).
// put(t, prevVersion) n'écrit que si la version stockée est toujours prevVersion (sinon renvoie false) :
// deux téléphones qui enregistrent en même temps ne s'écrasent jamais.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const safeId = (id) => String(id).replace(/[^a-z0-9_-]/gi, '');

export function fileStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const cache = new Map();
  const writing = new Map();
  const file = (id) => path.join(dir, `${safeId(id)}.json`);
  const store = {
    kind: 'file',
    async get(id) {
      if (cache.has(id)) return cache.get(id);
      try { const t = JSON.parse(await fsp.readFile(file(id), 'utf8')); cache.set(id, t); return t; } catch { return null; }
    },
    async version(id) { return (await store.get(id))?.version ?? null; },
    async put(t, prev) {
      const cur = cache.get(t.id);
      if (cur && cur !== t && (cur.version || 0) !== prev) return false;
      cache.set(t.id, t);
      // écriture atomique, sérialisée par tournoi
      const p = (writing.get(t.id) || Promise.resolve()).then(async () => {
        const tmp = file(t.id) + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(t));
        await fsp.rename(tmp, file(t.id));
      }).catch((e) => console.error('Écriture impossible', e));
      writing.set(t.id, p);
      return true;
    },
    async list() {
      const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
      return (await Promise.all(files.map((f) => store.get(f.slice(0, -5))))).filter(Boolean);
    },
    async remove(id) { cache.delete(id); await fsp.rm(file(id), { force: true }); },
    // Médias (logos, sons) : rangés à part, adressés par leur empreinte → jamais renvoyés avec le tournoi
    async putMedia(hash, dataUrl) {
      const f = path.join(mediaDir, `${safeId(hash)}.txt`);
      if (fs.existsSync(f)) return;
      await fsp.writeFile(f + '.tmp', dataUrl);
      await fsp.rename(f + '.tmp', f);
    },
    async getMedia(hash) { try { return await fsp.readFile(path.join(mediaDir, `${safeId(hash)}.txt`), 'utf8'); } catch { return null; } },
    /** Attend la fin des écritures en cours (arrêt propre du serveur). */
    async flush() { await Promise.all([...writing.values()]); },
  };
  return store;
}

// Écriture conditionnelle atomique côté Redis
const CAS = `local v = redis.call('GET', KEYS[2]) or '0'
if v == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  redis.call('SADD', KEYS[3], ARGV[4])
  return 1
end
return 0`;

/** Redis via l'API REST d'Upstash (intégration « Upstash for Redis » de Vercel) : aucune dépendance. */
export function redisStorage({ url, token, prefix = 'rotation:' }) {
  const base = url.replace(/\/$/, '');
  // Délai maximal par requête ; les lectures sont retentées une fois (une écriture ne l'est jamais :
  // si la réponse se perd, c'est le client qui rejoue, et les saisies sont protégées contre les doublons).
  async function cmd(...args) {
    const read = ['GET', 'MGET', 'SMEMBERS'].includes(args[0]);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(base, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw Object.assign(new Error(`Base de données : ${j.error || r.status}`), { db: true });
        return j.result;
      } catch (e) {
        if (!read || attempt >= 1 || e.db) throw e;
        await new Promise((ok) => setTimeout(ok, 150));
      }
    }
  }
  const kDoc = (id) => `${prefix}t:${safeId(id)}`;
  const kVer = (id) => `${prefix}v:${safeId(id)}`;
  const kSet = `${prefix}tournaments`;
  return {
    kind: 'redis',
    async get(id) { const s = await cmd('GET', kDoc(id)); return s ? JSON.parse(s) : null; },
    async version(id) { const v = await cmd('GET', kVer(id)); return v == null ? null : +v; },
    async put(t, prev) { return (await cmd('EVAL', CAS, '3', kDoc(t.id), kVer(t.id), kSet, String(prev || 0), JSON.stringify(t), String(t.version), safeId(t.id))) === 1; },
    async list() {
      const ids = (await cmd('SMEMBERS', kSet)) || [];
      if (!ids.length) return [];
      const docs = await cmd('MGET', ...ids.map(kDoc));
      return docs.filter(Boolean).map((s) => JSON.parse(s));
    },
    async remove(id) { await cmd('DEL', kDoc(id), kVer(id)); await cmd('SREM', kSet, safeId(id)); },
    async putMedia(hash, dataUrl) { await cmd('SET', `${prefix}m:${safeId(hash)}`, dataUrl, 'NX'); },
    async getMedia(hash) { return cmd('GET', `${prefix}m:${safeId(hash)}`); },
    async flush() {},
  };
}

/** Choix automatique : Redis si les variables Upstash/Vercel KV sont présentes, sinon fichiers. */
export function pickStorage(dataDir) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStorage({ url, token });
  return fileStorage(dataDir);
}
