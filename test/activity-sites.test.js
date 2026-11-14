import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { validateActivityMetadata, validateMatchPattern } from '../extension/core/activity-validator.js';
import { activitySiteFromPage, activitySiteMatches, normalizeActivitySite } from '../extension/core/activity-sites.js';

const metadata = { id: 'jellyfin-test', name: 'Jellyfin', description: 'A self-hosted player.',
  version: '1.0.0', apiVersion: 1, entry: 'activity.js', matches: ['https://jellyfin.org/*'], siteAccess: 'user-configured' };
const site = 'http://localhost:8096/jellyfin/';

function harness() {
  const data = {};
  const scripts = new Map();
  const origins = new Set();
  const injections = [];
  const clears = [];
  const requests = [];
  let failWrite = false;
  const api = {
    runtime: { getManifest: () => ({ version: '2.1.3' }) },
    storage: { local: {
      async get(key) { return key === null ? { ...data } : { [key]: data[key] }; },
      async set(values) { if (failWrite) { failWrite = false; throw new Error('Write failed'); } Object.assign(data, structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    } },
    permissions: {
      async contains(query) { return (query.origins || []).every(origin => origins.has(origin)); },
      async getAll() { return { origins: [...origins] }; },
      async remove(query) { for (const origin of query.origins) origins.delete(origin); return true; },
    },
    tabs: { async query() { return [
      { id: 1, url: site + 'web/#/video' }, { id: 2, url: 'http://localhost:8097/jellyfin/web/' },
      { id: 3, url: 'http://localhost:8096/other/web/' }, { id: 4, url: 'https://unrelated.example/web/' },
    ]; } },
    userScripts: {
      async getScripts() { return [...scripts.values()]; }, async configureWorld() {},
      async register(values) { for (const value of values) scripts.set(value.id, value); },
      async update(values) { for (const value of values) scripts.set(value.id, value); },
      async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
      async execute(options) { injections.push(options); return [{ documentId: 'document-1', frameId: 0 }]; },
    },
  };
  const manager = new ActivityManager({ api, onClear: (...args) => clears.push(args),
    fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response('{"ok":true}'); } });
  const message = (operation = 'presence.report', payload = { report: { kind: 'movie', media: { title: 'Movie' } } }) => ({
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: metadata.id, activityVersion: '1.0.0', apiVersion: 1,
    requestId: 'test-request', capability: manager.records[metadata.id].capability, operation, payload,
  });
  const sender = (url = site + 'web/#/video') => ({ tab: { id: 1 }, frameId: 0, documentId: 'document-1', url,
    userScriptWorldId: 'chudpresence.activity.' + metadata.id });
  return { manager, api, scripts, origins, data, injections, clears, requests, message, sender,
    failNextWrite() { failWrite = true; } };
}

test('server setup preserves origin, port, and base path and rejects wildcard or credential scopes', () => {
  assert.equal(activitySiteFromPage('http://localhost:8096/jellyfin/web/index.html#/video?id=secret'), site);
  assert.equal(normalizeActivitySite('https://MEDIA.example/jellyfin'), 'https://media.example/jellyfin/');
  for (const value of ['https://user:pass@example.com/', 'https://*.example.com/', 'https://discord.com/',
    'file:///tmp/', 'https://example.com/?api_key=secret', 'https://example.com/a%2fb/']) {
    assert.throws(() => normalizeActivitySite(value), TypeError, value);
  }
  assert.equal(activitySiteMatches(site, site + 'web/#/home'), true);
  for (const value of ['http://localhost:8097/jellyfin/web/', 'http://localhost:8096/jellyfin-other/',
    'https://localhost:8096/jellyfin/web/', 'http://localhost:8096/jellyfin/%2f..%2fother/']) {
    assert.equal(activitySiteMatches(site, value), false, value);
  }
});

test('custom sites are an explicit V1 opt-in; existing static Activity scope stays HTTPS-only', () => {
  assert.deepEqual(validateActivityMetadata(metadata).matches, ['https://jellyfin.org/*']);
  assert.throws(() => validateActivityMetadata({ ...metadata, matches: [] }), /matches/);
  assert.throws(() => validateActivityMetadata({ ...metadata, apiVersion: 2 }), /V1/);
  assert.throws(() => validateActivityMetadata({ ...metadata, frames: 'all' }), /top-frame/);
  assert.equal(validateMatchPattern('http://localhost/*'), false);
  assert.equal(validateMatchPattern('https://*/*'), false);
});

test('install and restore with no servers register no scripts and execute no page code', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  assert.equal(h.scripts.size, 0);
  assert.equal(h.injections.length, 0);
  await h.manager.restoreAll();
  assert.equal(h.scripts.size, 0);
  assert.equal(h.injections.length, 0);
  assert.deepEqual((await h.manager.listInstalled())[0].sites, []);
});

test('adding a server requires permission and injects only its exact port and path', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  await assert.rejects(h.manager.addSite(metadata.id, site), /permission/);
  assert.equal(h.scripts.size, 0);
  h.origins.add('http://localhost/jellyfin/*');
  await h.manager.addSite(metadata.id, site);
  assert.deepEqual([...h.scripts.values()][0].matches, ['http://localhost/jellyfin/*']);
  assert.deepEqual(h.injections.map(injection => injection.target.tabId), [1]);
  assert.equal((await h.manager.handleUserScriptMessage(h.message(), h.sender())).ok, true);
  for (const url of ['http://localhost:8097/jellyfin/web/', 'http://localhost:8096/other/', 'https://elsewhere.example/web/']) {
    assert.equal(await h.manager.handleUserScriptMessage(h.message(), h.sender(url)), false);
  }
});

test('HTTP networking is limited to the calling page’s approved server, including port and path', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  h.origins.add('http://localhost/jellyfin/*');
  await h.manager.addSite(metadata.id, site);
  const fetch = url => h.manager.handleUserScriptMessage(h.message('net.fetch', { url, options: { headers: { Authorization: 'MediaBrowser Token="secret"' } } }), h.sender());
  assert.equal((await fetch(site + 'System/Info/Public')).ok, true);
  assert.equal(h.requests.length, 1);
  for (const url of ['http://localhost:8097/jellyfin/Items/one', 'http://localhost:8096/other/Items/one',
    'https://unrelated.example/Items/one', 'http://discord.com/api/users/@me']) {
    assert.equal((await fetch(url)).ok, false, url);
  }
  assert.equal(h.requests.length, 1);
  await h.manager.addSite(metadata.id, 'http://localhost:8097/jellyfin/');
  assert.equal((await fetch('http://localhost:8097/jellyfin/Items/one')).ok, false,
    'approval of another server must not let this page use its network scope');
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.stringify(await h.manager.status()).includes('secret'), false);
});

test('server removal invalidates old capabilities and disable/remove stop registration', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  h.origins.add('http://localhost/jellyfin/*');
  await h.manager.addSite(metadata.id, site);
  const oldMessage = h.message();
  await h.manager.setEnabled(metadata.id, false);
  assert.equal(h.scripts.size, 0);
  assert.equal(await h.manager.handleUserScriptMessage(oldMessage, h.sender()), false);
  await h.manager.setEnabled(metadata.id, true);
  assert.equal(h.scripts.size, 1);
  await h.manager.removeSite(metadata.id, site);
  assert.equal(h.scripts.size, 0);
  assert.equal(await h.manager.handleUserScriptMessage(oldMessage, h.sender()), false);
  assert.deepEqual(h.data.installedActivities[metadata.id].sites, []);
  await h.manager.remove(metadata.id);
  assert.equal(h.scripts.size, 0);
  assert.deepEqual(await h.manager.listInstalled(), []);
});

test('updates preserve server configuration and a failed scope save restores prior registration', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  h.origins.add('http://localhost/jellyfin/*');
  await h.manager.addSite(metadata.id, site);
  await h.manager.install({ metadata: { ...metadata, version: '1.0.1' }, source: 'void 1;' });
  assert.deepEqual(h.data.installedActivities[metadata.id].sites, [site]);
  h.failNextWrite();
  await assert.rejects(h.manager.removeSite(metadata.id, site), /Write failed/);
  assert.deepEqual(h.data.installedActivities[metadata.id].sites, [site]);
  assert.equal(h.scripts.size, 1);
});

test('a server enabled from a popup closed by the permission prompt is added when the grant arrives', async () => {
  const h = harness();
  await h.manager.install({ metadata, source: 'void 0;' });
  await h.manager.setPendingSite(metadata.id, 'http://localhost:8096/jellyfin');
  assert.deepEqual(await h.manager.completePendingSites(), [], 'nothing is added before the browser grants access');
  assert.equal(h.scripts.size, 0);
  h.origins.add('http://localhost/jellyfin/*');
  assert.deepEqual(await h.manager.completePendingSites(), [{ id: metadata.id, site }]);
  assert.deepEqual((await h.manager.listInstalled())[0].sites, [site]);
  assert.deepEqual(h.injections.map(injection => injection.target.tabId), [1]);
  assert.deepEqual(await h.manager.completePendingSites(), [], 'a pending server is applied once');
  assert.equal(h.injections.length, 1);
});

test('pending servers survive a worker restart, can be canceled, and expire', async () => {
  const h = harness();
  const session = {};
  h.api.storage.session = {
    async get(key) { return { [key]: structuredClone(session[key]) }; },
    async set(values) { Object.assign(session, structuredClone(values)); },
    async remove(key) { delete session[key]; },
  };
  await h.manager.install({ metadata, source: 'void 0;' });
  await h.manager.setPendingSite(metadata.id, site);
  const restarted = new ActivityManager({ api: h.api });
  h.origins.add('http://localhost/jellyfin/*');
  assert.deepEqual(await restarted.completePendingSites(), [{ id: metadata.id, site }]);
  assert.equal(session.pendingActivitySites, undefined);

  const other = 'http://localhost:8097/jellyfin/';
  h.origins.add('http://localhost/jellyfin/*');
  await restarted.setPendingSite(metadata.id, other);
  await restarted.setPendingSite(metadata.id, other, false);
  assert.deepEqual(await restarted.completePendingSites(), [], 'a denied or canceled request adds nothing');
  await restarted.setPendingSite(metadata.id, other);
  session.pendingActivitySites[0].expires = Date.now() - 1;
  assert.deepEqual(await restarted.completePendingSites(), [], 'stale requests expire');
  assert.deepEqual((await restarted.listInstalled())[0].sites, [site]);
  await assert.rejects(restarted.setPendingSite('missing', site), /user-configured/);
});
