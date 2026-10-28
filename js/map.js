// Street map (Leaflet) with suburb search. Uses the downloaded offline Adelaide
// map (vector tiles + our own suburb labels) when there is one, else OpenStreetMap
// tiles. Leaflet and the suburb points load on first open, so the app stays light.

import { normalise, editDistance } from './match.js';
import {
  MAP_MB, mapStatus, cachedMapBlob, downloadMap, loadVectorLibs, getBasePref, setBasePref,
  downloadMessage, progressText, onMapDownload, isDownloading, deleteMap, cacheSupported,
} from './offline-map.js';
import { NAME_MAX, loadLines, saveLines, findSet, cageParts, newSet, renameSet, deleteSet, builtinLoops } from './lines.js';

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
let loops = new Map(); // cage key -> { parts: [[[lat, lng], ...], ...], within: [km or null, ...] }, one part per region-map photo
let lines = null; // layer group for the cage lines
let linesBox = null; // the "Cage lines" toggle + key (whole-city view only)
let allLines = false; // toggle state, kept while the app is open
let focusCage = null; // the cage the map was opened from, if any
let keyOpen = true; // the colour key under "Hide cage lines" is unfolded
let lineState = null; // line sets (js/lines.js), loaded each time the map opens
let setsBox = null; // the line set panel
let panelOpen = false; // collapsed each time the map opens
let linesDlg = null; // what the small #dlg-lines is doing: { app, mode, edit }
let editing = null; // edit mode state, null when not editing
let osmLayer = null; // online fallback tiles
let vectorLayer = null; // the offline map, once made
let labels = null; // layer group of suburb names (offline map only)
let mapBox = null; // the offline map status control
let dl = null; // download progress text while downloading, else null
let dlEl = null; // the progress line in mapBox, updated in place
let dlPaint = 0; // when it was last updated (ms)
let dlFailed = null; // why the last download failed, else null
let buildP = null; // the vector layer being built, so it's only built once
let buildFailed = false; // a saved map exists but couldn't be loaded
let osmErrors = 0; // OSM tile errors this open
let autoFallback = false; // OSM kept failing this open, so the offline map is showing
let noMapErr = false; // the "no connection and no offline map" error is showing
const LABEL_ZOOM = 13;

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
    .then(j => {
      // A cage can have more than one region map (South Cartons has two): one entry per map.
      loops = new Map();
      for (const l of j.loops) {
        const key = normalise(l.cage);
        if (!loops.has(key)) loops.set(key, { parts: [], within: [] });
        loops.get(key).parts.push(l.points);
        loops.get(key).within.push(l.within);
      }
    })
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
  osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  osmLayer.on('tileerror', onOsmError);
  makeLabels();
  lines = L.layerGroup().addTo(map);
  const MapControl = L.Control.extend({
    onAdd() {
      mapBox = el('div', { className: 'map-offline leaflet-bar' });
      L.DomEvent.disableClickPropagation(mapBox);
      return mapBox;
    },
  });
  new MapControl({ position: 'topleft' }).addTo(map);
  const LinesControl = L.Control.extend({
    onAdd() {
      linesBox = el('div', { className: 'map-lines leaflet-bar' });
      L.DomEvent.disableClickPropagation(linesBox);
      return linesBox;
    },
  });
  new LinesControl({ position: 'topright' }).addTo(map);
  const SetsControl = L.Control.extend({
    onAdd() {
      setsBox = el('div', { className: 'map-sets leaflet-bar' });
      L.DomEvent.disableClickPropagation(setsBox);
      L.DomEvent.disableScrollPropagation(setsBox);
      return setsBox;
    },
  });
  new SetsControl({ position: 'bottomleft' }).addTo(map);
}

// ---------- offline base map ----------

// Suburb names, built once. The offline style has no metro suburb names of its own.
function makeLabels() {
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  labels = L.layerGroup();
  for (const p of points) {
    const icon = L.divIcon({ className: 'map-suburb', html: el('span', { textContent: p.name }), iconSize: null });
    L.marker([p.lat, p.lng], { pane: 'labels', interactive: false, keyboard: false, icon }).addTo(labels);
  }
  map.on('zoomend', syncLabels);
}

function syncLabels() {
  const show = !!vectorLayer && map.hasLayer(vectorLayer) && map.getZoom() >= LABEL_ZOOM;
  if (show) labels.addTo(map);
  else labels.remove();
}

// Offline map if it's the saved choice, if the browser knows it's offline, or if OSM kept failing.
function wantVector() {
  if (!vectorLayer) return false;
  return autoFallback || getBasePref() === 'offline' || navigator.onLine === false;
}

function showBase(useVector) {
  if (useVector) {
    vectorLayer.addTo(map);
    vectorLayer.bringToBack();
    osmLayer.remove();
    if (noMapErr) { noMapErr = false; showError(''); }
  } else {
    osmLayer.addTo(map);
    osmLayer.bringToBack();
  }
  syncLabels();
}

// Wifi without internet: OSM tiles fail while navigator.onLine is still true.
// Tiles already in the service worker's cache load fine, so only new ones count.
function onOsmError() {
  if (!osmLayer || !map.hasLayer(osmLayer)) return;
  osmErrors++;
  if (vectorLayer) {
    if (osmErrors >= 3 && !autoFallback) {
      autoFallback = true;
      showBase(true);
      renderMapBox();
    }
  } else if (osmErrors === 1 && !buildFailed && !dl && !isDownloading()) {
    noMapErr = true;
    showError('No connection and no offline map on this device yet. Connect to wifi and tap Download offline map.');
  }
}

async function makeVectorLayer() {
  const blob = await cachedMapBlob();
  if (!blob) return null;
  await loadVectorLibs();
  const source = new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], 'adelaide.pmtiles')));
  await source.getHeader(); // a corrupt file throws here
  return protomapsL.leafletLayer({
    url: source, flavor: 'light', lang: 'en', maxDataZoom: 14, maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://protomaps.com">Protomaps</a>',
  });
}

// Builds the chosen base map. The vector layer is built once, even if this runs twice at the same time.
async function useBestBase() {
  try {
    vectorLayer ||= await (buildP ||= makeVectorLayer().finally(() => { buildP = null; }));
    buildFailed = false;
  } catch (err) {
    buildFailed = true;
    console.warn('Offline map failed, using online tiles', err);
  }
  showBase(wantVector());
  await renderMapBox();
}

function pickBase(v) {
  setBasePref(v);
  autoFallback = false;
  osmErrors = 0;
  showBase(wantVector());
  renderMapBox();
}

function baseSwitch() {
  const useVector = wantVector();
  const button = (text, on, value) => {
    const b = el('button', { type: 'button', textContent: text });
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => pickBase(value));
    return b;
  };
  return el('div', { className: 'map-base' }, button('Online', !useVector, 'online'), button('Offline', useVector, 'offline'));
}

function mapText(text) {
  return el('span', { className: 'map-offline-text', textContent: text });
}

function downloadButton(label, again) {
  const btn = el('button', { type: 'button', textContent: label });
  btn.addEventListener('click', () => startDownload(btn, again));
  return btn;
}

// The progress line is updated in place while downloading, not rebuilt.
function paintDownload() {
  dlEl = mapText(dl || progressText(0, 0));
  mapBox.replaceChildren(dlEl);
}

async function renderMapBox() {
  if (!mapBox) return;
  const status = await mapStatus();
  if (dl || isDownloading()) { paintDownload(); return; }
  const kids = [];
  if (!cacheSupported()) {
    kids.push(mapText('Offline map not supported in this browser'));
  } else {
    if (dlFailed) kids.push(mapText(downloadMessage(dlFailed)));
    if (vectorLayer) {
      kids.push(baseSwitch());
      if (autoFallback) kids.push(mapText('No connection, showing offline map'));
      if (status === 'old') kids.push(downloadButton(`Update offline map (${MAP_MB} MB)`, false));
    } else if (status === 'ready') {
      kids.push(mapText("Offline map couldn't load"), downloadButton('Download again', true));
    } else {
      kids.push(downloadButton(`${status === 'old' ? 'Update' : 'Download'} offline map (${MAP_MB} MB)`, false));
    }
  }
  mapBox.replaceChildren(...kids);
}

async function startDownload(btn, again) {
  if (dl || isDownloading()) return;
  btn.disabled = true;
  dl = progressText(0, 0);
  dlFailed = null;
  noMapErr = false;
  showError('');
  paintDownload();
  if (again) await deleteMap();
  downloadMap(); // progress and the result come through onDownload
}

// A download can start from the map or from the menu, so both are heard here.
async function onDownload(ev) {
  if (ev.state === 'progress') {
    dl = progressText(ev.received, ev.total);
    const now = Date.now();
    if (!mapBox) return;
    if (!dlEl?.isConnected) paintDownload();
    else if (now - dlPaint >= 250) { dlEl.textContent = dl; dlPaint = now; }
    return;
  }
  dl = null;
  dlEl = null;
  dlFailed = ev.ok ? null : ev.reason;
  if (ev.ok) { vectorLayer?.remove(); vectorLayer = null; } // rebuild from the new file
  if (map) await useBestBase();
}

function cageColor(app, cageName) {
  const key = normalise(cageName);
  return app.data.cages.find(c => normalise(c.name) === key)?.color || '#888888';
}

function activeName() {
  return lineState.active === 'builtin' ? 'Built-in' : findSet(lineState, lineState.active)?.name || 'Built-in';
}

function setName(id) {
  return id === 'builtin' ? 'Built-in' : findSet(lineState, id)?.name || '';
}

// A cage's parts in the built-in lines or in a drawn set.
function partsFor(setId, cageName) {
  if (setId === 'builtin') return loops.get(normalise(cageName))?.parts || [];
  return cageParts(findSet(lineState, setId), cageName);
}

function hasAnyLines() {
  return loops.size > 0 || lineState.sets.some(s => Object.keys(s.loops).length);
}

function compareId() {
  return lineState.compare && lineState.compare !== lineState.active ? lineState.compare : null;
}

// The active set's loops: dashed for the built-in lines, solid for a drawn set.
// A compared set goes over the top, thin and dashed, with no fill.
function drawLoop(app, cageName) {
  const color = cageColor(app, cageName);
  const builtin = lineState.active === 'builtin';
  for (const points of partsFor(lineState.active, cageName)) {
    L.polygon(points, { color, weight: 3, opacity: 0.85, dashArray: builtin ? '8 6' : null, fillColor: color, fillOpacity: 0.07, interactive: false })
      .addTo(lines);
  }
  const other = compareId();
  if (!other) return;
  for (const points of partsFor(other, cageName)) {
    L.polygon(points, { color, weight: 2, opacity: 0.7, dashArray: '4 6', fill: false, interactive: false })
      .addTo(lines);
  }
}

// "±0.3 km", or "±0.3/1.1 km" for a cage with two maps of different accuracy.
function withinText(loop) {
  if (loop.within.some(w => !w)) return '± ?';
  return `±${[...new Set(loop.within)].sort((a, b) => a - b).join('/')} km`;
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
    const builtin = lineState.active === 'builtin';
    const other = compareId();
    for (const cage of app.data.cages) {
      const loop = builtin ? loops.get(normalise(cage.name)) : null;
      if (!loop && !partsFor(lineState.active, cage.name).length && !(other && partsFor(other, cage.name).length)) continue;
      const dot = el('span', { className: 'map-lines-dot' });
      dot.style.background = cage.color;
      const row = el('li', {}, dot, cage.name);
      if (loop) row.append(el('span', { className: 'map-lines-near', textContent: withinText(loop) }));
      key.append(row);
    }
    if (key.childElementCount) {
      if (builtin) key.append(el('li', { className: 'map-lines-note', textContent: '± = how far a line may be off the drawn map' }));
      else key.append(el('li', { className: 'map-lines-note', textContent: `Drawn lines: ${activeName()}` + (other ? `, compared with ${setName(other)}` : '') }));
      if (builtin && other) key.append(el('li', { className: 'map-lines-note', textContent: `Compared with ${setName(other)}` }));
    }
  }
  linesBox.replaceChildren(head, ...(key.childElementCount ? [key] : []));
  linesBox.hidden = !hasAnyLines();
}

// Toggle off: just the cage the map was opened from (none on the whole city).
function showAllLines(app) {
  lines.clearLayers();
  if (editing) drawFaintLines(app);
  else if (allLines) for (const cage of app.data.cages) drawLoop(app, cage.name);
  else if (focusCage) drawLoop(app, focusCage);
  renderLinesBox(app);
  renderSetsPanel(app);
  if (editing) renderHandles();
}

// ---------- line sets panel ----------

function saveState() {
  if (saveLines(lineState)) return true;
  showError("Couldn't save. Storage may be full.");
  return false;
}

function pickActive(app, id) {
  lineState.active = id;
  if (lineState.compare === id) lineState.compare = null;
  saveState();
  showAllLines(app);
}

function pickCompare(app, id) {
  lineState.compare = id;
  saveState();
  showAllLines(app);
}

function setButton(text, pressed, onClick, disabled = false) {
  const b = el('button', { type: 'button', textContent: text, disabled });
  if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

function renderSetsPanel(app) {
  if (!setsBox) return;
  setsBox.hidden = !!editing; // the edit toolbar takes its place
  if (editing) return;
  const head = setButton(`Lines: ${activeName()} ${panelOpen ? '▴' : '▾'}`, null, () => { panelOpen = !panelOpen; renderSetsPanel(app); });
  head.setAttribute('aria-expanded', String(panelOpen));
  if (!panelOpen) { setsBox.replaceChildren(head); return; }
  const builtin = lineState.active === 'builtin';
  const kids = [head, setButton('Built-in', builtin, () => pickActive(app, 'builtin'))];
  for (const s of lineState.sets) kids.push(setButton(s.name, lineState.active === s.id, () => pickActive(app, s.id)));
  kids.push(
    setButton('New set', null, () => openLinesDialog(app, 'new')),
    setButton('Edit lines', null, () => {
      if (builtin) openLinesDialog(app, 'new', { name: 'My lines', edit: true });
      else startEdit(app);
    }),
    setButton('Rename', null, () => openLinesDialog(app, 'rename'), builtin),
    setButton('Delete', null, () => openLinesDialog(app, 'delete'), builtin),
    el('p', { className: 'map-sets-label', textContent: 'Compare with' }),
    setButton('None', lineState.compare === null, () => pickCompare(app, null)),
  );
  if (!builtin) kids.push(setButton('Built-in', lineState.compare === 'builtin', () => pickCompare(app, 'builtin')));
  for (const s of lineState.sets) {
    if (s.id !== lineState.active) kids.push(setButton(s.name, lineState.compare === s.id, () => pickCompare(app, s.id)));
  }
  setsBox.replaceChildren(...kids);
}

// New / rename / delete in the small dialog over the map.
function openLinesDialog(app, mode, opts = {}) {
  linesDlg = { app, mode, edit: !!opts.edit };
  const set = findSet(lineState, lineState.active);
  const input = $('lines-name');
  const titles = { new: 'New line set', rename: 'Rename line set', delete: 'Delete line set' };
  $('lines-title').textContent = titles[mode];
  $('lines-name-wrap').hidden = mode === 'delete';
  input.required = mode !== 'delete';
  input.value = mode === 'rename' ? set.name : opts.name || '';
  $('lines-start').hidden = mode !== 'new';
  $('lines-start-current').textContent = `Current lines (${activeName()})`;
  document.querySelector('input[name="lines-start"][value="current"]').checked = true;
  $('lines-text').hidden = mode !== 'delete';
  $('lines-text').textContent = mode === 'delete' ? `Delete "${set.name}"? This can't be undone.` : '';
  $('btn-lines-ok').textContent = mode === 'delete' ? 'Delete' : 'Save';
  $('dlg-lines').showModal();
  if (mode !== 'delete') input.select();
}

function submitLinesDialog() {
  if (!$('dlg-map').open) return;
  const { app, mode, edit } = linesDlg;
  const name = $('lines-name').value.trim().slice(0, NAME_MAX).trim();
  if (mode !== 'delete' && !name) return;
  $('dlg-lines').close();
  let noBuiltin = false;
  if (mode === 'new') {
    const blank = document.querySelector('input[name="lines-start"]:checked')?.value === 'blank';
    const cur = findSet(lineState, lineState.active);
    const start = blank ? {} : cur ? cur.loops : builtinLoops(loops, app.data.cages);
    noBuiltin = !blank && !cur && !loops.size;
    lineState.active = newSet(lineState, name, start).id;
  } else if (mode === 'rename') {
    renameSet(lineState, lineState.active, name);
  } else {
    deleteSet(lineState, lineState.active);
  }
  const saved = saveState();
  showAllLines(app);
  if (saved && noBuiltin) showError("Built-in lines didn't load, so this set starts blank.");
  if (mode === 'new' && edit) startEdit(app);
}

// ---------- editing a drawn set ----------

const r6 = n => Math.round(n * 1e6) / 1e6;
const UNDO_MAX = 50;
const NEED3 = 'A loop needs at least 3 points. Use Delete loop instead.';
const HINT = 'Drag a point to move it. Drag or tap a faint dot to add a point.';

function editSet() { return findSet(lineState, editing.setId); }

// The editing cage's parts, as stored (mutated in place).
function editParts() { return cageParts(editSet(), editing.cage); }

function editKey() {
  const key = normalise(editing.cage);
  return Object.keys(editSet().loops).find(k => normalise(k) === key) || editing.cage;
}

function setMsg(text) {
  editing.ui.msg.textContent = text;
}

// Draws every other cage's loops faint while editing.
function drawFaintLines(app) {
  for (const cage of app.data.cages) {
    if (normalise(cage.name) === normalise(editing.cage)) continue;
    const color = cageColor(app, cage.name);
    for (const points of cageParts(editSet(), cage.name)) {
      L.polygon(points, { color, weight: 2, opacity: 0.45, fill: false, interactive: false }).addTo(lines);
    }
  }
}

function pushUndo() {
  editing.undo.push(JSON.parse(JSON.stringify(editSet().loops)));
  if (editing.undo.length > UNDO_MAX) editing.undo.shift();
}

// Saves after every change.
function commit() {
  if (saveLines(lineState)) return true;
  setMsg("Couldn't save. Storage may be full.");
  return false;
}

function updateToolbar() {
  const { ui, adding, sel } = editing;
  ui.undo.disabled = adding ? !adding.length : !editing.undo.length;
  ui.add.textContent = adding ? 'Cancel loop' : 'New loop';
  ui.remove.disabled = !sel || !!adding;
  ui.del.disabled = !!adding || !editParts().length;
}

function refreshHandles() {
  if (!editing) return;
  renderHandles();
  updateToolbar();
}

function vertexIcon(selected) {
  return L.divIcon({ className: 'map-vertex' + (selected ? ' selected' : ''), iconSize: [40, 40] });
}

// A tap on a touch screen often moves a few pixels, which Leaflet counts as a drag.
const TAP_PX = 10;

function pxApart(a, b) {
  return map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));
}

function renderHandles() {
  const g = editing.group;
  g.clearLayers();
  const color = cageColor(editing.app, editing.cage);
  editParts().forEach((part, pi) => {
    const poly = L.polygon(part, { color, weight: 3, opacity: 0.95, fillColor: color, fillOpacity: 0.1, interactive: false }).addTo(g);
    if (editing.adding) return; // no handles while drawing, so taps reach the map
    const select = vi => { editing.sel = { pi, vi }; refreshHandles(); };
    part.forEach((pt, vi) => {
      const selected = editing.sel?.pi === pi && editing.sel?.vi === vi;
      const m = L.marker(pt, { icon: vertexIcon(selected), draggable: true, keyboard: false, zIndexOffset: 100 }).addTo(g);
      m.on('click', () => select(vi));
      m.on('drag', () => {
        const ll = part.map(p => [p[0], p[1]]);
        const at = m.getLatLng();
        ll[vi] = [at.lat, at.lng];
        poly.setLatLngs(ll);
      });
      m.on('dragend', () => {
        const at = m.getLatLng();
        if (pxApart(pt, at) < TAP_PX) { setTimeout(() => editing && select(vi), 0); return; } // a tap: select, don't move
        pushUndo();
        part[vi] = [r6(at.lat), r6(at.lng)];
        commit();
        setTimeout(refreshHandles, 0); // not while Leaflet is still finishing the drag
      });
    });
    part.forEach((pt, vi) => {
      const next = part[(vi + 1) % part.length];
      const middle = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
      const mid = L.marker(middle, {
        icon: L.divIcon({ className: 'map-midpoint', iconSize: [36, 36] }), draggable: true, keyboard: false,
      }).addTo(g);
      let done = false;
      const insert = () => {
        if (done) return;
        done = true;
        const at = pxApart(middle, mid.getLatLng()) < TAP_PX ? L.latLng(middle) : mid.getLatLng();
        pushUndo();
        part.splice(vi + 1, 0, [r6(at.lat), r6(at.lng)]);
        editing.sel = { pi, vi: vi + 1 };
        commit();
        setTimeout(refreshHandles, 0);
      };
      mid.on('click', insert);
      mid.on('dragend', insert);
      mid.on('drag', () => {
        const ll = part.map(p => [p[0], p[1]]);
        const at = mid.getLatLng();
        ll.splice(vi + 1, 0, [at.lat, at.lng]);
        poly.setLatLngs(ll);
      });
    });
  });
  if (editing.adding) renderAdding(color);
}

// The loop being drawn: an open line and a dot per point; the first one closes it.
function renderAdding(color) {
  const pts = editing.adding;
  if (pts.length > 1) L.polyline(pts, { color, weight: 3, interactive: false }).addTo(editing.group);
  pts.forEach((pt, i) => {
    const m = L.marker(pt, { icon: vertexIcon(false), interactive: i === 0, keyboard: false }).addTo(editing.group);
    if (i === 0) m.on('click', closeLoop);
  });
}

function closeLoop() {
  if (editing.adding.length < 3) { setMsg('Add at least 3 points before closing the loop.'); return; }
  pushUndo();
  (editSet().loops[editKey()] ||= []).push(editing.adding);
  editing.adding = null;
  editing.sel = null;
  commit();
  setMsg(HINT);
  refreshHandles();
}

function onMapClick(e) {
  if (!editing) return;
  if (editing.adding) {
    // A tap on a point already in the new loop (other than the first, which closes it) isn't a new point.
    if (editing.adding.some((p, i) => i > 0 && map.latLngToContainerPoint(p).distanceTo(e.containerPoint) < 12)) return;
    editing.adding.push([r6(e.latlng.lat), r6(e.latlng.lng)]);
    refreshHandles();
  } else if (editing.sel) {
    editing.sel = null;
    refreshHandles();
  }
}

function cancelAdding() {
  if (!editing?.adding) return;
  editing.adding = null;
  setMsg(HINT);
}

function pickEditCage(name) {
  const wasAdding = !!editing.adding;
  cancelAdding();
  editing.cage = name;
  editing.sel = null;
  const parts = editParts();
  if (parts.length) map.fitBounds(L.latLngBounds(parts.flat()), { padding: [40, 40] });
  showAllLines(editing.app);
  updateToolbar();
  if (wasAdding) setMsg('Loop cancelled.');
}

function editButton(text, onClick) {
  const b = el('button', { type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

function startEdit(app) {
  const set = findSet(lineState, lineState.active);
  if (!set || !app.data.cages.length) return;
  panelOpen = false;
  const names = app.data.cages.map(c => c.name);
  const focus = focusCage && names.find(n => normalise(n) === normalise(focusCage));
  const cage = focus || names.find(n => cageParts(set, n).length) || names[0];
  const ui = {
    select: el('select', {}, ...names.map(n => el('option', { value: n, textContent: n, selected: n === cage }))),
    msg: el('p', { className: 'map-edit-msg', textContent: HINT }),
  };
  ui.select.setAttribute('aria-label', 'Cage to edit');
  ui.select.addEventListener('change', () => pickEditCage(ui.select.value));
  ui.undo = editButton('Undo', () => {
    if (editing.adding) { editing.adding.pop(); refreshHandles(); return; } // drawing: step back one point
    const snap = editing.undo.pop();
    if (!snap) return;
    cancelAdding();
    editSet().loops = snap;
    editing.sel = null;
    commit();
    refreshHandles();
  });
  ui.add = editButton('New loop', () => {
    if (editing.adding) { cancelAdding(); refreshHandles(); return; }
    editing.adding = [];
    editing.sel = null;
    setMsg('Tap the map to add points. Tap the first point to finish.');
    refreshHandles();
  });
  ui.remove = editButton('Remove point', () => {
    const { pi, vi } = editing.sel;
    const part = editParts()[pi];
    if (part.length <= 3) { setMsg(NEED3); return; }
    pushUndo();
    part.splice(vi, 1);
    editing.sel = null;
    commit();
    refreshHandles();
  });
  ui.del = editButton('Delete loop', () => {
    const parts = editParts();
    const pi = editing.sel ? editing.sel.pi : parts.length === 1 ? 0 : -1;
    if (pi < 0) { setMsg('Tap a point on the loop you want to delete first.'); return; }
    pushUndo();
    parts.splice(pi, 1);
    if (!parts.length) delete editSet().loops[editKey()];
    editing.sel = null;
    commit();
    refreshHandles();
  });
  ui.done = editButton('Done', () => endEdit());
  editing = { app, setId: set.id, cage, sel: null, adding: null, undo: [], ui, group: L.layerGroup().addTo(map), control: null };
  const EditControl = L.Control.extend({
    onAdd() {
      const box = el('div', { className: 'map-edit leaflet-bar' }, ui.select, ui.undo, ui.add, ui.remove, ui.del, ui.done, ui.msg);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      return box;
    },
  });
  editing.control = new EditControl({ position: 'bottomleft' }).addTo(map);
  map.doubleClickZoom.disable(); // quick taps while placing points would zoom
  map.on('click', onMapClick);
  const parts = cageParts(set, cage);
  if (parts.length) map.fitBounds(L.latLngBounds(parts.flat()), { padding: [40, 40] });
  showAllLines(app);
  updateToolbar();
}

// Also runs when the map dialog closes any way (Escape, Back, Close).
function endEdit() {
  if (!editing) return;
  const app = editing.app;
  map.off('click', onMapClick);
  map.doubleClickZoom.enable();
  editing.group.remove();
  editing.control.remove();
  editing = null;
  showAllLines(app);
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
  onMapDownload(onDownload);
  const input = $('map-search');
  input.addEventListener('input', () => renderResults(findSuburbs(input.value)));
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = findSuburbs(input.value, 1)[0];
    if (first) choose(first);
  });
  $('btn-map-close').addEventListener('click', () => $('dlg-map').close());
  $('dlg-map').addEventListener('close', () => { $('dlg-lines').close(); endEdit(); });
  $('form-lines').addEventListener('submit', e => { e.preventDefault(); submitLinesDialog(); });
  $('btn-lines-cancel').addEventListener('click', () => $('dlg-lines').close());
}

// opts: {} = whole city; { cage } = that cage's area; { suburb } = pin it
// (falls back to the cage view if the suburb has no point).
export async function openMap(app, { suburb, cage } = {}) {
  wire();
  const dlg = $('dlg-map');
  $('map-search').value = '';
  renderResults([]);
  showError('');
  osmErrors = 0;
  autoFallback = false;
  noMapErr = false;
  $('map-title').textContent = cage || 'Map';
  if (!dlg.open) dlg.showModal();
  try {
    await Promise.all([loadLeaflet(), loadPoints(), loadLoops()]);
  } catch {
    showError("Map couldn't load. Check your connection.");
    return;
  }
  lineState = loadLines();
  panelOpen = false;
  if (!map) makeMap();
  map.invalidateSize();
  clearPin();
  focusCage = cage || null;
  const loop = cage && loops.get(normalise(cage));
  const fit = (cage && partsFor(lineState.active, cage).length ? partsFor(lineState.active, cage) : loop?.parts) || [];
  const p = suburb && byKey.get(normalise(suburb));
  if (p) pinSuburb(p);
  else if (fit.length) map.fitBounds(L.latLngBounds(fit.flat()), { padding: [20, 20] });
  else if (cage) fitPoints(cagePoints(app, cage));
  else fitPoints(points);
  showAllLines(app);
  await useBestBase();
}
