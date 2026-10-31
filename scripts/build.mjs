import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PACKAGE_TARGETS = Object.freeze(['chromium', 'firefox', 'firefox-production']);

export function packageFolderName(target, version) {
  assert.ok(PACKAGE_TARGETS.includes(target), 'Unknown package target');
  assert.match(version, /^\d+(?:\.\d+){1,3}$/, 'Package version must be a numeric extension version');
  if (target === 'chromium') return `ChudPresence-${version}`;
  return `ChudPresence-Firefox-${version}-unsigned-${target === 'firefox-production' ? 'production' : 'development'}`;
}

export async function loadPackageManifest(target, sourceRoot = root) {
  assert.ok(PACKAGE_TARGETS.includes(target), 'Unknown package target');
  const filename = target === 'chromium' ? 'extension/manifest.json' : 'ChudPresence-Firefox/extension/manifest.json';
  const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, filename), 'utf8'));
  if (target !== 'firefox-production') return manifest;

  const profile = JSON.parse(await fs.readFile(path.join(sourceRoot, 'ChudPresence-Firefox/production.json'), 'utf8'));
  assert.deepEqual(Object.keys(profile).sort(), ['id', 'name'], 'Firefox production profile must contain only name and id');
  assert.ok(typeof profile.name === 'string' && profile.name.trim() && profile.name.length <= 75, 'Firefox production name is invalid');
  assert.ok(typeof profile.id === 'string' && profile.id.length <= 80 &&
    /^(?:[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+|\{[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\})$/.test(profile.id),
  'Firefox production add-on ID is invalid');
  assert.notEqual(profile.id, manifest.browser_specific_settings.gecko.id, 'Firefox production and development identities must differ');
  manifest.name = profile.name;
  manifest.browser_specific_settings.gecko.id = profile.id;
  return manifest;
}

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

export async function buildPackages(target = 'chromium', { sourceRoot = root } = {}) {
  assert.ok([...PACKAGE_TARGETS, 'all'].includes(target), 'Build target must be chromium, firefox, firefox-production, or all');
  const source = path.join(sourceRoot, 'extension');
  const firefoxOverlay = path.join(sourceRoot, 'ChudPresence-Firefox', 'extension');
  const dist = path.resolve(sourceRoot, 'dist');
  const chromiumManifest = await loadPackageManifest('chromium', sourceRoot);
  const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, chromiumManifest.version, 'package.json and Chromium manifest versions differ');
  const targets = target === 'all' ? PACKAGE_TARGETS : [target];
  const built = [];
  await fs.mkdir(dist, { recursive: true });
  for (const browser of targets) {
    const manifest = await loadPackageManifest(browser, sourceRoot);
    assert.equal(manifest.version, chromiumManifest.version, 'Chromium and Firefox manifest versions differ');
    const folderName = packageFolderName(browser, manifest.version);
    const staged = path.join(dist, folderName);
    const archive = path.join(dist, `${folderName}.${browser === 'chromium' ? 'zip' : 'xpi'}`);
    // Resolve and verify the exact target before a recursive deletion. Separate
    // targets deliberately keep the other browser's existing build intact.
    assert.equal(path.dirname(path.resolve(staged)), dist);
    await fs.rm(staged, { recursive: true, force: true });
    await fs.cp(source, staged, { recursive: true });
    if (browser !== 'chromium') await fs.cp(firefoxOverlay, staged, { recursive: true, force: true });
    if (browser === 'firefox-production') {
      await fs.writeFile(path.join(staged, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await fs.writeFile(archive, createZip(await packageFiles(staged)));
    console.log(`Built ${archive}`);
    console.log(`Load unpacked: ${path.join(staged, 'manifest.json')}`);
    built.push({ target: browser, staged, archive });
  }
  return built;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/build.mjs [chromium|firefox|firefox-production|all]');
  await buildPackages(process.argv[2]);
}
