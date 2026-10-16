// Scan Sticker: camera -> crop to guide box -> Tesseract OCR (offline) -> matchOcr.

import { matchOcr } from './match.js';

const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

let workerPromise = null;
let stream = null;
let overlay = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

// One OCR worker, created on first scan and reused after that.
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(VENDOR + 'tesseract.min.js');
      return window.Tesseract.createWorker('eng', 1, {
        workerPath: VENDOR + 'worker.min.js',
        corePath: VENDOR,
        langPath: VENDOR.replace(/\/$/, ''),
        workerBlobURL: false,
        cacheMethod: 'none', // the service worker caches the model instead
      });
    })().catch(err => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function buildOverlay() {
  const video = el('video', { className: 'scan-video', playsInline: true, muted: true, autoplay: true });
  const guide = el('div', { className: 'scan-guide' });
  const status = el('div', { className: 'scan-status', textContent: 'Fit the suburb name inside the box' });
  const capture = el('button', { className: 'scan-capture', type: 'button', ariaLabel: 'Read sticker', textContent: 'Read' });
  const cancel = el('button', { className: 'scan-cancel', type: 'button', textContent: 'Type instead' });
  const root = el('div', { className: 'scan-overlay' },
    video, guide, status, el('div', { className: 'scan-controls' }, cancel, capture));
  return { root, video, guide, status, capture, cancel };
}

function close() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  overlay?.root.remove();
  overlay = null;
}

// Copy the part of the video under the guide box into a canvas, greyscale and
// upscaled a little, which helps Tesseract on small sticker text.
function grabGuideArea(video, guide) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const vr = video.getBoundingClientRect();
  const gr = guide.getBoundingClientRect();
  // Video is shown with object-fit: cover, so work out the visible scale/offset.
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const offX = (vr.width - vw * scale) / 2;
  const offY = (vr.height - vh * scale) / 2;
  const sx = Math.max(0, (gr.left - vr.left - offX) / scale);
  const sy = Math.max(0, (gr.top - vr.top - offY) / scale);
  const sw = Math.min(vw - sx, gr.width / scale);
  const sh = Math.min(vh - sy, gr.height / scale);

  const up = Math.min(2, 1600 / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * up);
  canvas.height = Math.round(sh * up);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function fallbackToTyping(app, message) {
  close();
  app.showView('search');
  app.showMessage?.(message);
}

export async function startScan(app) {
  if (overlay) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    fallbackToTyping(app, 'Camera not available here (it needs HTTPS). Type the suburb instead.');
    return;
  }

  overlay = buildOverlay();
  document.body.append(overlay.root);
  overlay.cancel.addEventListener('click', () => fallbackToTyping(app, ''));

  // Start loading OCR while the camera warms up.
  getWorker().catch(() => {});

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    fallbackToTyping(app, err.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Type the suburb instead.'
      : 'Could not open the camera. Type the suburb instead.');
    return;
  }
  if (!overlay) { close(); return; } // cancelled while waiting for permission
  overlay.video.srcObject = stream;

  overlay.capture.addEventListener('click', async () => {
    const { video, guide, status, capture } = overlay;
    if (!video.videoWidth) return;
    capture.disabled = true;
    status.textContent = 'Reading…';
    try {
      const canvas = grabGuideArea(video, guide);
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      const { confident, candidates } = matchOcr(app.index, data.text);
      if (confident) {
        close();
        app.showResult(candidates[0]);
      } else if (candidates.length) {
        close();
        app.showPicker(candidates, 'Not sure. Tap the right one:');
      } else if (overlay) {
        status.textContent = 'Couldn\'t read a suburb. Try again, or tap Type instead.';
        capture.disabled = false;
      }
    } catch (err) {
      fallbackToTyping(app, 'Scanning failed. Type the suburb instead.');
      console.error(err);
    }
  });
}
