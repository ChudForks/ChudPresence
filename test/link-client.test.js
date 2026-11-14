import assert from 'node:assert/strict';
import test from 'node:test';
import { createLinkClient, LINK_STORAGE_KEY, LINK_HOST_PERMISSION, LINK_SETTING_FIELDS, linkInventory, linkServiceId, prepareLinkNetwork } from '../extension/link/client.js';

const token = 'a'.repeat(64);
const pairing = { code: '01234567', name: 'Test browser', port: 17879 };
const choices = ['app', 'creator', 'title'];
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers(headers), json: async () => structuredClone(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness({ enabled = true, stored = {}, onFetch, applyFailure = false, prepareNetwork, modern = false,
  fields = LINK_SETTING_FIELDS, origin = '' } = {}) {
  const local = structuredClone(stored);
  const calls = [];
  const applications = [];
  let now = 1000;
  const server = { id: 'server-one', display: 'creator', version: 3, syncVersion: 1, enabled, shared: true,
    choices: [...choices], offline: false, unauthorized: false, fields: [...fields], supported: [...LINK_SETTING_FIELDS],
    values: { enabled: true, showWhilePaused: false, artwork: true, playbackProgress: true, actionButtons: false } };
  const activities = [{ id: 'youtube', name: 'YouTube', preferences: { statusDisplay: 'app', showArtwork: false } }];
  if (modern) Object.assign(activities[0], { enabled: true, preferences: { statusDisplay: 'app', showPaused: true,
    showArtwork: false, showTimestamps: true, showButtons: true } });
  const discovery = () => ({ revision: 1, services: [{ id: 'youtube', name: 'YouTube', shared: server.shared,
    syncEnabled: server.enabled, syncVersion: server.syncVersion, displayChoices: server.choices,
    ...(modern ? { syncRequested: server.enabled, supportedFields: server.supported, syncFields: server.fields } : {}),
    participants: [{ deviceId: 'browser', kind: 'browser', name: 'Test browser', display: 'app' },
      { deviceId: 'phone', kind: 'mobile', name: 'My phone', display: 'creator', ...(modern ? server.values : {}) }] }] });
  const snapshot = () => ({ revision: server.version, services: server.enabled && server.shared && !server.paused
    ? { youtube: { ...(modern ? Object.fromEntries(server.fields.map(field => [field, field === 'display' ? server.display : server.values[field]]))
      : { display: server.display }), version: server.version } } : {} });
  const storage = {
    get: async key => ({ [key]: structuredClone(local[key]) }),
    set: async value => Object.assign(local, structuredClone(value)),
  };
  const options = { storage, prepareNetwork, origin, now: () => now, fetch: async (url, request) => {
    assert.equal(request.mode, 'cors');
    const path = new URL(url).pathname;
    const call = { path, method: request.method, headers: request.headers,
      body: request.body && JSON.parse(request.body), request };
    calls.push(call);
    if (server.offline) throw new Error('network down');
    const override = await onFetch?.(call, server);
    if (override) return override;
    if (path === '/v1/info') return response({ serverId: server.id, protocolVersion: 1,
      capabilities: ['service-discovery', 'service-sync-opt-in', 'service-display-sync', 'desktop-presence-lease',
        ...(modern ? ['service-settings-sync', 'selective-settings-sync'] : [])] });
    if (path === '/v1/pair') return response({ serverId: server.id, protocolVersion: 1, deviceId: 'browser', token });
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.equal(request.headers.Origin, origin || undefined);
    if (server.unauthorized) return response({ error: 'unauthorized' }, 401);
    if (path === '/v1/device') return response(null, 204);
    if (path === '/v1/services') return response(discovery());
    if (path.endsWith('/sync')) {
      server.enabled = call.body.enabled;
      server.syncVersion++;
      server.version++;
      if (call.body.fields) server.fields = [...call.body.fields];
      if (call.body.initialDisplay) server.display = call.body.initialDisplay;
      if (call.body.initialSettings) {
        Object.assign(server.values, call.body.initialSettings);
        if (call.body.initialSettings.display) server.display = call.body.initialSettings.display;
      }
      return response(discovery());
    }
    if (path === '/v1/settings') {
      const conflicts = [];
      if (call.method === 'PATCH') {
        for (const [id, change] of Object.entries(call.body.changes)) {
          assert.equal(id, 'youtube');
          const values = Object.entries(change).filter(([field]) => field !== 'baseVersion');
          if (change.baseVersion !== server.version && values.some(([field, value]) => value !== (field === 'display' ? server.display : server.values[field]))) conflicts.push(id);
          else {
            for (const [field, value] of values) {
              if (field === 'display') server.display = value;
              else server.values[field] = value;
            }
            server.version++;
          }
        }
      }
      return response({ ...snapshot(), conflicts });
    }
    throw new Error(`Unexpected path: ${path}`);
  } };
  function makeClient() {
    const client = createLinkClient(options);
    client.configure({ getActivities: async () => structuredClone(activities),
      applySettings: async (id, patch) => {
        if (applyFailure) throw new Error('storage failed');
        applications.push({ id, patch });
        const { enabled, ...preferences } = patch;
        const activity = activities.find(activity => activity.id === id);
        Object.assign(activity.preferences, preferences);
        if (typeof enabled === 'boolean') activity.enabled = enabled;
      } });
    return client;
  }
  const client = makeClient();
  return { client, makeClient, server, activities, local, calls, applications, storage,
    advance: amount => { now += amount; },
    edit: (display, target = client) => target.editPreference('youtube', { statusDisplay: display }, async () => {
      activities[0].preferences.statusDisplay = display;
      return { preferences: activities[0].preferences };
    }),
    editSettings: (patch, target = client) => target.editPreference('youtube', patch, async () => {
      const { enabled, ...preferences } = patch;
      Object.assign(activities[0].preferences, preferences);
      if (typeof enabled === 'boolean') activities[0].enabled = enabled;
    }),
  };
}

test('Link advertises actual installed settings with stable IDs, explicit false, and no invented capabilities', () => {
  assert.equal(linkServiceId('youtube_music'), 'youtube-music');
  assert.equal(linkServiceId('youTubeMusic'), 'you-tube-music');
  assert.deepEqual(linkInventory([{ id: 'youtube-music', name: 'Music', preferences: { statusDisplay: 'artist', showPaused: false } },
    { id: 'bad/id', name: 'Invalid' }]), [{ id: 'youtube-music', name: 'Music', display: 'creator', showWhilePaused: false, displayChoices: choices }]);
  assert.deepEqual(linkInventory([{ id: 'radio', enabled: false, preferences: { statusDisplay: 'unsupported', showArtwork: false } },
    { id: 'missing', name: 'No settings' }]), [{ id: 'radio', name: 'radio', enabled: false, artwork: false }]);
});

test('Link pairs with a browser code, reports services, and never enables sync automatically', async () => {
  const h = harness({ enabled: false });
  await h.client.pair(pairing);
  await h.client.sync();
  assert.deepEqual(h.calls.find(call => call.path === '/v1/pair').body, { code: '01234567', name: 'Test browser', kind: 'browser' });
  assert.equal(h.calls.some(call => call.path.endsWith('/sync')), false);
  assert.equal(h.activities[0].preferences.statusDisplay, 'app');
  assert.equal(h.applications.length, 0);
  assert.equal(JSON.stringify(h.client.status()).includes(token), false);
  assert.equal(h.local[LINK_STORAGE_KEY].pairing.serverId, 'server-one');
});

test('Link adopts enabled server choices without turning remote changes into writes', async () => {
  const h = harness();
  await h.client.pair(pairing); await h.client.sync(); await h.client.sync();
  assert.equal(h.activities[0].preferences.statusDisplay, 'artist');
  assert.equal(h.activities[0].preferences.showArtwork, false);
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 0);
  assert.equal(h.local[LINK_STORAGE_KEY].baseline.youtube.version, 3);
  await h.edit('track'); await h.client.sync();
  assert.deepEqual(h.calls.find(call => call.method === 'PATCH').body, { changes: { youtube: { display: 'title', baseVersion: 3 } } });
  assert.equal(h.client.status().pendingChanges, 0);
});

test('Link sync is explicitly initialized from a device or a common display choice', async () => {
  const h = harness({ enabled: false });
  await h.client.pair(pairing); await h.client.sync();
  await h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 1, sourceDeviceId: 'phone' });
  assert.deepEqual(h.calls.find(call => call.path.endsWith('/sync')).body, { enabled: true, baseVersion: 1, sourceDeviceId: 'phone' });
  await h.client.setSync({ id: 'youtube', enabled: false, baseVersion: 2 });
  await h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 3, initialDisplay: 'title' });
  assert.equal(h.activities[0].preferences.statusDisplay, 'track');
  await assert.rejects(h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 4, sourceDeviceId: 'phone', initialDisplay: 'app' }));
});

test('Link retains explicit offline edits and their original versions across worker restart', async () => {
  const h = harness();
  await h.client.pair(pairing); await h.client.sync();
  h.server.offline = true;
  await h.edit('track');
  await assert.rejects(h.client.sync());
  const restarted = h.makeClient();
  await restarted.initialize();
  await h.edit('app', restarted);
  h.server.offline = false;
  await restarted.sync();
  const patch = h.calls.filter(call => call.method === 'PATCH').at(-1);
  assert.deepEqual(patch.body, { changes: { youtube: { display: 'app', baseVersion: 3 } } });
  assert.equal(restarted.status().pendingChanges, 0);
});

test('Link conflicts adopt the server preference and never automatically resubmit it', async () => {
  const h = harness();
  await h.client.pair(pairing); await h.client.sync();
  await h.edit('track');
  h.server.display = 'app'; h.server.version = 9;
  await h.client.sync(); await h.client.sync();
  assert.equal(h.activities[0].preferences.statusDisplay, 'app');
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.match(h.client.status().conflict, /newer choice/);
});

test('Link discards queued shared writes when a service is disabled or loses phone overlap', async () => {
  for (const field of ['enabled', 'shared']) {
    const h = harness();
    await h.client.pair(pairing); await h.client.sync(); await h.edit('track');
    h.server[field] = false;
    await h.client.sync();
    assert.equal(h.activities[0].preferences.statusDisplay, 'track');
    assert.equal(h.client.status().pendingChanges, 0);
    assert.equal(h.calls.some(call => call.method === 'PATCH'), false);
    assert.deepEqual(h.local[LINK_STORAGE_KEY].baseline, {});
  }
});

test('Link retains the local choice and drops queued writes when settings marks an enabled service paused', async () => {
  const h = harness();
  await h.client.pair(pairing); await h.client.sync(); await h.edit('track');
  h.server.paused = true;
  await h.client.sync();
  assert.equal(h.client.status().services[0].syncActive, false);
  assert.equal(h.calls.some(call => call.method === 'PATCH'), false);
  assert.equal(h.activities[0].preferences.statusDisplay, 'track');
  assert.equal(h.client.status().pendingChanges, 0);
});

test('Link preserves a local edit made during the first service discovery request', async () => {
  const started = deferred(); const gate = deferred(); let block = true;
  const h = harness({ onFetch: async call => {
    if (block && call.path === '/v1/services') { started.resolve(); await gate.promise; }
  } });
  await h.client.pair(pairing);
  const sync = h.client.sync();
  await started.promise;
  await h.edit('track');
  gate.resolve(); await sync;
  assert.equal(h.activities[0].preferences.statusDisplay, 'track');
  block = false;
  await h.client.sync();
  assert.equal(h.server.display, 'title');
});

test('Link keeps a newer user edit when an earlier PATCH response arrives', async () => {
  const gate = deferred(); const started = deferred(); let block = false;
  const h = harness({ onFetch: async call => {
    if (block && call.method === 'PATCH') { started.resolve(); await gate.promise; }
  } });
  await h.client.pair(pairing); await h.client.sync(); await h.edit('track');
  block = true;
  const sync = h.client.sync();
  await started.promise;
  await h.edit('app');
  gate.resolve(); await sync;
  assert.equal(h.activities[0].preferences.statusDisplay, 'app');
  assert.equal(h.local[LINK_STORAGE_KEY].dirty.youtube.display, 'app');
  assert.equal(h.local[LINK_STORAGE_KEY].dirty.youtube.baseVersion, 4);
  block = false;
  await h.client.sync();
  assert.equal(h.server.display, 'app');
  assert.equal(h.client.status().pendingChanges, 0);
});

test('Link does not save a new baseline if applying the remote preference fails', async () => {
  const h = harness({ applyFailure: true });
  await h.client.pair(pairing);
  await assert.rejects(h.client.sync(), /unavailable/);
  assert.equal(h.local[LINK_STORAGE_KEY].baseline.youtube, undefined);
});

test('Link rejects an unsupported dirty choice and adopts the compatible shared value', async () => {
  const h = harness(); await h.client.pair(pairing); await h.client.sync();
  await h.edit('track'); h.server.choices = ['app', 'creator'];
  await h.client.sync();
  assert.equal(h.calls.some(call => call.method === 'PATCH'), false);
  assert.equal(h.activities[0].preferences.statusDisplay, 'artist');
  assert.match(h.client.status().conflict, /not supported/);
});

test('Link verifies server identity before every authenticated request and refuses changed servers', async () => {
  const h = harness(); await h.client.pair(pairing); await h.client.sync();
  const before = h.calls.length;
  h.server.id = 'different-server';
  await assert.rejects(h.client.sync(), /server has changed/);
  assert.equal(h.client.status().needsPairing, true);
  assert.ok(h.calls.slice(before).every(call => !call.headers.Authorization));
  await h.client.unpair();
  assert.ok(h.calls.slice(before).every(call => !call.headers.Authorization));
});

test('Link revocation requires pairing again while retaining local preferences', async () => {
  const h = harness(); await h.client.pair(pairing); await h.client.sync();
  h.server.unauthorized = true;
  await assert.rejects(h.client.sync(), /no longer authorized/);
  assert.equal(h.client.status().needsPairing, true);
  assert.equal(h.activities[0].preferences.statusDisplay, 'artist');
  const before = h.calls.length;
  await h.client.sync();
  assert.equal(h.calls.length, before);
});

test('Link honors rate limits and does not make requests during Retry-After', async () => {
  let limited = false;
  const h = harness({ onFetch: async call => limited && call.path === '/v1/info' ? response({ error: 'rate_limited' }, 429, { 'Retry-After': '60' }) : null });
  await h.client.pair(pairing); limited = true;
  await assert.rejects(h.client.sync(), /too many/);
  const before = h.calls.length;
  await assert.rejects(h.client.sync(), /too many/);
  assert.equal(h.calls.length, before);
  h.advance(60_000); limited = false;
  await h.client.sync();
  assert.ok(h.calls.length > before);
});

test('Link bounds fetch timeouts and rejects nonlocal pairing endpoints and malformed codes', async () => {
  const h = harness();
  await assert.rejects(h.client.pair({ ...pairing, port: 70000 }), /valid local port/);
  await assert.rejects(h.client.pair({ ...pairing, code: '1234' }), /eight-digit/);
  const client = createLinkClient({ storage: h.storage, timeoutMs: 5,
    fetch: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(client.pair(pairing), /unavailable/);
});

test('Link stays connected for settings sync when desktop Discord is unavailable', async () => {
  const h = harness({ onFetch: async call => call.path === '/v1/presence/lease'
    ? response({ error: 'discord_unavailable' }, 503) : null });
  await h.client.pair(pairing); await h.client.sync();
  await assert.rejects(h.client.request('/v1/presence/lease', { method: 'POST', body: {} }), /Desktop Discord/);
  assert.equal(h.client.status().connected, true);
  await h.edit('track'); await h.client.sync();
  assert.equal(h.server.display, 'title');
});

test('Link removes only the legacy localhost grant before using the server CORS policy', async () => {
  for (const granted of [true, false]) {
    const removed = [];
    await prepareLinkNetwork({ permissions: {
      async contains(request) { assert.deepEqual(request, { origins: [LINK_HOST_PERMISSION] }); return granted; },
      async remove(request) { removed.push(request); return true; },
    } });
    assert.deepEqual(removed, granted ? [{ origins: [LINK_HOST_PERMISSION] }] : []);
  }
  await prepareLinkNetwork({});
});

test('Link preserves a loopback grant used by an approved self-hosted Activity, even while disabled', async () => {
  let removed = false;
  await prepareLinkNetwork({ permissions: {
    async contains() { return true; }, async remove() { removed = true; },
  }, storage: { local: { async get() { return { installedActivities: { jellyfin: {
    metadata: { apiVersion: 1, siteAccess: 'user-configured' }, enabled: false,
    sites: ['http://127.0.0.1:8096/jellyfin/'],
  } } }; } } } });
  assert.equal(removed, false);
});

test('Link keeps browser identity on GETs when another Activity needs loopback host permission', async () => {
  const origin = 'chrome-extension://test-extension';
  const h = harness({ origin });
  await h.client.pair(pairing);
  await h.client.sync();
  assert.ok(h.calls.some(call => call.method === 'GET'));
  assert.ok(h.calls.every(call => call.headers.Origin === origin));
});

test('a required development host grant cannot prevent Link initialization', async () => {
  await prepareLinkNetwork({ permissions: {
    async contains() { return true; }, async remove() { throw new Error('You cannot remove required permissions.'); },
  } });
});

test('Link waits for permission migration and restores a saved token without pairing again', async () => {
  const gate = deferred(); const started = deferred();
  const h = harness({ stored: { [LINK_STORAGE_KEY]: { pairing: {
    endpoint: 'http://127.0.0.1:17879', serverId: 'server-one', deviceId: 'browser', name: 'My browser', token,
  }, baseline: {}, dirty: {}, edit: 0 } }, prepareNetwork: async () => { started.resolve(); await gate.promise; } });
  const sync = h.client.sync();
  await started.promise;
  assert.equal(h.calls.length, 0);
  gate.resolve(); await sync;
  assert.equal(h.calls.some(call => call.path === '/v1/pair'), false);
  assert.equal(h.client.status().connected, true);
  assert.equal(h.local[LINK_STORAGE_KEY].pairing.token, token);
});

test('Link 0.4 reports all six real settings and continues syncing disabled services', async () => {
  const h = harness({ modern: true });
  h.server.values.enabled = false;
  await h.client.pair(pairing); await h.client.sync();
  const reports = h.calls.filter(call => call.path === '/v1/services' && call.method === 'PUT');
  assert.deepEqual(reports[0].body.services[0], { id: 'youtube', name: 'YouTube', display: 'app', enabled: true,
    showWhilePaused: true, artwork: false, playbackProgress: true, actionButtons: true, displayChoices: choices });
  assert.equal(h.activities[0].enabled, false);
  assert.deepEqual(h.activities[0].preferences, { statusDisplay: 'artist', showPaused: false,
    showArtwork: true, showTimestamps: true, showButtons: false });
  assert.equal(reports.at(-1).body.services[0].enabled, false);
  assert.equal(h.calls.some(call => call.method === 'PATCH'), false);
  await h.editSettings({ showArtwork: false }); await h.client.sync();
  assert.deepEqual(h.calls.find(call => call.method === 'PATCH').body, { changes: { youtube: { artwork: false, baseVersion: 3 } } });
  assert.equal(h.client.status().services[0].syncActive, true);
  assert.equal(h.activities[0].enabled, false);
});

test('boolean-only sync leaves omitted local display, enablement, paused visibility and timers untouched', async () => {
  const h = harness({ modern: true, fields: ['artwork', 'actionButtons'] });
  h.server.choices = [];
  h.server.supported = ['artwork', 'actionButtons'];
  await h.client.pair(pairing); await h.client.sync();
  assert.equal(h.client.status().services[0].syncActive, true);
  assert.deepEqual(h.activities[0].preferences, { statusDisplay: 'app', showPaused: true,
    showArtwork: true, showTimestamps: true, showButtons: false });
  await h.editSettings({ statusDisplay: 'track', showArtwork: false, showPaused: false, enabled: false });
  await h.client.sync();
  assert.deepEqual(h.calls.find(call => call.method === 'PATCH').body, { changes: { youtube: { artwork: false, baseVersion: 3 } } });
  assert.equal(h.activities[0].preferences.statusDisplay, 'track');
  assert.equal(h.activities[0].preferences.showPaused, false);
  assert.equal(h.activities[0].enabled, false);
});

test('Link selects all or a subset with exactly one compatible source and keeps sync versions separate', async () => {
  const h = harness({ modern: true, enabled: false });
  await h.client.pair(pairing); await h.client.sync();
  await h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 1, fields: LINK_SETTING_FIELDS, sourceDeviceId: 'phone' });
  assert.deepEqual(h.calls.find(call => call.path.endsWith('/sync')).body, {
    enabled: true, baseVersion: 1, fields: LINK_SETTING_FIELDS, sourceDeviceId: 'phone',
  });
  await h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 2, fields: ['enabled', 'artwork'],
    initialSettings: { enabled: false, artwork: false } });
  assert.equal(h.activities[0].enabled, false);
  assert.equal(h.activities[0].preferences.showArtwork, false);
  for (const patch of [
    { fields: [] }, { fields: ['artwork', 'artwork'] }, { fields: ['unknown'] },
    { fields: ['artwork'], sourceDeviceId: 'browser' },
    { fields: ['artwork'], sourceDeviceId: 'phone', initialSettings: { artwork: false } },
    { fields: ['artwork'], initialDisplay: 'app' }, { fields: ['artwork'], initialSettings: {} },
  ]) await assert.rejects(h.client.setSync({ id: 'youtube', enabled: true, baseVersion: 3, ...patch }));
  await h.client.setSync({ id: 'youtube', enabled: false, baseVersion: 3 });
  assert.deepEqual(h.calls.filter(call => call.path.endsWith('/sync')).at(-1).body, { enabled: false, baseVersion: 3 });
  assert.equal(h.activities[0].enabled, false);
});

test('boolean edits survive offline restart with their original service baseline and stale conflicts are not retried', async () => {
  const h = harness({ modern: true });
  await h.client.pair(pairing); await h.client.sync();
  h.server.offline = true;
  await h.editSettings({ showArtwork: false, showTimestamps: false });
  await assert.rejects(h.client.sync());
  const restarted = h.makeClient(); await restarted.initialize();
  await h.editSettings({ showPaused: true }, restarted);
  h.server.offline = false; h.server.version = 12;
  await restarted.sync(); await restarted.sync();
  assert.deepEqual(h.calls.find(call => call.method === 'PATCH').body, { changes: { youtube: {
    showWhilePaused: true, artwork: false, playbackProgress: false, baseVersion: 3,
  } } });
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(h.activities[0].preferences.showArtwork, true);
  assert.equal(h.activities[0].preferences.showPaused, false);
  assert.equal(restarted.status().pendingChanges, 0);
});

test('in-flight multisetting writes preserve newer fields and still apply independent remote fields', async () => {
  const gate = deferred(); const started = deferred(); let block = false;
  const h = harness({ modern: true, onFetch: async call => {
    if (block && call.method === 'PATCH') { started.resolve(); await gate.promise; }
  } });
  await h.client.pair(pairing); await h.client.sync();
  await h.editSettings({ showArtwork: false });
  block = true; const sync = h.client.sync(); await started.promise;
  await h.editSettings({ showArtwork: true, showPaused: true });
  h.server.values.actionButtons = true;
  gate.resolve(); await sync;
  assert.equal(h.activities[0].preferences.showArtwork, true);
  assert.equal(h.activities[0].preferences.showPaused, true);
  assert.equal(h.activities[0].preferences.showButtons, true);
  assert.equal(h.local[LINK_STORAGE_KEY].dirty.youtube.baseVersion, 4);
  block = false; await h.client.sync();
  assert.deepEqual(h.calls.filter(call => call.method === 'PATCH').at(-1).body, { changes: { youtube: {
    showWhilePaused: true, artwork: true, baseVersion: 4,
  } } });
});

test('selection changes and lost capability never send stale queued settings', async () => {
  for (const selectionChanged of [true, false]) {
    const h = harness({ modern: true });
    await h.client.pair(pairing); await h.client.sync();
    await h.editSettings({ showArtwork: false, showPaused: true });
    if (selectionChanged) { h.server.syncVersion++; h.server.version++; h.server.fields = ['actionButtons']; }
    else { h.server.supported = ['display']; h.server.paused = true; }
    await h.client.sync();
    assert.equal(h.calls.some(call => call.method === 'PATCH'), false);
    assert.equal(h.client.status().pendingChanges, 0);
    // Deselected preferences stay at their current local values.
    assert.equal(h.activities[0].preferences.showArtwork, false);
    assert.equal(h.activities[0].preferences.showPaused, true);
  }
});

test('failed boolean application cannot acknowledge a dirty edit or advance its persisted baseline', async () => {
  const h = harness({ modern: true, applyFailure: true });
  await h.client.pair(pairing);
  await assert.rejects(h.client.sync());
  assert.deepEqual(h.local[LINK_STORAGE_KEY].baseline, {});
});

test('older Link receives display-only inventories even when the browser supports all settings', async () => {
  const h = harness();
  Object.assign(h.activities[0], { enabled: false, preferences: { statusDisplay: 'app', showArtwork: true, showPaused: false } });
  await h.client.pair(pairing); await h.client.sync();
  assert.deepEqual(h.calls.find(call => call.path === '/v1/services').body.services[0], {
    id: 'youtube', name: 'YouTube', display: 'app', displayChoices: choices,
  });
  assert.equal(h.client.status().selectiveSettings, false);
});

test('authenticated revision events subscribe before inventory, refresh settings, and never loop inventory reports', async () => {
  let stream;
  const h = harness({ modern: true, onFetch: async call => {
    if (call.path === '/v1/info') return response({ serverId: 'server-one', protocolVersion: 1,
      capabilities: ['service-settings-sync', 'selective-settings-sync', 'settings-change-events'] });
    if (call.path === '/v1/events') {
      assert.equal(call.headers.Authorization, `Bearer ${token}`);
      assert.equal(call.headers.Accept, 'text/event-stream');
      return new Response(new ReadableStream({ start(controller) {
        stream = controller;
        call.request.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
  } });
  await h.client.pair(pairing); await h.client.sync();
  assert.ok(h.calls.findIndex(call => call.path === '/v1/events') < h.calls.findIndex(call => call.path === '/v1/services'));
  h.server.values.artwork = false; h.server.version++;
  const emit = value => stream.enqueue(new TextEncoder().encode(value));
  emit('event: revision\r\ndata: {"serverId":"server-one","revision":4}\r\n\r\n');
  await new Promise(resolve => setTimeout(resolve, 80)); await h.client.sync();
  assert.equal(h.activities[0].preferences.showArtwork, false);
  const reports = h.calls.filter(call => call.method === 'PUT').length;
  emit('event: revision\ndata: {"serverId":"server-one","revision":4}\n\n');
  await new Promise(resolve => setTimeout(resolve, 80)); await h.client.sync();
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, reports);
  emit('event: revoked\ndata: {}\n\n');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.client.status().needsPairing, true);
  assert.equal(h.activities[0].preferences.showArtwork, false);
  const before = h.calls.length; await h.client.sync();
  assert.equal(h.calls.length, before);
  await h.client.unpair();
});

test('a dropped hint stream keeps HTTP available, reconnects, and rejects an event from a different server', async () => {
  let opened = 0;
  const h = harness({ modern: true, onFetch: async call => {
    if (call.path === '/v1/info') return response({ serverId: 'server-one', protocolVersion: 1,
      capabilities: ['service-settings-sync', 'selective-settings-sync', 'settings-change-events'] });
    if (call.path === '/v1/events') {
      opened++;
      return new Response(new ReadableStream({ start(controller) {
        if (opened === 1) controller.close();
        else {
          controller.enqueue(new TextEncoder().encode('event: revision\ndata: {"serverId":"different-server","revision":99}\n\n'));
          call.request.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        }
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
  } });
  await h.client.pair(pairing); await h.client.sync();
  assert.equal(h.client.status().connected, true);
  await h.client.request('/v1/settings');
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(opened, 2);
  assert.equal(h.client.status().needsPairing, true);
  assert.match(h.client.status().message, /server has changed/);
  assert.equal(h.activities[0].preferences.statusDisplay, 'artist');
  const before = h.calls.length;
  await h.client.sync(); await h.client.unpair();
  assert.equal(h.calls.length, before);
});
