// Offline support: keep the app shell on the phone so it opens with no signal at the pitch.
// Team data is stored by the app itself and syncs with Supabase when there's a connection.
const CACHE = 'apt-v35';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/supabase.js', 'vendor/fonts.css', 'vendor/fonts/BricolageGrotesque.woff2', 'privacy.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return; // database calls always go to the network
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && (e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname))) {
    // app files: fresh copy when online, cached copy when not
    e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
    return;
  }
  // icons, fonts and bundled libraries: cached copy first
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
