import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceClearDelay } from '../extension/core/presence-clear-delay.js';

test('deferred clear is canceled when presence returns', () => {
  const timers = new Map();
  let nextId = 0;
  let clears = 0;
  const delay = createPresenceClearDelay(() => { clears += 1; }, {
    delayMs: 1500,
    schedule(callback, ms) {
      assert.equal(ms, 1500);
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    cancel(id) { timers.delete(id); },
  });

  delay.defer();
  delay.defer();
  assert.equal(timers.size, 1);
  delay.cancel();
  assert.equal(timers.size, 0);
  assert.equal(clears, 0);

  delay.defer();
  const [id, callback] = [...timers][0];
  timers.delete(id);
  callback();
  assert.equal(clears, 1);
  delay.defer();
  assert.equal(timers.size, 1);
});
