#!/usr/bin/env node
// Recalcule les empreintes du service worker (public/sw.js) :
//   FILES   : l'empreinte de chaque fichier de l'application → seuls les fichiers modifiés sont retéléchargés ;
//   VERSION : l'empreinte de l'ensemble → déclenche la mise à jour sur les téléphones et le Mac.
//   node scripts/version.mjs          → met à jour sw.js si besoin
//   node scripts/version.mjs --check  → échoue si sw.js n'est pas à jour (utilisé par les tests)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SW = path.join(PUBLIC, 'sw.js');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

/** Fichiers gardés sur l'appareil : la page, le code, les styles, les polices, les icônes et le son. */
function appFiles() {
  const out = ['index.html', 'manifest.webmanifest'];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(PUBLIC, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|css|woff2|mp3|svg)$/.test(e.name) || rel === 'icons/icon-192.png') out.push(rel);
    }
  };
  for (const d of ['css', 'js', 'vendor', 'fonts', 'sounds', 'icons']) if (fs.existsSync(path.join(PUBLIC, d))) walk(d);
  return out.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
}

export function computeVersion() {
  const sw = fs.readFileSync(SW, 'utf8');
  const files = Object.fromEntries(appFiles().map((f) => [f, hash(fs.readFileSync(path.join(PUBLIC, f)))]));
  const block = `const FILES = {\n${Object.entries(files).map(([f, h]) => `  '${f}': '${h}',`).join('\n')}\n};`;
  // la logique du service worker compte aussi : un changement de stratégie de cache fait une nouvelle version
  const logic = sw.replace(/const VERSION = '[^']*';/, '').replace(/const FILES = \{[\s\S]*?\n\};/, '');
  const version = hash(logic + block);
  const next = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`).replace(/const FILES = \{[\s\S]*?\n\};/, block);
  return { version, current: (sw.match(/const VERSION = '([^']*)';/) || [])[1], upToDate: next === sw, next };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, current, upToDate, next } = computeVersion();
  if (process.argv.includes('--check')) {
    if (!upToDate) { console.error(`sw.js n'est pas à jour (${current} au lieu de ${version}) : lancez « npm run version ».`); process.exit(1); }
    console.log(`sw.js à jour (${version})`);
  } else if (!upToDate) {
    fs.writeFileSync(SW, next);
    console.log(`Nouvelle version de l'application : ${version}`);
  } else console.log(`Déjà à jour (${version})`);
}
