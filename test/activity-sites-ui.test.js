import assert from 'node:assert/strict';
import test from 'node:test';
import { renderActivitySites } from '../extension/activity-sites-ui.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; }
  append(...values) { this.children.push(...values); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { return this.disabled ? undefined : this.listeners.click?.(); }
  find(className) {
    if (this.className?.split(' ').includes(className)) return this;
    for (const child of this.children) { const found = child.find?.(className); if (found) return found; }
    return null;
  }
}

function fixture({ allowed = true, enabled = true, sites = [], status, network } = {}) {
  const permissions = [];
  const messages = [];
  let refreshes = 0;
  const activity = { id: 'jellyfin', name: 'Jellyfin', apiVersion: 1, siteAccess: 'user-configured', enabled, sites, status, network };
  const options = { document: { createElement: tag => new Element(tag) }, activity,
    currentTab: { url: 'http://localhost:8096/jellyfin/web/index.html#/home' },
    api: { permissions: { async request(query) { permissions.push(query); return allowed; } } },
    async sendMessage(message) { messages.push(message); }, async onChanged() { refreshes += 1; } };
  return { options, section: renderActivitySites(options), permissions, messages, get refreshes() { return refreshes; } };
}

test('server UI makes no permission request until the user clicks, and grants only the selected host', async () => {
  const h = fixture();
  assert.deepEqual(h.permissions, []);
  assert.deepEqual(h.messages, []);
  const action = h.section.find('activity-site-current');
  const pending = action.click();
  assert.deepEqual(h.permissions, [{ origins: ['http://localhost/jellyfin/*'] }], 'permission request must start in the click');
  await pending;
  assert.deepEqual(h.messages, [
    { type: 'ACTIVITY_PENDING_SITE', id: 'jellyfin', site: 'http://localhost:8096/jellyfin/' },
    { type: 'ACTIVITY_ADD_SITE', id: 'jellyfin', site: 'http://localhost:8096/jellyfin/' },
  ], 'the pending server is recorded before the prompt can close the popup');
  assert.equal(h.refreshes, 1);
});

test('one click requests the server and the Activity’s declared network origins together', async () => {
  const h = fixture({ network: ['https://musicbrainz.org/ws/2/release/*'] });
  await h.section.find('activity-site-current').click();
  assert.deepEqual(h.permissions, [{ origins: ['http://localhost/jellyfin/*', 'https://musicbrainz.org/ws/2/release/*'] }]);
  assert.equal(h.messages.at(-1).type, 'ACTIVITY_ADD_SITE');
});

test('denied permission leaves server configuration unchanged and reports the outcome', async () => {
  const h = fixture({ allowed: false });
  await h.section.find('activity-site-current').click();
  assert.deepEqual(h.messages.map(message => [message.type, message.cancel === true]),
    [['ACTIVITY_PENDING_SITE', false], ['ACTIVITY_PENDING_SITE', true]], 'a denied request cancels its pending server');
  assert.match(h.section.find('activity-sites-feedback').textContent, /not granted/);
  assert.equal(h.section.find('activity-site-current').disabled, false);
});

test('disabled Activities offer no current-site activation and normal Activities have no server UI', async () => {
  const h = fixture({ enabled: false });
  assert.equal(h.section.find('activity-site-current').disabled, true);
  await h.section.find('activity-site-current').click();
  assert.equal(h.permissions.length, 0);
  assert.equal(renderActivitySites({ ...h.options, activity: { ...h.options.activity, siteAccess: undefined } }), null);
});

test('removal needs no new permission and configured sites can restore revoked access', async () => {
  const site = 'http://localhost:8096/jellyfin/';
  const h = fixture({ sites: [site], status: 'permission-missing' });
  assert.equal(h.section.find('activity-site-current').disabled, false);
  await h.section.find('activity-site-remove').click();
  assert.equal(h.permissions.length, 0);
  assert.deepEqual(h.messages, [{ type: 'ACTIVITY_REMOVE_SITE', id: 'jellyfin', site }]);
});

test('manual setup accepts pasted Jellyfin Web URLs but never stores query credentials', async () => {
  const h = fixture();
  h.section.find('activity-site-input').value = 'https://media.example/jellyfin/web/index.html?api_key=secret#/home';
  await h.section.find('activity-site-add').click();
  assert.equal(h.messages[0].site, 'https://media.example/jellyfin/');
  assert.equal(JSON.stringify(h.messages).includes('secret'), false);
});
