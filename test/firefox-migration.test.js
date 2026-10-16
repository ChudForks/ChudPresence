import assert from 'node:assert/strict';
import test from 'node:test';
import { activityInstallCompleted, activityInstallDefaults, migratePlatformSettings } from '../ChudPresence-Firefox/extension/platform/migration.js';

function storageHarness(initial = {}, { failures = 0 } = {}) {
  const data = structuredClone(initial);
  const writes = [];
  let reads = 0;
  const api = { storage: { local: {
    async get(keys) {
      reads += 1;
      return structuredClone(keys === null ? data : Object.fromEntries([].concat(keys).map(key => [key, data[key]])));
    },
    async set(values) {
      if (failures-- > 0) throw new Error('Storage write failed');
      writes.push(structuredClone(values));
      Object.assign(data, structuredClone(values));
    },
  } } };
  return { api, data, writes, reads: () => reads };
}

test('Firefox migrates each obsolete provider to the canonical official Activity ID and preference contract', async () => {
  const fixture = storageHarness({
    enabled: false,
    showButtons: false,
    sourceYouTube: false, youtubeStatusDisplay: 'creator', youtubeShowPaused: false,
    sourceYouTubeMusic: true, youtubeMusicStatusDisplay: 'track', youtubeMusicShowArtwork: false,
    sourceCrunchyroll: false, crunchyrollStatusDisplay: 'episode', crunchyrollShowTimestamps: false,
    sourceMovies67: false, movies67StatusDisplay: 'series',
    sourceTwitch: true, twitchStatusDisplay: 'streamer',
    sourceKick: false, kickStatusDisplay: 'stream',
  });
  await migratePlatformSettings(fixture.api);
  const expected = {
    youtube: { enabled: false, preferences: { showPaused: false, showButtons: false, statusDisplay: 'artist' } },
    'youtube-music': { enabled: true, preferences: { showArtwork: false, showButtons: false, statusDisplay: 'track' } },
    crunchyroll: { enabled: false, preferences: { showTimestamps: false, showButtons: false, statusDisplay: 'track' } },
    '67movies': { enabled: false, preferences: { showButtons: false, statusDisplay: 'artist' } },
    twitch: { enabled: true, preferences: { showButtons: false, statusDisplay: 'artist' } },
    kick: { enabled: false, preferences: { showButtons: false, statusDisplay: 'track' } },
  };
  assert.deepEqual(fixture.data.firefoxLegacyActivityDefaults, expected);
  for (const [id, defaults] of Object.entries(expected)) {
    assert.deepEqual(await activityInstallDefaults(id, fixture.api), defaults);
  }
  assert.deepEqual(await activityInstallDefaults('unrelated-activity', fixture.api), {});
  assert.equal(fixture.data.enabled, false);
  assert.equal(fixture.writes.length, 1);
});

test('Firefox migration retains current Activity settings, authenticated sessions, and source packages', async () => {
  const initial = {
    sourceYouTube: false, youtubeShowPaused: false, youtubeShowArtwork: false,
    installedActivities: { youtube: { enabled: true, preferences: { showPaused: true },
      metadata: { id: 'youtube', version: '1.2.3' }, code: 'installed source', capability: 'a'.repeat(64) } },
    discordAuth: { accessToken: 'private-access', refreshToken: 'private-refresh' },
    discordAuthClientId: 'production-discord-client', discordHeadlessSession: 'private-session',
    defaultYouTubeActivityDecision: 'removed',
  };
  const fixture = storageHarness(initial);
  await migratePlatformSettings(fixture.api);
  assert.deepEqual(fixture.data.installedActivities.youtube, {
    ...initial.installedActivities.youtube, preferences: { showPaused: true, showArtwork: false },
  });
  for (const key of ['discordAuth', 'discordAuthClientId', 'discordHeadlessSession', 'defaultYouTubeActivityDecision']) {
    assert.deepEqual(fixture.data[key], initial[key]);
  }
  assert.doesNotMatch(JSON.stringify(fixture.writes), /private-access|private-refresh|private-session/);
  fixture.data.sourceYouTube = true;
  await migratePlatformSettings(fixture.api);
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual(await activityInstallDefaults('youtube', fixture.api), {});
});

test('migration coalesces background and manager initialization and retries a failed storage write', async () => {
  const fixture = storageHarness({ sourceYouTube: false }, { failures: 1 });
  const first = migratePlatformSettings(fixture.api);
  assert.equal(migratePlatformSettings(fixture.api), first);
  await assert.rejects(first, /Storage write failed/);
  assert.equal(fixture.data.firefoxSettingsMigrationVersion, undefined);
  await Promise.all([migratePlatformSettings(fixture.api), migratePlatformSettings(fixture.api)]);
  assert.equal(fixture.reads(), 2);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.data.firefoxSettingsMigrationVersion, 1);
});

test('a stored migration marker prevents replaying obsolete settings after a background restart', async () => {
  const fixture = storageHarness({ firefoxSettingsMigrationVersion: 1,
    firefoxLegacyActivityDefaults: { youtube: { enabled: true, preferences: {} } }, sourceYouTube: false });
  await migratePlatformSettings(fixture.api);
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(await activityInstallDefaults('youtube', fixture.api), { enabled: true, preferences: {} });
});

test('legacy defaults survive until a successful install and are consumed only for that Activity', async () => {
  const fixture = storageHarness({ sourceYouTube: false, sourceKick: false });
  assert.equal((await activityInstallDefaults('youtube', fixture.api)).enabled, false);
  assert.equal((await activityInstallDefaults('youtube', fixture.api)).enabled, false);
  await activityInstallCompleted('youtube', fixture.api);
  assert.deepEqual(await activityInstallDefaults('youtube', fixture.api), {});
  assert.equal((await activityInstallDefaults('kick', fixture.api)).enabled, false);
  const writes = fixture.writes.length;
  await activityInstallCompleted('youtube', fixture.api);
  assert.equal(fixture.writes.length, writes);
});
