// Line sets: user-drawn alternative cage lines for the street map, kept on the
// device. Stored apart from the cage data so Reset to sheet data never touches them.
// The shipped lines are the read-only set 'builtin' and aren't stored here.

import { normalise } from './match.js';

const KEY = 'cage-lines';
export const NAME_MAX = 40;
// Caps so a hand-edited import can't bloat storage or freeze the map.
export const CAPS = { sets: 50, cages: 100, cageKey: 80, parts: 20, points: 5000 };
const BUILTIN_NAME = 'Built-in';

export function emptyLines() {
  return { version: 1, active: 'builtin', compare: null, sets: [] };
}

const deepCopy = x => JSON.parse(JSON.stringify(x));

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function findSet(state, id) {
  return state.sets.find(s => s.id === id) || null;
}

const goodPoint = p => Array.isArray(p) && p.length >= 2
  && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// Only valid sets come out, so a hand-edited import can't break the map.
export function cleanSets(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (out.length >= CAPS.sets) break;
    if (!s || typeof s !== 'object' || typeof s.name !== 'string') continue;
    const name = s.name.trim().slice(0, NAME_MAX).trim();
    if (!name || !s.loops || typeof s.loops !== 'object' || Array.isArray(s.loops)) continue;
    const loops = {};
    for (const [rawCage, parts] of Object.entries(s.loops)) {
      if (Object.keys(loops).length >= CAPS.cages) break;
      const cage = rawCage.trim().slice(0, CAPS.cageKey).trim();
      if (!cage || !Array.isArray(parts)) continue;
      const good = parts
        .filter(Array.isArray)
        .slice(0, CAPS.parts)
        .map(part => part.filter(goodPoint).slice(0, CAPS.points).map(p => [p[0], p[1]]))
        .filter(part => part.length >= 3);
      if (good.length) loops[cage] = (loops[cage] || []).concat(good).slice(0, CAPS.parts);
    }
    const id = typeof s.id === 'string' && s.id ? s.id : newId();
    out.push({ id, name, loops });
  }
  return out;
}

export function loadLines() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || typeof raw !== 'object') return emptyLines();
    const state = { version: 1, active: 'builtin', compare: null, sets: cleanSets(raw.sets) };
    if (typeof raw.active === 'string' && findSet(state, raw.active)) state.active = raw.active;
    if (typeof raw.compare === 'string' && (raw.compare === 'builtin' || findSet(state, raw.compare))) state.compare = raw.compare;
    return state;
  } catch {
    return emptyLines();
  }
}

export function saveLines(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// "Pete", then "Pete (2)", "Pete (3)"... Case-insensitive; "Built-in" is always taken.
export function uniqueName(state, name, exceptId = null) {
  const taken = new Set([BUILTIN_NAME.toLowerCase()]);
  for (const s of state.sets) if (s.id !== exceptId) taken.add(s.name.toLowerCase());
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`.toLowerCase())) n++;
  return `${name} (${n})`;
}

export function newSet(state, name, loops) {
  const set = { id: newId(), name: uniqueName(state, name), loops: deepCopy(loops || {}) };
  state.sets.push(set);
  return set;
}

export function renameSet(state, id, name) {
  const set = findSet(state, id);
  const clean = String(name).trim().slice(0, NAME_MAX).trim();
  if (!set || !clean) return false;
  set.name = uniqueName(state, clean, id);
  return true;
}

export function deleteSet(state, id) {
  const i = state.sets.findIndex(s => s.id === id);
  if (i < 0) return false;
  state.sets.splice(i, 1);
  if (state.active === id) state.active = 'builtin';
  if (state.compare === id) state.compare = null;
  return true;
}

const roundedLoops = loops => JSON.stringify(loops, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) : v));

// Adds cleaned copies with fresh ids; never overwrites. Returns how many were added.
export function mergeSets(state, incoming) {
  const good = cleanSets(incoming);
  let added = 0;
  for (const s of good) {
    // Re-importing your own backup shouldn't duplicate a set.
    // Compared at ~1 m so a set sent back by share link (rounded) still counts as the same.
    const same = state.sets.some(x => x.name.toLowerCase() === s.name.toLowerCase() && roundedLoops(x.loops) === roundedLoops(s.loops));
    if (same) continue;
    state.sets.push({ id: newId(), name: uniqueName(state, s.name), loops: s.loops });
    added++;
  }
  return added;
}

// A cage was renamed in the app: move its loops to the new name in every set.
export function renameCageInSets(state, oldName, newName) {
  const from = normalise(oldName), to = normalise(newName);
  let changed = false;
  for (const set of state.sets) {
    const keys = Object.keys(set.loops).filter(k => normalise(k) === from);
    if (!keys.length) continue;
    const parts = keys.flatMap(k => set.loops[k]);
    for (const k of keys) delete set.loops[k];
    const existing = Object.keys(set.loops).find(k => normalise(k) === to);
    if (existing) set.loops[existing] = set.loops[existing].concat(parts);
    else set.loops[String(newName).trim()] = parts;
    changed = true;
  }
  return changed;
}

export function cageParts(set, cageName) {
  if (!set) return [];
  const key = normalise(cageName);
  for (const [name, parts] of Object.entries(set.loops)) {
    if (normalise(name) === key) return parts;
  }
  return [];
}

// map.js's loops Map as a plain { "<cage name>": parts }, for "start from current lines".
// The shipped loops are traced every few metres (City has 332 points), far too
// many handles to edit by finger, so copies are thinned to points within
// SIMPLIFY_M of the original line (the lines are only good to ±0.3 km anyway).
export const SIMPLIFY_M = 50;

export function builtinLoops(loopsMap, cages) {
  const out = {};
  for (const [key, loop] of loopsMap) {
    const cage = cages.find(c => normalise(c.name) === key);
    out[cage ? cage.name : key] = loop.parts.map(part => simplifyPart(part, SIMPLIFY_M));
  }
  return out;
}

// Douglas-Peucker on a flat local projection (metres). Returns a new array;
// a part that would drop under 3 points is copied unchanged.
export function simplifyPart(points, tolerance) {
  if (points.length < 4) return deepCopy(points);
  const lat0 = points[0][0] * Math.PI / 180;
  const xy = points.map(([lat, lng]) => [lng * 111320 * Math.cos(lat0), lat * 110540]);
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const todo = [[0, points.length - 1]];
  while (todo.length) {
    const [s, e] = todo.pop();
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let far = 0, at = -1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i];
      const d = len ? Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len : Math.hypot(x - x1, y - y1);
      if (d > far) { far = d; at = i; }
    }
    if (far > tolerance) {
      keep[at] = true;
      todo.push([s, at], [at, e]);
    }
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 3 ? deepCopy(out) : deepCopy(points);
}
