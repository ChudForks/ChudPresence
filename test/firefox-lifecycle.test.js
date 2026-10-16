import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityV2HostClient } from '../extension/core/activity-v2-host-client.js';

const source = (await readFile(new URL('../ChudPresence-Firefox/extension/discord/shutdown-cleanup.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');

function cleanupHarness({ available = true } = {}) {
  const frames = [];
  const lifecycle = new Map();
  let removed = 0;
  const body = { append(frame) { frame.isConnected = true; frames.push(frame); } };
  const document = {
    ...(available ? { body } : {}),
    createElement(tag) {
      assert.equal(tag, 'iframe');
      return { isConnected: false, remove() { this.isConnected = false; removed += 1; } };
    },
  };
  const forbidden = () => assert.fail('Firefox event-page cleanup must not fetch or persist Discord credentials');
  const context = vm.createContext({
    document,
    chrome: { runtime: {
      getURL: path => `moz-extension://test-extension/${path}`,
      onSuspend: { addListener(listener) { lifecycle.set('suspend', listener); } },
    },
    storage: { local: { get: forbidden, set: forbidden, remove: forbidden } },
    offscreen: new Proxy({}, { get() { assert.fail('Firefox has no offscreen document API'); } }) },
    fetch: forbidden, fetchLater: forbidden,
    addEventListener(name, listener) { lifecycle.set(name, listener); },
  });
  vm.runInContext(`${source}\nglobalThis.cleanup = { ensureCleanupDocument, acquireActivitySandboxDocument,
    releaseActivitySandboxDocument, armShutdownCleanup, disarmShutdownCleanup, onShutdownCleanup };`, context);
  return { cleanup: context.cleanup, frames, lifecycle, document, restoreBackground() { document.body = body; }, removed: () => removed };
}

test('Firefox background suspension never arms credential-bearing document-exit deletion', async () => {
  const harness = cleanupHarness();
  let observed = false;
  harness.cleanup.onShutdownCleanup(() => { observed = true; });
  const armed = await harness.cleanup.armShutdownCleanup('private-access', 'private-session');
  assert.deepEqual({ ...armed }, { armed: false, deferred: false, reason: 'unsupported' });
  assert.equal(harness.frames.length, 0);
  for (const event of ['suspend', 'pagehide', 'beforeunload', 'unload']) {
    harness.lifecycle.get(event)?.();
  }
  await harness.cleanup.disarmShutdownCleanup();
  assert.equal(observed, false);
  assert.equal(harness.lifecycle.size, 0);
});

test('Firefox V2 Activities share one trusted host frame without accessing offscreen APIs or Discord credentials', async () => {
  const harness = cleanupHarness();
  await Promise.all([
    harness.cleanup.acquireActivitySandboxDocument('first-worker'),
    harness.cleanup.acquireActivitySandboxDocument('second-worker'),
    harness.cleanup.acquireActivitySandboxDocument('first-worker'),
  ]);
  assert.equal(harness.frames.length, 1);
  assert.equal(harness.frames[0].hidden, true);
  assert.equal(harness.frames[0].src, 'moz-extension://test-extension/discord-cleanup.html');
  assert.equal(await harness.cleanup.releaseActivitySandboxDocument('first-worker'), true);
  assert.equal(await harness.cleanup.releaseActivitySandboxDocument('first-worker'), false);
  await harness.cleanup.disarmShutdownCleanup();
  assert.equal(harness.frames[0].isConnected, true);
  assert.equal(await harness.cleanup.releaseActivitySandboxDocument('second-worker'), true);
  assert.equal(harness.removed(), 0);
  assert.equal(harness.lifecycle.size, 0);
});

test('Firefox failed host acquisition releases its lease and permits retry when the background document is available', async () => {
  const harness = cleanupHarness({ available: false });
  for (const key of ['', null, 'x'.repeat(257)]) {
    await assert.rejects(harness.cleanup.acquireActivitySandboxDocument(key), /lease/);
  }
  assert.equal(harness.frames.length, 0);
  await assert.rejects(harness.cleanup.acquireActivitySandboxDocument('worker'), /background page is unavailable/);
  assert.equal(await harness.cleanup.releaseActivitySandboxDocument('worker'), false);
  harness.restoreBackground();
  await harness.cleanup.acquireActivitySandboxDocument('worker');
  assert.equal(harness.frames.length, 1);
  harness.frames[0].isConnected = false;
  await harness.cleanup.acquireActivitySandboxDocument('new-worker');
  assert.equal(harness.frames.length, 2);
  assert.equal(harness.frames[1].isConnected, true);
});

for (const suspending of [true, false]) {
  test(`Firefox V2 host disconnect ${suspending ? 'preserves presence while the event page suspends' : 'reports an actual sandbox host failure'}`, async () => {
    const leases = new Set();
    const failures = [];
    const url = 'moz-extension://test-extension/discord-cleanup.html';
    let disconnect;
    const port = { name: 'chudpresence-v2-host', sender: { url }, postMessage() {},
      onMessage: { addListener() {} },
      onDisconnect: { addListener(listener) { disconnect = listener; } },
    };
    const client = new ActivityV2HostClient({
      api: { runtime: { getURL: () => url, onConnect: { addListener() {} } } },
      isSuspending: () => suspending,
      async acquireDocument(key) { leases.add(key); },
      async releaseDocument(key) { leases.delete(key); },
      onFailure(session, message) { failures.push({ session, message }); },
    });
    assert.equal(client.connect(port), true);
    await client.update({
      identity: { activityId: 'sample-v2', activityVersion: '1.0.0', capability: 'a'.repeat(64), apiVersion: 2 },
      sender: { tab: { id: 7 }, frameId: 0, documentId: 'document-7', url: 'https://example.com/' },
      source: 'ChudPresence.onUpdate(() => {});', snapshot: { page: {}, reads: {}, media: [] },
    });
    assert.equal(client.sessions.size, 1);
    disconnect();
    assert.equal(client.sessions.size, 0);
    assert.equal(leases.size, 0);
    assert.equal(failures.length, suspending ? 0 : 1);
    if (!suspending) assert.match(failures[0].message, /host disconnected/);
  });
}
