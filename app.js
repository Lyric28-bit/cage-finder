import { buildIndex, search, normalise } from './js/match.js';
import { loadData, saveData, addCage, addSuburbToCage, LOCAL_COLOR } from './js/store.js';

const $ = id => document.getElementById(id);

// Shared app state. Other modules (manage, scan) get this via `app`.
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
  showPicker,
  openAddDialog,
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
  return lum > 0.4 ? '#111418' : '#FFFFFF';
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

function showView(name) {
  for (const v of ['search', 'result', 'manage']) $('view-' + v).hidden = v !== name;
  if (name === 'search') $('search').focus();
}

function nextBox() {
  $('search').value = '';
  renderSuggestions([]);
  showView('search');
}

// ---------- search ----------

function renderSuggestions(places, query = '') {
  const list = $('suggestions');
  list.replaceChildren();
  for (const place of places) {
    const chips = el('span', { className: 'chips' });
    if (place.destinations.length > 1) chips.append(el('span', { className: 'chip warn', textContent: `${place.destinations.length} cages` }));
    for (const d of place.destinations) chips.append(chipFor(d));
    const btn = el('button', { className: 'suggestion', type: 'button' }, el('span', { textContent: place.name }), chips);
    btn.addEventListener('click', () => showResult(place));
    list.append(el('li', {}, btn));
  }
  const showNotFound = places.length === 0 && normalise(query).length >= 3;
  $('not-found').hidden = !showNotFound;
  $('not-found-text').textContent = query.trim();
}

function onSearchInput() {
  const q = $('search').value;
  renderSuggestions(search(app.index, q), q);
}

// Shows a short list of candidates to tap (used by Scan when unsure).
function showPicker(places, heading) {
  showView('search');
  renderSuggestions(places);
  if (heading) $('search').value = heading;
}

// ---------- result ----------

function showResult(place) {
  const bands = $('result-bands');
  bands.replaceChildren();
  bands.classList.toggle('multi', place.destinations.length > 1);

  for (const d of place.destinations) {
    const bg = d.type === 'local' ? LOCAL_COLOR : d.color;
    const band = el('div', { className: 'band' },
      el('div', { className: 'suburb', textContent: place.name }),
      el('div', { className: 'cage', textContent: d.type === 'local' ? 'LOCAL' : d.cage }));
    if (d.type === 'local') {
      band.append(el('div', { className: 'note', textContent: `Adelaide metro ${d.postcode} · cage not set yet` }));
    } else if (d.cageTown) {
      band.append(el('div', { className: 'note', textContent: 'Cage town' }));
    }
    band.style.background = bg;
    band.style.color = textColorFor(bg);
    bands.append(band);
  }

  const warn = $('result-warning');
  warn.hidden = place.destinations.length < 2;
  warn.textContent = `⚠ ${place.name} is on ${place.destinations.length} lists. Check the address.`;

  const hasLocal = place.destinations.some(d => d.type === 'local');
  const moveBtn = $('btn-result-move');
  moveBtn.hidden = !hasLocal;
  moveBtn.onclick = () => openAddDialog(place.name, { move: true });

  showView('result');
  $('btn-next').focus();
}

// ---------- add / move dialog ----------

const NEW_CAGE = '__new__';

function openAddDialog(suburb = '', { move = false } = {}) {
  $('dlg-add-title').textContent = move ? 'Move to cage' : 'Add to a cage';
  $('add-suburb').value = suburb.trim();
  $('add-suburb').readOnly = move;
  $('add-error').hidden = true;

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
  try {
    if (cageName === NEW_CAGE) {
      cageName = $('add-new-name').value.trim();
      addCage(app.data, cageName, $('add-new-color').value);
    }
    addSuburbToCage(app.data, suburb, cageName);
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

  $('search').addEventListener('input', onSearchInput);
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('suggestions').querySelector('.suggestion');
      if (first) first.click();
    }
  });
  $('btn-next').addEventListener('click', nextBox);
  $('btn-add-unknown').addEventListener('click', () => openAddDialog($('search').value));
  $('add-cage').addEventListener('change', onAddCageChange);
  $('form-add').addEventListener('submit', onAddSubmit);
  $('btn-add-cancel').addEventListener('click', () => $('dlg-add').close());

  $('btn-manage').addEventListener('click', async () => {
    const { openManage } = await import('./js/manage.js').catch(() => ({}));
    if (openManage) openManage(app);
    showView('manage');
  });
  $('btn-manage-back').addEventListener('click', nextBox);

  $('btn-scan').addEventListener('click', async () => {
    const { startScan } = await import('./js/scan.js').catch(() => ({}));
    if (startScan) startScan(app);
    else alert('Scanning is not set up yet.');
  });

  showView('search');
}

start();
