#!/usr/bin/env node
/**
 * Build dist/compose-calendar-<version>.xpi from the add-on sources (no external deps).
 * Also writes dist/compose-calendar-<version>-source.zip for reviewers.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

class ZipWriter {
  constructor() { this.files = []; this.offset = 0; this.buf = []; }
  addFile(name, data) {
    name = name.split(path.sep).join('/');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28); nameBuf.copy(lh, 30);
    this.files.push({ name: nameBuf, crc, compressedSize: compressed.length, uncompressedSize: data.length, offset: this.offset });
    this.buf.push(lh, compressed);
    this.offset += lh.length + compressed.length;
  }
  toBuffer() {
    const cd = [];
    let cdSize = 0;
    for (const f of this.files) {
      const e = Buffer.alloc(46 + f.name.length);
      e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(0, 8);
      e.writeUInt16LE(8, 10); e.writeUInt16LE(0, 12); e.writeUInt16LE(0, 14); e.writeUInt32LE(f.crc, 16);
      e.writeUInt32LE(f.compressedSize, 20); e.writeUInt32LE(f.uncompressedSize, 24);
      e.writeUInt16LE(f.name.length, 28); e.writeUInt16LE(0, 30); e.writeUInt16LE(0, 32); e.writeUInt16LE(0, 34);
      e.writeUInt16LE(0, 36); e.writeUInt32LE(0, 38); e.writeUInt32LE(f.offset, 42); f.name.copy(e, 46);
      cd.push(e); cdSize += e.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.files.length, 8); eocd.writeUInt16LE(this.files.length, 10);
    eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(this.offset, 16); eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...this.buf, ...cd, eocd]);
  }
}

function addDir(zip, dir, prefix, skip) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip(entry.name, prefix)) continue;
    const full = path.join(dir, entry.name);
    const zipPath = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) addDir(zip, full, zipPath, skip);
    else zip.addFile(zipPath, fs.readFileSync(full));
  }
}

const ADDON_ENTRIES = ['manifest.json', 'background.js', '_locales', 'api', 'popup', 'icons', 'LICENSE'];
const SOURCE_SKIP = new Set(['dist', 'node_modules', '.git', '.DS_Store']);

fs.mkdirSync(DIST, { recursive: true });

const xpi = new ZipWriter();
addDir(xpi, ROOT, '', (name, prefix) => prefix === '' ? !ADDON_ENTRIES.includes(name) : false);
const xpiPath = path.join(DIST, `compose-calendar-${manifest.version}.xpi`);
fs.writeFileSync(xpiPath, xpi.toBuffer());
console.log(`Built ${xpiPath} (${(fs.statSync(xpiPath).size / 1024).toFixed(0)} KB)`);

const src = new ZipWriter();
addDir(src, ROOT, '', (name) => SOURCE_SKIP.has(name));
const srcPath = path.join(DIST, `compose-calendar-${manifest.version}-source.zip`);
fs.writeFileSync(srcPath, src.toBuffer());
console.log(`Built ${srcPath} (${(fs.statSync(srcPath).size / 1024).toFixed(0)} KB)`);
