// Suburb -> cage matching. Pure functions, no DOM, so tests.html can run them directly.

const ABBREVIATIONS = { pt: 'port', mt: 'mount', nth: 'north', sth: 'south', stn: 'station' };

// Lowercase, drop accents/punctuation, expand Pt/Mt, then remove spaces.
export function normalise(text) {
  const words = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
    if (!byKey.has(key)) add(cage.name, { type: 'cage', cage: cage.name, color: cage.color, cageTown: true });
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

// Pull likely place names out of messy OCR text: each line, and every
// run of 1-4 words within a line, with digits and state codes stripped.
export function ocrCandidates(text) {
  const out = new Set();
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const words = line
      .replace(/\b(SA|VIC|NSW|QLD|WA|NT|TAS|ACT|AUSTRALIA)\b/gi, ' ')
      .replace(/[^A-Za-z'\-\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        out.add(words.slice(i, i + n).join(' '));
      }
    }
  }
  return [...out];
}

// Match OCR'd sticker text. Only exact or close-whole-word matches count here;
// prefix/substring hits would make every short OCR fragment look like a suburb.
// Returns { confident, candidates: [place...] } with up to 3 candidates.
export function matchOcr(index, text) {
  const best = new Map();
  for (const candidate of ocrCandidates(text)) {
    const q = normalise(candidate);
    if (q.length < 3) continue;
    const typos = allowedTypos(q.length);
    for (const place of index) {
      let score = 0;
      if (place.key === q) score = 1;
      else if (typos > 0 && Math.abs(place.key.length - q.length) <= typos) {
        const d = editDistance(q, place.key);
        if (d <= typos) score = 0.9 - 0.25 * (d / Math.max(1, typos));
      }
      // Longer matches are more trustworthy than short ones.
      if (score > 0) score += Math.min(q.length, 15) * 0.002;
      if (score > (best.get(place.key)?.score || 0)) best.set(place.key, { ...place, score });
    }
  }
  const candidates = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  const [top, second] = candidates;
  // Exact hits score ~1; one typo in a 7+ letter name scores ~0.78.
  const confident = !!top && top.score >= 0.75 && (!second || top.score - second.score >= 0.15);
  return { confident, candidates };
}
