import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateActivityV2, validateV2Metadata, validateV2Report, describeActivityV2, INSTAGRAM_FIELDS, INSTAGRAM_LOGO_URL } from '../extension/core/activity-api-v2.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';

const configuration = () => ({ schemaVersion: 1, kind: 'video', scope: '.x5lhr3w',
  fields: structuredClone(INSTAGRAM_FIELDS), player: { adapter: 'instagram', selectors: ['video', 'img'] } });
const report = (story = false) => ({ kind: 'video',
  media: { title: story ? 'Watching Story' : 'A great reel #hello', creator: 'example.creator', channel: '@example.creator', subtitle: story ? 'Story' : 'Reel' },
  playback: { state: 'playing', position: 12, duration: 60, live: false, rate: 1 },
  buttons: [{ label: story ? 'View Story' : 'View Reel', url: story ? 'https://www.instagram.com/stories/example.creator/123456789/' : 'https://www.instagram.com/reel/Example_123-/' },
    { label: 'View Profile', url: 'https://www.instagram.com/example.creator/' }] });

test('Instagram V2 has a fixed reviewed declaration and cannot widen selector access', () => {
  assert.deepEqual(validateActivityV2(JSON.stringify(configuration())), configuration());
  for (const change of [
    (c) => { c.fields.title.selectors = ['.private']; }, (c) => { c.fields.creator.removePrefix = 'x'; },
    (c) => { c.scope = '#messages'; }, (c) => { c.kind = 'generic'; }, (c) => { c.player.selectors = ['audio']; },
    (c) => { c.player.metadata = 'prime-video-details'; },
  ]) { const c = configuration(); change(c); assert.throws(() => validateActivityV2(JSON.stringify(c)), /fixed reel\/story/); }
  const generic = configuration(); generic.player.adapter = 'html-media';
  assert.throws(() => validateActivityV2(JSON.stringify(generic)), /unsupported or sensitive selector/);
  const review = describeActivityV2({ matches: ['https://www.instagram.com/*'] }, JSON.stringify(configuration()));
  assert.match(review, /photo stories.*no fabricated progress timer/);
  assert.match(review, /always the static Instagram app logo/);
  assert.match(review, /reply text, messages/);
});

test('Instagram reports cannot inject previews, private fields, display overrides or unrelated links', () => {
  const r = report();
  for (const changed of [
    { ...r, artwork: { large: 'https://example.com/thumbnail.jpg' } }, { ...r, display: { details: 'Override' } },
    { ...r, kind: 'stream' }, { ...r, media: { ...r.media, channel: '@invalid/handle' } },
    { ...r, media: { ...r.media, creator: 'other.creator' } }, { ...r, media: { ...r.media, subtitle: 'Messages' } },
    { ...r, media: { ...r.media, private: 'PRIVATE' } }, { ...r, playback: { ...r.playback, live: true } },
    ...['https://outside.example/private', 'https://www.instagram.com/reel/Example/?secret=value',
      'https://www.instagram.com/reel/Example/#private', 'https://user:password@www.instagram.com/reel/Example/',
      'https://www.instagram.com:8443/reel/Example/', 'https://www.instagram.com.evil.example/reel/Example/'].map(url => ({ ...r, buttons: [{ label: 'View Reel', url }] })),
    { ...r, buttons: [r.buttons[1], r.buttons[1]] },
  ]) assert.throws(() => validateV2Report(changed, configuration()));
  const s = report(true);
  assert.equal(validateV2Report(s, configuration()), s);
  assert.throws(() => validateV2Report({ ...s, buttons: [{ label: 'View Story', url: 'https://www.instagram.com/stories/other.creator/123/' }] }, configuration()));
  assert.throws(() => validateV2Report({ ...s, media: { ...s.media, title: 'Private reply' } }, configuration()));
  assert.throws(() => validateV2Report({ ...s, buttons: r.buttons }, configuration()));
});

test('Instagram reels and stories always use the app logo and normal presence preferences', () => {
  for (const story of [false, true]) {
    const r = report(story);
    const normalized = normalizeActivityReport(r, 2, configuration());
    const presence = createPresenceIntent({ ...normalized, activityName: 'Instagram' }, 100000);
    assert.equal(presence.details, r.media.title);
    assert.equal(presence.state, '@example.creator');
    assert.equal(presence.assets.largeImage, INSTAGRAM_LOGO_URL);
    assert.equal(presence.assets.largeText, 'Instagram');
    assert.deepEqual(presence.timestamps, { start: 88, end: 148 });
    assert.deepEqual(presence.buttons, r.buttons);
    assert.equal(createPresenceIntent(normalized, 100000, { statusDisplay: 'artist' }).statusDisplayType, 'state');
    assert.equal(createPresenceIntent(normalized, 100000, { statusDisplay: 'track' }).statusDisplayType, 'details');
    const hidden = createPresenceIntent(normalized, 100000, { showArtwork: false, showButtons: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.deepEqual(hidden.buttons, []); assert.equal(hidden.timestamps, null);
    r.playback.state = 'paused';
    assert.equal(createPresenceIntent(normalizeActivityReport(r, 2, configuration())).timestamps, null);
  }
  const photo = report(true); photo.playback.position = 0; photo.playback.duration = 0;
  assert.equal(createPresenceIntent(normalizeActivityReport(photo, 2, configuration())).timestamps, null);
});

test('Instagram package uses reusable V2 reels declarations and keeps its validated square PNG', async () => {
  const directory = new URL('../ChudPresence-Activities-V2/activities/instagram/', import.meta.url);
  let source;
  try { source = await fs.readFile(new URL('activity.json', directory), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const config = validateActivityV2(source);
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.player.adapter, 'html-media');
  assert.equal(config.presentation.artwork.large, INSTAGRAM_LOGO_URL);
  assert.ok(config.modes.every(mode => mode.player.adapter === 'html-media'));
  const metadata = validateV2Metadata(JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8')));
  assert.equal(metadata.apiVersion, 2); assert.equal(metadata.entry, 'activity.json'); assert.equal(metadata.icon, 'icon.png');
  assert.equal(metadata.version, '1.1.0'); assert.equal(metadata.minExtensionVersion, '2.3.0');
  await assert.rejects(fs.access(new URL('activity.js', directory)));
  const icon = await fs.readFile(new URL('icon.png', directory));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 512); assert.equal(icon.readUInt32BE(20), 512); assert.ok(icon.length < 262144);
});
