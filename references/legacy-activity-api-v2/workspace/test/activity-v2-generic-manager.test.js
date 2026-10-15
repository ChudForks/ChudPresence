import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { activityV2Digest, validateActivityV2 } from '../extension/core/activity-api-v2.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { v2ServiceDigest } from '../extension/core/activity-v2-services.js';

const metadata = { id: 'generic-player', name: 'Generic Player', description: 'Public movie playback.', apiVersion: 2,
  version: '1.0.0', entry: 'activity.json', matches: ['https://example.com/watch/*'] };
const configuration = () => ({ schemaVersion: 2, kind: 'movie', scope: '.card',
  fields: { title: { source: 'dom.text', selectors: ['[data-media="title"]'] } },
  player: { adapter: 'html-media', selectors: ['video'], selection: 'largest-visible' },
  presentation: { details: 'Watching {title}', artwork: { large: 'https://example.com/icon.png' },
    buttons: [{ label: 'Open service', url: 'https://example.com/' }] },
  lookup: { service: 'movie-catalog', input: { query: 'title' } } });
const policy = () => ({ schemaVersion: 1, id: 'movie-catalog', name: 'Movie catalog', description: 'Look up movie artwork.',
  endpoint: 'https://api.example.com/search/movie', parameters: { query: { type: 'text', maxLength: 256 } },
  outputs: { 'artwork.large': { type: 'image-path', path: ['results', 0, 'poster_path'], baseUrl: 'https://images.example.com/posters' } } });
const report = (title = 'Movie A') => ({ kind: 'movie', media: { title },
  playback: { state: 'playing', position: 10, duration: 100, live: false, rate: 1 } });
const jsonResponse = () => new Response(JSON.stringify({ results: [{ poster_path: '/movie-a.jpg' }] }), { headers: { 'Content-Type': 'application/json' } });

async function fixture(fetchImpl = async () => jsonResponse(), config = configuration()) {
  const data = {}, scripts = new Map(), reports = [], clears = [], executions = [];
  let currentUrl = 'https://example.com/watch/1';
  let permissions = true;
  let currentReport = report();
  let manager;
  const api = {
    runtime: { getManifest: () => ({ version: '2.0.0' }) },
    storage: { local: { async get(key) { return structuredClone(key == null ? data : { [key]: data[key] }); },
      async set(value) { Object.assign(data, structuredClone(value)); } } },
    permissions: { async contains() { return permissions; }, async remove() { return true; } },
    userScripts: {
      async getScripts() { return [...scripts.values()]; }, async configureWorld() {},
      async register(values) { for (const value of values) scripts.set(value.id, value); },
      async update(values) { for (const value of values) scripts.set(value.id, value); },
      async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
      async execute(options) { executions.push(options); return [{ documentId: options.target.documentIds?.[0], frameId: 0,
        result: options.js[0].code.includes('__chudpresenceActivityV2Snapshot')
          ? { activityId: metadata.id, capability: manager.records[metadata.id].capability, href: currentUrl, report: currentReport } : currentUrl }]; },
    },
  };
  manager = new ActivityManager({ api, fetchImpl, onReport: value => reports.push(value), onClear: (...values) => clears.push(values) });
  const pkg = { metadata: structuredClone(metadata), source: JSON.stringify(config), sourceType: 'local' };
  pkg.approval = { digest: await activityV2Digest(pkg) };
  await manager.install(pkg);
  const sender = { tab: { id: 7 }, frameId: 0, documentId: 'doc-7', url: currentUrl, userScriptWorldId: 'chudpresence.activity.generic-player' };
  const request = (operation, payload = {}) => ({ type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: metadata.id,
    activityVersion: metadata.version, apiVersion: 2, capability: manager.records[metadata.id].capability,
    requestId: 'probe', operation, payload });
  return { manager, api, reports, clears, executions, scripts, data, sender, request,
    setUrl: value => { currentUrl = value; }, revoke: () => { permissions = false; },
    approve: async () => { const value = policy(); await manager.v2Services.approve(value, await v2ServiceDigest(value)); },
    setSnapshot: value => { currentReport = value; },
    send: value => { currentReport = value; return manager.handleUserScriptMessage(request('presence.report', { report: value }), sender); } };
}

test('generic V2 presentation is worker-owned and report destination overrides are rejected', () => {
  const c = configuration();
  validateActivityV2(JSON.stringify(c));
  const normalized = normalizeActivityReport(report(), 2, c);
  assert.equal(normalized.display.details, 'Watching Movie A');
  assert.equal(normalized.artwork.large, c.presentation.artwork.large);
  assert.deepEqual(normalized.buttons, c.presentation.buttons);
  for (const key of ['display', 'artwork', 'buttons', 'lookup', 'url']) {
    assert.throws(() => normalizeActivityReport({ ...report(), [key]: {} }, 2, c));
  }
});

test('generic V2 verifies current exact document URL and serializes only bundled executable code', async () => {
  const f = await fixture();
  f.setUrl('https://example.com/account/private');
  assert.equal((await f.send(report())).ok, false);
  assert.equal(f.reports.length, 0);
  const script = [...f.scripts.values()][0].js[0].code;
  const window = {}; window.top = window;
  vm.runInNewContext(script, { window, location: { href: 'https://outside.example/' }, URL });
  assert.match(script, /collectGenericActivityV2/);
  assert.equal(f.executions[0].target.documentIds[0], f.sender.documentId);
});

test('generic media modes survive install/restore and use the verified SPA path for links and service presentation', async () => {
  const c = configuration(); c.paths = ['/watch/{number}'];
  c.modes = [{ id: 'live', paths: ['/watch/live/{number}'], kind: 'stream', scope: '.live-room', fields: c.fields,
    player: { adapter: 'html-media', selectors: ['video'], live: true, elapsed: true },
    links: { media: { paths: ['/watch/live/{number}'], sources: [{ source: 'page' }] } },
    presentation: { details: 'Watching Live', state: '{title}', liveInDetails: true, buttons: [{ label: 'Watch Stream', link: 'media' }] },
    lookup: c.lookup }];
  const f = await fixture(undefined, c); await f.approve();
  const restored = new ActivityManager({ api: f.api }); await restored.load();
  assert.equal(JSON.parse(restored.records[metadata.id].code).modes[0].id, 'live');
  f.setUrl('https://example.com/watch/live/7'); // The Chromium sender still says /watch/1.
  const live = { ...report(), modeId: 'live', kind: 'stream', links: { media: '/watch/live/7' },
    playback: { state: 'playing', position: 15, duration: 0, live: true, rate: 1 } };
  assert.equal((await f.send(live)).ok, true);
  const track = f.reports.at(-1).track;
  assert.equal(track.display.details, 'Watching Live'); assert.equal(track.artwork.large, 'https://images.example.com/posters/movie-a.jpg');
  assert.deepEqual(track.buttons, [{ label: 'Watch Stream', url: 'https://example.com/watch/live/7' }]);
  f.setUrl('https://example.com/watch/1');
  assert.equal((await f.send(live)).ok, false);
});

test('V2 cannot self-authorize a lookup destination and an unapproved lookup preserves base presence', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return jsonResponse(); });
  assert.equal((await f.send(report())).ok, true);
  assert.equal(calls, 0);
  assert.equal(f.reports[0].track.artwork.large, 'https://example.com/icon.png');
  const c = configuration(); c.lookup.endpoint = 'https://stealing.example.com/';
  assert.throws(() => validateActivityV2(JSON.stringify(c)));
  assert.equal((await f.manager.handleUserScriptMessage(f.request('net.fetch', { url: 'https://stealing.example.com/' }), f.sender)).ok, false);
});

test('independently approved V2 lookup enriches presence and revocation immediately removes derived output', async () => {
  let calls = 0;
  const f = await fixture(async (url, init) => { calls++; assert.equal(new URL(url).searchParams.get('query'), 'Movie A');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return jsonResponse(); });
  await f.approve();
  assert.equal((await f.send(report())).ok, true);
  assert.equal(f.reports.at(-1).track.artwork.large, 'https://images.example.com/posters/movie-a.jpg');
  await f.send(report()); assert.equal(calls, 1);
  await f.manager.v2Services.remove('movie-catalog');
  await f.manager.clearV2ServiceResults('movie-catalog');
  assert.equal(f.reports.at(-1).track.artwork.large, 'https://example.com/icon.png');
});

test('pending lookup cannot republish after clear, disable, permission revocation or same-document route change', async () => {
  for (const change of ['clear', 'disable', 'permission', 'route', 'media', 'ended']) {
    let start, finish;
    const started = new Promise(resolve => { start = resolve; });
    const response = new Promise(resolve => { finish = resolve; });
    const f = await fixture(async () => { start(); return response; });
    await f.approve();
    const pending = f.send(report());
    await started;
    if (change === 'clear') await f.manager.handleUserScriptMessage(f.request('presence.clear'), f.sender);
    if (change === 'disable') f.manager.records[metadata.id].enabled = false;
    if (change === 'permission') f.revoke();
    if (change === 'route') f.setUrl('https://example.com/watch/2');
    if (change === 'media') f.setSnapshot(report('Movie B'));
    if (change === 'ended') f.setSnapshot(null);
    finish(jsonResponse());
    assert.equal((await pending).ok, false, change);
    assert.equal(f.reports.length, 0, change);
  }
});

test('service revocation during the final document check cannot publish stale enriched artwork', async () => {
  const f = await fixture();
  await f.approve();
  const originalEnrich = f.manager.v2Services.enrich.bind(f.manager.v2Services);
  let enriched = false, revoked = false;
  f.manager.v2Services.enrich = async (...args) => { const result = await originalEnrich(...args); enriched = true; return result; };
  const execute = f.api.userScripts.execute;
  f.api.userScripts.execute = async (options) => {
    if (enriched && !revoked) {
      revoked = true;
      await f.manager.v2Services.remove('movie-catalog');
      await f.manager.clearV2ServiceResults('movie-catalog');
    }
    return execute(options);
  };
  await f.send(report());
  assert.equal(revoked, true);
  assert.equal((await f.manager.v2Services.list()).length, 0);
  assert.ok(f.reports.length > 0);
  assert.ok(f.reports.every(value => value.track.artwork.large === 'https://example.com/icon.png'));
});

test('service media outputs rerender approved presentation after enrichment', async () => {
  const c = configuration();
  c.fields.subtitle = { source: 'dom.text', selectors: ['.subtitle'] };
  c.presentation.state = '{subtitle}';
  const f = await fixture(async () => new Response('{"subtitle":"Public movie genre"}', { headers: { 'Content-Type': 'application/json' } }), c);
  const value = policy(); value.outputs = { 'media.subtitle': { type: 'text', path: ['subtitle'], maxLength: 256 } };
  await f.manager.v2Services.approve(value, await v2ServiceDigest(value));
  assert.equal((await f.send(report())).ok, true);
  assert.equal(f.reports.at(-1).track.display.state, 'Public movie genre');
});

test('newer reports supersede an older pending metadata response in the same document', async () => {
  let start, finish;
  const started = new Promise(resolve => { start = resolve; });
  const response = new Promise(resolve => { finish = resolve; });
  const f = await fixture(async () => { start(); return response; });
  await f.approve();
  const pending = f.send(report('Movie A'));
  await started;
  assert.equal((await f.send(report('Movie B'))).ok, true);
  finish(jsonResponse());
  assert.equal((await pending).ok, false);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].track.media.title, 'Movie B');
});
