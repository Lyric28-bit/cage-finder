// Offline support: everything is cached on first load.
// Bump VERSION whenever you deploy changes, so phones pick up the new files.
const VERSION = 'v18';
const CACHE = 'cage-finder-' + VERSION;

const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'js/match.js',
  'js/store.js',
  'js/manage.js',
  'js/photos.js',
  'data/cages.json',
  'data/adelaide-suburbs.json',
  'data/estimated.json',
  'data/postcodes.json',
  'data/unsure.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// No skipWaiting: a new version takes over only once the app is fully closed,
// so an open app never mixes old and new files. cache: 'reload' bypasses the
// browser's HTTP cache so a new VERSION really downloads fresh files.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

// The app's "Tap to update" button sends this.
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('cage-finder-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Cache first; fall back to the network, and to the app shell for page loads.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request).catch(() => {
      if (event.request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    })));
});
