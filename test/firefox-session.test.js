import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityRegistry } from '../extension/core/activity-registry.js';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { restoreActivitySession, saveActivitySession } from '../ChudPresence-Firefox/extension/platform/activity-session.js';
import * as chromiumSession from '../extension/platform/activity-session.js';

const KEY = 'firefoxActivitySession';
const capability = 'a'.repeat(64);
const record = () => ({ enabled: true, capability, metadata: {
  id: 'youtube', name: 'YouTube', version: '1.0.0', apiVersion: 1,
  matches: ['https://www.youtube.com/*'], category: 'video',
} });
const report = () => ({ ...normalizeActivityReport({ kind: 'video', media: { title: 'A video' },
  playback: { state: 'playing', position: 5, duration: 90 } }, 1),
source: 'activity', activityId: 'youtube', activityName: 'YouTube', activityCategory: 'video', activityVersion: '1.0.0' });

function harness({ data = {}, records = { youtube: record() }, write } = {}) {
  const registry = new ActivityRegistry();
  let activeTab = 9;
  const writes = [];
  const api = { storage: { session: {
    async get() { return structuredClone(data); },
    async set(values) { writes.push(structuredClone(values)); if (write) await write(values); Object.assign(data, structuredClone(values)); },
  }, local: { async get() { return { installedActivities: records }; }, async set() {} } } };
  const manager = { api, records, lastSeen: new Map(), removedTabs: new Set(),
    sessionContext: { registry, getActiveTab: () => activeTab, setActiveTab: value => { activeTab = value; } } };
  return { manager, registry, data, writes, selected: () => activeTab, api };
}

function remember(fixture, { tabId = 9, frameId = 0, documentId = 'document-9', lastSeen = 1_700_000_000_000 } = {}) {
  const track = report();
  if (!fixture.manager.lastSeen.has('youtube')) fixture.manager.lastSeen.set('youtube', new Map());
  const tabs = fixture.manager.lastSeen.get('youtube');
  if (!tabs.has(tabId)) tabs.set(tabId, new Map());
  tabs.get(tabId).set(frameId, { tabId, frameId, documentId, parentFrameId: null,
    senderUrl: 'https://www.youtube.com/watch?v=example', lastSeen, active: true, track,
    retiredDocumentIds: new Set(['old-document']) });
  fixture.registry.update(tabId, documentId, track, frameId);
}

test('Firefox restores report selection and document ownership once without refreshing stale timestamps', async () => {
  const original = harness();
  remember(original);
  remember(original, { tabId: 10, frameId: 2, documentId: 'document-10', lastSeen: 1_700_000_000_100 });
  await saveActivitySession(original.manager);
  const resumed = harness({ data: original.data });
  const first = restoreActivitySession(resumed.manager);
  assert.equal(restoreActivitySession(resumed.manager), first);
  assert.equal(await first, true);
  assert.equal(resumed.selected(), 9);
  assert.equal(resumed.registry.sequence, 2);
  assert.equal(resumed.registry.tracks().size, 2);
  const context = resumed.manager.lastSeen.get('youtube').get(9).get(0);
  assert.equal(context.lastSeen, 1_700_000_000_000);
  assert.deepEqual([...context.retiredDocumentIds], ['old-document']);
  resumed.registry.clearTab(9);
  await restoreActivitySession(resumed.manager);
  assert.equal(resumed.registry.has(9), false, 'later loads must not revive a cleared owner');
});

test('Firefox rejects stale Activity versions/capabilities and disabled or removed owners', async () => {
  const original = harness();
  remember(original);
  await saveActivitySession(original.manager);
  for (const change of [
    value => { value.youtube.capability = 'b'.repeat(64); },
    value => { value.youtube.metadata.version = '2.0.0'; },
    value => { value.youtube.enabled = false; },
    value => { delete value.youtube; },
  ]) {
    const records = { youtube: record() };
    change(records);
    const resumed = harness({ data: original.data, records });
    await restoreActivitySession(resumed.manager);
    assert.equal(resumed.registry.entries.size, 0);
    assert.equal(resumed.manager.lastSeen.size, 0);
    assert.equal(resumed.selected(), null);
  }
});

test('restoring a future timestamp after clock rollback cannot suppress stale pruning indefinitely', async () => {
  const original = harness();
  remember(original, { lastSeen: Date.now() + 86_400_000 });
  await saveActivitySession(original.manager);
  const resumed = harness({ data: original.data });
  const before = Date.now();
  await restoreActivitySession(resumed.manager);
  const lastSeen = resumed.manager.lastSeen.get('youtube').get(9).get(0).lastSeen;
  assert.ok(lastSeen >= before && lastSeen <= Date.now());
});

test('the first document-close request after restoration clears the original owner', async () => {
  const original = harness();
  remember(original);
  await saveActivitySession(original.manager);
  const resumed = harness({ data: original.data });
  const clears = [];
  const manager = new ActivityManager({ api: resumed.api, v2Host: { stopContext() {} },
    onClear(id, tabId, documentId, frameId, options) {
      clears.push({ id, tabId, documentId, frameId, options });
      resumed.registry.clearActivity(id, tabId, documentId, frameId);
    } });
  manager.records = resumed.manager.records;
  manager.sessionContext = resumed.manager.sessionContext;
  await restoreActivitySession(manager);
  const result = await manager.handleUserScriptMessage({ type: 'CHUDPRESENCE_ACTIVITY_REQUEST',
    activityId: 'youtube', activityVersion: '1.0.0', apiVersion: 1, capability,
    requestId: 'cold-close', operation: 'presence.clear', payload: { closing: true } },
  { tab: { id: 9 }, frameId: 0, documentId: 'document-9', url: 'https://www.youtube.com/watch?v=example' });
  assert.equal(result.ok, true);
  assert.equal(result.data.cleared, true);
  assert.equal(clears.length, 1);
  assert.equal(clears[0].options.closing, true);
  assert.equal(resumed.registry.has(9), false);
});

test('closed-tab tombstones survive suspension and reject queued scoped-service requests', async () => {
  const original = harness();
  remember(original);
  original.manager.removedTabs.add(9);
  await saveActivitySession(original.manager);
  assert.equal(original.data[KEY].activities.length, 0);
  const resumed = harness({ data: original.data });
  const manager = new ActivityManager({ api: resumed.api, v2Host: {} });
  manager.records = resumed.manager.records;
  manager.sessionContext = resumed.manager.sessionContext;
  await restoreActivitySession(manager);
  assert.equal(manager.removedTabs.has(9), true);
  const result = await manager.handleUserScriptMessage({ type: 'CHUDPRESENCE_ACTIVITY_REQUEST',
    activityId: 'youtube', activityVersion: '1.0.0', apiVersion: 1, capability,
    requestId: 'late-service', operation: 'storage.get', payload: { key: 'late' } },
  { tab: { id: 9 }, frameId: 0, documentId: 'document-9', url: 'https://www.youtube.com/watch?v=example' });
  assert.equal(result, false);
  assert.equal(resumed.registry.entries.size, 0);
});

test('saving captures immediately and orders writes so a late old report cannot undo removal', async () => {
  let unblock;
  const pending = new Promise(resolve => { unblock = resolve; });
  let attempts = 0;
  const fixture = harness({ write: async () => { if (++attempts === 1) await pending; } });
  remember(fixture);
  const first = saveActivitySession(fixture.manager);
  fixture.manager.lastSeen.clear();
  fixture.registry.clearTab(9);
  const second = saveActivitySession(fixture.manager);
  await Promise.resolve();
  assert.equal(fixture.writes.length, 0);
  unblock();
  await Promise.all([first, second]);
  assert.equal(fixture.writes[0][KEY].registry.length, 1);
  assert.equal(fixture.writes[1][KEY].registry.length, 0);
  assert.equal(fixture.data[KEY].activities.length, 0);
});

test('snapshots omit credentials, source packages, and arbitrary track fields and enforce bounds', async () => {
  const fixture = harness();
  remember(fixture);
  fixture.manager.discordAuth = { accessToken: 'private-auth' };
  fixture.manager.records.youtube.code = 'private-source';
  const context = fixture.manager.lastSeen.get('youtube').get(9).get(0);
  context.track.discordAuth = 'private-auth';
  context.senderUrl = 'https://private-user:private-password@www.youtube.com/watch?token=private-query#private-fragment';
  await saveActivitySession(fixture.manager);
  assert.doesNotMatch(JSON.stringify(fixture.data), /private-auth|private-source|discordAuth|private-user|private-password|private-query|private-fragment/);
  assert.equal(fixture.data[KEY].activities[0].contexts[0].senderUrl, 'https://www.youtube.com/watch');
  const malformed = structuredClone(fixture.data);
  malformed[KEY].activities[0].contexts = Array(2049).fill(malformed[KEY].activities[0].contexts[0]);
  const resumed = harness({ data: malformed });
  assert.equal(await restoreActivitySession(resumed.manager), false);
  assert.equal(resumed.manager.lastSeen.size, 0);
  assert.equal(resumed.registry.entries.size, 0);
  const frames = fixture.manager.lastSeen.get('youtube').get(9);
  for (let frameId = 1; frameId <= 2048; frameId++) frames.set(frameId, { ...frames.get(0), frameId });
  const overflow = saveActivitySession(fixture.manager);
  assert.ok(overflow instanceof Promise);
  await assert.rejects(overflow, /context limit/);
});

test('Chromium session adapters preserve the existing worker behavior', async () => {
  const manager = new Proxy({}, { get() { assert.fail('Chromium must not checkpoint Firefox state'); } });
  await chromiumSession.restoreActivitySession(manager);
  await chromiumSession.saveActivitySession(manager);
});
