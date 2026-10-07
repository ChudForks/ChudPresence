import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DiscordRateLimitError } from '../extension/discord/auth.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';

const SESSION_KEY = 'discordHeadlessSession';
const INTENT_KEY = 'discordLastIntent';
const UPDATE_PATH = '/users/@me/headless-sessions';
const DELETE_PATH = `${UPDATE_PATH}/delete`;
const APPLICATION_ID = '123456789012345678';
const intent = { name: 'YouTube', type: 'watching', details: 'A video' };
const source = (await readFile(new URL('../extension/discord/presence.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
  .replace(/^export const /gm, 'const ');

function createHarness({ authenticated = true, storage, request = async () => null, beforeRemove = async () => {}, cleanup = { armed: true, deferred: true, reason: '' } } = {}) {
  const local = storage?.local || { [SESSION_KEY]: 'existing-session' };
  const session = storage?.session || {};
  const calls = [];
  const events = [];
  let revocations = 0;
  let disarms = 0;
  let cleanupObserver;
  let now = 1_000_000;
  let timerId = 0;
  const timers = new Map();
  class DateAt extends Date { static now() { return now; } }
  async function elapse(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    }
    now = target;
  }
  function storageArea(data) {
    return {
      async get(keys) {
        return Object.fromEntries([].concat(keys).map((key) => [key, structuredClone(data[key])]));
      },
      async set(values) {
        Object.assign(data, structuredClone(values));
      },
      async remove(keys) {
        await beforeRemove(keys);
        for (const key of [].concat(keys)) {
          events.push(`remove:${key}`);
          delete data[key];
        }
      },
    };
  }
  const context = vm.createContext({
    chrome: {
      storage: { local: storageArea(local), session: storageArea(session) },
      alarms: { async create() {} },
    },
    DiscordRateLimitError,
    Date: DateAt,
    buildHeadlessActivity,
    getAuthState: () => ({ configured: true, authenticated, user: { username: 'tester' } }),
    getClientId: () => APPLICATION_ID,
    getAccessToken: async () => 'access-token',
    initializeAuth: async () => {},
    revokeAuthorization: async () => { revocations += 1; authenticated = false; },
    armShutdownCleanup: async () => { events.push('arm'); return cleanup; },
    disarmShutdownCleanup: async () => { disarms += 1; events.push('disarm'); },
    onShutdownCleanup: (observer) => { cleanupObserver = observer; },
    discordRequest: async (path, options) => {
      const call = { path, ...options, body: JSON.parse(options.body) };
      calls.push(call);
      return request(call);
    },
    // Keep rate-limit retries deterministic and avoid real timers in tests.
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`${source}\nglobalThis.presence = discordPresence;`, context);
  return {
    presence: context.presence,
    storage: { local, session },
    calls,
    events,
    elapse,
    cleanupEvent: (event) => cleanupObserver(event),
    get revocations() { return revocations; },
    get disarms() { return disarms; },
  };
}

test('keeps the token and shutdown cleanup until deletion is confirmed', async () => {
  let finishDeletion;
  let started;
  const deletionStarted = new Promise((resolve) => { started = resolve; });
  const harness = createHarness({
    request(call) {
      assert.equal(call.path, DELETE_PATH);
      started();
      return new Promise((resolve) => { finishDeletion = resolve; });
    },
  });
  const clearing = harness.presence.publish(null, '', { closing: true });
  await deletionStarted;
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
  assert.equal(harness.calls[0].body.token, 'existing-session');
  assert.equal(harness.calls[0].keepalive, true);

  harness.events.push('deletion-confirmed');
  finishDeletion(null);
  assert.equal((await clearing).state, 'connected');
  assert.equal(harness.storage.local[SESSION_KEY], undefined);
  assert.equal(harness.disarms, 1);
  assert.ok(harness.events.indexOf('deletion-confirmed') < harness.events.indexOf(`remove:${SESSION_KEY}`));
  assert.ok(harness.events.indexOf(`remove:${SESSION_KEY}`) < harness.events.indexOf('disarm'));
});

test('publishes the latest timing correction at the minimum interval without another report', async () => {
  const harness = createHarness();
  await harness.presence.publish({ ...intent, timestamps: { start: 825, end: 1000 } }, APPLICATION_ID);
  await harness.elapse(500);
  await harness.presence.publish({ ...intent, timestamps: { start: 1000, end: 1535 } }, APPLICATION_ID);
  assert.equal(harness.calls.length, 1);
  await harness.elapse(500);
  const latest = { ...intent, timestamps: { start: 1001, end: 1536 } };
  await harness.presence.publish(latest, APPLICATION_ID);
  await harness.elapse(3199);
  assert.equal(harness.calls.length, 1);
  await harness.elapse(1);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1].body.activities[0].timestamps, { start: 1_001_000, end: 1_536_000 });
  assert.deepEqual(harness.storage.session[INTENT_KEY].intent, latest);
});

test('keeps routine clock jitter on the ordinary update interval', async () => {
  const harness = createHarness();
  await harness.presence.publish({ ...intent, timestamps: { start: 1000, end: 1535 } }, APPLICATION_ID);
  await harness.elapse(1000);
  await harness.presence.publish({ ...intent, timestamps: { start: 1001, end: 1536 } }, APPLICATION_ID);
  await harness.elapse(10_999);
  assert.equal(harness.calls.length, 1);
  await harness.elapse(1);
  assert.equal(harness.calls.length, 2);
});

test('cancels a pending timing correction when presence clears', async () => {
  const harness = createHarness();
  await harness.presence.publish({ ...intent, timestamps: { start: 825, end: 1000 } }, APPLICATION_ID);
  await harness.elapse(1000);
  await harness.presence.publish({ ...intent, timestamps: { start: 1000, end: 1535 } }, APPLICATION_ID);
  await harness.presence.publish(null, '', { closing: true });
  await harness.elapse(12_000);
  assert.deepEqual(harness.calls.map((call) => call.path), [UPDATE_PATH, DELETE_PATH]);
});

test('keeps the latest queued correction behind Discord retry-after', async () => {
  let updates = 0;
  const harness = createHarness({
    request() {
      updates += 1;
      if (updates === 2) throw new DiscordRateLimitError(10_000);
      return null;
    },
  });
  await harness.presence.publish({ ...intent, timestamps: { start: 825, end: 1000 } }, APPLICATION_ID);
  await harness.elapse(1000);
  await harness.presence.publish({ ...intent, timestamps: { start: 1000, end: 1535 } }, APPLICATION_ID);
  await harness.elapse(3200);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.presence.status().state, 'rate-limited');
  await harness.elapse(500);
  const latest = { ...intent, timestamps: { start: 1001, end: 1536 } };
  await harness.presence.publish(latest, APPLICATION_ID);
  await harness.elapse(9499);
  assert.equal(harness.calls.length, 2);
  await harness.elapse(1);
  assert.equal(harness.calls.length, 3);
  assert.deepEqual(harness.calls[2].body.activities[0].timestamps, { start: 1_001_000, end: 1_536_000 });
  assert.equal(harness.presence.status().state, 'active');
});

test('exposes an unsupported deferred cleanup path without discarding the exit fallback', async () => {
  const harness = createHarness({ cleanup: { armed: true, deferred: false, reason: 'unsupported' } });
  await harness.presence.initialize();
  assert.deepEqual({ ...harness.presence.status().shutdownCleanup }, { state: 'exit-fallback', reason: 'unsupported' });
});

test('persists redacted cleanup outcomes across worker restart', async () => {
  const harness = createHarness({ request() { throw Object.assign(new Error('secret-token-must-not-appear'), { status: 403 }); } });
  await harness.presence.publish(null);
  const outcome = harness.storage.local.discordCleanupDiagnostic;
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.httpStatus, 403);
  assert.equal(outcome.source, 'worker');
  assert.equal(JSON.stringify(outcome).includes('secret-token'), false);
  const restarted = createHarness({ storage: harness.storage });
  await restarted.presence.initialize();
  assert.deepEqual({ ...restarted.presence.status().lastCleanupAttempt }, outcome);
});

test('records document-exit outcomes delivered on the private cleanup port', async () => {
  const harness = createHarness();
  await harness.presence.initialize();
  harness.cleanupEvent({ state: 'confirmed', httpStatus: 204 });
  assert.equal(harness.presence.status().lastCleanupAttempt.source, 'document');
  assert.equal(harness.storage.local.discordCleanupDiagnostic.state, 'confirmed');
  assert.equal(harness.storage.local.discordCleanupDiagnostic.httpStatus, 204);
});

test('starts browser-close deletion without waiting for intent storage', async () => {
  let releaseStorage;
  const storageBlocked = new Promise((resolve) => { releaseStorage = resolve; });
  let markStarted;
  const deletionStarted = new Promise((resolve) => { markStarted = resolve; });
  const harness = createHarness({
    beforeRemove: () => storageBlocked,
    request(call) {
      assert.equal(call.path, DELETE_PATH);
      assert.equal(call.keepalive, true);
      markStarted();
      return null;
    },
  });
  const clearing = harness.presence.publish(null, '', { closing: true });
  await deletionStarted;
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
  releaseStorage();
  assert.equal((await clearing).state, 'connected');
  assert.equal(harness.storage.local[SESSION_KEY], undefined);
});

for (const [label, error] of [
  ['network failure', new TypeError('Failed to fetch')],
  ['server error', new Error('Discord API failed (500).')],
  ['authorization failure', new Error('Discord API failed (401).')],
  ['rate limit', new DiscordRateLimitError(5_000)],
]) {
  test(`preserves a failed deletion after a ${label} and retries on renewal`, async () => {
    let fail = true;
    const harness = createHarness({
      storage: {
        local: { [SESSION_KEY]: 'existing-session' },
        session: { [INTENT_KEY]: { intent, applicationId: APPLICATION_ID } },
      },
      request() { if (fail) throw error; return null; },
    });
    assert.equal((await harness.presence.publish(null)).state, 'error');
    assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
    assert.equal(harness.storage.session[INTENT_KEY], undefined);
    assert.equal(harness.disarms, 0);

    fail = false;
    assert.equal((await harness.presence.renew()).state, 'connected');
    assert.deepEqual(harness.calls.map((call) => call.path), [DELETE_PATH, DELETE_PATH]);
    assert.equal(harness.calls[1].body.token, 'existing-session');
    assert.equal(harness.storage.local[SESSION_KEY], undefined);
  });
}

test('retries persisted cleanup after the service worker restarts', async () => {
  const first = createHarness({ request() { throw new Error('Offline'); } });
  await first.presence.publish(null);
  const restarted = createHarness({ storage: first.storage });
  await restarted.presence.renew();
  assert.equal(restarted.calls[0].path, DELETE_PATH);
  assert.equal(restarted.calls[0].body.token, 'existing-session');
  assert.equal(restarted.storage.local[SESSION_KEY], undefined);
});

test('retains a token when cleanup has no authentication', async () => {
  const harness = createHarness({ authenticated: false });
  const result = await harness.presence.publish(null);
  assert.equal(result.state, 'error');
  assert.match(result.message, /Connect Discord/);
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.disarms, 0);
});

test('does not revoke credentials when disconnect cannot confirm deletion', async () => {
  let fail = true;
  const harness = createHarness({ request() { if (fail) throw new Error('Offline'); return null; } });
  await assert.rejects(harness.presence.disconnect(), /Offline/);
  assert.equal(harness.revocations, 0);
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
  fail = false;
  assert.equal((await harness.presence.disconnect()).state, 'disconnected');
  assert.equal(harness.revocations, 1);
  assert.equal(harness.storage.local[SESSION_KEY], undefined);
});

test('does not create a replacement when update and deletion both fail', async () => {
  const harness = createHarness({ request() { throw new Error('Offline'); } });
  assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'error');
  assert.deepEqual(harness.calls.map((call) => call.path), [UPDATE_PATH, DELETE_PATH]);
  assert.equal(harness.calls[0].body.token, 'existing-session');
  assert.equal(harness.calls[1].body.token, 'existing-session');
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
});

test('creates a replacement only after confirmed deletion of the existing session', async () => {
  const harness = createHarness({
    request(call) {
      if (call.path === DELETE_PATH) {
        assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
        harness.events.push('deletion-confirmed');
        return null;
      }
      if (call.body.token) throw new Error('Update failed');
      assert.equal(harness.storage.local[SESSION_KEY], undefined);
      assert.equal(harness.disarms, 1);
      return { token: 'replacement-session' };
    },
  });
  assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'active');
  assert.deepEqual(harness.calls.map((call) => call.path), [UPDATE_PATH, DELETE_PATH, UPDATE_PATH]);
  assert.equal(harness.calls[2].body.token, undefined);
  assert.equal(harness.storage.local[SESSION_KEY], 'replacement-session');
  assert.ok(harness.events.indexOf('deletion-confirmed') < harness.events.indexOf(`remove:${SESSION_KEY}`));
  assert.equal(harness.events.at(-1), 'arm');
});

test('keeps the current session after an update rate limit without deleting or replacing it', async () => {
  const harness = createHarness({ request() { throw new DiscordRateLimitError(5_000); } });
  assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'rate-limited');
  assert.deepEqual(harness.calls.map((call) => call.path), [UPDATE_PATH]);
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
});
