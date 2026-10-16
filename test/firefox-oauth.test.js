import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DISCORD_CLIENT_ID } from '../extension/config.js';

const authSource = (await readFile(new URL('../extension/discord/auth.js', import.meta.url), 'utf8'))
  .replace(/^import[^\n]+\r?\n/gm, '')
  .replace(/^export /gm, '');
const configSource = (await readFile(new URL('../extension/config.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
const callbackUrl = 'https://64f731f3c58cab26bcfe1ab955ae9c65d44cce4d.extensions.allizom.org/';

function authHarness({ mismatch = false, cancelled = false } = {}) {
  const local = {};
  const session = {};
  const requests = [];
  let authorization;
  const storageArea = (data) => ({
    async get(keys) { return Object.fromEntries([].concat(keys).map(key => [key, data[key]])); },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
  });
  const identity = {
    getRedirectURL(...args) {
      assert.equal(args.length, 0);
      return callbackUrl;
    },
    async launchWebAuthFlow(options) {
      assert.equal(options.interactive, true);
      authorization = new URL(options.url);
      assert.equal(authorization.searchParams.get('redirect_uri'), callbackUrl);
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(session.discordPendingOAuth?.verifier);
      assert.equal(session.discordPendingOAuth.state, authorization.searchParams.get('state'));
      if (cancelled) return undefined;
      const callback = new URL(callbackUrl);
      callback.searchParams.set('code', 'firefox-code');
      callback.searchParams.set('state', mismatch ? 'wrong-state' : authorization.searchParams.get('state'));
      return callback.href;
    },
  };
  const browser = { identity, runtime: { getBrowserInfo() {} },
    storage: { local: storageArea(local), session: storageArea(session) } };
  const context = vm.createContext({
    chrome: browser, browser,
    URL, URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto, btoa,
    async fetch(url, options = {}) {
      requests.push({ url, ...options });
      return { ok: true, status: 200, async json() {
        return url.endsWith('/oauth2/token')
          ? { access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 }
          : { sub: 'user-1', preferred_username: 'Firefox tester' };
      } };
    },
  });
  vm.runInContext(`${configSource}\n${authSource}\nglobalThis.authorizeDiscord = authorize;`, context);
  return { authorize: context.authorizeDiscord, local, session, requests, authorization: () => authorization };
}

test('uses the Firefox identity callback without constructing a Chromium callback', () => {
  const identity = { getRedirectURL(...args) { assert.equal(args.length, 0); return callbackUrl; } };
  const context = vm.createContext({ browser: { runtime: { getBrowserInfo() {} }, identity } });
  vm.runInContext(`${configSource}\nglobalThis.callback = discordRedirectUrl();`, context);
  assert.equal(context.callback, callbackUrl);
});

test('Firefox authorization preserves PKCE and uses the same exact callback in its token exchange', async () => {
  const harness = authHarness();
  const result = await harness.authorize();
  assert.equal(result.authenticated, true);
  assert.equal(result.user.username, 'Firefox tester');
  const tokenRequest = harness.requests.find(request => request.url.endsWith('/oauth2/token'));
  assert.ok(tokenRequest);
  const body = new URLSearchParams(tokenRequest.body);
  assert.equal(body.get('redirect_uri'), callbackUrl);
  assert.equal(body.get('code'), 'firefox-code');
  assert.equal(body.get('grant_type'), 'authorization_code');
  const challenge = Buffer.from(await webcrypto.subtle.digest('SHA-256',
    new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
  assert.equal(challenge, harness.authorization().searchParams.get('code_challenge'));
  assert.equal(harness.local.discordAuthClientId, DISCORD_CLIENT_ID);
  assert.equal(harness.local.discordAuth.refreshToken, 'private-refresh');
  assert.equal(harness.session.discordPendingOAuth, undefined);
});

for (const [label, options, error] of [
  ['a state mismatch', { mismatch: true }, /state mismatch/],
  ['cancellation', { cancelled: true }, /cancelled/],
]) {
  test(`Firefox authorization removes pending state and stores no credentials after ${label}`, async () => {
    const harness = authHarness(options);
    await assert.rejects(harness.authorize(), error);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.local.discordAuth, undefined);
    assert.equal(harness.session.discordPendingOAuth, undefined);
  });
}
