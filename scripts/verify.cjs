#!/usr/bin/env node
/**
 * Verify the built XPI is a well-formed, installable Thunderbird add-on:
 * zip integrity, manifest completeness, every referenced file present,
 * every translation key resolvable, and no leftover personal data.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const xpiPath = path.join(ROOT, 'dist', `compose-calendar-${manifest.version}.xpi`);

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const ok = (m) => notes.push(m);

// ---------------------------------------------------------------- read the zip
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record: not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compSize = buf.readUInt32LE(offset + 20);
    const uncompSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    // local header
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);
    if (data.length !== uncompSize) throw new Error(`size mismatch for ${name}`);
    entries.set(name, { data, crc });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

if (!fs.existsSync(xpiPath)) {
  console.error(`XPI not built: ${xpiPath}\nRun: node scripts/build.cjs`);
  process.exit(1);
}
const zip = readZip(xpiPath);
ok(`zip readable, ${zip.size} entries, ${(fs.statSync(xpiPath).size / 1024).toFixed(0)} KB`);

for (const [name, e] of zip) {
  if (crc32(e.data) !== e.crc) fail(`CRC mismatch for ${name}`);
}
ok('all CRCs valid');

const has = (p) => zip.has(p);
const text = (p) => zip.get(p).data.toString('utf8');

// ------------------------------------------------------------- manifest checks
if (!has('manifest.json')) fail('manifest.json missing from the XPI');
const zipManifest = JSON.parse(text('manifest.json'));
if (zipManifest.manifest_version !== 2) fail('Thunderbird add-ons need manifest_version 2');
for (const key of ['name', 'version', 'description', 'browser_specific_settings', 'default_locale']) {
  if (!zipManifest[key]) fail(`manifest key missing: ${key}`);
}
const gecko = (zipManifest.browser_specific_settings || {}).gecko || {};
if (!gecko.id || !/^[^\s@]+@[^\s@]+$/.test(gecko.id)) fail(`gecko.id missing or malformed: ${gecko.id}`);
if (!gecko.strict_min_version) fail('gecko.strict_min_version missing');
if (!/^\d+\.\d+(\.\d+)?$/.test(zipManifest.version)) fail(`version not numeric: ${zipManifest.version}`);
ok(`manifest ok: ${gecko.id} v${zipManifest.version}, min TB ${gecko.strict_min_version}`);

// every file the manifest points at must exist inside the XPI
const referenced = [];
for (const size of Object.keys(zipManifest.icons || {})) referenced.push(zipManifest.icons[size]);
for (const s of (zipManifest.background || {}).scripts || []) referenced.push(s);
for (const [, api] of Object.entries(zipManifest.experiment_apis || {})) {
  referenced.push(api.schema);
  if (api.parent && api.parent.script) referenced.push(api.parent.script);
}
const ca = zipManifest.compose_action || {};
if (ca.default_popup) referenced.push(ca.default_popup);
for (const size of Object.keys(ca.default_icon || {})) referenced.push(ca.default_icon[size]);
for (const f of referenced) {
  if (!has(f)) fail(`manifest references a file that is not in the XPI: ${f}`);
}
ok(`${referenced.length} manifest-referenced files present`);

// popup scripts referenced from the HTML
if (ca.default_popup) {
  const dir = path.posix.dirname(ca.default_popup);
  const html = text(ca.default_popup);
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    const p = path.posix.normalize(path.posix.join(dir, m[1]));
    if (!has(p)) fail(`popup references a missing script: ${p}`);
  }
  ok('popup scripts present');
}

// experiment API: namespace, schema and implementation must line up
for (const [ns, api] of Object.entries(zipManifest.experiment_apis || {})) {
  const schema = JSON.parse(text(api.schema));
  const entry = schema.find(s => s.namespace === ns);
  if (!entry) fail(`schema has no namespace "${ns}"`);
  const impl = text(api.parent.script);
  if (!new RegExp(`var ${ns}\\s*=\\s*class extends ExtensionCommon.ExtensionAPI`).test(impl)) {
    fail(`${api.parent.script} does not define "var ${ns} = class extends ExtensionCommon.ExtensionAPI"`);
  }
  for (const fn of (entry && entry.functions) || []) {
    if (!new RegExp(`\\b${fn.name}\\s*:\\s*async function`).test(impl)) {
      fail(`schema declares ${ns}.${fn.name} but api.js does not implement it`);
    }
  }
  const declared = new Set(((entry && entry.functions) || []).map(f => f.name));
  for (const m of impl.matchAll(/^\s{8}(\w+):\s*async function/gm)) {
    if (!declared.has(m[1])) fail(`api.js implements ${m[1]} which is not declared in the schema`);
  }
  ok(`experiment API "${ns}": ${declared.size} functions, schema and implementation match`);
}

// ------------------------------------------------------------------ i18n checks
const locales = [];
for (const name of zip.keys()) {
  const m = name.match(/^_locales\/([^/]+)\/messages\.json$/);
  if (m) locales.push(m[1]);
}
if (!locales.includes(zipManifest.default_locale)) fail(`default_locale "${zipManifest.default_locale}" has no messages.json`);
const messages = {};
for (const loc of locales) messages[loc] = JSON.parse(text(`_locales/${loc}/messages.json`));
ok(`locales: ${locales.join(', ')}`);

const usedKeys = new Set();
for (const m of JSON.stringify(zipManifest).matchAll(/__MSG_(\w+)__/g)) usedKeys.add(m[1]);
if (ca.default_popup) {
  const html = text(ca.default_popup);
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="(\w+)"/g)) usedKeys.add(m[1]);
}
for (const name of zip.keys()) {
  if (!name.endsWith('.js')) continue;
  for (const m of text(name).matchAll(/\bt\(\s*"(\w+)"/g)) usedKeys.add(m[1]);
}
for (const key of usedKeys) {
  for (const loc of locales) {
    if (!messages[loc][key]) fail(`translation key "${key}" missing in ${loc}`);
  }
}
ok(`${usedKeys.size} translation keys resolve in every locale`);

for (const loc of locales) {
  for (const [key, val] of Object.entries(messages[loc])) {
    if (!val || typeof val.message !== 'string') fail(`${loc}/${key} has no message string`);
    for (const m of (val.message || '').matchAll(/\$(\w+)\$/g)) {
      if (!val.placeholders || !val.placeholders[m[1].toLowerCase()]) {
        fail(`${loc}/${key} uses $${m[1]}$ without a placeholder definition`);
      }
    }
  }
}
ok('placeholder definitions complete');

// --------------------------------------------------------- privacy / leftovers
const PERSONAL = [
  /grossmann@invitris\.com/i,
  /patrickbgrossmann@gmail\.com/i,
  /invitrismunich/i,
  /5rhjwhav/i,
  /C:\\\\Users\\\\gross/i,
  /thunderbird-mcp/i,
  /mcpServer/,
  /tkasperczyk/i,
];
for (const [name, e] of zip) {
  if (/\.(png|ico)$/.test(name)) continue;
  const body = e.data.toString('utf8');
  for (const re of PERSONAL) {
    if (re.test(body)) fail(`${name} still contains personal or fork-specific data matching ${re}`);
  }
}
ok('no personal or fork-specific data in the package');

// the add-on must not phone home
for (const [name, e] of zip) {
  if (!name.endsWith('.js')) continue;
  const body = e.data.toString('utf8');
  if (/\bfetch\s*\(|XMLHttpRequest|NetUtil\.asyncFetch|nsIUploadChannel/.test(body)) {
    fail(`${name} makes network requests; the listing claims it does not`);
  }
}
ok('no network calls in the add-on code');

// -------------------------------------------------------------- unit tests too
try {
  execFileSync(process.execPath, ['--test', 'test/slots.test.cjs'], { cwd: ROOT, stdio: 'pipe' });
  ok('unit tests pass');
} catch (e) {
  fail('unit tests fail: ' + (e.stdout ? e.stdout.toString().split('\n').filter(l => /fail|not ok/.test(l)).slice(0, 5).join(' | ') : e.message));
}

// ------------------------------------------------------------------- reporting
for (const n of notes) console.log('  ok   ' + n);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log(`\nAll checks passed. ${path.relative(ROOT, xpiPath)} is ready to install.`);
