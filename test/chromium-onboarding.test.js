import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [platformSource, source, html] = await Promise.all([
  readFile(new URL('../extension/platform/browser-api.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/welcome.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/welcome.html', import.meta.url), 'utf8'),
]);
const flush = () => new Promise(resolve => setImmediate(resolve));
const readyYouTube = { id: 'youtube', name: 'YouTube', enabled: true, status: 'waiting' };

test('Chromium opens the welcome page once on first install only', async () => {
  let installed;
  const opened = [];
  const stored = {};
  const chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`, onInstalled: { addListener(listener) { installed = listener; } } },
    storage: { local: { async get() { return stored; }, async set(values) { Object.assign(stored, values); } } },
    tabs: { async create(options) { opened.push(options); } },
  };
  const context = vm.createContext({ chrome });
  vm.runInContext(`${platformSource.replace(/^export /gm, '')}\nglobalThis.registerOnboarding = registerOnboarding;`, context);
  context.registerOnboarding();
  assert.equal(typeof installed, 'function');
  await installed({ reason: 'update' });
  assert.equal(opened.length, 0);
  await installed({ reason: 'install' });
  await installed({ reason: 'install' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'chrome-extension://test/welcome.html');
});

async function welcome({ allowed = false, installed = [] } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    textContent: '', disabled: true, listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    classList: { toggle() {} },
  }]));
  const focusListeners = new Map();
  const state = { allowed, installed, opened: [], writes: [], restores: 0 };
  const api = {
    runtime: { async sendMessage({ type }) {
      if (type === 'ACTIVITY_LIBRARY_STATE') return { ok: true, result: { userScriptsPermission: state.allowed, installed: structuredClone(state.installed) } };
      if (type === 'ACTIVITY_RESTORE') { state.restores += 1; state.installed = [readyYouTube]; }
      return { ok: true, setup: { authenticated: false } };
    } },
    storage: { local: { async set(values) { state.writes.push(values); } } },
    tabs: { async create(options) { state.opened.push(options); } },
  };
  const location = { href: 'welcome.html' };
  const context = vm.createContext({ api, location, FIREFOX_ONBOARDING_KEY: 'firefoxOnboarding',
    document: { getElementById: id => elements.get(id) },
    window: { addEventListener(type, callback) { focusListeners.set(type, callback); } },
    openUserScriptsSettings: api => api.tabs.create({ url: 'chrome://extensions/?id=test' }),
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await flush();
  return { elements, state, location,
    click: async id => { await elements.get(id).listeners.get('click')(); await flush(); },
    async focus() { focusListeners.get('focus')(); await flush(); } };
}

test('the Chromium guide opens extension settings and cannot finish before User Scripts are allowed', async () => {
  const ui = await welcome();
  assert.equal(ui.elements.get('enable-activities').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  await ui.click('enable-activities');
  assert.deepEqual(ui.state.opened, [{ url: 'chrome://extensions/?id=test' }]);
});

test('returning after allowing User Scripts installs the included Activity and enables finishing', async () => {
  const ui = await welcome();
  ui.state.allowed = true;
  await ui.focus();
  assert.equal(ui.state.restores, 1);
  assert.equal(ui.elements.get('try-youtube').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, false);
  await ui.click('finish-setup');
  assert.equal(ui.state.writes[0].firefoxOnboarding.completed, true);
  assert.equal(ui.location.href, 'activities.html?view=installed');
});

test('Discord is step 2, optional only with ChudPresence Link, and Link downloads are offered', async () => {
  assert.ok(html.indexOf('id="discord-step"') < html.indexOf('id="activity-step"'));
  assert.match(html, /<span class="step-number"[^>]*>2<\/span>\s*<div class="step-content">\s*<div class="step-heading"><h2>Connect Discord/);
  assert.match(html, /github\.com\/ChudForks\/ChudPresence-Link\/releases\/tag\/v0\.4\.1-build\.cf1de1439101cbbece94a02d5aac484c24cd8d2e/);
  assert.match(html, /Microsoft Store/);
  assert.match(source, /linked \? 'Optional' : 'Needed to share'/);
});
