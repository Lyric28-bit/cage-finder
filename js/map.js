// Street map (Leaflet + OpenStreetMap tiles) with suburb search. Leaflet and the
// suburb points load on first open, so the app itself stays light.

import { normalise, editDistance } from './match.js';

const $ = id => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

let leafletP = null; // cached promises, so each file loads once
let pointsP = null;
let map = null;
let pin = null;
let points = []; // { name, key, code, lat, lng }
let byKey = new Map();
let loopsP = null;
let loops = new Map(); // cage key -> { points: [[lat, lng], ...], within: km or null }, traced from the region-map photo
let lines = null; // layer group for the cage lines
let linesBox = null; // the "Cage lines" toggle + key (whole-city view only)
let allLines = false; // toggle state, kept while the app is open
let focusCage = null; // the cage the map was opened from, if any
let keyOpen = true; // the colour key under "Hide cage lines" is unfolded

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletP ||= new Promise((resolve, reject) => {
    const s = el('script', { src: 'lib/leaflet/leaflet.js' });
    s.onload = resolve;
    s.onerror = () => { leafletP = null; reject(new Error('leaflet')); };
    document.head.append(s);
  });
  return leafletP;
}

function loadPoints() {
  pointsP ||= fetch('data/suburb-points.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => {
      points = j.suburbs.map(([name, code, lat, lng]) => ({ name, key: normalise(name), code, lat, lng }));
      byKey = new Map(points.map(p => [p.key, p]));
    })
    .catch(err => { pointsP = null; throw err; });
  return pointsP;
}

// The region-map loops are a nice-to-have: if they fail to load the map still works.
function loadLoops() {
  loopsP ||= fetch('data/region-loops.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { loops = new Map(j.loops.map(l => [normalise(l.cage), { points: l.points, within: l.within }])); })
    .catch(() => { loopsP = null; });
  return loopsP;
}

function showError(msg) {
  $('map-error').textContent = msg || '';
  $('map-error').hidden = !msg;
}

function makeMap() {
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
  const pad = 0.3;
  const bounds = L.latLngBounds(
    [Math.min(...lats) - pad, Math.min(...lngs) - pad],
    [Math.max(...lats) + pad, Math.max(...lngs) + pad]);
  map = L.map($('map-canvas'), { minZoom: 9, maxBounds: bounds, maxBoundsViscosity: 1 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  lines = L.layerGroup().addTo(map);
  const LinesControl = L.Control.extend({
    onAdd() {
      linesBox = el('div', { className: 'map-lines leaflet-bar' });
      L.DomEvent.disableClickPropagation(linesBox);
      return linesBox;
    },
  });
  new LinesControl({ position: 'topright' }).addTo(map);
}

function cageColor(app, cageName) {
  const key = normalise(cageName);
  return app.data.cages.find(c => normalise(c.name) === key)?.color || '#888888';
}

// Faint dashed outline of a cage's region-map loop, in the cage's colour.
function drawLoop(app, cageName) {
  const loop = loops.get(normalise(cageName));
  if (!loop) return null;
  const color = cageColor(app, cageName);
  return L.polygon(loop.points, { color, weight: 3, opacity: 0.85, dashArray: '8 6', fillColor: color, fillOpacity: 0.07, interactive: false })
    .addTo(lines);
}

// "Cage lines" button, and a colour key while all the lines are on.
function renderLinesBox(app) {
  const btn = el('button', { type: 'button', className: 'map-lines-btn', textContent: allLines ? 'Hide cage lines' : 'Cage lines' });
  btn.setAttribute('aria-pressed', String(allLines));
  btn.addEventListener('click', () => { allLines = !allLines; showAllLines(app); });
  const head = el('div', { className: 'map-lines-head' }, btn);
  // Folds the key away so it doesn't cover the map; the lines stay.
  if (allLines) {
    const fold = el('button', { type: 'button', className: 'map-lines-fold', textContent: keyOpen ? '–' : 'Key' });
    fold.setAttribute('aria-expanded', String(keyOpen));
    fold.setAttribute('aria-label', keyOpen ? 'Hide the key' : 'Show the key');
    fold.addEventListener('click', () => { keyOpen = !keyOpen; renderLinesBox(app); });
    head.append(fold);
  }
  const key = el('ul', { className: 'map-lines-key' });
  if (allLines && keyOpen) {
    for (const cage of app.data.cages) {
      const loop = loops.get(normalise(cage.name));
      if (!loop) continue;
      const dot = el('span', { className: 'map-lines-dot' });
      dot.style.background = cage.color;
      const near = el('span', { className: 'map-lines-near', textContent: loop.within ? `±${loop.within} km` : '± ?' });
      key.append(el('li', {}, dot, cage.name, near));
    }
    if (key.childElementCount) key.append(el('li', { className: 'map-lines-note', textContent: '± = how far a line may be off the drawn map' }));
  }
  linesBox.replaceChildren(head, ...(key.childElementCount ? [key] : []));
  linesBox.hidden = !loops.size;
}

// Toggle off: just the cage the map was opened from (none on the whole city).
function showAllLines(app) {
  lines.clearLayers();
  if (allLines) for (const cage of app.data.cages) drawLoop(app, cage.name);
  else if (focusCage) drawLoop(app, focusCage);
  renderLinesBox(app);
}

function clearPin() {
  if (pin) { pin.remove(); pin = null; }
}

function pinSuburb(p, zoom = 14) {
  clearPin();
  pin = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#D81B60', fillOpacity: 1 })
    .bindTooltip(document.createTextNode(`${p.name} ${p.code}`), { permanent: true, direction: 'top', offset: [0, -8] })
    .addTo(map);
  map.setView([p.lat, p.lng], zoom);
}

function fitPoints(list) {
  const use = list.length ? list : points;
  map.fitBounds(use.map(p => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 14 });
}

// Points for a cage: its live suburbs plus the region map's suburbs.
function cagePoints(app, cageName) {
  const key = normalise(cageName);
  const cage = app.data.cages.find(c => normalise(c.name) === key);
  const names = [...(cage?.suburbs || [])];
  for (const a of app.mapArea(cageName) || []) for (const s of a.suburbs) names.push(s.name);
  const seen = new Set();
  for (const n of names) {
    const p = byKey.get(normalise(n));
    if (p) seen.add(p);
  }
  return [...seen];
}

// Prefix matches first, then word-start, then contains, then close spellings.
function findSuburbs(query, limit = 8) {
  const q = normalise(query);
  if (!q) return [];
  const prefix = [], word = [], inside = [];
  for (const p of points) {
    if (p.key.startsWith(q)) prefix.push(p);
    else if (p.name.toLowerCase().split(/[^a-z']+/).some(w => normalise(w).startsWith(q))) word.push(p);
    else if (p.key.includes(q)) inside.push(p);
  }
  let out = [...prefix, ...word, ...inside];
  if (!out.length && q.length >= 4) {
    out = points
      .map(p => ({ p, d: editDistance(q, p.key) }))
      .filter(x => x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .map(x => x.p);
  }
  return out.slice(0, limit);
}

function renderResults(list) {
  $('map-results').replaceChildren(...list.map(p => {
    const btn = el('button', { type: 'button', textContent: `${p.name} · ${p.code}` });
    btn.addEventListener('click', () => choose(p));
    return el('li', {}, btn);
  }));
}

function choose(p) {
  renderResults([]);
  $('map-search').blur(); // closes the phone keyboard
  pinSuburb(p);
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  const input = $('map-search');
  input.addEventListener('input', () => renderResults(findSuburbs(input.value)));
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = findSuburbs(input.value, 1)[0];
    if (first) choose(first);
  });
  $('btn-map-close').addEventListener('click', () => $('dlg-map').close());
}

// opts: {} = whole city; { cage } = that cage's area; { suburb } = pin it
// (falls back to the cage view if the suburb has no point).
export async function openMap(app, { suburb, cage } = {}) {
  wire();
  const dlg = $('dlg-map');
  $('map-search').value = '';
  renderResults([]);
  showError('');
  $('map-title').textContent = cage || 'Map';
  if (!dlg.open) dlg.showModal();
  try {
    await Promise.all([loadLeaflet(), loadPoints(), loadLoops()]);
  } catch {
    showError("Map couldn't load. Check your connection.");
    return;
  }
  if (!map) makeMap();
  map.invalidateSize();
  clearPin();
  focusCage = cage || null;
  const loop = cage && loops.get(normalise(cage));
  const p = suburb && byKey.get(normalise(suburb));
  if (p) pinSuburb(p);
  else if (loop) map.fitBounds(L.latLngBounds(loop.points), { padding: [20, 20] });
  else if (cage) fitPoints(cagePoints(app, cage));
  else fitPoints(points);
  showAllLines(app);
}
