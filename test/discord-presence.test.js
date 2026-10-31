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

function createHarness({ authenticated = true, storage, request = async () => null, beforeGet = async () => {}, beforeRemove = async () => {}, beforeRevoke = async () => {}, cleanup = { armed: true, deferred: true, reason: '' } } = {}) {
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
        const result = Object.fromEntries([].concat(keys).map((key) => [key, structuredClone(data[key])]));
        await beforeGet(keys);
        return result;
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
    authorize: async () => { authenticated = true; },
    revokeAuthorization: async () => { revocations += 1; await beforeRevoke(); authenticated = false; },
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
    advanceClock: (ms) => { now += ms; },
    cleanupEvent: (event) => cleanupObserver(event),
    get revocations() { return revocations; },
    get disarms() { return disarms; },
  };
}

test('local RPC handoff throws on cleanup failure and cancels deferred headless retries', async () => {
  let fail = true;
  const harness = createHarness({ request: call => {
    if (fail && call.path === DELETE_PATH) throw new Error('deletion failed');
    return { token: 'existing-session' };
  } });
  await assert.rejects(harness.presence.suspend(), /deletion failed/);
  assert.equal(harness.storage.local[SESSION_KEY], 'existing-session');
  assert.equal(harness.disarms, 0);
  fail = false;
  await harness.presence.suspend();
  assert.equal(harness.storage.local[SESSION_KEY], undefined);
  await harness.elapse(60_000);
  assert.equal(harness.calls.some(call => call.path === UPDATE_PATH), false);
});

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

test('concurrent startup cannot restore a stale token over the first published session', async () => {
  let releaseFirstRead;
  const firstReadBlocked = new Promise((resolve) => { releaseFirstRead = resolve; });
  let releaseSecondRead;
  const secondReadBlocked = new Promise((resolve) => { releaseSecondRead = resolve; });
  let markFirstRead;
  const firstRead = new Promise((resolve) => { markFirstRead = resolve; });
  let reads = 0;
  const harness = createHarness({
    storage: { local: {}, session: {} },
    beforeGet(keys) {
      if (![].concat(keys).includes(SESSION_KEY)) return;
      reads += 1;
      if (reads === 1) { markFirstRead(); return firstReadBlocked; }
      return secondReadBlocked;
    },
    request: async () => ({ token: 'created-session' }),
  });

  const first = harness.presence.publish(intent, APPLICATION_ID);
  await firstRead;
  const second = harness.presence.publish({ ...intent, details: 'Next video' }, APPLICATION_ID);
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  releaseFirstRead();
  assert.equal((await first).state, 'active');
  releaseSecondRead();
  await second;
  await harness.elapse(4200);

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].body.token, 'created-session');
  assert.equal(reads, 1);
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

async function blockedRenewalWithPendingUpdate(kind) {
  let finishRenewal;
  let markRenewing;
  const renewing = new Promise((resolve) => { markRenewing = resolve; });
  let updates = 0;
  const pending = { ...intent, details: 'Pending video' };
  const harness = createHarness({ request(call) {
    if (call.path === DELETE_PATH) return null;
    updates += 1;
    if (kind === 'rate retry' && updates === 2) throw new DiscordRateLimitError(5000);
    if (updates === (kind === 'rate retry' ? 3 : 2)) {
      markRenewing();
      return new Promise((resolve) => { finishRenewal = resolve; });
    }
    return { token: 'existing-session' };
  } });
  await harness.presence.publish(intent, APPLICATION_ID);
  if (kind === 'rate retry') {
    await harness.elapse(4200);
    await harness.presence.publish(pending, APPLICATION_ID);
    // An alarm can run after the cooldown expires before the timer task runs.
    harness.advanceClock(5000);
  } else {
    await harness.elapse(1000);
    await harness.presence.publish(pending, APPLICATION_ID);
    harness.advanceClock(3000);
  }
  const renewal = harness.presence.renew();
  await renewing;
  if (kind !== 'rate retry') harness.advanceClock(200);
  return { harness, pending, renewal, finishRenewal: () => finishRenewal({ token: 'existing-session' }) };
}

async function settleWrites() {
  for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
}

for (const kind of ['update timer', 'rate retry']) {
  for (const action of ['clear', 'disconnect']) {
    test(`${action} cancels the ${kind} while a renewal holds the write queue`, async () => {
      const { harness, renewal, finishRenewal } = await blockedRenewalWithPendingUpdate(kind);
      const clearing = action === 'disconnect'
        ? harness.presence.disconnect()
        : harness.presence.publish(null, '', { closing: true });
      await settleWrites();
      await harness.elapse(0);
      finishRenewal();
      await Promise.all([renewal, clearing]);
      await settleWrites();
      const completedCalls = harness.calls.length;
      await harness.elapse(60_000);
      assert.equal(harness.calls.length, completedCalls);
      assert.equal(harness.calls.at(-1).path, DELETE_PATH);
      assert.equal(harness.storage.local[SESSION_KEY], undefined);
      assert.equal(harness.storage.session[INTENT_KEY], undefined);
      assert.equal(harness.presence.status().state, action === 'disconnect' ? 'disconnected' : 'connected');
    });
  }

  test(`a queued ${kind} cannot replace a newer intent behind a blocked renewal`, async () => {
    const { harness, renewal, finishRenewal } = await blockedRenewalWithPendingUpdate(kind);
    // Queue the old callback first, then change the desired intent before it
    // can execute. Clearing just the timer handle cannot cancel this callback.
    await harness.elapse(0);
    const latest = { ...intent, details: 'Newest video' };
    const publishing = harness.presence.publish(latest, APPLICATION_ID);
    finishRenewal();
    await Promise.all([renewal, publishing]);
    await settleWrites();
    await harness.elapse(12_000);
    assert.equal(harness.calls.length, kind === 'rate retry' ? 4 : 3);
    assert.equal(harness.calls.at(-1).body.activities[0].details, latest.details);
    assert.deepEqual(harness.storage.session[INTENT_KEY].intent, latest);
  });

  test(`renewal preserves the latest intent and cancels a redundant queued ${kind}`, async () => {
    const { harness, pending, renewal, finishRenewal } = await blockedRenewalWithPendingUpdate(kind);
    await harness.elapse(0);
    finishRenewal();
    await renewal;
    await settleWrites();
    await harness.elapse(12_000);
    assert.equal(harness.calls.length, kind === 'rate retry' ? 3 : 2);
    assert.equal(harness.calls.at(-1).body.activities[0].details, pending.details);
    assert.deepEqual(harness.storage.session[INTENT_KEY].intent, pending);
    assert.equal(harness.presence.status().state, 'active');
  });
}

test('a rate-limited renewal retries its newest pending correction', async () => {
  let updates = 0;
  const harness = createHarness({ request() {
    updates += 1;
    if (updates === 2) throw new DiscordRateLimitError(5000);
    return { token: 'existing-session' };
  } });
  await harness.presence.publish(intent, APPLICATION_ID);
  await harness.elapse(1000);
  const latest = { ...intent, details: 'Newest correction' };
  await harness.presence.publish(latest, APPLICATION_ID);
  assert.equal((await harness.presence.renew()).state, 'rate-limited');
  await harness.elapse(5000);
  assert.equal(harness.calls.at(-1).body.activities[0].details, latest.details);
  assert.deepEqual(harness.storage.session[INTENT_KEY].intent, latest);
});

test('a scheduled replacement rate limit retains the newest desired intent for retry', async () => {
  let requests = 0;
  const harness = createHarness({ request() {
    requests += 1;
    if (requests === 2) throw new Error('Update failed');
    if (requests === 4) throw new DiscordRateLimitError(5000);
    return requests === 3 ? null : { token: 'replacement-session' };
  } });
  await harness.presence.publish(intent, APPLICATION_ID);
  await harness.elapse(1000);
  const latest = { ...intent, details: 'Newest correction' };
  await harness.presence.publish(latest, APPLICATION_ID);
  await harness.elapse(3200);
  assert.deepEqual(harness.calls.map(call => call.path), [UPDATE_PATH, UPDATE_PATH, DELETE_PATH, UPDATE_PATH]);
  assert.equal(harness.presence.status().state, 'rate-limited');
  await harness.elapse(5000);
  assert.equal(harness.calls.length, 5);
  assert.equal(harness.calls.at(-1).body.activities[0].details, latest.details);
  assert.deepEqual(harness.storage.session[INTENT_KEY].intent, latest);
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

for (const [label, error] of [
  ['network failure', new TypeError('Failed to fetch')],
  ['expired authorization', Object.assign(new Error('Unauthorized'), { status: 401 })],
  ['rate limit', new DiscordRateLimitError(30_000)],
  ['timeout', new DOMException('Request timed out', 'TimeoutError')],
]) {
  test(`explicit disconnect clears credentials and pending work after a cleanup ${label}`, async () => {
    const harness = createHarness({
      storage: {
        local: { [SESSION_KEY]: 'existing-session' },
        session: { [INTENT_KEY]: { intent, applicationId: APPLICATION_ID } },
      },
      request() { throw error; },
    });
    await harness.presence.publish(intent, APPLICATION_ID);
    const result = await harness.presence.disconnect();
    assert.equal(result.state, 'disconnected');
    assert.equal(result.authenticated, false);
    assert.match(result.message, /may remain visible/);
    assert.equal(harness.revocations, 1);
    assert.equal(harness.storage.local[SESSION_KEY], undefined);
    assert.equal(harness.storage.session[INTENT_KEY], undefined);
    assert.equal(harness.disarms, 1);
    assert.equal(harness.presence.status().lastCleanupAttempt.state, 'failed');
    if (error.status) assert.equal(harness.presence.status().lastCleanupAttempt.httpStatus, error.status);

    const requestsAfterDisconnect = harness.calls.length;
    await harness.elapse(60_000);
    assert.equal((await harness.presence.renew()).state, 'disconnected');
    assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'disconnected');
    assert.equal((await harness.presence.publish(null)).message, result.message);
    assert.equal(harness.calls.length, requestsAfterDisconnect);
    const restarted = createHarness({ authenticated: false, storage: harness.storage });
    assert.equal((await restarted.presence.initialize()).state, 'disconnected');
    assert.equal((await restarted.presence.renew()).state, 'disconnected');
    assert.equal(restarted.calls.length, 0);
  });
}

test('can reconnect immediately after disconnecting during a long Discord rate limit', async () => {
  let fail = true;
  const harness = createHarness({ request() {
    if (fail) throw new DiscordRateLimitError(60_000);
    return { token: 'fresh-session' };
  } });
  assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'rate-limited');
  assert.equal((await harness.presence.disconnect()).state, 'disconnected');
  fail = false;
  assert.equal((await harness.presence.connect()).state, 'connected');
  assert.equal((await harness.presence.publish(intent, APPLICATION_ID)).state, 'active');
  assert.equal(harness.calls.at(-1).body.token, undefined);
  assert.equal(harness.storage.local[SESSION_KEY], 'fresh-session');
  await harness.elapse(60_000);
  assert.equal(harness.calls.length, 3);
});

test('successful disconnect confirms cleanup before removing authorization', async () => {
  const harness = createHarness({ beforeRevoke() {
    assert.equal(harness.presence.status().lastCleanupAttempt.state, 'confirmed');
    assert.equal(harness.storage.local[SESSION_KEY], undefined);
  } });
  const result = await harness.presence.disconnect();
  assert.equal(result.state, 'disconnected');
  assert.equal(result.authenticated, false);
  assert.doesNotMatch(result.message, /may remain visible/);
  assert.equal(harness.revocations, 1);
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

test('finishes disconnecting before a concurrent publish can create another session', async () => {
  let releaseRevocation;
  const revocationBlocked = new Promise((resolve) => { releaseRevocation = resolve; });
  let markRevoking;
  const revoking = new Promise((resolve) => { markRevoking = resolve; });
  const harness = createHarness({
    beforeRevoke() { markRevoking(); return revocationBlocked; },
    request(call) { return call.path === UPDATE_PATH ? { token: 'orphaned-session' } : null; },
  });

  const disconnecting = harness.presence.disconnect();
  await revoking;
  const publishing = harness.presence.publish(intent, APPLICATION_ID);
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  releaseRevocation();

  assert.equal((await disconnecting).state, 'disconnected');
  assert.equal((await publishing).state, 'disconnected');
  assert.deepEqual(harness.calls.map((call) => call.path), [DELETE_PATH]);
  assert.equal(harness.storage.local[SESSION_KEY], undefined);
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
