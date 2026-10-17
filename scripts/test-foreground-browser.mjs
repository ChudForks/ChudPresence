// Real toolbar popups need a headed browser. This uses a disposable profile,
// synthetic HTTPS fixtures and no Discord credentials or existing user tabs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try {
  playwright = createRequire(process.env.CHUDPRESENCE_TEST_NODE_MODULES
    ? path.join(path.resolve(process.env.CHUDPRESENCE_TEST_NODE_MODULES), 'package.json') : import.meta.url)('playwright');
} catch {
  playwright = createRequire('C:/Users/Jonathan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright');
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-foreground-browser-'));
const otherExtension = path.join(scratch, 'other-extension');
await fs.mkdir(otherExtension);
await fs.writeFile(path.join(otherExtension, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Foreground test popup', version: '1.0.0',
  action: { default_popup: 'popup.html' }, background: { service_worker: 'other-worker.js' },
}));
await fs.writeFile(path.join(otherExtension, 'other-worker.js'), 'globalThis.foregroundTestPopup = true;');
await fs.writeFile(path.join(otherExtension, 'popup.html'), '<!doctype html><title>Other extension popup</title><p style="width:240px">Focus test</p>');
const fixture = 'https://www.youtube.com/chudpresence-foreground-fixture';
const loadedExtensions = [path.join(root, 'extension'), otherExtension].join(',');
let context;

async function until(operation, predicate, message) {
  const deadline = Date.now() + 15_000;
  let value;
  do {
    value = await operation();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

try {
  const candidates = process.env.CHUDPRESENCE_TEST_BROWSER ? [process.env.CHUDPRESENCE_TEST_BROWSER]
    : [playwright.chromium.executablePath(), ...(process.platform === 'win32'
      ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] : [])];
  const failures = [];
  for (const [index, executablePath] of candidates.entries()) {
    try {
      context = await playwright.chromium.launchPersistentContext(path.join(scratch, `profile-${index}`), {
        executablePath, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
        args: [`--disable-extensions-except=${loadedExtensions}`, `--load-extension=${loadedExtensions}`],
      });
      break;
    } catch (error) { failures.push(`${executablePath}: ${String(error.message).split('\n')[0]}`); }
  }
  if (!context) throw new Error(`No headed test browser could launch. Set CHUDPRESENCE_TEST_BROWSER.\n${failures.join('\n')}`);
  await context.route(/^https?:\/\//, route => route.request().url().startsWith(fixture)
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Foreground fixture</title><h1>Browsing fixture</h1>' })
    : route.abort());
  const worker = await until(async () => context.serviceWorkers().find(worker => worker.url().endsWith('/background.js')),
    Boolean, 'ChudPresence worker did not start');
  const otherWorker = await until(async () => context.serviceWorkers().find(worker => worker.url().endsWith('/other-worker.js')),
    Boolean, 'Other extension worker did not start');
  const extensionId = new URL(worker.url()).host;
  const preferences = await context.newPage();
  await preferences.goto(`chrome://extensions/?id=${extensionId}`);
  await preferences.evaluate(extensionId => chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true }), extensionId);
  await preferences.close();
  const controls = await context.newPage();
  await controls.goto(`chrome-extension://${extensionId}/activities.html`);
  const send = message => controls.evaluate(message => chrome.runtime.sendMessage(message), message);
  await send({ type: 'ACTIVITY_REMOVE', id: 'youtube' });
  await send({ type: 'SET_ENABLED', enabled: true });
  const state = () => send({ type: 'GET_STATE' });
  const expectPresence = (id, message) => until(state, value => id
    ? value.track?.activityId === id && !!value.finalPresenceIntent
    : !value.finalPresenceIntent, message);

  for (const apiVersion of [1, 2]) {
    const id = `foreground-v${apiVersion}`;
    const report = JSON.stringify({ kind: 'generic', media: { title: 'Browsing fixture' },
      focusPolicy: 'foreground', playback: { state: 'playing' } });
    const source = apiVersion === 1
      ? `function tick() { return location.pathname.endsWith('-clear') ? ChudPresence.clear() : ChudPresence.report(${report}); }
         ChudPresence.navigation.onChange(tick); ChudPresence.lifecycle.interval(tick, 2000); void tick();`
      : `ChudPresence.onUpdate(() => ChudPresence.page.info().pathname.endsWith('-clear')
          ? ChudPresence.clear() : ChudPresence.report(${report}));`;
    const installed = await send({ type: 'ACTIVITY_INSTALL', activityPackage: {
      metadata: { id, name: id, description: 'Synthetic foreground browser test', version: '1.0.0',
        apiVersion, minExtensionVersion: '2.0.5', entry: 'activity.js', matches: [`${fixture}*`],
        ...(apiVersion === 2 ? { pageAccess: { url: true } } : {}) }, source,
    } });
    assert.equal(installed.ok, true, JSON.stringify(installed));
    const page = await context.newPage();
    await page.goto(fixture);
    await page.bringToFront();
    await expectPresence(id, `V${apiVersion}: foreground report missing`);
    const originalWindow = await worker.evaluate(() => chrome.windows.getLastFocused());

    for (const [label, popupWorker] of [['own', worker], ['other extension', otherWorker]]) {
      await popupWorker.evaluate(windowId => chrome.action.openPopup({ windowId }), originalWindow.id);
      await until(() => popupWorker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['POPUP'] })),
        contexts => contexts.length > 0, `${label} popup did not open`);
      const pageFocused = await page.evaluate(() => document.hasFocus());
      await expectPresence(id, `V${apiVersion}: ${label} popup suppressed presence`);
      console.log(`V${apiVersion}: ${label} popup open, webpage focus=${pageFocused}, presence retained.`);
      await worker.evaluate(windowId => chrome.windows.update(windowId, { focused: true }), originalWindow.id);
      await page.bringToFront();
    }

    const otherTab = await context.newPage();
    await expectPresence(null, `V${apiVersion}: another tab retained presence`);
    await page.bringToFront();
    await expectPresence(id, `V${apiVersion}: tab return did not restore presence`);
    await otherTab.close();

    const secondWindow = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
    await expectPresence(null, `V${apiVersion}: another browser window retained presence`);
    await worker.evaluate(windowId => chrome.windows.remove(windowId), secondWindow.id);
    await worker.evaluate(windowId => chrome.windows.update(windowId, { focused: true }), originalWindow.id);
    await page.bringToFront();
    await expectPresence(id, `V${apiVersion}: window return did not restore presence`);
    await worker.evaluate(windowId => chrome.windows.update(windowId, { state: 'minimized' }), originalWindow.id);
    await expectPresence(null, `V${apiVersion}: minimized browser retained presence`);
    await worker.evaluate(windowId => chrome.windows.update(windowId, { state: 'normal', focused: true }), originalWindow.id);
    await expectPresence(id, `V${apiVersion}: restored browser did not restore presence`);

    await page.evaluate(() => history.pushState({}, '', location.pathname + '-clear'));
    await expectPresence(null, `V${apiVersion}: explicit clear was ignored`);
    await controls.bringToFront();
    await page.bringToFront();
    assert.equal((await state()).finalPresenceIntent, null, 'Returning must not revive an explicit clear');
    await page.goto(fixture);
    await expectPresence(id, `V${apiVersion}: replacement document did not report`);
    await page.close();
    await expectPresence(null, `V${apiVersion}: closed tab retained presence`);
    await send({ type: 'ACTIVITY_REMOVE', id });
    console.log(`V${apiVersion}: own/other popup, tab/window switch, minimize/restore, explicit clear and tab close passed.`);
  }
  console.log(`Foreground browser smoke passed (${await context.browser().version()}).`);
} finally {
  await context?.close();
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith('chudpresence-foreground-browser-'));
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
