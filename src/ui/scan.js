// Scan a barcode with the camera: a sheet with the live camera, read a few times a second until a
// barcode is found, then the camera stops and the sheet closes. The phone's own BarcodeDetector is
// used where there is one; otherwise ZXing, vendored in vendor/ and loaded only when first needed.
// Only the product barcodes on food are read: EAN-13, EAN-8, UPC-A and UPC-E.

import { h, openSheet } from './dom.js';

const DECODER = 'vendor/zxing-0.23.0.min.js';
const EVERY_MS = 150;
const CODE = /^\d{8,14}$/;

let decoderLoaded = null;
function loadDecoder() {
  decoderLoaded ??= new Promise((resolve, reject) => {
    const script = h('script', { src: DECODER });
    script.onload = () => resolve(globalThis.ZXing);
    script.onerror = () => { decoderLoaded = null; reject(new Error('decoder')); };
    document.head.append(script);
  });
  return decoderLoaded;
}

/** A function that reads a barcode from the video's current frame: the code, or null. */
async function makeReader(video) {
  if ('BarcodeDetector' in globalThis) {
    const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    const formats = (await globalThis.BarcodeDetector.getSupportedFormats()).filter((f) => wanted.includes(f));
    if (formats.length) {
      const detector = new globalThis.BarcodeDetector({ formats });
      return async () => (await detector.detect(video))[0]?.rawValue ?? null;
    }
  }
  const Z = await loadDecoder();
  // The 1D reader itself, held to EAN / UPC: MultiFormatReader would log a warning for every frame with no barcode.
  const hints = new Map([
    [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]],
    [Z.DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new Z.MultiFormatOneDReader(hints);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decode(bitmap, hints).getText();
    } catch {
      return null;   // no barcode in this frame
    }
  };
}

/** What to do when the camera can't be used. */
function cameraProblem(err) {
  if (err?.name === 'NotAllowedError') return 'Allow the camera for Foodey in Settings, or type the barcode numbers.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'No camera was found. Type the barcode numbers instead.';
  if (err?.message === 'decoder') return 'The barcode reader didn’t load. Connect to the internet once, or type the numbers.';
  return 'The camera couldn’t start. Type the barcode numbers instead.';
}

/** openScanner({ onCode }): onCode(digits) runs once a barcode is read, after the sheet closes. */
export function openScanner({ onCode }) {
  const video = h('video', { class: 'scan-video', playsinline: '', muted: '', autoplay: '', 'aria-label': 'Camera' });
  video.muted = true;
  const hint = h('p', { class: 'reason', 'aria-live': 'polite' }, 'Hold the barcode flat, in the middle of the picture.');
  let stream = null;
  let timer = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
  const s = openSheet({ title: 'Scan a Barcode', onClose: stop }, h('div', { class: 'sheet-form' }, video, hint));

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play();
      const read = await makeReader(video);
      const tick = async () => {
        if (stopped) return;
        const code = await read().catch(() => null);
        if (code && CODE.test(code)) {
          s.close();
          onCode(code);
          return;
        }
        timer = setTimeout(tick, EVERY_MS);
      };
      tick();
    } catch (err) {
      stop();
      video.hidden = true;
      hint.textContent = cameraProblem(err);
    }
  })();
  return s;
}
