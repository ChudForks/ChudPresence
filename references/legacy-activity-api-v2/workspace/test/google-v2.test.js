import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { validateActivityV2, validateV2Metadata, validateV2Report, describeActivityV2, matchActivityV2Page, V2_PLAYER_ADAPTERS } from '../extension/core/activity-api-v2.js';
import { collectActivityV2, runActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';

const logo = 'https://www.google.com/images/branding/googleg/2x/googleg_standard_color_128dp.png';
const configuration = () => ({ schemaVersion: 1, kind: 'generic', scope: '#main',
  fields: { title: { source: 'url.query', parameter: 'q' }, subtitle: { source: 'dom.text', selectors: ['#result-stats'] } },
  page: { routes: [
    { id: 'search', name: 'Google', paths: ['/search'], query: { udm: ['', '14'], tbm: [''] }, requiredQuery: ['q'], details: 'Searching for : {title}', state: '{subtitle}' },
    { id: 'images', name: 'Google Images', paths: ['/search', '/images'], query: { udm: ['2'], tbm: ['', 'isch'] }, requiredQuery: ['q'], details: 'Searching for : {title}' },
    { id: 'images-legacy', name: 'Google Images', paths: ['/search', '/images'], query: { udm: [''], tbm: ['isch'] }, requiredQuery: ['q'], details: 'Searching for : {title}' },
    { id: 'images-path', name: 'Google Images', paths: ['/images'], query: { udm: [''], tbm: [''] }, requiredQuery: ['q'], details: 'Searching for : {title}' },
    { id: 'ai', name: 'Google AI', paths: ['/search'], query: { udm: ['50'], tbm: [''] }, requiredQuery: ['q'], details: 'Searching for : {title}' },
    { id: 'homepage', name: 'Google', paths: ['/', '/webhp'], query: { q: [''], udm: [''], tbm: [''] }, requiredQuery: [], scope: '#gbwa', title: 'Homepage', details: 'Homepage' },
  ], elapsed: true, artwork: { large: logo, largeText: 'Google' } } });

function fixture(href = 'https://www.google.com/search?q=test') {
  const stats = { tagName: 'DIV', textContent: 'About 4,820,000,000 results (0.22s)', queries: {} };
  const root = { tagName: 'DIV', queries: { '#result-stats': [stats] } };
  const homepage = { tagName: 'DIV', queries: {} };
  for (const element of [root, stats, homepage]) Object.assign(element, {
    nodeType: 1, parentElement: null,
    closest() { return this.sensitive ? this : null; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    querySelector() { return null; }, querySelectorAll(selector) { return this.queries?.[selector] || []; },
  });
  const document = { visibilityState: 'visible', body: {}, documentElement: {},
    querySelectorAll: selector => selector === '#gbwa' ? [homepage] : selector === '#main' ? [root] : [] };
  const window = { location: { href }, getComputedStyle: (element) => ({ display: element.cssHidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) };
  const state = {};
  const collect = () => collectActivityV2(configuration(), document, window, state);
  return { document, window, stats, root, homepage, state, collect };
}

test('page declarations add no Google adapter and retain explicit V2 boundaries', () => {
  assert.deepEqual(validateActivityV2(JSON.stringify(configuration())), configuration());
  assert.ok(!V2_PLAYER_ADAPTERS.includes('google'));
  for (const mutate of [
    c => { c.kind = 'video'; }, c => { c.player = { adapter: 'html-media', selectors: ['video'] }; },
    c => { c.page.routes[0].details = '{undeclared}'; }, c => { c.page.routes[0].details = '{title.toString()}'; },
    c => { c.page.routes[0].name = '{title}'; }, c => { c.page.routes[0].paths = ['/*']; },
    c => { c.page.routes.push(c.page.routes[0]); }, c => { c.page.routes[0].query.udm = '*'; },
    c => { c.page.routes[0].requiredQuery = ['q', 'q']; }, c => { c.page.elapsed = 'true'; },
    c => { c.fields.title.selectors = ['input']; }, c => { c.fields.title.parameter = '*'; },
    c => { c.fields.subtitle.selectors = ['textarea']; }, c => { c.scope = 'body'; },
    c => { c.page.artwork.large = 'https://localhost/icon.png'; },
    c => { c.page.artwork.large = 'https://127.0.0.1/icon.png'; },
    c => { c.page.artwork.large = 'https://discord.com/icon.png'; },
    c => { c.page.artwork.large = 'https://example.com/{title}.png'; },
    c => { c.page.artwork.large = 'https://example.com/icon.png?q=secret'; },
    c => { c.page.artwork.large = 'https://user:pass@example.com/icon.png'; },
    c => { c.page.artwork.large = 'https://example.com:8443/icon.png'; },
  ]) { const c = configuration(); mutate(c); assert.throws(() => validateActivityV2(JSON.stringify(c))); }
  const media = configuration(); delete media.page; media.player = { adapter: 'html-media', selectors: ['video'] };
  assert.throws(() => validateActivityV2(JSON.stringify(media)), /unsupported field parameter|dom.text and dom.attribute only/);
  const review = describeActivityV2({ matches: ['https://www.google.com/search*'] }, JSON.stringify(configuration()));
  for (const expected of ['submitted URL query parameter q', 'Search text may be published to Discord', 'No input, textarea or draft text', 'Google Images', 'Google AI', logo]) assert.ok(review.includes(expected));
});

test('Google exact routes support the homepage, Search, modern/legacy Images and AI; unrelated tabs clear', () => {
  for (const [path, name] of [
    ['/search?q=test', 'Google'], ['/search?q=test&udm=14', 'Google'],
    ['/search?q=test&udm=2', 'Google Images'], ['/search?q=test&tbm=isch', 'Google Images'],
    ['/images?q=test', 'Google Images'], ['/search?q=test&udm=2&tbm=isch', 'Google Images'],
    ['/search?q=test&udm=50', 'Google AI'],
    ['/', 'Google'], ['/?q=', 'Google'], ['/?hl=en', 'Google'], ['/webhp', 'Google'], ['/webhp?hl=en', 'Google'],
  ]) {
    const f = fixture(`https://www.google.com${path}`);
    const r = f.collect(); assert.ok(r, path);
    assert.equal(normalizeActivityReport(r, 2, configuration(), f.window.location.href).activityName, name);
    assert.equal(matchActivityV2Page(configuration(), f.window.location.href).id, r.routeId);
    if (r.routeId === 'homepage') {
      const intent = createPresenceIntent(normalizeActivityReport(r, 2, configuration(), f.window.location.href));
      assert.equal(intent.details, 'Homepage'); assert.equal(intent.state, '');
      assert.equal(r.media.title, 'Homepage'); assert.equal(r.media.subtitle, undefined);
      assert.equal(buildHeadlessActivity(intent, '1549066134706323548').state, undefined);
      f.homepage.hidden = true; assert.equal(f.collect(), null);
    }
  }
  for (const path of ['/search?q=test&udm=28', '/search?q=test&udm=7', '/search?q=test&udm=39', '/search?q=test&tbm=nws',
    '/search?q=test&tbm=vid', '/search?q=test&udm=2&tbm=shop', '/search?q=test&udm=50&udm=2',
    '/search?q=test&q=other', '/search?q=%20', '/search', '/searching?q=test', '/shopping?q=test', '/?q=test', '/?q=&q=', '/?udm=50', '/?tbm=isch',
    '/webhp?q=test', '/maps?q=test', '/account?q=test']) {
    const f = fixture(`https://www.google.com${path}`);
    assert.equal(f.collect(), null, path);
    assert.equal(matchActivityV2Page(configuration(), f.window.location.href), null, path);
  }
});

test('page collection reads only the declared submitted query and visible result summary', () => {
  const f = fixture('https://www.google.com/search?q=hello+%26+%E7%8C%AB%0Aworld&tracking=SECRET');
  assert.equal(f.collect().media.title, 'hello & 猫 world');
  assert.equal(f.collect().media.subtitle, f.stats.textContent);
  for (const properties of [{ hidden: true }, { sensitive: true }, { cssHidden: true }]) {
    const g = fixture(); Object.assign(g.stats, properties);
    Object.defineProperty(g.stats, 'textContent', { get() { throw new Error('Rejected text must never be read'); } });
    assert.equal(g.collect().media.subtitle, undefined);
  }
  f.stats.queries['*'] = [{ ...f.stats, hidden: true }];
  assert.equal(f.collect().media.subtitle, undefined);
  f.window.location.href = `https://www.google.com/search?q=${'x'.repeat(1025)}`;
  assert.equal(f.collect(), null);
  f.window.location.href = `https://www.google.com/search?q=${'x'.repeat(1024)}`;
  assert.equal(f.collect().media.title.length, 256);
  f.root.hidden = true; assert.equal(f.collect(), null);
});

test('page elapsed time survives polling/tracking changes and resets on query, mode, or visibility changes', () => {
  const f = fixture(); f.collect(); f.state.page.startedAt -= 12000;
  assert.ok(f.collect().playback.position >= 12);
  f.window.location.href += '&tracking=changed'; assert.ok(f.collect().playback.position >= 12);
  f.window.location.href = 'https://www.google.com/search?q=another'; assert.ok(f.collect().playback.position < 1);
  f.state.page.startedAt -= 12000;
  f.window.location.href += '&udm=2'; assert.ok(f.collect().playback.position < 1);
  f.document.visibilityState = 'hidden'; assert.equal(f.collect(), null); assert.equal(f.state.page, undefined);
  f.document.visibilityState = 'visible'; assert.ok(f.collect().playback.position < 1);
  f.window.location.href += '&udm=28'; assert.equal(f.collect(), null); assert.equal(f.state.page, undefined);
  f.window.location.href = `https://www.google.com/search?q=${'x'.repeat(256)}a`;
  f.collect(); f.state.page.startedAt -= 12000;
  f.window.location.href = `https://www.google.com/search?q=${'x'.repeat(256)}b`;
  assert.ok(f.collect().playback.position < 1, 'A query change beyond the display limit must reset the session');
});

test('Google reports produce the requested names, text, Playing type and a real elapsed timestamp', () => {
  for (const mode of ['', '&udm=2', '&udm=50']) {
    const f = fixture(`https://www.google.com/search?q=test${mode}`);
    f.collect(); f.state.page.startedAt -= 11000;
    const r = f.collect(); const normalized = normalizeActivityReport(r, 2, configuration(), f.window.location.href);
    const intent = createPresenceIntent(normalized, 100000);
    assert.equal(intent.name, mode === '&udm=2' ? 'Google Images' : mode ? 'Google AI' : 'Google');
    assert.equal(intent.details, 'Searching for : test'); assert.equal(intent.type, 'playing');
    assert.equal(intent.state, mode ? '' : f.stats.textContent);
    assert.deepEqual(intent.timestamps, { start: 89 }); assert.equal(intent.assets.largeImage, logo);
    assert.equal(intent.statusDisplayType, 'name'); assert.ok(!intent.state.includes('Live'));
    const activity = buildHeadlessActivity(intent, '1549066134706323548');
    assert.equal(activity.name, intent.name); assert.equal(activity.type, 0);
    assert.equal(activity.state, mode ? undefined : f.stats.textContent); assert.equal(activity.status_display_type, 0);
    const hidden = createPresenceIntent(normalized, 100000, { showArtwork: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.equal(hidden.timestamps, null);
  }
  const f = fixture(); f.stats.hidden = true;
  assert.equal(createPresenceIntent(normalizeActivityReport(f.collect(), 2, configuration())).state, '');
});

test('worker validation rejects forged page routes, queries, timers and presentation fields', () => {
  const f = fixture(); const r = f.collect();
  for (const changed of [
    { ...r, routeId: 'unknown' }, { ...r, routeId: 'images' }, { ...r, activityName: 'Fake name' },
    { ...r, media: { ...r.media, title: 'Different query' } },
    { ...r, display: { details: 'Forged' } }, { ...r, artwork: { large: 'https://example.com/private.png' } },
    ...[{ live: true }, { duration: 120 }, { position: Infinity }, { state: 'paused' }, { rate: 2 }].map(playback => ({ ...r, playback: { ...r.playback, ...playback } })),
  ]) assert.throws(() => validateV2Report(changed, configuration(), f.window.location.href));
  assert.throws(() => validateV2Report(r, configuration(), 'https://www.google.com/search?q=test&udm=28'));
  const config = configuration(); config.page.elapsed = false;
  assert.throws(() => validateV2Report({ ...r, playback: { ...r.playback, position: 1 } }, config));
});

test('serialized page runtime reports and clears immediately on visibility change and cleans up listeners', async () => {
  const f = fixture(); const messages = []; const listeners = new Map(); let stopped = false;
  let finishFirst;
  const firstResponse = new Promise(resolve => { finishFirst = resolve; });
  f.window.top = f.window;
  f.window.addEventListener = () => {}; f.window.removeEventListener = () => {};
  f.document.addEventListener = (name, callback) => listeners.set(name, callback);
  f.document.removeEventListener = name => listeners.delete(name);
  const context = { window: f.window, document: f.document, location: f.window.location, URL,
    setInterval: () => 1, clearInterval: () => { stopped = true; }, setTimeout, clearTimeout,
    chrome: { runtime: {
      sendMessage: async message => { messages.push(message); if (messages.length === 1) await firstResponse; return { ok: true }; },
      connect: () => ({ onMessage: { addListener: callback => listeners.set('abort', callback) }, onDisconnect: { addListener() {} }, disconnect() {} }),
    } },
  };
  vm.runInNewContext(`(${runActivityV2.toString()})(${JSON.stringify(configuration())}, {activityId:'google',activityVersion:'1.0.0',capability:'test'}, ['https://www.google.com/search*'], [], () => true, ${collectActivityV2.toString()});`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).operation, 'presence.report');
  f.document.visibilityState = 'hidden'; listeners.get('visibilitychange')();
  // A visibility event arriving during a report must be queued immediately;
  // background timer throttling must not leave that report active.
  finishFirst();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(messages.at(-1).operation, 'presence.clear');
  f.document.visibilityState = 'visible'; listeners.get('visibilitychange')();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(messages.at(-1).operation, 'presence.report');
  listeners.get('abort')({ type: 'CHUDPRESENCE_ACTIVITY_ABORT', activityId: 'google', activityVersion: '1.0.0' });
  assert.equal(stopped, true); assert.equal(listeners.has('visibilitychange'), false);
});

test('Google package stays declarative, includes the official logo, and matches the tested configuration', async () => {
  const directory = new URL('../ChudPresence-Activities-V2/activities/google/', import.meta.url);
  let source;
  try { source = await fs.readFile(new URL('activity.json', directory), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.deepEqual(validateActivityV2(source), configuration());
  const metadata = validateV2Metadata(JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8')));
  assert.equal(metadata.id, 'google'); assert.equal(metadata.entry, 'activity.json');
  assert.equal(metadata.version, '1.0.1');
  assert.deepEqual(metadata.matches, ['https://www.google.com/*', 'https://google.com/*']);
  await assert.rejects(fs.access(new URL('activity.js', directory)));
  const icon = await fs.readFile(new URL('icon.png', directory));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(icon.length < 262144);
});
