import assert from 'node:assert/strict';
import test from 'node:test';

test('V1/V2 focus policy is optional, explicit and strictly validated', () => {
  for (const version of [1, 2]) {
    const report = { kind: 'generic', media: { title: 'Browsing' } };
    assert.equal(Object.hasOwn(normalizeActivityReport(report, version), 'focusPolicy'), false);
    for (const focusPolicy of ['foreground', 'background']) {
      assert.equal(normalizeActivityReport({ ...report, focusPolicy }, version).focusPolicy, focusPolicy);
    }
    for (const focusPolicy of [null, true, false, 1, {}, [], 'visible', 'Foreground']) {
      assert.throws(() => normalizeActivityReport({ ...report, focusPolicy }, version), /focusPolicy/);
    }
  }
});
import {
  ACTIVITY_API_VERSION,
  normalizeActivityReport,
  validateActivityMetadata,
  validateActivitySource,
} from '../extension/core/activity-validator.js';

function metadata(overrides = {}) {
  return {
    id: 'sample-activity',
    name: 'Sample Activity',
    description: 'A sample website observer.',
    version: '1.2.3',
    apiVersion: ACTIVITY_API_VERSION,
    matches: ['https://example.com/*'],
    entry: 'activity.js',
    ...overrides,
  };
}

test('validates metadata and fixes execution to the isolated user-script world', () => {
  const normalized = validateActivityMetadata(metadata());
  assert.equal(normalized.executionWorld, 'USER_SCRIPT');
  assert.equal(normalized.frames, 'top');
  assert.deepEqual(normalized.network, []);
  assert.deepEqual(normalized.matches, ['https://example.com/*']);
  assert.equal(validateActivityMetadata(metadata({ frames: 'all' })).frames, 'all');
  assert.deepEqual(validateActivityMetadata(metadata({ network: ['https://api.example.com/*'] })).network, ['https://api.example.com/*']);
});

test('rejects unsupported metadata, broad hosts, and insecure website patterns', () => {
  assert.throws(() => validateActivityMetadata(metadata({ permissions: ['tabs'] })), /unsupported field/);
  assert.throws(() => validateActivityMetadata(metadata({ matches: ['https://*/*'] })), /invalid or duplicate/);
  assert.throws(() => validateActivityMetadata(metadata({ matches: ['http://example.com/*'] })), /invalid or duplicate/);
  assert.throws(() => validateActivityMetadata(metadata({ executionWorld: 'MAIN' })), /isolated USER_SCRIPT/);
  assert.throws(() => validateActivityMetadata(metadata({ frames: 'parent-and-child' })), /frames must be top or all/);
  assert.throws(() => validateActivityMetadata(metadata({ network: ['http://api.example.com/*'] })), /network must contain/);
  assert.throws(() => validateActivityMetadata(metadata({ network: ['https://discord.com/api/*'] })), /cannot declare Discord/);
});

test('rejects leading zeroes in every numeric prerelease version identifier', () => {
  for (const version of ['1.2.3-01', '1.2.3-01.beta', '1.2.3-beta.01', '1.2.3-00+build']) {
    assert.throws(() => validateActivityMetadata(metadata({ version })), /semantic version/);
    assert.throws(() => validateActivityMetadata(metadata({ minExtensionVersion: version })), /semantic version/);
  }
  for (const version of ['1.2.3-0', '1.2.3-1.beta', '1.2.3-beta.0', '1.2.3-01beta', '1.2.3+01']) {
    assert.equal(validateActivityMetadata(metadata({ version })).version, version);
  }
});

test('validates discovery metadata and excluded URL patterns', () => {
  const expanded = metadata({
    aliases: ['YT Music', 'YTM'],
    tags: ['music', 'streaming'],
    defaultMediaKind: 'song',
    excludeMatches: ['https://example.com/embed/*'],
    contributors: [{ name: 'Activity author', url: 'https://example.com/profile' }],
    serviceUrl: 'https://example.com/',
  });
  assert.deepEqual(validateActivityMetadata(expanded).aliases, ['YT Music', 'YTM']);
  assert.deepEqual(validateActivityMetadata(expanded).tags, ['music', 'streaming']);
  assert.equal(validateActivityMetadata(expanded).defaultMediaKind, 'song');
  assert.deepEqual(validateActivityMetadata(expanded).excludeMatches, ['https://example.com/embed/*']);
  assert.throws(() => validateActivityMetadata(metadata({ aliases: ['same', 'same'] })), /aliases/);
  assert.throws(() => validateActivityMetadata(metadata({ tags: ['Invalid Tag'] })), /tags/);
  assert.throws(() => validateActivityMetadata(metadata({ defaultMediaKind: 'music' })), /defaultMediaKind/);
  assert.throws(() => validateActivityMetadata(metadata({ excludeMatches: ['http://example.com/private/*'] })), /excludeMatches/);
  assert.throws(() => validateActivityMetadata(metadata({ serviceUrl: 'javascript:alert(1)' })), /HTTPS URL/);
});

test('validates declarative Activity settings for boolean, select, string, and numeric controls', () => {
  const settings = [
    { id: 'showAlbum', type: 'boolean', label: 'Show album', default: true },
    { id: 'displayMode', type: 'select', label: 'Display mode', default: 'artist', options: [
      { label: 'Artist', value: 'artist' }, { label: 'Album', value: 'album' },
    ] },
    { id: 'prefix', type: 'string', label: 'Prefix', default: '', maxLength: 20 },
    { id: 'volume', type: 'range', label: 'Volume', default: 50, min: 0, max: 100, step: 5 },
    { id: 'offset', type: 'number', label: 'Offset', default: 0, min: -10, max: 10 },
  ];
  assert.deepEqual(validateActivityMetadata(metadata({ settings })).settings, settings);
  assert.throws(() => validateActivityMetadata(metadata({ settings: [settings[0], settings[0]] })), /unique lowercase identifiers/);
  assert.throws(() => validateActivityMetadata(metadata({ settings: [{ ...settings[1], default: 'unknown' }] })), /default must match/);
  assert.throws(() => validateActivityMetadata(metadata({ settings: [{ ...settings[3], default: 42 }] })), /outside its allowed values/);
  assert.throws(() => validateActivityMetadata(metadata({ settings: [{ ...settings[0], enabled: true }] })), /unsupported field/);
});

test('accepts optional status labels and rejects unsupported or empty UI metadata', () => {
  const settingsUi = { statusLabels: { app: 'YouTube Music', artist: 'Artist', track: 'Song title' } };
  assert.deepEqual(validateActivityMetadata(metadata({ settingsUi })).settingsUi, settingsUi);
  assert.equal(validateActivityMetadata(metadata()).settingsUi, undefined);
  for (const invalid of [
    null,
    { statusLabels: null },
    { statusLabels: { creator: 'Creator' } },
    { statusLabels: { track: '   ' } },
    { statusLabels: { track: 'x'.repeat(81) } },
    { statusLabels: { track: 42 } },
    { other: true },
  ]) {
    assert.throws(() => validateActivityMetadata(metadata({ settingsUi: invalid })), /settingsUi/);
  }
});

test('navigation grace is a bounded opt-in metadata option for V1 and V2', () => {
  for (const apiVersion of [1, 2]) {
    for (const navigationGraceMs of [0, 1500, 4000, 5000]) {
      const value = validateActivityMetadata(metadata({ apiVersion, presence: { kind: 'generic', navigationGraceMs } }));
      assert.equal(value.presence.navigationGraceMs, navigationGraceMs);
    }
    for (const navigationGraceMs of [-1, 5001, 1.5, '4000', null]) {
      assert.throws(() => validateActivityMetadata(metadata({ apiVersion, presence: { navigationGraceMs } })), /navigationGraceMs/);
    }
  }
});

test('enforces Activity source size and non-empty content', () => {
  assert.equal(validateActivitySource('globalThis.started = true;'), 'globalThis.started = true;');
  assert.throws(() => validateActivitySource('  '), /non-empty JavaScript/);
  assert.throws(() => validateActivitySource(`//${'x'.repeat(512 * 1024)}`), /512 KB size limit/);
});

test('normalizes a bounded HTTPS Activity report', () => {
  assert.deepEqual(normalizeActivityReport({
    kind: 'song',
    media: { title: '  Song title  ', artist: ' Artist ' },
    playback: { state: 'playing', position: 12.5, duration: 180 },
    artwork: { large: 'https://cdn.example.com/cover.png' },
    buttons: [{ label: 'Open', url: 'https://music.example.com/watch?id=1' }],
  }), {
    kind: 'song',
    media: { title: 'Song title', artist: 'Artist' },
    playback: { state: 'playing', position: 12.5, duration: 180, live: false, rate: 1 },
    display: { details: 'Song title', state: 'Artist', statusDisplay: 'details' },
    artwork: { large: 'https://cdn.example.com/cover.png' },
    buttons: [{ label: 'Open', url: 'https://music.example.com/watch?id=1' }],
    visibility: 'normal',
  });
});

test('normalizes clickable presence text and artwork URLs', () => {
  const report = normalizeActivityReport({
    kind: 'song',
    media: { title: 'Track', artist: 'Artist', album: 'Album' },
    display: {
      detailsUrl: 'https://music.example.com/watch?v=1',
      stateUrl: 'https://music.example.com/artist/1',
    },
    artwork: {
      large: 'https://cdn.example.com/cover.png',
      largeUrl: 'https://music.example.com/album/1',
    },
  });
  assert.equal(report.display.detailsUrl, 'https://music.example.com/watch?v=1');
  assert.equal(report.display.stateUrl, 'https://music.example.com/artist/1');
  assert.equal(report.artwork.largeUrl, 'https://music.example.com/album/1');
  for (const [section, field] of [
    ['display', 'detailsUrl'], ['display', 'stateUrl'], ['artwork', 'largeUrl'],
  ]) {
    assert.throws(() => normalizeActivityReport({
      kind: 'song', media: { title: 'Track' }, [section]: { [field]: 'javascript:alert(1)' },
    }), /HTTPS URL/);
  }
});

test('supplies kind-specific display defaults and normalized playback defaults', () => {
  assert.deepEqual(normalizeActivityReport({
    kind: 'episode',
    media: { title: 'The episode', series: 'The series', season: 2, episode: 4 },
  }), {
    kind: 'episode',
    media: { title: 'The episode', series: 'The series', season: 2, episode: 4 },
    playback: { state: 'playing', position: 0, duration: 0, live: false, rate: 1 },
    display: { details: 'The series', state: 'The episode', statusDisplay: 'details' },
    artwork: {},
    buttons: [],
    visibility: 'normal',
  });
});

test('rejects unsafe URLs, invalid kinds, visibility values, and undeclared report fields', () => {
  assert.throws(() => normalizeActivityReport({
    kind: 'video', media: { title: 'Title' }, artwork: { large: 'http://example.com' },
  }), /HTTPS URL/);
  assert.throws(() => normalizeActivityReport({ kind: 'music', media: { title: 'Title' } }), /supported generic Activity kinds/);
  assert.throws(() => normalizeActivityReport({ kind: 'video', media: { title: 'Title' }, source: 'other' }), /unsupported field/);
  assert.throws(() => normalizeActivityReport({
    kind: 'movie', media: { title: 'Title' }, visibility: 'hidden',
  }), /visibility must be/);
});

test('both APIs validate opt-in status overrides and second-line suppression', () => {
  for (const apiVersion of [1, 2]) {
    const report = { kind: 'generic', media: { title: 'Browsing' } };
    for (const statusDisplayOverride of ['name', 'state', 'details']) {
      const normalized = normalizeActivityReport({ ...report, display: { statusDisplayOverride, hideState: true } }, apiVersion);
      assert.equal(normalized.display.statusDisplayOverride, statusDisplayOverride);
      assert.equal(normalized.display.hideState, true);
    }
    const unchanged = normalizeActivityReport(report, apiVersion);
    assert.equal(Object.hasOwn(unchanged.display, 'statusDisplayOverride'), false);
    assert.equal(Object.hasOwn(unchanged.display, 'hideState'), false);
    assert.equal(normalizeActivityReport({ ...report, display: { hideState: false } }, apiVersion).display.hideState, false);
    for (const statusDisplayOverride of ['', 'app', true, null, 1]) {
      assert.throws(() => normalizeActivityReport({ ...report, display: { statusDisplayOverride } }, apiVersion), /statusDisplayOverride/);
    }
    for (const hideState of ['', 'false', null, 0, 1, {}]) {
      assert.throws(() => normalizeActivityReport({ ...report, display: { hideState } }, apiVersion), /hideState/);
    }
  }
});

test('enforces nested field limits, playback values, and the two-button maximum', () => {
  assert.throws(() => normalizeActivityReport({ kind: 'movie', media: { title: 'x'.repeat(257) } }), /media.title/);
  assert.throws(() => normalizeActivityReport({
    kind: 'movie', media: { title: 'Title' }, playback: { rate: 17 },
  }), /playback.rate/);
  assert.throws(() => normalizeActivityReport({
    kind: 'movie', media: { title: 'Title' }, buttons: [
      { label: '1', url: 'https://example.com/1' },
      { label: '2', url: 'https://example.com/2' },
      { label: '3', url: 'https://example.com/3' },
    ],
  }), /at most two/);
});

test('v2 supports bounded mode names and elapsed generic pages while v1 rejects those fields', () => {
  const report = {
    kind: 'generic', media: { title: 'query' },
    display: { name: 'Google Images', details: 'Searching for : query', state: '', statusDisplay: 'name' },
    playback: { state: 'playing', elapsed: true, position: 12 },
  };
  const normalized = normalizeActivityReport(report, 2);
  assert.equal(normalized.display.name, 'Google Images');
  assert.equal(normalized.display.state, '');
  assert.equal(normalized.playback.elapsed, true);
  assert.throws(() => normalizeActivityReport(report, 1), /unsupported field/);
  for (const name of ['', ' ', 42, null, 'x'.repeat(257)]) {
    assert.throws(() => normalizeActivityReport({ ...report, display: { name } }, 2), /display.name/);
  }
  for (const playback of [{ elapsed: 'true' }, { elapsed: true, live: true }, { elapsed: true, duration: 12 }]) {
    assert.throws(() => normalizeActivityReport({ ...report, playback }, 2), /elapsed|Elapsed/);
  }
  assert.throws(() => normalizeActivityReport({ ...report, kind: 'video' }, 2), /Elapsed/);
  assert.throws(() => normalizeActivityReport({ kind: 'generic', media: { title: 'query' }, display: { name: 'Google' } }, 1), /unsupported field/);
});
