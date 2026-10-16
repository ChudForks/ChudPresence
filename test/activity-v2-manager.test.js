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

test('installs V2 repository packages with verified provenance and rejects untrusted repositories or changed code', async () => {
  const { manager } = fixture();
  const metadataSource = JSON.stringify(metadata);
  const hash = async (value) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Buffer.from(digest).toString('hex');
  };
  const provenance = {
    repository: 'ChudForks/ChudPresence-Activities-V2', revision: 'b'.repeat(40),
    codeSha256: await hash(source), metadataSha256: await hash(metadataSource),
  };
  const activityPackage = { metadata, metadataSource, source, sourceType: 'repository', provenance };
  await manager.install(activityPackage);
  assert.deepEqual((await manager.get(metadata.id)).source, { type: 'repository', ...provenance });
  assert.equal((await manager.get(metadata.id)).metadata.apiVersion, 2);
  await assert.rejects(manager.install({ ...activityPackage, source: `${source}\n// modified` }), /code no longer matches/);
  await assert.rejects(manager.install({ ...activityPackage,
    provenance: { ...provenance, repository: 'someone/ChudPresence-Activities-V2' },
  }), /missing valid immutable provenance/);
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

test('tab removal rejects queued V2 updates/reports so they cannot recreate a worker or presence', async () => {
  const { manager } = fixture();
  let updates = 0;
  manager.v2Host = { stopTab() {}, async update() { updates++; return { accepted: true }; } };
  await manager.invalidateTab(sender.tab.id, { removed: true });
  assert.equal(await manager.handleUserScriptMessage(message('sandbox.update', { snapshot: { page: {}, reads: {}, media: [] } }), sender), false);
  assert.equal(await manager.handleUserScriptMessage(message('presence.report', { report: { kind: 'generic', media: { title: 'stale' } } }), sender), false);
  assert.equal(updates, 0);
  assert.equal(manager.lastSeen.size, 0);
});

test('only opted-in, in-scope top-document navigation receives the metadata grace', async () => {
  for (const apiVersion of [1, 2]) {
    for (const [options, expected] of [
      [{}, 4000], [{ destination: 'https://other.example/' }, 0],
      [{ destination: 'https://example.com/private', exclude: true }, 0],
      [{ destination: 'javascript:alert(1)' }, 0], [{ frameId: 3 }, 0], [{ optIn: false }, 0],
    ]) {
      const { manager, calls, records } = fixture();
      records[metadata.id].metadata.apiVersion = apiVersion;
      records[metadata.id].metadata.presence = options.optIn === false ? {} : { navigationGraceMs: 4000 };
      if (options.exclude) records[metadata.id].metadata.excludeMatches = ['https://example.com/private*'];
      const context = { ...sender, frameId: options.frameId || 0,
        userScriptWorldId: `chudpresence.activity.${apiVersion === 2 ? 'v2.' : ''}${metadata.id}` };
      const request = (operation, payload) => ({ ...message(operation, payload), apiVersion });
      await manager.handleUserScriptMessage(request('presence.report', { report: { kind: 'generic', media: { title: 'query' } } }), context);
      const result = await manager.handleUserScriptMessage(request('presence.clear', {
        closing: true, navigationUrl: options.destination || 'https://example.com/search?q=new', navigationGraceMs: 999999,
      }), context);
      assert.equal(result.ok, true);
      assert.equal(calls.find(([kind]) => kind === 'clear')[1][4].navigationGraceMs || 0, expected);
    }
  }
});

test('v2 navigation opt-in preserves only valid document navigation hints; ordinary closure stays immediate', async () => {
  for (const [destination, ending, expected] of [
    [{ url: 'https://example.com/search?q=new', sameDocument: false }, null, true],
    [{ url: 'https://other.example/', sameDocument: false }, null, false],
    [{ url: 'https://example.com/search', sameDocument: true }, null, false],
    [{ url: 'https://example.com/search', sameDocument: false }, 'error', false],
    [{ url: 'https://example.com/search', sameDocument: false }, 'abort', false],
    [null, null, false],
  ]) {
    const events = new Map();
    const navigationEvents = new Map();
    const requests = [];
    let stopped = false;
    const context = {
      URL, location: { href: 'https://example.com/watch' },
      document: { addEventListener() {}, removeEventListener() {} },
      navigation: {
        addEventListener(name, callback) { navigationEvents.set(name, callback); },
        removeEventListener(name) { navigationEvents.delete(name); },
      },
      addEventListener(name, callback) { events.set(name, callback); },
      removeEventListener(name) { events.delete(name); },
      setInterval() { return 1; }, clearInterval() { stopped = true; }, setTimeout() {}, clearTimeout() {},
      chrome: { runtime: {
        async sendMessage(request) { requests.push(request); return { ok: true, data: {} }; },
        connect() { return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }; },
      } },
      ChudPresenceV2Page: { collectActivityV2Snapshot() { return { page: {} }; } },
    };
    context.window = context;
    context.top = context;
    const packageRecord = record();
    packageRecord.metadata.presence = { navigationGraceMs: 4000 };
    vm.runInNewContext(activityV2ScriptDefinition(packageRecord).js[1].code, context);
    await new Promise(resolve => setImmediate(resolve));
    const signal = { aborted: false };
    if (destination) navigationEvents.get('navigate')({ destination, signal });
    if (ending === 'error') navigationEvents.get('navigateerror')();
    if (ending === 'abort') signal.aborted = true;
    events.get('beforeunload')();
    assert.equal(requests.at(-1).payload.closing, true);
    assert.equal(Boolean(requests.at(-1).payload.navigationUrl), expected);
    assert.equal(stopped, true);
    assert.equal(navigationEvents.size, 0);
    const count = requests.length;
    vm.runInNewContext(activityV2ScriptDefinition(packageRecord).js[1].code, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, count, 'A loading-tab injection must not restart the ended document');
    events.get('pageshow')({ persisted: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, count + 1, 'Back/forward cache restoration must restart the broker');
    assert.equal(requests.at(-1).operation, 'sandbox.update');
  }
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
    document: { addEventListener() {}, removeEventListener() {} }, clearInterval() {}, clearTimeout() {},
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

test('visibility changes queue an immediate snapshot after an in-flight update and remove the listener on stop', async () => {
  const events = new Map();
  const requests = [];
  let finishFirst;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const context = {
    URL, location: { href: 'https://example.com/watch' },
    document: { visibilityState: 'visible',
      addEventListener(name, callback) { events.set(name, callback); },
      removeEventListener(name) { events.delete(name); },
    },
    clearInterval() {}, clearTimeout() {}, setInterval() { return 1; }, setTimeout() {},
    addEventListener() {}, removeEventListener() {},
    chrome: { runtime: {
      async sendMessage(request) {
        requests.push(request);
        if (requests.length === 1) await first;
        return { ok: true, data: {} };
      },
      connect() { return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }; },
    } },
    ChudPresenceV2Page: { collectActivityV2Snapshot(access, document) { return { page: { visibilityState: document.visibilityState } }; } },
  };
  context.window = context;
  context.top = context;
  vm.runInNewContext(activityV2ScriptDefinition(record()).js[1].code, context);
  assert.equal(requests.length, 1);
  context.document.visibilityState = 'hidden';
  events.get('visibilitychange')();
  finishFirst();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).payload.snapshot.page.visibilityState, 'hidden');
  context.document.visibilityState = 'visible';
  events.get('visibilitychange')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.at(-1).payload.snapshot.page.visibilityState, 'visible');
  context.__chudpresenceV2Stop();
  assert.equal(events.has('visibilitychange'), false);
});
