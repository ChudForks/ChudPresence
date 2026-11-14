import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../extension/platform/browser-api.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');

function platform({ browser, chrome, ...environment }) {
  const context = vm.createContext({ browser, chrome, ...environment });
  vm.runInContext(`${source}\nglobalThis.platform = { browserApi, isFirefox, browserName, extensionsPageUrl, USER_SCRIPTS_REQUIRED, USER_SCRIPTS_UNAVAILABLE, configureUserScriptsDialog, isBackgroundSuspending, openUserScriptsSettings, registerFirefoxOnboarding };`, context);
  return { ...context.platform, context };
}

test('Firefox routes shared chrome call sites through the native Promise browser namespace', async () => {
  const promiseApi = { runtime: { getBrowserInfo() {} }, storage: { local: {
    async get() { assert.equal(this, promiseApi.storage.local); return { enabled: false }; },
  } } };
  const callbackApi = { storage: { local: { get() { assert.fail('Legacy callback API selected'); } } } };
  const harness = platform({ browser: promiseApi, chrome: callbackApi });
  assert.equal(harness.isFirefox, true);
  assert.equal(harness.browserName, 'Firefox');
  assert.equal(harness.browserApi, promiseApi);
  assert.equal(harness.context.chrome, promiseApi);
  assert.deepEqual(await harness.context.chrome.storage.local.get('enabled'), { enabled: false });
});

test('Chromium branding distinguishes shared engine brands, legacy user agents, and an unidentified browser', async () => {
  for (const [navigator, name, scheme] of [
    [{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Not A Brand' }, { brand: 'Google Chrome' }] } }, 'Chrome', 'chrome'],
    [{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Brave' }] } }, 'Brave', 'brave'],
    [{ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] } }, 'Edge', 'edge'],
    [{ userAgent: 'Chrome/142.0.0.0 Edg/142.0.0.0' }, 'Edge', 'edge'],
    [{ userAgent: 'Chrome/142.0.0.0' }, 'Chrome', 'chrome'],
    [{ userAgent: 'Chrome/142.0.0.0', userAgentData: { brands: [{ brand: 'Chromium' }] } }, 'Chromium', 'chrome'],
    [{}, 'Chromium', 'chrome'],
  ]) {
    const opened = [];
    const chrome = { runtime: { id: 'extension id' }, tabs: { async create(options) { opened.push(options); } } };
    const harness = platform({ chrome, navigator });
    assert.equal(harness.browserName, name);
    assert.equal(harness.extensionsPageUrl, `${scheme}://extensions`);
    assert.equal(harness.USER_SCRIPTS_REQUIRED, `Allow User Scripts in ${name} settings`);
    assert.ok(harness.USER_SCRIPTS_UNAVAILABLE.startsWith(`${name} does not expose`));
    await harness.openUserScriptsSettings();
    assert.equal(opened[0].url, `${scheme}://extensions/?id=extension%20id`);
    const browserLabels = [{}, {}];
    const addressLabels = [{}];
    const button = {};
    harness.configureUserScriptsDialog({
      querySelectorAll: selector => selector === '[data-browser-name]' ? browserLabels : addressLabels,
      getElementById: id => { assert.equal(id, 'open-extension-details'); return button; },
    });
    assert.deepEqual(browserLabels.map(label => label.textContent), [name, name]);
    assert.equal(addressLabels[0].textContent, `${scheme}://extensions`);
    assert.equal(button.textContent, `Open ${name} Extensions`);
  }
});

test('Firefox requests optional User Scripts permission during the user gesture and preserves its outcome', async () => {
  let requested = 0;
  let allowed = false;
  const browser = { runtime: { getBrowserInfo() {} }, permissions: {
    request(query) {
      assert.equal(this, browser.permissions);
      assert.deepEqual(Array.from(query.permissions), ['userScripts']);
      requested += 1;
      return Promise.resolve(allowed);
    },
  }, tabs: { create() { assert.fail('Firefox must not open Chrome extension settings'); } } };
  const harness = platform({ browser });
  const denied = harness.openUserScriptsSettings();
  assert.equal(requested, 1);
  assert.equal(await denied, false);
  allowed = true;
  assert.equal(await harness.openUserScriptsSettings(), true);
  browser.permissions.request = () => Promise.reject(new Error('Permission prompt failed'));
  await assert.rejects(harness.openUserScriptsSettings(), /Permission prompt failed/);
});

test('the browser adapter preserves Chromium settings behavior and its original API object', async () => {
  const created = [];
  const chrome = { runtime: { id: 'extension id' }, tabs: {
    async create(options) { created.push(options); },
  } };
  const harness = platform({ chrome });
  assert.equal(harness.isFirefox, false);
  assert.equal(harness.browserApi, chrome);
  assert.equal(harness.context.chrome, chrome);
  await harness.openUserScriptsSettings();
  assert.equal(created[0].url, 'chrome://extensions/?id=extension%20id');
});

test('Firefox opens setup once for a fresh install, leaving updates, startups, and saved setup alone', async () => {
  const opened = [];
  const stored = {};
  let installed;
  const browser = { runtime: { getBrowserInfo() {}, getURL: path => `moz-extension://test/${path}`,
    onInstalled: { addListener(listener) { installed = listener; } },
    onStartup: { addListener() { assert.fail('Setup must not open on browser startup'); } },
  }, storage: { local: {
    async get() { return stored; }, async set(values) { Object.assign(stored, values); },
  } }, tabs: { async create(options) { opened.push(options); } },
  permissions: { request() { assert.fail('Installing must not prompt for optional permissions'); } } };
  platform({ browser }).registerFirefoxOnboarding();
  assert.equal(typeof installed, 'function', 'listener must be registered synchronously');
  for (const reason of ['update', 'browser_update', 'shared_module_update']) await installed({ reason });
  assert.equal(opened.length, 0);
  await installed({ reason: 'install' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'moz-extension://test/welcome.html');
  assert.equal(stored.firefoxOnboarding.completed, false);
  await installed({ reason: 'install' });
  stored.firefoxOnboarding.completed = true;
  await installed({ reason: 'install' });
  assert.equal(opened.length, 1);
});

test('a failed Firefox setup tab can be retried and Chromium never registers onboarding', async () => {
  let installed;
  let attempts = 0;
  const stored = {};
  const browser = { runtime: { getBrowserInfo() {}, getURL: path => path,
    onInstalled: { addListener(listener) { installed = listener; } },
  }, storage: { local: { async get() { return stored; }, async set(values) { Object.assign(stored, values); } } },
  tabs: { async create() { if (++attempts === 1) throw new Error('Tab unavailable'); } } };
  platform({ browser }).registerFirefoxOnboarding();
  await installed({ reason: 'install' });
  assert.equal(stored.firefoxOnboarding, undefined);
  await installed({ reason: 'install' });
  assert.equal(attempts, 2);
  assert.equal(stored.firefoxOnboarding.completed, false);
  const chrome = { runtime: { onInstalled: { addListener() { assert.fail('Chromium onboarding registered'); } } } };
  platform({ chrome }).registerFirefoxOnboarding();
});

test('Firefox distinguishes background suspension, cancellation, and page exit without making cleanup requests', () => {
  for (const pathname of ['/background.html', '/popup.html']) {
    const listeners = new Map();
    const browser = { runtime: { getBrowserInfo() {},
      onSuspend: { addListener(listener) { listeners.set('suspend', listener); } },
      onSuspendCanceled: { addListener(listener) { listeners.set('cancelled', listener); } },
    } };
    const harness = platform({ browser, location: { pathname },
      addEventListener(name, listener) { listeners.set(name, listener); },
      fetch() { assert.fail('Suspending a Firefox event page must not clear Discord'); },
    });
    assert.equal(harness.isBackgroundSuspending(), false);
    listeners.get('suspend')();
    assert.equal(harness.isBackgroundSuspending(), true);
    listeners.get('cancelled')();
    assert.equal(harness.isBackgroundSuspending(), false);
    assert.equal(listeners.has('pagehide'), pathname === '/background.html');
    if (pathname === '/background.html') {
      listeners.get('pagehide')();
      assert.equal(harness.isBackgroundSuspending(), true);
    }
  }
});
