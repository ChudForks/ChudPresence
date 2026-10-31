import assert from 'node:assert/strict';
import test from 'node:test';
import { createLinkEvents } from '../extension/link/events.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function timers() {
  const pending = new Map();
  let next = 0;
  return { pending, schedule(callback, delay) { const id = ++next; pending.set(id, { callback, delay }); return id; },
    cancel(id) { pending.delete(id); },
    async run(delay) {
      const entry = [...pending].find(([, value]) => value.delay === delay);
      assert.ok(entry, `Missing ${delay}ms timer`);
      pending.delete(entry[0]); entry[1].callback(); await flush();
    } };
}

test('SSE handles split UTF-8, CRLF, multiline data and heartbeats without a short request timeout', async () => {
  const clock = timers(); const seen = []; const errors = [];
  let stream; let abort;
  const events = createLinkEvents({ ...clock,
    async open(controller) {
      abort = controller;
      return new Response(new ReadableStream({ start(value) {
        stream = value;
        controller.signal.addEventListener('abort', () => value.error(new Error('aborted')), { once: true });
      } }));
    },
    onRevision: (event, data) => seen.push({ event, data }), onError: error => errors.push(error),
  });
  await events.start();
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: revision\r\ndata: café\r\ndata: next\r\n\r\n');
  for (const byte of bytes) stream.enqueue(new Uint8Array([byte]));
  await flush();
  assert.deepEqual(seen, [{ event: 'revision', data: 'café\nnext' }]);
  assert.ok([...clock.pending.values()].every(timer => timer.delay > 120_000));
  assert.equal(abort.signal.aborted, false);
  events.stop(); await flush();
  assert.equal(abort.signal.aborted, true);
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(errors, []);
});

test('SSE reconnects with backoff and stopping cancels scheduled reconnects', async () => {
  const clock = timers(); let opens = 0;
  const events = createLinkEvents({ ...clock, async open() { opens++; throw new Error('offline'); },
    onRevision() {}, onError() {} });
  await events.start();
  assert.equal(opens, 1);
  await clock.run(1000); assert.equal(opens, 2);
  await clock.run(2000); assert.equal(opens, 3);
  assert.ok([...clock.pending.values()].some(timer => timer.delay === 4000));
  events.stop(); assert.equal(clock.pending.size, 0);
});

test('SSE idle timeout cancels the read and an authorization failure stops reconnection', async () => {
  const clock = timers(); let opens = 0; let controller;
  const events = createLinkEvents({ ...clock, async open(abort) {
    opens++; controller = abort;
    return new Response(new ReadableStream({ start(stream) {
      abort.signal.addEventListener('abort', () => stream.error(new Error('idle')), { once: true });
    } }));
  }, onRevision() {}, onError() { return false; } });
  await events.start(); await clock.run(150_000);
  assert.equal(controller.signal.aborted, true);
  assert.equal(clock.pending.size, 0);
  assert.equal(opens, 1);
});
