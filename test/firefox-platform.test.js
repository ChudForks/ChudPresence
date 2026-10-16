import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../extension/platform/browser-api.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');

function platform({ browser, chrome, ...environment }) {
  const context = vm.createContext({ browser, chrome, ...environment });
  vm.runInContext(`${source}\nglobalThis.platform = { browserApi, isFirefox, isBackgroundSuspending, openUserScriptsSettings };`, context);
  return { ...context.platform, context };
}

test('Firefox routes shared chrome call sites through the native Promise browser namespace', async () => {
  const promiseApi = { runtime: { getBrowserInfo() {} }, storage: { local: {
    async get() { assert.equal(this, promiseApi.storage.local); return { enabled: false }; },
  } } };
  const callbackApi = { storage: { local: { get() { assert.fail('Legacy callback API selected'); } } } };
  const harness = platform({ browser: promiseApi, chrome: callbackApi });
  assert.equal(harness.isFirefox, true);
  assert.equal(harness.browserApi, promiseApi);
  assert.equal(harness.context.chrome, promiseApi);
  assert.deepEqual(await harness.context.chrome.storage.local.get('enabled'), { enabled: false });
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
