import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { collectGenericActivityV2 } from '../extension/core/activity-v2-generic.js';
import { collectActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { validateActivityV2, validateV2Report, describeActivityV2, matchV2MediaPath, TIKTOK_LOGO_URL } from '../extension/core/activity-api-v2.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';

let source;
try { source = await fs.readFile(new URL('../ChudPresence-Activities-V2/activities/tiktok/activity.json', import.meta.url), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = source && validateActivityV2(source);
const run = (name, fn) => test(name, { skip: !config && 'Local V2 Activities checkout unavailable' }, fn);

function element(tagName, properties = {}) {
  return { tagName, nodeType: 1, queries: {}, attributes: {}, childNodes: [], textContent: '',
    rect: { left: 0, top: 0, right: 320, bottom: 500 }, ...properties,
    matches(selector) { return this.selectors?.includes(selector) || selector === '#app' && this.id === 'app'; },
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector.includes('head, script') ? node.sensitive || node.hidden || node.ariaHidden : node.matches(selector)) return node;
      }
      return null;
    },
    contains(child) { for (let node = child; node; node = node.parentElement) if (node === this) return true; return false; },
    querySelectorAll(selector) { return this.queries[selector] || []; },
    querySelector(selector) { return selector.includes('head, script') ? this.sensitiveChild || null : this.querySelectorAll(selector)[0] || null; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    getClientRects() { return this.noRects ? [] : [this.rect]; }, getBoundingClientRect() { return this.rect; },
  };
}

function fixture(href = 'https://www.tiktok.com/foryou') {
  const root = element('ARTICLE');
  const wrapper = element('DIV', { parentElement: root, selectors: ['.tiktok-web-player'], attributes: { id: 'xgwrapper-0-123456789' } });
  const video = element('VIDEO', { parentElement: wrapper, readyState: 4, ended: false, paused: false, currentTime: 12,
    duration: 60, playbackRate: 1, currentSrc: 'https://private.example/resource.mp4' });
  const title = element('DIV', { parentElement: root, textContent: 'A great video #hello' });
  const creator = element('SPAN', { parentElement: root, textContent: 'Example Creator' });
  const handle = element('H3', { parentElement: root, textContent: 'example.creator' });
  const link = element('A', { parentElement: root, attributes: { href: '/@example.creator/video/123456789?tracking=private#fragment' } });
  root.queries = { video: [video], '[data-e2e="video-desc"]': [title], '[data-e2e="video-author-nickname"]': [creator],
    '[data-e2e="video-author-uniqueid"]': [handle], a: [link] };
  const document = { body: {}, documentElement: {}, queries: { [config.scope]: [root] }, querySelectorAll(selector) { return this.queries[selector] || []; } };
  const window = { location: { href }, innerWidth: 1200, innerHeight: 800, getComputedStyle: node => ({ display: node.cssHidden ? 'none' : 'block',
    opacity: node.transparent ? '0' : '1', visibility: node.visibility || 'visible', contentVisibility: node.contentVisibility || 'visible' }) };
  const state = {};
  return { root, wrapper, video, title, creator, handle, link, document, window, state,
    collect(configuration = config) { return collectActivityV2(configuration, document, window, state); },
    presence(report) { return createPresenceIntent(normalizeActivityReport(report, 2, config, window.location.href), 100000); } };
}

run('generic TikTok preserves feed/detail presentation, public buttons, native progress and preferences', () => {
  for (const path of ['/', '/en/', '/en-us/', '/foryou', '/following/', '/@example.creator/video/123456789?tracking=private', '/@Example.Creator/video/123456789']) {
    const f = fixture('https://www.tiktok.com' + path), report = f.collect();
    assert.equal(report.modeId, 'default'); assert.equal(report.kind, 'video');
    assert.deepEqual(report.links, { media: '/@example.creator/video/123456789', profile: '/@example.creator' });
    const presence = f.presence(report);
    assert.equal(presence.details, f.title.textContent); assert.equal(presence.state, 'Example Creator (@example.creator)');
    assert.deepEqual(presence.timestamps, { start: 88, end: 148 }); assert.equal(presence.assets.largeImage, TIKTOK_LOGO_URL);
    assert.deepEqual(presence.buttons.map(button => button.label), ['View TikTok', 'View Profile']);
    assert.equal(presence.buttons[0].url, 'https://www.tiktok.com/@example.creator/video/123456789');
    const normalized = normalizeActivityReport(report, 2, config, f.window.location.href);
    assert.equal(createPresenceIntent(normalized, 100000, { statusDisplay: 'artist' }).statusDisplayType, 'state');
    const hidden = createPresenceIntent(normalized, 100000, { showArtwork: false, showButtons: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.deepEqual(hidden.buttons, []); assert.equal(hidden.timestamps, null);
    f.video.paused = true; assert.equal(f.presence(f.collect()).timestamps, null);
  }
  const f = fixture('https://tiktok.com/following');
  assert.equal(f.presence(f.collect()).buttons[0].url, 'https://tiktok.com/@example.creator/video/123456789');
  f.link.attributes.href = 'https://outside.example/@example.creator/video/123456789';
  delete f.wrapper.attributes.id;
  assert.deepEqual(f.presence(f.collect()).buttons, [{ label: 'View Profile', url: 'https://tiktok.com/@example.creator' }]);
});

run('generic TikTok is serialized reusable code and supports package-only selector changes', () => {
  const f = fixture();
  const serialized = vm.runInNewContext(`(${collectGenericActivityV2.toString()})`, { Date, URL });
  assert.deepEqual(JSON.parse(JSON.stringify(serialized(config, f.document, f.window, {}))), f.collect());
  const updated = structuredClone(config); updated.scope = '.new-card'; updated.fields.title.selectors = ['.new-caption'];
  f.document.queries = { '.new-card': [f.root] }; delete f.root.queries['[data-e2e="video-desc"]']; f.root.queries['.new-caption'] = [f.title];
  assert.equal(f.collect(), null); assert.equal(f.collect(validateActivityV2(JSON.stringify(updated))).media.title, f.title.textContent);
});

run('generic TikTok rejects unrelated routes, hidden/private fields, invalid handles and inactive players', () => {
  for (const path of ['/explore', '/search', '/@example.creator', '/messages', '/settings', '/upload', '/en/messages', '/@other/video/123', '/@example.creator/video/%31', '/@example.creator/video/123/extra']) assert.equal(fixture('https://www.tiktok.com' + path).collect(), null, path);
  for (const mutate of [
    f => { f.title.hidden = true; }, f => { f.title.sensitiveChild = {}; }, f => { f.creator.transparent = true; },
    f => { f.root.sensitive = true; }, f => { f.video.readyState = 0; }, f => { f.video.ended = true; },
    f => { f.handle.textContent = 'invalid/handle'; }, f => { f.title.textContent = ''; }, f => { f.title.textContent = 'x'.repeat(1025); },
    f => { f.video.rect.top = 900; }, f => { f.video.ariaHidden = true; },
  ]) { const f = fixture(); assert.ok(f.collect()); mutate(f); assert.equal(f.collect(), null); assert.equal(f.state.generic, undefined); }
  const f = fixture();
  const br = element('BR', { parentElement: f.title, cssHidden: true }); f.title.queries['*'] = [br];
  assert.ok(f.collect()); br.childNodes = [{}]; assert.equal(f.collect(), null);
  const hidden = element('SPAN', { parentElement: f.title, transparent: true }); f.title.queries['*'] = [hidden];
  Object.defineProperty(hidden, 'textContent', { get() { throw new Error('Hidden text must never be touched'); } });
  assert.equal(f.collect(), null);
});

function overlayFixture() {
  const f = fixture('https://www.tiktok.com/@example.creator/video/123456789');
  const scope = element('DIV', { parentElement: f.root }); f.wrapper.parentElement = scope; scope.queries.video = [f.video];
  const nickname = element('SPAN', { parentElement: f.root, textContent: 'example.creator · 10-14' });
  f.handle.parentElement = nickname;
  f.root.queries = { '[data-e2e="browse-video-desc"]': [f.title], '[data-e2e="browser-nickname"]': [nickname],
    '[data-e2e="browser-nickname"] [class*="SpanEllipsis"]': [f.handle], '[data-e2e="browse-username"]': [f.creator] };
  f.document.queries = { '[data-e2e="browse-video"]': [scope] };
  return { ...f, scope, nickname };
}

run('Explore overlays distinguish display names from handles and read bounded fully visible formatted captions', () => {
  const f = overlayFixture(); f.creator.textContent = 'Example Creator 🐶';
  f.title.queries['*'] = Array.from({ length: 21 }, () => element('SPAN', { parentElement: f.title }));
  assert.equal(f.collect()?.media.channel, '@example.creator');
  assert.equal(f.presence(f.collect()).state, 'Example Creator 🐶 (@example.creator)');
  const withoutGrant = structuredClone(config); delete withoutGrant.modes.find(mode => mode.id === 'overlay').fields.title.maxDescendants;
  assert.equal(f.collect(withoutGrant), null); // The generic default remains 16.
  const hiddenChild = f.title.queries['*'][20]; hiddenChild.transparent = true;
  Object.defineProperty(hiddenChild, 'textContent', { get() { throw new Error('Hidden formatting content must not be read'); } });
  assert.equal(f.collect(), null); hiddenChild.transparent = false;
  f.title.queries['*'] = Array.from({ length: 65 }, () => element('SPAN', { parentElement: f.title }));
  assert.equal(f.collect(), null); // TikTok requests 64, even though the API permits up to 128.
  f.title.queries['*'] = []; f.nickname.hidden = true;
  assert.equal(f.collect(), null); // The public page URL cannot rescue a rejected visible-handle source.
});

run('generic TikTok overlays use a bounded shared container and matching player/page identity', () => {
  const f = overlayFixture(); assert.equal(f.collect().modeId, 'overlay');
  assert.equal(f.presence(f.collect()).state, 'Example Creator (@example.creator)');
  for (const id of ['xgwrapper-2-999', 'unknown-player-123456789', 'xgwrapper-2-123456789-extra', '']) {
    f.wrapper.attributes.id = id; assert.equal(f.collect(), null, id);
  }
  for (const mutate of [
    f => { f.root.id = 'app'; }, f => { f.creator.hidden = true; }, f => { f.handle.textContent = 'other.creator'; },
    f => { let parent = f.root; for (let i = 0; i < 5; i++) parent = element('DIV', { parentElement: parent }); f.scope.parentElement = parent; },
  ]) { const current = overlayFixture(); mutate(current); assert.equal(current.collect(), null); }
});

function liveFixture(featured = false) {
  const f = fixture(featured ? 'https://www.tiktok.com/live' : 'https://www.tiktok.com/@example.creator/live');
  f.video.duration = Infinity;
  if (featured) {
    const fade = element('DIV', { parentElement: f.root, transparent: true, selectors: ['.ee35qag0'] });
    f.title.parentElement = fade; f.creator.parentElement = fade; f.link.parentElement = fade; f.link.attributes.href = '/@example.creator/live';
    f.root.queries = { video: [f.video], '.e1xspjl31': [f.title], '.e1xspjl34': [f.creator], '.ee35qag0 a': [f.link] };
    f.document.queries = { '[data-e2e="discover-list-live-card"]': [f.root] };
    return { ...f, fade };
  }
  const room = element('DIV', { parentElement: f.root, queries: { video: [f.video] } }); f.wrapper.parentElement = room;
  const header = element('DIV', { parentElement: f.root }); f.creator.parentElement = header; f.link.parentElement = header; f.link.attributes.href = '/@example.creator';
  f.root.queries = { '[data-e2e="live-header-container"]': [header], '[data-e2e="live-header-container"] [data-e2e="room-header-anchor-name"]': [f.creator], '[data-e2e="live-header-container"] a': [f.link] };
  f.document.queries = { '[data-e2e="live-room-content"]': [room] };
  return { ...f, room, header };
}

run('generic TikTok LIVE preserves Watching Live, absence-only title fallback and elapsed session resets', () => {
  const f = liveFixture(); let now = 100000;
  const serialized = vm.runInNewContext(`(${collectGenericActivityV2.toString()})`, { URL, Date: { now: () => now } });
  const collect = () => JSON.parse(JSON.stringify(serialized(config, f.document, f.window, f.state)));
  assert.equal(collect().media.title, 'TikTok LIVE'); now += 15000;
  const report = collect(); assert.equal(report.modeId, 'live-room');
  assert.deepEqual(report.playback, { state: 'playing', position: 15, duration: 0, live: true, rate: 1 });
  const presence = createPresenceIntent(normalizeActivityReport(report, 2, config, f.window.location.href), now);
  assert.equal(presence.details, 'Watching Live'); assert.equal(presence.state, 'Example Creator');
  assert.deepEqual(presence.timestamps, { start: 100 }); assert.equal(presence.buttons[0].label, 'Watch Stream');
  f.root.queries['[data-e2e="user-profile-live-title"]'] = [f.title];
  assert.equal(collect().media.title, f.title.textContent); assert.equal(collect().playback.position, 15);
  f.title.hidden = true; assert.equal(collect(), null); f.title.hidden = false; collect();
  f.creator.textContent = 'New public name'; now += 1000; assert.equal(collect().playback.position, 0);
  f.link.attributes.href = '/@other.creator'; assert.equal(collect(), null);
  f.link.attributes.href = '/@example.creator'; collect();
  f.window.location.href = 'https://www.tiktok.com/messages'; assert.equal(collect(), null); assert.equal(f.state.generic, undefined);
});

run('generic TikTok featured LIVE exempts only its declared public fade ancestor', () => {
  const f = liveFixture(true); assert.equal(f.collect().modeId, 'live-featured');
  assert.equal(f.presence(f.collect()).state, 'Example Creator');
  for (const mutate of [
    f => { f.title.transparent = true; }, f => { f.creator.transparent = true; }, f => { f.fade.cssHidden = true; },
    f => { f.fade.ariaHidden = true; }, f => { f.root.transparent = true; }, f => { f.video.transparent = true; },
    f => { f.link.attributes.href = 'https://outside.example/@example.creator/live'; },
    f => { f.title.queries['*'] = [element('SPAN', { parentElement: f.title, transparent: true })]; },
  ]) { const current = liveFixture(true); mutate(current); assert.equal(current.collect(), null); }
});

run('generic mode reports cannot forge paths, identity, destinations, presentation or live rules', () => {
  const f = fixture(); const report = f.collect();
  validateV2Report(report, config, f.window.location.href);
  for (const changed of [
    { ...report, modeId: 'unknown' }, { ...report, modeId: 'live-room' }, { ...report, kind: 'stream' },
    { ...report, links: { ...report.links, media: 'https://outside.example/' } },
    { ...report, links: { ...report.links, media: '/@other/video/123' } },
    { ...report, links: { ...report.links, media: '/@example.creator/video/123?secret=value' } },
    { ...report, links: { ...report.links, media: '/@example.creator/video/%31' } },
    { ...report, links: { ...report.links, private: '/private' } }, { ...report, buttons: [] }, { ...report, artwork: {} },
    { ...report, playback: { ...report.playback, live: true } },
  ]) assert.throws(() => validateV2Report(changed, config, f.window.location.href));
  assert.throws(() => validateV2Report(report, config, 'https://www.tiktok.com/messages'));
  assert.throws(() => validateV2Report(report, config, 'https://www.tiktok.com/@other/video/123'));
  const absentBinding = structuredClone(config);
  absentBinding.fields.subtitle = { source: 'dom.text', selectors: ['.absent-field'] };
  absentBinding.links.profile.matchFields.subtitle = 7;
  assert.throws(() => validateV2Report(report, absentBinding, f.window.location.href));
  assert.equal(f.collect(absentBinding).links.profile, undefined);
  const review = describeActivityV2({ matches: ['https://www.tiktok.com/*'] }, source);
  for (const text of ['live-room', 'live-featured', 'overlay', 'same-origin', 'opacityAncestor', 'ignoreEmptyBreaks']) assert.ok(review.includes(text));
  assert.equal(matchV2MediaPath('/{handle}/video/{number}', '/@example.creator/video/123'), true);
  for (const path of ['//@example.creator/video/123', '/@example.creator/video/%31', '/@example/../123', '/@example/video/123?x']) assert.equal(matchV2MediaPath('/{handle}/video/{number}', path), false);
});
