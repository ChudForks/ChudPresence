import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateActivityMetadata, validateActivitySource } from '../extension/core/activity-validator.js';
await import('../extension/core/activity-v2-engine.generated.js');

test('v2 contract adds independent metadata while preserving the exact v1 report schema', async () => {
  const read = async path => JSON.parse(await fs.readFile(new URL(path, import.meta.url), 'utf8'));
  const [v1, v2, metadata] = await Promise.all([
    read('../schemas/activity-api-v1.json'), read('../schemas/activity-api-v2.json'), read('../schemas/activity-v2.schema.json'),
  ]);
  assert.equal(v1.apiVersion, 1);
  assert.equal(v2.apiVersion, 2);
  assert.deepEqual(v2.reportSchema, v1.reportSchema);
  assert.deepEqual(v2.metadataSchema, metadata);
  assert.equal(metadata.properties.apiVersion.const, 2);
  assert.equal(v1.metadataSchema.properties.pageAccess, undefined);
  for (const [key, value] of Object.entries(globalThis.ChudPresenceV2Engine.ACTIVITY_V2_SANDBOX_LIMITS)) {
    assert.equal(v2.limits[key], value, `V2 contract limit ${key} differs from the actual sandbox`);
  }
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
