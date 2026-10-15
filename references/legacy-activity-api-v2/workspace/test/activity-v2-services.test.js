import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityV2Services, describeV2ServicePolicy, validateV2ServicePolicy, v2ServiceDigest } from '../extension/core/activity-v2-services.js';

const policy = () => ({ schemaVersion: 1, id: 'tmdb-movie', name: 'TMDB movie search', description: 'Look up movie artwork from approved visible movie titles.',
  endpoint: 'https://api.themoviedb.org/3/search/movie', parameters: { query: { type: 'text', maxLength: 256 } }, staticQuery: { language: 'en-US' },
  outputs: { 'artwork.large': { path: ['results', 0, 'poster_path'], type: 'image-path', baseUrl: 'https://image.tmdb.org/t/p/w500' },
    'media.subtitle': { path: ['results', 0, 'overview'], type: 'text', maxLength: 100 } }, auth: 'bearer' });
const config = () => ({ fields: { title: { source: 'dom.text', selectors: ['h1'] } }, lookup: { service: 'tmdb-movie', input: { query: 'title' } } });
const report = (title = 'A public movie') => ({ kind: 'movie', media: { title }, artwork: { small: 'https://example.com/icon.png' },
  playback: { state: 'playing', position: 5, duration: 100 } });
const body = () => ({ results: [{ poster_path: '/poster_1.jpg', overview: 'A movie description.' }] });
const response = (data = body(), options = {}) => new Response(typeof data === 'string' ? data : JSON.stringify(data), {
  status: 200, headers: { 'Content-Type': 'application/json' }, ...options,
});

function fixture(fetchImpl = async () => response()) {
  const data = {};
  const requests = [];
  const checks = [];
  let allowed = true;
  let current = true;
  let failWrite = false;
  const api = { storage: { local: {
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) { if (failWrite) throw new Error('storage failed'); Object.assign(data, structuredClone(value)); },
  } }, permissions: { async contains(value) { checks.push(value); return allowed; } } };
  const services = new ActivityV2Services({ api, fetchImpl: async (url, init) => { requests.push({ url, init }); return fetchImpl(url, init); } });
  const options = { activityId: 'movie-player', isCurrent: async () => current };
  const approve = async (value = policy(), token = 'private-service-token') => services.approve(value, await v2ServiceDigest(value), token);
  return { api, data, requests, checks, services, options, approve,
    revoke() { allowed = false; }, grant() { allowed = true; }, invalidate() { current = false; }, failWrite() { failWrite = true; } };
}

test('independently approved policies permit static public endpoints and only bounded typed inputs and outputs', () => {
  assert.deepEqual(validateV2ServicePolicy(JSON.stringify(policy())), policy());
  const integer = policy(); integer.parameters.year = { type: 'integer', minimum: 1900, maximum: 2100 };
  assert.deepEqual(validateV2ServicePolicy(integer), integer);
  assert.match(describeV2ServicePolicy(policy()), /These values are shared with api\.themoviedb\.org/);
  assert.match(describeV2ServicePolicy(policy()), /image destination https:\/\/image\.tmdb\.org/);
  for (const endpoint of ['http://api.themoviedb.org/3/search/movie', 'https://api.themoviedb.org:443/3/search/movie',
    'https://api.themoviedb.org./3/search/movie', 'https://user:pass@api.themoviedb.org/movie', 'https://api.themoviedb.org/movie?query=x',
    'https://api.themoviedb.org/movie#fragment', 'https://localhost/movie', 'https://api.internal/movie', 'https://api.home.arpa/movie',
    'https://127.0.0.1/movie', 'https://2130706433/movie', 'https://*.themoviedb.org/movie', 'https://discord.com/api/movie',
    'https://api.discordapp.net/movie', 'https://api.themoviedb.org/{query}']) {
    assert.throws(() => validateV2ServicePolicy({ ...policy(), endpoint }), undefined, endpoint);
  }
  for (const patch of [{ code: 'fetch(...)' }, { auth: 'cookies' }, { parameters: { query: { type: 'text', maxLength: 257 } } },
    { parameters: { year: { type: 'integer', minimum: -1, maximum: 2000 } } }, { staticQuery: { query: 'collision' } },
    { outputs: { 'media.title': { path: ['title'], type: 'text' } } }, { outputs: { buttons: { path: ['url'], type: 'text' } } },
    { outputs: { 'artwork.large': { path: ['url'], type: 'text' } } },
    { outputs: { 'artwork.large': { path: ['poster'], type: 'image-path', baseUrl: 'https://image.tmdb.org/t?x=y' } } },
    { outputs: { 'media.subtitle': { path: ['__proto__', 'secret'], type: 'text' } } },
    { outputs: { 'media.subtitle': { path: ['constructor', 'secret'], type: 'text' } } },
    { outputs: { 'media.subtitle': { path: ['results', 100, 'title'], type: 'text' } } },
    { outputs: { 'media.subtitle': { path: ['results', '*', 'title'], type: 'text' } } }]) {
    assert.throws(() => validateV2ServicePolicy({ ...policy(), ...patch }));
  }
});

test('exact reviewed bytes are required; credentials are private and restore verifies stored policy hashes', async () => {
  const f = fixture();
  const source = JSON.stringify(policy(), null, 2);
  const digest = await v2ServiceDigest(source);
  await assert.rejects(f.services.approve(source + '\n', digest, 'private-service-token'), /exact service policy bytes/);
  await f.services.approve(source, digest, 'private-service-token');
  assert.equal(f.data.activityV2ServicePolicies['tmdb-movie'].source, source);
  const exposed = await f.services.list();
  assert.equal(exposed[0].authenticated, true);
  assert.equal(JSON.stringify(exposed).includes('private-service-token'), false);
  const restored = new ActivityV2Services({ api: f.api, fetchImpl: async () => response() });
  assert.equal((await restored.list()).length, 1);
  f.data.activityV2ServicePolicies['tmdb-movie'].source = source.replace('themoviedb.org', 'stealing.example');
  const corrupted = new ActivityV2Services({ api: f.api, fetchImpl: async () => response() });
  assert.deepEqual(await corrupted.list(), []);
  assert.equal(corrupted.lastDiagnostic.code, 'invalid_stored_policy');
  const original = report();
  assert.equal(await corrupted.enrich(config(), original, f.options), original);
});

test('worker builds a constrained request, projects trusted artwork, preserves playback and never returns response data or credentials', async () => {
  const f = fixture(); await f.approve();
  const original = report('A public movie & query=private');
  const result = await f.services.enrich(config(), original, f.options);
  assert.equal(f.requests.length, 1);
  const sent = new URL(f.requests[0].url);
  assert.equal(sent.origin, 'https://api.themoviedb.org');
  assert.equal(sent.pathname, '/3/search/movie');
  assert.equal(sent.searchParams.get('query'), original.media.title);
  assert.equal(sent.searchParams.get('language'), 'en-US');
  assert.deepEqual([...sent.searchParams.keys()].sort(), ['language', 'query']);
  const init = f.requests[0].init;
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, { Accept: 'application/json', Authorization: 'Bearer private-service-token' });
  assert.equal(init.body, undefined);
  assert.deepEqual(f.checks[0], { origins: ['https://api.themoviedb.org/*', 'https://image.tmdb.org/*'] });
  assert.equal(result.artwork.large, 'https://image.tmdb.org/t/p/w500/poster_1.jpg');
  assert.equal(result.artwork.small, original.artwork.small);
  assert.equal(result.media.subtitle, 'A movie description.');
  assert.deepEqual(result.playback, original.playback);
  assert.equal(result.media.title, original.media.title);
  assert.equal(JSON.stringify(result).includes('private-service-token'), false);
  assert.equal(original.artwork.large, undefined);
});

test('activities cannot authorize malicious destinations, pass raw request options or read undeclared inputs', async () => {
  const f = fixture(); const original = report();
  assert.equal(await f.services.enrich(config(), original, f.options), original);
  assert.equal(f.services.lastDiagnostic.code, 'service_not_approved');
  await f.approve();
  for (const lookup of [
    { service: 'stealing-info', endpoint: 'https://stealing.example/', input: { query: 'title' } },
    { service: 'tmdb-movie', input: { query: 'title' }, url: 'https://stealing.example/' },
    { service: 'tmdb-movie', input: { query: 'title', secret: 'title' } },
    { service: 'tmdb-movie', input: { query: 'cookie' } },
    { service: 'tmdb-movie', input: { query: 'https://stealing.example/' } },
    { service: 'tmdb-movie', input: {} },
  ]) assert.equal(await f.services.enrich({ ...config(), lookup }, original, f.options), original);
  assert.equal(await f.services.enrich(config(), report('x'.repeat(257)), f.options).then((value) => value.artwork.large), undefined);
  assert.equal(f.requests.length, 0);
});

test('unavailable current ownership, host grants or private tokens block requests and cached results', async () => {
  for (const state of ['grant', 'current', 'token', 'identity', 'callback']) {
    const f = fixture(); await f.approve(policy(), state === 'token' ? '' : 'private-service-token');
    if (state === 'grant') f.revoke();
    if (state === 'current') f.invalidate();
    const options = state === 'identity' ? { ...f.options, activityId: '' } : state === 'callback' ? { activityId: 'movie-player' } : f.options;
    const original = report(); assert.equal(await f.services.enrich(config(), original, options), original, state);
    assert.equal(f.requests.length, 0, state);
  }
  const f = fixture(); await f.approve();
  await f.services.enrich(config(), report(), f.options);
  f.revoke(); const original = report();
  assert.equal(await f.services.enrich(config(), original, f.options), original);
  assert.equal(f.requests.length, 1);
});

test('cache is isolated by Activity, service and exact inputs; changed inputs obey service rate limits', async () => {
  const f = fixture(); await f.approve();
  assert.ok((await f.services.enrich(config(), report(), f.options)).artwork.large);
  const changedClock = report(); changedClock.playback.position = 12;
  assert.equal((await f.services.enrich(config(), changedClock, f.options)).playback.position, 12);
  assert.equal(f.requests.length, 1);
  const changedTitle = report('Another movie');
  assert.equal(await f.services.enrich(config(), changedTitle, f.options), changedTitle);
  assert.equal(f.services.lastDiagnostic.code, 'lookup_rate_limited');
  await f.services.enrich(config(), report(), { ...f.options, activityId: 'second-player' });
  assert.equal(f.requests.length, 2);
  await f.services.remove('tmdb-movie');
  const original = report(); assert.equal(await f.services.enrich(config(), original, f.options), original);
  assert.equal(f.services.lastDiagnostic.code, 'service_not_approved');
});

test('policy update and token changes invalidate previous cache entries without bypassing the request rate limit', async () => {
  const f = fixture(); await f.approve();
  await f.services.enrich(config(), report(), f.options);
  await f.approve(policy(), 'new-private-token');
  const original = report(); assert.equal(await f.services.enrich(config(), original, f.options), original);
  assert.equal(f.services.lastDiagnostic.code, 'lookup_rate_limited');
  assert.equal(f.requests.length, 1);
  const updated = policy(); updated.endpoint = 'https://api.themoviedb.org/3/search/tv';
  await f.approve(updated, 'new-private-token');
  const other = { ...f.options, activityId: 'different-player' };
  await f.services.enrich(config(), report(), other);
  assert.equal(new URL(f.requests.at(-1).url).pathname, '/3/search/tv');
});

test('malformed, redirected, non-JSON, oversized or URL-bearing responses fail closed', async () => {
  const redirect = response(); Object.defineProperty(redirect, 'redirected', { value: true });
  for (const [name, result] of [
    ['redirect', redirect], ['error status', response(body(), { status: 403 })],
    ['text content', response(body(), { headers: { 'Content-Type': 'text/html' } })],
    ['malformed', response('{invalid')], ['array root', response([])],
    ['oversize stream', response({ value: 'x'.repeat(256 * 1024) })],
    ['oversize header', response(body(), { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } })],
    ...['https://stealing.example/poster.jpg', '//stealing.example/poster.jpg', '/../../poster.jpg', '/secret.jpg?token=x', '/secret.jpg#x', '/secret%2fposter.jpg']
      .map((poster_path) => ['invalid image path ' + poster_path, response({ results: [{ poster_path, overview: 'Safe text' }] })]),
    ['oversize text', response({ results: [{ poster_path: '/poster.jpg', overview: 'x'.repeat(1025) }] })],
  ]) {
    const f = fixture(async () => result); await f.approve(); const original = report();
    assert.equal(await f.services.enrich(config(), original, f.options), original, name);
    assert.equal(f.requests.length, 1, name);
    assert.ok(f.services.lastDiagnostic, name);
  }
});

test('ownership revocation or policy replacement during asynchronous fetch prevents stale enrichment', async () => {
  for (const change of ['current', 'permission', 'remove', 'replace']) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const f = fixture(async () => held); await f.approve();
    const original = report();
    const pending = f.services.enrich(config(), original, f.options);
    while (!f.requests.length) await new Promise((resolve) => setImmediate(resolve));
    if (change === 'current') f.invalidate();
    else if (change === 'permission') f.revoke();
    else if (change === 'remove') await f.services.remove('tmdb-movie');
    else await f.approve(policy(), 'changed-token');
    release(response());
    assert.equal(await pending, original, change);
  }
});

test('streaming read completion rechecks ownership before any response output is used', async () => {
  let finish;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify(body())));
    finish = () => controller.close();
  } });
  const f = fixture(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }));
  await f.approve(); const original = report();
  const pending = f.services.enrich(config(), original, f.options);
  while (!f.requests.length) await new Promise((resolve) => setImmediate(resolve));
  f.invalidate(); finish();
  assert.equal(await pending, original);
});

test('service concurrency is bounded across Activities and failed writes preserve approvals', async () => {
  const releases = [];
  const f = fixture(async () => new Promise((resolve) => releases.push(() => resolve(response()))));
  await f.approve();
  const pending = Array.from({ length: 4 }, (_, i) => f.services.enrich(config(), report(), { ...f.options, activityId: `player-${i}` }));
  while (f.requests.length < 4) await new Promise((resolve) => setImmediate(resolve));
  const original = report(); assert.equal(await f.services.enrich(config(), original, { ...f.options, activityId: 'fifth-player' }), original);
  assert.equal(f.services.lastDiagnostic.code, 'lookup_busy'); assert.equal(f.requests.length, 4);
  releases.forEach((release) => release()); await Promise.all(pending);
  f.failWrite();
  await assert.rejects(f.services.remove('tmdb-movie'), /storage failed/);
  assert.equal((await f.services.list()).length, 1);
  const edited = policy(); edited.endpoint = 'https://api.themoviedb.org/3/search/tv';
  await assert.rejects(f.approve(edited), /storage failed/);
  assert.equal((await f.services.list())[0].endpoint, policy().endpoint);
});

test('integer lookup inputs must come from declared bounded media fields', async () => {
  const p = policy(); p.parameters = { year: { type: 'integer', minimum: 1900, maximum: 2100 } };
  const f = fixture(); await f.approve(p);
  const cfg = { ...config(), fields: { title: {}, subtitle: {} }, lookup: { service: 'tmdb-movie', input: { year: 'subtitle' } } };
  for (const value of ['https://stealing.example/', '-1', '2101', '2000junk', '1e3', '']) {
    const original = { ...report(), media: { title: 'Movie', subtitle: value } };
    assert.equal(await f.services.enrich(cfg, original, f.options), original);
  }
  const original = { ...report(), media: { title: 'Movie', subtitle: '2000' } };
  assert.ok((await f.services.enrich(cfg, original, f.options)).artwork.large);
  assert.equal(new URL(f.requests[0].url).searchParams.get('year'), '2000');
});

test('approval snapshots policy objects before awaiting and returned policy copies cannot mutate approved destinations', async () => {
  const f = fixture(); const candidate = policy(); const digest = await v2ServiceDigest(candidate);
  const approval = f.services.approve(candidate, digest, 'private-service-token');
  candidate.endpoint = 'https://stealing.example/collect';
  const returned = await approval;
  returned.endpoint = candidate.endpoint;
  const listed = await f.services.list(); listed[0].parameters.query.maxLength = 1000;
  await f.services.enrich(config(), report(), f.options);
  assert.equal(new URL(f.requests[0].url).hostname, 'api.themoviedb.org');
  assert.equal((await f.services.list())[0].parameters.query.maxLength, 256);
});

test('fetch errors cannot expose bearer tokens, query inputs or remote error messages in diagnostics', async () => {
  const token = 'private_service_token';
  const f = fixture(async () => { const error = new Error('Query A public movie, token ' + token); error.code = token; throw error; });
  await f.approve(policy(), token);
  const original = report(); assert.equal(await f.services.enrich(config(), original, f.options), original);
  assert.equal(f.services.lastDiagnostic.code, 'service_request_failed');
  assert.equal(JSON.stringify(f.services.diagnostics()).includes(token), false);
  assert.equal(JSON.stringify(f.services.diagnostics()).includes(original.media.title), false);
});

test('a service timeout releases the request slot and preserves the base report', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(async () => new Promise(() => {})); await f.approve();
  const original = report(); const pending = f.services.enrich(config(), original, f.options);
  while (!f.requests.length) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.equal(await pending, original);
  assert.equal(f.services.lastDiagnostic.code, 'service_timeout');
  assert.equal(f.requests[0].init.signal.aborted, true);
  await f.services.remove('tmdb-movie');
});

test('authorization leases contain only validity checks and retire on policy changes, removal and permission revocation', async () => {
  const f = fixture();
  const missing = await f.services.authorization('tmdb-movie');
  assert.equal(missing.isApproved(), false); assert.equal(await missing.isCurrent(), false);
  await f.approve();
  const lease = await f.services.authorization('tmdb-movie');
  assert.deepEqual(Object.keys(lease).sort(), ['isApproved', 'isCurrent']);
  assert.equal(lease.isApproved(), true); assert.equal(await lease.isCurrent(), true);
  await f.approve(policy(), 'replacement-token');
  assert.equal(lease.isApproved(), false); assert.equal(await lease.isCurrent(), false);
  const replacement = await f.services.authorization('tmdb-movie');
  f.revoke();
  assert.equal(await replacement.isCurrent(), false);
  assert.deepEqual(await f.services.reconcilePermissions(), ['tmdb-movie']);
  assert.equal(replacement.isApproved(), false);
  f.grant();
  assert.equal(await replacement.isCurrent(), false);
  const renewed = await f.services.authorization('tmdb-movie');
  assert.equal(await renewed.isCurrent(), true);
  assert.deepEqual(await f.services.reconcilePermissions(), []);
  await f.services.remove('tmdb-movie');
  assert.equal(renewed.isApproved(), false); assert.equal(await renewed.isCurrent(), false);
});

test('leases recheck policy identity after asynchronous permission checks', async () => {
  const f = fixture(); await f.approve();
  const lease = await f.services.authorization('tmdb-movie');
  let release;
  f.api.permissions.contains = async () => new Promise((resolve) => { release = resolve; });
  const pending = lease.isCurrent();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await f.approve(policy(), 'replacement-token'); release(true);
  assert.equal(await pending, false);
});

test('permission reconciliation clears cache and cancels inflight results while keeping approved policy installed', async () => {
  let release;
  const f = fixture(async () => new Promise((resolve) => { release = resolve; })); await f.approve();
  const original = report(); const pending = f.services.enrich(config(), original, f.options);
  while (!f.requests.length) await new Promise((resolve) => setImmediate(resolve));
  f.revoke();
  assert.deepEqual(await f.services.reconcilePermissions(), ['tmdb-movie']);
  assert.equal(f.requests[0].init.signal.aborted, true);
  assert.equal(await pending, original);
  release(response());
  assert.equal((await f.services.list()).length, 1);
  f.grant();
  assert.equal(await (await f.services.authorization('tmdb-movie')).isCurrent(), true);
  const cachedFixture = fixture(); await cachedFixture.approve();
  await cachedFixture.services.enrich(config(), report(), cachedFixture.options);
  cachedFixture.revoke(); await cachedFixture.services.reconcilePermissions(); cachedFixture.grant();
  const base = report(); assert.equal(await cachedFixture.services.enrich(config(), base, cachedFixture.options), base);
  assert.equal(cachedFixture.services.lastDiagnostic.code, 'lookup_rate_limited');
});
