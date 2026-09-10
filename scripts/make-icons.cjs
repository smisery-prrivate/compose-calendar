#!/usr/bin/env node
/**
 * Generate the add-on icons (a calendar page with a check mark) as PNGs without dependencies.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Design in a 0..1 coordinate space: rounded page, blue header band, white body, green check.
function draw(size) {
  return png(size, (px, py) => {
    const x = (px + 0.5) / size, y = (py + 0.5) / size;
    const inset = 0.06, r = 0.16;
    const inside = (() => {
      const l = inset, t = inset, rr = 1 - inset, b = 1 - inset;
      if (x < l || x > rr || y < t || y > b) return false;
      const cx = x < l + r ? l + r : x > rr - r ? rr - r : x;
      const cy = y < t + r ? t + r : y > b - r ? b - r : y;
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    })();
    if (!inside) return [0, 0, 0, 0];
    if (y < 0.36) return [0, 96, 223, 255];            // header band
    // check mark: two strokes
    const d1 = Math.abs((y - 0.62) - 0.9 * (x - 0.30)) / Math.sqrt(1 + 0.81);
    const d2 = Math.abs((y - 0.80) + 1.1 * (x - 0.50)) / Math.sqrt(1 + 1.21);
    const w = 0.075;
    if ((x >= 0.28 && x <= 0.52 && d1 < w) || (x >= 0.48 && x <= 0.76 && d2 < w && y >= 0.48)) return [42, 195, 162, 255];
    return [255, 255, 255, 255];
  });
}

for (const size of [16, 32, 48, 64, 96, 128]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), draw(size));
}
console.log('icons written to', OUT);
