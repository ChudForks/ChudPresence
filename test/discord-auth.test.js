import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DiscordRateLimitError, rateLimitErrorFromResponse } from '../extension/discord/auth.js';
import { discordRedirectUrl } from '../extension/config.js';

const source = (await readFile(new URL('../extension/discord/auth.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]+\r?\n/gm, '')
  .replace(/^export /gm, '');

function createAuthHarness(expiresIn) {
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
    async fetch() {
      requests += 1;
      return {
        ok: true,
        async json() { return { access_token: `access-${requests}`, refresh_token: 'refresh', expires_in: expiresIn }; },
      };
    },
  });
  vm.runInContext(`${source}\nglobalThis.accessToken = getAccessToken;`, context);
  return { getAccessToken: context.accessToken, elapse(ms) { now += ms; }, get requests() { return requests; } };
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
