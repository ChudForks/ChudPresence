import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const hostSource = (await fs.readFile(new URL('../extension/core/activity-v2-host.js', import.meta.url), 'utf8'))
  .replace(/^import \{ browserApi \} from '[^']+';\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify('chrome-extension://test/core/activity-v2-host.js'));
const workerSource = (await fs.readFile(new URL('../extension/core/activity-v2-worker.js', import.meta.url), 'utf8'))
  .replace(/^import '\.\/activity-v2-engine\.generated\.js';\r?\n/m, '');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const snapshot = title => ({ page: {}, reads: { title }, media: [] });

function hostHarness() {
  const workers = [];
  const ports = [];
  const timers = new Map();
  let timerSequence = 0;
  class Worker {
    constructor(url, options) { this.url = String(url); this.options = options; this.messages = []; this.listeners = {}; this.terminated = false; workers.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(message) { this.listeners.message({ data: message }); }
  }
  const chrome = { runtime: { connect(options) {
    const port = { options, messages: [], onMessage: { addListener(fn) { port.receive = fn; } },
      onDisconnect: { addListener(fn) { port.disconnected = fn; } }, postMessage(message) { port.messages.push(message); }, disconnect() { port.disconnected(); } };
    ports.push(port); return port;
  } } };
  const context = { Worker, chrome, URL, TextEncoder, addEventListener() {},
    setTimeout(fn, ms) { const id = ++timerSequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(hostSource, context);
  return { workers, ports, timers, context, receive(message) { ports.at(-1).receive(message); },
    runTimers(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.delete(id)) timer.fn(); } };
}

test('offscreen host keeps source as data, coalesces updates, and terminates stopped workers', () => {
  const host = hostHarness();
  host.receive({ type: 'update', key: 'session', source: 'globalThis.executed = true;', snapshot: snapshot('first') });
  assert.equal(host.workers.length, 1);
  const worker = host.workers[0];
  assert.equal(host.context.executed, undefined);
  assert.equal(worker.url, 'chrome-extension://test/core/activity-v2-worker.js');
  assert.equal(worker.options.type, 'module');
  assert.equal(worker.messages[0].type, 'init');
  assert.equal(worker.messages[0].source, 'globalThis.executed = true;');
  host.receive({ type: 'update', key: 'session', snapshot: snapshot('second') });
  host.receive({ type: 'update', key: 'session', snapshot: snapshot('latest') });
  assert.equal(worker.messages.length, 1);
  worker.emit({ type: 'ready', key: 'session' });
  worker.emit({ type: 'updated', key: 'session', turnId: worker.messages[0].turnId });
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1].snapshot.reads.title, 'latest');
  assert.equal(Object.hasOwn(worker.messages[1], 'source'), false);
  host.receive({ type: 'stop', key: 'session' });
  assert.equal(worker.terminated, true);
  assert.equal(host.timers.size, 0);
});

test('startup watchdog terminates an unresponsive worker', () => {
  const host = hostHarness();
  host.receive({ type: 'update', key: 'hung', source: '', snapshot: snapshot('first') });
  host.runTimers(5000);
  assert.equal(host.workers[0].terminated, true);
  assert.match(host.ports[0].messages.at(-1).message, /execution deadline/);
});

test('every broker response resumes under a watchdog and a stale acknowledgement cannot clear a new update deadline', () => {
  const host = hostHarness();
  host.receive({ type: 'update', key: 'session', source: '', snapshot: snapshot('first') });
  const worker = host.workers[0];
  worker.emit({ type: 'updated', key: 'session', turnId: worker.messages[0].turnId });
  worker.emit({ type: 'request', key: 'session', requestId: 1, operation: 'settings.get', payload: { id: 'enabled' } });
  assert.equal(host.ports[0].messages.at(-1).type, 'request');
  host.receive({ type: 'response', key: 'session', requestId: 1, ok: true, data: { value: true } });
  const responseTurn = worker.messages.at(-1).turnId;
  assert.equal(worker.messages.at(-1).type, 'response');
  host.receive({ type: 'update', key: 'session', snapshot: snapshot('second') });
  const updateTurn = worker.messages.at(-1).turnId;
  assert.notEqual(responseTurn, updateTurn);
  worker.emit({ type: 'updated', key: 'session', turnId: responseTurn });
  assert.equal(worker.terminated, false);
  host.runTimers(2000);
  assert.equal(worker.terminated, true);
  assert.match(host.ports[0].messages.at(-1).message, /execution deadline/);
});

test('unknown and duplicate broker responses never reach a worker', () => {
  const host = hostHarness();
  host.receive({ type: 'update', key: 'session', source: '', snapshot: snapshot('first') });
  const worker = host.workers[0];
  host.receive({ type: 'response', key: 'session', requestId: 1, ok: true, data: 'forged' });
  assert.equal(worker.messages.length, 1);
  worker.emit({ type: 'request', key: 'session', requestId: 1, operation: 'storage.get', payload: { key: 'one' } });
  host.receive({ type: 'response', key: 'session', requestId: 1, ok: true, data: { value: 'real' } });
  host.receive({ type: 'response', key: 'session', requestId: 1, ok: true, data: 'duplicate' });
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1].data.value, 'real');
});

test('host enforces session, inactivity, source, and snapshot limits and disconnect cleanup', () => {
  const host = hostHarness();
  host.receive({ type: 'update', key: 'large-source', source: 'x'.repeat(512 * 1024 + 1), snapshot: snapshot('') });
  host.receive({ type: 'update', key: 'large-snapshot', source: '', snapshot: snapshot('x'.repeat(256 * 1024)) });
  assert.equal(host.workers.length, 0);
  for (let i = 0; i < 17; i++) host.receive({ type: 'update', key: String(i), source: '', snapshot: snapshot('') });
  assert.equal(host.workers.length, 16);
  assert.match(host.ports[0].messages.at(-1).message, /session limit/);
  host.runTimers(120000);
  assert.equal(host.workers.every(worker => worker.terminated), true);
  host.receive({ type: 'update', key: 'restart', source: '', snapshot: snapshot('') });
  const active = host.workers.at(-1);
  host.ports[0].disconnected();
  assert.equal(active.terminated, true);
  assert.equal([...host.timers.values()].every(timer => timer.ms === 250), true);
  host.runTimers(250);
  assert.equal(host.ports.length, 2);
});

function workerHarness() {
  const messages = [];
  const updates = [];
  const handlers = {};
  const timers = [];
  let options;
  let disposed = false;
  const context = {
    ChudPresenceV2Engine: { ACTIVITY_V2_SANDBOX_LIMITS: { pendingRequests: 16 },
      async createActivityV2Sandbox(value) { options = value; return { update(value) { updates.push(value); return true; }, dispose() { disposed = true; } }; } },
    addEventListener(type, fn) { handlers[type] = fn; }, postMessage(message) { messages.push(message); }, setTimeout(fn) { timers.push(fn); },
  };
  vm.runInNewContext(workerSource, context);
  return { messages, updates, timers, get options() { return options; }, get disposed() { return disposed; },
    receive(message) { handlers.message({ data: message }); } };
}

test('worker evaluates source only through the guest engine and acknowledges broker resumes after microtasks', async () => {
  const worker = workerHarness();
  worker.receive({ type: 'init', key: 'session', turnId: 1, source: 'guest source data', snapshot: snapshot('first') });
  await flush();
  assert.equal(worker.options.source, 'guest source data');
  assert.deepEqual(Object.keys(worker.options).sort(), ['onError', 'request', 'source']);
  assert.deepEqual(worker.messages.map(message => message.type), ['ready', 'updated']);
  assert.equal(worker.updates[0].reads.title, 'first');
  const result = worker.options.request('storage.get', { key: 'own' });
  const request = worker.messages.at(-1);
  assert.equal(request.type, 'request');
  worker.receive({ type: 'response', key: 'different', turnId: 2, requestId: request.requestId, ok: true, data: 'forged' });
  assert.equal(worker.timers.length, 0);
  worker.receive({ type: 'response', key: 'session', turnId: 2, requestId: request.requestId, ok: true, data: { value: 'own result' } });
  assert.equal((await result).value, 'own result');
  assert.equal(worker.messages.at(-1).type, 'request');
  worker.timers.shift()();
  assert.equal(worker.messages.at(-1).type, 'updated');
  assert.equal(worker.messages.at(-1).turnId, 2);
  worker.options.onError(new Error('credential details must not be forwarded'));
  assert.equal(worker.disposed, true);
  assert.equal(worker.messages.at(-1).type, 'error');
  assert.doesNotMatch(worker.messages.at(-1).message, /credential/);
});

test('page-only bundle contains no guest interpreter or WASM compiler', async () => {
  const source = await fs.readFile(new URL('../extension/core/activity-v2-page.generated.js', import.meta.url), 'utf8');
  assert.ok(source.length < 64 * 1024);
  assert.match(source, /ChudPresenceV2Page/);
  assert.doesNotMatch(source, /WebAssembly|quickjs|createActivityV2Sandbox/);
});
