import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'extension');
const firefoxOverlay = path.join(root, 'ChudPresence-Firefox', 'extension');
const dist = path.join(root, 'dist');

// Standard ZIP32 with UTF-8 names, fixed timestamps and file order. Keeping this
// small writer local avoids platform-dependent tar/zip tools and extra build deps.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function packageFiles(directory, prefix = '') {
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    assert.ok(!entry.isSymbolicLink(), `Packages cannot contain symlinks: ${entry.name}`);
    const name = prefix + entry.name;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await packageFiles(filename, `${name}/`));
    else if (entry.isFile()) files.push({ name, bytes: await fs.readFile(filename) });
  }
  return files;
}

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  assert.ok(files.length <= 0xffff, 'ZIP64 is not supported');
  for (const { name, bytes } of files) {
    assert.ok(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), `Unsafe archive path: ${name}`);
    const encodedName = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(bytes, { level: 9 });
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // ZIP 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8); // raw deflate
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(encodedName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(encodedName.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, encodedName, compressed);
    centralParts.push(central, encodedName);
    offset += local.length + encodedName.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export async function buildPackages(target = 'chromium') {
  assert.ok(['chromium', 'firefox', 'all'].includes(target), 'Build target must be chromium, firefox, or all');
  const chromiumManifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, chromiumManifest.version, 'package.json and Chromium manifest versions differ');
  const targets = target === 'all' ? ['chromium', 'firefox'] : [target];
  await fs.mkdir(dist, { recursive: true });
  for (const browser of targets) {
    const manifest = browser === 'firefox'
      ? JSON.parse(await fs.readFile(path.join(firefoxOverlay, 'manifest.json'), 'utf8'))
      : chromiumManifest;
    assert.equal(manifest.version, chromiumManifest.version, 'Chromium and Firefox manifest versions differ');
    const folderName = browser === 'firefox'
      ? `ChudPresence-Firefox-${manifest.version}-unsigned-development`
      : `ChudPresence-${manifest.version}`;
    const staged = path.join(dist, folderName);
    const archive = path.join(dist, `${folderName}.${browser === 'firefox' ? 'xpi' : 'zip'}`);
    // Resolve and verify the exact target before a recursive deletion. Separate
    // targets deliberately keep the other browser's existing build intact.
    assert.equal(path.dirname(path.resolve(staged)), dist);
    await fs.rm(staged, { recursive: true, force: true });
    await fs.cp(source, staged, { recursive: true });
    if (browser === 'firefox') await fs.cp(firefoxOverlay, staged, { recursive: true, force: true });
    await fs.writeFile(archive, createZip(await packageFiles(staged)));
    console.log(`Built ${archive}`);
    console.log(`Load unpacked: ${path.join(staged, 'manifest.json')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/build.mjs [chromium|firefox|all]');
  await buildPackages(process.argv[2]);
}
