import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { crc32, packageFiles } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || 'all';
assert.ok(['chromium', 'firefox', 'all'].includes(target), 'Package target must be chromium, firefox, or all');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const targets = target === 'all' ? ['chromium', 'firefox'] : [target];

function readZip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'ZIP end directory missing');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'ZIP central directory corrupt');
    assert.equal(bytes.readUInt16LE(offset + 10), 8, 'Unexpected ZIP compression');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert.ok(!entries.has(name), `Duplicate archive path: ${name}`);
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'ZIP local header corrupt');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const content = inflateRawSync(bytes.subarray(start, start + bytes.readUInt32LE(offset + 20)));
    assert.equal(content.length, bytes.readUInt32LE(offset + 24), `ZIP size mismatch: ${name}`);
    assert.equal(crc32(content), bytes.readUInt32LE(offset + 16), `ZIP checksum mismatch: ${name}`);
    entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, end, 'Unexpected ZIP directory length');
  return entries;
}

for (const browser of targets) {
  const folderName = browser === 'firefox' ? `ChudPresence-Firefox-${version}-unsigned-development` : `ChudPresence-${version}`;
  const staged = path.join(root, 'dist', folderName);
  const archive = path.join(root, 'dist', `${folderName}.${browser === 'firefox' ? 'xpi' : 'zip'}`);
  const files = await packageFiles(staged);
  const entries = readZip(await fs.readFile(archive));
  assert.equal(entries.size, files.length, 'Packaged and unpacked file counts differ');
  for (const { name, bytes } of files) {
    assert.ok(!/(^|\/)(?:node_modules|\.git|test|scripts)(\/|$)/.test(name), `Development file leaked into package: ${name}`);
    assert.deepEqual(entries.get(name), bytes, `Archive differs from unpacked build: ${name}`);
  }
  assert.ok(entries.has('manifest.json'), 'Installable package must have manifest.json at its root');
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.version, version);
  const references = [
    ...Object.values(manifest.icons || {}),
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.background?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(resource => resource.resources || []),
  ].filter(Boolean);
  for (const reference of references) {
    if (!reference.includes('*')) assert.ok(entries.has(reference), `Missing manifest resource: ${reference}`);
  }
  for (const shared of ['core/activity-contract.generated.js', 'core/activity-v2-engine.generated.js', 'core/activity-v2-page.generated.js']) {
    assert.deepEqual(entries.get(shared), await fs.readFile(path.join(root, 'extension', shared)), `Shared Activity contract or engine changed in ${browser}: ${shared}`);
  }
  if (browser === 'firefox') {
    assert.ok(manifest.browser_specific_settings?.gecko?.id, 'Firefox add-on identity is required');
    assert.ok(manifest.browser_specific_settings?.gecko?.strict_min_version, 'Firefox minimum version must be explicit');
    assert.ok(!manifest.background?.service_worker, 'Firefox must use its background page');
    assert.ok(manifest.background?.page || manifest.background?.scripts?.length, 'Firefox background page is missing');
    assert.ok(!manifest.permissions.includes('offscreen'), 'Firefox cannot require Chromium offscreen documents');
    assert.ok(folderName.includes('unsigned-development'), 'Unsigned Firefox build must be clearly labeled');
  } else {
    assert.ok(manifest.background?.service_worker, 'Chromium service worker is missing');
  }
  console.log(`Verified ${path.basename(archive)}: ${entries.size} files, root manifest, checksums, references, and shared contracts.`);
}
