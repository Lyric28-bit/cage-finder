// On-device data: cages + Adelaide "local" list, saved in localStorage.
// Shape: { version: 1, sheetVersion, cages: [{ name, color, suburbs: [] }], local: [{ name, postcode }] }
// sheetVersion records which data/cages.json the device started from, so the
// app can tell when a newer sheet has been deployed.

import { normalise } from './match.js';

const KEY = 'cage-finder-data-v1';
export const LOCAL_COLOR = '#E6E6E6';
const HEX = /^#[0-9a-f]{6}$/i;

export async function loadDefaults() {
  const [cages, adelaide] = await Promise.all([
    fetch('data/cages.json').then(r => r.json()),
    fetch('data/adelaide-suburbs.json').then(r => r.json()),
  ]);
  return { version: 1, sheetVersion: cages.sheetVersion || 1, cages: cages.cages, local: adelaide.suburbs };
}

// True when the deployed cages.json is newer than what this device started from.
export async function sheetUpdateAvailable(data) {
  try {
    const shipped = (await fetch('data/cages.json').then(r => r.json())).sheetVersion || 1;
    return shipped > (data.sheetVersion || 1);
  } catch {
    return false;
  }
}

export async function loadData() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (isValid(data)) return data;
    }
  } catch { /* storage blocked or corrupt: fall back to defaults */ }
  const data = await loadDefaults();
  saveData(data);
  return data;
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function isValid(data) {
  return !!data && Array.isArray(data.cages) && data.cages.every(c =>
    typeof c.name === 'string' && HEX.test(c.color) && Array.isArray(c.suburbs))
    && (data.local === undefined || Array.isArray(data.local));
}

export function findCage(data, name) {
  return data.cages.find(c => normalise(c.name) === normalise(name));
}

export function addCage(data, name, color) {
  name = name.trim();
  if (!name) throw new Error('Cage name is empty');
  if (findCage(data, name)) throw new Error(`A cage called "${name}" already exists`);
  const cage = { name, color, suburbs: [] };
  data.cages.push(cage);
  data.cages.sort((a, b) => a.name.localeCompare(b.name));
  return cage;
}

// Add a suburb to a cage. Taking it out of the Local list is what "move" means:
// once a local suburb has a real cage it should stop showing as LOCAL.
export function addSuburbToCage(data, suburb, cageName) {
  suburb = suburb.trim();
  if (!suburb) throw new Error('Suburb name is empty');
  const cage = findCage(data, cageName);
  if (!cage) throw new Error(`No cage called "${cageName}"`);
  const key = normalise(suburb);
  if (!cage.suburbs.some(s => normalise(s) === key)) {
    cage.suburbs.push(suburb);
    cage.suburbs.sort((a, b) => a.localeCompare(b));
  }
  if (data.local) data.local = data.local.filter(p => normalise(p.name) !== key);
}

// Rename a cage. Throws on empty or if another cage already uses the name.
export function renameCage(data, cage, newName) {
  newName = newName.trim();
  if (!newName) throw new Error('Cage name is empty');
  const clash = findCage(data, newName);
  if (clash && clash !== cage) throw new Error(`A cage called "${clash.name}" already exists`);
  movePostcodes(data, cage.name, newName);
  cage.name = newName;
  data.cages.sort((a, b) => a.name.localeCompare(b.name));
}

export function setCageColor(cage, color) {
  cage.color = color;
}

export function removeSuburbFromCage(data, cage, suburb) {
  cage.suburbs = cage.suburbs.filter(s => s !== suburb);
  if (data.postcodes) delete data.postcodes[postcodeKey(suburb, cage.name)];
}

export function deleteCage(data, cage) {
  data.cages = data.cages.filter(c => c !== cage);
  const tail = '|' + normalise(cage.name);
  for (const k of Object.keys(data.postcodes || {})) if (k.endsWith(tail)) delete data.postcodes[k];
}

// Swap the contents of `data` in place so anything holding a reference still sees the new data.
export function replaceData(data, source) {
  data.version = 1;
  data.sheetVersion = source.sheetVersion || 1;
  data.cages = source.cages;
  data.local = source.local || [];
  // Older exports and the sheet defaults haven't had data/unsure.json applied yet.
  data.unsureApplied = Number(source.unsureApplied) || 0;
  // Keep only well-formed entries, so a hand-edited import can't break search.
  data.postcodes = {};
  if (source.postcodes && typeof source.postcodes === 'object') {
    for (const [k, v] of Object.entries(source.postcodes)) {
      if (typeof v === 'string' && (v === '' || POSTCODE.test(v)) && k.includes('|')) data.postcodes[k] = v;
    }
  }
}

// Postcodes typed in by hand. Saved and exported with the rest of the device's
// data and override the shipped list; '' means "no postcode". Keyed per
// destination ("suburb|cage" or "suburb|local"), because one name can be two
// places, e.g. Happy Valley LOCAL vs Happy Valley on the Mildura sheet.
export const POSTCODE = /^\d{4}$/;
export const LOCAL_DEST = 'local';
export function postcodeKey(suburb, dest) {
  return normalise(suburb) + '|' + (dest === LOCAL_DEST ? LOCAL_DEST : normalise(dest));
}
export function setPostcode(data, suburb, dest, postcode) {
  postcode = String(postcode || '').trim();
  if (postcode && !POSTCODE.test(postcode)) throw new Error('Postcode must be 4 digits');
  data.postcodes ||= {};
  data.postcodes[postcodeKey(suburb, dest)] = postcode;
}

// Cartons suburbs we're not 100% sure of (data/unsure.json) move to the Local
// list, so they show "cage not set yet" until Lyric moves them in-app. Runs once
// per list version, and only touches suburbs still on the cage the list names,
// so moves made on the device stay. `shipped` is the shipped postcode list.
export function applyUnsure(data, unsure, shipped = {}) {
  if (!unsure?.cages || !(unsure.version > (data.unsureApplied || 0))) return false;
  data.local ||= [];
  for (const [cageName, names] of Object.entries(unsure.cages)) {
    const cage = findCage(data, cageName);
    if (!cage) continue;
    for (const name of names) {
      const key = normalise(name);
      const onCage = cage.suburbs.find(s => normalise(s) === key);
      if (!onCage) continue;
      cage.suburbs = cage.suburbs.filter(s => normalise(s) !== key);
      const own = data.postcodes?.[postcodeKey(onCage, cage.name)];
      if (own !== undefined) {
        delete data.postcodes[postcodeKey(onCage, cage.name)];
        data.postcodes[postcodeKey(onCage, LOCAL_DEST)] ??= own;
      }
      if (!data.local.some(p => normalise(p.name) === key)) {
        const codes = shipped[key] || [];
        data.local.push({ name: onCage, postcode: codes.length === 1 ? codes[0] : '' });
      }
    }
  }
  data.local.sort((a, b) => a.name.localeCompare(b.name));
  data.unsureApplied = unsure.version;
  return true;
}

function movePostcodes(data, oldCage, newCage) {
  const from = '|' + normalise(oldCage), to = '|' + normalise(newCage);
  if (from === to) return;
  for (const [k, v] of Object.entries(data.postcodes || {})) {
    if (!k.endsWith(from)) continue;
    delete data.postcodes[k];
    data.postcodes[k.slice(0, -from.length) + to] = v;
  }
}

// For imports: valid shape, plus every cage suburb and local entry is well formed.
export function isImportable(data) {
  try {
    return isValid(data)
      && data.cages.every(c => c.suburbs.every(s => typeof s === 'string'))
      && (data.local || []).every(p => p && typeof p.name === 'string');
  } catch {
    return false;
  }
}
