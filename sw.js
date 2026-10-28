// Offline support: everything is cached on first load.
// Bump VERSION whenever you deploy changes, so phones pick up the new files.
const VERSION = 'v32';
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
  'js/map.js',
  'js/lines.js',
  'js/offline-map.js',
  'js/share.js',
  'data/cages.json',
  'data/adelaide-suburbs.json',
  'data/estimated.json',
  'data/postcodes.json',
  'data/unsure.json',
  'data/suburb-points.json',
  'data/region-loops.json',
  'lib/leaflet/leaflet.js',
  'lib/leaflet/leaflet.css',
  'lib/pmtiles/pmtiles.js',
  'lib/protomaps-leaflet/protomaps-leaflet.js',
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

// Map tiles: cached only as they're viewed (OSM's tile policy forbids bulk
// prefetching). Separate cache, not 'cage-finder-*', so activate keeps it.
const TILES = 'cage-tiles';
const TILE_MAX = 3000;

// The tile is returned straight away; caching happens after, and a full
// storage never blanks a tile that loaded fine. Oldest-cached go first.
async function tileResponse(event) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  let response;
  try {
    response = await fetch(event.request);
  } catch {
    return Response.error();
  }
  if (response.ok) event.waitUntil(storeTile(cache, event.request, response.clone()));
  return response;
}

async function storeTile(cache, request, response) {
  try {
    await cache.put(request, response);
    const keys = await cache.keys();
    if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, 500).map(k => cache.delete(k)));
  } catch {
    // Storage full or blocked: the tile still showed, it just isn't kept.
  }
}

// Cache first; fall back to the network, and to the app shell for page loads.
// The offline map (map/*.pmtiles) isn't listed above: it's downloaded by the page
// into its own 'cage-map' cache, which activate never deletes.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).hostname === 'tile.openstreetmap.org') {
    event.respondWith(tileResponse(event));
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request).catch(() => {
      if (event.request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    })));
});
