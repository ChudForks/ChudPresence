import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compareVersions } from './check-version-bumps.mjs';

test('version gate follows SemVer ASCII prerelease precedence', () => {
  const versions = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
    '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let index = 1; index < versions.length; index += 1) {
    assert.equal(compareVersions(versions[index - 1], versions[index]), -1);
    assert.equal(compareVersions(versions[index], versions[index - 1]), 1);
  }
  assert.equal(compareVersions('1.0.0-Z', '1.0.0-alpha'), -1);
  assert.equal(compareVersions('1.0.0-A', '1.0.0-a'), -1);
  assert.equal(compareVersions('1.0.0-a-b', '1.0.0-a0'), -1);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
});

test('version gate compares arbitrarily large numeric identifiers without rounding', () => {
  for (const [older, newer] of [
    ['9007199254740992.0.0', '9007199254740993.0.0'],
    ['1.0.0-9007199254740992', '1.0.0-9007199254740993'],
    ['1.0.0-9999999999999999999999999999999999999999', '1.0.0-10000000000000000000000000000000000000000'],
  ]) {
    assert.equal(compareVersions(older, newer), -1);
    assert.equal(compareVersions(newer, older), 1);
  }
});

test('version gate rejects malformed semantic versions', () => {
  for (const invalid of ['01.0.0', '1.0.0-01', '1.0.0-alpha..1', '1.0.0+bad+build']) {
    assert.throws(() => compareVersions(invalid, '1.0.0'), /Invalid semantic version/);
  }
});

test('version gate handles initial history, rejects unchanged versions, and permits removals', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-v2-versions-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['tools', 'schemas', 'activities/sample-video']) await fs.mkdir(path.join(root, directory), { recursive: true });
  for (const relative of ['tools/check-version-bumps.mjs', 'schemas/activity-api-v2.js']) {
    await fs.copyFile(new URL(`../${relative}`, import.meta.url), path.join(root, relative));
  }
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const metadataPath = path.join(root, 'activities/sample-video/metadata.json');
  await fs.writeFile(metadataPath, '{"version":"1.0.0"}');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const environment = { ...process.env };
  delete environment.GITHUB_EVENT_BEFORE;
  delete environment.GITHUB_BASE_REF;
  const gate = (args = [], env = environment) => spawnSync(process.execPath, ['tools/check-version-bumps.mjs', ...args], { cwd: root, encoding: 'utf8', env });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Version gate test');
  git('config', 'user.email', 'version-gate@example.invalid');
  const commit = () => { git('add', '-A'); git('commit', '-m', 'fixture'); };
  commit();
  assert.equal(gate().status, 0);
  assert.match(gate().stdout, /Initial commit/);
  assert.match(gate([], { ...environment, GITHUB_EVENT_BEFORE: '0'.repeat(40) }).stdout, /Initial commit/);
  assert.notEqual(gate(['--base=missing-ref']).status, 0);
  await fs.writeFile(path.join(root, 'activities/sample-video/activity.json'), '{}');
  commit();
  const unchanged = gate();
  assert.equal(unchanged.status, 1);
  assert.match(unchanged.stderr, /version must increase above 1.0.0/);
  await fs.writeFile(metadataPath, '{"version":"1.0.1"}');
  commit();
  assert.equal(gate(['--base=HEAD~2']).status, 0);
  await fs.rm(path.join(root, 'activities/sample-video'), { recursive: true });
  commit();
  assert.equal(gate().status, 0);
});
