import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { validateActivityMetadata, validateActivityPackageSource } from '../extension/core/activity-validator.js';
import { activityV2Digest, validateActivityV2, validateV2Selector } from '../extension/core/activity-api-v2.js';
import { collectActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { downloadActivity, validateCatalog } from '../extension/core/activity-repository.js';

const metadata = { id: 'public-player', name: 'Public Player', description: 'Public media playback.', apiVersion: 2, version: '1.0.0', entry: 'activity.json', matches: ['https://example.com/watch/*'] };
const configuration = () => ({ schemaVersion: 1, kind: 'video', scope: '#player', fields: {
  title: { source: 'dom.text', selectors: ['.missing', '.title'] },
  creator: { source: 'dom.attribute', selectors: ['.author'], attribute: 'title' },
}, player: { adapter: 'html-media', selectors: ['video'] } });
async function approvedPackage(overrides = {}) {
  const activityPackage = { metadata: structuredClone(metadata), source: JSON.stringify(configuration()), sourceType: 'local', ...overrides };
  activityPackage.approval = { digest: await activityV2Digest(activityPackage) };
  return activityPackage;
}
function fixture() {
  const data = {};
  const scripts = new Map();
  const reports = [];
  const clears = [];
  const worldOptions = [];
  const executions = [];
  let allowed = true;
  let failWrite = false;
  let documentUrl = '';
  const api = {
    runtime: { getManifest: () => ({ version: '2.0.0' }) },
    storage: { local: {
      async get(key) { return structuredClone(key == null ? data : { [key]: data[key] }); },
      async set(value) { if (failWrite) { failWrite = false; throw new Error('storage failed'); } Object.assign(data, structuredClone(value)); },
      async remove(keys) { for (const key of keys) delete data[key]; },
    } },
    permissions: { async contains() { return allowed; }, async remove() { return true; } },
    userScripts: {
      async getScripts() { return [...scripts.values()]; },
      async configureWorld(value) { worldOptions.push(value); },
      async register(values) { for (const value of values) scripts.set(value.id, value); },
      async update(values) { for (const value of values) scripts.set(value.id, value); },
      async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
      async execute(options) {
        executions.push(options);
        return options.target.documentIds && documentUrl
          ? [{ documentId: options.target.documentIds[0], frameId: 0, result: documentUrl }] : [];
      },
    },
  };
  const manager = new ActivityManager({ api, onReport: (...args) => reports.push(args), onClear: (...args) => clears.push(args) });
  const sender = { tab: { id: 7 }, frameId: 0, documentId: 'document-7', url: 'https://example.com/watch/1', userScriptWorldId: 'chudpresence.activity.public-player' };
  const request = (operation, payload = {}) => {
    const record = manager.records['public-player'];
    return { type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: metadata.id, activityVersion: record.metadata.version, apiVersion: 2, capability: record.capability, requestId: 'probe', operation, payload };
  };
  return { api, manager, data, scripts, reports, clears, worldOptions, executions, sender, request,
    setDocumentUrl: (url) => { documentUrl = url; }, revoke: () => { allowed = false; }, failWrite: () => { failWrite = true; } };
}

test('V2 rejects executable sources, unknown operations, and JSON wrapper escapes', () => {
  assert.equal(validateActivityMetadata(metadata).entry, 'activity.json');
  for (const fields of [{ entry: 'activity.js' }, { network: [] }, { frames: 'all' }, { executionWorld: 'MAIN' }, { capabilities: ['page.execute'] }, { settings: [] }]) {
    assert.throws(() => validateActivityMetadata({ ...metadata, ...fields }));
  }
  for (const source of ['fetch("https://outside.example/")', '}; })(); globalThis.escaped = true; (() => {', JSON.stringify({ ...configuration(), code: 'alert(1)' })]) {
    assert.throws(() => validateActivityPackageSource(source, metadata));
  }
  for (const config of [
    { ...configuration(), fields: { title: { source: 'page.execute', selectors: ['.title'] } } },
    { ...configuration(), fields: { title: { source: 'dom.attribute', selectors: ['.title'], attribute: 'value' } } },
    { ...configuration(), player: { adapter: 'custom', selectors: ['video'] } },
    { ...configuration(), artwork: { large: 'https://outside.example/' } },
  ]) assert.throws(() => validateActivityV2(JSON.stringify(config)));
});

test('V2 disallows broad, protected, local, and noncanonical host patterns', () => {
  for (const host of ['*', '*.example.com', 'discord.com', 'auth.discord.com', '127.0.0.1', '127.1', '0x7f.0.0.1', 'localhost', 'host.local', 'printer.home.arpa', '[::1]', 'example.com:8443']) {
    assert.throws(() => validateActivityMetadata({ ...metadata, matches: [`https://${host}/*`] }), host);
  }
  for (const selector of ['body', '*', 'input', '[data-secret]', '.title:has(input)', '.title + .secret', 'script', '.title\\20 span', '.title, .secret', '.title >']) assert.throws(() => validateV2Selector(selector), selector);
});

test('immutable catalog downloads validate and install V2 JSON with source-bound approval', async () => {
  const f = fixture();
  const activityPackage = await approvedPackage();
  const metadataText = JSON.stringify(activityPackage.metadata);
  const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const revision = 'b'.repeat(40);
  const entry = { ...metadata, catalogSource: { repository: 'ChudForks/ChudPresence-Activities-V2', revision }, entry: `activities/${metadata.id}/activity.json`, metadata: `activities/${metadata.id}/metadata.json`, sha256: await hash(activityPackage.source), metadataSha256: await hash(metadataText) };
  const catalog = validateCatalog({ schemaVersion: 1, revision, activities: [entry] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes(`/${revision}/`));
    assert.ok(String(url).startsWith('https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities-V2/'));
    return new Response(String(url).endsWith('/metadata.json') ? metadataText : activityPackage.source);
  };
  try {
    const downloaded = await downloadActivity(metadata.id, catalog);
    assert.equal(downloaded.metadata.apiVersion, 2);
    downloaded.approval = { digest: await activityV2Digest(downloaded) };
    await f.manager.install(downloaded);
    assert.equal(f.manager.records[metadata.id].source.repository, 'ChudForks/ChudPresence-Activities-V2');
    assert.equal(f.manager.records[metadata.id].source.revision, revision);
    assert.ok(f.manager.records[metadata.id].approval);
  } finally { globalThis.fetch = originalFetch; }
});

test('repository installation binds each Activity API to its own official repository', async () => {
  const f = fixture();
  for (const apiVersion of [1, 2]) {
    const packageMetadata = { ...metadata, apiVersion, entry: apiVersion === 2 ? 'activity.json' : 'activity.js' };
    const source = apiVersion === 2 ? JSON.stringify(configuration()) : 'ChudPresence.clear();';
    for (const repository of [apiVersion === 2 ? 'ChudForks/ChudPresence-Activities' : 'ChudForks/ChudPresence-Activities-V2',
      'Other/ChudPresence-Activities-V2', 'ChudForks/ChudPresence-Activities-V2-extra']) {
      await assert.rejects(f.manager.install({ metadata: packageMetadata, source, metadataSource: JSON.stringify(packageMetadata),
        sourceType: 'repository', provenance: { repository, revision: 'a'.repeat(40), codeSha256: 'b'.repeat(64), metadataSha256: 'c'.repeat(64) } }),
      /missing valid immutable provenance/);
    }
  }
  assert.equal(Object.keys(f.data.installedActivities || {}).length, 0);
});

test('V2 requires exact-byte approval and never interpolates package source as code', async () => {
  const f = fixture();
  const activityPackage = await approvedPackage();
  await assert.rejects(f.manager.install({ ...activityPackage, approval: undefined }), /approve/);
  await assert.rejects(f.manager.install({ ...activityPackage, source: activityPackage.source + ' ' }), /exact/);
  await f.manager.install(activityPackage);
  const script = f.scripts.values().next().value;
  assert.equal(script.allFrames, false);
  assert.ok(f.worldOptions[0].csp.includes("connect-src 'none'"));
  // A literal string that resembles executable code stays quoted data.
  const config = configuration();
  config.fields.title.removePrefix = '"); globalThis.escaped = true; //';
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, version: '1.1.0' }, source: JSON.stringify(config) }));
  const context = { window: {}, location: { href: 'https://outside.example/' }, URL };
  context.window.top = context.window;
  vm.runInNewContext(f.scripts.values().next().value.js[0].code, context);
  assert.equal(context.escaped, undefined);
  assert.match(script.js[0].code, /runActivityV2/);
});

test('V2 denies privileged bridge calls, raw presence URLs, wrong frames, and revoked origins', async () => {
  const f = fixture();
  await f.manager.install(await approvedPackage());
  for (const operation of ['page.execute', 'net.fetch', 'storage.get', 'settings.getAll', 'log.write', 'lifecycle.upgradeComplete']) {
    assert.equal((await f.manager.handleUserScriptMessage(f.request(operation), f.sender)).error.code, 'permission_denied');
  }
  const report = { kind: 'video', media: { title: 'Approved media' }, playback: { state: 'playing' } };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), { ...f.sender, frameId: 1 })).error.code, 'permission_denied');
  for (const fields of [{ artwork: { large: 'https://outside.example/' } }, { buttons: [{ label: 'Open', url: 'https://outside.example/' }] }, { display: { detailsUrl: 'https://outside.example/' } }, { media: { title: 'Media', artist: 'Undeclared field' } }]) {
    const result = await f.manager.handleUserScriptMessage(f.request('presence.report', { report: { ...report, ...fields } }), f.sender);
    assert.equal(result.error.code, 'invalid_report');
  }
  f.manager.records[metadata.id].permissionMissing = true;
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), f.sender)).error.code, 'permission_denied');
  delete f.manager.records[metadata.id].permissionMissing;
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), f.sender)).ok, true);
  assert.equal(f.reports.length, 1);
  f.revoke();
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), f.sender)).error.code, 'permission_denied');
  assert.equal(f.reports.length, 1);
});

test('approved Prime details reports preserve episode numbers, artwork and formatting through the worker', async () => {
  const f = fixture();
  const config = { schemaVersion: 1, kind: 'video', scope: '.dv-player-fullscreen', fields: {
    title: { source: 'dom.text', selectors: ['.atvwebplayersdk-title-text'] },
    subtitle: { source: 'dom.text', selectors: ['.atvwebplayersdk-episode-info'] },
  }, player: { adapter: 'prime-video', metadata: 'prime-video-details', selectors: ['.atvwebplayersdk-video-surface video'] } };
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, matches: ['https://www.amazon.com/gp/video/*'] }, source: JSON.stringify(config) }));
  const sender = { ...f.sender, url: 'https://www.amazon.com/gp/video/detail/episode-1' };
  const report = { kind: 'episode', media: { title: 'The Heart of The Cards', series: 'Yu-Gi-Oh!', season: 1, episode: 1, subtitle: 'Season 1, Episode 1' },
    playback: { state: 'playing', position: 90, duration: 1246.432 },
    artwork: { large: `https://m.media-amazon.com/images/S/pv-target-images/${'a'.repeat(64)}._SX720_FMjpg_.jpg`, largeText: 'Season 1, Episode 1 • The Heart of The Cards' } };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), sender)).ok, true);
  const track = f.reports.at(-1)[0].track;
  assert.equal(track.media.episode, 1); assert.equal(track.artwork.large, report.artwork.large);
  assert.equal(track.display.details, 'The Heart of The Cards');
  assert.equal(track.display.state, 'Yu-Gi-Oh!');
  for (const change of [
    { artwork: { large: 'https://outside.example/image.jpg', largeText: report.artwork.largeText } },
    { display: { stateUrl: 'https://outside.example/' } },
    { media: { ...report.media, episode: -1 } },
    { media: { ...report.media, artist: 'Undeclared private field' } },
  ]) assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: { ...report, ...change } }), sender)).error.code, 'invalid_report');
});

test('approved page packages install and restore without a player and preserve the route name through the worker', async () => {
  const f = fixture();
  const config = { schemaVersion: 1, kind: 'generic', scope: '#main', fields: { title: { source: 'url.query', parameter: 'q' } },
    page: { elapsed: true, routes: [{ id: 'images', paths: ['/search'], query: { udm: ['2'] }, requiredQuery: ['q'],
      name: 'Google Images', details: 'Searching for : {title}' }] } };
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, name: 'Google', matches: ['https://www.google.com/search*'] }, source: JSON.stringify(config) }));
  const sender = { ...f.sender, url: 'https://www.google.com/search?q=test&udm=2' };
  f.setDocumentUrl(sender.url);
  const report = { kind: 'generic', routeId: 'images', media: { title: 'test' },
    playback: { state: 'playing', position: 11, duration: 0, live: false, rate: 1 } };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), sender)).ok, true);
  assert.equal(f.reports.at(-1)[0].track.activityName, 'Google Images');
  assert.equal(f.reports.at(-1)[0].track.display.details, 'Searching for : test');
  f.setDocumentUrl('https://www.google.com/search?q=test&udm=28');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), { ...sender, url: 'https://www.google.com/search?q=test&udm=28' })).error.code, 'invalid_report');
  const restored = new ActivityManager({ api: f.api });
  assert.equal((await restored.restoreAll()).restored, 1);
});

test('approved browsing and bounded detail routes install, publish, hand off and restore through the worker', async () => {
  const f = fixture();
  const config = { schemaVersion: 1, kind: 'generic', scope: '.container-main',
    fields: { title: { source: 'dom.text', selectors: ['h1.game-name'] } }, page: { elapsed: true, routes: [
      { id: 'home', paths: ['/home'], query: {}, requiredQuery: [], name: 'Roblox', title: 'Roblox', details: 'Browsing Roblox' },
      { id: 'experience', paths: ['/games/{number}/{segment}'], query: {}, requiredQuery: [], name: 'Roblox', scope: '#game-detail-page', details: 'Viewing: {title}' },
    ] } };
  config.page.routes.push(...[
    ['charts', '/charts', 'Charts', 'Browsing charts'], ['marketplace', '/catalog', 'Marketplace', 'Browsing marketplace'],
    ['robux', '/upgrades/robux', 'Robux', 'Browsing Robux'], ['plus', '/plus', 'Roblox Plus', 'Browsing Roblox Plus'],
    ['avatar', '/my/avatar', 'Avatar', 'Browsing avatar'], ['trades', '/trades', 'Trades', 'Browsing trades'],
    ['communities', '/communities', 'Communities', 'Browsing communities'],
  ].map(([id, path, title, details]) => ({ id, paths: [path], query: {}, requiredQuery: [], name: 'Roblox', title, details })));
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, name: 'Roblox', matches: ['https://www.roblox.com/*'] }, source: JSON.stringify(config) }));
  const sender = { ...f.sender, url: 'https://www.roblox.com/home' };
  f.setDocumentUrl(sender.url);
  const report = { kind: 'generic', routeId: 'home', media: { title: 'Roblox' },
    playback: { state: 'playing', position: 11, duration: 0, live: false, rate: 1 } };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), sender)).ok, true);
  assert.equal(f.reports.at(-1)[0].track.display.details, 'Browsing Roblox');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: { ...report, media: { title: 'Forged' } } }), sender)).error.code, 'invalid_report');
  const navigationUrl = 'https://www.roblox.com/games/4924922222/Brookhaven-RP';
  await f.manager.handleUserScriptMessage(f.request('presence.clear', { closing: true, navigationUrl }), sender);
  assert.deepEqual(f.clears.at(-1)[4], { closing: true, navigating: true });
  const detail = { ...report, routeId: 'experience', media: { title: 'Brookhaven 🏡RP' } };
  f.setDocumentUrl(navigationUrl);
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: detail }), { ...sender, url: navigationUrl })).ok, true);
  assert.equal(f.reports.at(-1)[0].track.display.details, 'Viewing: Brookhaven 🏡RP');
  const marketReport = { ...report, routeId: 'marketplace', media: { title: 'Marketplace' } };
  f.setDocumentUrl('https://www.roblox.com/catalog');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: marketReport }), { ...sender, url: 'https://www.roblox.com/catalog' })).ok, true);
  assert.equal(f.reports.at(-1)[0].track.display.details, 'Browsing marketplace');
  f.setDocumentUrl('https://www.roblox.com/my/messages');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: detail }), { ...sender, url: 'https://www.roblox.com/my/messages' })).error.code, 'invalid_report');
  const restored = new ActivityManager({ api: f.api });
  assert.equal((await restored.restoreAll()).restored, 1);
});

test('only an approved same-origin page destination can request a navigation handoff', async () => {
  const config = { schemaVersion: 1, kind: 'generic', scope: '#main', fields: { title: { source: 'url.query', parameter: 'q' } },
    page: { elapsed: true, routes: ['search', 'images'].map((id, i) => ({ id, paths: ['/search'], query: { udm: [i ? '2' : ''] },
      requiredQuery: ['q'], name: i ? 'Google Images' : 'Google', details: 'Searching for : {title}' })) } };
  for (const [destination, navigating] of [
    ['https://www.google.com/search?q=test&udm=2', true],
    ['https://www.google.com/search?q=test&udm=28', false],
    ['https://google.com/search?q=test&udm=2', false],
    ['https://www.google.com.evil.example/search?q=test&udm=2', false],
    ['https://www.google.com/search?q=test&udm=2&excluded=true', false],
    ['https://user:password@www.google.com/search?q=test&udm=2', false],
    ['invalid URL', false],
  ]) {
    const f = fixture();
    await f.manager.install(await approvedPackage({ source: JSON.stringify(config), metadata: { ...metadata,
      matches: ['https://www.google.com/search*', 'https://google.com/search*'], excludeMatches: ['https://www.google.com/*excluded=true*'] } }));
    const sender = { ...f.sender, url: 'https://www.google.com/search?q=test' };
    f.setDocumentUrl(sender.url);
    const report = { kind: 'generic', routeId: 'search', media: { title: 'test' },
      playback: { state: 'playing', position: 0, duration: 0, live: false, rate: 1 } };
    await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), sender);
    const response = await f.manager.handleUserScriptMessage(f.request('presence.clear', { closing: true, navigationUrl: destination }), sender);
    assert.equal(response.ok, true, destination);
    assert.deepEqual(f.clears.at(-1)[4], { closing: true, ...(navigating ? { navigating: true } : {}) }, destination);
  }
});

const pageConfiguration = () => ({ schemaVersion: 1, kind: 'generic', scope: '.container-main',
  fields: { title: { source: 'dom.text', selectors: ['h1.game-name'] } },
  page: { elapsed: true, routes: [
    ['home', '/home', 'Home', 'Browsing home'], ['charts', '/charts', 'Charts', 'Browsing charts'],
    ['marketplace', '/catalog', 'Marketplace', 'Browsing marketplace'], ['robux', '/upgrades/robux', 'Robux', 'Browsing Robux'],
  ].map(([id, path, title, details]) => ({ id, paths: [path], query: {}, requiredQuery: [], name: 'Roblox', title, details })) } });
const browsingReport = (route) => ({ kind: 'generic', routeId: route.id, media: { title: route.title },
  playback: { state: 'playing', position: 1, duration: 0, live: false, rate: 1 } });

test('Roblox SPA navigation publishes Home, Charts, Marketplace, Robux and returns with a frozen sender URL', async () => {
  const f = fixture(); const config = pageConfiguration();
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, name: 'Roblox', matches: ['https://www.roblox.com/*'] }, source: JSON.stringify(config) }));
  // This is the observed Chromium USER_SCRIPT context: sender.url stays on
  // /catalog while the same browser document moves to Home and Charts.
  const sender = { ...f.sender, url: 'https://www.roblox.com/catalog', tab: { ...f.sender.tab, url: 'https://outside.example/home' } };
  for (const id of ['home', 'charts', 'marketplace', 'robux', 'home', 'charts', 'home']) {
    const route = config.page.routes.find(candidate => candidate.id === id);
    const href = 'https://www.roblox.com' + route.paths[0]; f.setDocumentUrl(href);
    const response = await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(route) }), sender);
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(f.reports.at(-1)[0].track.display.details, route.details);
    assert.equal(f.reports.at(-1)[0].senderUrl, href);
  }
  assert.equal(f.reports.length, 7);
  for (const execution of f.executions) {
    assert.deepEqual(execution.target, { tabId: sender.tab.id, documentIds: [sender.documentId] });
    assert.equal(execution.world, 'USER_SCRIPT'); assert.equal(execution.worldId, sender.userScriptWorldId);
    assert.equal(execution.js[0].code, 'globalThis.location.href');
  }
  f.setDocumentUrl('https://www.roblox.com/charts');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender)).error.code, 'invalid_report');
  f.setDocumentUrl('https://www.roblox.com/develop');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender)).error.code, 'invalid_report');
});

test('page URL query validation uses the verified document URL after same-route search navigation', async () => {
  const f = fixture(); const config = { schemaVersion: 1, kind: 'generic', scope: '#main',
    fields: { title: { source: 'url.query', parameter: 'q' } },
    page: { elapsed: true, routes: [{ id: 'search', paths: ['/search'], query: {}, requiredQuery: ['q'], name: 'Google', details: 'Searching for : {title}' }] } };
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, matches: ['https://www.google.com/search*'] }, source: JSON.stringify(config) }));
  const sender = { ...f.sender, url: 'https://www.google.com/search?q=old' };
  f.setDocumentUrl('https://www.google.com/search?q=new');
  const report = { ...browsingReport({ id: 'search', title: 'new' }) };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report }), sender)).ok, true);
  assert.equal(f.reports.at(-1)[0].track.display.details, 'Searching for : new');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: { ...report, media: { title: 'old' } } }), sender)).error.code, 'invalid_report');
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: { ...report, url: sender.url } }), sender)).error.code, 'invalid_report');
});

test('page URL verification rejects unavailable, replaced and child documents without a sender/tab URL fallback', async () => {
  const f = fixture(); const config = pageConfiguration();
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, matches: ['https://www.roblox.com/*'] }, source: JSON.stringify(config) }));
  const sender = { ...f.sender, url: 'https://www.roblox.com/home', tab: { ...f.sender.tab, url: 'https://www.roblox.com/home' } };
  const result = { documentId: sender.documentId, frameId: 0, result: sender.url };
  for (const results of [[], [{ ...result, documentId: 'replaced-document' }], [{ ...result, frameId: 1 }],
    [{ ...result, error: 'Unavailable' }], [{ ...result, result: { href: sender.url } }], [result, result]]) {
    f.api.userScripts.execute = async () => results;
    assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender)).error.code, 'stale_document');
  }
  f.api.userScripts.execute = async () => { throw new Error('Document replaced'); };
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender)).error.code, 'stale_document');
  f.api.userScripts.execute = async () => [{ ...result, result: 'https://outside.example/home' }];
  assert.equal((await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender)).error.code, 'invalid_report');
  assert.equal(f.reports.length, 0);
});

test('revocation or a generation change during page URL verification prevents publication', async () => {
  for (const change of ['permission', 'generation']) {
    const f = fixture(); const config = pageConfiguration();
    await f.manager.install(await approvedPackage({ metadata: { ...metadata, matches: ['https://www.roblox.com/*'] }, source: JSON.stringify(config) }));
    const sender = { ...f.sender, url: 'https://www.roblox.com/home' };
    f.api.userScripts.execute = async () => {
      if (change === 'permission') f.revoke();
      else f.manager.records[metadata.id] = { ...f.manager.records[metadata.id] };
      return [{ documentId: sender.documentId, frameId: 0, result: sender.url }];
    };
    const response = await f.manager.handleUserScriptMessage(f.request('presence.report', { report: browsingReport(config.page.routes[0]) }), sender);
    assert.equal(response.error.code, 'permission_denied'); assert.equal(f.reports.length, 0);
  }
});

test('V2 changes need a new version and approval; restarts reject altered stored bytes', async () => {
  const f = fixture();
  const original = await approvedPackage();
  await f.manager.install(original);
  const oldRequest = f.request('presence.clear');
  await assert.rejects(f.manager.install(await approvedPackage({ source: original.source + '\n' })), /higher version/);
  const update = await approvedPackage({ metadata: { ...metadata, version: '1.1.0' } });
  f.failWrite();
  await assert.rejects(f.manager.install(update), /storage failed/);
  assert.equal(f.manager.records[metadata.id].metadata.version, '1.0.0');
  await f.manager.install(update);
  assert.equal(await f.manager.handleUserScriptMessage(oldRequest, f.sender), false);
  const restored = new ActivityManager({ api: f.api });
  assert.equal((await restored.restoreAll()).restored, 1);
  f.data.installedActivities[metadata.id].code += ' ';
  const corrupted = new ActivityManager({ api: f.api });
  assert.equal((await corrupted.restoreAll()).restored, 0);
  assert.match(corrupted.records[metadata.id].error, /approved bytes/);
  assert.equal(f.scripts.size, 0);
  assert.equal((await corrupted.handleUserScriptMessage(f.request('presence.report', { report: { kind: 'video', media: { title: 'Old live script' }, playback: { state: 'playing' } } }), f.sender)).error.code, 'permission_denied');
});

test('V2 cannot replace a V1 identity and V1 cannot replace V2', async () => {
  const f = fixture();
  await f.manager.install(await approvedPackage());
  const v1 = { metadata: { ...metadata, apiVersion: 1, entry: 'activity.js' }, source: 'void 0;', sourceType: 'local' };
  await assert.rejects(f.manager.install(v1), /cannot replace/);
  const other = fixture();
  await other.manager.install(v1);
  await assert.rejects(other.manager.install(await approvedPackage()), /different Activity source/);
});

test('approving a V2 update preserves a disabled Activity and its user preferences', async () => {
  const f = fixture();
  await f.manager.install(await approvedPackage());
  await f.manager.setPreferences(metadata.id, { showArtwork: false });
  await f.manager.setEnabled(metadata.id, false);
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, version: '1.1.0' } }));
  assert.equal(f.manager.records[metadata.id].enabled, false);
  assert.equal(f.manager.records[metadata.id].preferences.showArtwork, false);
  assert.equal(f.scripts.size, 0);
  await f.manager.setEnabled(metadata.id, true);
  assert.equal(f.scripts.size, 1);
});

test('an update during an asynchronous host check cannot publish the old V2 generation', async () => {
  const f = fixture();
  await f.manager.install(await approvedPackage());
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  let holdNext = true;
  f.api.permissions.contains = async () => {
    if (!holdNext) return true;
    holdNext = false; entered(); return held;
  };
  const pending = f.manager.handleUserScriptMessage(f.request('presence.report', { report: { kind: 'video', media: { title: 'Old version' }, playback: { state: 'playing' } } }), f.sender);
  await started;
  await f.manager.install(await approvedPackage({ metadata: { ...metadata, version: '1.1.0' } }));
  release(true);
  assert.equal((await pending).error.code, 'permission_denied');
  assert.equal(f.reports.length, 0);
});

test('origin cleanup preserves overlapping V1 grants and required baseline hosts used by V2', async () => {
  const f = fixture();
  const removed = [];
  f.api.permissions.remove = async (value) => { removed.push(value); return true; };
  f.api.runtime.getManifest = () => ({ version: '2.0.0', host_permissions: ['https://youtube.com/*'] });
  await f.manager.removeUnusedHostPermissions(['https://*.example.com/*', 'https://youtube.com/*', 'https://unused.example.net/*'], {
    'public-player': { metadata: { ...metadata, matches: ['https://example.com/*'] } },
  });
  assert.deepEqual(removed, [{ origins: ['https://unused.example.net/*'] }]);
});

function pageFixture() {
  const title = { tagName: 'H1', textContent: '  Example   title  ' };
  const author = { tagName: 'SPAN', attributes: { title: 'Example creator' } };
  const video = { tagName: 'VIDEO', readyState: 4, paused: false, ended: false, currentTime: 30, duration: 120, playbackRate: 1 };
  const root = { tagName: 'SECTION', queries: { '.title': [title], '.author': [author], video: [video] } };
  for (const element of [root, title, author, video]) Object.assign(element, {
    nodeType: 1, sensitive: false, hidden: false,
    closest() { return this.sensitive ? this : null; }, getClientRects() { return this.hidden ? [] : [{}]; },
    querySelector() { return null; }, querySelectorAll(selector) { return this.queries?.[selector] || []; },
    getAttribute(name) { return this.attributes?.[name] || null; },
  });
  const document = { querySelectorAll: () => [root], body: {}, documentElement: {} };
  const window = { getComputedStyle: (element) => ({ display: element.cssHidden ? 'none' : 'block',
    visibility: element.visibility || 'visible', opacity: element.transparent ? '0' : '1', contentVisibility: element.contentVisibility || 'visible' }) };
  return { root, title, author, video, document, window };
}

test('trusted collector reads bounded scoped fields, clears missing/ended media, and skips sensitive nodes', () => {
  const f = pageFixture();
  const collect = () => collectActivityV2(configuration(), f.document, f.window);
  assert.deepEqual(collect(), { kind: 'video', media: { title: 'Example title', creator: 'Example creator' }, playback: { state: 'playing', position: 30, duration: 120, live: false, rate: 1 } });
  f.video.paused = true;
  assert.equal(collect().playback.state, 'paused');
  f.video.duration = Infinity;
  assert.equal(collect().playback.live, true);
  f.author.sensitive = true;
  assert.equal(collect().media.creator, undefined);
  f.title.sensitive = true;
  assert.equal(collect(), null);
  f.title.sensitive = false;
  f.title.textContent = 'x'.repeat(1025);
  assert.equal(collect(), null);
  f.title.textContent = 'Media';
  f.title.parentElement = { nodeType: 1, transparent: true };
  assert.equal(collect(), null);
  f.title.parentElement = null;
  f.video.ended = true;
  assert.equal(collect(), null);
});

test('V2 rejects fields with hidden descendants and keeps visible markup and safe fallbacks', () => {
  for (const properties of [
    { cssHidden: true }, { visibility: 'hidden' }, { visibility: 'collapse' },
    { transparent: true }, { hidden: true }, { contentVisibility: 'hidden' },
  ]) {
    const f = pageFixture();
    f.title.queries = { '*': [{ ...f.title, tagName: 'SPAN', queries: {}, parentElement: f.title, ...properties }] };
    f.title.textContent = 'Example title PRIVATE HIDDEN TEXT';
    const collect = (config = configuration()) => collectActivityV2(config, f.document, f.window);
    assert.equal(collect(), null, JSON.stringify(properties));
    const fallback = { ...f.title, queries: {}, textContent: 'Public fallback title' };
    f.root.queries['.fallback'] = [fallback];
    const config = configuration(); config.fields.title.selectors.push('.fallback');
    assert.equal(collect(config).media.title, 'Public fallback title');
  }
  const f = pageFixture();
  const visible = { ...f.title, tagName: 'SPAN', queries: {}, parentElement: f.title };
  f.title.queries = { '*': [visible] };
  f.title.textContent = 'Public nested title';
  assert.equal(collectActivityV2(configuration(), f.document, f.window).media.title, 'Public nested title');
  visible.transparent = true;
  f.title.queries = {};
  f.author.queries = { '*': [{ ...visible, parentElement: f.author }] };
  assert.equal(collectActivityV2(configuration(), f.document, f.window).media.creator, undefined);
});

test('V2 excludes content hidden by the selected element or an ancestor', () => {
  const f = pageFixture();
  f.title.contentVisibility = 'hidden';
  assert.equal(collectActivityV2(configuration(), f.document, f.window), null);
  f.title.contentVisibility = 'visible';
  f.title.parentElement = { nodeType: 1, contentVisibility: 'hidden' };
  assert.equal(collectActivityV2(configuration(), f.document, f.window), null);
});

test('generated V2 collector clears rejected text, handles navigation, and stops on disable without executing package code', async () => {
  const f = fixture();
  await f.manager.install(await approvedPackage());
  const page = pageFixture();
  const listeners = new Map();
  const portListeners = new Map();
  let tick;
  const messages = [];
  const window = { ...page.window, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: (name) => listeners.delete(name) };
  window.top = window;
  const context = { window, document: page.document, location: { href: f.sender.url }, URL, Date, Math,
    setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => { tick = null; }, setTimeout, clearTimeout,
    chrome: { runtime: {
      async sendMessage(message) { const received = JSON.parse(JSON.stringify(message)); messages.push(received); return f.manager.handleUserScriptMessage(received, { ...f.sender, url: context.location.href }); },
      connect({ name }) { assert.match(name, /activity-v2/); return { onMessage: { addListener: (listener) => portListeners.set('message', listener) }, onDisconnect: { addListener: (listener) => portListeners.set('disconnect', listener) }, disconnect() {} }; },
    } },
  };
  vm.runInNewContext(f.scripts.values().next().value.js[0].code, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.reports.length, 1);
  assert.equal(context.ChudPresence, undefined);
  page.title.queries = { '*': [{ ...page.title, tagName: 'SPAN', queries: {}, parentElement: page.title, transparent: true }] };
  page.title.textContent = 'Example title PRIVATE HIDDEN TEXT';
  await tick();
  assert.equal(messages.at(-1).operation, 'presence.clear');
  assert.equal(f.reports.length, 1);
  assert.equal(f.manager.lastSeen.has(metadata.id), false);
  page.title.queries = {}; page.title.textContent = 'Public replacement title';
  await tick();
  assert.equal(f.reports.length, 2);
  assert.equal(f.reports.at(-1)[0].track.media.title, 'Public replacement title');
  context.location.href = 'https://example.com/private';
  await tick();
  assert.equal(messages.at(-1).operation, 'presence.clear');
  assert.equal(f.manager.lastSeen.has(metadata.id), false);
  portListeners.get('message')({ type: 'CHUDPRESENCE_ACTIVITY_ABORT', activityId: metadata.id, activityVersion: metadata.version });
  assert.equal(tick, null);
  assert.equal(listeners.size, 0);
});
