import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { activityV2ScriptDefinition, runActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { normalizeActivityReport, validateActivityMetadata } from '../extension/core/activity-validator.js';

const capability = 'a'.repeat(64);
const metadata = {
  id: 'sandbox-example', name: 'Sandbox example', description: 'A secure programmable example.',
  version: '1.0.0', apiVersion: 2, matches: ['https://example.com/*'], entry: 'activity.js',
  pageAccess: { selectors: { title: { selector: 'h1', read: 'text' } }, media: true },
};
const source = 'ChudPresence.onUpdate(() => ChudPresence.clear());';
const record = () => ({ metadata: validateActivityMetadata(metadata), code: source, enabled: true, capability });
const sender = {
  tab: { id: 7 }, frameId: 0, documentId: 'doc-7', url: 'https://example.com/watch',
  userScriptWorldId: 'chudpresence.activity.v2.sandbox-example',
};
function fixture() {
  const calls = [];
  const records = { [metadata.id]: record() };
  const api = {
    storage: { local: { async get() { return { installedActivities: records }; }, async set() {} } },
    runtime: { getManifest() { return { version: '2.0.0' }; } },
    permissions: { async contains() { return true; } },
    userScripts: {
      async execute(options) { calls.push(['execute', options]); return [{ documentId: 'doc-7' }]; },
      async getScripts() { return []; },
      async register(options) { calls.push(['register', options]); },
      async configureWorld(options) { calls.push(['configureWorld', options]); },
    },
  };
  return { calls, records, manager: new ActivityManager({ api, onClear(...args) { calls.push(['clear', args]); } }), api };
}
function message(operation, payload = {}) {
  return {
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: metadata.id, activityVersion: metadata.version,
    apiVersion: 2, capability, requestId: 'v2-request', operation, payload,
  };
}

test('v2 adds page access without modifying the v1 metadata or report contract', () => {
  assert.deepEqual(validateActivityMetadata({ ...metadata, pageAccess: undefined }).pageAccess,
    { selectors: {}, media: false, url: false });
  assert.throws(() => validateActivityMetadata({ ...metadata, apiVersion: 1 }), /unsupported field pageAccess/);
  const report = { kind: 'video', media: { title: 'Video title' }, playback: { state: 'playing', position: 12, duration: 90 } };
  assert.deepEqual(normalizeActivityReport(report, 1), normalizeActivityReport(report, 2));
});

test('v2 registers only the page broker in a distinct world without native eval or WASM permissions', async () => {
  const { manager, calls } = fixture();
  await manager.register(record());
  const world = calls.find(([kind]) => kind === 'configureWorld')[1];
  assert.equal(world.worldId, sender.userScriptWorldId);
  assert.doesNotMatch(world.csp, /wasm-unsafe-eval/);
  assert.doesNotMatch(world.csp, /'unsafe-eval'/);
  const script = calls.find(([kind]) => kind === 'register')[1][0];
  assert.equal(script.js[0].file, 'core/activity-v2-page.generated.js');
  assert.equal(script.worldId, sender.userScriptWorldId);
  assert.doesNotMatch(script.js[1].code, /"source":/);
});

test('restoring v2 after a worker restart reinstates its strict world CSP', async () => {
  const { manager, calls } = fixture();
  const result = await manager.restoreAll();
  assert.equal(result.restored, 1);
  const world = calls.find(([kind]) => kind === 'configureWorld')[1];
  assert.equal(world.worldId, sender.userScriptWorldId);
  assert.match(world.csp, /script-src 'self'/);
  assert.match(world.csp, /connect-src 'none'/);
  assert.doesNotMatch(world.csp, /'unsafe-eval'/);
});

test('v2 denies page.execute and legacy messages at the background boundary', async () => {
  const { manager, calls } = fixture();
  const result = await manager.handleUserScriptMessage(message('page.execute', { source: '() => document.cookie' }), sender);
  assert.equal(result.error.code, 'unsupported_operation');
  assert.equal(calls.length, 0);
  const legacy = await manager.handleUserScriptMessage({ ...message('presence.clear'), type: 'CHUDPRESENCE_ACTIVITY_CLEAR' }, sender);
  assert.equal(legacy.error.code, 'unsupported_operation');
  assert.equal(await manager.handleUserScriptMessage(message('settings.getAll'), {
    ...sender, userScriptWorldId: 'chudpresence.activity.sandbox-example',
  }), false);
});

test('v2 accepts versioned lifecycle connections and rejects a v1 connection for the same package', async () => {
  const { manager } = fixture();
  const port = { name: `chudpresence-activity-v2:${metadata.id}:${metadata.version}:${capability}`, sender,
    onDisconnect: { addListener() {} } };
  assert.equal(await manager.handleUserScriptConnect(port), true);
  assert.equal(await manager.handleUserScriptConnect({ ...port, name: port.name.replace('-v2:', '-v1:') }), false);
});

test('v2 reuses scoped settings/storage and accepts the v1-shaped report', async () => {
  const { manager } = fixture();
  const settings = await manager.handleUserScriptMessage(message('settings.getAll'), sender);
  assert.equal(settings.ok, true);
  const report = await manager.handleUserScriptMessage(message('presence.report', {
    report: { kind: 'video', media: { title: 'Video title' } },
  }), sender);
  assert.equal(report.ok, true);
  assert.equal((await manager.status()).apiVersion, 2);
  assert.deepEqual((await manager.listInstalled())[0].pageAccess, record().metadata.pageAccess);
});

for (const excluded of [false, true]) {
  test(`v2 can clear existing presence after an SPA ${excluded ? 'enters an excluded route' : 'leaves its matched path'}`, async () => {
    const { manager, calls, records } = fixture();
    if (excluded) records[metadata.id].metadata.excludeMatches = ['https://example.com/private*'];
    else records[metadata.id].metadata.matches = ['https://example.com/watch*'];
    assert.equal((await manager.handleUserScriptMessage(message('presence.report', {
      report: { kind: 'video', media: { title: 'Video title' } },
    }), sender)).ok, true);
    const privateRoute = { ...sender, url: 'https://example.com/private' };
    const result = await manager.handleUserScriptMessage(message('presence.clear'), privateRoute);
    assert.equal(result.ok, true);
    assert.equal(result.data.cleared, true);
    assert.equal(calls.filter(([kind]) => kind === 'clear').length, 1);
    assert.equal(await manager.handleUserScriptMessage(message('settings.getAll'), privateRoute), false);
  });
}

test('bootstrap never runs package text natively and tears down on URL scope loss', async () => {
  const definition = activityV2ScriptDefinition({ ...record(), code: 'globalThis.nativeEscape = true; throw new Error("package");' });
  let tick;
  let disconnected = 0;
  const requests = [];
  const context = {
    URL, console, location: { href: 'https://example.com/watch' },
    document: {}, clearInterval() {}, clearTimeout() {},
    setInterval(callback) { tick = callback; return 1; }, setTimeout() {},
    addEventListener() {}, removeEventListener() {},
    chrome: { runtime: {
      async sendMessage(request) { requests.push(request); return { ok: true, data: {} }; },
      connect() { return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() { disconnected++; } }; },
    } },
    ChudPresenceV2Page: {
      collectActivityV2Snapshot() { return { reads: {} }; },
    },
  };
  context.window = context;
  context.top = context;
  vm.runInNewContext(definition.js[1].code, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(definition.js[1].code, /nativeEscape/);
  assert.equal(context.nativeEscape, undefined);
  assert.equal(requests[0].operation, 'sandbox.update');
  context.location.href = 'https://other.example/private';
  await tick();
  assert.equal(disconnected, 1);
  assert.equal(requests.at(-1).operation, 'presence.clear');
  assert.equal(requests.at(-1).payload.closing, true);
  assert.equal(context.__chudpresenceV2Stop, undefined);
  assert.equal(typeof runActivityV2, 'function');
});
