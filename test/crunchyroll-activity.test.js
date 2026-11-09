import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { presenceDetailsForTrack } from '../extension/core/settings.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';

test('V1 Crunchyroll picker labels select the matching Discord status in both display orders', async t => {
  let metadata;
  let source;
  try {
    const directory = new URL('../ChudPresence-Activities/activities/crunchyroll/', import.meta.url);
    metadata = JSON.parse(await readFile(new URL('metadata.json', directory), 'utf8'));
    source = await readFile(new URL('activity.js', directory), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('The optional V1 Activities checkout is unavailable.');
    return;
  }

  const episode = { '@type': 'TVEpisode', name: 'The Adventure Begins', episodeNumber: 3,
    partOfSeries: { name: 'Example Series' }, partOfSeason: { seasonNumber: 1 } };
  const reports = [];
  let onSettingsChange;
  let now = 2000;
  const document = {
    title: 'Example Series Episode 3 - The Adventure Begins | Crunchyroll',
    documentElement: {},
    querySelector() { return null; },
    querySelectorAll(selector) {
      return selector === 'script[type="application/ld+json"]' ? [{ textContent: JSON.stringify(episode) }] : [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  vm.runInNewContext(source, {
    document, location: new URL('https://www.crunchyroll.com/watch/ABC123'), URL,
    navigator: { mediaSession: { playbackState: 'playing' } },
    Date: class extends Date { static now() { return now; } },
    MutationObserver: class { observe() {} disconnect() {} },
    ChudPresence: {
      report(report) { reports.push(structuredClone(report)); return Promise.resolve(); },
      clear() { return Promise.resolve(); },
      media: { find() { return null; }, snapshot() { return null; }, onChange() {} },
      dom: { observe() {} }, navigation: { onChange() {} },
      lifecycle: { signal: { aborted: false }, interval() {}, onCleanup() {} },
      settings: {
        getAll() { return Promise.resolve({}); },
        onChange(callback) { onSettingsChange = callback; },
      },
    },
  });
  await Promise.resolve();

  for (const [displayOrder, episodeStatus] of [
    ['series', 'Season 1, Episode 3'], ['episode', 'The Adventure Begins'], ['series', 'Season 1, Episode 3'],
  ]) {
    now += 2000;
    onSettingsChange({ settings: { displayOrder } });
    const track = { ...normalizeActivityReport(reports.at(-1), metadata.apiVersion),
      activityId: metadata.id, activityName: metadata.name };
    for (const [label, expected] of [['Crunchyroll', 'Crunchyroll'], ['Series', 'Example Series'], ['Episode', episodeStatus]]) {
      const statusDisplay = Object.entries(metadata.settingsUi.statusLabels).find(([, text]) => text === label)?.[0];
      assert.ok(statusDisplay, `Missing picker label ${label}`);
      const preferences = { statusDisplay };
      const intent = createPresenceIntent(track, now, presenceDetailsForTrack(track, undefined, preferences));
      const activity = buildHeadlessActivity(intent, '123456789012345678');
      const field = { 0: 'name', 1: 'state', 2: 'details' }[activity.status_display_type];
      assert.equal(activity[field], expected, `${label} with ${displayOrder}-first display`);
      assert.deepEqual(preferences, { statusDisplay });
    }
  }
});
