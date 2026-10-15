#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_ID_PATTERN } from '../schemas/activity-api-v2.js';
import { buildCatalog, readPackage } from './build-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activitiesRoot = path.join(root, 'activities');

function usage() {
  console.log(`ChudPresence Activity SDK V2

Usage:
  chudpresence activity new <id>
  chudpresence activity validate <id>
  chudpresence activity build <id>
  chudpresence activity dev <id>
  chudpresence activity test <id>
`);
}

function activityDirectory(id) {
  if (!new RegExp(ACTIVITY_ID_PATTERN).test(String(id || ''))) {
    throw new Error('Activity ID must contain 2–64 lowercase letters, numbers, and hyphens, starting with a letter or number.');
  }
  return path.join(activitiesRoot, id);
}

async function createActivity(id) {
  const directory = activityDirectory(id);
  const name = id.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const metadata = {
    id, name, description: `Show current media playback from ${name}.`, version: '1.0.0',
    apiVersion: 2, minExtensionVersion: '2.1.0', category: 'other', defaultMediaKind: 'video',
    matches: ['https://example.com/*'], entry: 'activity.json',
  };
  const configuration = {
    schemaVersion: 2, kind: 'video', scope: '#player',
    fields: { title: { source: 'dom.text', selectors: ['.media-title'] } },
    player: { adapter: 'html-media', selectors: ['video'] },
  };
  await fs.mkdir(directory, { recursive: false });
  await fs.mkdir(path.join(directory, 'tests'));
  await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'activity.json'), JSON.stringify(configuration, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'tests/activity.test.js'), `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateActivityV2, validateV2Metadata } from '../../../schemas/activity-api-v2.js';

test('${id} is a valid declarative V2 package', async () => {
  const metadata = validateV2Metadata(JSON.parse(await readFile(new URL('../metadata.json', import.meta.url), 'utf8')));
  const configuration = validateActivityV2(await readFile(new URL('../activity.json', import.meta.url), 'utf8'));
  assert.equal(metadata.id, '${id}');
  assert.equal(metadata.apiVersion, 2);
  assert.equal(configuration.player.adapter, 'html-media');
});
`);
  console.log(`Created declarative V2 activities/${id}. Edit metadata.json and activity.json, then validate, test, and build.`);
}

async function runTests(id) {
  await readPackage(id);
  const files = [];
  async function collect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && /\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(file);
    }
  }
  await collect(path.join(activityDirectory(id), 'tests'));
  if (!files.length) throw new Error(`${id} has no tests under its tests/ directory.`);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  execFileSync(process.execPath, ['--test', ...files.sort()], { cwd: root, stdio: 'inherit', env: environment });
}

async function main() {
  const [noun, command, id, ...options] = process.argv.slice(2);
  if (noun !== 'activity' || !command) return usage();
  if (options.some((option) => option !== '--api=2')) throw new Error('This SDK supports only declarative Activity API V2.');
  if (command === 'new') return createActivity(id);
  activityDirectory(id);
  if (command === 'test') return runTests(id);
  if (['build', 'validate', 'dev'].includes(command)) {
    const metadata = await readPackage(id);
    if (command === 'build') await buildCatalog();
    console.log(`Validated ${metadata.name} ${metadata.version}.`);
    if (command === 'build') console.log('V2 JSON needs no compilation; catalog.json is updated.');
    if (command === 'dev') console.log('V2 JSON needs no compilation. Edit both JSON files, increment the package version, then validate and build. Reimport the files in the Activity Library and approve the update.');
    return;
  }
  usage();
  throw new Error(`Unknown Activity command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message || String(error)); process.exitCode = 1; });
}
