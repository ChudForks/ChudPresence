import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateMetadata } from './build-catalog.mjs';
import { validateActivityV2 } from '../schemas/activity-api-v2.js';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function isolatedSdk(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-v2-sdk-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['activities', 'tools', 'schemas']) await fs.mkdir(path.join(root, directory));
  for (const name of ['chudpresence.mjs', 'build-catalog.mjs', 'generate-api-v2.mjs']) {
    await fs.copyFile(path.join(sdkRoot, 'tools', name), path.join(root, 'tools', name));
  }
  for (const name of await fs.readdir(path.join(sdkRoot, 'schemas'))) {
    await fs.copyFile(path.join(sdkRoot, 'schemas', name), path.join(root, 'schemas', name));
  }
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const run = (...args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const cli = (...args) => run('tools/chudpresence.mjs', 'activity', ...args);
  return { root, run, cli };
}

test('standalone SDK scaffolds V2 by default, validates, tests, builds, and describes development', async (t) => {
  const { root, run, cli } = await isolatedSdk(t);
  // There is no Chromium lab or V1 sibling alongside this isolated checkout.
  assert.match(run('tools/generate-api-v2.mjs', '--check'), /synchronized/);
  cli('new', 'sample-video');
  const directory = path.join(root, 'activities/sample-video');
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  assert.equal(metadata.entry, 'activity.json');
  assert.equal(metadata.apiVersion, 2);
  validateMetadata(metadata, 'sample-video');
  validateActivityV2(await fs.readFile(path.join(directory, 'activity.json'), 'utf8'));
  assert.match(cli('validate', 'sample-video'), /Validated Sample Video 1.0.0/);
  assert.match(cli('test', 'sample-video'), /pass 1/);
  assert.match(cli('dev', 'sample-video'), /JSON needs no compilation/);
  assert.match(cli('build', 'sample-video'), /catalog.json is updated/);
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'));
  assert.equal(catalog.activities.length, 1);
  assert.equal(catalog.activities[0].apiVersion, 2);
  assert.equal(catalog.activities[0].entry, 'activities/sample-video/activity.json');
  assert.match(catalog.activities[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(run('tools/build-catalog.mjs', '--check'), /Validated 1 V2 Activities/);
  for (const file of ['metadata.json', 'activity.json']) {
    const target = path.join(directory, file);
    await fs.writeFile(target, (await fs.readFile(target, 'utf8')).replaceAll('\n', '\r\n'));
  }
  assert.match(run('tools/build-catalog.mjs', '--check'), /Validated 1 V2 Activities/);
  metadata.version = '1.0.1';
  await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  assert.throws(() => run('tools/build-catalog.mjs', '--check'), /catalog.json is stale/);
});

test('V2-only SDK rejects V1 scaffolding, path traversal, executable packages, and V1 metadata', async (t) => {
  const { root, run, cli } = await isolatedSdk(t);
  assert.throws(() => cli('new', 'trusted-package', '--api=1'), /supports only declarative Activity API V2/);
  assert.throws(() => cli('new', '../outside'), /Activity ID/);
  await assert.rejects(fs.access(path.join(root, 'activities/trusted-package')));
  cli('new', 'sample-video', '--api=2');
  const directory = path.join(root, 'activities/sample-video');
  await fs.writeFile(path.join(directory, 'activity.js'), 'fetch("https://outside.example/");');
  assert.throws(() => cli('validate', 'sample-video'), /cannot contain activity.js/);
  assert.throws(() => run('tools/build-catalog.mjs'), /cannot contain activity.js/);
  await fs.rm(path.join(directory, 'activity.js'));
  await fs.writeFile(path.join(directory, 'script.mjs'), 'export default {};');
  assert.throws(() => cli('validate', 'sample-video'), /unsupported package file script.mjs/);
  await fs.rm(path.join(directory, 'script.mjs'));
  const metadataPath = path.join(directory, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  metadata.apiVersion = 1;
  metadata.entry = 'activity.js';
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  assert.throws(() => cli('validate', 'sample-video'), /requires apiVersion 2 and entry activity.json/);
  metadata.apiVersion = 2;
  metadata.entry = 'activity.json';
  assert.throws(() => validateMetadata(metadata, 'different-id'), /metadata ID must match/);
});

test('generated catalog contract permits V2 JSON paths and excludes V1 capabilities', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(sdkRoot, 'schemas/catalog.schema.json'), 'utf8'));
  const item = schema.properties.activities.items;
  assert.deepEqual(item.properties.apiVersion, { const: 2 });
  assert.match('activities/prime-video/activity.json', new RegExp(item.properties.entry.pattern));
  assert.doesNotMatch('activities/prime-video/activity.js', new RegExp(item.properties.entry.pattern));
  assert.equal(item.additionalProperties, false);
  for (const capability of ['executionWorld', 'network', 'settings', 'presence']) {
    assert.equal(Object.hasOwn(item.properties, capability), false);
  }
  assert.deepEqual(item.dependentRequired, { icon: ['iconSha256'], iconSha256: ['icon'] });
});

test('standalone V2 tooling validates and builds a declarative page package without a player', async (t) => {
  const { root, cli, run } = await isolatedSdk(t);
  cli('new', 'sample-search');
  const config = { schemaVersion: 1, kind: 'generic', scope: '#main', fields: { title: { source: 'url.query', parameter: 'q' } },
    page: { elapsed: true, routes: [{ id: 'search', paths: ['/search'], query: {}, requiredQuery: ['q'],
      name: 'Example Search', details: 'Searching for : {title}' }], artwork: { large: 'https://example.com/logo.png' } } };
  await fs.writeFile(path.join(root, 'activities/sample-search/activity.json'), JSON.stringify(config));
  assert.match(cli('validate', 'sample-search'), /Validated/);
  assert.match(cli('build', 'sample-search'), /catalog.json is updated/);
  assert.match(run('tools/build-catalog.mjs', '--check'), /Validated 1 V2 Activities/);
  const mixed = { ...config, player: { adapter: 'html-media', selectors: ['video'] } };
  assert.throws(() => validateActivityV2(JSON.stringify(mixed)), /no player/);
});
