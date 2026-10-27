import { buildIndex, search, normalise, similarPlaces } from './js/match.js';
import { loadData, saveData, addCage, addSuburbToCage, applyUnsure, applyRenames, CAGE_RENAMES, findCage, sheetUpdateAvailable, LOCAL_COLOR, POSTCODE, setPostcode, postcodeKey, LOCAL_DEST, checkApprover, setApproval, approvalOf } from './js/store.js';
import { openManage } from './js/manage.js';
import { openMap } from './js/map.js';
import { initPhotos, photoUrl, renamePhoto } from './js/photos.js';

const $ = id => document.getElementById(id);

// Shared app state. manage.js (the note under the search box) gets this via `app`.
export const app = {
  data: null,
  index: [],
  refresh() {
    this.index = buildIndex(this.data);
  },
  save() {
    saveData(this.data);
    this.refresh();
  },
  // One-off data changes shipped after phones already had the data: renamed
  // default cages, and not-sure Cartons suburbs moved to Local. Each runs once.
  migrate() {
    const renamed = applyRenames(this.data);
    const unsure = applyUnsure(this.data, ref.unsure, ref.postcodes);
    return linkSheetNames() || unsure || renamed;
  },
  showView,
  showResult,
  showMessage,
  openAddDialog,
  openPhoto,
  postcodeOf,
  isEstimated,
  estTag,
  postcodeRange,
  openEstimate,
  mapArea,
  openMap: opts => openMap(app, opts),
  onSheet,
  approvalText,
};

// ---------- helpers ----------

// Black or white text, whichever reads better on this background.
export function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0.179 is where black and white text have equal contrast.
  return lum > 0.179 ? '#111418' : '#FFFFFF';
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function chipFor(dest) {
  const bg = dest.type === 'local' ? LOCAL_COLOR : dest.color;
  const label = dest.type === 'local' ? 'LOCAL' : dest.cage;
  const chip = el('span', { className: 'chip', textContent: label });
  chip.style.background = bg;
  chip.style.color = textColorFor(bg);
  return chip;
}

// ---------- views ----------

// Result gets a history entry so the phone's Back button returns
// to search instead of closing the app.
function showView(name, { focus = true, fromHistory = false } = {}) {
  if (!fromHistory) {
    const current = history.state?.view;
    if (name === 'search' && current) history.back(); // popstate re-runs showView
    else if (name !== 'search' && current !== name) {
      if (current) history.replaceState({ view: name }, '');
      else history.pushState({ view: name }, '');
    }
  }
  for (const v of ['search', 'result']) $('view-' + v).hidden = v !== name;
  if (name === 'search' && focus) $('search').focus();
}

// Short note above the suggestions (e.g. new sheet data available).
function showMessage(text) {
  $('message').textContent = text || '';
  $('message').hidden = !text;
}

function nextBox() {
  $('search').value = '';
  showMessage('');
  renderSuggestions([]);
  showNote();
  showView('search');
}

// The note (cage list) shows while the search box is empty, so typing swaps
// it for the matches. Rebuilt on show so edits made elsewhere appear.
function showNote() {
  openManage(app);
  $('manage-root').hidden = false;
}

function toggleMenu(open = $('menu').hidden) {
  $('menu').hidden = !open;
  $('btn-menu').setAttribute('aria-expanded', String(open));
}

// ---------- search ----------

const MATCH_LIMIT = 30;

// Shipped reference data (not part of the editable cage data, so updating it
// never needs a reset): postcodes we're sure of, cages that are estimates, and
// Cartons suburbs we're not sure of. `areas`: per estimated cage, the postcodes
// inside its region map's drawn loop (normalised cage name -> [{ code, suburbs }]).
const ref = { postcodes: {}, estimated: new Set(), areas: new Map(), unsure: null };
async function loadReference() {
  const get = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [pc, est, unsure, sheet] = await Promise.all([get('data/postcodes.json'), get('data/estimated.json'),
    get('data/unsure.json'), get('data/cages.json')]);
  ref.postcodes = pc?.postcodes || {};
  ref.estimated = new Set((est?.cages || []).map(normalise));
  ref.areas = new Map(Object.entries(est?.areas || {})
    .filter(([, codes]) => Array.isArray(codes) && codes.length)
    .map(([cage, codes]) => [normalise(cage), codes]));
  ref.unsure = unsure;
  // What the printed sheets say: cage -> suburbs. Suburbs taken off as not sure
  // (unsure.json) don't count, so moving one back still needs an approval.
  ref.sheet = sheet?.cages ? new Map(sheet.cages.map(c => [normalise(c.name), new Set(c.suburbs.map(normalise))])) : null;
  ref.sheetTitle = new Map((sheet?.cages || []).map(c => [normalise(c.name), c.name]));
  for (const [cage, names] of Object.entries(unsure?.cages || {})) {
    for (const n of names) ref.sheet?.get(normalise(cage))?.delete(normalise(n));
  }
}

// Cages renamed before v19 have no sheetName, so all their sheet suburbs would
// look added by hand. Link each to the unclaimed sheet cage it shares most
// suburbs with, if that's over half of them. Runs every start; only fills gaps.
function linkSheetNames() {
  if (!ref.sheet) return false;
  let changed = false;
  const taken = new Set(app.data.cages.flatMap(c => [normalise(c.name), normalise(c.sheetName || '')]));
  for (const cage of app.data.cages) {
    if (cage.sheetName || ref.sheet.has(normalise(cage.name)) || !cage.suburbs.length) continue;
    const subs = cage.suburbs.map(normalise);
    let best = null, bestN = 0;
    for (const [name, set] of ref.sheet) {
      if (taken.has(name)) continue;
      const n = subs.filter(s => set.has(s)).length;
      if (n > bestN) { best = name; bestN = n; }
    }
    if (best && bestN * 2 > subs.length) {
      cage.sheetName = ref.sheetTitle.get(best);
      taken.add(best);
      changed = true;
    }
  }
  return changed;
}

// Is this suburb in this cage on the sheets? A cage renamed on the device still
// matches its first name. If the sheet list didn't load, don't flag anything.
function onSheet(suburb, cageName) {
  if (!ref.sheet) return true;
  const cage = findCage(app.data, cageName);
  const names = [cageName, typeof cage?.sheetName === 'string' ? cage.sheetName : ''];
  return names.some(n => ref.sheet.get(normalise(n))?.has(normalise(suburb)));
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "Not on the sheets · approved by Dave, 24 Oct 2026", or the warning when no one
// is recorded. '' for sheet suburbs with no approval.
function approvalText(suburb, cageName) {
  const a = approvalOf(app.data, suburb, cageName);
  const off = !onSheet(suburb, cageName);
  if (a) return `${off ? 'Not on the sheets · approved' : 'Approved'} by ${a.by}, ${shortDate(a.at)}`;
  return off ? 'Not on the sheets · no approval noted' : '';
}

// Postcode(s) for one destination of a place. A typed-in postcode wins ('' means
// "none"); otherwise a Local entry uses its own, a cage uses the shipped list.
// Per destination because e.g. Happy Valley LOCAL (5159) and Happy Valley on the
// Mildura sheet are different places.
function postcodesAt(place, d) {
  const own = app.data.postcodes?.[postcodeKey(place.name, d.type === 'local' ? LOCAL_DEST : d.cage)];
  if (own !== undefined) return own ? [own] : [];
  if (d.type === 'local') return d.postcode ? [String(d.postcode)] : [];
  return ref.postcodes[place.key] || [];
}

// Every postcode the place could have, for search and prefill.
function postcodesFor(place) {
  return [...new Set(place.destinations.flatMap(d => postcodesAt(place, d)))];
}

// Postcode for one name at one destination (a cage name, or LOCAL_DEST).
function postcodeOf(name, dest) {
  const place = app.index.find(p => p.key === normalise(name));
  const d = place?.destinations.find(x => (dest === LOCAL_DEST ? x.type === 'local' : x.cage === dest));
  return d ? postcodesAt(place, d) : [];
}

function isEstimated(cageName) {
  return ref.estimated.has(normalise(cageName));
}

// The region map's postcodes for an estimated cage, or null.
function mapArea(cageName) {
  return isEstimated(cageName) ? ref.areas.get(normalise(cageName)) || null : null;
}

// Lowest to highest postcode of a cage ("5000–5082"), or ''. Estimated cages
// use the region map's postcodes; otherwise worked out live from the suburbs,
// so moves and typed-in postcodes show straight away.
function postcodeRange(cageName) {
  const area = mapArea(cageName);
  let codes;
  if (area) codes = area.map(a => Number(a.code));
  else {
    const cage = findCage(app.data, cageName);
    if (!cage) return '';
    codes = cage.suburbs.flatMap(s => postcodeOf(s, cage.name)).map(Number);
  }
  codes = codes.filter(Boolean);
  if (!codes.length) return '';
  const lo = Math.min(...codes), hi = Math.max(...codes);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

// Postcodes as runs: 5000, 5006–5007, 5061–5069.
function compactCodes(codes) {
  const nums = [...new Set(codes.map(Number))].sort((a, b) => a - b);
  const runs = [];
  for (const n of nums) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

// "EST" after a postcode on an estimated (Cartons) cage, or nothing.
// `tap`: a button that opens the map's postcodes (only outside other buttons).
function estTag(cageName, { tap = false } = {}) {
  if (!cageName || cageName === LOCAL_DEST || !isEstimated(cageName)) return '';
  if (!tap || !mapArea(cageName)) return el('span', { className: 'est-tag', textContent: 'EST' });
  const btn = el('button', { className: 'est-tag est-btn', type: 'button', textContent: 'EST' });
  btn.setAttribute('aria-label', `EST: postcodes on the ${cageName} map`);
  btn.addEventListener('click', () => openEstimate(cageName));
  return btn;
}

// Box listing every postcode inside the cage's region map, with its suburbs.
// Suburbs not on this cage on this device are greyed; ones on the line get *.
function openEstimate(cageName) {
  const area = mapArea(cageName);
  if (!area) return;
  const cage = findCage(app.data, cageName);
  const onCage = new Set((cage?.suburbs || []).map(normalise));
  $('est-title').textContent = cage?.name || cageName;
  $('est-codes').textContent = compactCodes(area.map(a => a.code));
  $('est-list').replaceChildren(...area.map(a => el('li', {},
    el('span', { className: 'est-code', textContent: a.code }),
    el('span', { className: 'est-subs' }, ...a.suburbs.flatMap((s, i) => [
      i ? ', ' : '',
      el('span', { className: onCage.has(normalise(s.name)) ? '' : 'off', textContent: s.name + (s.edge ? '*' : '') }),
    ])))));
  $('est-list').scrollTop = 0;
  $('dlg-est').showModal();
}

// Name with the typed letters marked, when they appear as typed.
// Typo / Pt-Mt matches just show the plain name.
function highlighted(name, query) {
  const q = query.trim();
  const at = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const span = el('span', { className: 'grow' });
  if (at < 0) span.textContent = name;
  else span.append(name.slice(0, at), el('mark', { textContent: name.slice(at, at + q.length) }), name.slice(at + q.length));
  return span;
}

// While typing, the note filters in place: matches grouped under their cage
// (or Local), best-matching cage first. Drawn with the note's own classes so
// it reads as the same note, not a new page.
function renderSuggestions(places, query = '') {
  const box = $('note-results');
  box.replaceChildren();
  box.hidden = !places.length;
  const groups = new Map(); // cage name or LOCAL -> { item, list }
  // Postcode search: only list a place under the cages whose own postcode
  // matches, e.g. 5159 is Happy Valley LOCAL, not the Mildura one.
  const digits = /^\d{3,4}$/.test(query.trim()) ? query.trim() : '';
  for (const place of places) {
    for (const d of place.destinations) {
      const codes = postcodesAt(place, d);
      if (digits && !codes.some(c => c.startsWith(digits))) continue;
      const key = d.type === 'local' ? 'LOCAL' : d.cage;
      if (!groups.has(key)) {
        const swatch = el('span', { className: 'm-swatch' });
        let title, count;
        if (d.type === 'local') {
          swatch.classList.add('empty');
          title = 'Local (Adelaide metro)';
          count = (app.data.local || []).length;
        } else {
          swatch.style.background = d.color;
          title = d.cage;
          count = app.data.cages.find(c => c.name === d.cage)?.suburbs.length ?? '';
        }
        const name = el('span', { className: 'grow', textContent: title });
        if (d.type === 'cage' && isEstimated(d.cage)) name.append(el('span', { className: 'est-tag', textContent: 'est.' }));
        const head = el('div', { className: 'm-head m-group' }, swatch, name,
          el('span', { className: 'count', textContent: String(count) }));
        // Keep the cage's sheet thumbnail while searching; here a tap views it.
        const photo = d.type === 'cage' && photoUrl(d.cage);
        if (photo) {
          const thumb = el('button', { className: 'm-photo', type: 'button' }, el('img', { src: photo, alt: '' }));
          thumb.setAttribute('aria-label', `Show the ${d.cage} sheet`);
          thumb.addEventListener('click', () => openPhoto(photo));
          head.append(thumb);
        }
        const item = el('div', { className: 'm-item' }, head);
        item.dataset.cage = key;
        groups.set(key, item);
        box.append(item);
      }
      const btn = el('button', { className: 'suggestion', type: 'button' },
        highlighted(place.name, query),
        el('span', { className: 'count', textContent: codes.join(' / ') },
          codes.length ? estTag(d.cage) : ''),
        el('span', { className: 'chev', textContent: '›' }));
      btn.addEventListener('click', () => showResult(place, { typed: query }));
      groups.get(key).append(btn);
    }
  }
  if (places.length) {
    box.prepend(
      el('h2', { className: 'note-title', textContent: 'Cages' }),
      el('p', { className: 'note-meta', textContent: places.length >= MATCH_LIMIT
        ? `Top ${MATCH_LIMIT} matches, keep typing to narrow it down`
        : `${places.length} match${places.length === 1 ? '' : 'es'}` }));
  }
  const showNotFound = places.length === 0 && normalise(query).length >= 3;
  $('not-found').hidden = !showNotFound;
  $('not-found-text').textContent = query.trim();
}

function onSearchInput() {
  const q = $('search').value;
  showMessage('');
  // All digits: search by postcode instead of name.
  const digits = q.trim();
  const places = /^\d{3,4}$/.test(digits)
    ? app.index.filter(p => postcodesFor(p).some(c => c.startsWith(digits))).slice(0, MATCH_LIMIT)
    : search(app.index, q, MATCH_LIMIT);
  renderSuggestions(places, q);
  if (q.trim()) $('manage-root').hidden = true;
  else showNote();
}

// ---------- result ----------

// `typed` is the search text that led here, if any. When the match was a
// typo correction rather than the start of the name, say so.
function showResult(place, { typed = '' } = {}) {
  const q = normalise(typed);
  $('result-typed').hidden = !q || place.key.includes(q);
  $('result-typed').textContent = `You typed "${typed.trim()}", showing ${place.name}. Check it's the right place.`;

  const bands = $('result-bands');
  bands.replaceChildren();
  bands.classList.toggle('multi', place.destinations.length > 1);
  for (const d of place.destinations) {
    const codes = postcodesAt(place, d);
    const bg = d.type === 'local' ? LOCAL_COLOR : d.color;
    const cage = el('div', { className: 'cage', textContent: d.type === 'local' ? 'LOCAL' : d.cage });
    cage.style.background = bg;
    cage.style.color = textColorFor(bg);
    const band = el('div', { className: 'band' },
      el('div', { className: 'suburb', textContent: place.name }));
    if (codes.length) band.append(el('div', { className: 'postcode', textContent: `Postcode ${codes.join(' / ')}` }, estTag(d.cage, { tap: true })));
    band.append(cage);
    if (d.type === 'local') {
      band.append(el('div', { className: 'note-line', textContent: 'Adelaide metro · cage not set yet' }));
    }
    if (d.type === 'cage' && isEstimated(d.cage)) {
      band.append(el('div', { className: 'note-line est', textContent: 'Estimated from the region map, check the map' }));
    }
    const approval = d.type === 'cage' ? approvalText(place.name, d.cage) : '';
    if (approval) {
      band.append(el('div', { className: 'note-line approval' + (approvalOf(app.data, place.name, d.cage) ? '' : ' missing'), textContent: approval }));
    }
    const photo = d.type === 'cage' && photoUrl(d.cage);
    if (photo) {
      const thumb = el('button', { className: 'result-photo', type: 'button' }, el('img', { src: photo, alt: '' }));
      thumb.setAttribute('aria-label', `Show the ${d.cage} sheet`);
      thumb.addEventListener('click', () => openPhoto(photo));
      const hint = el('div', { className: 'photo-hint', textContent: 'Click to zoom' });
      hint.addEventListener('click', () => openPhoto(photo));
      band.append(thumb, hint);
    }
    const range = d.type === 'cage' && isEstimated(d.cage) ? postcodeRange(d.cage) : '';
    if (range) band.append(el('div', { className: 'cage-range', textContent: `Cage postcodes ${range}` }, estTag(d.cage, { tap: true })));
    if (d.type === 'cage' && mapArea(d.cage)) {
      const showMap = el('button', { className: 'btn-secondary result-map', type: 'button', textContent: 'Show on map' });
      showMap.addEventListener('click', () => openMap(app, { suburb: place.name, cage: d.cage }));
      band.append(showMap);
    }
    bands.append(band);
  }

  const warn = $('result-warning');
  warn.hidden = place.destinations.length < 2;
  warn.textContent = `⚠ ${place.name} is on ${place.destinations.length} lists. Check the address.`;

  const similar = similarPlaces(app.index, place);
  const sim = $('result-similar');
  sim.hidden = !similar.length;
  sim.replaceChildren(
    el('div', { className: 'similar-title', textContent: '⚠ Similar name, check the label:' }),
    ...similar.map(p => {
      const chips = el('span', { className: 'chips' });
      for (const d of p.destinations) chips.append(chipFor(d));
      // Tap to open the look-alike's own result.
      const row = el('button', { className: 'similar-row', type: 'button' },
        el('span', { className: 'grow', textContent: p.name }), chips, el('span', { className: 'chev', textContent: '›' }));
      row.addEventListener('click', () => showResult(p));
      return row;
    }));

  const hasLocal = place.destinations.some(d => d.type === 'local');
  const moveBtn = $('btn-result-move');
  moveBtn.hidden = !hasLocal;
  moveBtn.onclick = () => openAddDialog(place.name, { move: true });

  // With a sheet photo, "Check picture" stands in for Done until the photo has
  // been opened and closed (see the dlg-photo close listener).
  const firstPhoto = place.destinations.map(d => d.type === 'cage' && photoUrl(d.cage)).find(Boolean);
  $('btn-check-photo').hidden = !firstPhoto;
  $('btn-check-photo').onclick = () => openPhoto(firstPhoto);
  $('btn-next').hidden = !!firstPhoto;

  showView('result');
  $(firstPhoto ? 'btn-check-photo' : 'btn-next').focus();
}

// ---------- sheet photo viewer ----------

// Opens fitted to the screen; a tap zooms to full size around that spot
// (then drag/scroll to read), another tap fits it again.
function openPhoto(url) {
  const box = $('photo-box'), img = $('photo-img');
  img.src = url;
  box.classList.remove('zoomed');
  $('dlg-photo').showModal();
}

function onPhotoTap(event) {
  const box = $('photo-box'), img = $('photo-img');
  if (box.classList.contains('zoomed')) {
    box.classList.remove('zoomed');
    return;
  }
  const r = img.getBoundingClientRect();
  const fx = (event.clientX - r.left) / r.width, fy = (event.clientY - r.top) / r.height;
  box.classList.add('zoomed');
  box.scrollLeft = fx * img.offsetWidth - box.clientWidth / 2;
  box.scrollTop = fy * img.offsetHeight - box.clientHeight / 2;
}

// ---------- add / move dialog ----------

const NEW_CAGE = '__new__';

function openAddDialog(suburb = '', { move = false } = {}) {
  $('dlg-add-title').textContent = move ? 'Move to cage' : 'Add to a cage';
  $('add-suburb').value = suburb.trim();
  $('add-suburb').readOnly = move;
  $('add-error').hidden = true;
  // A move off the Local list keeps the Local postcode (same place, new cage).
  // Otherwise start blank: another cage's postcode may be a different place.
  const codes = move ? postcodeOf(suburb, LOCAL_DEST) : [];
  $('add-postcode').value = codes.length === 1 ? codes[0] : '';
  $('add-approver').value = '';

  const select = $('add-cage');
  select.replaceChildren(
    ...app.data.cages.map(c => el('option', { value: c.name, textContent: c.name })),
    el('option', { value: NEW_CAGE, textContent: '+ New cage…' }));
  $('add-new-name').value = '';
  $('add-new-cage').hidden = true;

  $('dlg-add').showModal();
}

function onAddCageChange() {
  const isNew = $('add-cage').value === NEW_CAGE;
  $('add-new-cage').hidden = !isNew;
  if (isNew) $('add-new-name').focus();
}

function onAddSubmit(event) {
  event.preventDefault();
  const suburb = $('add-suburb').value.trim();
  let cageName = $('add-cage').value;
  const postcode = $('add-postcode').value.trim();
  try {
    if (postcode && !POSTCODE.test(postcode)) throw new Error('Postcode must be 4 digits');
    const isNew = cageName === NEW_CAGE;
    if (isNew) cageName = $('add-new-name').value.trim();
    const approver = checkApprover($('add-approver').value);
    if (!approver && (isNew || !onSheet(suburb, cageName))) throw new Error('Type who approved it (not on the sheets)');
    if (isNew) addCage(app.data, cageName, $('add-new-color').value);
    addSuburbToCage(app.data, suburb, cageName);
    if (postcode) setPostcode(app.data, suburb, cageName, postcode);
    if (approver) setApproval(app.data, suburb, cageName, approver);
  } catch (err) {
    $('add-error').textContent = err.message;
    $('add-error').hidden = false;
    return;
  }
  app.save();
  $('dlg-add').close();
  const place = app.index.find(p => p.key === normalise(suburb));
  if (place) showResult(place);
}

// ---------- start ----------

// A default cage renamed by CAGE_RENAMES keeps its photo. Checked every start
// (photos load after the data), so a move that didn't finish is retried.
async function movePhotosOfRenamedCages() {
  for (const r of CAGE_RENAMES) {
    if (photoUrl(r.from) && !photoUrl(r.to) && !findCage(app.data, r.from) && findCage(app.data, r.to)) {
      await renamePhoto(r.from, r.to).catch(() => {});
    }
  }
}

async function start() {
  app.data = await loadData();
  app.refresh();
  await loadReference();
  if (app.migrate()) app.save();
  // Not awaited: if IndexedDB stalls (some iOS versions), search must still
  // work. The note redraws with thumbnails once photos are in.
  // Only redraw if there's something to show, so a cage opened meanwhile stays open.
  initPhotos().then(async count => {
    await movePhotosOfRenamedCages();
    if (count && !$('manage-root').hidden) showNote();
  });

  $('photo-img').addEventListener('click', onPhotoTap);
  // After the photo is closed, "Check picture" turns into Done. Done straight
  // from the ✕ too: Chrome can fire the dialog's close event ~0.5s late.
  const photoChecked = () => {
    if ($('view-result').hidden || $('btn-check-photo').hidden) return;
    $('btn-check-photo').hidden = true;
    $('btn-next').hidden = false;
    $('btn-next').focus();
  };
  $('btn-photo-close').addEventListener('click', () => { $('dlg-photo').close(); photoChecked(); });
  $('btn-est-close').addEventListener('click', () => $('dlg-est').close());
  $('dlg-photo').addEventListener('close', photoChecked); // Esc, Back

  $('search').addEventListener('input', onSearchInput);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('note-results').querySelector('.suggestion');
      if (first) first.click();
    }
  });
  $('btn-next').addEventListener('click', nextBox);
  $('btn-add-unknown').addEventListener('click', () => openAddDialog($('search').value));
  $('add-cage').addEventListener('change', onAddCageChange);
  $('form-add').addEventListener('submit', onAddSubmit);
  $('btn-add-cancel').addEventListener('click', () => $('dlg-add').close());

  $('btn-menu').addEventListener('click', () => toggleMenu());

  window.addEventListener('popstate', e => {
    $('dlg-photo').close(); // some browsers' Back pops history without closing the dialog
    $('dlg-est').close();
    $('dlg-map').close();
    showView(e.state?.view || 'search', { fromHistory: true, focus: false });
  });

  showNote();
  showView('search');

  if (await sheetUpdateAvailable(app.data)) {
    showMessage('New sheet data is available. ⋯ → Reset to sheet data to use it (this clears your edits, so Export first).');
  }

  // Ask the browser not to clear saved cages when the device is low on space.
  Promise.resolve(navigator.storage?.persist?.()).catch(() => {});

  if ('serviceWorker' in navigator) watchForUpdates();
}

// A new deploy installs in the background and waits. Offer a button rather
// than relying on people fully closing the app.
async function watchForUpdates() {
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
  } catch (err) {
    console.warn('Offline mode unavailable:', err);
    return;
  }
  const offer = worker => {
    const btn = $('btn-update');
    btn.hidden = false;
    btn.onclick = () => {
      btn.disabled = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage('skipWaiting');
    };
  };
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
}

start();
