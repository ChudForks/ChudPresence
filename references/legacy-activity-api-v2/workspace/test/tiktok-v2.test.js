import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { validateActivityV2, validateV2Report, describeActivityV2, TIKTOK_FIELDS, TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS, TIKTOK_LOGO_URL } from '../extension/core/activity-api-v2.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { collectActivityV2 } from '../extension/core/activity-v2-runtime.js';

const configuration = () => ({ schemaVersion: 1, kind: 'video', scope: '#main-content',
  fields: structuredClone(TIKTOK_FIELDS), player: { adapter: 'tiktok', selectors: ['video'] } });

function fixture(route = 'https://www.tiktok.com/foryou') {
  const element = (tagName, properties = {}) => ({ tagName, nodeType: 1, queries: {}, attributes: {}, ...properties,
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector.includes('head, script')) {
          if (node.sensitive || node.hidden || node.ariaHidden) return node;
        } else if (selector === '[data-e2e="discover-list-live-card"]' ? node.liveFeed : selector === '[data-e2e="live-room-content"]' ? node.liveRoom : selector === 'a[href]' ? node.tagName === 'A' && node.attributes.href :
          selector === '[data-e2e="browse-video"]' ? node.browsePlayer : selector === '.tiktok-web-player' ? node.webPlayer :
          selector.includes('recommend-list-item-container') ? node.card :
          selector.includes('#main-content') ? node.detail : selector.includes('DivLive') && node.liveRoot) return node;
      }
      return null;
    },
    getClientRects() { return this.noRects ? [] : [{}]; },
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 320, bottom: 500 }; },
    querySelector(selector) { return selector.includes('head, script') ? this.sensitiveChild || null : this.queries[selector]?.[0] || null; },
    querySelectorAll(selector) { return this.queries[selector] || []; },
    getAttribute(name) { return this.attributes[name] || null; },
  });
  const root = element('DIV', { card: true, detail: true, liveRoot: true });
  const title = element('DIV', { textContent: 'A great video #hello', parentElement: root });
  const creator = element('SPAN', { textContent: 'Example Creator', parentElement: root });
  const handle = element('H3', { textContent: 'example.creator', parentElement: root });
  const link = element('A', { attributes: { href: '/@example.creator/video/1234567890123456789?tracking=private' }, parentElement: root });
  const video = element('VIDEO', { parentElement: root, readyState: 4, paused: false, ended: false,
    currentTime: 12, duration: 60, playbackRate: 1, poster: 'https://private.example/thumbnail.png' });
  root.queries = { [TIKTOK_FIELDS.title.selectors[0]]: [title], [TIKTOK_FIELDS.creator.selectors[0]]: [creator],
    [TIKTOK_FIELDS.channel.selectors[0]]: [handle], 'a[href]': [link] };
  const document = { body: {}, documentElement: {}, videos: [video], querySelectorAll(selector) { return selector === 'video' ? this.videos : []; } };
  const window = { location: { href: route }, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: (node) => ({ display: node.cssHidden ? 'none' : 'block', opacity: node.transparent ? '0' : '1',
      visibility: node.visibility || 'visible', contentVisibility: node.contentVisibility || 'visible' }) };
  const state = {};
  const collect = () => collectActivityV2(configuration(), document, window, state);
  return { root, title, creator, handle, link, video, document, window, state, collect, element };
}

test('TikTok For You, Following and individual videos match the requested presence layout', () => {
  for (const route of ['https://www.tiktok.com/', 'https://www.tiktok.com/foryou', 'https://tiktok.com/following',
    'https://www.tiktok.com/en/', 'https://www.tiktok.com/@example.creator/video/1234567890123456789?tracking=private']) {
    const f = fixture(route);
    validateActivityV2(JSON.stringify(configuration()));
    const report = f.collect();
    assert.equal(report.kind, 'video');
    assert.equal(report.playback.position, 12);
    assert.equal(report.artwork, undefined);
    const normalized = normalizeActivityReport(report, 2, configuration());
    const presence = createPresenceIntent({ ...normalized, activityName: 'TikTok' }, 100000);
    assert.equal(presence.details, 'A great video #hello');
    assert.equal(presence.state, 'Example Creator (@example.creator)');
    assert.deepEqual(presence.timestamps, { start: 88, end: 148 });
    assert.equal(presence.assets.largeImage, TIKTOK_LOGO_URL);
    assert.equal(presence.assets.largeText, 'TikTok');
    assert.deepEqual(presence.buttons, [{ label: 'View TikTok', url: 'https://www.tiktok.com/@example.creator/video/1234567890123456789' },
      { label: 'View Profile', url: 'https://www.tiktok.com/@example.creator' }]);
    assert.equal(createPresenceIntent(normalized, 100000, { statusDisplay: 'artist' }).statusDisplayType, 'state');
    assert.equal(createPresenceIntent(normalized, 100000, { statusDisplay: 'track' }).statusDisplayType, 'details');
    const hidden = createPresenceIntent(normalized, 100000, { showArtwork: false, showButtons: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.deepEqual(hidden.buttons, []); assert.equal(hidden.timestamps, null);
    f.video.paused = true; f.video.currentTime = 30;
    assert.equal(f.collect().playback.state, 'paused');
    assert.equal(createPresenceIntent(normalizeActivityReport(f.collect(), 2, configuration())).timestamps, null);
  }
});

function overlayFixture() {
  const f = fixture('https://www.tiktok.com/@example.creator/video/1234567890123456789');
  f.root.card = false; f.root.detail = false;
  const nickname = f.element('SPAN', { textContent: 'Example Creator · 10-14', parentElement: f.root,
    queries: { '[class*="SpanNickName"], [class*="SpanEllipsis"]': [f.creator] } });
  f.creator.parentElement = nickname;
  f.root.queries = { '[data-e2e="browse-video-desc"]': [f.title], '[data-e2e="browser-nickname"]': [nickname],
    '[data-e2e="browse-username"]': [f.handle], 'a[href]': [f.link] };
  const browse = f.element('DIV', { browsePlayer: true, parentElement: f.root });
  const wrapper = f.element('DIV', { webPlayer: true, attributes: { id: 'xgwrapper-2-1234567890123456789' }, parentElement: browse });
  f.video.parentElement = wrapper;
  return { ...f, browse, wrapper, nickname };
}

test('TikTok Explore/profile video overlays bind public metadata to the open player and exclude nickname dates', () => {
  const f = overlayFixture();
  f.link.getAttribute = () => { throw new Error('Overlay commenter/unrelated links must not be inspected'); };
  const report = f.collect();
  assert.ok(report);
  assert.equal(report.media.creator, 'Example Creator');
  assert.equal(report.media.channel, '@example.creator');
  assert.equal(report.buttons[0].url, f.window.location.href);
  assert.equal(normalizeActivityReport(report, 2, configuration()).display.details, f.title.textContent);
  assert.equal(normalizeActivityReport(report, 2, configuration()).display.state, 'Example Creator (@example.creator)');
  f.video.paused = true;
  assert.equal(f.collect().playback.state, 'paused');
  f.window.location.href = 'https://www.tiktok.com/explore';
  assert.equal(f.collect(), null); // Grid browsing/previews never produce presence.
});

test('TikTok overlays cannot use preloads, another creator, hidden text, app roots or unbounded ancestor search', () => {
  for (const change of [
    (f) => { f.wrapper.attributes.id = 'xgwrapper-2-999'; },
    (f) => { f.wrapper.attributes.id = ''; },
    (f) => { f.handle.textContent = 'other.creator'; },
    (f) => { f.nickname.hidden = true; },
    (f) => { f.root.id = 'app'; },
    (f) => { f.root.cssHidden = true; },
    (f) => { f.title.queries['*'] = [f.element('SPAN', { textContent: 'PRIVATE', transparent: true, parentElement: f.title })]; },
    (f) => { let parent = f.root; for (let i = 0; i < 5; i++) parent = f.element('DIV', { parentElement: parent }); f.browse.parentElement = parent; },
  ]) { const f = overlayFixture(); assert.ok(f.collect()); change(f); assert.equal(f.collect(), null); }
});

test('TikTok selects the active visible card without mixing adjacent creators or off-screen videos', () => {
  const f = fixture(); const previous = fixture();
  previous.title.textContent = 'Previous video'; previous.handle.textContent = 'previous';
  previous.video.rect = { left: 0, top: -600, right: 320, bottom: -100 };
  f.document.videos = [previous.video, f.video];
  assert.equal(f.collect().media.channel, '@example.creator');
  previous.video.rect = { left: 0, top: 0, right: 320, bottom: 100 }; previous.video.paused = true;
  assert.equal(f.collect().media.title, 'A great video #hello');
  f.video.paused = true;
  assert.equal(f.collect().media.channel, '@example.creator'); // Largest visible paused card.
  previous.video.paused = false;
  assert.equal(f.collect().media.channel, '@example.creator'); // Adjacent autoplay cannot steal a paused card.
  f.video.rect = { left: 0, top: 900, right: 320, bottom: 1400 };
  assert.equal(f.collect().media.channel, '@previous');
});

test('TikTok LIVE uses elapsed viewing session time and resets on stream changes and route exit', () => {
  const f = fixture('https://www.tiktok.com/live'); let now = 100000;
  const serialized = vm.runInNewContext(`(${collectActivityV2.toString()})`, { URL, Date: { now: () => now } });
  const collect = () => serialized(configuration(), f.document, f.window, f.state);
  f.title.textContent = 'Making art live'; f.video.currentTime = 8000; f.video.duration = 300;
  assert.equal(collect().playback.position, 0);
  now += 15000;
  const report = JSON.parse(JSON.stringify(collect()));
  assert.deepEqual(report.playback, { state: 'playing', position: 15, duration: 0, live: true, rate: 1 });
  const presence = createPresenceIntent(normalizeActivityReport(report, 2, configuration()), now);
  assert.equal(presence.details, 'Watching Live');
  assert.equal(presence.state, 'Example Creator');
  assert.deepEqual(presence.timestamps, { start: 100 });
  assert.equal(presence.buttons[0].label, 'Watch Stream');
  assert.equal(presence.buttons[0].url, 'https://www.tiktok.com/@example.creator/live');
  f.video.paused = true; now += 5000;
  assert.equal(createPresenceIntent(normalizeActivityReport(JSON.parse(JSON.stringify(collect())), 2, configuration())).timestamps, null);
  f.handle.textContent = 'next.creator';
  assert.equal(collect().playback.position, 0);
  f.window.location.href = 'https://www.tiktok.com/messages'; assert.equal(collect(), null); assert.equal(f.state.tiktok, undefined);
  f.window.location.href = 'https://www.tiktok.com/@next.creator/live'; assert.equal(collect().playback.position, 0);
  f.document.videos = [{ ...f.video }]; now += 5000; assert.equal(collect().playback.position, 0);
});

function currentLiveFixture() {
  const f = fixture('https://www.tiktok.com/@example.creator/live');
  f.root.card = false; f.root.detail = false; f.root.liveRoot = false;
  const room = f.element('DIV', { liveRoom: true, parentElement: f.root });
  const header = f.element('DIV', { parentElement: f.root });
  const profile = f.element('A', { attributes: { href: '/@example.creator' }, parentElement: header });
  f.creator.parentElement = profile;
  f.video.parentElement = room; f.video.duration = Infinity;
  header.queries = { '[data-e2e="room-header-anchor-name"]': [f.creator] };
  f.root.queries = { '[data-e2e="live-header-container"]': [header], [TIKTOK_FIELDS.creator.selectors[3]]: [f.creator] };
  return { ...f, room, header, profile };
}

test('current TikTok LIVE panels detect stream/header and keep a session when no public title exists', () => {
  const f = currentLiveFixture(); let now = 100000;
  const serialized = vm.runInNewContext(`(${collectActivityV2.toString()})`, { URL, Date: { now: () => now } });
  const collect = () => serialized(configuration(), f.document, f.window, f.state);
  const first = collect();
  assert.equal(first.media.creator, 'Example Creator'); assert.equal(first.media.title, 'TikTok LIVE');
  assert.equal(first.playback.live, true); assert.equal(first.playback.duration, 0);
  now += 20000;
  const report = JSON.parse(JSON.stringify(collect()));
  const presence = createPresenceIntent(normalizeActivityReport(report, 2, configuration()), now);
  assert.equal(presence.details, 'Watching Live'); assert.equal(presence.state, 'Example Creator');
  assert.deepEqual(presence.timestamps, { start: 100 });
  assert.deepEqual(presence.buttons, [{ label: 'Watch Stream', url: 'https://www.tiktok.com/@example.creator/live' },
    { label: 'View Profile', url: 'https://www.tiktok.com/@example.creator' }]);
  f.root.queries[TIKTOK_FIELDS.title.selectors[2]] = [f.title];
  assert.equal(collect().media.title, f.title.textContent); // Visible public titles win when present.
  assert.equal(collect().playback.position, 20); // Title appearance does not restart the session.
  f.window.location.href = 'https://www.tiktok.com/live'; assert.equal(collect().playback.position, 0);
  assert.equal(collect().media.channel, '@example.creator'); // Feed identity comes from this room's header link.
});

test('current LIVE cannot use mismatched/hidden headers, arbitrary profile links, rejected titles or private text', () => {
  for (const change of [
    (f) => { f.profile.attributes.href = '/@other.creator'; },
    (f) => { f.profile.attributes.href = 'https://outside.example/@example.creator'; },
    (f) => { f.profile.attributes.href = ''; },
    (f) => { f.root.id = 'app'; },
    (f) => { f.header.hidden = true; }, (f) => { f.creator.transparent = true; },
    (f) => { f.creator.sensitive = true; }, (f) => { f.room.cssHidden = true; },
    (f) => { f.root.queries[TIKTOK_FIELDS.title.selectors[2]] = [f.title]; f.title.hidden = true; },
    (f) => { f.video.ended = true; }, (f) => { f.video.readyState = 0; },
    (f) => { f.header.queries['[data-e2e="room-header-anchor-name"]'] = []; },
  ]) { const f = currentLiveFixture(); assert.ok(f.collect()); change(f); assert.equal(f.collect(), null); assert.equal(f.state.tiktok, undefined); }
  for (const fields of [TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS]) {
    const config = configuration(); config.fields = structuredClone(fields);
    validateActivityV2(JSON.stringify(config));
    const f = currentLiveFixture(); assert.equal(collectActivityV2(config, f.document, f.window, f.state), null);
  } // Old approved configurations cannot acquire the new LIVE name read.
});

function liveFeedFixture() {
  const f = fixture('https://www.tiktok.com/live');
  f.root.card = false; f.root.detail = false; f.root.liveFeed = true;
  const overlay = f.element('DIV', { parentElement: f.root, transparent: true });
  f.title.parentElement = overlay; f.creator.parentElement = overlay; f.link.parentElement = overlay;
  f.link.attributes.href = '/@example.creator/live'; f.video.duration = Infinity;
  overlay.queries = { '.e1xspjl31': [f.title], '.e1xspjl34': [f.creator] };
  f.root.queries = { '.ee35qag0': [overlay], '.e1xspjl31': [f.title],
    [TIKTOK_FIELDS.creator.selectors[3]]: [f.creator], 'a[href]': [f.link] };
  return { ...f, overlay };
}

test('LIVE featured cards allow only their known public fade layer and report the matching stream', () => {
  const f = liveFeedFixture();
  const report = f.collect(); assert.ok(report);
  const presence = createPresenceIntent(normalizeActivityReport(report, 2, configuration()));
  assert.equal(presence.details, 'Watching Live'); assert.equal(presence.state, 'Example Creator');
  assert.equal(presence.buttons[0].url, 'https://www.tiktok.com/@example.creator/live');
  assert.equal(report.playback.live, true); assert.equal(report.playback.duration, 0);
  f.overlay.transparent = false; assert.equal(f.collect().media.title, f.title.textContent);
  f.video.paused = true; assert.equal(createPresenceIntent(normalizeActivityReport(f.collect(), 2, configuration())).timestamps, null);
});

test('LIVE feed fade exemption cannot bypass hidden fields, private elements, other ancestors or arbitrary destinations', () => {
  for (const change of [
    (f) => { f.creator.transparent = true; }, (f) => { f.title.transparent = true; },
    (f) => { f.title.hidden = true; }, (f) => { f.title.sensitive = true; },
    (f) => { f.title.queries['*'] = [f.element('SPAN', { textContent: 'PRIVATE', transparent: true, parentElement: f.title })]; },
    (f) => { f.overlay.ariaHidden = true; }, (f) => { f.overlay.cssHidden = true; },
    (f) => { f.overlay.visibility = 'hidden'; }, (f) => { f.root.transparent = true; },
    (f) => { f.link.attributes.href = 'https://outside.example/@example.creator/live'; },
    (f) => { f.root.queries['.ee35qag0'] = []; }, (f) => { f.video.transparent = true; },
  ]) { const f = liveFeedFixture(); assert.ok(f.collect()); change(f); assert.equal(f.collect(), null); }
  const f = liveFeedFixture(); f.document.videos = []; assert.equal(f.collect(), null);
  for (const fields of [TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS]) {
    const config = configuration(); config.fields = structuredClone(fields); validateActivityV2(JSON.stringify(config));
    const f = liveFeedFixture(); assert.equal(collectActivityV2(config, f.document, f.window, {}), null);
  }
});

test('TikTok refuses hidden/sensitive metadata, missing titles, inactive players and unrelated routes', () => {
  for (const change of [
    (f) => { f.title.hidden = true; }, (f) => { f.creator.sensitive = true; },
    (f) => { f.title.sensitiveChild = {}; }, (f) => { f.handle.textContent = 'invalid/handle'; },
    (f) => { f.title.textContent = ''; }, (f) => { f.title.textContent = 'x'.repeat(1025); },
    (f) => { f.title.queries['*'] = [f.element('SPAN', { textContent: 'PRIVATE', transparent: true, parentElement: f.title })]; },
    (f) => { f.root.cssHidden = true; }, (f) => { f.video.ended = true; }, (f) => { f.video.readyState = 0; },
    (f) => { f.video.ariaHidden = true; }, (f) => { f.video.parentElement = null; },
  ]) { const f = fixture(); assert.ok(f.collect()); change(f); assert.equal(f.collect(), null); }
  for (const route of ['https://www.tiktok.com/messages', 'https://www.tiktok.com/settings', 'https://www.tiktok.com/upload',
    'https://www.tiktok.com/@example.creator', 'https://www.tiktok.com/search', 'https://www.tiktok.com/en/messages',
    'https://www.tiktok.com/@other/video/123', 'http://www.tiktok.com/foryou', 'https://www.tiktok.com.evil.example/foryou',
    'https://user:password@www.tiktok.com/foryou', 'https://www.tiktok.com:8443/foryou']) assert.equal(fixture(route).collect(), null, route);
});

test('TikTok supports detail metadata, LIVE lines and real player IDs without fabricating video links', () => {
  const detail = fixture('https://www.tiktok.com/@example.creator/video/123'); detail.root.card = false;
  detail.root.queries[TIKTOK_FIELDS.title.selectors[1]] = [detail.title]; delete detail.root.queries[TIKTOK_FIELDS.title.selectors[0]];
  assert.equal(detail.collect().buttons[0].url, 'https://www.tiktok.com/@example.creator/video/123');
  const f = fixture(); f.link.attributes.href = 'https://outside.example/@example.creator/video/123';
  assert.equal(f.collect().buttons.length, 1);
  const wrapper = f.element('DIV', { webPlayer: true, attributes: { id: 'video-player-123456789' }, parentElement: f.root });
  f.video.parentElement = wrapper;
  assert.equal(f.collect().buttons[0].url, 'https://www.tiktok.com/@example.creator/video/123456789');
  const live = fixture('https://www.tiktok.com/live'); live.root.card = false;
  live.root.queries['[class*="DivDetailsLine"]'] = [live.element('DIV', { textContent: 'Viewer count', parentElement: live.root }), live.title];
  delete live.root.queries[TIKTOK_FIELDS.title.selectors[0]];
  assert.equal(live.collect().media.title, live.title.textContent);
});

test('TikTok configuration and reports cannot request private fields, arbitrary URLs, previews or display overrides', () => {
  for (const change of [
    (c) => { c.fields.title.selectors = ['.private']; }, (c) => { c.fields.creator.removePrefix = 'x'; },
    (c) => { c.scope = '#messages'; }, (c) => { c.kind = 'stream'; }, (c) => { c.player.selectors = ['audio']; },
    (c) => { c.player.metadata = 'prime-video-details'; },
  ]) { const config = configuration(); change(config); assert.throws(() => validateActivityV2(JSON.stringify(config)), /fixed public/); }
  const generic = configuration(); generic.player.adapter = 'html-media';
  assert.throws(() => validateActivityV2(JSON.stringify(generic)), /unsupported or sensitive selector/);
  const report = fixture().collect();
  for (const changed of [
    { ...report, artwork: { large: 'https://example.com/thumbnail.jpg' } }, { ...report, display: { details: 'Override' } },
    { ...report, kind: 'stream' }, { ...report, media: { ...report.media, channel: '@invalid/handle' } },
    { ...report, buttons: [{ label: 'View Profile', url: 'https://outside.example/private' }] },
    { ...report, buttons: [{ label: 'View TikTok', url: 'https://www.tiktok.com/@other/video/123' }] },
    { ...report, buttons: [{ label: 'View TikTok', url: report.buttons[0].url + '?secret=value' }] },
    { ...report, buttons: [report.buttons[1], report.buttons[1]] },
  ]) assert.throws(() => validateV2Report(changed, configuration()));
  assert.match(describeActivityV2({ matches: ['https://www.tiktok.com/*'] }, JSON.stringify(configuration())), /always the static TikTok app logo/);
});

test('local TikTok V2 package uses generic media modes and keeps the square PNG', async () => {
  const directory = new URL('../ChudPresence-Activities-V2/activities/tiktok/', import.meta.url);
  let source;
  try { source = await fs.readFile(new URL('activity.json', directory), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const config = validateActivityV2(source);
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.player.adapter, 'html-media');
  assert.ok(config.modes.some((mode) => mode.id === 'overlay'));
  assert.ok(config.modes.some((mode) => mode.id === 'live-room'));
  assert.ok(config.modes.every((mode) => mode.player.adapter === 'html-media'));
  const metadata = JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8'));
  assert.equal(metadata.apiVersion, 2); assert.equal(metadata.icon, 'icon.png');
  assert.equal(metadata.version, '1.1.1'); assert.equal(metadata.minExtensionVersion, '2.2.1');
  const icon = await fs.readFile(new URL('icon.png', directory));
  assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20));
  assert.ok(icon.length < 262144);
});
