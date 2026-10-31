import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('the assembled Firefox runtime migrates a disabled legacy provider without registering or injecting it', async (t) => {
  const tempRoot = path.resolve(os.tmpdir());
  const scratch = await fs.mkdtemp(path.join(tempRoot, 'chudpresence-firefox-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(scratch)), tempRoot);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const staged = path.join(scratch, 'extension');
  await fs.cp(path.join(root, 'extension'), staged, { recursive: true });
  await fs.cp(path.join(root, 'ChudPresence-Firefox', 'extension'), staged, { recursive: true });
  await fs.writeFile(path.join(scratch, 'package.json'), '{"type":"module"}');
  const { ActivityManager } = await import(pathToFileURL(path.join(staged, 'core', 'activity-manager.js')));
  const manifest = JSON.parse(await fs.readFile(path.join(staged, 'manifest.json'), 'utf8'));
  const data = { enabled: true, sourceYouTube: false, youtubeShowArtwork: false,
    discordHeadlessSession: 'existing-session', discordAuth: { accessToken: 'existing-access' } };
  const registrations = [];
  const injections = [];
  const api = {
    storage: { local: {
      async get(keys) { return structuredClone(keys === null ? data
        : Object.fromEntries([].concat(keys).map(key => [key, data[key]]))); },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
    } },
    runtime: { getManifest: () => manifest, onConnect: { addListener() {} } },
    permissions: { async contains() { return true; } },
    tabs: { async query() { return [{ id: 7, url: 'https://www.youtube.com/watch?v=manual' }]; } },
    userScripts: {
      async getScripts() { return []; }, async configureWorld() {},
      async register(scripts) { registrations.push(...scripts); },
      async execute(options) { injections.push(options); return [{ frameId: 0, documentId: 'document-7' }]; },
    },
  };
  const manager = new ActivityManager({ api });
  await manager.install({
    metadata: { id: 'youtube', name: 'YouTube', description: 'Integration fixture', version: '1.0.0',
      apiVersion: 1, matches: ['https://www.youtube.com/*'], entry: 'activity.js' },
    source: 'ChudPresence.clear();',
  });
  assert.equal(data.installedActivities.youtube.enabled, false);
  assert.equal(data.installedActivities.youtube.preferences.showArtwork, false);
  assert.equal(registrations.length, 0);
  assert.equal(injections.length, 0);
  assert.equal(data.firefoxLegacyActivityDefaults.youtube, undefined);
  assert.equal(data.discordHeadlessSession, 'existing-session');
  assert.equal(data.discordAuth.accessToken, 'existing-access');
  await manager.setEnabled('youtube', true);
  assert.equal(data.installedActivities.youtube.enabled, true);
  assert.equal(registrations.length, 1);
  assert.equal(injections.length, 1);
  assert.equal(injections[0].world, 'USER_SCRIPT');
  assert.equal(injections[0].worldId, 'chudpresence.activity.youtube');
});
