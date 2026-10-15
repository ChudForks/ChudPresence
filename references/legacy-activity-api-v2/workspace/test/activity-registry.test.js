import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityRegistry } from '../extension/core/activity-registry.js';
import { isTrackAllowed } from '../extension/core/settings.js';

test('accepts a new document immediately after same-tab navigation', () => {
  const registry = new ActivityRegistry();

  registry.update(7, 'twitch-document', { source: 'twitch', title: 'Stream' });
  assert.equal(registry.clearDocument(7, 'twitch-document'), true);

  registry.update(7, 'youtube-document', { source: 'youtube', title: 'Video' });
  assert.deepEqual(registry.tracks().get(7), { source: 'youtube', title: 'Video' });
});

test('late unload from the previous document cannot clear the new activity', () => {
  const registry = new ActivityRegistry();

  registry.update(7, 'twitch-document', { source: 'twitch', title: 'Stream' });
  registry.update(7, 'youtube-document', { source: 'youtube', title: 'Video' });

  assert.equal(registry.clearDocument(7, 'twitch-document'), false);
  assert.deepEqual(registry.tracks().get(7), { source: 'youtube', title: 'Video' });
});

test('keeps reports per frame and restores another frame when the current frame clears', () => {
  const registry = new ActivityRegistry();
  const parent = { source: 'activity', activityId: 'sample', title: 'Parent page' };
  const player = { source: 'activity', activityId: 'sample', title: 'Embedded player' };

  registry.update(7, 'top-document', parent, 0);
  registry.update(7, 'player-document', player, 3);
  assert.deepEqual(registry.tracks().get(7), player);
  assert.equal(registry.clearActivity('sample', 7, 'player-document', 3), true);
  assert.deepEqual(registry.tracks().get(7), parent);
});

test('a late iframe clear cannot remove a replacement document in that frame', () => {
  const registry = new ActivityRegistry();
  const oldPlayer = { source: 'activity', activityId: 'sample', title: 'Old player' };
  const newPlayer = { source: 'activity', activityId: 'sample', title: 'New player' };

  registry.update(7, 'old-player-document', oldPlayer, 3);
  registry.update(7, 'new-player-document', newPlayer, 3);
  assert.equal(registry.clearActivity('sample', 7, 'old-player-document', 3), false);
  assert.deepEqual(registry.tracks().get(7), newPlayer);
});

test('keeps a playing iframe eligible when another frame reports idle, ads, or paused media', () => {
  const registry = new ActivityRegistry();
  const player = {
    source: 'activity', activityId: 'sample', media: { title: 'Embedded player' },
    playback: { state: 'playing' }, visibility: 'normal',
  };
  registry.update(7, 'player-document', player, 3);

  for (const parent of [
    { idle: true },
    { title: 'Advertisement', ad: true },
    { title: 'Paused parent', playing: false },
    { media: { title: 'Paused parent' }, playback: { state: 'paused' }, visibility: 'normal' },
    { media: { title: 'Advertisement' }, playback: { state: 'playing' }, visibility: 'ad' },
    { media: { title: 'Hidden parent' }, playback: { state: 'playing' }, visibility: 'private' },
  ]) {
    registry.update(7, 'top-document', parent, 0);
    assert.deepEqual(registry.tracks().get(7), player);
  }
  registry.update(7, 'top-document', {
    media: { title: 'Paused parent' }, playback: { state: 'paused' }, visibility: 'normal',
  }, 0);
  registry.update(7, 'player-document', { ...player, visibility: 'private' }, 3);
  assert.equal(registry.tracks().get(7).playback.state, 'paused');
});

test('uses the latest reportable frame when all media is paused and clears when none remain', () => {
  const registry = new ActivityRegistry();
  const first = { title: 'First paused player', playing: false };
  const second = { title: 'Second paused player', playing: false };
  registry.update(7, 'first-document', first, 3);
  registry.update(7, 'second-document', second, 4);
  registry.update(7, 'top-document', { idle: true }, 0);

  assert.deepEqual(registry.tracks().get(7), second);
  registry.clearDocument(7, 'second-document', 4);
  assert.deepEqual(registry.tracks().get(7), first);
  registry.clearDocument(7, 'first-document', 3);
  assert.deepEqual(registry.tracks().get(7), { idle: true });
});

test('filters per-Activity paused preferences before choosing a frame within a tab', () => {
  const registry = new ActivityRegistry();
  const eligible = { activityId: 'music', title: 'Paused song', playing: false };
  const hidden = { activityId: 'video', title: 'Paused video', playing: false };
  const preferences = { music: { showPaused: true }, video: { showPaused: false } };
  registry.update(7, 'music-document', eligible, 3);
  registry.update(7, 'video-document', hidden, 4);

  assert.deepEqual(registry.tracks().get(7), hidden);
  const allowed = (track) => isTrackAllowed(track, { enabled: true }, preferences[track.activityId]);
  assert.deepEqual(registry.tracks(allowed).get(7), eligible);
  registry.clearDocument(7, 'music-document', 3);
  assert.equal(registry.tracks(allowed).has(7), false);
  assert.deepEqual(registry.tracks().get(7), hidden);
});
