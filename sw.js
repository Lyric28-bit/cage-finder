// Offline support: everything (including the OCR model) is cached on first load.
// Bump VERSION whenever you deploy changes, so phones pick up the new files.
const VERSION = 'v1';
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
  'js/scan.js',
  'data/cages.json',
  'data/adelaide-suburbs.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/eng.traineddata.gz',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
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
