// Draws the app icon (a plate seen from above: a white rim on the accent green) as icons/icon.svg
// and the PNG sizes the manifest and iOS need, with no dependencies. The plate sits inside the centre
// 80%, so the 512 px icon also works as a maskable one.
//
//   node scripts/make-icons.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x1d, 0x7a, 0x4c];
const WHITE = [0xff, 0xff, 0xff];
// Radii as a share of the icon's size: the plate, and its well inside the rim.
const PLATE = 0.31;
const WELL = 0.2;

const DIR = fileURLToPath(new URL('../icons/', import.meta.url));

/** The colour at (x, y) in a 0–1 square. */
function colour(x, y) {
  const r = Math.hypot(x - 0.5, y - 0.5);
  return r <= PLATE && r > WELL ? WHITE : ACCENT;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
  return out;
}

/** An RGB PNG of size × size, each pixel the average of 4 × 4 samples so the edges are smooth. */
export function png(size) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0;
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const c = colour((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
        for (let i = 0; i < 3; i++) sum[i] += c[i];
      }
      for (let i = 0; i < 3; i++) raw[y * (1 + size * 3) + 1 + x * 3 + i] = Math.round(sum[i] / 16);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 2;   // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${hex(ACCENT)}"/><circle cx="50" cy="50" r="${(PLATE + WELL) * 50}" fill="none" stroke="${hex(WHITE)}" stroke-width="${(PLATE - WELL) * 100}"/></svg>\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}icon.svg`, SVG);
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    writeFileSync(`${DIR}${name}`, png(size));
  }
  console.log('Wrote icons/icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png and favicon-32.png.');
}
