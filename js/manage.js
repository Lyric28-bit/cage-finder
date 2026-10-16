// Manage screen: cages, Local list, import/export. Rebuilt every time it opens.

import { normalise } from './match.js';
import {
  loadDefaults, isImportable, addCage, addSuburbToCage, renameCage, setCageColor,
  removeSuburbFromCage, deleteCage, replaceData,
} from './store.js';

const LOCAL_LIMIT = 50;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

export function openManage(app) {
  const root = document.getElementById('manage-root');
  let filter = '';
  let expanded = null; // name of the open cage
  let addingCage = false;

  const filterInput = el('input', {
    type: 'search', placeholder: 'Filter suburbs or cages', autocomplete: 'off',
    spellcheck: false,
  });
  filterInput.setAttribute('aria-label', 'Filter suburbs or cages');
  const cagesBox = el('div');
  const addCageBox = el('div');
  const localHead = el('h2');
  const localBox = el('div');
  const dataMsg = el('p', { className: 'error', hidden: true });

  function matches(text) {
    const f = normalise(filter);
    return !f || normalise(text).includes(f);
  }

  function renderAll() {
    renderCages();
    renderAddCage();
    renderLocal();
  }

  // ---------- cages ----------

  function renderCages() {
    cagesBox.replaceChildren();
    const shown = app.data.cages.filter(c => matches(c.name) || c.suburbs.some(matches));
    if (!shown.length) cagesBox.append(el('p', { className: 'note', textContent: 'No cages match.' }));
    for (const cage of shown) {
      const open = expanded === cage.name;
      const swatch = el('span', { className: 'm-swatch' });
      swatch.style.background = cage.color;
      const row = el('button', { className: 'm-row', type: 'button' },
        swatch,
        el('span', { className: 'grow', textContent: cage.name }),
        el('span', { className: 'count', textContent: String(cage.suburbs.length) }));
      row.setAttribute('aria-expanded', String(open));
      row.addEventListener('click', () => {
        expanded = open ? null : cage.name;
        renderCages();
      });
      const item = el('div', { className: 'm-item' }, row);
      if (open) item.append(cagePanel(cage));
      cagesBox.append(item);
    }
  }

  function cagePanel(cage) {
    const panel = el('div', { className: 'm-panel' });

    const nameErr = el('p', { className: 'error', hidden: true });
    const nameInput = el('input', { type: 'text', value: cage.name, autocomplete: 'off' });
    nameInput.setAttribute('aria-label', 'Cage name');
    const colorInput = el('input', { type: 'color', value: cage.color });
    colorInput.setAttribute('aria-label', 'Cage colour');
    nameInput.addEventListener('change', () => {
      try {
        renameCage(app.data, cage, nameInput.value);
      } catch (err) {
        nameErr.textContent = err.message;
        nameErr.hidden = false;
        return;
      }
      expanded = cage.name;
      app.save();
      renderAll();
    });
    colorInput.addEventListener('change', () => {
      setCageColor(cage, colorInput.value);
      app.save();
      renderCages();
    });
    panel.append(el('div', { className: 'm-line' }, nameInput, colorInput), nameErr);

    const subErr = el('p', { className: 'error', hidden: true });
    const subInput = el('input', { type: 'text', placeholder: 'Add suburb', autocomplete: 'off' });
    subInput.setAttribute('aria-label', 'Add suburb');
    const addSub = () => {
      if (!subInput.value.trim()) return;
      try {
        addSuburbToCage(app.data, subInput.value, cage.name);
      } catch (err) {
        subErr.textContent = err.message;
        subErr.hidden = false;
        return;
      }
      app.save();
      renderAll();
      cagesBox.querySelector('.m-panel input[placeholder="Add suburb"]')?.focus();
    };
    const addBtn = el('button', { className: 'btn-primary', type: 'button', textContent: 'Add' });
    addBtn.addEventListener('click', addSub);
    subInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSub(); }
    });
    panel.append(el('div', { className: 'm-line' }, subInput, addBtn), subErr);

    const list = el('ul', { className: 'm-subs' });
    const subs = cage.suburbs.filter(s => matches(cage.name) || matches(s));
    for (const sub of subs) {
      const x = el('button', { className: 'm-x', type: 'button', textContent: '×' });
      x.setAttribute('aria-label', `Remove ${sub}`);
      x.addEventListener('click', () => {
        if (!confirm(`Remove ${sub} from ${cage.name}?`)) return;
        removeSuburbFromCage(cage, sub);
        app.save();
        renderCages();
      });
      list.append(el('li', {}, el('span', { textContent: sub }), x));
    }
    panel.append(list);

    const del = el('button', { className: 'btn-danger', type: 'button', textContent: 'Delete cage' });
    del.addEventListener('click', () => {
      const n = cage.suburbs.length;
      if (!confirm(`Delete cage ${cage.name}? Its ${n} suburb${n === 1 ? '' : 's'} will be deleted too.`)) return;
      deleteCage(app.data, cage);
      expanded = null;
      app.save();
      renderAll();
    });
    panel.append(del);
    return panel;
  }

  // ---------- add cage ----------

  function renderAddCage() {
    addCageBox.replaceChildren();
    if (!addingCage) {
      const btn = el('button', { className: 'btn-secondary', type: 'button', textContent: '+ Add cage' });
      btn.addEventListener('click', () => {
        addingCage = true;
        renderAddCage();
        addCageBox.querySelector('input[type=text]').focus();
      });
      addCageBox.append(btn);
      return;
    }
    const err = el('p', { className: 'error', hidden: true });
    const name = el('input', { type: 'text', placeholder: 'New cage name', autocomplete: 'off' });
    name.setAttribute('aria-label', 'New cage name');
    const color = el('input', { type: 'color', value: '#2E7D32' });
    color.setAttribute('aria-label', 'New cage colour');
    const save = el('button', { className: 'btn-primary', type: 'button', textContent: 'Add' });
    const cancel = el('button', { className: 'btn-ghost', type: 'button', textContent: 'Cancel' });
    const submit = () => {
      try {
        const cage = addCage(app.data, name.value, color.value);
        expanded = cage.name;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        return;
      }
      addingCage = false;
      app.save();
      renderAll();
    };
    save.addEventListener('click', submit);
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    cancel.addEventListener('click', () => {
      addingCage = false;
      renderAddCage();
    });
    addCageBox.append(
      el('div', { className: 'm-panel' },
        el('div', { className: 'm-line' }, name, color), err,
        el('div', { className: 'm-line' }, save, cancel)));
  }

  // ---------- local ----------

  function renderLocal() {
    const local = app.data.local || [];
    const all = local.filter(p => matches(p.name) || matches(String(p.postcode ?? '')));
    localHead.textContent = `Local (Adelaide metro) (${local.length})`;
    localBox.replaceChildren();
    if (!all.length) localBox.append(el('p', { className: 'note', textContent: 'No local suburbs match.' }));
    for (const p of all.slice(0, LOCAL_LIMIT)) {
      const move = el('button', { className: 'btn-secondary', type: 'button', textContent: 'Move' });
      move.setAttribute('aria-label', `Move ${p.name} to a cage`);
      move.addEventListener('click', () => app.openAddDialog(p.name, { move: true }));
      localBox.append(el('div', { className: 'm-item' },
        el('div', { className: 'm-row' },
          el('span', { className: 'grow', textContent: p.name }),
          el('span', { className: 'count', textContent: String(p.postcode ?? '') }),
          move)));
    }
    if (all.length > LOCAL_LIMIT) {
      localBox.append(el('p', { className: 'm-more', textContent: `Showing ${LOCAL_LIMIT} of ${all.length}, use the filter` }));
    }
  }

  // ---------- data ----------

  function showDataError(msg) {
    dataMsg.textContent = msg;
    dataMsg.hidden = !msg;
  }

  async function exportData() {
    const name = `cage-finder-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(app.data, null, 2)], { type: 'application/json' });
    // iPhone/iPad home-screen apps often ignore downloads; the share sheet
    // offers Save to Files, AirDrop, email etc. instead.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const file = new File([blob], name, { type: 'application/json' });
    if (isIOS && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Cage Finder data' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user closed the share sheet
      }
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file) {
    showDataError('');
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showDataError('That file is not valid JSON.');
      return;
    }
    if (!isImportable(parsed)) {
      showDataError('That file does not look like Cage Finder data.');
      return;
    }
    if (!confirm('Replace all cages and suburbs on this device with the imported file?')) return;
    replaceData(app.data, parsed);
    expanded = null;
    app.save();
    renderAll();
  }

  async function resetData() {
    showDataError('');
    if (!confirm('Reset to the original sheet data? Your changes on this device will be lost.')) return;
    try {
      replaceData(app.data, await loadDefaults());
    } catch {
      showDataError('Could not load the sheet data. Check your connection and try again.');
      return;
    }
    expanded = null;
    app.save();
    renderAll();
  }

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    await importFile(fileInput.files[0]);
    fileInput.value = '';
  });
  const exportBtn = el('button', { className: 'btn-secondary', type: 'button', textContent: 'Export' });
  exportBtn.addEventListener('click', exportData);
  const importBtn = el('button', { className: 'btn-secondary', type: 'button', textContent: 'Import' });
  importBtn.addEventListener('click', () => fileInput.click());
  const resetBtn = el('button', { className: 'btn-danger', type: 'button', textContent: 'Reset to sheet data' });
  resetBtn.addEventListener('click', resetData);

  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    renderCages();
    renderLocal();
  });

  root.replaceChildren(
    el('div', { style: 'padding-top: 4px' }, filterInput),
    el('h2', { textContent: 'Cages' }),
    cagesBox,
    addCageBox,
    localHead,
    el('p', { className: 'note', textContent: 'Suburbs here show as LOCAL until you move them to a cage.' }),
    localBox,
    el('h2', { textContent: 'Data' }),
    el('div', { className: 'm-data' }, exportBtn, importBtn, resetBtn, fileInput),
    dataMsg);
  renderAll();
}
