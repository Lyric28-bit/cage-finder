// The note under the search box: cages, Local list, plus import/export in the
// ⋯ menu. Rebuilt every time it's shown.

import {
  loadDefaults, isImportable, addCage, addSuburbToCage, renameCage, setCageColor,
  removeSuburbFromCage, deleteCage, replaceData, POSTCODE, setPostcode,
} from './store.js';
import { photoUrl, setPhoto, removePhoto, renamePhoto } from './photos.js';

const PREVIEW = 8; // suburbs shown on a closed cage line

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function preview(names) {
  const shown = names.slice(0, PREVIEW).join(', ');
  return names.length > PREVIEW ? shown + ', …' : shown || 'No suburbs yet';
}

export function openManage(app) {
  const root = document.getElementById('manage-root');
  const menu = document.getElementById('menu');
  let expanded = null; // name of the open cage, or LOCAL_KEY
  let addingCage = false;
  // Locked by default so a stray tap can't change a cage. Edit unlocks it
  // until the note is rebuilt (search, Done, reopening the app).
  let editing = false;
  const LOCAL_KEY = '__local__';

  const editBtn = el('button', { className: 'btn-ghost note-edit', type: 'button', textContent: 'Edit' });
  editBtn.addEventListener('click', () => {
    editing = !editing;
    addingCage = false;
    editBtn.textContent = editing ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(editing));
    renderAll();
  });
  const metaLine = el('p', { className: 'note-meta' });
  const cagesBox = el('div');
  const addCageBox = el('div');
  const localBox = el('div');
  const dataMsg = el('p', { className: 'error', hidden: true });

  // One hidden picker shared by every cage's photo button.
  let photoFor = null; // the cage the picker is open for
  const photoInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0], cage = photoFor;
    photoInput.value = '';
    if (!file || !cage) return;
    const name = cage.name;
    try {
      await setPhoto(name, file);
      // Renamed while the photo was being shrunk: move it to the new name.
      if (cage.name !== name) await renamePhoto(name, cage.name);
    } catch (err) {
      alert(err.message);
      return;
    }
    renderCages();
  });
  function pickPhoto(cage) {
    photoFor = cage;
    photoInput.click();
  }

  function renderAll() {
    renderMeta();
    renderCages();
    renderAddCage();
    renderLocal();
  }

  function renderMeta() {
    const subs = app.data.cages.reduce((n, c) => n + c.suburbs.length, 0);
    metaLine.textContent = `${app.data.cages.length} cages · ${subs} suburbs`;
  }

  // One line per cage: dot, name, count, and a preview of its suburbs.
  function entry(key, swatchColor, title, count, previewText, side, est = false) {
    const open = expanded === key;
    const swatch = el('span', { className: 'm-swatch' });
    if (swatchColor) swatch.style.background = swatchColor;
    else swatch.classList.add('empty');
    const name = el('span', { className: 'grow', textContent: title });
    if (est) name.append(el('span', { className: 'est-tag', textContent: 'est.' }));
    const row = el('button', { className: 'm-row', type: 'button' },
      el('span', { className: 'm-head' },
        swatch,
        name,
        el('span', { className: 'count', textContent: String(count) })),
      el('span', { className: 'm-preview', textContent: previewText, hidden: open }));
    row.setAttribute('aria-expanded', String(open));
    row.addEventListener('click', () => {
      expanded = open ? null : key;
      renderCages();
      renderLocal();
    });
    const item = el('div', { className: 'm-item' + (open ? ' open' : '') }, row);
    if (side) item.append(side);
    return { open, item };
  }

  // ---------- cages ----------

  // Editing: camera icon, or a thumbnail, that picks a photo.
  // Locked: just the thumbnail (if any), which views it.
  function photoButton(cage) {
    const url = photoUrl(cage.name);
    if (!editing && !url) return null;
    const btn = el('button', { className: 'm-photo', type: 'button' },
      url ? el('img', { src: url, alt: '' }) : '📷');
    if (editing) {
      btn.setAttribute('aria-label', `${url ? 'Change' : 'Add'} sheet photo for ${cage.name}`);
      btn.addEventListener('click', () => pickPhoto(cage));
    } else {
      btn.setAttribute('aria-label', `Show the ${cage.name} sheet`);
      btn.addEventListener('click', () => app.openPhoto(url));
    }
    return btn;
  }

  function renderCages() {
    cagesBox.replaceChildren();
    for (const cage of app.data.cages) {
      const { open, item } = entry(cage.name, cage.color, cage.name, cage.suburbs.length,
        preview(cage.suburbs), photoButton(cage), app.isEstimated(cage.name));
      if (open) item.append(editing ? cagePanel(cage) : readOnlyPanel(cage));
      cagesBox.append(item);
    }
  }

  // Locked view of an open cage: its suburbs and the photo, nothing to change.
  function readOnlyPanel(cage) {
    const panel = el('div', { className: 'm-panel' });
    if (photoUrl(cage.name)) {
      const view = el('button', { className: 'btn-secondary', type: 'button', textContent: 'View photo' });
      view.addEventListener('click', () => app.openPhoto(photoUrl(cage.name)));
      panel.append(el('div', { className: 'm-line' }, view));
    }
    const list = el('ul', { className: 'm-subs' });
    for (const sub of cage.suburbs) list.append(el('li', {}, el('span', { textContent: sub })));
    panel.append(list);
    return panel;
  }

  function cagePanel(cage) {
    const panel = el('div', { className: 'm-panel' });

    const nameErr = el('p', { className: 'error', hidden: true });
    const nameInput = el('input', { type: 'text', value: cage.name, autocomplete: 'off' });
    nameInput.setAttribute('aria-label', 'Cage name');
    const colorInput = el('input', { type: 'color', value: cage.color });
    colorInput.setAttribute('aria-label', 'Cage colour');
    nameInput.addEventListener('change', async () => {
      const oldName = cage.name;
      try {
        renameCage(app.data, cage, nameInput.value);
      } catch (err) {
        nameErr.textContent = err.message;
        nameErr.hidden = false;
        return;
      }
      expanded = cage.name;
      app.save();
      await renamePhoto(oldName, cage.name).catch(() => {});
      renderAll();
    });
    colorInput.addEventListener('change', () => {
      setCageColor(cage, colorInput.value);
      app.save();
      renderCages();
    });
    panel.append(el('div', { className: 'm-line' }, nameInput, colorInput), nameErr);

    const changePhoto = el('button', { className: 'btn-secondary', type: 'button',
      textContent: photoUrl(cage.name) ? 'Change photo' : 'Add sheet photo' });
    changePhoto.addEventListener('click', () => pickPhoto(cage));
    const photoLine = el('div', { className: 'm-line wrap' }, changePhoto);
    if (photoUrl(cage.name)) {
      const view = el('button', { className: 'btn-primary', type: 'button', textContent: 'View photo' });
      view.addEventListener('click', () => app.openPhoto(photoUrl(cage.name)));
      photoLine.prepend(view);
      const rm = el('button', { className: 'btn-ghost', type: 'button', textContent: 'Remove photo' });
      rm.addEventListener('click', async () => {
        if (!confirm(`Remove the sheet photo for ${cage.name}?`)) return;
        await removePhoto(cage.name).catch(() => {});
        renderCages();
      });
      photoLine.append(rm);
    }
    panel.append(photoLine);

    const subErr = el('p', { className: 'error', hidden: true });
    const subInput = el('input', { type: 'text', placeholder: 'Add suburb', autocomplete: 'off' });
    subInput.setAttribute('aria-label', 'Add suburb');
    const pcInput = el('input', { type: 'text', placeholder: 'Postcode', autocomplete: 'off', inputMode: 'numeric', maxLength: 4, className: 'm-pc' });
    pcInput.setAttribute('aria-label', 'Postcode (optional)');
    const addSub = () => {
      if (!subInput.value.trim()) return;
      const pc = pcInput.value.trim();
      try {
        if (pc && !POSTCODE.test(pc)) throw new Error('Postcode must be 4 digits');
        addSuburbToCage(app.data, subInput.value, cage.name);
        if (pc) setPostcode(app.data, subInput.value, pc);
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
    for (const input of [subInput, pcInput]) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addSub(); }
      });
    }
    panel.append(el('div', { className: 'm-line' }, subInput, pcInput, addBtn), subErr);

    const list = el('ul', { className: 'm-subs' });
    for (const sub of cage.suburbs) {
      const x = el('button', { className: 'm-x', type: 'button', textContent: '×' });
      x.setAttribute('aria-label', `Remove ${sub}`);
      x.addEventListener('click', () => {
        if (!confirm(`Remove ${sub} from ${cage.name}?`)) return;
        removeSuburbFromCage(cage, sub);
        app.save();
        renderAll();
      });
      list.append(el('li', {}, el('span', { textContent: sub }), x));
    }
    panel.append(list);

    const del = el('button', { className: 'btn-danger', type: 'button', textContent: 'Delete cage' });
    del.addEventListener('click', () => {
      const n = cage.suburbs.length;
      if (!confirm(`Delete cage ${cage.name}? Its ${n} suburb${n === 1 ? '' : 's'} will be deleted too.`)) return;
      deleteCage(app.data, cage);
      removePhoto(cage.name).catch(() => {});
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
    if (!editing) return;
    if (!addingCage) {
      const btn = el('button', { className: 'btn-ghost m-add', type: 'button', textContent: '+ New cage' });
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
    localBox.replaceChildren();
    const { open, item } = entry(LOCAL_KEY, null, 'Local (Adelaide metro)', local.length,
      local.length ? preview(local.map(p => p.name)) : 'None left');
    localBox.append(item);
    if (!open) return;
    const panel = el('div', { className: 'm-panel' },
      el('p', { className: 'm-hint', textContent: editing
        ? 'These show as LOCAL until you move them to a cage.'
        : 'These show as LOCAL until moved to a cage. Tap Edit to move them.' }));
    const list = el('ul', { className: 'm-subs' });
    for (const p of local) {
      const li = el('li', {},
        el('span', { className: 'grow' }, p.name, el('span', { className: 'count', textContent: ` ${p.postcode ?? ''}` })));
      if (editing) {
        const move = el('button', { className: 'btn-ghost', type: 'button', textContent: 'Move' });
        move.setAttribute('aria-label', `Move ${p.name} to a cage`);
        move.addEventListener('click', () => app.openAddDialog(p.name, { move: true }));
        li.append(move);
      }
      list.append(li);
    }
    panel.append(list);
    item.append(panel);
  }

  // ---------- data (⋯ menu) ----------

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
        await navigator.share({ files: [file], title: 'Cage Notes data' });
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
      showDataError('That file does not look like Cage Notes data.');
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
  const exportBtn = el('button', { className: 'menu-item', type: 'button', textContent: 'Export' });
  exportBtn.addEventListener('click', exportData);
  const importBtn = el('button', { className: 'menu-item', type: 'button', textContent: 'Import' });
  importBtn.addEventListener('click', () => fileInput.click());
  const resetBtn = el('button', { className: 'menu-item danger', type: 'button', textContent: 'Reset to sheet data' });
  resetBtn.addEventListener('click', resetData);

  menu.replaceChildren(exportBtn, importBtn, resetBtn, fileInput, dataMsg);
  root.replaceChildren(
    el('div', { className: 'note-head' }, el('h2', { className: 'note-title', textContent: 'Cages' }), editBtn),
    metaLine,
    cagesBox,
    addCageBox,
    localBox,
    photoInput);
  renderAll();
}
