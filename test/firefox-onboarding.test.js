import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [guideSource, source, html] = await Promise.all([
  readFile(new URL('../extension/setup-guide.js', import.meta.url), 'utf8'),
  readFile(new URL('../ChudPresence-Firefox/extension/welcome.js', import.meta.url), 'utf8'),
  readFile(new URL('../ChudPresence-Firefox/extension/welcome.html', import.meta.url), 'utf8'),
]);
const readyYouTube = { id: 'youtube', name: 'YouTube', enabled: true, status: 'waiting' };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function welcome({ allowed = false, installed = [], authenticated = false, linked = false } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    textContent: '', disabled: true, hidden: false, attributes: new Map(), listeners: new Map(), focusCalls: [], scrollCalls: [],
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    focus(options) { this.focusCalls.push(structuredClone(options)); },
    scrollIntoView(options) { this.scrollCalls.push(structuredClone(options)); },
    classList: { values: new Set(), toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); } },
  }]));
  const focusListeners = new Map();
  const calls = [];
  const writes = [];
  const tabs = [];
  const state = { allowed, installed, authenticated, linked, grant: true, stateError: '', restoreError: '', discordError: '', storageError: '' };
  const api = {
    runtime: { async sendMessage({ type }) {
      calls.push(type);
      if (type === 'ACTIVITY_LIBRARY_STATE') {
        if (state.stateError) throw new Error(state.stateError);
        return { ok: true, result: { userScriptsPermission: state.allowed, installed: structuredClone(state.installed) } };
      }
      if (type === 'ACTIVITY_RESTORE') {
        if (state.restoreError) return { ok: false, error: state.restoreError };
        if (state.allowed && state.installed.length === 0) state.installed = [readyYouTube];
        return { ok: true };
      }
      if (type === 'CONNECT_DISCORD') {
        if (state.discordError) return { ok: false, error: state.discordError };
        state.authenticated = true;
      }
      return { ok: true, setup: { authenticated: state.authenticated }, delivery: { link: { paired: state.linked } } };
    } },
    permissions: { request(query) {
      assert.deepEqual(Array.from(query.permissions), ['userScripts']);
      assert.equal(query.origins, undefined, 'script permission must be requested separately from site permissions');
      calls.push('permission');
      if (state.grant instanceof Error) return Promise.reject(state.grant);
      if (state.grant) state.allowed = true;
      return Promise.resolve(state.grant);
    } },
    storage: { local: { async set(values) {
      if (state.storageError) throw new Error(state.storageError);
      writes.push(structuredClone(values));
    } } },
    tabs: { async create(options) { tabs.push(options); } },
  };
  const location = { href: 'welcome.html' };
  const context = vm.createContext({ api, location, FIREFOX_ONBOARDING_KEY: 'firefoxOnboarding',
    document: { getElementById: id => elements.get(id) },
    window: { addEventListener(type, callback) { focusListeners.set(type, callback); } },
    openUserScriptsSettings: api => api.permissions.request({ permissions: ['userScripts'] }),
  });
  vm.runInContext(guideSource.replace(/^export /gm, ''), context);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await flush();
  return { elements, state, calls, writes, tabs, location,
    click: id => elements.get(id).listeners.get('click')(),
    async focus() { focusListeners.get('focus')(); await flush(); },
  };
}

test('a new Firefox setup explains the permission and waits for a click before requesting anything', async () => {
  const ui = await welcome();
  assert.equal(ui.elements.get('enable-activities').disabled, false);
  assert.equal(ui.elements.get('try-youtube').disabled, true);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.equal(ui.elements.get('connect-discord').disabled, false);
  assert.equal(ui.calls.includes('permission'), false);
  assert.equal(ui.calls.includes('CONNECT_DISCORD'), false);
  assert.match(ui.elements.get('setup-feedback').textContent, /permission/);
  assert.equal(ui.writes.length, 0);
});

test('permission denial leaves setup incomplete and the same button can retry successfully', async () => {
  const ui = await welcome();
  ui.state.grant = false;
  await ui.click('enable-activities');
  assert.match(ui.elements.get('setup-feedback').textContent, /wasn’t granted.*try again/);
  assert.equal(ui.elements.get('enable-activities').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.equal(ui.calls.includes('ACTIVITY_RESTORE'), false);
  ui.state.grant = true;
  const before = ui.calls.length;
  const enabling = ui.click('enable-activities');
  assert.equal(ui.calls[before], 'permission', 'permission request must run synchronously within the click');
  await enabling;
  assert.deepEqual(ui.calls.slice(before), ['permission', 'ACTIVITY_RESTORE', 'ACTIVITY_LIBRARY_STATE']);
  assert.equal(ui.elements.get('enable-activities').disabled, true);
  assert.equal(ui.elements.get('try-youtube').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  assert.match(ui.elements.get('activity-description').textContent, /installed and enabled/);
  assert.equal(ui.writes.length, 0, 'permission alone must not mark the guide complete');
});

test('setup survives reopening and finishes with an enabled Activity while Discord is disconnected', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  assert.equal(ui.elements.get('connect-discord').disabled, false);
  await ui.click('try-youtube');
  assert.equal(ui.tabs[0].url, 'https://www.youtube.com/');
  await ui.click('finish-setup');
  assert.equal(ui.writes[0].firefoxOnboarding.completed, true);
  assert.equal(ui.location.href, 'activities.html?view=installed');
  assert.equal(ui.calls.includes('CONNECT_DISCORD'), false);
});

for (const status of ['disabled', 'error', 'incompatible', 'permission-missing']) {
  test(`setup cannot finish while its only Activity is ${status}`, async () => {
    const ui = await welcome({ allowed: true, installed: [{ ...readyYouTube, status, enabled: status !== 'disabled' }] });
    assert.equal(ui.elements.get('try-youtube').disabled, true);
    assert.equal(ui.elements.get('finish-setup').disabled, true);
    await ui.click('finish-setup');
    assert.equal(ui.writes.length, 0);
  });
}

test('setup respects removed YouTube and can finish with a different detected Activity', async () => {
  const ui = await welcome({ allowed: true, installed: [{ id: 'music', name: 'Music', enabled: true, status: 'detected' }] });
  assert.equal(ui.elements.get('try-youtube').disabled, true);
  assert.match(ui.elements.get('activity-description').textContent, /Music is ready/);
  await ui.click('finish-setup');
  assert.equal(ui.writes[0].firefoxOnboarding.completed, true);
});

test('permission changes in another tab refresh on focus and are rechecked before completing setup', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  ui.state.allowed = false;
  await ui.click('finish-setup');
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  ui.state.allowed = true;
  await ui.focus();
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  assert.equal(ui.calls.includes('permission'), false);
});

test('a failed optional Discord sign-in can be retried without blocking Activity setup', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  ui.state.discordError = 'Sign-in cancelled';
  await ui.click('connect-discord');
  assert.match(ui.elements.get('discord-feedback').textContent, /Sign-in cancelled.*connect later/);
  assert.equal(ui.elements.get('connect-discord').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  ui.state.discordError = '';
  await ui.click('connect-discord');
  assert.equal(ui.elements.get('connect-discord').textContent, 'Discord connected');
  assert.equal(ui.elements.get('connect-discord').disabled, true);
});

test('permission, restore, and storage failures leave their actions retryable', async () => {
  const ui = await welcome();
  ui.state.grant = new Error('Prompt unavailable');
  await ui.click('enable-activities');
  assert.match(ui.elements.get('setup-feedback').textContent, /Prompt unavailable/);
  assert.equal(ui.elements.get('enable-activities').disabled, false);
  ui.state.grant = true;
  ui.state.restoreError = 'Activity restore failed';
  await ui.click('enable-activities');
  assert.match(ui.elements.get('setup-feedback').textContent, /Activity restore failed/);
  assert.equal(ui.elements.get('enable-activities').disabled, false);
  ui.state.restoreError = '';
  await ui.click('enable-activities');
  ui.state.storageError = 'Storage unavailable';
  await ui.click('finish-setup');
  assert.equal(ui.location.href, 'welcome.html');
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  ui.state.storageError = '';
  await ui.click('finish-setup');
  assert.equal(ui.location.href, 'activities.html?view=installed');
});

test('the Firefox wizard stays on the permission panel while enabling and can continue with local preview', async () => {
  const ui = await welcome();
  await ui.click('setup-next');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  await ui.click('setup-next');
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'permission');
  await ui.click('enable-activities');
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'permission');
  assert.equal(ui.elements.get('setup-next').disabled, false);
  assert.equal(ui.elements.get('permission-title').focusCalls.length, 1);
  assert.equal(ui.elements.get('permission-title').scrollCalls.length, 1);
  await ui.click('setup-next');
  assert.equal(ui.elements.get('setup-next').textContent, 'Use local preview');
  await ui.click('setup-next');
  assert.equal(ui.elements.get('finish-setup').hidden, false);
  assert.equal(ui.elements.get('setup-next').hidden, true);
  assert.equal(ui.calls.includes('CONNECT_DISCORD'), false);
  ui.state.allowed = false;
  await ui.focus();
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'activity');
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.doesNotMatch(ui.elements.get('activity-description').textContent, /ready to try/);
  await ui.click('setup-back');
  await ui.click('setup-back');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  assert.deepEqual(ui.elements.get('permission-title').focusCalls.at(-1), { preventScroll: true });
});

test('the Firefox wizard updates Discord navigation after sign-in without taking over focus', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  await ui.click('setup-nav-discord');
  await ui.click('connect-discord');
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'discord');
  assert.equal(ui.elements.get('setup-next').textContent, 'Try your first Activity');
  assert.equal(ui.elements.get('discord-title').focusCalls.length, 1);
  assert.equal(ui.elements.get('discord-title').scrollCalls.length, 1);
  assert.match(ui.elements.get('finish-description').textContent, /sharing connection is ready/);
  ui.state.authenticated = false;
  await ui.focus();
  assert.match(ui.elements.get('discord-feedback').textContent, /disconnected/);
  assert.match(ui.elements.get('finish-description').textContent, /Connect Discord or pair Link/);
  assert.equal(ui.elements.get('setup-next').textContent, 'Use local preview');
});

test('the Firefox wizard recognizes an existing paired Link sharing route', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube], linked: true });
  await ui.click('setup-nav-discord');
  assert.equal(ui.elements.get('discord-state').textContent, 'Optional');
  assert.equal(ui.elements.get('setup-next').textContent, 'Try your first Activity');
  assert.equal(ui.elements.get('setup-nav-discord').classList.values.has('is-complete'), true);
  assert.match(ui.elements.get('finish-description').textContent, /sharing connection is ready/);
  ui.state.linked = false;
  await ui.focus();
  assert.match(ui.elements.get('discord-feedback').textContent, /disconnected/);
  assert.equal(ui.elements.get('setup-next').textContent, 'Use local preview');
});

test('a failed Firefox refresh clears cached readiness while preserving the chosen panel', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  await ui.click('setup-nav-permission');
  ui.state.stateError = 'Worker unavailable';
  await ui.focus();
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'permission');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.equal(ui.elements.get('try-youtube').disabled, true);
  assert.equal(ui.elements.get('permission-title').scrollCalls.length, 1);
  assert.equal(ui.elements.get('permission-state').textContent, 'Check needed');
  ui.state.stateError = '';
  await ui.focus();
  assert.equal(ui.elements.get('setup-next').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, false);
});

test('a paired Link does not overwrite a failed Discord sign-in with a success message', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube], linked: true });
  await ui.click('setup-nav-discord');
  ui.state.discordError = 'Sign-in cancelled';
  await ui.click('connect-discord');
  assert.match(ui.elements.get('discord-feedback').textContent, /Sign-in cancelled/);
  await ui.focus();
  assert.match(ui.elements.get('discord-feedback').textContent, /Sign-in cancelled/);
  assert.equal(ui.elements.get('setup-next').textContent, 'Try your first Activity');
  assert.match(ui.elements.get('finish-description').textContent, /sharing connection is ready/);
});
