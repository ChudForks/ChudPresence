import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { collectGenericActivityV2 } from '../extension/core/activity-v2-generic.js';

const configuration = () => ({ schemaVersion: 2, kind: 'video', scope: '[data-e2e="media-card"]', fields: {
  title: { source: 'dom.text', selectors: ['[data-e2e="caption"]'] },
  creator: { source: 'dom.attribute', selectors: ['.creator'], attribute: 'title' },
}, player: { adapter: 'html-media', selectors: ['video'], selection: 'largest-visible' } });

function element(tagName, properties = {}) {
  return { tagName, nodeType: 1, queries: {}, textContent: '', rect: { left: 0, top: 0, right: 320, bottom: 180 }, ...properties,
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.sensitive || node.hidden || node.ariaHidden && selector.includes('[aria-hidden="true"]')) return node;
      }
      return null;
    },
    querySelector(selector) { return selector.includes('form') && this.sensitiveChild ? this.sensitiveChild : this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return this.queries[selector] || []; },
    getAttribute(name) { return this.attributes?.[name] ?? null; },
    getClientRects() { return this.noRects ? [] : [this.rect]; },
    getBoundingClientRect() { return this.rect; },
  };
}

function fixture() {
  const root = element('ARTICLE');
  const title = element('H3', { textContent: '  Selected   media  ', parentElement: root });
  const creator = element('SPAN', { attributes: { title: 'Selected Creator' }, parentElement: root });
  const video = element('VIDEO', { parentElement: root, readyState: 4, ended: false, paused: false,
    currentTime: 30, duration: 120, playbackRate: 1, currentSrc: 'https://media.example/public.mp4' });
  root.queries = { '[data-e2e="caption"]': [title], '.creator': [creator], video: [video] };
  const document = { roots: [root], body: {}, documentElement: {}, querySelectorAll() { return this.roots; } };
  const window = { location: { href: 'https://feed.example/watch/one' }, innerWidth: 1200, innerHeight: 800,
    getComputedStyle: (node) => ({ display: node.cssHidden ? 'none' : 'block', visibility: node.visibility || 'visible',
      opacity: node.transparent ? '0' : '1', contentVisibility: node.contentVisibility || 'visible' }) };
  const state = {};
  return { root, title, creator, video, document, window, state,
    collect(config = configuration()) { return collectGenericActivityV2(config, document, window, state); } };
}

test('generic V2 ranks visible media and binds every field to the selected card', () => {
  const f = fixture(); const neighbor = fixture();
  neighbor.title.textContent = 'Neighbor metadata'; neighbor.creator.attributes.title = 'Neighbor creator';
  f.document.roots = [neighbor.root, f.root];
  f.video.rect = { left: 0, top: 0, right: 640, bottom: 360 }; f.video.paused = true;
  const report = f.collect();
  assert.equal(report.media.title, 'Selected media'); assert.equal(report.media.creator, 'Selected Creator');
  assert.equal(report.playback.state, 'paused'); // Larger paused cards beat adjacent autoplay.
  neighbor.video.rect = { ...f.video.rect };
  assert.equal(f.collect().media.title, 'Neighbor metadata'); // Playback only breaks equal-area ties.
  neighbor.video.rect = { left: 0, top: 900, right: 640, bottom: 1260 };
  assert.equal(f.collect().media.title, 'Selected media');
  f.title.hidden = true;
  assert.equal(f.collect(), null); // A rejected winning card cannot silently become another card.
  f.title.hidden = false; f.video.readyState = 0;
  assert.equal(f.collect(), null);
});

test('generic schema V2 permits package-only selector changes without executable service adapters', () => {
  const f = fixture(); const config = configuration();
  assert.equal(f.collect(config).media.title, 'Selected media');
  delete f.root.queries['[data-e2e="caption"]']; f.root.queries['.new-layout > .caption'] = [f.title];
  assert.equal(f.collect(config), null);
  config.fields.title.selectors = ['.new-layout > .caption'];
  assert.equal(f.collect(config).media.title, 'Selected media');
  // The same trusted function runs correctly when serialized into another world.
  const serialized = vm.runInNewContext(`(${collectGenericActivityV2.toString()})`, { Date });
  assert.deepEqual(JSON.parse(JSON.stringify(serialized(config, f.document, f.window, {}))), f.collect(config));
});

test('generic native media exceptions require a rendered player and cannot bypass hiding ancestors', () => {
  const f = fixture(); const config = configuration(); f.video.ariaHidden = true;
  assert.equal(f.collect(config), null);
  config.player.allowAriaHidden = true;
  assert.equal(f.collect(config).playback.position, 30);
  f.root.ariaHidden = true; assert.equal(f.collect(config), null); f.root.ariaHidden = false;
  f.video.transparent = true; assert.equal(f.collect(config), null);
  config.player.canvasSelector = '.renderer';
  const canvas = element('CANVAS', { parentElement: f.root, width: 640, height: 360 });
  f.root.queries['.renderer'] = [canvas];
  assert.equal(f.collect(config).media.title, 'Selected media');
  for (const changes of [
    { cssHidden: true }, { transparent: true }, { noRects: true }, { sensitive: true },
    { rect: { left: 800, top: 0, right: 900, bottom: 100 } },
  ]) {
    Object.assign(canvas, changes); assert.equal(f.collect(config), null, JSON.stringify(changes));
    for (const key of Object.keys(changes)) delete canvas[key]; canvas.rect = { ...f.video.rect };
  }
  const wrapper = element('DIV', { parentElement: f.root, transparent: true });
  f.video.parentElement = wrapper;
  assert.equal(f.collect(config), null);
  f.video.parentElement = f.root; f.video.cssHidden = true;
  assert.equal(f.collect(config), null);
  f.video.cssHidden = false; f.root.queries['.renderer'] = [];
  assert.equal(f.collect(config), null);
});

test('generic fields apply literal split transforms and bounded numeric extraction', () => {
  const f = fixture(); const config = configuration();
  f.title.textContent = 'Playing: Episode name | 4 | 12';
  config.fields.title = { source: 'dom.text', selectors: ['[data-e2e="caption"]'], removePrefix: 'Playing:', split: { separator: '|', index: 0 } };
  config.fields.season = { source: 'dom.text', selectors: ['[data-e2e="caption"]'], split: { separator: '|', index: 1 }, parse: 'integer' };
  config.fields.episode = { source: 'constant', value: 12 };
  config.fields.series = { source: 'constant', value: 'Example Series' };
  assert.deepEqual(f.collect(config).media, { title: 'Episode name', creator: 'Selected Creator', season: 4, episode: 12, series: 'Example Series' });
  f.title.textContent = 'Playing: Episode name | 10001 | 12';
  assert.equal(f.collect(config).media.season, undefined);
  f.title.textContent = 'Playing: Episode name | 4.5 | 12'; assert.equal(f.collect(config).media.season, undefined);
});

test('generic literal fallbacks require absent targets and never rescue hidden or sensitive fields', () => {
  const f = fixture(); const config = configuration(); config.fields.title.fallback = 'Watching media';
  f.root.queries['[data-e2e="caption"]'] = [];
  assert.equal(f.collect(config).media.title, 'Watching media');
  f.root.queries['[data-e2e="caption"]'] = [f.title];
  for (const changes of [
    { hidden: true }, { transparent: true }, { cssHidden: true }, { visibility: 'collapse' },
    { contentVisibility: 'hidden' }, { sensitive: true }, { sensitiveChild: {} }, { textContent: '' },
    { textContent: 'x'.repeat(1025) },
  ]) {
    const originals = Object.fromEntries(Object.keys(changes).map((key) => [key, f.title[key]]));
    Object.assign(f.title, changes); assert.equal(f.collect(config), null, JSON.stringify(changes)); Object.assign(f.title, originals);
  }
  const hiddenChild = element('SPAN', { textContent: 'PRIVATE', parentElement: f.title, transparent: true });
  f.title.queries['*'] = [hiddenChild]; f.title.textContent = 'Public PRIVATE';
  assert.equal(f.collect(config), null);
  hiddenChild.textContent = ''; f.title.textContent = 'Public';
  assert.equal(f.collect(config), null);
  hiddenChild.transparent = false;
  assert.equal(f.collect(config).media.title, 'Public');
  f.root.sensitive = true; assert.equal(f.collect(config), null);
});

test('generic retention caches each absent field only for the same playback identity', () => {
  const f = fixture(); const config = configuration(); config.player.retainMetadata = true;
  assert.ok(f.collect(config));
  f.root.queries['[data-e2e="caption"]'] = []; f.root.queries['.creator'] = [];
  assert.deepEqual(f.collect(config).media, { title: 'Selected media', creator: 'Selected Creator' });
  f.root.queries['.creator'] = [f.creator]; f.creator.hidden = true;
  assert.equal(f.collect(config).media.creator, undefined);
  f.root.queries['.creator'] = [];
  assert.equal(f.collect(config).media.creator, undefined); // Rejected optional data cannot reappear from an older cache.
  f.root.queries['[data-e2e="caption"]'] = [f.title]; f.title.hidden = true;
  assert.equal(f.collect(config), null); assert.equal(f.state.generic, undefined);
  f.title.hidden = false; assert.ok(f.collect(config)); f.root.queries['[data-e2e="caption"]'] = [];
  for (const change of [
    () => { f.window.location.href = 'https://feed.example/watch/two'; },
    () => { f.video.currentSrc = 'https://media.example/next.mp4'; },
    () => { f.video.duration = 200; },
    () => { f.root.queries.video = [{ ...f.video }]; },
    () => { f.document.roots = [{ ...f.root }]; },
    () => { f.video.ended = true; },
  ]) {
    // Exercise each invalidation against the cached fixture built above.
    f.root.queries['[data-e2e="caption"]'] = [f.title]; f.video.ended = false; f.document.roots = [f.root]; f.root.queries.video = [f.video]; f.collect(config);
    f.root.queries['[data-e2e="caption"]'] = []; change(); assert.equal(f.collect(config), null);
  }
});

test('generic hidden fields and descendants are rejected before reading throwing text getters', () => {
  const f = fixture(); const config = configuration(); config.fields.title.fallback = 'Watching media';
  const child = element('SPAN', { parentElement: f.title, transparent: true });
  Object.defineProperty(child, 'textContent', { get() { throw new Error('Hidden descendant text was read'); } });
  f.title.queries['*'] = [child];
  Object.defineProperty(f.title, 'textContent', { get() { throw new Error('Rejected field text was read'); } });
  assert.equal(f.collect(config), null);
  f.title.queries['*'] = []; f.title.hidden = true;
  assert.equal(f.collect(config), null);
});

test('generic retained visible metadata takes precedence over an absence-only literal fallback', () => {
  const f = fixture(); const config = configuration();
  config.player.retainMetadata = true; config.fields.title.fallback = 'Watching media';
  assert.equal(f.collect(config).media.title, 'Selected media');
  f.root.queries['[data-e2e="caption"]'] = [];
  assert.equal(f.collect(config).media.title, 'Selected media');
  delete f.state.generic;
  assert.equal(f.collect(config).media.title, 'Watching media');
});

function domFixture() {
  const f = fixture(); const config = configuration(); config.player = { adapter: 'dom-media', selectors: ['canvas'],
    selection: 'largest-visible', state: { selectors: ['.play-control'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] },
    position: { source: 'dom.text', selectors: ['.position'], parse: 'clock' },
    duration: { source: 'dom.text', selectors: ['.duration'], parse: 'number' } };
  const canvas = element('CANVAS', { parentElement: f.root, width: 640, height: 360 });
  const control = element('BUTTON', { parentElement: f.root, attributes: { 'aria-label': 'Pause' } });
  const position = element('SPAN', { parentElement: f.root, textContent: '01:25' });
  const duration = element('SPAN', { parentElement: f.root, textContent: '240.5' });
  Object.assign(f.root.queries, { canvas: [canvas], '.play-control': [control], '.position': [position], '.duration': [duration] });
  return { ...f, config, canvas, control, position, duration, collect() { return collectGenericActivityV2(config, f.document, f.window, f.state); } };
}

test('generic DOM player reports only visible canvas/image evidence, literal state and bounded timeline', () => {
  const f = domFixture();
  assert.deepEqual(f.collect().playback, { state: 'playing', position: 85, duration: 240.5, live: false, rate: 1 });
  f.control.attributes['aria-label'] = 'Play'; assert.equal(f.collect().playback.state, 'paused');
  f.position.textContent = '1:02:03.5'; assert.equal(f.collect().playback.position, 3723.5);
  for (const bad of ['-1', '1:60', '1:02:60', 'Infinity', '31536001', '12:34:56:78']) {
    f.position.textContent = bad; assert.equal(f.collect().playback.position, 0, bad);
  }
  f.position.textContent = '01:25'; f.position.hidden = true; assert.equal(f.collect().playback.position, 0);
  f.duration.sensitive = true; assert.equal(f.collect().playback.duration, 0);
  f.control.hidden = true; assert.equal(f.collect(), null); f.control.hidden = false;
  f.control.attributes['aria-label'] = 'PRIVATE CONTROL VALUE'; assert.equal(f.collect(), null);
  f.control.attributes['aria-label'] = 'Pause'; f.canvas.width = 0; assert.equal(f.collect(), null);
  f.canvas.width = 640; f.canvas.transparent = true; assert.equal(f.collect(), null);
  f.canvas.transparent = false; f.config.player.selectors = ['img'];
  const photo = element('IMG', { complete: true, naturalWidth: 640, parentElement: f.root }); f.root.queries.img = [photo];
  assert.ok(f.collect()); photo.complete = false; assert.equal(f.collect(), null);
  photo.complete = true; photo.naturalWidth = 0; assert.equal(f.collect(), null);
});

test('generic elapsed sessions reset on playback identity changes and never expose resource URLs', () => {
  const f = domFixture(); let now = 100000; f.config.player.elapsed = true; f.config.player.live = true;
  delete f.config.player.position; delete f.config.player.duration;
  const serialized = vm.runInNewContext(`(${collectGenericActivityV2.toString()})`, { Date: { now: () => now } });
  const collect = () => serialized(f.config, f.document, f.window, f.state);
  assert.equal(collect().playback.position, 0); now += 15000;
  const report = JSON.parse(JSON.stringify(collect()));
  assert.deepEqual(report.playback, { state: 'playing', position: 15, duration: 0, live: true, rate: 1 });
  assert.deepEqual(Object.keys(report), ['kind', 'media', 'playback']);
  f.window.location.href += '?navigation=next'; assert.equal(collect().playback.position, 0);
  now += 2000; assert.equal(collect().playback.position, 2);
  f.root.queries.canvas = [{ ...f.canvas }]; assert.equal(collect().playback.position, 0);
  f.root.queries.canvas = []; assert.equal(collect(), null); assert.equal(f.state.generic, undefined);
  const native = fixture(); const config = configuration(); config.kind = 'stream'; config.player.elapsed = true;
  native.video.duration = Infinity;
  const nativeReport = serialized(config, native.document, native.window, native.state);
  assert.equal(nativeReport.playback.live, true); assert.equal(nativeReport.playback.duration, 0);
  assert.equal(JSON.stringify(nativeReport).includes('media.example'), false);
});
