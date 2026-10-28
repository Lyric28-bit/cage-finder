// Offline Adelaide map: one vector tile file (PMTiles) kept in the Cache API from
// the page, so the service worker's app cache never touches it.

export const MAP_FILE = 'map/adelaide-20261028.pmtiles';
export const MAP_MB = 17.5;
const CACHE = 'cage-map';

export function cacheSupported() {
  return !!window.caches;
}

// 'ready' = this extract is saved, 'old' = only an older one, 'none' = nothing.
export async function mapStatus() {
  if (!cacheSupported()) return 'none';
  try {
    const cache = await caches.open(CACHE);
    if (await cache.match(MAP_FILE)) return 'ready';
    return (await cache.keys()).length ? 'old' : 'none';
  } catch {
    return 'none';
  }
}

// The current file, else any older one, else null.
export async function cachedMapBlob() {
  try {
    const cache = await caches.open(CACHE);
    let hit = await cache.match(MAP_FILE);
    if (!hit) {
      const [first] = await cache.keys();
      if (first) hit = await cache.match(first);
    }
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

// Which base map is wanted when both are available: 'online' (OSM, the default) or 'offline'.
const PREF_KEY = 'cage-map-base';

export function getBasePref() {
  try {
    return localStorage.getItem(PREF_KEY) === 'offline' ? 'offline' : 'online';
  } catch {
    return 'online';
  }
}

export function setBasePref(v) {
  try {
    localStorage.setItem(PREF_KEY, v === 'offline' ? 'offline' : 'online');
  } catch {
    // Storage blocked: the choice just lasts until the app closes.
  }
}

// Download messages, shared by the map and the menu.
export function downloadMessage(reason) {
  if (reason === 'server') return 'Download failed (server). Try again later.';
  if (reason === 'storage') return 'Not enough storage on this device for the offline map.';
  return 'Download failed. Check wifi and try again.';
}

export function progressText(received, total) {
  if (!received) return 'Downloading map…';
  if (!total || received > total) return `Downloading map… ${(received / 1048576).toFixed(1)} MB`;
  return `Downloading map… ${Math.min(99, Math.floor(received / total * 100))}%`;
}

let downloading = null;
const listeners = new Set();

// fn gets { state: 'progress', received, total } and { state: 'done', ok, reason }.
// Returns an unsubscribe function.
export function onMapDownload(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of [...listeners]) {
    try { fn(event); } catch (err) { console.warn(err); }
  }
}

export function isDownloading() {
  return !!downloading;
}

// One download at a time; a second call gets the same promise. Resolves { ok, reason }.
export function downloadMap() {
  if (!downloading) {
    downloading = fetchMap().then(result => {
      downloading = null;
      if (result.ok) Promise.resolve(navigator.storage?.persist?.()).catch(() => {}); // ask the browser not to evict the map
      emit({ state: 'done', ...result });
      return result;
    });
    emit({ state: 'progress', received: 0, total: 0 });
  }
  return downloading;
}

// Never throws. reason: 'offline' (no network), 'server' (bad status), 'storage' (couldn't save).
async function fetchMap() {
  let res;
  try {
    res = await fetch(MAP_FILE, { cache: 'no-store' });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (!res.ok || !res.body) return { ok: false, reason: 'server' };
  const total = Number(res.headers.get('Content-Length')) || 0;
  let received = 0;
  let netFail = false;
  // Count bytes on their way into the cache, so the file is never held in memory.
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      controller.enqueue(chunk);
      emit({ state: 'progress', received, total });
    },
  });
  res.body.pipeTo(counter.writable).catch(() => { netFail = true; });
  try {
    const cache = await caches.open(CACHE);
    await cache.put(MAP_FILE, new Response(counter.readable, { headers: { 'Content-Type': 'application/octet-stream' } }));
    for (const key of await cache.keys()) {
      if (new URL(key.url).pathname !== new URL(MAP_FILE, location.href).pathname) await cache.delete(key);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: netFail ? 'offline' : 'storage' };
  }
}

// Removes the saved map, so a broken file can be downloaded again.
export async function deleteMap() {
  try {
    await caches.delete(CACHE);
  } catch {
    // Nothing to delete.
  }
}

let libsP = null; // cached promise, so each script loads once

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(src));
    document.head.append(s);
  });
}

export function loadVectorLibs() {
  if (window.pmtiles && window.protomapsL) return Promise.resolve();
  libsP ||= loadScript('lib/pmtiles/pmtiles.js')
    .then(() => loadScript('lib/protomaps-leaflet/protomaps-leaflet.js'))
    .catch(err => { libsP = null; throw err; });
  return libsP;
}
