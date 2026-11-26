// Service worker : l'application est gardée sur le téléphone (et sur le Mac) et fonctionne hors ligne.
// Chaque fichier a son empreinte (FILES) : à la publication d'une nouvelle version, seuls les fichiers
// modifiés sont retéléchargés ; les autres sont repris de la version précédente gardée sur l'appareil.
// FILES et VERSION sont recalculés par « npm run version » (et vérifiés par « npm test »).
const VERSION = 'c3a5cd816878';
const FILES = {
  'index.html': '2efcc1858650',
  'css/app.css': '1a27d556e7c4',
  'fonts/barlow-condensed-latin-600-normal.woff2': '215a93c696f4',
  'fonts/barlow-condensed-latin-700-normal.woff2': '3787a5a41917',
  'fonts/barlow-condensed-latin-800-normal.woff2': '2515494e8cc2',
  'fonts/barlow-latin-400-normal.woff2': 'b0a8ad37ac45',
  'fonts/barlow-latin-500-normal.woff2': 'cd759df8ef9e',
  'fonts/barlow-latin-600-normal.woff2': '4b52ddd4836b',
  'icons/icon-192.png': '754c32c719a8',
  'icons/icon.svg': '89d636a3e898',
  'js/app.js': 'f0d96c3e7e1b',
  'js/club.js': '5620d79aebf3',
  'js/demo.js': '4c0d3d9cabb5',
  'js/engine.js': 'afeb79c6eb3c',
  'js/money.js': '4818602828ef',
  'js/rules.js': '9bb1eb2c5a18',
  'js/sound.js': '21389018569b',
  'js/store.js': '93c2327ab36c',
  'js/time.js': '429429d4c429',
  'js/ui.js': 'b9d4c518e5d6',
  'js/views/admin.js': 'be98d9abdd61',
  'js/views/bar.js': '4d40316ecbc9',
  'js/views/components.js': '161cba6fe57c',
  'js/views/home.js': 'd3e0dc7f3daa',
  'js/views/live.js': 'd3ae7558f3c5',
  'js/views/portal.js': '0c77e648f059',
  'js/views/print.js': '5b8818a77557',
  'js/views/promo.js': 'fdb717c50929',
  'js/views/settings.js': '857d7557b89c',
  'js/views/sheet.js': '7a53e6e54083',
  'js/views/shell.js': '1f14506f7e44',
  'js/views/wizard.js': 'e8ebd6ec4469',
  'manifest.webmanifest': '0544cfabe050',
  'sounds/trompe.mp3': '99090544c988',
  'vendor/qrcode.mjs': 'ea91d7118a53',
};
const CACHE = `rotation-${VERSION}`;
const key = (f) => `${f}?v=${FILES[f]}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(Object.keys(FILES).map(async (f) => {
      const k = key(f);
      const kept = await caches.match(k); // déjà présent (version précédente) : rien à télécharger
      if (kept) return c.put(k, kept);
      const res = await fetch(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${f} : ${res.status}`);
      await c.put(k, res);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('rotation-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const scope = new URL(self.registration.scope);
const fileOf = (url) => { const f = url.pathname.slice(scope.pathname.length); return f in FILES ? f : null; };

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Logos et sons du tournoi : contenu fixe pour une adresse donnée → cache d'abord
  if (url.pathname.includes('/api/media/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  // Données du tournoi : toujours le serveur (c'est store.js qui gère les coupures)
  if (url.pathname.includes('/api/')) return;

  // Page de l'application (#/…) : la copie gardée sur le téléphone, instantanément
  if (e.request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`)) {
    e.respondWith(caches.match(key('index.html')).then((hit) => hit || fetch(e.request)));
    return;
  }
  // Code, styles, polices, son : la copie de cette version, sans requête réseau
  const f = fileOf(url);
  if (f) {
    e.respondWith(caches.match(key(f)).then((hit) => hit || fetch(e.request)));
    return;
  }
  // Le reste (page de promotion /p/…, images de l'affiche…) : réseau d'abord, copie locale si la 4G ne répond pas
  e.respondWith((async () => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    });
    net.catch(() => {});
    const slow = new Promise((ok) => setTimeout(ok, 4000)).then(() => caches.match(e.request));
    try { return (await Promise.race([net, slow])) || (await net); }
    catch { return (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match(key('index.html')) : Response.error()); }
  })());
});
