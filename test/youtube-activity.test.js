import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const watchSelector = '#movie_player';
const shortsSelector = 'ytd-reel-video-renderer[is-active] #shorts-player, ' +
  'ytd-reel-video-renderer[is-active] .html5-video-player, ' +
  '#shorts-player:not(ytd-reel-video-renderer:not([is-active]) #shorts-player)';
const miniSelector = 'ytd-miniplayer:not([hidden]) #movie_player, ' +
  'ytd-miniplayer:not([hidden]) .html5-video-player, #movie_player.ytp-miniplayer-active';
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

async function harness(source, { path = '/watch?v=abcdefghijk', bridge = true } = {}) {
  let now = 2000;
  let interval;
  let navigation;
  let mediaChange;
  let cleanup;
  let delayedRead = null;
  const listeners = new Map();
  const reports = [];
  const location = new URL(`https://www.youtube.com${path}`);
  const video = { currentTime: 12, duration: 100, paused: false, ended: false, playbackRate: 1 };
  const preview = { ...video };
  const page = { videoId: 'abcdefghijk', title: 'Watched video', author: 'Creator',
    position: 12, duration: 100, state: 1, live: false, ad: false };
  const ancestors = {};
  const player = {
    querySelector(selector) { return selector.startsWith('video') ? video : null; },
    closest(selector) { return ancestors[selector] || null; },
    getVideoData() { return { video_id: page.videoId, title: page.title, author: page.author }; },
    getCurrentTime() { return page.position; },
    getDuration() { return page.duration; },
    getPlayerState() { return page.state; },
    getPlayerResponse() { return { videoDetails: { videoId: page.videoId, isLive: page.live } }; },
  };
  const selectors = { [watchSelector]: player, [shortsSelector]: player };
  const document = {
    title: 'Watched video - YouTube', documentElement: {},
    querySelector(selector) {
      if (selector === 'link[rel="canonical"]') return { href: 'https://www.youtube.com/watch?v=abcdefghijk' };
      // A generic lookup would find the playing hover preview.
      if (selector === '#movie_player, #shorts-player, .html5-video-player') return player;
      if (selector === 'ytd-player video.html5-main-video') return preview;
      return selectors[selector] || null;
    },
    addEventListener(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeEventListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  const ChudPresence = {
    report(report) { reports.push(report); return Promise.resolve(); },
    clear() { reports.push(null); return Promise.resolve(); },
    runtime: { has() { return bridge; } },
    page: { execute(fn, args) {
      if (delayedRead) return delayedRead;
      return Promise.resolve(vm.runInNewContext(`(${fn.toString()})(...args)`, { document, args }));
    } },
    media: { find() { return preview; }, snapshot(element) { return { ...element }; },
      onChange(callback) { mediaChange = callback; } },
    dom: { observe() {} },
    navigation: { onChange(callback) { navigation = callback; } },
    lifecycle: { signal: { aborted: false }, interval(callback) { interval = callback; },
      onCleanup(callback) { cleanup = callback; } },
  };
  class FakeDate extends Date { static now() { return now; } }
  vm.runInNewContext(source, { ChudPresence, document, location, URL, URLSearchParams,
    Date: FakeDate, MutationObserver: class { observe() {} disconnect() {} },
    navigator: { mediaSession: { playbackState: 'playing', metadata: { title: 'Watched video' } } },
  });
  await flush();
  return {
    reports, video, preview, page, player, selectors, ancestors, listeners,
    async advance() { now += 2000; interval(); await flush(); },
    async navigate(path) { now += 1000; location.href = new URL(path, location).href; navigation(); await flush(); },
    async change() { now += 1000; mediaChange(); await flush(); },
    async event(event, target) {
      for (const listener of listeners.get(event) || []) listener({ target });
      await flush();
    },
    delayRead(promise) { delayedRead = promise; },
    cleanup,
  };
}

const sources = [['bundled', new URL('../extension/default-activities/youtube/activity.js', import.meta.url)]];
const catalog = new URL('../ChudPresence-Activities/activities/youtube/activity.js', import.meta.url);
try { await readFile(catalog); sources.push(['catalog', catalog]); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const [name, path] of sources) {
  const source = await readFile(path, 'utf8');
  test(`${name} YouTube clears ended playback and resumes a replay`, async () => {
    const activity = await harness(source);
    assert.equal(activity.reports.at(-1).playback.state, 'playing');
    activity.page.state = 2;
    activity.video.paused = true;
    await activity.advance();
    assert.equal(activity.reports.at(-1).playback.state, 'paused');
    activity.page.state = 0;
    await activity.advance();
    assert.equal(activity.reports.at(-1), null);
    activity.page.state = 1;
    activity.page.position = 0;
    activity.video.currentTime = 0;
    activity.video.paused = false;
    await activity.advance();
    assert.equal(activity.reports.at(-1).playback.state, 'playing');
    assert.equal(activity.reports.at(-1).playback.position, 0);
  });

  test(`${name} YouTube clears DOM endings with and without the page bridge`, async () => {
    for (const bridge of [true, false]) {
      const activity = await harness(source, { bridge });
      activity.video.ended = true;
      activity.video.paused = true;
      await activity.advance();
      assert.equal(activity.reports.at(-1), null);
    }
  });

  test(`${name} YouTube clears a paused terminal clock but retains a paused live stream`, async () => {
    const activity = await harness(source);
    activity.page.state = 2;
    activity.page.position = 100;
    activity.video.paused = true;
    await activity.advance();
    assert.equal(activity.reports.at(-1), null);
    activity.page.live = true;
    await activity.advance();
    assert.equal(activity.reports.at(-1).playback.state, 'paused');
    assert.equal(activity.reports.at(-1).kind, 'stream');
  });

  test(`${name} YouTube clears immediately on ended and discards an in-flight read`, async () => {
    const activity = await harness(source);
    let finish;
    activity.delayRead(new Promise((resolve) => { finish = resolve; }));
    await activity.change();
    await activity.event('ended', activity.video);
    assert.equal(activity.reports.at(-1), null);
    finish({ ...activity.page });
    await flush();
    assert.equal(activity.reports.at(-1), null);
    activity.cleanup();
    assert.equal(activity.listeners.get('ended').size, 0);
  });

  test(`${name} YouTube ignores home, search, subscription, and channel hover previews`, async () => {
    for (const path of ['/', '/results?search_query=test', '/feed/subscriptions', '/@creator']) {
      for (const bridge of [true, false]) {
        const activity = await harness(source, { path, bridge });
        assert.equal(activity.reports.at(-1), null);
        await activity.advance();
        assert.equal(activity.reports.at(-1), null);
      }
    }
  });

  test(`${name} YouTube clears stale watch metadata after navigating to previews`, async () => {
    const activity = await harness(source);
    assert.equal(activity.reports.at(-1).media.title, 'Watched video');
    await activity.navigate('/');
    assert.equal(activity.reports.at(-1), null);
  });

  test(`${name} YouTube keeps paused watch playback while a sidebar preview plays or ends`, async () => {
    for (const bridge of [true, false]) {
      const activity = await harness(source, { bridge });
      activity.page.state = 2;
      activity.video.paused = true;
      await activity.advance();
      assert.equal(activity.reports.at(-1).playback.state, 'paused');
      await activity.event('ended', activity.preview);
      assert.equal(activity.reports.at(-1).playback.state, 'paused');
    }
  });

  test(`${name} YouTube rejects hidden players and players inside preview containers`, async () => {
    const activity = await harness(source);
    activity.ancestors['ytd-video-preview, #inline-preview-player, [hidden]'] = {};
    await activity.advance();
    assert.equal(activity.reports.at(-1), null);
  });

  test(`${name} YouTube preserves Shorts, embeds, live routes, and visible miniplayer playback`, async () => {
    for (const path of ['/shorts/abcdefghijk', '/embed/abcdefghijk', '/live/abcdefghijk']) {
      const activity = await harness(source, { path });
      assert.equal(activity.reports.at(-1).playback.state, 'playing');
    }
    const activity = await harness(source, { path: '/' });
    activity.selectors[miniSelector] = activity.player;
    const miniplayer = { getClientRects() { return [{}]; } };
    activity.ancestors['ytd-miniplayer'] = miniplayer;
    await activity.advance();
    assert.equal(activity.reports.at(-1).playback.state, 'playing');
    miniplayer.getClientRects = () => [];
    await activity.advance();
    assert.equal(activity.reports.at(-1), null);
  });

  test(`${name} YouTube clears unstarted players and inactive Shorts`, async () => {
    const activity = await harness(source);
    for (const state of [-1, 5]) {
      activity.page.state = state;
      await activity.advance();
      assert.equal(activity.reports.at(-1), null);
    }
    const shorts = await harness(source, { path: '/shorts/abcdefghijk' });
    shorts.ancestors['ytd-reel-video-renderer'] = { hasAttribute() { return false; } };
    await shorts.advance();
    assert.equal(shorts.reports.at(-1), null);
  });
}
