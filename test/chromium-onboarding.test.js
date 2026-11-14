import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [platformSource, guideSource, source, html] = await Promise.all([
  readFile(new URL('../extension/platform/browser-api.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/setup-guide.js', import.meta.url), 'utf8'),
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

async function welcome({ allowed = false, installed = [], navigator = {}, authenticated = false, linked = false } = {}) {
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
  const labels = { '[data-browser-name]': [{ textContent: '' }], '[data-extensions-page]': [{ textContent: '' }] };
  const state = { allowed, installed, authenticated, linked, opened: [], writes: [], restores: 0, settingsError: '', stateError: '' };
  const api = {
    runtime: { id: 'test', async sendMessage({ type }) {
      if (state.stateError) throw new Error(state.stateError);
      if (type === 'ACTIVITY_LIBRARY_STATE') return { ok: true, result: { userScriptsPermission: state.allowed, installed: structuredClone(state.installed) } };
      if (type === 'ACTIVITY_RESTORE') { state.restores += 1; state.installed = [readyYouTube]; }
      if (type === 'CONNECT_DISCORD') state.authenticated = true;
      return { ok: true, setup: { authenticated: state.authenticated }, delivery: { link: { paired: state.linked } } };
    } },
    storage: { local: { async set(values) { state.writes.push(values); } } },
    tabs: { async create(options) {
      if (state.settingsError) throw new Error(state.settingsError);
      state.opened.push(structuredClone(options));
    } },
  };
  const location = { href: 'welcome.html' };
  const context = vm.createContext({ api, chrome: api, navigator, location,
    document: { getElementById: id => elements.get(id), querySelectorAll: selector => labels[selector] || [] },
    window: { addEventListener(type, callback) { focusListeners.set(type, callback); } },
  });
  vm.runInContext(platformSource.replace(/^export /gm, ''), context);
  vm.runInContext(guideSource.replace(/^export /gm, ''), context);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await flush();
  return { elements, labels, state, location,
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

test('the wizard exposes its current step and allows reviewing panels without granting permissions', async () => {
  const ui = await welcome();
  assert.equal(ui.elements.get('intro-step').hidden, false);
  assert.equal(ui.elements.get('permission-step').hidden, true);
  assert.equal(ui.elements.get('setup-back').hidden, true);
  assert.equal(ui.elements.get('finish-setup').hidden, true);
  assert.equal(ui.elements.get('setup-next').textContent, 'Let’s get started');
  assert.equal(ui.elements.get('setup-position').textContent, 'Step 1 of 4');
  assert.equal(ui.elements.get('intro-title').focusCalls.length, 0);
  assert.equal(ui.elements.get('intro-title').scrollCalls.length, 0);
  await ui.click('setup-nav-activity');
  assert.equal(ui.elements.get('intro-step').hidden, true);
  assert.equal(ui.elements.get('activity-step').hidden, false);
  assert.equal(ui.elements.get('setup-nav-activity').attributes.get('aria-current'), 'step');
  assert.equal(ui.elements.get('setup-nav-welcome').attributes.has('aria-current'), false);
  assert.equal(ui.elements.get('setup-progress').attributes.get('aria-valuenow'), '4');
  assert.equal(ui.elements.get('setup-progress').attributes.get('aria-valuetext'), 'Step 4 of 4');
  assert.equal(ui.elements.get('setup-position').textContent, 'Step 4 of 4');
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.equal(ui.state.opened.length, 0);
  assert.equal(ui.state.writes.length, 0);
  await ui.click('setup-nav-welcome');
  assert.equal(ui.elements.get('setup-back').hidden, true);
  assert.equal(ui.elements.get('setup-next').hidden, false);
  assert.deepEqual(ui.elements.get('intro-title').focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(ui.elements.get('intro-title').scrollCalls, [{ block: 'nearest', behavior: 'instant' }]);
});

for (const [name, scheme, navigator] of [
  ['Chrome', 'chrome', { userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] } }],
  ['Brave', 'brave', { userAgent: 'Chrome/142.0.0.0', brave: { async isBrave() { return true; } } }],
  ['Edge', 'edge', { userAgentData: { brands: [{ brand: 'Google Chrome' }, { brand: 'Microsoft Edge' }] } }],
]) {
  test(`the ${name} welcome guide uses matching labels, settings links, and recovery instructions`, async () => {
    const ui = await welcome({ navigator });
    assert.equal(ui.elements.get('enable-activities').textContent, `Open ${name} extension settings`);
    assert.equal(ui.labels['[data-browser-name]'][0].textContent, name);
    assert.equal(ui.labels['[data-extensions-page]'][0].textContent, `${scheme}://extensions`);
    await ui.click('enable-activities');
    assert.equal(ui.state.opened[0].url, `${scheme}://extensions/?id=test`);
    assert.match(ui.elements.get('setup-feedback').textContent, new RegExp(`In the ${name} tab`));
    assert.match(ui.elements.get('setup-feedback').textContent, /Allow User Scripts.*Developer mode/);
    assert.doesNotMatch(ui.elements.get('setup-feedback').textContent, /(?:Brave|Edge) 13[578]/);
    ui.state.settingsError = 'Settings blocked';
    await ui.click('enable-activities');
    assert.ok(ui.elements.get('setup-feedback').textContent.includes(`Open ${scheme}://extensions`));
    ui.state.stateError = 'Worker unavailable';
    await ui.focus();
    assert.equal(ui.elements.get('enable-activities').textContent, `Open ${name} extension settings`);
    assert.equal(ui.elements.get('enable-activities').disabled, false);
  });
}

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

test('Discord follows Activities permission, has an accessible panel, and offers Link downloads', async () => {
  assert.ok(html.indexOf('id="permission-step"') < html.indexOf('id="discord-step"'));
  assert.ok(html.indexOf('id="discord-step"') < html.indexOf('id="activity-step"'));
  assert.match(html, /<button\b[^>]*id="setup-nav-discord"[^>]*>[\s\S]*?<span>Connect Discord<\/span><\/button>/);
  assert.match(html, /<section\b[^>]*id="discord-step"[^>]*aria-labelledby="discord-title"/);
  assert.match(html, /<h2\b[^>]*id="discord-title"[^>]*tabindex="-1"/);
  assert.match(html, /github\.com\/ChudForks\/ChudPresence-Link\/releases\/tag\/v0\.4\.1-build\.cf1de1439101cbbece94a02d5aac484c24cd8d2e/);
  assert.match(html, /Microsoft Store/);
  assert.match(source, /linked \? 'Optional' : 'Needed to share'/);
});

test('Chromium readiness refresh keeps the chosen panel and blocks continuation after permission is revoked', async () => {
  const ui = await welcome();
  await ui.click('setup-next');
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'permission');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  ui.state.allowed = true;
  await ui.focus();
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'permission');
  assert.equal(ui.elements.get('setup-next').disabled, false);
  assert.equal(ui.elements.get('permission-title').focusCalls.length, 1, 'background refresh must not move focus');
  assert.equal(ui.elements.get('permission-title').scrollCalls.length, 1, 'background refresh must not scroll');
  await ui.click('setup-next');
  assert.equal(ui.elements.get('setup-next').textContent, 'Use local preview');
  await ui.click('setup-next');
  assert.equal(ui.elements.get('finish-setup').hidden, false);
  ui.state.allowed = false;
  await ui.focus();
  assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'activity');
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.doesNotMatch(ui.elements.get('activity-description').textContent, /ready to try/);
  await ui.click('finish-setup');
  assert.equal(ui.state.writes.length, 0);
  await ui.click('setup-nav-permission');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  assert.deepEqual(ui.elements.get('permission-title').focusCalls.at(-1), { preventScroll: true });
});

for (const route of ['authenticated', 'linked']) {
  test(`the Chromium wizard recognizes the ${route} sharing route without navigating automatically`, async () => {
    const ui = await welcome({ allowed: true, installed: [readyYouTube], [route]: true });
    assert.equal(ui.elements.get('setup-wizard').attributes.get('data-step'), 'welcome');
    await ui.click('setup-nav-discord');
    assert.equal(ui.elements.get('setup-next').textContent, 'Try your first Activity');
    assert.equal(ui.elements.get('setup-nav-discord').classList.values.has('is-complete'), true);
    await ui.click('setup-next');
    assert.equal(ui.elements.get('finish-setup').disabled, false);
    assert.match(ui.elements.get('finish-description').textContent, /sharing connection is ready/);
    ui.state[route] = false;
    await ui.focus();
    assert.match(ui.elements.get('finish-description').textContent, /Connect Discord or pair Link/);
    assert.match(ui.elements.get('discord-feedback').textContent, /disconnected/);
    assert.equal(ui.elements.get('setup-nav-discord').classList.values.has('is-complete'), false);
  });
}

test('a failed Chromium readiness recheck clears cached readiness until a successful refresh', async () => {
  const ui = await welcome({ allowed: true, installed: [readyYouTube] });
  await ui.click('setup-nav-activity');
  ui.state.stateError = 'Worker unavailable';
  await ui.click('finish-setup');
  assert.equal(ui.state.writes.length, 0);
  assert.equal(ui.elements.get('finish-setup').disabled, true);
  assert.equal(ui.elements.get('try-youtube').disabled, true);
  assert.equal(ui.elements.get('permission-state').textContent, 'Check needed');
  assert.match(ui.elements.get('setup-feedback').textContent, /Could not verify setup/);
  await ui.click('setup-nav-permission');
  assert.equal(ui.elements.get('setup-next').disabled, true);
  ui.state.stateError = '';
  await ui.focus();
  assert.equal(ui.elements.get('setup-next').disabled, false);
  assert.equal(ui.elements.get('finish-setup').disabled, false);
});
