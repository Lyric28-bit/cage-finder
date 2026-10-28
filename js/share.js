// Share link: this device's cages, suburbs, postcodes, approvals and drawn line
// sets packed into a URL (#share=...), so another device can load them.
// To keep the link short it only carries what differs from the "baseline": the
// sheet data after the one-off moves (unsure list, renames), which every device
// running the same app version can rebuild itself. A fingerprint of the baseline
// rides along, so a device with different sheet data refuses rather than guesses.
// The part after # never reaches the server. Photos are never included.

import { isImportable, replaceData, sheetUpdateAvailable } from './store.js';
import { cleanSets, loadLines, saveLines, mergeSets } from './lines.js';

export const HASH_KEY = '#share=';
const FORMAT = '1';
const POINT_SCALE = 1e5; // line points rounded to ~1 m

// ---------- pure encode / decode (tested in tests.html) ----------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 32-bit FNV-1a of the baseline, so both ends know they start from the same data.
export function fingerprint(base) {
  const text = JSON.stringify([base.cages, base.local, base.postcodes, base.approvals,
    base.unsureApplied || 0, base.renamesApplied || 0]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// A list as runs of the baseline list ([start, count]) plus anything new.
const isRun = x => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]);
function encList(list, base, encItem = x => x) {
  const where = new Map();
  base.forEach((x, i) => { const k = JSON.stringify(x); if (!where.has(k)) where.set(k, i); });
  const out = [];
  let run = null;
  for (const item of list) {
    const i = where.get(JSON.stringify(item));
    if (i !== undefined && run && run[0] + run[1] === i) { run[1]++; continue; }
    if (i !== undefined) { run = [i, 1]; out.push(run); continue; }
    run = null;
    out.push(encItem(item));
  }
  return out;
}
function decList(enc, base, decItem = x => x) {
  if (!Array.isArray(enc)) throw new Error('bad');
  const out = [];
  for (const x of enc) {
    if (isRun(x)) {
      if (x[0] < 0 || x[1] < 1 || x[0] + x[1] > base.length) throw new Error('bad');
      out.push(...base.slice(x[0], x[0] + x[1]).map(v => structuredClone(v)));
    } else {
      out.push(decItem(x));
    }
  }
  return out;
}

// A changed or new cage: b = its baseline index (same name or sheet name), then only what differs.
function encCage(cage, base) {
  const key = c => [c.name, c.sheetName].filter(Boolean);
  const names = key(cage);
  const b = base.findIndex(c => key(c).some(n => names.includes(n)));
  const from = b >= 0 ? base[b] : { name: undefined, color: undefined, suburbs: [] };
  const o = {};
  if (b >= 0) o.b = b;
  if (cage.name !== from.name) o.n = cage.name;
  if (cage.color !== from.color) o.c = cage.color;
  if (cage.sheetName !== from.sheetName) o.h = cage.sheetName ?? null;
  if (!same(cage.suburbs, from.suburbs)) o.s = encList(cage.suburbs, from.suburbs);
  return o;
}
function decCage(o, base) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad');
  const from = o.b === undefined ? null : base[o.b];
  if (o.b !== undefined && !from) throw new Error('bad');
  const cage = {
    name: o.n ?? from?.name,
    color: o.c ?? from?.color,
    suburbs: o.s ? decList(o.s, from?.suburbs || []) : [...(from?.suburbs || [])],
  };
  const sheetName = 'h' in o ? o.h : from?.sheetName;
  if (typeof sheetName === 'string') cage.sheetName = sheetName;
  return cage;
}

// Keyed maps (postcodes, approvals): only the entries set or removed.
function encMap(map = {}, base = {}) {
  const set = {}, gone = Object.keys(base).filter(k => !(k in map));
  for (const [k, v] of Object.entries(map)) if (!same(v, base[k])) set[k] = v;
  return [set, gone];
}
function decMap(set = {}, gone = [], base = {}) {
  const out = structuredClone(base);
  for (const k of gone) delete out[k];
  return Object.assign(out, set);
}

// Line points as integers (~1 m), each after the first stored as a step from the last.
function encPart(part) {
  const flat = [];
  let lat = 0, lng = 0;
  for (const [a, b] of part) {
    const y = Math.round(a * POINT_SCALE), x = Math.round(b * POINT_SCALE);
    flat.push(y - lat, x - lng);
    lat = y; lng = x;
  }
  return flat;
}
function decPart(flat) {
  if (!Array.isArray(flat) || flat.length % 2) throw new Error('bad');
  const part = [];
  let lat = 0, lng = 0;
  for (let i = 0; i < flat.length; i += 2) {
    lat += flat[i]; lng += flat[i + 1];
    part.push([lat / POINT_SCALE, lng / POINT_SCALE]);
  }
  return part;
}

// Plain object form of the link (before compression).
export function packShare(data, base, lineSets = []) {
  const o = { h: fingerprint(base) };
  const unchanged = data.cages.length === base.cages.length && same(data.cages, base.cages);
  if (!unchanged) o.c = encList(data.cages, base.cages, c => encCage(c, base.cages));
  if (!same(data.local || [], base.local)) o.l = encList(data.local || [], base.local);
  const [p, pd] = encMap(data.postcodes, base.postcodes);
  if (Object.keys(p).length) o.p = p;
  if (pd.length) o.pd = pd;
  const [a, ad] = encMap(data.approvals, base.approvals);
  if (Object.keys(a).length) o.a = a;
  if (ad.length) o.ad = ad;
  for (const [k, short] of [['sheetVersion', 'sv'], ['unsureApplied', 'u'], ['renamesApplied', 'r']]) {
    if ((data[k] || 0) !== (base[k] || 0)) o[short] = data[k] || 0;
  }
  if (lineSets.length) {
    o.L = lineSets.map(s => ({ n: s.name, l: Object.fromEntries(Object.entries(s.loops).map(([cage, parts]) => [cage, parts.map(encPart)])) }));
  }
  return o;
}

// Throws Error('mismatch') when the link was made from different sheet data, Error('bad') when damaged.
export function unpackShare(o, base) {
  if (!o || typeof o !== 'object' || typeof o.h !== 'string') throw new Error('bad');
  if (o.h !== fingerprint(base)) throw new Error('mismatch');
  const data = {
    version: 1,
    sheetVersion: o.sv ?? base.sheetVersion,
    cages: o.c ? decList(o.c, base.cages, c => decCage(c, base.cages)) : structuredClone(base.cages),
    local: o.l ? decList(o.l, base.local) : structuredClone(base.local),
    unsureApplied: o.u ?? base.unsureApplied,
    renamesApplied: o.r ?? base.renamesApplied,
    postcodes: decMap(o.p, o.pd, base.postcodes),
    approvals: decMap(o.a, o.ad, base.approvals),
  };
  if (!isImportable(data)) throw new Error('bad');
  // replaceData drops malformed postcode/approval entries.
  const clean = {};
  replaceData(clean, data);
  let lineSets = [];
  if (o.L !== undefined) {
    if (!Array.isArray(o.L)) throw new Error('bad');
    lineSets = cleanSets(o.L.map(s => ({
      name: s?.n,
      loops: Object.fromEntries(Object.entries(s?.l || {}).map(([cage, parts]) => [cage, (parts || []).map(decPart)])),
    })));
  }
  return { data: clean, lineSets };
}

// ---------- compression + URL ----------

const toB64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = text => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export const shareSupported = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function encodeShare(data, base, lineSets) {
  const json = new TextEncoder().encode(JSON.stringify(packShare(data, base, lineSets)));
  return FORMAT + '.' + toB64(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(text, base) {
  const m = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(String(text).trim());
  if (!m) throw new Error('bad');
  if (m[1] !== FORMAT) throw new Error('mismatch');
  let o;
  try {
    o = JSON.parse(new TextDecoder().decode(await pipe(fromB64(m[2]), new DecompressionStream('deflate-raw'))));
  } catch {
    throw new Error('bad');
  }
  try {
    return unpackShare(o, base);
  } catch (err) {
    throw new Error(err.message === 'mismatch' ? 'mismatch' : 'bad');
  }
}

// The payload from a pasted link, a bare "#share=..." or the payload itself.
// People add words after a link, and email can hard-wrap a long one, so there
// are two readings to try: up to the first space, and with all spaces dropped.
export function payloadsOf(text) {
  let t = String(text).trim();
  const i = t.indexOf(HASH_KEY);
  if (i >= 0) t = t.slice(i + HASH_KEY.length);
  const lead = s => /^\d+\.[A-Za-z0-9_-]+/.exec(s)?.[0] || s;
  return [...new Set([lead(t.split(/\s/)[0]), lead(t.replace(/\s+/g, ''))])];
}

// ---------- dialog ----------

const $ = id => document.getElementById(id);
const MESSAGES = {
  bad: "That link is damaged or incomplete. It may have been cut short when it was sent. Try sending it another way (email, or copy and paste).",
  mismatch: 'That link was made on a different version of Cage Notes. Update the app on both devices (tap "New version ready" if it shows) and share again.',
  unsupported: "This browser is too old for share links. Use Export and Import instead.",
  baseline: "Couldn't load the sheet data to build the link. Check your connection and try again.",
};

let mode = 'send';
let pending = null; // decoded link waiting for Replace
// An opened link is kept for this tab until Replace or Cancel, so "update the
// app" on a version mismatch (which reloads the page) can still use it.
const OPENED = 'cage-share-opened';
let keepOpened = false;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isHomeScreenApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function setUp(app) {
  const dlg = $('dlg-share');
  if (dlg.dataset.ready) return dlg;
  dlg.dataset.ready = '1';
  $('btn-share-cancel').addEventListener('click', () => dlg.close());
  $('btn-share-copy').addEventListener('click', () => copyLink());
  $('btn-share-ok').addEventListener('click', () => onOk(app));
  dlg.addEventListener('close', () => {
    pending = null;
    if (!keepOpened) sessionStorage.removeItem(OPENED);
  });
  return dlg;
}

function show(app, { title, text, link, editable = false, ok, copy = false, cancel = 'Close' }) {
  const dlg = setUp(app);
  $('share-title').textContent = title;
  $('share-text').textContent = text;
  const box = $('share-link');
  box.hidden = link === undefined;
  box.readOnly = !editable;
  box.value = link || '';
  box.placeholder = editable ? 'Paste the link here' : '';
  $('share-error').hidden = true;
  $('btn-share-copy').hidden = !copy;
  $('btn-share-ok').hidden = !ok;
  $('btn-share-ok').textContent = ok || '';
  $('btn-share-cancel').textContent = cancel;
  if (!dlg.open) dlg.showModal();
  if (editable) box.focus();
}

function showError(key) {
  $('share-error').textContent = MESSAGES[key] || MESSAGES.bad;
  $('share-error').hidden = false;
}

async function copyLink() {
  const box = $('share-link');
  try {
    await navigator.clipboard.writeText(box.value);
  } catch {
    box.select();
    document.execCommand('copy');
  }
  $('btn-share-copy').textContent = 'Copied';
  setTimeout(() => { $('btn-share-copy').textContent = 'Copy'; }, 1500);
}

async function onOk(app) {
  if (mode === 'send') {
    try {
      await navigator.share({ url: $('share-link').value, title: 'Cage Notes' });
    } catch (err) {
      if (err.name !== 'AbortError') copyLink();
    }
  } else if (mode === 'paste') {
    await receive(app, payloadsOf($('share-link').value));
  } else if (mode === 'receive' && pending) {
    apply(app, pending);
  }
}

// ⋯ → Share link
export async function openShare(app) {
  mode = 'send';
  if (!shareSupported()) {
    show(app, { title: 'Share link', text: '' });
    showError('unsupported');
    return;
  }
  let base;
  try {
    base = await app.shareBaseline();
  } catch {
    show(app, { title: 'Share link', text: '' });
    showError('baseline');
    return;
  }
  const sets = loadLines().sets;
  const link = location.origin + location.pathname + HASH_KEY + await encodeShare(app.data, base, sets);
  const kb = Math.max(1, Math.round(link.length / 1024));
  const what = sets.length ? ` and ${sets.length} drawn line set${sets.length === 1 ? '' : 's'}` : '';
  show(app, {
    title: 'Share link',
    text: `Your cages, suburbs, postcodes${what ? "," : " and"} approvals${what} (not photos). Opening it on another device replaces that device's cages. Link size ${kb} KB.`,
    link,
    copy: true,
    ok: typeof navigator.share === 'function' ? 'Share' : '',
  });
}

// ⋯ → Open share link (for home-screen apps that don't get links, e.g. iPhone)
export function openPasteLink(app) {
  mode = 'paste';
  show(app, { title: 'Open share link', text: 'Paste a Cage Notes share link.', link: '', editable: true, ok: 'Open', cancel: 'Cancel' });
}

// Start, or a link opened while the app was already open (hashchange).
export async function checkShareHash(app) {
  let payload;
  if (location.hash.startsWith(HASH_KEY)) {
    payload = location.hash.slice(HASH_KEY.length);
    try { sessionStorage.setItem(OPENED, payload); } catch { /* storage blocked */ }
    // Take it off the address bar so a bookmark doesn't offer it again.
    history.replaceState(history.state, '', location.pathname + location.search);
  } else {
    // One retry only (the reload after updating), so a link that still doesn't fit won't nag forever.
    try { payload = sessionStorage.getItem(OPENED); sessionStorage.removeItem(OPENED); } catch { /* storage blocked */ }
  }
  if (!payload) return;
  mode = 'receive';
  await receive(app, [payload]);
}

async function receive(app, payloads) {
  const title = 'Shared cages';
  keepOpened = false;
  if (!shareSupported()) {
    mode = 'receive';
    show(app, { title, text: '' });
    showError('unsupported');
    return;
  }
  let shared, payload;
  try {
    const base = await app.shareBaseline();
    for (const [i, p] of payloads.entries()) {
      try {
        shared = await decodeShare(p, base);
        payload = p;
        break;
      } catch (err) {
        if (i === payloads.length - 1) throw err;
      }
    }
  } catch (err) {
    const key = err.message in MESSAGES ? err.message : 'baseline'; // anything else: fetching the sheet data failed
    // Worth trying again after an update or with a connection; a damaged link isn't.
    keepOpened = mode !== 'paste' && key !== 'bad';
    if (mode !== 'paste') show(app, { title, text: '' });
    showError(key);
    return;
  }
  mode = 'receive';
  pending = shared;
  const nCages = shared.data.cages.length;
  const nSubs = shared.data.cages.reduce((n, c) => n + c.suburbs.length, 0);
  const nSets = shared.lineSets.length;
  const sets = nSets ? ` Its ${nSets} drawn line set${nSets === 1 ? '' : 's'} will be added to yours.` : '';
  // iPhone/iPad: Safari and the home-screen app keep separate data.
  const safari = mode !== 'paste' && isIOS() && !isHomeScreenApp();
  show(app, {
    title,
    text: `This link has ${nCages} cages with ${nSubs} suburbs. Replace all cages and suburbs on this device with it?${sets} Photos stay as they are.`
      + (safari ? ' On iPhone/iPad this only changes Safari\'s copy. For the home-screen app: Copy, open the app, ⋯ → Open share link.' : ''),
    link: safari ? location.origin + location.pathname + HASH_KEY + payload : undefined,
    copy: safari,
    ok: 'Replace',
    cancel: 'Cancel',
  });
}

async function apply(app, shared) {
  replaceData(app.data, shared.data);
  app.migrate();
  app.save();
  let msg = 'Loaded the shared cages.';
  if (shared.lineSets.length) {
    const lines = loadLines();
    if (mergeSets(lines, shared.lineSets) && !saveLines(lines)) msg = "Loaded the shared cages, but couldn't save the drawn lines. Storage may be full.";
  }
  keepOpened = false;
  $('dlg-share').close();
  app.showNote();
  if (await sheetUpdateAvailable(app.data)) msg += ' New sheet data is available. ⋯ → Reset to sheet data to use it (this clears your edits, so Export first).';
  app.showMessage(msg);
}
