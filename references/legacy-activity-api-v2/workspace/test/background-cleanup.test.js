import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { selectActivity } from '../extension/core/activity.js';
import { ActivityRegistry } from '../extension/core/activity-registry.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { createPresenceClearDelay } from '../extension/core/presence-clear-delay.js';
import * as settings from '../extension/core/settings.js';

const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '');

async function createBackgroundHarness(activityPreferences = {}) {
  const timers = new Map();
  const publications = [];
  const diagnosticClears = [];
  let nextTimer = 0;
  let managerCallbacks;
  const schedule = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  const cancel = (id) => timers.delete(id);
  const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); }, hasListener: () => false });
  const removed = event();
  const activated = event();
  const chrome = {
    runtime: { onMessage: event(), onConnect: event(), onUserScriptMessage: event(), onUserScriptConnect: event(), getURL: (path = '') => `chrome-extension://test/${path}` },
    tabs: { onRemoved: removed, onUpdated: event(), onActivated: activated, sendMessage: async () => {}, get: async () => ({ windowId: 1 }) },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: event() },
    alarms: { create: async () => {}, onAlarm: event() },
    action: { setTitle() {} },
  };
  vm.runInNewContext(source, {
    ...settings,
    chrome, selectActivity, ActivityRegistry, createPresenceIntent,
    ActivityManager: class {
      constructor(callbacks) { managerCallbacks = callbacks; }
      restoreAll() { return Promise.resolve(); }
      invalidateTab() { return Promise.resolve(); }
      preferencesFor(id) { return activityPreferences[id] || {}; }
      async clearDiagnostics(id) {
        diagnosticClears.push(id);
        return { id, activityLogsCleared: 2, networkRequestsCleared: 1,
          diagnosticsCleared: 1, pendingNetworkRequests: 0 };
      }
    },
    createPresenceClearDelay: (callback) => createPresenceClearDelay(callback, { schedule, cancel }),
    registerActivityRestoreHandlers() {},
    ensureBundledYouTubeInstalled: async () => {},
    rememberBundledYouTubeRemoval() {},
    sanitizeDiagnosticValue: (value) => value,
    shouldInvalidateActivityTab: () => false,
    shouldRetireActivityTab: () => true,
    presencePublisher: {
      status: () => ({}), initialize: async () => {},
      async publish(intent, applicationId, options) {
        publications.push({ intent, applicationId, options });
        return {};
      },
    },
    EXTENSION_NAME: 'Test',
    setTimeout: schedule, clearTimeout: cancel,
  });
  await Promise.resolve();
  return {
    callbacks: managerCallbacks, timers, publications, diagnosticClears,
    sendMessage: (message, url = 'chrome-extension://test/activities.html') => new Promise((resolve) =>
      chrome.runtime.onMessage.listeners[0](message, { url }, resolve)),
    removeTab: (tabId) => removed.listeners[0](tabId),
    activateTab: (tabId, windowId = 1) => activated.listeners[0]({ tabId, windowId }),
    runTimer(delay) {
      const [id, timer] = [...timers].find(([, entry]) => entry.delay === delay);
      timers.delete(id);
      timer.callback();
    },
    report(documentId = 'source-document') {
      managerCallbacks.onReport({ tabId: 9, documentId, frameId: 0, track: { activityId: 'music', title: 'A song' } });
    },
  };
}

test('document-exit clear publishes immediately before tab removal can forget the report', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true });
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent, null);
  assert.equal(harness.publications[0].options.closing, true);
  harness.removeTab(9);
  assert.equal(harness.publications.length, 1);
});

const googleTrack = (name = 'Google') => ({ activityId: 'google', activityName: name, kind: 'generic',
  media: { title: 'test' }, playback: { state: 'playing', position: 0, duration: 0, live: false, rate: 1 },
  display: { details: 'Searching for : test', state: '', omitState: true, elapsed: true }, artwork: {}, visibility: 'normal' });

test('approved Google mode navigation replaces the existing presence without a blank publication', async () => {
  const h = await createBackgroundHarness();
  h.callbacks.onReport({ tabId: 9, documentId: 'search', frameId: 0, track: googleTrack() });
  h.runTimer(250); assert.equal(h.publications.at(-1).intent.name, 'Google');
  h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
  assert.equal(h.publications.length, 1);
  assert.ok([...h.timers.values()].some(timer => timer.delay === 5000));
  h.callbacks.onReport({ tabId: 9, documentId: 'images', frameId: 0, track: googleTrack('Google Images') });
  h.runTimer(250);
  assert.deepEqual(h.publications.map(value => value.intent?.name), ['Google', 'Google Images']);
  assert.ok(![...h.timers.values()].some(timer => timer.delay === 5000));
  h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
  assert.equal(h.publications.length, 2, 'A late outgoing document cannot clear its replacement');
});

test('Google navigation grace expires when the destination never produces an eligible report', async () => {
  const h = await createBackgroundHarness();
  h.callbacks.onReport({ tabId: 9, documentId: 'search', frameId: 0, track: googleTrack() }); h.runTimer(250);
  h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
  h.runTimer(5000);
  assert.equal(h.publications.at(-1).intent, null);
  assert.equal(h.publications.length, 2);
});

test('closing the actual browser tab or switching away cancels Google navigation grace immediately', async () => {
  for (const action of ['remove', 'activate']) {
    const h = await createBackgroundHarness();
    h.callbacks.onReport({ tabId: 9, documentId: 'search', frameId: 0, track: googleTrack() }); h.runTimer(250);
    h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
    if (action === 'remove') h.removeTab(9); else await h.activateTab(10);
    assert.equal(h.publications.at(-1).intent, null, action);
    assert.ok(![...h.timers.values()].some(timer => timer.delay === 5000), action);
    if (action === 'remove') assert.equal(h.publications.at(-1).options.closing, true);
  }
});

test('tab activation in a different window does not interrupt a visible Google navigation', async () => {
  const h = await createBackgroundHarness();
  h.callbacks.onReport({ tabId: 9, documentId: 'search', frameId: 0, track: googleTrack() }); h.runTimer(250);
  h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
  await h.activateTab(10, 2);
  assert.equal(h.publications.length, 1);
  assert.ok([...h.timers.values()].some(timer => timer.delay === 5000));
});

test('disabling an Activity cancels its held Google navigation report', async () => {
  const h = await createBackgroundHarness();
  h.callbacks.onReport({ tabId: 9, documentId: 'search', frameId: 0, track: googleTrack() }); h.runTimer(250);
  h.callbacks.onClear('google', 9, 'search', 0, { closing: true, navigating: true });
  h.callbacks.onClear('google');
  assert.ok(![...h.timers.values()].some(timer => timer.delay === 5000));
  h.runTimer(250); h.runTimer(1500);
  assert.equal(h.publications.at(-1).intent, null);
});

test('ordinary Activity clear retains the delay for transient playback changes', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0);
  assert.equal(harness.publications.length, 0);
  harness.runTimer(250);
  assert.equal(harness.publications.length, 0);
  harness.runTimer(1500);
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].options.closing, false);
});

test('a late document-exit clear cannot remove a replacement report', async () => {
  const harness = await createBackgroundHarness();
  harness.report('replacement-document');
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true });
  assert.equal(harness.publications.length, 0);
});

test('publishes an eligible paused frame when a newer frame hides paused presence', async () => {
  const harness = await createBackgroundHarness({ music: { showPaused: true }, video: { showPaused: false } });
  harness.callbacks.onReport({
    tabId: 9, documentId: 'music-document', frameId: 3,
    track: { activityId: 'music', title: 'Paused song', playing: false },
  });
  harness.callbacks.onReport({
    tabId: 9, documentId: 'video-document', frameId: 4,
    track: { activityId: 'video', title: 'Paused video', playing: false },
  });
  harness.runTimer(250);

  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent.details, 'Paused song');
  assert.equal(harness.publications[0].intent.source, 'music');
});

test('permits diagnostic clearing only from extension pages', async () => {
  const harness = await createBackgroundHarness();
  const denied = await harness.sendMessage({ type: 'ACTIVITY_CLEAR_DIAGNOSTICS', id: 'music' }, 'https://example.com/watch');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /only available on extension pages/);
  assert.deepEqual(harness.diagnosticClears, []);

  const selected = await harness.sendMessage({ type: 'ACTIVITY_CLEAR_DIAGNOSTICS', id: 'music' });
  assert.equal(selected.ok, true);
  assert.equal(selected.result.id, 'music');
  assert.equal(selected.result.activityLogsCleared, 2);
  const all = await harness.sendMessage({ type: 'ACTIVITY_CLEAR_DIAGNOSTICS' });
  assert.equal(all.ok, true);
  assert.equal(all.result.id, null);
  assert.deepEqual(harness.diagnosticClears, ['music', null]);
  assert.equal(harness.publications.length, 0);
});

test('rejects malformed diagnostic-clear scopes instead of clearing all Activities', async () => {
  const harness = await createBackgroundHarness();
  for (const id of [undefined, 0, false, [], {}]) {
    const response = await harness.sendMessage({ type: 'ACTIVITY_CLEAR_DIAGNOSTICS', id });
    assert.equal(response.ok, false);
    assert.match(response.error, /valid Activity ID/);
  }
  assert.deepEqual(harness.diagnosticClears, []);
});
