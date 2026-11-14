// Service worker : l'app s'ouvre hors ligne. Rien de Spotify n'est jamais mis en cache.
const VERSION = 'pc-34997c175d68';
const FICHIERS = ["./","./assets/barlow-condensed-latin-500-normal-BgYH2mbd.woff2","./assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2","./assets/barlow-condensed-latin-700-normal-v1xN8_Wq.woff2","./assets/index-ktjZZFI3.js","./assets/index-ttwtWf2l.css","./assets/source-serif-4-latin-400-italic-0j97Jm6B.woff2","./assets/source-serif-4-latin-400-normal-DJ5YJwmz.woff2","./assets/source-serif-4-latin-600-normal-DouSKlru.woff2","./icons/apple-touch-icon.png","./icons/icone-192.png","./icons/icone-512.png","./icons/icone-maskable-512.png","./icons/icone.svg","./index.html","./interets.json","./manifest.webmanifest"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return; // Spotify : réseau direct
  if (u.pathname.endsWith('/interets.json')) { // profil : réseau d'abord, cache en secours
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSION).then((k) => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (e.request.mode === 'navigate') { // retour de connexion (?code=…) compris
    e.respondWith(fetch(e.request).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
