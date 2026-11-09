import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as activityPriority from '../extension/core/activity-priority.js';
import { ActivityRegistry } from '../extension/core/activity-registry.js';
import { createForegroundTracker } from '../extension/core/foreground.js';
import { createPresenceSession } from '../extension/core/presence.js';
import { createPresenceClearDelay } from '../extension/core/presence-clear-delay.js';
import * as settings from '../extension/core/settings.js';
import { migratePlatformSettings } from '../extension/platform/migration.js';

const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '');

async function createBackgroundHarness(activityPreferences = {}, {
  getStoredSettings = async () => ({}), waitForReady = true, now = Date.now, sessionData = {}, installed = [],
} = {}) {
  const timers = new Map();
  const publications = [];
  const diagnosticClears = [];
  const localEdits = [];
  const activityEnabled = new Map(Object.keys(activityPreferences).map(id => [id, true]));
  let linkHooks;
  let renewals = 0;
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
  const windows = [{ id: 1, focused: true, tabs: [{ id: 9, active: true }] }];
  const chrome = {
    runtime: { onMessage: event(), onConnect: event(), onUserScriptMessage: event(), onUserScriptConnect: event(), getURL: (path = '') => `chrome-extension://test/${path}` },
    tabs: { onRemoved: removed, onUpdated: event(), onActivated: event(), onDetached: event(),
      onAttached: event(), onReplaced: event(), sendMessage: async () => {}, get: async () => ({}) },
    windows: { onFocusChanged: event(), onRemoved: event(), getAll: async () => structuredClone(windows) },
    storage: { local: { get: getStoredSettings, set: async () => {}, remove: async () => {} },
      session: { get: async () => structuredClone(sessionData), set: async values => { Object.assign(sessionData, structuredClone(values)); } },
      onChanged: event() },
    alarms: { create: async () => {}, onAlarm: event() },
    action: { setTitle() {} },
  };
  const ready = vm.runInNewContext(`${source}\nensureActivityReady();`, {
    ...settings, ...activityPriority,
    chrome, isFirefox: false, ActivityRegistry, createForegroundTracker, migratePlatformSettings,
    createPresenceSession: options => createPresenceSession({ ...options, now }),
    Date: class extends Date { static now() { return now(); } },
    ActivityManager: class {
      constructor(callbacks) { managerCallbacks = callbacks; }
      async load() { return {}; }
      async status() { return { installed }; }
      restoreAll() { return Promise.resolve(); }
      invalidateTab() { return Promise.resolve(); }
      preferencesFor(id) { return activityPreferences[id] || {}; }
      async setPreferences(id, patch) { return activityPreferences[id] = { ...activityPreferences[id], ...patch }; }
      async listInstalled() { return [...activityEnabled].map(([id, enabled]) => ({ id, enabled, preferences: activityPreferences[id] })); }
      async setEnabled(id, enabled) {
        activityEnabled.set(id, enabled);
        if (!enabled) managerCallbacks.onClear(id);
        return { id, enabled };
      }
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
      configureLink(hooks) { linkHooks = hooks; },
      async editPreference(id, patch, apply) { localEdits.push({ id, patch }); return apply(); },
      refresh: async () => ({ link: { connected: true } }),
      async publish(intent, applicationId, options) {
        publications.push({ intent, applicationId, options });
        return {};
      },
      async renew() { renewals++; return {}; },
    },
    EXTENSION_NAME: 'Test',
    setTimeout: schedule, clearTimeout: cancel,
  });
  if (waitForReady) await ready;
  return {
    callbacks: managerCallbacks, timers, publications, diagnosticClears, ready, localEdits, activityEnabled,
    applyLinkedSettings: (id, patch) => linkHooks.applySettings(id, patch),
    renewals: () => renewals,
    alarm: name => { for (const listener of chrome.alarms.onAlarm.listeners) listener({ name }); },
    sendMessage: (message, url = 'chrome-extension://test/activities.html', tab = undefined) => new Promise((resolve) =>
      chrome.runtime.onMessage.listeners[0](message, { url, tab }, resolve)),
    removeTab: (tabId) => {
      for (const window of windows) window.tabs = window.tabs.filter(tab => tab.id !== tabId);
      for (const listener of removed.listeners) listener(tabId);
    },
    activate(tabId, windowId = 1) {
      const window = windows.find(window => window.id === windowId);
      window.tabs = [{ id: tabId, active: true }];
      for (const listener of chrome.tabs.onActivated.listeners) listener({ tabId, windowId });
    },
    focus(windowId) {
      for (const window of windows) window.focused = window.id === windowId;
      for (const listener of chrome.windows.onFocusChanged.listeners) listener(windowId);
    },
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

test('Link pairing and sync controls reject messages from webpages', async () => {
  const harness = await createBackgroundHarness();
  for (const type of ['LINK_PAIR', 'LINK_UNPAIR', 'LINK_REFRESH', 'LINK_SET_SYNC']) {
    const response = await harness.sendMessage({ type }, 'https://example.com/');
    assert.equal(response.ok, false);
    assert.match(response.error, /only available on extension pages/);
  }
});

test('Link controls accept a trusted popup opened in a tab with a navigation hash', async () => {
  const harness = await createBackgroundHarness();
  const response = await harness.sendMessage({ type: 'LINK_REFRESH' }, 'chrome-extension://test/popup.html#link', { id: 12 });
  assert.equal(response.ok, true);
  assert.equal(response.result.connected, true);
});

test('a Chromium cold wake waits for the saved sharing opt-out before publishing', async () => {
  let resolveSettings;
  const storedSettings = new Promise(resolve => { resolveSettings = resolve; });
  const harness = await createBackgroundHarness({}, {
    getStoredSettings: () => storedSettings, waitForReady: false,
  });
  harness.report();
  harness.runTimer(250);
  const state = harness.sendMessage({ type: 'GET_STATE' });
  assert.equal(harness.publications.length, 0);

  resolveSettings({ enabled: false });
  await harness.ready;
  // The deferred report sees the loaded opt-out and schedules only a clear.
  await Promise.resolve();
  harness.runTimer(1500);
  assert.ok(harness.publications.length > 0);
  assert.ok(harness.publications.every(publication => publication.intent === null));
  const restoredState = await state;
  assert.equal(restoredState.settings.enabled, false);
  assert.equal(restoredState.track, null);
});

test('a Chromium cold wake resumes reporting once saved sharing settings load', async () => {
  let resolveSettings;
  const storedSettings = new Promise(resolve => { resolveSettings = resolve; });
  const harness = await createBackgroundHarness({}, {
    getStoredSettings: () => storedSettings, waitForReady: false,
  });
  harness.report();
  harness.runTimer(250);
  assert.equal(harness.publications.length, 0);
  resolveSettings({ enabled: true });
  await harness.ready;
  assert.equal(harness.publications.at(-1)?.intent?.details, 'A song');
});

test('progress off publishes continuous app time across tracks, pauses, navigation, preferences, and worker wakes', async () => {
  let now = 1_000_000;
  const sessionData = {};
  const harness = await createBackgroundHarness({ music: { showTimestamps: false } }, { now: () => now, sessionData });
  const report = (title, playing = true, documentId = 'source-document') => {
    harness.callbacks.onReport({ tabId: 9, documentId, frameId: 0,
      track: { activityId: 'music', title, playing, position: 5, duration: 180 } });
    harness.runTimer(250);
    return harness.publications.at(-1).intent;
  };
  assert.deepEqual(report('First song').timestamps, { start: 1000 });
  now += 60_000;
  assert.deepEqual(report('Second song').timestamps, { start: 1000 });
  now += 60_000;
  assert.deepEqual(report('Second song', false).timestamps, { start: 1000 });
  now += 60_000;
  assert.deepEqual(report('Second song', false).timestamps, { start: 1000 });
  assert.deepEqual((await harness.sendMessage({ type: 'GET_STATE' })).finalPresenceIntent.timestamps, { start: 1000 });
  const enabled = await harness.sendMessage({ type: 'ACTIVITY_SET_PREFERENCES', id: 'music', preferences: { showTimestamps: true } });
  assert.equal(enabled.ok, true);
  assert.equal(harness.publications.at(-1).intent.timestamps, null);
  await harness.sendMessage({ type: 'ACTIVITY_SET_PREFERENCES', id: 'music', preferences: { showTimestamps: false } });
  assert.deepEqual(harness.publications.at(-1).intent.timestamps, { start: 1000 });
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  now += 60_000;
  assert.deepEqual(report('Third song', true, 'replacement-document').timestamps, { start: 1000 });
  harness.callbacks.onClear('music', 9, 'replacement-document', 0);
  harness.runTimer(250);
  now += 1000;
  assert.deepEqual(report('Fourth song', true, 'replacement-document').timestamps, { start: 1000 });
  const resumed = await createBackgroundHarness({ music: { showTimestamps: false } }, { now: () => now, sessionData });
  resumed.report('replacement-document');
  resumed.runTimer(250);
  assert.deepEqual(resumed.publications.at(-1).intent.timestamps, { start: 1000 });
  resumed.removeTab(9);
  assert.equal(resumed.publications.at(-1).intent, null);
  now += 60_000;
  resumed.report('new-session');
  resumed.runTimer(250);
  assert.deepEqual(resumed.publications.at(-1).intent.timestamps, { start: Math.floor(now / 1000) });
});

test('remote service enablement awaits the Activity inventory, clears immediately and keeps settings editable', async () => {
  const preferences = { music: { showPaused: true, showArtwork: true, showButtons: true } };
  const h = await createBackgroundHarness(preferences);
  h.report(); h.runTimer(250);
  assert.ok(h.publications.at(-1).intent);
  await h.applyLinkedSettings('music', { enabled: false, showArtwork: false });
  assert.equal(h.activityEnabled.get('music'), false);
  assert.equal(h.publications.at(-1).intent, null);
  assert.equal(preferences.music.showArtwork, false);
  await h.applyLinkedSettings('music', { showButtons: false });
  assert.equal(h.activityEnabled.get('music'), false);
  assert.equal(preferences.music.showButtons, false);
  assert.deepEqual(h.localEdits, []);
  await h.sendMessage({ type: 'ACTIVITY_SET_ENABLED', id: 'music', enabled: true });
  assert.equal(h.activityEnabled.get('music'), true);
  assert.equal(h.localEdits[0].patch.enabled, true);
});

test('renewal alarms cannot renew a persisted intent before a saved opt-out loads', async () => {
  let resolveSettings;
  const storedSettings = new Promise(resolve => { resolveSettings = resolve; });
  const harness = await createBackgroundHarness({}, {
    getStoredSettings: () => storedSettings, waitForReady: false,
  });
  harness.alarm('discord-presence-renew');
  assert.equal(harness.renewals(), 0);
  assert.equal(harness.publications.length, 0);
  resolveSettings({ enabled: false });
  await harness.ready;
  await Promise.resolve();
  assert.equal(harness.renewals(), 0);
  assert.equal(harness.publications.at(-1)?.intent, null);
});

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

test('foreground browsing suppresses immediately on tab/window exit and restores without another report', async () => {
  const harness = await createBackgroundHarness();
  const report = { tabId: 9, documentId: 'browsing', frameId: 0,
    track: { activityId: 'mixed', kind: 'generic', media: { title: 'Browsing' },
      playback: { state: 'playing' }, display: { details: 'Browsing' }, artwork: {}, visibility: 'normal', focusPolicy: 'foreground' } };
  harness.callbacks.onReport(report);
  harness.runTimer(250);
  assert.equal(harness.publications.at(-1).intent.details, 'Browsing');
  harness.activate(10);
  assert.equal(harness.publications.at(-1).intent, null);
  assert.equal([...harness.timers.values()].some(timer => timer.delay === 1500), false);
  harness.activate(9);
  assert.equal(harness.publications.at(-1).intent.details, 'Browsing');
  harness.focus(-1);
  assert.equal(harness.publications.at(-1).intent, null);
  harness.focus(1);
  assert.equal(harness.publications.at(-1).intent.details, 'Browsing');
  harness.callbacks.onClear('mixed', 9, 'browsing', 0, { closing: true });
  harness.activate(10);
  harness.activate(9);
  assert.equal(harness.publications.at(-1).intent, null, 'focus must not revive an explicitly cleared report');
});

test('media beats browsing by default; custom browsing priority still respects foreground eligibility', async () => {
  const harness = await createBackgroundHarness();
  harness.callbacks.onReport({ tabId: 9, documentId: 'player', frameId: 1,
    track: { activityId: 'mixed', title: 'Background playback', playing: true } });
  harness.callbacks.onReport({ tabId: 9, documentId: 'page', frameId: 0,
    track: { activityId: 'mixed', title: 'Browsing', playing: true, focusPolicy: 'foreground' } });
  harness.runTimer(250);
  assert.equal(harness.publications.at(-1).intent.details, 'Background playback');
  await harness.sendMessage({ type: 'ACTIVITY_SET_PRIORITY', rules: [
    { id: 'browse-first', activityId: '', state: 'browsing', scope: 'viewed' },
    ...activityPriority.DEFAULT_ACTIVITY_PRIORITY_RULES,
  ] });
  assert.equal(harness.publications.at(-1).intent.details, 'Browsing');
  harness.focus(-1);
  assert.equal(harness.publications.at(-1).intent.details, 'Background playback');
  harness.focus(1);
  assert.equal(harness.publications.at(-1).intent.details, 'Browsing');
  harness.removeTab(9);
  assert.equal(harness.publications.at(-1).intent, null);
  assert.equal(harness.publications.at(-1).options.closing, true);
  harness.activate(9);
  assert.equal(harness.publications.at(-1).intent, null);
});

test('switching the viewed tab selects its playing media immediately without another report', async () => {
  const harness = await createBackgroundHarness();
  for (const tabId of [9, 10]) harness.callbacks.onReport({ tabId, documentId: `document-${tabId}`, frameId: 0,
    track: { activityId: 'music', kind: 'song', title: `Song ${tabId}`, playing: true } });
  harness.runTimer(250);
  assert.equal(harness.publications.at(-1).intent.details, 'Song 9');
  harness.activate(10);
  assert.equal(harness.publications.at(-1).intent.details, 'Song 10');
  harness.focus(-1);
  assert.equal(harness.publications.at(-1).intent.details, 'Song 10');
});

test('popup playback diagnostics follow the winning tab while Activity history can come from another tab', async () => {
  const playing = { activityId: 'youtube', kind: 'video', media: { title: 'Playing' },
    playback: { state: 'playing' }, visibility: 'normal' };
  const paused = { ...playing, media: { title: 'Paused' }, playback: { state: 'paused' } };
  const activity = { id: 'youtube', normalizedReport: paused,
    lastReport: { tabId: 9, timestamp: '2026-01-01T00:00:01Z' },
    lastClear: { tabId: 9, timestamp: '2026-01-01T00:00:00Z' } };
  const harness = await createBackgroundHarness({}, { installed: [activity] });
  const report = (tabId, track) => harness.callbacks.onReport({ tabId, documentId: `document-${tabId}`, frameId: 0, track });
  const popupState = () => harness.sendMessage({ type: 'GET_STATE' }, 'chrome-extension://test/popup.html');

  report(10, playing);
  report(9, paused);
  let state = await popupState();
  assert.equal(state.track.media.title, 'Playing');
  assert.equal(state.activityDiagnostics.playbackState, 'playing');
  assert.equal(state.activityDiagnostics.lastReport.tabId, 9);
  assert.equal(state.activityDiagnostics.lastClear.tabId, 9);

  activity.normalizedReport = { ...paused, visibility: 'private' };
  report(9, activity.normalizedReport);
  state = await popupState();
  assert.equal(state.activityDiagnostics.visibility, 'normal');

  harness.removeTab(10);
  state = await popupState();
  assert.equal(state.track, null);
  assert.equal(state.activityDiagnostics.playbackState, 'paused');
  assert.equal(state.activityDiagnostics.visibility, 'private');
});

test('popup playback diagnostics use the legacy selected track state and ignore unrelated Activity history', async () => {
  const activity = { id: 'youtube', normalizedReport: { playback: { state: 'playing' }, visibility: 'normal' },
    lastReport: { tabId: 10, timestamp: '2026-01-01T00:00:00Z' } };
  const harness = await createBackgroundHarness({}, { installed: [activity] });
  const report = (tabId, track) => harness.callbacks.onReport({ tabId, documentId: `legacy-${tabId}`, frameId: 0, track });
  const popupState = () => harness.sendMessage({ type: 'GET_STATE' }, 'chrome-extension://test/popup.html');

  report(9, { activityId: 'youtube', title: 'Legacy paused video', playing: false });
  let state = await popupState();
  assert.equal(state.activityDiagnostics.playbackState, 'paused');
  assert.equal(state.activityDiagnostics.visibility, null);

  report(11, { title: 'Legacy playing video', playing: true });
  state = await popupState();
  assert.equal(state.activityDiagnostics.playbackState, 'playing');
  assert.equal(state.activityDiagnostics.activityId, null);
  assert.equal(state.activityDiagnostics.lastReport, null);
});

test('saved rules load before selection and invalid or unprivileged updates cannot change priority', async () => {
  const rules = [{ id: 'paused-first', activityId: '', state: 'paused', scope: 'any' }];
  const harness = await createBackgroundHarness({}, { getStoredSettings: async () => ({ activityPriorityRules: rules }) });
  harness.callbacks.onReport({ tabId: 9, documentId: 'playing', frameId: 0,
    track: { activityId: 'playing', title: 'Playing', playing: true } });
  harness.callbacks.onReport({ tabId: 10, documentId: 'paused', frameId: 0,
    track: { activityId: 'paused', title: 'Paused', playing: false } });
  harness.runTimer(250);
  assert.equal(harness.publications.at(-1).intent.details, 'Paused');
  const invalid = await harness.sendMessage({ type: 'ACTIVITY_SET_PRIORITY', rules: [{ state: 'broken' }] });
  assert.equal(invalid.ok, false);
  const unprivileged = await harness.sendMessage({ type: 'ACTIVITY_SET_PRIORITY', rules: [] }, 'https://example.com/');
  assert.equal(unprivileged.ok, false);
  const state = await harness.sendMessage({ type: 'ACTIVITY_LIBRARY_STATE' });
  assert.deepEqual(JSON.parse(JSON.stringify(state.result.priorityRules)), rules);
  assert.equal(state.result.selectionDiagnostics.source.tabId, 10);
});

test('same-Activity navigation holds the report and replaces it without publishing an empty presence', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.runTimer(250);
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  assert.equal(harness.publications.length, 1);
  assert.equal([...harness.timers.values()].filter(timer => timer.delay === 4000).length, 1);
  harness.report('replacement-document');
  harness.runTimer(250);
  assert.equal(harness.publications.length, 2);
  assert.ok(harness.publications.every(item => item.intent?.details === 'A song'));
  assert.equal([...harness.timers.values()].some(timer => timer.delay === 4000), false);
});

test('closing the tab during navigation grace clears immediately and cancels the deadline', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  harness.removeTab(9);
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent, null);
  assert.equal(harness.publications[0].options.closing, true);
  assert.equal([...harness.timers.values()].some(timer => timer.delay === 4000), false);
});

test('navigation grace expires once without adding the ordinary clear delay', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  assert.equal([...harness.timers.values()].filter(timer => timer.delay === 4000).length, 1);
  harness.runTimer(4000);
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent, null);
  assert.equal(harness.publications[0].options.closing, true);
  assert.equal([...harness.timers.values()].some(timer => timer.delay === 1500), false);
});

test('a stale navigation deadline or late exit cannot erase the replacement document', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  const deadline = [...harness.timers.values()].find(timer => timer.delay === 4000).callback;
  harness.report('replacement-document');
  deadline();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  harness.runTimer(250);
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent.details, 'A song');
});

test('a direct closing clear overrides navigation grace immediately', async () => {
  const harness = await createBackgroundHarness();
  harness.report();
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true, navigationGraceMs: 4000 });
  harness.callbacks.onClear('music', 9, 'source-document', 0, { closing: true });
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.publications[0].intent, null);
  assert.equal([...harness.timers.values()].some(timer => timer.delay === 4000), false);
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
