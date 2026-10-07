import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/discord-cleanup.js', import.meta.url), 'utf8');

function createCleanupHarness({ deferred = true, deferredError = null } = {}) {
  const messageListeners = [];
  const disconnectListeners = [];
  const replies = [];
  const requests = [];
  const immediateRequests = [];
  const lifecycleListeners = new Map();
  const port = {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { replies.push(message); },
  };
  const chrome = {
    runtime: {
      connect({ name }) {
        assert.equal(name, 'discord-shutdown-cleanup');
        return port;
      },
    },
  };

  vm.runInNewContext(source, {
    AbortController,
    Blob,
    chrome,
    ...(deferred ? { fetchLater(url, options) {
      if (deferredError) throw deferredError;
      requests.push({ url, options });
      return { activated: false };
    } } : {}),
    fetch(url, options) {
      immediateRequests.push({ url, options });
      return Promise.resolve({ ok: true, status: 204 });
    },
    addEventListener(name, listener) { lifecycleListeners.set(name, listener); },
    setTimeout,
  });
  assert.equal(messageListeners.length, 1);
  return {
    requests, immediateRequests, replies,
    command: messageListeners[0],
    pagehide: () => lifecycleListeners.get('pagehide')(),
    failDeferred(error) { deferredError = error; },
  };
}

test('keeps Discord shutdown credentials on the private offscreen port', async () => {
  const { requests, replies, command } = createCleanupHarness();
  command({
    type: 'ARM',
    requestId: 1,
    accessToken: 'private-access-token',
    sessionToken: 'private-session-token',
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://discord.com/api/v10/users/@me/headless-sessions/delete');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-access-token');
  assert.deepEqual(JSON.parse(await requests[0].options.body.text()), { token: 'private-session-token' });
  assert.deepEqual({ ...replies[0] }, { replyTo: 1, ok: true, armed: true, supported: true });

  command({
    type: 'ARM',
    requestId: 2,
    accessToken: 'new-access-token',
    sessionToken: 'new-session-token',
  });
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(requests[1].options.signal.aborted, false);

  command({ type: 'DISARM', requestId: 3 });
  assert.equal(requests[1].options.signal.aborted, true);
  assert.deepEqual({ ...replies[2] }, { replyTo: 3, ok: true, supported: true });
});

for (const [label, options] of [
  ['fetchLater is unavailable', { deferred: false }],
  ['fetchLater cannot schedule the request', { deferredError: new Error('Quota exceeded') }],
]) {
  test(`sends an authenticated keepalive fallback on document exit when ${label}`, async () => {
    const harness = createCleanupHarness(options);
    harness.command({ type: 'ARM', requestId: 1, accessToken: 'access', sessionToken: 'session' });
    assert.deepEqual({ ...harness.replies[0] }, { replyTo: 1, ok: true, armed: true, supported: false, reason: options.deferred === false ? 'unsupported' : 'Error' });
    assert.equal(harness.immediateRequests.length, 0);
    harness.pagehide();
    assert.equal(harness.immediateRequests.length, 1);
    const { url, options: request } = harness.immediateRequests[0];
    assert.equal(url, 'https://discord.com/api/v10/users/@me/headless-sessions/delete');
    assert.equal(request.keepalive, true);
    assert.equal(request.headers.Authorization, 'Bearer access');
    assert.deepEqual(JSON.parse(await request.body.text()), { token: 'session' });
    assert.equal(request.credentials, 'omit');
    assert.deepEqual({ ...harness.replies.find((message) => message.type === 'CLEANUP_EVENT' && message.state === 'confirmed') }, {
      type: 'CLEANUP_EVENT', state: 'confirmed', httpStatus: 204,
    });
    assert.equal(JSON.stringify(harness.replies).includes('Bearer access'), false);
    harness.pagehide();
    assert.equal(harness.immediateRequests.length, 1);
  });
}

test('keeps deferred cleanup armed when starting the immediate exit request', () => {
  const harness = createCleanupHarness();
  harness.command({ type: 'ARM', requestId: 1, accessToken: 'access', sessionToken: 'session' });
  harness.pagehide();
  assert.equal(harness.immediateRequests.length, 1);
  assert.equal(harness.requests[0].options.signal.aborted, false);
});

test('disarming prevents document closure from deleting an active replacement session', () => {
  const harness = createCleanupHarness({ deferred: false });
  harness.command({ type: 'ARM', requestId: 1, accessToken: 'access', sessionToken: 'session' });
  harness.command({ type: 'DISARM', requestId: 2 });
  harness.pagehide();
  assert.equal(harness.immediateRequests.length, 0);
});

test('an invalid rearm preserves both existing cleanup paths', async () => {
  const harness = createCleanupHarness();
  harness.command({ type: 'ARM', requestId: 1, accessToken: 'old-access', sessionToken: 'old-session' });
  // An invalid command must not replace either existing cleanup path.
  harness.command({ type: 'ARM', requestId: 2, accessToken: '', sessionToken: 'new-session' });
  assert.equal(harness.replies[1].ok, false);
  assert.equal(harness.requests[0].options.signal.aborted, false);
  harness.pagehide();
  const request = harness.immediateRequests[0].options;
  assert.equal(request.headers.Authorization, 'Bearer old-access');
  assert.deepEqual(JSON.parse(await request.body.text()), { token: 'old-session' });
});

test('a deferred scheduling failure preserves the old request and updates the exit fallback', async () => {
  const harness = createCleanupHarness();
  harness.command({ type: 'ARM', requestId: 1, accessToken: 'old-access', sessionToken: 'old-session' });
  harness.failDeferred(new Error('Quota exceeded'));
  harness.command({ type: 'ARM', requestId: 2, accessToken: 'new-access', sessionToken: 'new-session' });
  assert.equal(harness.replies[1].armed, true);
  assert.equal(harness.replies[1].supported, false);
  assert.equal(harness.requests[0].options.signal.aborted, false);
  harness.pagehide();
  const request = harness.immediateRequests[0].options;
  assert.equal(request.headers.Authorization, 'Bearer new-access');
  assert.deepEqual(JSON.parse(await request.body.text()), { token: 'new-session' });
});

test('retains the offscreen fallback until a normal cleanup explicitly disarms it', async () => {
  const coordinatorSource = (await readFile(new URL('../extension/discord/shutdown-cleanup.js', import.meta.url), 'utf8'))
    .replace(/^export /gm, '');
  const documentUrl = 'chrome-extension://test/discord-cleanup.html';
  let onConnect;
  let onMessage;
  let closes = 0;
  const port = {
    name: 'discord-shutdown-cleanup',
    sender: { url: documentUrl },
    onMessage: { addListener(listener) { onMessage = listener; } },
    onDisconnect: { addListener() {} },
    postMessage(message) {
      onMessage({ replyTo: message.requestId, ok: true, armed: true, supported: false });
    },
  };
  const context = vm.createContext({
    chrome: {
      runtime: {
        getURL: () => documentUrl,
        onConnect: { addListener(listener) { onConnect = listener; } },
        getContexts: async () => [{}],
      },
      offscreen: {
        async closeDocument() { closes += 1; },
        async createDocument() { assert.fail('Document already exists'); },
      },
    },
    setTimeout, clearTimeout,
  });
  vm.runInContext(`${coordinatorSource}\nglobalThis.cleanup = { armShutdownCleanup, disarmShutdownCleanup, onShutdownCleanup };`, context);
  onConnect(port);
  const armed = await context.cleanup.armShutdownCleanup('access', 'session');
  assert.equal(armed.armed, true);
  assert.equal(armed.deferred, false);
  assert.equal(closes, 0);
  const observations = [];
  context.cleanup.onShutdownCleanup((event) => observations.push(event));
  onMessage({ type: 'CLEANUP_EVENT', state: 'failed', httpStatus: 403, accessToken: 'private-access', sessionToken: 'private-session' });
  assert.deepEqual({ ...observations[0] }, { state: 'failed', httpStatus: 403 });
  await context.cleanup.disarmShutdownCleanup();
  assert.equal(closes, 1);
});
