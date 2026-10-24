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
  sheetNameClash(data, name, null);
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
  sheetNameClash(data, newName, cage);
  movePostcodes(data, cage.name, newName);
  // The first name is kept so its sheet suburbs still count as on the sheets.
  if (!cage.sheetName && normalise(cage.name) !== normalise(newName)) cage.sheetName = cage.name;
  cage.name = newName;
  data.cages.sort((a, b) => a.name.localeCompare(b.name));
}

// A renamed cage still owns its sheet name (for the on-the-sheets check), so no
// other cage may take it, or that sheet's suburbs would count in both.
function sheetNameClash(data, name, self) {
  const other = data.cages.find(c => c !== self && typeof c.sheetName === 'string' && normalise(c.sheetName) === normalise(name));
  if (other) throw new Error(`"${name}" is the sheet name of ${other.name}. Pick another name`);
}

export function setCageColor(cage, color) {
  cage.color = color;
}

export function removeSuburbFromCage(data, cage, suburb) {
  cage.suburbs = cage.suburbs.filter(s => s !== suburb);
  for (const map of [data.postcodes, data.approvals]) if (map) delete map[postcodeKey(suburb, cage.name)];
}

export function deleteCage(data, cage) {
  data.cages = data.cages.filter(c => c !== cage);
  const tail = '|' + normalise(cage.name);
  for (const map of [data.postcodes, data.approvals]) {
    for (const k of Object.keys(map || {})) if (k.endsWith(tail)) delete map[k];
  }
}

// Swap the contents of `data` in place so anything holding a reference still sees the new data.
export function replaceData(data, source) {
  data.version = 1;
  data.sheetVersion = source.sheetVersion || 1;
  data.cages = source.cages;
  data.local = source.local || [];
  // Older exports and the sheet defaults haven't had data/unsure.json applied yet.
  data.unsureApplied = Number(source.unsureApplied) || 0;
  data.renamesApplied = Number(source.renamesApplied) || 0;
  // Keep only well-formed entries, so a hand-edited import can't break search.
  data.postcodes = {};
  if (source.postcodes && typeof source.postcodes === 'object') {
    for (const [k, v] of Object.entries(source.postcodes)) {
      if (typeof v === 'string' && (v === '' || POSTCODE.test(v)) && k.includes('|')) data.postcodes[k] = v;
    }
  }
  data.approvals = {};
  if (source.approvals && typeof source.approvals === 'object') {
    for (const [k, v] of Object.entries(source.approvals)) {
      if (k.includes('|') && typeof v?.by === 'string' && v.by.trim() && typeof v.at === 'string') {
        data.approvals[k] = { by: v.by.trim().slice(0, APPROVER_MAX), at: v.at.slice(0, 10) };
      }
    }
  }
}

// Who said a suburb that isn't on the sheets goes in a cage, so a wrong one can
// be traced back. Keyed like postcodes ("suburb|cage"): { by, at: 'YYYY-MM-DD' }.
export const APPROVER_MAX = 60;
export function checkApprover(by) {
  by = String(by || '').trim();
  if (by.length > APPROVER_MAX) throw new Error(`Approved by is too long (max ${APPROVER_MAX} letters)`);
  return by;
}
// Empty `by` removes the approval. Re-saving the same name keeps the first date.
export function setApproval(data, suburb, cageName, by) {
  by = checkApprover(by);
  const key = postcodeKey(suburb, cageName);
  data.approvals ||= {};
  if (!by) {
    delete data.approvals[key];
    return;
  }
  const prev = data.approvals[key];
  data.approvals[key] = { by, at: prev?.by === by ? prev.at : new Date().toLocaleDateString('en-CA') };
}
export function approvalOf(data, suburb, cageName) {
  return data.approvals?.[postcodeKey(suburb, cageName)];
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

// Default cage names changed after phones already had the data. Each rename
// runs once per device (newest id saved as data.renamesApplied), and only if a
// cage still has the old name, so a name chosen on the device stays.
export const CAGE_RENAMES = [
  { id: 1, from: 'Kadina', to: 'Kadina / Yorke Peninsula' },
];
export function applyRenames(data) {
  let changed = false;
  for (const r of CAGE_RENAMES) {
    if (r.id <= (data.renamesApplied || 0)) continue;
    const cage = findCage(data, r.from);
    if (cage && !findCage(data, r.to)) renameCage(data, cage, r.to);
    data.renamesApplied = r.id;
    changed = true;
  }
  return changed;
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
      if (data.approvals) delete data.approvals[postcodeKey(onCage, cage.name)];
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

// Postcodes and approvals follow a renamed cage.
function movePostcodes(data, oldCage, newCage) {
  const from = '|' + normalise(oldCage), to = '|' + normalise(newCage);
  if (from === to) return;
  for (const map of [data.postcodes, data.approvals]) {
    for (const [k, v] of Object.entries(map || {})) {
      if (!k.endsWith(from)) continue;
      delete map[k];
      map[k.slice(0, -from.length) + to] = v;
    }
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
