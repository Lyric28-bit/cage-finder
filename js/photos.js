// Sheet photos, one per cage, kept on this device only (IndexedDB). They are
// never uploaded: the site is public and the photos are workplace documents.
// Keyed by normalised cage name; app code reads them synchronously via
// photoUrl() after initPhotos() has loaded them.

import { normalise } from './match.js';

const DB = 'cage-notes-photos';
const STORE = 'photos';
const MAX_SIDE = 2000; // px; plenty to read the names, keeps each photo small

const urls = new Map(); // key -> object URL
let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      // The browser can close the connection (e.g. iOS in the background); reopen next time.
      req.result.onclose = () => { dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function remember(key, blob) {
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  if (blob) urls.set(key, URL.createObjectURL(blob));
  else urls.delete(key);
}

// Load every saved photo. Fails quietly (private mode, storage blocked):
// the app just shows no photos.
export async function initPhotos() {
  try {
    const [keys, blobs] = await Promise.all([
      run('readonly', s => s.getAllKeys()),
      run('readonly', s => s.getAll()),
    ]);
    keys.forEach((k, i) => remember(k, blobs[i]));
  } catch (err) {
    console.warn('Photos unavailable:', err);
  }
  return urls.size;
}

export function photoUrl(cageName) {
  return urls.get(normalise(cageName)) || null;
}

// Shrink to MAX_SIDE and re-encode as JPEG. Drawing via an <img> keeps the
// phone camera's rotation (EXIF orientation) the right way up.
async function shrink(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not read that photo');
    return blob;
  } catch {
    throw new Error('Could not read that photo. Try a JPEG or PNG.');
  } finally {
    URL.revokeObjectURL(src);
  }
}

export async function setPhoto(cageName, file) {
  const key = normalise(cageName);
  const blob = await shrink(file);
  try {
    await run('readwrite', s => s.put(blob, key));
  } catch {
    throw new Error('Could not save the photo. The phone may be out of space.');
  }
  remember(key, blob);
}

export async function removePhoto(cageName) {
  const key = normalise(cageName);
  await run('readwrite', s => s.delete(key));
  remember(key, null);
}

// Keep a cage's photo when the cage is renamed.
export async function renamePhoto(oldName, newName) {
  const from = normalise(oldName), to = normalise(newName);
  if (from === to || !urls.has(from)) return;
  const blob = await run('readonly', s => s.get(from));
  await run('readwrite', s => { s.delete(from); return s.put(blob, to); });
  remember(from, null);
  remember(to, blob);
}
