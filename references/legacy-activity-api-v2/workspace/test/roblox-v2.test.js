import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { validateActivityV2, validateV2Metadata, validateV2Report, describeActivityV2, matchActivityV2Page } from '../extension/core/activity-api-v2.js';
import { collectActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';
import { buildHeadlessActivity } from '../extension/discord/activity-builder.js';

const logo = 'https://images.rbxcdn.com/905bd722ee0a6ceda3caacde54c0b081.png';
const configuration = () => ({ schemaVersion: 1, kind: 'generic', scope: '.container-main',
  fields: { title: { source: 'dom.text', selectors: ['h1.game-name'] } },
  page: { routes: [
    { id: 'landing', name: 'Roblox', paths: ['/'], query: {}, requiredQuery: [], scope: '#react-landing-container', title: 'Home', details: 'Browsing home' },
    { id: 'home', name: 'Roblox', paths: ['/home', '/home/'], query: {}, requiredQuery: [], title: 'Home', details: 'Browsing home' },
    { id: 'charts', name: 'Roblox', paths: ['/discover', '/discover/', '/charts', '/charts/', '/charts/{segment}', '/charts/{segment}/', '/games', '/games/'], query: {}, requiredQuery: [], scope: '#game-carousel-web-app', title: 'Charts', details: 'Browsing charts' },
    { id: 'experience', name: 'Roblox', paths: ['/games/{number}', '/games/{number}/', '/games/{number}/{segment}', '/games/{number}/{segment}/'], query: {}, requiredQuery: [], scope: '#game-detail-page', details: 'Viewing: {title}' },
    ...[
      ['marketplace', ['/catalog', '/catalog/', '/catalog/{number}', '/catalog/{number}/', '/catalog/{number}/{segment}', '/catalog/{number}/{segment}/'], 'Marketplace', 'Browsing marketplace'],
      ['robux', ['/upgrades/robux', '/upgrades/robux/'], 'Robux', 'Browsing Robux'],
      ['plus', ['/plus', '/plus/'], 'Roblox Plus', 'Browsing Roblox Plus'],
      ['profile', ['/users/profile', '/users/profile/', '/users/{number}/profile', '/users/{number}/profile/'], 'Profiles', 'Browsing profiles'],
      ['friends', ['/users/friends', '/users/friends/', '/users/{number}/friends', '/users/{number}/friends/'], 'Friends', 'Browsing friends'],
      ['avatar', ['/my/avatar', '/my/avatar/'], 'Avatar', 'Browsing avatar'],
      ['inventory', ['/users/inventory', '/users/inventory/', '/users/{number}/inventory', '/users/{number}/inventory/'], 'Inventory', 'Browsing inventory'],
      ['trades', ['/trades', '/trades/'], 'Trades', 'Browsing trades'],
      ['communities', ['/communities', '/communities/', '/communities/{number}', '/communities/{number}/', '/communities/{number}/{segment}', '/communities/{number}/{segment}/'], 'Communities', 'Browsing communities'],
      ['messages', ['/my/messages', '/my/messages/'], 'Messages', 'Browsing messages'],
      ['settings', ['/my/account', '/my/account/'], 'Settings', 'Browsing settings'],
      ['giftcards', ['/giftcards-us', '/giftcards-us/', '/giftcards', '/giftcards/'], 'Gift cards', 'Browsing gift cards'],
    ].map(([id, paths, title, details]) => ({ id, name: 'Roblox', paths, query: {}, requiredQuery: [], title, details })),
  ], elapsed: true, artwork: { large: logo, largeText: 'Roblox' } } });

function fixture(path = '/games/4924922222/Brookhaven-RP') {
  const queried = [];
  const title = { tagName: 'H1', textContent: 'Brookhaven 🏡RP', queries: {} };
  const main = { tagName: 'DIV', queries: {} };
  const landing = { tagName: 'DIV', queries: {} };
  const charts = { tagName: 'DIV', queries: {}, parentElement: main };
  const detail = { tagName: 'DIV', queries: { 'h1.game-name': [title] } };
  title.parentElement = detail;
  detail.parentElement = main;
  for (const element of [title, main, landing, charts, detail]) Object.assign(element, {
    nodeType: 1,
    closest() { return this.sensitive ? this : null; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    querySelector() { return this.sensitiveChild ? {} : null; },
    querySelectorAll(selector) { queried.push(selector); return this.queries[selector] || []; },
  });
  const roots = { '.container-main': [main], '#react-landing-container': [landing], '#game-carousel-web-app': [charts], '#game-detail-page': [detail] };
  const document = { visibilityState: 'visible', body: {}, documentElement: {},
    querySelectorAll(selector) { queried.push(selector); return roots[selector] || []; } };
  const window = { location: { href: `https://www.roblox.com${path}` },
    getComputedStyle: element => ({ display: element.cssHidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) };
  const state = {};
  const collect = (config = configuration()) => collectActivityV2(config, document, window, state);
  return { title, main, landing, charts, detail, document, window, state, queried, collect };
}

test('bounded page tokens, static titles and route containers validate without widening selectors', () => {
  assert.deepEqual(validateActivityV2(JSON.stringify(configuration())), configuration());
  for (const mutate of [
    c => { c.page.routes[0].title = '{title}'; }, c => { c.page.routes[0].title = '  Roblox'; },
    c => { c.page.routes[0].title = 'Roblox\nHomepage'; }, c => { c.page.routes[0].scope = 'body'; },
    c => { c.page.routes[0].scope = '#private input'; }, c => { c.page.routes[0].scope = '#main, #other'; },
    ...['/*', '/games/{id}', '/games/{number}x', '/games/*/{segment}', '/games//{number}', '/games/{segment...}', '/games/../{number}'].map(path => c => { c.page.routes[0].paths = [path]; }),
  ]) { const c = configuration(); mutate(c); assert.throws(() => validateActivityV2(JSON.stringify(c))); }
  const review = describeActivityV2({ matches: ['https://www.roblox.com/*'] }, JSON.stringify(configuration()));
  assert.match(review, /static title Home \(title extraction skipped\)/);
  assert.match(review, /container #game-detail-page/);
  assert.match(review, /\{number\} is 1–25 digits/);
  const limit = configuration();
  while (limit.page.routes.length < 32) limit.page.routes.push({ ...limit.page.routes[1], id: `extra-${limit.page.routes.length}` });
  validateActivityV2(JSON.stringify(limit));
  limit.page.routes.push({ ...limit.page.routes[1], id: 'too-many' });
  assert.throws(() => validateActivityV2(JSON.stringify(limit)), /one to thirty-two routes/);
});

test('collector and serialized worker agree on supported Roblox routes and reject unrelated paths', () => {
  const workerMatch = vm.runInNewContext(`(${matchActivityV2Page.toString()})`, { URL });
  for (const [path, id] of [
    ['/', 'landing'], ['/home', 'home'], ['/home/', 'home'],
    ['/discover?Keyword=Life', 'charts'], ['/charts/', 'charts'], ['/games', 'charts'],
    ['/charts/trending-in-roleplay-and-avatar-sim', 'charts'],
    ['/games/4924922222', 'experience'], ['/games/4924922222/', 'experience'],
    ['/games/4924922222/Brookhaven-RP/', 'experience'], ['/games/123/%E7%8C%AB', 'experience'],
    ['/catalog?Keyword=PRIVATE', 'marketplace'], ['/catalog/123/Test-Hat', 'marketplace'],
    ['/upgrades/robux?ctx=navpopover', 'robux'], ['/plus', 'plus'],
    ['/users/profile', 'profile'], ['/users/123/profile', 'profile'],
    ['/users/friends#!/friend-requests', 'friends'], ['/users/123/friends/', 'friends'],
    ['/my/avatar', 'avatar'], ['/users/inventory', 'inventory'], ['/users/123/inventory#!/hats', 'inventory'],
    ['/trades#!/inbound', 'trades'], ['/communities', 'communities'], ['/communities/123/Example', 'communities'],
    ['/my/messages/#!/inbox', 'messages'], ['/my/account#!/privacy', 'settings'], ['/giftcards-us', 'giftcards'],
  ]) {
    const f = fixture(path); assert.equal(f.collect()?.routeId, id, path);
    assert.equal(matchActivityV2Page(configuration(), f.window.location.href)?.id, id, path);
    assert.equal(workerMatch(configuration(), f.window.location.href)?.id, id, path);
  }
  for (const path of ['/login', '/CreateAccount', '/develop', '/create', '/upgrades/paymentmethods',
    '/users/PRIVATE/profile', '/users/123/unknown', '/catalog/private', '/catalog/123/item/extra', '/communities/123/name/extra',
    '/games/not-an-id/Brookhaven', '/games/123/slug/extra', '/games/123/slug%2Fextra', '/games/123/slug%5Cextra', '/games/123/%', '/games/123/%ZZ',
    `/games/${'1'.repeat(26)}`, `/games/123/${'a'.repeat(257)}`, '/charts/category/extra', '/home/private', '/en-us/games/123/Example']) {
    const f = fixture(path); assert.equal(f.collect(), null, path);
    assert.equal(matchActivityV2Page(configuration(), f.window.location.href), null, path);
    assert.equal(workerMatch(configuration(), f.window.location.href), null, path);
  }
  for (const href of ['http://www.roblox.com/home', 'https://user:pass@www.roblox.com/home', 'https://www.roblox.com:8443/home']) {
    const f = fixture(); f.window.location.href = href;
    assert.equal(f.collect(), null); assert.equal(workerMatch(configuration(), href), null);
  }
});

test('static browsing reads no title text; experience reads only its visible scoped heading', () => {
  for (const path of ['/', '/home', '/charts', '/catalog', '/upgrades/robux', '/plus', '/users/profile', '/users/friends',
    '/my/avatar', '/users/inventory', '/trades', '/communities', '/my/messages', '/my/account', '/giftcards-us']) {
    const f = fixture(path);
    Object.defineProperty(f.title, 'textContent', { get() { throw new Error('Browsing must skip title extraction'); } });
    assert.ok(f.collect()); assert.ok(!f.queried.includes('h1.game-name'));
  }
  const f = fixture(); f.title.textContent = '  Brookhaven\n 🏡RP  ';
  assert.equal(f.collect().media.title, 'Brookhaven 🏡RP');
  assert.equal(f.queried[0], '#game-detail-page');
  for (const properties of [{ hidden: true }, { sensitive: true }, { cssHidden: true }, { sensitiveChild: true }]) {
    const g = fixture(); Object.assign(g.title, properties);
    Object.defineProperty(g.title, 'textContent', { get() { throw new Error('Rejected heading must never be read'); } });
    assert.equal(g.collect(), null);
  }
  f.title.queries['*'] = [{ ...f.title, hidden: true }]; assert.equal(f.collect(), null);
  f.title.queries['*'] = []; f.title.textContent = ''; assert.equal(f.collect(), null);
  f.title.textContent = 'x'.repeat(1025); assert.equal(f.collect(), null);
  f.title.textContent = 'x'.repeat(1024); assert.equal(f.collect().media.title.length, 256);
  f.detail.hidden = true; assert.equal(f.collect(), null);
  const home = fixture('/'); home.landing.hidden = true; assert.equal(home.collect(), null);
  const charts = fixture('/charts'); charts.charts.hidden = true; assert.equal(charts.collect(), null);
  charts.charts.hidden = false; assert.equal(charts.collect().media.title, 'Charts');
});

test('Roblox page session resets on experience identity and hiding, retaining tracking and fragment changes', () => {
  const f = fixture(); f.collect(); f.state.page.startedAt -= 12000;
  f.window.location.href += '?tracking=SECRET#store'; assert.ok(f.collect().playback.position >= 12);
  f.window.location.href = 'https://www.roblox.com/games/777/Brookhaven-RP'; assert.ok(f.collect().playback.position < 1);
  f.state.page.startedAt -= 12000; f.title.textContent = 'Another experience'; assert.ok(f.collect().playback.position < 1);
  f.document.visibilityState = 'hidden'; assert.equal(f.collect(), null); assert.equal(f.state.page, undefined);
  f.document.visibilityState = 'visible'; assert.ok(f.collect().playback.position < 1);
  f.window.location.href = 'https://www.roblox.com/develop'; assert.equal(f.collect(), null); assert.equal(f.state.page, undefined);
});

test('Roblox produces requested Discord details, static artwork, elapsed time and normal preferences', () => {
  for (const [path, details] of [['/', 'Browsing home'], ['/home', 'Browsing home'], ['/charts', 'Browsing charts'],
    ['/catalog', 'Browsing marketplace'], ['/upgrades/robux', 'Browsing Robux'], ['/plus', 'Browsing Roblox Plus'],
    ['/users/profile', 'Browsing profiles'], ['/users/friends', 'Browsing friends'], ['/my/avatar', 'Browsing avatar'],
    ['/users/inventory', 'Browsing inventory'], ['/trades', 'Browsing trades'], ['/communities', 'Browsing communities'],
    ['/my/messages/#!/inbox', 'Browsing messages'], ['/my/account#!/privacy', 'Browsing settings'], ['/giftcards-us', 'Browsing gift cards'],
    ['/games/4924922222/Brookhaven-RP', 'Viewing: Brookhaven 🏡RP']]) {
    const f = fixture(path); f.collect(); f.state.page.startedAt -= 11000;
    const r = f.collect(); const normalized = normalizeActivityReport(r, 2, configuration(), f.window.location.href);
    const presence = createPresenceIntent(normalized, 100000);
    assert.equal(presence.name, 'Roblox'); assert.equal(presence.details, details); assert.equal(presence.state, '');
    assert.equal(presence.assets.largeImage, logo); assert.deepEqual(presence.timestamps, { start: 89 });
    const activity = buildHeadlessActivity(presence, '1549066134706323548');
    assert.equal(activity.type, 0); assert.equal(activity.details, details); assert.equal(activity.state, undefined);
    assert.ok(!JSON.stringify(activity).includes('tracking'));
    const hidden = createPresenceIntent(normalized, 100000, { showArtwork: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.equal(hidden.timestamps, null);
  }
});

test('worker rejects forged static titles, routes, page overrides and timers', () => {
  const f = fixture('/home'); const r = f.collect();
  for (const changed of [
    { ...r, media: { title: 'Forged' } }, { ...r, routeId: 'experience' },
    { ...r, activityName: 'Forged' }, { ...r, display: { details: 'Forged' } },
    { ...r, artwork: { large: 'https://example.com/private.png' } },
    { ...r, media: { ...r.media, creator: 'PRIVATE' } },
    { ...r, playback: { ...r.playback, duration: 120 } },
  ]) assert.throws(() => validateV2Report(changed, configuration(), f.window.location.href));
  assert.throws(() => validateV2Report(r, configuration(), 'https://www.roblox.com/develop'));
  const config = configuration(); config.fields.title = { source: 'url.query', parameter: 'q' };
  assert.equal(validateV2Report(r, config, f.window.location.href), r, 'Static titles override URL title extraction too');
  f.collect(config); f.state.page.startedAt -= 12000; f.window.location.href += '?q=unused';
  assert.ok(f.collect(config).playback.position >= 12, 'An overridden query title must not change the browsing session');
  config.page.elapsed = false; assert.equal(f.collect(config).playback.position, 0);
});

test('Roblox package is declarative V2, matches the tested rules and includes official PNG artwork', async () => {
  const directory = new URL('../ChudPresence-Activities-V2/activities/roblox/', import.meta.url);
  let source;
  try { source = await fs.readFile(new URL('activity.json', directory), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.deepEqual(validateActivityV2(source), configuration());
  const metadata = validateV2Metadata(JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8')));
  assert.equal(metadata.id, 'roblox'); assert.equal(metadata.apiVersion, 2); assert.equal(metadata.icon, 'icon.png');
  assert.equal(metadata.version, '1.1.0');
  assert.deepEqual(metadata.matches, ['https://www.roblox.com/*', 'https://roblox.com/*']);
  await assert.rejects(fs.access(new URL('activity.js', directory)));
  const icon = await fs.readFile(new URL('icon.png', directory));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(icon.length < 262144);
});
