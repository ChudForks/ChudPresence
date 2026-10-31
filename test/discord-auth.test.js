import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DiscordRateLimitError, rateLimitErrorFromResponse } from '../extension/discord/auth.js';
import { discordRedirectUrl } from '../extension/config.js';

const source = (await readFile(new URL('../extension/discord/auth.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]+\r?\n/gm, '')
  .replace(/^export /gm, '');

function createAuthHarness(expiresIn, { fetchResponse, signalApi = AbortSignal } = {}) {
  const clientId = '123456789012345678';
  const local = {
    discordAuthClientId: clientId,
    discordAuth: { accessToken: 'expired-access', refreshToken: 'refresh', expiresAt: 0 },
  };
  let requests = 0;
  let now = 1_000_000;
  class DateAt extends Date { static now() { return now; } }
  const context = vm.createContext({
    DISCORD_CLIENT_ID: clientId,
    Date: DateAt,
    AbortSignal: signalApi,
    URLSearchParams,
    chrome: {
      storage: {
        local: {
          async get(keys) { return Object.fromEntries(keys.map((key) => [key, structuredClone(local[key])])); },
          async set(values) { Object.assign(local, structuredClone(values)); },
          async remove(keys) { for (const key of [].concat(keys)) delete local[key]; },
        },
      },
    },
    async fetch(url, options) {
      requests += 1;
      if (fetchResponse) return fetchResponse(url, options);
      return {
        ok: true,
        async json() { return { access_token: `access-${requests}`, refresh_token: 'refresh', expires_in: expiresIn }; },
      };
    },
  });
  vm.runInContext(`${source}\nglobalThis.authTest = { getAccessToken, getAuthState, revokeAuthorization, discordRequest };`, context);
  return { ...context.authTest, local, elapse(ms) { now += ms; }, get requests() { return requests; } };
}

test('derives the OAuth callback from this Chromium extension identity', () => {
  assert.equal(discordRedirectUrl({
    getRedirectURL: (path) => `https://example-extension.chromiumapp.org/${path}`,
  }), 'https://example-extension.chromiumapp.org/discord');
  assert.throws(() => discordRedirectUrl({}), /identity API is unavailable/);
});

test('uses Discord retry_after values for rate-limit errors', () => {
  const error = rateLimitErrorFromResponse(
    { headers: new Headers({ 'retry-after': '0.25' }) },
    { retry_after: 2.4 },
  );

  assert.ok(error instanceof DiscordRateLimitError);
  assert.equal(error.retryAfterMs, 2_400);
  assert.equal(error.status, 429);
});

test('uses a safe minimum retry delay when Discord omits retry_after', () => {
  const error = rateLimitErrorFromResponse({ headers: new Headers() });
  assert.equal(error.retryAfterMs, 5_000);
});

for (const expiresIn of [30, 60]) {
  test(`refreshes a ${expiresIn}-second token before reusing it after expiration`, async () => {
    const harness = createAuthHarness(expiresIn);
    assert.equal(await harness.getAccessToken(), 'access-1');
    harness.elapse(expiresIn * 1000 + 1);
    assert.equal(await harness.getAccessToken(), 'access-2');
    assert.equal(harness.requests, 2);
  });
}

test('keeps the usual sixty-second refresh margin for an hour-long token', async () => {
  const harness = createAuthHarness(3600);
  assert.equal(await harness.getAccessToken(), 'access-1');
  harness.elapse(3_539_000);
  assert.equal(await harness.getAccessToken(), 'access-1');
  harness.elapse(1000);
  assert.equal(await harness.getAccessToken(), 'access-2');
});

test('revocation clears local credentials first and finishes even when Discord times out', async () => {
  let revocation;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const controller = new AbortController();
  const harness = createAuthHarness(3600, {
    signalApi: { timeout(ms) { assert.equal(ms, 15_000); return controller.signal; } },
    fetchResponse(url, options) {
      revocation = { url, options };
      markStarted();
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
    },
  });
  const revoking = harness.revokeAuthorization();
  await started;
  assert.equal(harness.getAuthState().authenticated, false);
  assert.equal(harness.local.discordAuth, undefined);
  assert.equal(harness.local.discordAuthClientId, undefined);
  assert.ok(revocation.url.endsWith('/oauth2/token/revoke'));
  assert.equal(revocation.options.body.get('token_type_hint'), 'refresh_token');
  assert.equal(revocation.options.body.get('token'), 'refresh');
  assert.ok(revocation.options.signal instanceof AbortSignal);
  await assert.rejects(harness.getAccessToken(), /Connect Discord first/);
  controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  await revoking;
});

test('a token refresh finishing after disconnect cannot restore authentication', async () => {
  let finishRefresh;
  let markRefreshing;
  const started = new Promise(resolve => { markRefreshing = resolve; });
  const harness = createAuthHarness(3600, { fetchResponse(url) {
    if (url.endsWith('/oauth2/token/revoke')) return Promise.reject(new TypeError('Offline'));
    markRefreshing();
    return new Promise(resolve => { finishRefresh = resolve; });
  } });
  const refreshing = harness.getAccessToken();
  await started;
  await harness.revokeAuthorization();
  const rejected = assert.rejects(refreshing, /disconnected/);
  finishRefresh({ ok: true, async json() { return { access_token: 'late-access', expires_in: 3600 }; } });
  await rejected;
  assert.equal(harness.getAuthState().authenticated, false);
  assert.equal(harness.local.discordAuth, undefined);
});

for (const phase of ['refresh', 'presence', 'refresh body', 'presence body']) {
  test(`aborts a stalled Discord ${phase} request so sign-out cannot remain queued forever`, async () => {
    const controller = new AbortController();
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const delays = [];
    const harness = createAuthHarness(3600, {
      signalApi: { timeout(ms) { delays.push(ms); return controller.signal; } },
      fetchResponse(url, options) {
        if (phase.startsWith('presence') && url.endsWith('/oauth2/token')) {
          return { ok: true, async json() { return { access_token: 'fresh', expires_in: 3600 }; } };
        }
        assert.equal(options.signal, controller.signal);
        const stall = () => {
          markStarted();
          return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
        };
        return phase.endsWith('body') ? { ok: true, status: 200, json: stall } : stall();
      },
    });
    const request = phase.startsWith('refresh') ? harness.getAccessToken() : harness.discordRequest('/users/@me/headless-sessions');
    const rejected = assert.rejects(request, /timed out/);
    await started;
    assert.ok(delays.every(ms => ms === 15_000));
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    await rejected;
    if (phase.startsWith('refresh')) assert.equal(harness.local.discordAuth.accessToken, 'expired-access');
  });
}
