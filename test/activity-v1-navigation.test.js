import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { validateActivityMetadata } from '../extension/core/activity-validator.js';

async function runtime({ optIn = true, isTop = true } = {}) {
  let script;
  const manager = new ActivityManager({ api: {
    storage: { local: { async get() { return {}; }, async set() {} } },
    permissions: { async contains() { return true; } },
    runtime: { getManifest: () => ({ version: '2.0.4' }) },
    userScripts: { async getScripts() { return []; }, async configureWorld() {}, async execute() { return []; },
      async register(scripts) { script = scripts[0].js[0].code; } },
  } });
  await manager.register({
    metadata: validateActivityMetadata({ id: 'navigation-v1', name: 'Navigation', description: 'V1 navigation fixture',
      version: '1.0.0', apiVersion: 1, entry: 'activity.js', frames: 'all', matches: ['https://example.com/*'],
      excludeMatches: ['https://example.com/private*'], ...(optIn ? { presence: { navigationGraceMs: 4000 } } : {}) }),
    capability: 'a'.repeat(64),
    code: `globalThis.starts = (globalThis.starts || 0) + 1; globalThis.api = ChudPresence;
      ChudPresence.lifecycle.onCleanup(() => { void ChudPresence.clear(); });`,
  });
  const events = new Map(), navigation = new Map(), requests = [];
  const window = {
    location: { href: 'https://example.com/home' },
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    navigation: {
      addEventListener(name, callback) { if (!navigation.has(name)) navigation.set(name, new Set()); navigation.get(name).add(callback); },
      removeEventListener(name, callback) { navigation.get(name)?.delete(callback); },
    },
    setTimeout: () => 1, setInterval: () => 2, clearTimeout() {}, clearInterval() {},
  };
  window.top = isTop ? window : {};
  const context = vm.createContext({ window, location: window.location, URL, AbortController,
    document: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    chrome: { runtime: { async sendMessage(request) { requests.push(request); return { ok: true, data: {} }; },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }) } } });
  const run = () => vm.runInContext(script, context);
  run();
  return { window, requests, run, navigation,
    navigate(event) { for (const callback of [...navigation.get('navigate') || []]) callback(event); },
    event(name, event = {}) { for (const callback of [...events.get(name) || []]) callback(event); },
    error() { for (const callback of [...navigation.get('navigateerror') || []]) callback(); },
  };
}

test('V1 sends a closing navigation hint only for an opted-in valid top-document transition', async () => {
  for (const options of [{}, { optIn: false }, { isTop: false }, { outside: true }, { excluded: true },
    { sameDocument: true }, { abort: true }, { error: true }, { prevented: true }, { noNavigation: true }]) {
    const fixture = await runtime(options);
    const signal = { aborted: false };
    if (!options.noNavigation) fixture.navigate({ signal, defaultPrevented: Boolean(options.prevented),
      destination: { url: options.outside ? 'https://outside.example/' : options.excluded
        ? 'https://example.com/private' : 'https://example.com/search', sameDocument: Boolean(options.sameDocument) } });
    if (options.abort) signal.aborted = true;
    if (options.error) fixture.error();
    fixture.event('beforeunload');
    const closing = fixture.requests.find(request => request.payload.closing);
    assert.ok(closing);
    assert.equal(Boolean(closing.payload.navigationUrl), Object.keys(options).length === 0, JSON.stringify(options));
    assert.equal(fixture.window.api.lifecycle.signal.aborted, true);
    assert.ok([...fixture.navigation.values()].every(listeners => listeners.size === 0));
  }
});

test('V1 navigation prevents premature focus clears, reinjection and duplicate exit clears but restores from bfcache', async () => {
  const fixture = await runtime();
  fixture.navigate({ destination: { url: 'https://example.com/search', sameDocument: false }, signal: { aborted: false } });
  const skipped = await fixture.window.api.clear();
  assert.equal(skipped.data.cleared, false);
  assert.equal(fixture.requests.length, 0);
  fixture.event('beforeunload');
  fixture.event('pagehide');
  assert.equal(fixture.requests.filter(request => request.payload.closing).length, 1);
  const count = fixture.requests.length;
  fixture.run();
  assert.equal(fixture.window.starts, 1);
  assert.equal(fixture.requests.length, count);
  fixture.event('pageshow', { persisted: true });
  assert.equal(fixture.window.starts, 2);
  assert.equal(fixture.window.api.lifecycle.signal.aborted, false);
  await fixture.window.api.clear();
  assert.equal(fixture.requests.length, count + 1);
  assert.equal(fixture.requests.at(-1).payload.closing, undefined);
});

test('an aborted V1 navigation restores ordinary clears without waiting for document exit', async () => {
  const fixture = await runtime();
  const signal = { aborted: false };
  fixture.navigate({ destination: { url: 'https://example.com/search', sameDocument: false }, signal });
  await fixture.window.api.clear();
  signal.aborted = true;
  await fixture.window.api.clear();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].payload.closing, undefined);
});
