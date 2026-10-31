import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceSession } from '../extension/core/presence.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';
import { desktopIntent } from '../extension/link/publisher.js';

const appTime = { showTimestamps: false };
function report(apiVersion = 2, kind = 'video', playback = {}, title = 'First item') {
  return { ...normalizeActivityReport({
    kind, media: { title, artist: 'Artist' },
    playback: { state: 'playing', position: 60, duration: 180, ...playback },
  }, apiVersion), activityId: 'media-app', activityName: 'Media App' };
}

const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
function sessionStorage(data = {}) {
  return {
    async get() { return structuredClone(data); },
    async set(values) { Object.assign(data, structuredClone(values)); },
  };
}

test('progress off keeps one app timer across V1/V2 songs, videos, seeks, pauses, and mode changes', () => {
  for (const apiVersion of [1, 2]) {
    for (const kind of ['song', 'video']) {
      const session = createPresenceSession();
      const first = session.createIntent(report(apiVersion, kind), 1_000_000, appTime);
      assert.deepEqual(first.timestamps, { start: 1000 });
      const updates = [
        report(apiVersion, kind, { position: 170, rate: 2 }),
        report(apiVersion, kind, { position: 0, duration: 300 }, 'Next item'),
        report(apiVersion, kind, { state: 'paused', position: 10 }, 'Next item'),
        report(apiVersion, kind, { state: 'paused', position: 10 }, 'Next item'),
        report(apiVersion, kind, { position: 10 }, 'Next item'),
        report(apiVersion, 'stream', { live: true, position: 0, duration: 0 }),
        report(apiVersion, 'generic', { ...(apiVersion === 2 ? { elapsed: true } : {}), position: 1, duration: 0 }),
      ];
      for (const [index, track] of updates.entries()) {
        const intent = session.createIntent(track, 1_100_000 + index * 10_000, appTime);
        assert.deepEqual(intent.timestamps, first.timestamps);
        assert.deepEqual(buildHeadlessActivity(intent, '123456789012345678').timestamps, { start: 1_000_000 });
        assert.deepEqual(desktopIntent(intent).timestamps, { start: 1000 });
      }
    }
  }
});

test('changing the progress preference preserves app time and the existing playback/paused timers', () => {
  const session = createPresenceSession();
  const playing = report();
  assert.deepEqual(session.createIntent(playing, 1_000_000).timestamps, { start: 940, end: 1120 });
  assert.deepEqual(session.createIntent(playing, 1_100_000, appTime).timestamps, { start: 1000 });
  const paused = report(2, 'video', { state: 'paused', position: 70 });
  assert.deepEqual(session.createIntent(paused, 1_200_000, appTime).timestamps, { start: 1000 });
  assert.equal(session.createIntent(paused, 1_300_000, { showTimestamps: true }).timestamps, null);
  assert.deepEqual(session.createIntent(playing, 1_400_000, { showTimestamps: true }).timestamps, { start: 1340, end: 1520 });
  assert.deepEqual(session.createIntent(paused, 1_500_000, appTime).timestamps, { start: 1000 });
});

test('app time resets on a different Activity or a committed clear, while transient empty reports retain it', () => {
  const session = createPresenceSession();
  const track = report();
  session.createIntent(track, 1_000_000, appTime);
  assert.equal(session.createIntent(null, 1_050_000, appTime), null);
  assert.equal(session.createIntent({ ...track, visibility: 'ad' }, 1_060_000, appTime), null);
  assert.deepEqual(session.createIntent({ ...track, activityName: 'New display name' }, 1_100_000, appTime).timestamps, { start: 1000 });
  const other = { ...track, activityId: 'other-app' };
  assert.deepEqual(session.createIntent(other, 1_200_000, appTime).timestamps, { start: 1200 });
  assert.deepEqual(session.createIntent(track, 1_300_000, appTime).timestamps, { start: 1300 });
  session.clear();
  assert.deepEqual(session.createIntent(track, 1_400_000, appTime).timestamps, { start: 1400 });
});

test('app start time survives a worker wake and a cleared session cannot revive it', async () => {
  const data = {};
  const storage = sessionStorage(data);
  const original = createPresenceSession({ storage, now: () => 1_000_000 });
  await original.initialize();
  original.createIntent(report(), 1_000_000);
  await flush();
  const resumed = createPresenceSession({ storage, now: () => 1_200_000 });
  await resumed.initialize();
  assert.deepEqual(resumed.createIntent(report(2, 'video', { state: 'paused' }, 'Next video'), 1_200_000, appTime).timestamps, { start: 1000 });
  resumed.clear();
  await flush();
  const afterClear = createPresenceSession({ storage, now: () => 1_300_000 });
  await afterClear.initialize();
  assert.deepEqual(afterClear.createIntent(report(), 1_300_000, appTime).timestamps, { start: 1300 });
});

test('ordered session writes cannot restore an old start after a clear', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const data = {};
  const storage = sessionStorage(data);
  let writes = 0;
  const session = createPresenceSession({ storage: {
    get: storage.get,
    async set(values) { if (++writes === 1) await gate; await storage.set(values); },
  } });
  await session.initialize();
  session.createIntent(report(), 1_000_000, appTime);
  session.clear();
  await flush();
  assert.equal(writes, 1);
  release();
  await flush();
  const resumed = createPresenceSession({ storage, now: () => 1_200_000 });
  await resumed.initialize();
  assert.deepEqual(resumed.createIntent(report(), 1_200_000, appTime).timestamps, { start: 1200 });
});

test('invalid saved starts and clock rollback cannot produce a future or unsafe app timer', async () => {
  for (const start of [-1, NaN, Infinity, '900', Number.MAX_SAFE_INTEGER, 1500]) {
    const storage = sessionStorage({ presenceAppSession: { source: 'media-app', start } });
    const session = createPresenceSession({ storage, now: () => 1_000_000 });
    await session.initialize();
    assert.deepEqual(session.createIntent(report(), 1_000_000, appTime).timestamps, { start: 1000 });
  }
});
