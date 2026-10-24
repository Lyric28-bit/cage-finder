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
  cage.name = newName;
  data.cages.sort((a, b) => a.name.localeCompare(b.name));
}

export function setCageColor(cage, color) {
  cage.color = color;
}

export function removeSuburbFromCage(cage, suburb) {
  cage.suburbs = cage.suburbs.filter(s => s !== suburb);
}

export function deleteCage(data, cage) {
  data.cages = data.cages.filter(c => c !== cage);
}

// Swap the contents of `data` in place so anything holding a reference still sees the new data.
export function replaceData(data, source) {
  data.version = 1;
  data.sheetVersion = source.sheetVersion || 1;
  data.cages = source.cages;
  data.local = source.local || [];
  data.postcodes = source.postcodes && typeof source.postcodes === 'object' ? source.postcodes : {};
}

// Postcodes typed in by hand, keyed by normalised suburb name. Saved and
// exported with the rest of the device's data. They override the shipped list;
// an empty one is stored as '' and means "no postcode".
export const POSTCODE = /^\d{4}$/;
export function setPostcode(data, suburb, postcode) {
  postcode = String(postcode || '').trim();
  if (postcode && !POSTCODE.test(postcode)) throw new Error('Postcode must be 4 digits');
  data.postcodes ||= {};
  data.postcodes[normalise(suburb)] = postcode;
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
