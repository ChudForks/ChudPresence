import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const capability = 'a'.repeat(64);
const sender = { tab: { id: 9 }, frameId: 0, documentId: 'active-document', url: 'https://example.com/watch' };
const flush = async () => { for (let turn = 0; turn < 60; turn += 1) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };

function event() {
  const listeners = new Set();
  return { listeners, addListener(listener) { listeners.add(listener); },
    hasListener(listener) { return listeners.has(listener); },
    dispatch(...args) { return [...listeners].map(listener => listener(...args)); } };
}

async function wakeHarness(t, { secondTab = false, ageMs = 0, snapshotFailures = 0, foreground = false } = {}) {
  const tempRoot = path.resolve(os.tmpdir());
  const scratch = await fs.mkdtemp(path.join(tempRoot, 'chudpresence-firefox-wake-'));
  const originals = Object.fromEntries(['browser', 'chrome', 'fetch'].map(key => [key, globalThis[key]]));
  t.after(async () => {
    await flush();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    assert.equal(path.dirname(path.resolve(scratch)), tempRoot);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const staged = path.join(scratch, 'extension');
  await fs.cp(path.join(root, 'extension'), staged, { recursive: true });
  await fs.cp(path.join(root, 'ChudPresence-Firefox', 'extension'), staged, { recursive: true });
  await fs.writeFile(path.join(scratch, 'package.json'), '{"type":"module"}');
  const manifest = JSON.parse(await fs.readFile(path.join(staged, 'manifest.json'), 'utf8'));
  const local = {
    enabled: true, firefoxSettingsMigrationVersion: 1, defaultYouTubeActivityDecision: 'removed',
    installedActivities: { music: {
      metadata: { id: 'music', name: 'Music', description: 'Cold wake fixture', version: '1.0.0',
        apiVersion: 1, matches: ['https://example.com/*'], entry: 'activity.js' },
      code: 'ChudPresence.clear();', enabled: true, capability,
    } },
    discordHeadlessSession: 'active-discord-session',
  };
  const session = {};
  const requests = [];
  let gateEnabled = false;
  let snapshotReads = 0;
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  let markReading;
  const reading = new Promise(resolve => { markReading = resolve; });
  const area = (data, isSession = false) => ({
    async get(keys) {
      if (isSession && gateEnabled && [].concat(keys).includes('firefoxActivitySession')) {
        snapshotReads += 1;
        markReading();
        await gate;
        if (snapshotFailures-- > 0) throw new Error('Transient Firefox session storage read failed');
      }
      return structuredClone(keys === null ? data
        : Object.fromEntries([].concat(keys).map(key => [key, data[key]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
  });
  const browser = {
    runtime: { getBrowserInfo() {}, getManifest: () => manifest,
      getURL: (file = '') => `moz-extension://wake-test/${file}`,
      onMessage: event(), onConnect: event(), onUserScriptMessage: event(), onUserScriptConnect: event(),
      onInstalled: event(), onStartup: event(), onSuspend: event(), onSuspendCanceled: event(),
    },
    storage: { local: area(local), session: area(session, true), onChanged: event() },
    permissions: { async contains() { return true; }, onAdded: event(), onRemoved: event() },
    tabs: { onRemoved: event(), onUpdated: event(), onActivated: event(), onDetached: event(), onAttached: event(), onReplaced: event(), async query() { return []; },
      async get() { return { id: 9, url: sender.url }; }, async sendMessage() {} },
    windows: { onFocusChanged: event(), onRemoved: event(), async getAll() { return []; } },
    alarms: { async create() {}, onAlarm: event() }, action: { setTitle() {} },
    userScripts: { async getScripts() { return []; }, async configureWorld() {},
      async register() {}, async update() {}, async unregister() {}, async execute() { return []; } },
  };
  globalThis.browser = browser;
  globalThis.chrome = browser;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    return { ok: true, status: 204, headers: new Headers(), async json() { return {}; } };
  };
  const files = ['platform/browser-api.js', 'platform/migration.js', 'platform/activity-session.js',
    'core/activity.js', 'core/activity-registry.js', 'core/foreground.js', 'core/activity-manager.js', 'core/activity-restore.js',
    'core/default-activity.js', 'core/tab-lifecycle.js', 'core/presence.js', 'core/presence-clear-delay.js',
    'core/settings.js', 'platform/presence-publisher.js', 'core/branding.js', 'core/activity-validator.js', 'config.js'];
  const bindings = Object.assign({}, ...await Promise.all(files.map(file => import(pathToFileURL(path.join(staged, file))))));
  local.discordAuthClientId = bindings.DISCORD_CLIENT_ID;
  local.discordAuth = { accessToken: 'private-discord-access', refreshToken: 'private-discord-refresh', expiresAt: Date.now() + 3600000 };
  const track = { ...bindings.normalizeActivityReport({ kind: 'song', media: { title: 'Restored song', artist: 'Artist' },
    playback: { state: 'playing' }, ...(foreground ? { focusPolicy: 'foreground' } : {}) }, 1), source: 'activity', activityId: 'music', activityVersion: '1.0.0', activityName: 'Music' };
  const registry = new bindings.ActivityRegistry();
  registry.update(9, sender.documentId, track, 0);
  const fallback = { ...track, media: { ...track.media, title: 'Second song' },
    display: { ...track.display, details: 'Second song' } };
  if (secondTab) registry.update(10, 'second-document', fallback, 0);
  const seed = new bindings.ActivityManager({ api: browser,
    sessionContext: { registry, getActiveTab: () => 9, setActiveTab() {} } });
  await seed.load();
  const lastSeenAt = Date.now() - ageMs;
  seed.lastSeen.set('music', new Map([[9, new Map([[0, { tabId: 9, frameId: 0,
    documentId: sender.documentId, senderUrl: sender.url, lastSeen: lastSeenAt, active: true,
    track, retiredDocumentIds: new Set() }]])]]));
  if (secondTab) seed.lastSeen.get('music').set(10, new Map([[0, { tabId: 10, frameId: 0,
    documentId: 'second-document', senderUrl: 'https://example.com/second', lastSeen: lastSeenAt,
    active: true, track: fallback, retiredDocumentIds: new Set() }]]));
  await bindings.saveActivitySession(seed);
  assert.equal(session.firefoxActivitySession.registry.length, secondTab ? 2 : 1);
  session.discordLastIntent = { intent: bindings.createPresenceIntent(track), applicationId: bindings.DISCORD_CLIENT_ID };
  gateEnabled = true;
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({ ...bindings, chrome: browser, browser,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const background = (await fs.readFile(path.join(staged, 'background.js'), 'utf8'))
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '');
  vm.runInContext(`${background}\nglobalThis.wake = { activityManager, activityRegistry, ready: activityReady, currentTrack };`, context);
  await reading;
  return {
    browser, local, session, requests, timers, lastSeenAt, wake: context.wake,
    snapshotReads: () => snapshotReads,
    release: unblock,
    async ready() { unblock(); await context.wake.ready; await context.wake.activityManager.operation; await flush(); },
    clear(documentId = sender.documentId) {
      const message = { type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'music', activityVersion: '1.0.0',
        capability, apiVersion: 1, requestId: 'first-wake-clear', operation: 'presence.clear', payload: { closing: true } };
      return new Promise(resolve => {
        const results = browser.runtime.onUserScriptMessage.dispatch(message, { ...sender, documentId }, resolve);
        assert.equal(results[0], true);
      });
    },
  };
}

function assertKeepaliveDeletion(harness) {
  const deletions = harness.requests.filter(request => request.url.endsWith('/headless-sessions/delete'));
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].keepalive, true);
  assert.equal(deletions[0].headers.Authorization, 'Bearer private-discord-access');
  assert.deepEqual(JSON.parse(deletions[0].body), { token: 'active-discord-session' });
  assert.equal(harness.local.discordHeadlessSession, undefined);
}

test('a tab removal that wakes Firefox restores report ownership before clearing Discord with keepalive', async (t) => {
  const harness = await wakeHarness(t);
  harness.browser.tabs.onRemoved.dispatch(9);
  await flush();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.local.discordHeadlessSession, 'active-discord-session');
  await harness.ready();
  assertKeepaliveDeletion(harness);
  assert.equal(harness.wake.activityRegistry.has(9), false);
  assert.equal(harness.wake.activityManager.removedTabs.has(9), true);
});

test('a Firefox cold wake suppresses a retained foreground report when no browser window has focus', async (t) => {
  const harness = await wakeHarness(t, { foreground: true });
  await harness.ready();
  assert.equal(harness.wake.activityRegistry.has(9), true, 'suppression must retain report ownership');
  assert.equal(harness.wake.currentTrack(), null);
  const deletions = harness.requests.filter(request => request.url.endsWith('/headless-sessions/delete'));
  assert.equal(deletions.length, 1);
});

test('a document closing message that wakes Firefox recognizes its restored owner and clears immediately', async (t) => {
  const harness = await wakeHarness(t);
  let responded = false;
  const response = harness.clear().then(value => { responded = true; return value; });
  await flush();
  assert.equal(responded, false);
  assert.equal(harness.requests.length, 0);
  await harness.ready();
  const result = await response;
  await flush();
  assert.equal(result.ok, true);
  assert.equal(result.data.cleared, true);
  assert.equal(result.data.stale, false);
  assertKeepaliveDeletion(harness);
  assert.equal(harness.wake.activityRegistry.has(9), false);
});

test('ordinary Firefox background wake restores active selection and leaves Discord presence intact', async (t) => {
  const harness = await wakeHarness(t);
  await harness.ready();
  assert.equal(harness.wake.activityRegistry.has(9), true);
  assert.equal(harness.wake.currentTrack().media.title, 'Restored song');
  assert.equal(harness.wake.activityManager.lastSeen.get('music').get(9).get(0).documentId, sender.documentId);
  assert.equal(harness.requests.some(request => request.url.endsWith('/headless-sessions/delete')), false);
  assert.equal(harness.local.discordHeadlessSession, 'active-discord-session');
  assert.equal(harness.local.discordAuth.accessToken, 'private-discord-access');
});

test('Firefox cold tab removal selects another restored live tab without publishing an empty presence', async (t) => {
  const harness = await wakeHarness(t, { secondTab: true });
  harness.browser.tabs.onRemoved.dispatch(9);
  await harness.ready();
  assert.equal(harness.wake.activityRegistry.has(9), false);
  assert.equal(harness.wake.activityRegistry.has(10), true);
  assert.equal(harness.wake.currentTrack().media.title, 'Second song');
  assert.equal(harness.requests.some(request => request.url.endsWith('/headless-sessions/delete')), false);
  const updates = harness.requests.filter(request => request.url.endsWith('/headless-sessions'));
  assert.equal(updates.length, 1);
  const body = JSON.parse(updates[0].body);
  assert.equal(body.token, 'active-discord-session');
  assert.equal(body.activities[0].details, 'Second song');
  assert.equal(harness.local.discordHeadlessSession, 'active-discord-session');
});

test('a stale old-document clear arriving on Firefox wake cannot erase the restored replacement owner', async (t) => {
  const harness = await wakeHarness(t);
  const response = harness.clear('retired-document');
  await harness.ready();
  const result = await response;
  await flush();
  assert.equal(result.ok, true);
  assert.equal(result.data.cleared, false);
  assert.equal(result.data.stale, true);
  assert.equal(harness.wake.activityRegistry.has(9), true);
  assert.equal(harness.wake.activityManager.lastSeen.get('music').get(9).get(0).documentId, sender.documentId);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.local.discordHeadlessSession, 'active-discord-session');
});

test('Firefox wake preserves the report heartbeat timestamp so stale cleanup uses its original age', async (t) => {
  const harness = await wakeHarness(t, { ageMs: 50000 });
  await harness.ready();
  const manager = harness.wake.activityManager;
  assert.equal(manager.lastSeen.get('music').get(9).get(0).lastSeen, harness.lastSeenAt);
  assert.equal(await manager.pruneStale(harness.lastSeenAt + 90000), 0);
  assert.equal(harness.wake.activityRegistry.has(9), true);
  assert.equal(await manager.pruneStale(harness.lastSeenAt + 90001), 1);
  assert.equal(harness.wake.activityRegistry.has(9), false);
  assert.equal(harness.requests.length, 0);
});

test('Firefox retries a transient snapshot read failure before applying its queued closing event', async (t) => {
  const harness = await wakeHarness(t, { snapshotFailures: 1 });
  harness.browser.tabs.onRemoved.dispatch(9);
  await flush();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.local.discordHeadlessSession, 'active-discord-session');
  await harness.ready();
  assert.equal(harness.snapshotReads(), 2);
  assertKeepaliveDeletion(harness);
  assert.equal(harness.wake.activityRegistry.has(9), false);
});

test('a renewal that wakes Firefox prunes expired restored reports before any stale Discord update', async (t) => {
  const harness = await wakeHarness(t, { ageMs: 120000 });
  harness.browser.alarms.onAlarm.dispatch({ name: 'discord-presence-renew' });
  await flush();
  assert.equal(harness.requests.length, 0);
  await harness.ready();
  const deletions = harness.requests.filter(request => request.url.endsWith('/headless-sessions/delete'));
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].headers.Authorization, 'Bearer private-discord-access');
  assert.deepEqual(JSON.parse(deletions[0].body), { token: 'active-discord-session' });
  assert.equal(harness.requests.some(request => request.url.endsWith('/headless-sessions')), false);
  assert.equal(harness.wake.activityRegistry.has(9), false);
  assert.equal(harness.local.discordHeadlessSession, undefined);
});
