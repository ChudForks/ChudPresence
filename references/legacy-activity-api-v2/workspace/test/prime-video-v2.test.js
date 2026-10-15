import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { validateActivityV2, describeActivityV2, validateV2Report } from '../extension/core/activity-api-v2.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { collectActivityV2, runActivityV2 } from '../extension/core/activity-v2-runtime.js';

const configuration = () => ({ schemaVersion: 1, kind: 'video', scope: '.dv-player-fullscreen', fields: {
  title: { source: 'dom.text', selectors: ['.atvwebplayersdk-title-text'] },
  subtitle: { source: 'dom.text', selectors: ['.atvwebplayersdk-episode-info'] },
}, player: { adapter: 'prime-video', selectors: ['.atvwebplayersdk-video-surface video'] } });

function fixture() {
  function element(tagName, properties = {}) {
    return { tagName, nodeType: 1, queries: {}, ...properties,
      closest(selector) {
        for (let current = this; current; current = current.parentElement) {
          if (current.sensitive || current.hidden || selector.includes('[aria-hidden="true"]') && current.ariaHidden) return current;
        }
        return null;
      },
      getClientRects() { return this.noRects ? [] : [{}]; },
      querySelector() { return this.sensitiveChild || null; },
      querySelectorAll(selector) { return this.queries[selector] || []; },
      getAttribute(name) { return this.attributes?.[name] || (name === 'src' ? this.currentSrc : null); },
    };
  }
  const root = element('DIV');
  const title = element('DIV', { textContent: '  Yu-Gi-Oh!  ', parentElement: root });
  const subtitle = element('SPAN', { textContent: 'S1 E1   The Heart of The Cards', parentElement: root });
  const video = element('VIDEO', { parentElement: root, ariaHidden: true, currentSrc: 'blob:https://www.amazon.com/episode-1',
    readyState: 4, paused: false, ended: false, currentTime: 30, duration: 1246.432, playbackRate: 1 });
  root.queries = { '.atvwebplayersdk-title-text': [title], '.atvwebplayersdk-episode-info': [subtitle], '.atvwebplayersdk-video-surface video': [video] };
  const listeners = new Map();
  const document = { body: {}, documentElement: {}, querySelectorAll: () => [root],
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event) };
  const window = { location: { href: 'https://www.amazon.com/gp/video/detail/episode-1' },
    getComputedStyle: (node) => ({ display: node.cssHidden ? 'none' : 'block', opacity: node.transparent ? '0' : '1',
      visibility: node.visibility || 'visible', contentVisibility: node.contentVisibility || 'visible' }) };
  const state = {};
  const collect = (config = configuration()) => collectActivityV2(config, document, window, state);
  const hideControls = () => { root.queries['.atvwebplayersdk-title-text'] = []; root.queries['.atvwebplayersdk-episode-info'] = []; };
  return { root, title, subtitle, video, document, window, state, listeners, collect, hideControls, element };
}

const richConfiguration = () => ({ ...configuration(), player: { ...configuration().player, metadata: 'prime-video-details' } });
const episodeImage = `https://images-na.ssl-images-amazon.com/images/S/pv-target-images/${'a'.repeat(64)}._SX720_FMjpg_.jpg`;
const heroImage = `https://m.media-amazon.com/images/S/pv-target-images/${'b'.repeat(64)}._SX1080_FMjpg_.jpg`;
function details(f) {
  const main = f.element('MAIN');
  const heading = f.element('H3', { textContent: '1. The Heart of The Cards', parentElement: main });
  const label = f.element('A', { attributes: { 'aria-label': 'Watch for free, Resume S1 E1' }, parentElement: main });
  const image = f.element('IMG', { attributes: { src: episodeImage }, parentElement: main });
  const hero = f.element('IMG', { attributes: { src: heroImage, alt: 'Yu-Gi-Oh!' }, parentElement: main });
  const titleArt = f.element('IMG', { attributes: { alt: 'Yu-Gi-Oh!' }, parentElement: main });
  const row = f.element('LI', { parentElement: main, queries: {
    h3: [heading], 'a[data-testid="episodes-playbutton"]': [label], '[data-testid="episode-image"] img': [image],
  } });
  main.queries = { '.DVWebNode-detail-atf-wrapper h1 img': [titleArt], '#tab-content-episodes [id^="av-ep-episode-"]': [row],
    '.DVWebNode-detail-atf-wrapper img': [hero] };
  f.document.querySelector = (selector) => selector === '#main' ? main : null;
  return { main, heading, label, image, hero, titleArt, row };
}

test('enriched Prime episodes keep series/name/numbers and matching art through the presence formatter', () => {
  const f = fixture(); details(f); const config = richConfiguration();
  validateActivityV2(JSON.stringify(config));
  const report = f.collect(config);
  assert.equal(report.kind, 'episode');
  assert.deepEqual(report.media, { title: 'The Heart of The Cards', series: 'Yu-Gi-Oh!', season: 1, episode: 1, subtitle: 'Season 1, Episode 1' });
  assert.deepEqual(report.artwork, { large: episodeImage, largeText: 'Season 1, Episode 1 • The Heart of The Cards' });
  const track = normalizeActivityReport(report, 2, config);
  const presence = createPresenceIntent({ ...track, activityName: 'Prime Video' });
  assert.equal(presence.details, 'The Heart of The Cards');
  assert.equal(presence.state, 'Yu-Gi-Oh!');
  assert.equal(presence.assets.largeText, 'Season 1, Episode 1 • The Heart of The Cards');
  assert.equal(presence.assets.largeImage, episodeImage);
  f.hideControls(); assert.deepEqual(f.collect(config).media, report.media);
  f.video.currentSrc += '-next'; assert.equal(f.collect(config), null);
});

test('Prime artwork cannot come from another series, episode, hidden metadata or arbitrary destinations', () => {
  const config = richConfiguration();
  for (const change of [
    (d) => { d.heading.textContent = '1. Another Episode'; },
    (d) => { d.label.attributes['aria-label'] = 'Play S2 E1'; },
    (d) => { d.image.hidden = true; },
    (d) => { d.image.attributes.src = 'https://outside.example/private'; },
  ]) {
    const f = fixture(); const d = details(f); change(d);
    assert.equal(f.collect(config).artwork.large, heroImage);
  }
  for (const change of [
    (d) => { d.titleArt.attributes.alt = 'Another Series'; },
    (d) => { d.titleArt.hidden = true; },
    (d) => { d.main.ariaHidden = true; },
  ]) {
    const f = fixture(); const d = details(f); change(d);
    assert.equal(f.collect(config).artwork, undefined);
    assert.equal(f.collect(config).media.title, 'The Heart of The Cards');
  }
  for (const url of ['http://m.media-amazon.com/images/S/pv-target-images/image.jpg', episodeImage + '?private=value',
    episodeImage.replace('images-na.ssl-images-amazon.com', 'images-na.ssl-images-amazon.com.evil.example'),
    episodeImage.replace('/images/S/pv-target-images/', '/private/'), episodeImage.replace('https://', 'https://user:password@')]) {
    const f = fixture(); const d = details(f); d.image.attributes.src = url; d.hero.hidden = true;
    assert.equal(f.collect(config).artwork, undefined);
    const report = { ...f.collect(config), artwork: { large: url, largeText: 'Season 1, Episode 1 • The Heart of The Cards' } };
    assert.throws(() => validateV2Report(report, config), /approved Amazon/);
  }
});

test('Prime enrichment is opt-in and recovers an episode name only from a matching public row', () => {
  const f = fixture(); details(f);
  const original = f.collect();
  assert.equal(original.kind, 'video'); assert.equal(original.artwork, undefined);
  assert.equal(normalizeActivityReport(original, 2, configuration()).display.state, 'S1 E1 The Heart of The Cards');
  f.subtitle.textContent = 'S1 E1';
  assert.equal(f.collect(richConfiguration()).media.title, 'The Heart of The Cards');
  f.subtitle.textContent = 'Season 2, Episode 3 – The Next Game';
  assert.equal(f.collect(richConfiguration()).media.season, 2);
  assert.equal(f.collect(richConfiguration()).media.title, 'The Next Game');
  assert.equal(f.collect(richConfiguration()).artwork.large, heroImage);
  f.subtitle.textContent = 'S10001 E1 Invalid';
  assert.equal(f.collect(richConfiguration()).kind, 'video');
  f.root.queries['.atvwebplayersdk-episode-info'] = [];
  const movie = f.collect(richConfiguration());
  assert.equal(movie.media.series, undefined); assert.equal(movie.media.episode, undefined);
  assert.equal(movie.artwork.large, heroImage);
  assert.throws(() => validateV2Report({ ...movie, artwork: { large: heroImage, largeText: 'Unrelated private text' } }, richConfiguration()), /describe the reported media/);
  assert.throws(() => validateV2Report(movie, configuration()), /unsupported field artwork/);
  const generic = configuration(); generic.player.adapter = 'html-media'; generic.player.metadata = 'prime-video-details';
  assert.throws(() => validateActivityV2(JSON.stringify(generic)), /bundled prime-video-details/);
});

test('Prime Video declares only fixed public player reads and describes retention in approval', () => {
  const config = configuration();
  assert.deepEqual(validateActivityV2(JSON.stringify(config)), config);
  assert.match(describeActivityV2({ matches: ['https://www.amazon.com/gp/video/*'] }, JSON.stringify(config)), /retains previously visible/);
  for (const change of [
    (value) => { value.scope = '#account'; },
    (value) => { value.kind = 'episode'; },
    (value) => { value.fields.title.selectors = ['.private']; },
    (value) => { value.fields.title.removePrefix = 'Secret'; },
    (value) => { value.fields.artist = value.fields.title; },
    (value) => { value.player.selectors = ['video']; },
  ]) {
    const bad = configuration(); change(bad);
    assert.throws(() => validateActivityV2(JSON.stringify(bad)), /fixed player container/);
  }
});

test('Prime Video reports visible episodes, pauses and seeks, and retains removed controls for the same source', () => {
  const f = fixture();
  assert.deepEqual(f.collect(), { kind: 'video', media: { title: 'Yu-Gi-Oh!', subtitle: 'S1 E1 The Heart of The Cards' },
    playback: { state: 'playing', position: 30, duration: 1246.432, live: false, rate: 1 } });
  f.hideControls();
  f.video.paused = true; f.video.currentTime = 10;
  assert.equal(f.collect().playback.state, 'paused');
  assert.equal(f.collect().playback.position, 10);
  f.video.paused = false; f.video.currentTime = 120;
  assert.equal(f.collect().media.subtitle, 'S1 E1 The Heart of The Cards');
  assert.equal(f.collect().playback.position, 120);
  // Returning a report must not let callers mutate cached metadata.
  f.collect().media.title = 'Altered';
  assert.equal(f.collect().media.title, 'Yu-Gi-Oh!');
});

test('Prime Video clears retained metadata on source, route, duration or player changes and end/close', () => {
  for (const change of [
    (f) => { f.video.currentSrc += '-next'; },
    (f) => { f.window.location.href += '/next'; },
    (f) => { f.video.duration = 1800; },
    (f) => { f.root.queries['.atvwebplayersdk-video-surface video'] = [{ ...f.video }]; },
    (f) => { f.video.ended = true; },
    (f) => { f.video.readyState = 0; },
    (f) => { f.root.cssHidden = true; },
    (f) => { f.video.currentSrc = ''; },
  ]) {
    const f = fixture(); assert.ok(f.collect()); f.hideControls(); change(f);
    assert.equal(f.collect(), null); assert.equal(f.state.primeVideo, undefined);
  }
});

test('Prime Video never reuses a rejected title or reads hidden, sensitive, preview or non-Prime media', () => {
  for (const change of [
    (f) => { f.title.sensitive = true; },
    (f) => { f.title.hidden = true; },
    (f) => { f.title.transparent = true; },
    (f) => { f.title.textContent = 'x'.repeat(1025); },
    (f) => { f.title.sensitiveChild = {}; },
    (f) => { f.root.ariaHidden = true; },
    (f) => { f.video.cssHidden = true; },
    (f) => { f.window.location.href = 'https://www.amazon.com/gp/your-account/'; },
    (f) => { f.window.location.href = 'https://private.example.com/watch/'; },
    (f) => { f.window.location.href = 'https://www.amazon.com.evil.example/gp/video/watch'; },
  ]) {
    const f = fixture(); assert.ok(f.collect()); change(f);
    assert.equal(f.collect(), null); f.hideControls(); assert.equal(f.collect(), null);
  }
  const f = fixture(); f.hideControls(); assert.equal(f.collect(), null);
  const generic = configuration(); generic.player.adapter = 'html-media';
  assert.equal(f.collect(generic), null); // No accessibility exception in the generic adapter.
  const movie = fixture(); movie.root.queries['.atvwebplayersdk-episode-info'] = [];
  assert.deepEqual(movie.collect().media, { title: 'Yu-Gi-Oh!' });
});

test('Prime Video rejects hidden title descendants without retaining or resurrecting rejected metadata', () => {
  for (const properties of [
    { cssHidden: true }, { visibility: 'hidden' }, { visibility: 'collapse' },
    { transparent: true }, { noRects: true }, { contentVisibility: 'hidden' },
  ]) {
    const f = fixture(); assert.ok(f.collect());
    f.title.queries['*'] = [{ ...f.subtitle, queries: {}, parentElement: f.title, ...properties }];
    f.title.textContent = 'Yu-Gi-Oh! PRIVATE HIDDEN TEXT';
    assert.equal(f.collect(), null, JSON.stringify(properties));
    assert.equal(f.state.primeVideo, undefined);
    f.hideControls(); assert.equal(f.collect(), null);
    f.title.queries['*'] = []; f.title.textContent = 'Public replacement title';
    f.root.queries['.atvwebplayersdk-title-text'] = [f.title];
    assert.equal(f.collect().media.title, 'Public replacement title');
  }
});

test('Prime Video omits rejected episode text from new reports and retained metadata', () => {
  const f = fixture(); assert.ok(f.collect().media.subtitle);
  f.subtitle.queries['*'] = [{ ...f.title, queries: {}, parentElement: f.subtitle, transparent: true }];
  f.subtitle.textContent = 'Episode PRIVATE HIDDEN TEXT';
  assert.deepEqual(f.collect().media, { title: 'Yu-Gi-Oh!' });
  f.hideControls();
  assert.deepEqual(f.collect().media, { title: 'Yu-Gi-Oh!' });
});

test('serialized Prime Video collector invalidates on media lifecycle events, route exit and teardown', async () => {
  const f = fixture(); const messages = []; const windowListeners = new Map(); const portListeners = new Map(); let tick;
  f.window.top = f.window;
  f.window.addEventListener = (name, fn) => windowListeners.set(name, fn);
  f.window.removeEventListener = (name) => windowListeners.delete(name);
  const identity = { activityId: 'prime-video', activityVersion: '1.0.0', capability: 'test-generation' };
  const context = { window: f.window, document: f.document, location: f.window.location, URL, Date, Math,
    config: configuration(), identity,
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; }, setTimeout, clearTimeout,
    chrome: { runtime: {
      async sendMessage(message) { messages.push(message); return { ok: true }; },
      connect() { return { onMessage: { addListener: (fn) => portListeners.set('message', fn) },
        onDisconnect: { addListener() {} }, disconnect() {} }; },
    } },
  };
  vm.runInNewContext(`(${runActivityV2.toString()})(config, identity, ['https://www.amazon.com/gp/video/*'], [], (pattern, url) => url.startsWith(pattern.slice(0, -1)), ${collectActivityV2.toString()});`, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.at(-1).operation, 'presence.report');
  f.hideControls(); await tick(); assert.equal(messages.at(-1).operation, 'presence.report');
  f.listeners.get('emptied')({ target: f.video });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.at(-1).operation, 'presence.clear');
  f.root.queries['.atvwebplayersdk-title-text'] = [f.title]; await tick();
  f.hideControls(); f.window.location.href = 'https://www.amazon.com/gp/your-account/'; await tick();
  assert.equal(messages.at(-1).operation, 'presence.clear');
  f.window.location.href = 'https://www.amazon.com/gp/video/detail/episode-1'; await tick();
  assert.equal(messages.at(-1).operation, 'presence.clear');
  portListeners.get('message')({ type: 'CHUDPRESENCE_ACTIVITY_ABORT', ...identity });
  assert.equal(tick, null); assert.equal(f.listeners.size, 0); assert.equal(windowListeners.size, 0);
});
