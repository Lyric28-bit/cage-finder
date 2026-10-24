// Suburb -> cage matching. Pure functions, no DOM, so tests.html can run them directly.

const ABBREVIATIONS = { pt: 'port', mt: 'mount', nth: 'north', sth: 'south', stn: 'station' };

// Lowercase, drop accents/punctuation, expand Pt/Mt, then remove spaces.
export function normalise(text) {
  const words = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents left by NFKD
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => ABBREVIATIONS[w] || w);
  return words.join('');
}

// Damerau-Levenshtein (optimal string alignment) distance.
export function editDistance(a, b) {
  const rows = a.length + 1, cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => {
    const r = new Array(cols).fill(0);
    r[0] = i;
    return r;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

// How many typos we forgive for a word of this length.
function allowedTypos(len) {
  if (len < 4) return 0;
  if (len < 7) return 1;
  if (len < 11) return 2;
  return 3;
}

// data: { cages: [{ name, color, suburbs: [] }], local: [{ name, postcode }] }
// Returns an index of places, each with every destination it maps to.
export function buildIndex(data) {
  const byKey = new Map();
  const add = (name, dest) => {
    const key = normalise(name);
    if (!key) return;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, name, destinations: [] };
      byKey.set(key, entry);
    }
    const already = entry.destinations.some(d =>
      d.type === dest.type && d.cage === dest.cage && d.postcode === dest.postcode);
    if (!already) entry.destinations.push(dest);
  };

  for (const cage of data.cages || []) {
    for (const suburb of cage.suburbs || []) {
      add(suburb, { type: 'cage', cage: cage.name, color: cage.color });
    }
  }
  for (const place of data.local || []) {
    add(place.name, { type: 'local', postcode: place.postcode });
  }
  // Cage towns themselves (Berri, Renmark...) are rarely on their own sheet.
  // Only add them where nothing else already claims the name.
  for (const cage of data.cages || []) {
    const key = normalise(cage.name);
    if (!byKey.has(key)) add(cage.name, { type: 'cage', cage: cage.name, color: cage.color });
  }
  return [...byKey.values()];
}

// Score one place against a normalised query. 0 = no match, 1 = exact.
function scorePlace(q, key) {
  if (key === q) return 1;
  if (key.startsWith(q)) return 0.9 + 0.09 * (q.length / key.length);
  if (q.length >= 3 && key.includes(q)) return 0.75;

  const typos = allowedTypos(q.length);
  if (typos === 0) return 0;
  const full = editDistance(q, key);
  if (full <= typos) return 0.85 - 0.1 * full;
  // Partly typed with a typo, e.g. "jamst" -> "jamestown".
  if (key.length > q.length) {
    const prefix = editDistance(q, key.slice(0, q.length));
    if (prefix <= Math.min(typos, 1)) return 0.6 - 0.1 * prefix;
  }
  return 0;
}

// Type-ahead search. Returns up to `limit` places, best first.
export function search(index, query, limit = 8) {
  const q = normalise(query);
  if (!q) return [];
  const hits = [];
  for (const place of index) {
    const score = scorePlace(q, place.key);
    if (score > 0) hits.push({ ...place, score });
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

// Look-alike names that go somewhere else, e.g. Enfield (LOCAL) vs Penfield
// (North Cartons): one letter apart, or two when both are 6+ letters.
// Shown on the result so a misread sticker gets a second look.
export function similarPlaces(index, place) {
  const where = p => p.destinations.map(d => d.type === 'local' ? 'LOCAL' : d.cage).sort().join('|');
  const mine = where(place);
  return index.filter(p => {
    if (p.key === place.key || where(p) === mine) return false;
    if (Math.abs(p.key.length - place.key.length) > 2) return false;
    const d = editDistance(place.key, p.key);
    return d === 1 || (d === 2 && Math.min(p.key.length, place.key.length) >= 6);
  }).sort((a, b) => a.name.localeCompare(b.name));
}
