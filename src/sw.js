// Service worker : l'app s'ouvre hors ligne. Rien de Spotify n'est jamais mis en cache.
const VERSION = 'pc-__VERSION__';
const FICHIERS = __FICHIERS__;
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
