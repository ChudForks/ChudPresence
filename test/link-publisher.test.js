import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkError } from '../extension/link/client.js';
import { createLinkPublisher, desktopIntent, LINK_PUBLISHER_KEY } from '../extension/link/publisher.js';

const intent = { name: 'YouTube', type: 'watching', details: 'Current video', state: 'Creator', statusDisplayType: 'state' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness({ paired = true, onRequest, onConnect, cleanupFails = false, saved = {}, syncFails = false } = {}) {
  let clock = 1000;
  let wallClock = 1000;
  let connected = paired;
  let current = intent;
  let headlessActive = true;
  let desktopActive = false;
  let nextTimer = 0;
  const timers = new Map();
  const local = structuredClone(saved);
  const events = [];
  const requests = [];
  const lease = { leaseId: 'lease-one', expiresAt: '2026-10-26T12:00:30Z', heartbeatSeconds: 10, fallbackGraceSeconds: 5 };
  const client = {
    initialize: async () => {}, configure() {}, ready: () => paired,
    status: () => ({ paired, connected, needsPairing: false, services: [] }),
    async sync() { events.push('sync'); if (syncFails) { connected = false; throw new LinkError(); } },
    async pair() { paired = true; connected = true; },
    async unpair() { paired = false; connected = false; return { revoked: false }; },
    async setSync() {}, editPreference() {},
    async request(path, options = {}) {
      const request = { path, ...options };
      requests.push(request); events.push(`${options.method || 'GET'} ${path}`);
      const result = await onRequest?.(request, { advance: ms => { clock += ms; }, lease });
      if (result) return result;
      if (path === '/v1/presence/lease') return { ...lease };
      if (path.startsWith('/v1/presence/lease/')) { desktopActive = false; return null; }
      if (path === '/v1/presence') {
        assert.equal(headlessActive, false, 'desktop must never publish while headless is active');
        desktopActive = Boolean(options.body.intent);
        return { ...lease };
      }
      if (path === '/v1/status') return { discordConnected: true, published: desktopActive, deviceId: 'browser' };
      throw new Error('unexpected path');
    },
  };
  const headless = {
    initialize: async () => {}, status: () => ({ authenticated: true, available: true, state: 'active', message: 'Headless connected' }),
    async suspend() { events.push('suspend'); if (cleanupFails) throw new Error('deletion failed'); headlessActive = false; },
    async publish(value) { events.push(`headless:${value?.details || 'clear'}`); headlessActive = Boolean(value); },
    async renew() { events.push('renew'); }, async connect() { await onConnect?.(); }, async disconnect() {}, async getSetup() { return {}; },
  };
  const storage = { get: async key => ({ [key]: structuredClone(local[key]) }), set: async values => Object.assign(local, structuredClone(values)) };
  const publisher = createLinkPublisher({ headless, client, storage, monotonic: () => clock, now: () => wallClock,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    cancel: id => timers.delete(id) });
  publisher.configure({ currentPresence: async () => ({ intent: current, applicationId: 'fixed-application-id' }) });
  return { publisher, local, events, requests, timers, client,
    setIntent: value => { current = value; }, setConnected: value => { connected = value; },
    advance: ms => { clock += ms; }, jumpWallClock: ms => { wallClock += ms; },
    async runTimer(delay) {
      const next = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(next, `No timer for ${delay}ms`);
      timers.delete(next[0]);
      clock += delay;
      next[1].callback();
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    },
    get headlessActive() { return headlessActive; }, get desktopActive() { return desktopActive; } };
}

test('Link keeps default headless publishing and renewal when no device is paired', async () => {
  const h = harness({ paired: false });
  await h.publisher.publish(intent, 'fixed'); await h.publisher.renew();
  assert.equal(h.publisher.status().link.transport, 'headless');
  assert.deepEqual(h.events, ['headless:Current video', 'renew']);
  assert.equal(h.timers.size, 0);
});

test('Link acquires, confirms headless cleanup, then publishes local RPC in that order', async () => {
  const h = harness();
  await h.publisher.publish(intent, 'fixed');
  assert.deepEqual(h.events, ['POST /v1/presence/lease', 'suspend', 'PUT /v1/presence', 'GET /v1/status']);
  assert.equal(h.publisher.status().id, 'chudpresence-link');
  assert.equal(h.publisher.status().link.published, true);
  assert.equal(h.local[LINK_PUBLISHER_KEY].guarded, true);
});

test('Link sends the newest full intent on heartbeat and increases sequence for clears', async () => {
  const h = harness();
  await h.publisher.publish(intent, 'fixed');
  h.setIntent({ ...intent, details: 'New video' });
  h.advance(10_000);
  await h.publisher.refresh();
  await h.publisher.publish(null, 'fixed', { closing: true });
  const updates = h.requests.filter(request => request.path === '/v1/presence');
  assert.deepEqual(updates.map(request => request.body.sequence), [0, 1, 2]);
  assert.equal(updates[1].body.intent.details, 'New video');
  assert.equal(updates[2].body.intent, null);
  assert.equal(updates[2].keepalive, true);
  assert.ok(h.events.indexOf('sync') > h.events.indexOf('PUT /v1/presence', 4), 'heartbeat precedes settings I/O');
});

test('Link never hands off when headless deletion fails and releases its empty reservation', async () => {
  const h = harness({ cleanupFails: true });
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.requests.some(request => request.path === '/v1/presence'), false);
  assert.ok(h.events.includes('DELETE /v1/presence/lease/lease-one'));
  assert.equal(h.publisher.status().link.transport, 'headless');
  assert.equal(h.headlessActive, true);
  assert.equal(h.local[LINK_PUBLISHER_KEY].guarded, false);
});

for (const code of ['discord_unavailable', 'publisher_busy']) {
  test(`Link retains headless publishing on ${code}`, async () => {
    const h = harness({ onRequest: request => { if (request.path === '/v1/presence/lease') throw new LinkError(code, code === 'publisher_busy' ? 409 : 503); } });
    await h.publisher.publish(intent, 'fixed');
    assert.equal(h.events.includes('suspend'), false);
    assert.equal(h.publisher.status().link.transport, 'headless');
    assert.equal(h.local[LINK_PUBLISHER_KEY].guarded, false);
  });
}

test('Link waits 35 seconds AFTER a lost heartbeat finishes before falling back', async () => {
  let fail = false;
  const h = harness({ onRequest: (request, context) => {
    if (fail && request.path === '/v1/presence') { context.advance(8000); throw new LinkError(); }
  } });
  await h.publisher.publish(intent, 'fixed');
  fail = true;
  h.advance(5000);
  await h.publisher.publish(intent, 'fixed');
  h.setConnected(false);
  assert.equal(h.publisher.status().link.fallbackSeconds, 35);
  h.advance(34_999); h.jumpWallClock(3600_000);
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.events.some(event => event.startsWith('headless:')), false);
  assert.equal(h.publisher.status().link.transport, 'waiting');
  h.advance(1); await h.publisher.publish(intent, 'fixed');
  assert.equal(h.events.at(-1), 'headless:Current video');
  assert.equal(h.publisher.status().link.transport, 'headless');
});

test('Link waits after an acquisition response is lost without attempting a second acquisition', async () => {
  const h = harness({ onRequest: request => { if (request.path === '/v1/presence/lease') throw new LinkError(); } });
  await h.publisher.publish(intent, 'fixed');
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.requests.length, 1);
  assert.equal(h.publisher.status().link.transport, 'waiting');
  assert.equal(h.publisher.status().link.fallbackSeconds, 35);
});

test('Link restores a conservative fallback guard across a service-worker restart', async () => {
  const h = harness({ paired: false, saved: { [LINK_PUBLISHER_KEY]: { guarded: true, recordedAt: -1_000_000 } } });
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.events.length, 0);
  h.advance(35_000);
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.events.at(-1), 'headless:Current video');
});

test('Link startup recovery waits safely while connected, then stays idle until a valid presence arrives', async () => {
  const h = harness({ saved: { [LINK_PUBLISHER_KEY]: { guarded: true } } });
  h.setIntent(null);
  await h.publisher.initialize();
  assert.equal(h.publisher.status().state, 'startup-wait');
  assert.equal(h.publisher.status().link.recovery, 'startup');
  assert.equal(h.publisher.status().link.connected, true);
  assert.equal(h.publisher.status().link.fallbackSeconds, 35);
  assert.doesNotMatch(h.publisher.status().message, /disconnected|headless/i);
  await h.publisher.refresh();
  assert.equal(h.requests.length, 0);
  assert.equal(h.events.some(event => event.startsWith('headless:')), false);
  h.advance(35_000);
  await h.publisher.refresh();
  assert.equal(h.publisher.status().link.transport, 'idle');
  assert.equal(h.publisher.status().state, 'waiting-for-activity');
  assert.equal(h.requests.length, 0, 'An idle browser must not acquire an RPC lease');
  h.setIntent(intent);
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.publisher.status().link.transport, 'local');
  assert.equal(h.events.includes('headless:Current video'), false);
});

test('Link confirms asynchronous publication without another PUT resetting it to pending', async () => {
  let published = false;
  const h = harness({ onRequest: request => request.path === '/v1/status' ? { discordConnected: true, published } : null });
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.publisher.status().state, 'accepted');
  published = true;
  await h.runTimer(1500);
  assert.equal(h.publisher.status().state, 'active');
  assert.equal(h.publisher.status().link.published, true);
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 1);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 1500), false);
});

test('Link confirmation failures retain the full fallback grace and clears cancel pending confirmation', async () => {
  let reads = 0;
  const h = harness({ onRequest: request => {
    if (request.path !== '/v1/status') return null;
    if (++reads > 1) throw new LinkError();
    return { discordConnected: true, published: false };
  } });
  await h.publisher.publish(intent, 'fixed');
  await h.runTimer(1500);
  assert.equal(h.publisher.status().link.recovery, 'connection-lost');
  assert.equal(h.publisher.status().state, 'fallback-wait');
  assert.equal(h.publisher.status().link.fallbackSeconds, 35);
  assert.equal(h.events.some(event => event.startsWith('headless:')), false);

  const clear = harness({ onRequest: request => request.path === '/v1/status' ? { discordConnected: true, published: false } : null });
  await clear.publisher.publish(intent, 'fixed');
  await clear.publisher.publish(null, 'fixed');
  assert.equal([...clear.timers.values()].some(timer => timer.delay === 1500), false);
  assert.equal(clear.publisher.status().state, 'connected');
});

test('Link resumes headless immediately after confirmed lease_lost', async () => {
  let fail = false;
  const h = harness({ onRequest: request => { if (fail && request.path === '/v1/presence') throw new LinkError('lease_lost', 409); } });
  await h.publisher.publish(intent, 'fixed');
  fail = true;
  h.advance(5000);
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.publisher.status().link.transport, 'headless');
  assert.equal(h.local[LINK_PUBLISHER_KEY].guarded, false);
});

test('Link releases local Discord before resuming headless when Discord disconnects', async () => {
  let discordConnected = true;
  const h = harness({ onRequest: request => request.path === '/v1/status' ? { discordConnected, published: false } : null });
  await h.publisher.publish(intent, 'fixed');
  assert.equal(h.publisher.status().state, 'accepted');
  discordConnected = false;
  h.advance(5000);
  await h.publisher.publish(intent, 'fixed');
  assert.deepEqual(h.events.slice(-2), ['DELETE /v1/presence/lease/lease-one', 'headless:Current video']);
});

test('Link retains the fallback guard when unpairing cannot confirm release', async () => {
  let offline = false;
  const h = harness({ onRequest: () => { if (offline) throw new LinkError(); } });
  await h.publisher.publish(intent, 'fixed');
  offline = true;
  await h.publisher.unpair();
  assert.equal(h.publisher.status().link.paired, false);
  assert.equal(h.publisher.status().link.transport, 'waiting');
  assert.equal(h.local[LINK_PUBLISHER_KEY].guarded, true);
  h.advance(35_000); await h.publisher.publish(intent, 'fixed');
  assert.equal(h.events.at(-1), 'headless:Current video');
});

test('Link serializes publication requests and frequent reports cannot postpone the polling timer', async () => {
  const started = deferred(); const gate = deferred(); let block = true;
  const h = harness({ onRequest: async request => {
    if (block && request.path === '/v1/presence') { started.resolve(); await gate.promise; block = false; }
  } });
  const first = h.publisher.publish(intent, 'fixed');
  await started.promise;
  const timer = [...h.timers.keys()][0];
  const second = h.publisher.publish({ ...intent, details: 'Second' }, 'fixed');
  await Promise.resolve();
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 1);
  gate.resolve(); await Promise.all([first, second]);
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 1);
  await h.runTimer(5000);
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 2);
  assert.equal([...h.timers.keys()][0], timer);
});

test('Link coalesces ordinary reports and a clear cancels the deferred update', async () => {
  const h = harness();
  await h.publisher.publish(intent, 'fixed');
  await h.publisher.publish({ ...intent, details: 'Second' }, 'fixed');
  await h.publisher.publish({ ...intent, details: 'Newest' }, 'fixed');
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 1);
  await h.runTimer(5000);
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').at(-1).body.intent.details, 'Newest');
  await h.publisher.publish({ ...intent, details: 'Must not return' }, 'fixed');
  await h.publisher.publish(null, 'fixed', { closing: true });
  assert.equal(h.requests.filter(request => request.path === '/v1/presence').at(-1).body.intent, null);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 5000), false);
});

test('Link continues local heartbeats while the user connects a headless fallback account', async () => {
  const gate = deferred(); const started = deferred();
  const h = harness({ onConnect: async () => { started.resolve(); await gate.promise; } });
  await h.publisher.publish(intent, 'fixed');
  const connecting = h.publisher.connect();
  await started.promise;
  h.advance(10_000);
  const heartbeat = h.publisher.refresh();
  try {
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    assert.equal(h.requests.filter(request => request.path === '/v1/presence').length, 2);
  } finally { gate.resolve(); }
  await Promise.all([connecting, heartbeat]);
});

test('Link adapts Unicode text, playback seconds, and safe URLs to the desktop contract', () => {
  const adapted = desktopIntent({ ...intent, details: '🎥'.repeat(80), state: 'a\u0000b',
    streamUrl: 'https://example.com/stream', source: 'private-package',
    timestamps: { start: 100, end: 300 },
    assets: { largeImage: 'https://example.com/image', largeText: 'é'.repeat(200), smallImage: 'http://insecure.example/image' },
    buttons: [{ label: '🎥'.repeat(30), url: 'https://example.com/watch' }, { label: 'Unsafe', url: 'https://user:pass@example.com/' }] });
  assert.ok(Buffer.byteLength(adapted.details) <= 128);
  assert.ok(Buffer.byteLength(adapted.assets.largeText) <= 128);
  assert.ok(Buffer.byteLength(adapted.buttons[0].label) <= 32);
  assert.equal(adapted.buttons.length, 1);
  assert.equal(adapted.state, 'a b');
  assert.equal(adapted.assets.smallImage, undefined);
  assert.equal(adapted.source, undefined);
  assert.equal(adapted.streamUrl, undefined);
  assert.deepEqual(adapted.timestamps, { start: 100, end: 300 });
  assert.equal(desktopIntent({ ...intent, timestamps: null }).timestamps, undefined);
});
