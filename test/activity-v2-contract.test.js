import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { normalizeActivityReport, validateActivityMetadata, validateActivitySource } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';
await import('../extension/core/activity-v2-engine.generated.js');

test('v2 contract adds metadata and page presentation without changing v1 fields', async () => {
  const read = async path => JSON.parse(await fs.readFile(new URL(path, import.meta.url), 'utf8'));
  const [v1, v2, metadata] = await Promise.all([
    read('../schemas/activity-api-v1.json'), read('../schemas/activity-api-v2.json'), read('../schemas/activity-v2.schema.json'),
  ]);
  assert.equal(v1.apiVersion, 1);
  assert.equal(v2.apiVersion, 2);
  const report = structuredClone(v2.reportSchema);
  delete report.properties.display.properties.name;
  delete report.properties.playback.properties.elapsed;
  delete report.allOf;
  report.$id = v1.reportSchema.$id;
  report.title = v1.reportSchema.title;
  assert.deepEqual(report, v1.reportSchema);
  assert.deepEqual(v2.reportSchema, await read('../schemas/activity-v2-report.schema.json'));
  assert.deepEqual(v2.metadataSchema, metadata);
  assert.equal(metadata.properties.apiVersion.const, 2);
  assert.equal(v1.metadataSchema.properties.pageAccess, undefined);
  for (const [key, value] of Object.entries(globalThis.ChudPresenceV2Engine.ACTIVITY_V2_SANDBOX_LIMITS)) {
    assert.equal(v2.limits[key], value, `V2 contract limit ${key} differs from the actual sandbox`);
  }
});

test('V2 guests can report shared display controls through normalization and Discord formatting', async () => {
  const activities = [];
  const errors = [];
  const sandbox = await globalThis.ChudPresenceV2Engine.createActivityV2Sandbox({
    source: `ChudPresence.onUpdate(async () => {
      await ChudPresence.report({
        kind: 'generic', media: { title: 'Browsing Example' },
        display: { name: 'Example', details: 'Browsing Example', statusDisplayOverride: 'name', hideState: true }
      });
    });`,
    async request(operation, payload) {
      assert.equal(operation, 'presence.report');
      const report = normalizeActivityReport(payload.report, 2);
      const intent = createPresenceIntent({ ...report, activityId: 'example', activityName: 'Example' }, 100_000, { statusDisplay: 'track' });
      activities.push(buildHeadlessActivity(intent, '1549066134706323548'));
      return { accepted: true };
    },
    onError(error) { errors.push(error); },
  });
  try {
    sandbox.update({ page: {}, reads: {}, media: [] });
    for (let i = 0; i < 24; i++) await Promise.resolve();
    assert.deepEqual(errors, []);
    assert.equal(activities.length, 1);
    assert.equal(activities[0].name, 'Example');
    assert.equal(activities[0].details, 'Browsing Example');
    assert.equal(activities[0].status_display_type, 0);
    assert.equal(Object.hasOwn(activities[0], 'state'), false);
  } finally { sandbox.dispose(); }
});

test('the documented v2 example runs against the actual guest API and v1 report format', async () => {
  const metadata = validateActivityMetadata(JSON.parse(await fs.readFile(new URL('../examples/v2/html-media/metadata.json', import.meta.url), 'utf8')));
  assert.equal(metadata.apiVersion, 2);
  const source = validateActivitySource(await fs.readFile(new URL('../examples/v2/html-media/activity.js', import.meta.url), 'utf8'));
  const calls = [];
  const failures = [];
  const sandbox = await globalThis.ChudPresenceV2Engine.createActivityV2Sandbox({
    source, async request(operation, payload) { calls.push({ operation, payload }); return { accepted: true }; },
    onError(error) { failures.push(error); },
  });
  try {
    sandbox.update({ page: { origin: 'https://example.com', pathname: '/watch' },
      reads: { title: 'Public episode', artwork: 'https://example.com/artwork.png' },
      media: [{ visible: true, ended: false, paused: false, currentTime: 12, duration: 90, playbackRate: 1 }] });
    for (let index = 0; index < 24; index++) await Promise.resolve();
    assert.deepEqual(failures, []);
    assert.equal(calls[0].operation, 'presence.report');
    assert.equal(calls[0].payload.report.media.title, 'Public episode');
    assert.equal(calls[0].payload.report.playback.position, 12);
  } finally { sandbox.dispose(); }
});
