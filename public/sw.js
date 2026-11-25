// Service worker : l'application fonctionne hors ligne une fois ouverte une première fois.
const CACHE = 'rotation-v10';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/engine.js', 'js/money.js', 'js/club.js', 'js/time.js', 'js/rules.js', 'js/views/bar.js', 'js/views/wizard.js', 'js/store.js', 'js/ui.js', 'js/demo.js', 'vendor/qrcode.mjs',
  'js/views/shell.js', 'js/views/home.js', 'js/views/settings.js', 'js/views/components.js', 'js/views/admin.js',
  'js/views/portal.js', 'js/views/live.js', 'js/views/sheet.js', 'js/views/promo.js', 'js/views/print.js',
  'fonts/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Réseau d'abord (pour avoir la dernière version), cache en secours
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
