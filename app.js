import { buildIndex, search, normalise, similarPlaces } from './js/match.js';
import { loadData, saveData, addCage, addSuburbToCage, sheetUpdateAvailable, LOCAL_COLOR, POSTCODE, setPostcode, postcodeKey, LOCAL_DEST } from './js/store.js';
import { openManage } from './js/manage.js';
import { initPhotos, photoUrl } from './js/photos.js';

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
  showView,
  showResult,
  showMessage,
  openAddDialog,
  openPhoto,
  postcodeOf,
  isEstimated,
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
// never needs a reset): postcodes we're sure of, and cages that are estimates.
const ref = { postcodes: {}, estimated: new Set() };
async function loadReference() {
  const get = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [pc, est] = await Promise.all([get('data/postcodes.json'), get('data/estimated.json')]);
  ref.postcodes = pc?.postcodes || {};
  ref.estimated = new Set((est?.cages || []).map(normalise));
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
  for (const place of places) {
    for (const d of place.destinations) {
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
        el('span', { className: 'count', textContent: postcodesFor(place).join(' / ') }),
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
    if (codes.length) band.append(el('div', { className: 'postcode', textContent: `Postcode ${codes.join(' / ')}` }));
    band.append(cage);
    if (d.type === 'local') {
      band.append(el('div', { className: 'note-line', textContent: 'Adelaide metro · cage not set yet' }));
    }
    if (d.type === 'cage' && isEstimated(d.cage)) {
      band.append(el('div', { className: 'note-line est', textContent: 'Estimated from the region map, check the map' }));
    }
    const photo = d.type === 'cage' && photoUrl(d.cage);
    if (photo) {
      const thumb = el('button', { className: 'result-photo', type: 'button' }, el('img', { src: photo, alt: '' }));
      thumb.setAttribute('aria-label', `Show the ${d.cage} sheet`);
      thumb.addEventListener('click', () => openPhoto(photo));
      band.append(thumb);
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

  showView('result');
  $('btn-next').focus();
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
    if (cageName === NEW_CAGE) {
      cageName = $('add-new-name').value.trim();
      addCage(app.data, cageName, $('add-new-color').value);
    }
    addSuburbToCage(app.data, suburb, cageName);
    if (postcode) setPostcode(app.data, suburb, cageName, postcode);
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

async function start() {
  app.data = await loadData();
  app.refresh();
  await loadReference();
  // Not awaited: if IndexedDB stalls (some iOS versions), search must still
  // work. The note redraws with thumbnails once photos are in.
  // Only redraw if there's something to show, so a cage opened meanwhile stays open.
  initPhotos().then(count => { if (count && !$('manage-root').hidden) showNote(); });

  $('photo-img').addEventListener('click', onPhotoTap);
  $('btn-photo-close').addEventListener('click', () => $('dlg-photo').close());

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
