// Optional integration verification. Uses an isolated headless browser, real
// DOM/layout, synthetic clocks and mocked extension APIs; no user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { activityV2Digest } from '../extension/core/activity-api-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const moduleRoot = process.env.CHUDPRESENCE_TEST_NODE_MODULES;
const require = moduleRoot ? createRequire(path.join(moduleRoot, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const feed = JSON.parse(await fs.readFile(path.join(root, 'examples/v2/generic-feed/activity.json'), 'utf8'));
const metadata = JSON.parse(await fs.readFile(path.join(root, 'examples/v2/generic-feed/metadata.json'), 'utf8'));
const serviceSource = await fs.readFile(path.join(root, 'examples/v2/services/tmdb-movie.json'), 'utf8');
const markup = `<!doctype html><style>
  body {margin:0; font:16px sans-serif} [data-player] {position:absolute; width:660px}
  #current {left:0;top:0} #neighbor {left:720px;top:0;width:230px}
  #current video {width:640px;height:360px} #neighbor video {width:210px;height:160px}
  canvas {width:640px;height:360px} .overlay {position:relative} .overlay video,.overlay canvas {position:absolute;left:0;top:0}
  .overlay {height:360px}
  </style><article data-player="active" id="neighbor"><h1 data-media="title">Adjacent video</h1>
  <span data-media="creator" title="Creator: Neighbor">Neighbor</span><video></video></article>
  <article data-player="active" id="current"><h1 data-media="title">Selected video</h1>
  <span data-media="creator" title="Creator: Selected Creator">Selected Creator</span><video></video>
  <form><input value="PRIVATE DRAFT"><textarea>PRIVATE COMMENT</textarea></form></article>`;

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (pathname === '/fixture.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(markup); return;
  }
  const filename = path.resolve(extension, '.' + pathname);
  if (!filename.startsWith(extension + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(filename);
    const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.html') ? 'text/html' :
      filename.endsWith('.css') ? 'text/css' : filename.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHUDPRESENCE_TEST_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await page.route('https://**', route => route.abort());
  await page.goto(base + '/fixture.html');
  await page.evaluate(async ({ config, baseUrl }) => {
    const { collectGenericActivityV2 } = await import(baseUrl + '/core/activity-v2-generic.js');
    const { validateActivityV2 } = await import(baseUrl + '/core/activity-api-v2.js');
    validateActivityV2(JSON.stringify(config));
    const serialized = new Function(`return (${collectGenericActivityV2.toString()})`)();
    const environment = { location: { href: 'https://example.com/watch/1' }, innerWidth, innerHeight,
      getComputedStyle: window.getComputedStyle.bind(window) };
    const state = {};
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const prepare = video => Object.defineProperties(video, {
      readyState: { configurable: true, value: 4 }, ended: { configurable: true, value: false },
      paused: { configurable: true, value: false }, currentTime: { configurable: true, value: 12 },
      duration: { configurable: true, value: 60 }, playbackRate: { configurable: true, value: 1 },
      currentSrc: { configurable: true, value: 'https://media.example/' + video.parentElement.id + '.mp4' },
    });
    for (const video of document.querySelectorAll('video')) prepare(video);
    const current = document.querySelector('#current'); const video = current.querySelector('video');
    const title = current.querySelector('[data-media="title"]');
    const creator = current.querySelector('[data-media="creator"]');
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    const collect = () => serialized(config, document, environment, state);
    check(collect()?.media.title === 'Selected video' && collect().media.creator === 'Selected Creator' &&
      collect().playback.state === 'paused', 'Generic largest visible paused card mixed adjacent metadata');
    for (const css of ['display:none', 'opacity:0', 'visibility:hidden', 'content-visibility:hidden']) {
      const hidden = document.createElement('span'); hidden.textContent = 'PRIVATE HIDDEN VALUE'; hidden.style.cssText = css;
      title.append(hidden); check(collect() === null, 'Generic field read hidden descendants'); hidden.remove();
      check(collect()?.media.title === 'Selected video', 'Generic rejected-field recovery failed');
    }
    const privateInput = document.createElement('input'); title.append(privateInput);
    check(collect() === null, 'Generic title read sensitive descendants'); privateInput.remove(); collect();
    title.remove(); creator.remove();
    check(collect()?.media.title === 'Selected video' && collect().media.creator === 'Selected Creator', 'Generic missing controls lost retained metadata');
    environment.location.href = 'https://example.com/watch/2';
    check(collect()?.media.title === 'Watching video' && collect().media.creator === undefined, 'Generic retention crossed navigation identity');
    current.prepend(title, creator); collect();
    title.style.opacity = '0'; check(collect() === null, 'Generic retention rescued present hidden metadata'); title.style.opacity = ''; collect();
    title.remove(); Object.defineProperty(video, 'currentSrc', { configurable: true, value: 'https://media.example/replacement.mp4' });
    check(collect()?.media.title === 'Watching video', 'Generic retention crossed source identity'); current.prepend(title);
    // Selector-only package update follows an changed public site marker.
    title.removeAttribute('data-media'); title.className = 'updated-caption'; delete state.generic;
    check(collect()?.media.title === 'Selected video', 'Existing explicit h1 selector fallback failed');
    config.fields.title.selectors = ['.updated-caption']; validateActivityV2(JSON.stringify(config));
    document.querySelector('#neighbor h1').className = 'updated-caption';
    check(collect()?.media.title === 'Selected video', 'Package-only selector update failed');
    // A native clock hidden only for accessibility/renderer purposes remains
    // eligible only with each separately approved, narrow exception.
    video.setAttribute('aria-hidden', 'true'); delete state.generic;
    check(collect()?.media.title === 'Adjacent video', 'Unapproved aria-hidden player survived');
    config.player.allowAriaHidden = true;
    check(collect()?.media.title === 'Selected video', 'Own accessibility exception failed');
    current.setAttribute('aria-hidden', 'true'); check(collect()?.media.title === 'Adjacent video', 'Own accessibility exception bypassed ancestor'); current.removeAttribute('aria-hidden');
    const overlay = document.createElement('div'); overlay.className = 'overlay'; video.replaceWith(overlay); overlay.append(video);
    const canvas = document.createElement('canvas'); canvas.className = 'renderer'; canvas.width = 640; canvas.height = 360; overlay.append(canvas);
    video.style.opacity = '0'; config.player.canvasSelector = '.renderer';
    check(collect()?.media.title === 'Selected video', 'Visible canvas rendering bridge failed');
    canvas.style.visibility = 'hidden'; check(collect()?.media.title === 'Adjacent video', 'Hidden canvas rendering bridge survived'); canvas.style.visibility = '';
    overlay.style.opacity = '0'; check(collect()?.media.title === 'Adjacent video', 'Canvas exception bypassed player ancestor opacity'); overlay.style.opacity = '';
    canvas.remove(); check(collect()?.media.title === 'Adjacent video', 'Absent canvas rendering bridge survived');
    // Public DOM custom players expose only their visible label and clock text.
    document.querySelector('#neighbor').remove(); overlay.append(canvas); video.remove(); current.append(title);
    const control = document.createElement('button'); control.className = 'state-control'; control.setAttribute('aria-label', 'Pause'); control.textContent = 'Pause';
    const position = document.createElement('span'); position.className = 'position'; position.textContent = '1:02:03.5';
    const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = '5000'; current.append(control, position, duration);
    config.player = { adapter: 'dom-media', selectors: ['canvas'], selection: 'largest-visible',
      state: { selectors: ['.state-control'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] },
      position: { source: 'dom.text', selectors: ['.position'], parse: 'clock' },
      duration: { source: 'dom.text', selectors: ['.duration'], parse: 'number' } };
    validateActivityV2(JSON.stringify(config)); delete state.generic;
    check(collect()?.playback.position === 3723.5 && collect().playback.duration === 5000, 'Generic custom-player timeline failed');
    control.setAttribute('aria-label', 'Play'); check(collect()?.playback.state === 'paused', 'Generic custom-player pause failed');
    position.style.display = 'none'; check(collect()?.playback.position === 0, 'Generic custom timeline read hidden text'); position.style.display = '';
    control.setAttribute('aria-label', 'PRIVATE UNKNOWN STATE'); check(collect() === null, 'Generic custom-player accepted undeclared state');
  }, { config: structuredClone(feed), baseUrl: base });
  console.log('Generic V2 real-DOM collector passed: same-card ranking, hidden/sensitive exclusion, retention identity, package-only selectors, native canvas/accessibility guards and custom DOM timeline.');

  // Install through the actual manager to obtain the actual serialized runtime.
  const data = {}, scripts = new Map();
  const api = { runtime: { getManifest: () => ({ version: '2.1.0' }) }, storage: { local: {
    async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, structuredClone(value)); },
  } }, permissions: { async contains() { return true; } }, userScripts: {
    async getScripts() { return [...scripts.values()]; }, async configureWorld() {},
    async execute() { return []; },
    async register(values) { for (const value of values) scripts.set(value.id, value); },
    async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
  } };
  const manager = new ActivityManager({ api });
  const pkg = { metadata: { ...metadata, matches: ['https://fixture.example/watch/*'] }, source: JSON.stringify(feed), sourceType: 'local' };
  pkg.approval = { digest: await activityV2Digest(pkg) }; await manager.install(pkg);
  const registered = [...scripts.values()][0];
  assert.equal(registered.world, 'USER_SCRIPT');
  assert.equal(registered.worldId, 'chudpresence.activity.' + metadata.id);
  const runtimePage = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await runtimePage.route('https://**', route => route.abort());
  await runtimePage.route('https://fixture.example/watch/1', route => route.fulfill({ contentType: 'text/html', body: markup }));
  await runtimePage.addInitScript(() => {
    window.__reports = [];
    window.chrome = { runtime: {
      async sendMessage(message) { window.__reports.push(message); return { ok: true }; },
      connect() { return { onMessage: { addListener(listener) { window.__abort = listener; } },
        onDisconnect: { addListener() {} }, disconnect() {} }; },
    } };
  });
  await runtimePage.goto('https://fixture.example/watch/1');
  await runtimePage.evaluate(() => {
    for (const video of document.querySelectorAll('video')) Object.defineProperties(video, {
      readyState: { configurable: true, value: 4 }, ended: { configurable: true, value: false }, paused: { configurable: true, value: false },
      currentTime: { configurable: true, value: 12 }, duration: { configurable: true, value: 60 }, playbackRate: { value: 1 },
      currentSrc: { configurable: true, value: 'https://media.example/active.mp4' },
    });
  });
  await runtimePage.addScriptTag({ content: registered.js[0].code });
  await runtimePage.waitForFunction(() => window.__reports.some(value => value.operation === 'presence.report'));
  const firstSnapshot = await runtimePage.evaluate(() => globalThis.__chudpresenceActivityV2Snapshot());
  assert.equal(firstSnapshot.activityId, metadata.id);
  assert.equal(firstSnapshot.capability, manager.records[metadata.id].capability);
  assert.equal(firstSnapshot.href, 'https://fixture.example/watch/1');
  assert.equal(firstSnapshot.report.media.title, 'Selected video');
  await runtimePage.evaluate(() => {
    document.querySelector('#current [data-media="title"]').textContent = 'Fresh replacement title';
  });
  assert.equal((await runtimePage.evaluate(() => globalThis.__chudpresenceActivityV2Snapshot())).report.media.title, 'Fresh replacement title');
  await runtimePage.evaluate(() => {
    document.querySelector('#neighbor').remove();
    Object.defineProperty(document.querySelector('#current video'), 'ended', { configurable: true, value: true });
    document.querySelector('#current video').dispatchEvent(new Event('ended'));
  });
  await runtimePage.waitForFunction(() => window.__reports.some(value => value.operation === 'presence.clear'));
  assert.equal((await runtimePage.evaluate(() => globalThis.__chudpresenceActivityV2Snapshot())).report, null);
  await runtimePage.evaluate(({ activityId, activityVersion }) => window.__abort({ type: 'CHUDPRESENCE_ACTIVITY_ABORT', activityId, activityVersion }),
    { activityId: metadata.id, activityVersion: metadata.version });
  assert.equal(await runtimePage.evaluate(() => globalThis.__chudpresenceActivityV2Snapshot === undefined), true);
  await runtimePage.close();
  console.log('Generic V2 serialized registered runtime passed: intended USER_SCRIPT world, fresh scoped snapshots, ended/reset clear and abort cleanup. Actual Chromium world isolation remains a browser platform property, not simulated by this fixture.');

  const library = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await library.route('https://**', route => route.abort());
  const errors = [];
  library.on('pageerror', error => errors.push(error.message));
  await library.addInitScript(() => {
    window.__approvals = []; window.__permissionRequests = []; window.__services = [];
    window.__holdPermission = false; window.__permissionResolved = 0;
    window.chrome = { runtime: {
      getManifest: () => ({ version: '2.1.0' }),
      async sendMessage(message) {
        if (message.type === 'ACTIVITY_LIBRARY_STATE') return { ok: true, result: { installed: [], userScriptsPermission: true, lookupServices: window.__services } };
        if (message.type === 'ACTIVITY_V2_SERVICE_APPROVE') {
          const { validateV2ServicePolicy, v2ServiceDigest } = await import('/core/activity-v2-services.js');
          const policy = validateV2ServicePolicy(message.policy);
          if (await v2ServiceDigest(policy) !== message.digest) throw new Error('Policy approval digest mismatch');
          window.__approvals.push(message);
          window.__services = [{ ...policy, digest: message.digest, authenticated: Boolean(message.token), approvedAt: Date.now() }];
          return { ok: true, result: window.__services[0] };
        }
        if (message.type === 'ACTIVITY_V2_SERVICE_REMOVE') {
          window.__services = window.__services.filter(value => value.id !== message.id);
          return { ok: true, result: { removed: true } };
        }
        return { ok: true, result: {} };
      },
    }, storage: { local: { async get(key) { return key === 'developerMode' ? { developerMode: true } : {}; }, async set() {} } },
    userScripts: { execute() {} }, permissions: {
      async request({ origins }) {
        window.__permissionRequests.push({ origins, userGesture: navigator.userActivation.isActive });
        if (window.__holdPermission) {
          window.__holdPermission = false;
          return await new Promise(resolve => { window.__releasePermission = value => { window.__permissionResolved++; resolve(value); }; });
        }
        return true;
      },
    } };
  });
  await library.goto(base + '/activities.html?view=developer');
  const upload = async (source, name = 'tmdb-movie.json') => {
    await library.locator('#lookup-service-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(source) });
    await library.locator('#lookup-service-review:not([disabled])').waitFor();
    await library.locator('#lookup-service-review').click();
    await library.locator('#lookup-service-dialog[open]').waitFor();
  };
  await upload(serviceSource);
  assert.match(await library.locator('#lookup-service-summary').innerText(), /api\.themoviedb\.org\/3\/search\/movie/);
  assert.match(await library.locator('#lookup-service-summary').innerText(), /image\.tmdb\.org\/t\/p\/w500/);
  assert.equal(await library.evaluate(() => window.__permissionRequests.length), 0);
  await library.locator('#lookup-service-cancel').click();
  assert.equal(await library.evaluate(() => window.__approvals.length), 0);
  await upload(serviceSource);
  await library.locator('#lookup-service-token').fill('old-review-secret');
  await fs.mkdir(path.join(root, 'browser-profiles'), { recursive: true });
  await library.screenshot({ path: path.join(root, 'browser-profiles/v2-service-review-desktop.png') });
  await library.evaluate(() => { window.__holdPermission = true; });
  await library.locator('#lookup-service-approve').click();
  await library.waitForFunction(() => Boolean(window.__releasePermission));
  await library.locator('#lookup-service-cancel').click();
  const nextPolicy = JSON.parse(serviceSource);
  nextPolicy.id = 'tmdb-tv'; nextPolicy.name = 'TMDB television artwork'; nextPolicy.endpoint = 'https://api.themoviedb.org/3/search/tv';
  await upload(JSON.stringify(nextPolicy), 'tmdb-tv.json');
  await library.locator('#lookup-service-token').fill('new-review-secret');
  await library.setViewportSize({ width: 390, height: 844 });
  assert.equal(await library.locator('#lookup-service-dialog').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), true, 'Service approval dialog does not fit mobile viewport');
  await library.screenshot({ path: path.join(root, 'browser-profiles/v2-service-review-mobile.png') });
  await library.evaluate(() => window.__releasePermission(true));
  await library.waitForFunction(() => window.__permissionResolved === 1);
  assert.equal(await library.evaluate(() => window.__approvals.length), 0, 'Canceled old permission callback approved a different review');
  assert.equal(await library.locator('#lookup-service-dialog').evaluate(element => element.open), true);
  await library.locator('#lookup-service-approve').click();
  await library.waitForFunction(() => window.__approvals.length === 1);
  await library.locator('#lookup-service-dialog').waitFor({ state: 'hidden' });
  const approvals = await library.evaluate(() => window.__approvals);
  assert.equal(approvals[0].policy.id, 'tmdb-tv');
  assert.equal(approvals[0].policy.endpoint, 'https://api.themoviedb.org/3/search/tv');
  assert.equal(approvals[0].token, 'new-review-secret');
  const permissions = await library.evaluate(() => window.__permissionRequests);
  assert.deepEqual(permissions.map(value => value.userGesture), [true, true]);
  for (const value of permissions) assert.deepEqual(value.origins, ['https://api.themoviedb.org/*', 'https://image.tmdb.org/*']);
  await library.locator('#lookup-services-list').getByText('TMDB television artwork', { exact: false }).waitFor();
  assert.equal((await library.locator('body').innerText()).includes('new-review-secret'), false);
  assert.equal((await library.evaluate(() => JSON.stringify(window.__services))).includes('new-review-secret'), false);
  assert.equal(await library.locator('#lookup-service-token').inputValue(), '');
  await library.getByRole('button', { name: 'Revoke service', exact: true }).click();
  await library.waitForFunction(() => window.__services.length === 0);
  await library.locator('#lookup-services-list').getByText('No lookup services approved.', { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Generic V2 Library service smoke passed: independent exact-policy review, cancellation, pending-review replacement, direct-gesture endpoint/image grants, private token display, mobile dialog and revocation.');
  await library.close(); await page.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
