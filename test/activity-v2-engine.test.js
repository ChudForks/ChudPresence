import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

await import('../extension/core/activity-v2-engine.generated.js');
const { createActivityV2Sandbox, ACTIVITY_V2_SANDBOX_LIMITS: limits } = globalThis.ChudPresenceV2Engine;
const snapshot = () => ({ page: { title: 'A public page', url: 'https://example.com/watch' }, reads: { title: 'Episode 4' }, media: [{ paused: false, currentTime: 12 }] });
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('v2 bundle exports the sandbox and trusted page collector without loading network resources', async () => {
  assert.equal(typeof globalThis.ChudPresenceV2Engine.collectActivityV2Snapshot, 'function');
  assert.equal(typeof globalThis.ChudPresenceV2Engine.validateActivityV2PageAccess, 'function');
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => { fetches++; throw new Error('Unexpected sandbox network loading'); };
  try {
    const sandbox = await createActivityV2Sandbox({ source: '', request() {} });
    sandbox.dispose();
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('guest has no DOM, browser, network, filesystem, WASM, or host globals', async () => {
  const reports = [];
  const names = ['window', 'document', 'chrome', 'browser', 'navigator', 'location', 'history', 'fetch', 'XMLHttpRequest',
    'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'MessageChannel', 'postMessage', 'localStorage', 'sessionStorage',
    'indexedDB', 'caches', 'crypto', 'process', 'require', 'module', 'Buffer', 'WebAssembly', 'setTimeout', 'setInterval',
    'queueMicrotask', '__activityV2Bridge', '__activityV2Deliver', 'ChudPresenceV2Engine', 'std', 'os'];
  const sandbox = await createActivityV2Sandbox({
    source: `ChudPresence.report({ types: ${JSON.stringify(names)}.map(name => typeof globalThis[name]) });`,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  try { await flush(); assert.deepEqual(reports, [{ types: names.map(() => 'undefined') }]); }
  finally { sandbox.dispose(); }
});

test('Function, async constructors, and API function constructors stay in the guest realm', async () => {
  const reports = [];
  const sandbox = await createActivityV2Sandbox({
    source: `
      const constructors = [Function, ChudPresence.report.constructor, Object.constructor, (() => {}).constructor];
      const types = constructors.map(C => C('return [typeof window, typeof document, typeof chrome, typeof process, typeof __activityV2Bridge]')());
      const asyncConstructor = Object.getPrototypeOf(async function(){}).constructor;
      asyncConstructor('return typeof process + ":" + typeof fetch')().then(asyncType => ChudPresence.report({types, asyncType}));
    `,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  try {
    await flush();
    assert.deepEqual(reports, [{ types: Array.from({ length: 4 }, () => Array(5).fill('undefined')), asyncType: 'undefined:undefined' }]);
  } finally { sandbox.dispose(); }
});

test('guest dynamic imports have no module loader or network authority', async () => {
  const reports = [];
  const sandbox = await createActivityV2Sandbox({
    source: `Promise.all([
      import('https://example.com/remote.js').then(() => false, () => true),
      import('node:fs').then(() => false, () => true),
    ]).then(blocked => ChudPresence.report({blocked}));`,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  try { await flush(); assert.deepEqual(reports, [{ blocked: [true, true] }]); }
  finally { sandbox.dispose(); }
});

test('updates give frozen guest JSON snapshots, named page reads, and media without sharing host objects', async () => {
  const reports = [];
  const sandbox = await createActivityV2Sandbox({
    source: `
      ChudPresence.onUpdate(current => {
        let mutationBlocked = false;
        try { current.reads.title = 'changed'; } catch { mutationBlocked = true; }
        ChudPresence.report({
          version: ChudPresence.apiVersion, title: ChudPresence.page.read('title'),
          page: ChudPresence.page.info(), media: ChudPresence.media.getAll(), mutationBlocked,
          inheritedRead: typeof ChudPresence.page.read('constructor'),
          frozen: [ChudPresence, ChudPresence.page, ChudPresence.media, ChudPresence.net, ChudPresence.settings,
            ChudPresence.storage, ChudPresence.log, current, current.media[0]].every(Object.isFrozen),
          hostGlobal: Function('return typeof process')(),
        });
      });
    `,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  const current = snapshot();
  try {
    assert.equal(sandbox.update(current), true);
    await flush();
    assert.equal(current.reads.title, 'Episode 4');
    assert.deepEqual(reports, [{ version: 2, title: 'Episode 4', page: current.page, media: current.media,
      mutationBlocked: true, inheritedRead: 'undefined', frozen: true, hostGlobal: 'undefined' }]);
    assert.notEqual(reports[0].page, current.page);
  } finally { sandbox.dispose(); }
});

test('async settings, storage, network, reporting, clear, and logging cross only the JSON broker', async () => {
  const calls = [];
  const errors = [];
  const sandbox = await createActivityV2Sandbox({
    source: `ChudPresence.onUpdate(async () => {
      const enabled = await ChudPresence.settings.get('enabled');
      const settings = await ChudPresence.settings.getAll();
      const count = await ChudPresence.storage.get('count');
      await ChudPresence.storage.set('count', count + 1);
      const removed = await ChudPresence.storage.remove('old');
      const cleared = await ChudPresence.storage.clear();
      const response = await ChudPresence.net.fetch('https://example.com/api/public', {responseType:'json'});
      await ChudPresence.log.info('public activity', response.status);
      await ChudPresence.report({enabled, settings, count, removed, cleared, response});
      await ChudPresence.clear();
    });`,
    request(operation, payload) {
      calls.push([operation, payload]);
      return ({ 'settings.get': { value: true }, 'settings.getAll': { value: { enabled: true } },
        'storage.get': { value: 7 }, 'storage.set': { value: 8 }, 'storage.remove': { value: true },
        'storage.clear': { value: 1 }, 'net.fetch': { status: 200, ok: true, contentType: 'application/json', data: { title: 'public title' } } })[operation] || {};
    },
    onError(error) { errors.push(error); },
  });
  try {
    sandbox.update(snapshot());
    await flush(); await flush();
    assert.deepEqual(errors, []);
    assert.deepEqual(calls.map(([operation]) => operation), ['settings.get', 'settings.getAll', 'storage.get', 'storage.set',
      'storage.remove', 'storage.clear', 'net.fetch', 'log.write', 'presence.report', 'presence.clear']);
    assert.deepEqual(calls[0][1], { id: 'enabled' });
    assert.deepEqual(calls[3][1], { key: 'count', value: 8 });
    assert.deepEqual(calls[7][1], { level: 'info', args: ['public activity', 200] });
    assert.deepEqual(calls[8][1].report, { enabled: true, settings: { enabled: true }, count: 7, removed: true,
      cleared: 1, response: { status: 200, ok: true, contentType: 'application/json', data: { title: 'public title' } } });
  } finally { sandbox.dispose(); }
});

test('guest constructor and JSON/prototype tampering cannot expose or replace the host bridge', async () => {
  const reports = [];
  const sandbox = await createActivityV2Sandbox({
    source: `
      const report = ChudPresence.report;
      JSON.parse = () => { throw new Error('tampered parser'); };
      JSON.stringify = () => 'forged';
      Set.prototype.values = () => { throw new Error('tampered listener iteration'); };
      Object.freeze = () => { throw new Error('tampered freeze'); };
      globalThis.__activityV2Bridge = () => 'forged';
      ChudPresence.onUpdate(current => report({title: current.reads.title, leak: report.constructor('return typeof process')()}));
    `,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  try { assert.equal(sandbox.update(snapshot()), true); await flush(); assert.deepEqual(reports, [{ title: 'Episode 4', leak: 'undefined' }]); }
  finally { sandbox.dispose(); }
});

test('startup and update infinite loops are interrupted and fail closed', async () => {
  await assert.rejects(createActivityV2Sandbox({ source: 'while (true) {}', request() {} }), /execution budget/);
  const errors = [];
  const sandbox = await createActivityV2Sandbox({
    source: 'ChudPresence.onUpdate(() => { while (true) {} });', request() {}, onError(error) { errors.push(error); },
  });
  assert.equal(sandbox.update(snapshot()), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /execution budget/);
  assert.equal(sandbox.update(snapshot()), false);
  sandbox.dispose();
});

test('promise microtask recursion has a bounded drain', async () => {
  await assert.rejects(createActivityV2Sandbox({
    source: 'function again() { Promise.resolve().then(again); } again();', request() {},
  }), /pending job|execution budget/);
});

test('promise continuations receive a new execution deadline and interrupt CPU loops', async () => {
  const response = deferred();
  const errors = [];
  const sandbox = await createActivityV2Sandbox({
    source: 'ChudPresence.storage.get("key").then(() => { while (true) {} });',
    request() { return response.promise; }, onError(error) { errors.push(error); },
  });
  response.resolve({ value: 1 });
  await flush();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /execution budget/);
  assert.equal(sandbox.update(snapshot()), false);
  sandbox.dispose();
});

test('heap allocation and recursive stack use are bounded and other sandboxes still work', async () => {
  await assert.rejects(createActivityV2Sandbox({
    source: 'const blocks = []; while (true) blocks.push(new Uint8Array(1024 * 1024));', request() {},
  }), /memory limit|execution budget/);
  await assert.rejects(createActivityV2Sandbox({ source: 'function recurse() { recurse(); } recurse();', request() {} }), /sandbox/);
  const sandbox = await createActivityV2Sandbox({ source: '', request() {} });
  assert.equal(sandbox.update(snapshot()), true);
  sandbox.dispose();
});

test('a native quota failure during deeply nested JSON parsing cannot poison another WASM instance', async () => {
  const reports = [];
  const healthy = await createActivityV2Sandbox({
    source: `ChudPresence.onUpdate(() => ChudPresence.report({healthy:true}));`,
    request(operation, payload) { if (operation === 'presence.report') reports.push(payload.report); return {}; },
  });
  const errors = [];
  try {
    await assert.rejects(createActivityV2Sandbox({
      source: `JSON.parse('['.repeat(1000000));`, request() {}, onError(error) { errors.push(error); },
    }), /sandbox/);
    assert.equal(errors.length, 1);
    assert.equal(healthy.update(snapshot()), true);
    await flush();
    assert.deepEqual(reports, [{ healthy: true }]);
  } finally { healthy.dispose(); }
});

test('outstanding RPCs are bounded and completions after disposal do not execute code', async () => {
  const response = deferred();
  const calls = [];
  const errors = [];
  const sandbox = await createActivityV2Sandbox({
    source: 'for (let i = 0; i < 60; ++i) ChudPresence.storage.get("key" + i).then(value => ChudPresence.report({ value }));',
    request(operation, payload) { calls.push([operation, payload]); return response.promise; },
    onError(error) { errors.push(error); },
  });
  await flush();
  assert.equal(calls.length, limits.pendingRequests);
  sandbox.dispose(); sandbox.dispose();
  response.resolve({ value: 'late' });
  await flush();
  assert.equal(calls.length, limits.pendingRequests);
  assert.deepEqual(errors, []);
  assert.equal(sandbox.update(snapshot()), false);
});

test('guest-created globals and update data cannot forge broker responses', async () => {
  const response = deferred();
  const reports = [];
  const sandbox = await createActivityV2Sandbox({
    source: `
      globalThis.__activityV2Deliver = () => ChudPresence.report({value:'forged'});
      globalThis.onmessage = () => ChudPresence.report({value:'forged'});
      ChudPresence.storage.get('key').then(value => ChudPresence.report({value}));
    `,
    request(operation, payload) { if (operation === 'storage.get') return response.promise; reports.push(payload.report); return {}; },
  });
  try {
    sandbox.update({ ...snapshot(), id: 1, data: { value: 'forged' } });
    await flush(); assert.deepEqual(reports, []);
    response.resolve({ value: 'real broker result' });
    await flush(); assert.deepEqual(reports, [{ value: 'real broker result' }]);
  } finally { sandbox.dispose(); }
});

test('broker JSON results are guest-owned frozen data and rejected broker errors do not leak host objects', async () => {
  const reports = [];
  const original = { value: { title: 'public' } };
  const sandbox = await createActivityV2Sandbox({
    source: `ChudPresence.storage.get('ok').then(async value => {
      let errorMessage;
      try { await ChudPresence.storage.get('fail'); } catch(error) { errorMessage = error.message; }
      await ChudPresence.report({ frozen: Object.isFrozen(value), value, errorMessage });
    });`,
    request(operation, payload) {
      if (operation === 'presence.report') { reports.push(payload.report); return {}; }
      if (payload.key === 'fail') throw new Error('Host credential secret must not cross');
      return original;
    },
  });
  try {
    await flush();
    assert.deepEqual(reports, [{ frozen: true, value: { title: 'public' }, errorMessage: 'Activity request was rejected by the broker.' }]);
    assert.notEqual(reports[0].value, original.value);
  } finally { sandbox.dispose(); }
});

test('oversized request and response JSON fail within the guest without crossing the broker', async () => {
  const calls = [];
  const sandbox = await createActivityV2Sandbox({
    source: `(async () => {
      let requestRejected = false, resultRejected = false;
      try { await ChudPresence.storage.set('large', 'x'.repeat(70000)); } catch { requestRejected = true; }
      try { await ChudPresence.storage.get('large'); } catch { resultRejected = true; }
      await ChudPresence.report({ requestRejected, resultRejected });
    })();`,
    request(operation, payload) { calls.push([operation, payload]); return { value: 'x'.repeat(limits.resultBytes) }; },
  });
  try {
    await flush();
    assert.deepEqual(calls.map(([operation]) => operation), ['storage.get', 'presence.report']);
    assert.deepEqual(calls[1][1], { report: { requestRejected: true, resultRejected: true } });
  } finally { sandbox.dispose(); }
});

test('oversized source and snapshots are rejected and update callbacks fail closed', async () => {
  await assert.rejects(createActivityV2Sandbox({ source: ' '.repeat(limits.sourceBytes + 1), request() {} }), /512 KB/);
  const errors = [];
  const sandbox = await createActivityV2Sandbox({ source: '', request() {}, onError(error) { errors.push(error); } });
  assert.equal(sandbox.update({ reads: { large: 'x'.repeat(limits.resultBytes) } }), false);
  assert.match(errors[0].message, /JSON exceeds/);
  const failed = await createActivityV2Sandbox({
    source: 'ChudPresence.onUpdate(async () => { throw new Error("guest error"); });', request() {}, onError(error) { errors.push(error); },
  });
  assert.equal(failed.update(snapshot()), false);
  assert.match(errors[1].message, /callback failed/);
  failed.dispose();
});

test('trusted bundle has no unresolved imports, native eval/Function compiler, or separate WASM resource', async () => {
  const bundle = await fs.readFile(new URL('../extension/core/activity-v2-engine.generated.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /\bimport\s*\(/);
  assert.doesNotMatch(bundle, /\beval\s*\(|\bnew\s+Function\s*\(/);
  assert.ok(bundle.length > 600000, 'WASM must be embedded in the single browser script');
  execFileSync(process.execPath, ['scripts/build-v2-engine.mjs', '--check'], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
});
