// Disposable-browser test of per-site V1 setup and real HTML media playback.
// The Jellyfin HTTP responses and login below are synthetic; no real account
// or Discord connection is used. Host permission is preapproved in this profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = createRequire(process.env.CHUDPRESENCE_TEST_NODE_MODULES
  ? path.join(path.resolve(process.env.CHUDPRESENCE_TEST_NODE_MODULES), 'package.json') : import.meta.url)('playwright');
const directory = path.join(root, 'ChudPresence-Activities', 'activities', 'jellyfin');
const [metadata, source, png] = await Promise.all([
  fs.readFile(path.join(directory, 'metadata.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(directory, 'activity.js'), 'utf8'), fs.readFile(path.join(directory, 'icon.png')),
]);
// Reproduce an isolated Activity world that cannot read website storage. The
// page bridge must use the real page's storage, with no global ApiClient shim.
const fixtureSource = `const localStorage = { getItem() { throw new Error('Fixture: isolated storage unavailable'); } };\n${source}`;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-jellyfin-browser-'));
// Fixture-only server and declared network grants keep native permission
// prompts outside this smoke test and expose tab URLs to the popup test page.
const testExtension = path.join(scratch, 'extension');
await fs.cp(path.join(root, 'extension'), testExtension, { recursive: true });
const testManifest = JSON.parse(await fs.readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
testManifest.host_permissions.push('http://127.0.0.1/*', ...(metadata.network || []));
await fs.writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(testManifest));
const artifacts = process.env.CHUDPRESENCE_UI_ARTIFACTS || scratch;
await fs.mkdir(artifacts, { recursive: true });
const pcmBytes = 8000 * 2 * 120;
const wav = Buffer.alloc(44 + pcmBytes);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcmBytes, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmBytes, 40);
const apiRequests = [];
const linkOrigins = [];
let playingItem = 'item001';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/v1/info' || url.pathname === '/v1/pair') {
    linkOrigins.push(request.headers.origin);
    response.setHeader('Content-Type', 'application/json');
    request.resume();
    return response.end(JSON.stringify(url.pathname === '/v1/info'
      ? { protocolVersion: 1, serverId: 'fixture-link', capabilities: [] }
      : { protocolVersion: 1, serverId: 'fixture-link', deviceId: 'fixture-browser', token: 'a'.repeat(64) }));
  }
  if (url.pathname.endsWith('/System/Info/Public') || url.pathname.endsWith('/Sessions') || url.pathname.includes('/Users/')) {
    apiRequests.push(url.pathname);
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/System/Info/Public')) return response.end(JSON.stringify({ Id: 'server001', ProductName: 'Jellyfin Server' }));
    if (!request.headers.authorization?.includes('browser-fixture-secret')) { response.statusCode = 401; return response.end('{}'); }
    if (url.pathname.endsWith('/Sessions')) return response.end(JSON.stringify([
      { DeviceId: 'other-device', UserId: 'user001', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'wrong001' } },
      { DeviceId: 'browser-device', UserId: 'other-user', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'wrong002' } },
      { DeviceId: 'browser-device', UserId: 'user001', Client: 'Jellyfin Web', NowPlayingItem: { Id: playingItem } },
    ]));
    if (url.pathname.endsWith('/Items/song001')) return response.end(JSON.stringify({
      Id: 'song001', Name: 'Browser fixture song', Type: 'Audio', Artists: ['Fixture artist'], Album: 'Fixture album',
    }));
    return response.end(JSON.stringify({ Id: 'item001', Name: 'Browser fixture movie', Type: 'Movie', ProductionYear: 2026, Genres: ['Drama'] }));
  }
  if (url.pathname.includes('/Videos/') || url.pathname.includes('/Audio/')) {
    response.setHeader('Content-Type', 'audio/wav');
    response.setHeader('Content-Length', wav.length);
    return response.end(wav);
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Jellyfin fixture</title><h1>Jellyfin browser fixture</h1><main id="fixture-view"></main>
    <script>localStorage.setItem('jellyfin_credentials', JSON.stringify({Servers:[{Id:'server001',UserId:'user001',AccessToken:'browser-fixture-secret'}]}));
    localStorage.setItem('_deviceId2','browser-device');</script>
    <audio controls autoplay></audio><script>
    // Jellyfin 10.11 dispatches bubbling legacy page events on its view element.
    addEventListener('hashchange', () => {
      const view = document.getElementById('fixture-view');
      view.dispatchEvent(new CustomEvent('pagehide', { bubbles: true }));
      view.dispatchEvent(new CustomEvent('pageshow', { bubbles: true }));
    });
    fetch('/jellyfin/Videos/item001/stream').then(response => response.blob()).then(blob => {
      window.fixtureMediaUrl = URL.createObjectURL(blob);
      document.querySelector('audio').src = window.fixtureMediaUrl;
    });</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/jellyfin/`;
let context;
try {
  const failures = [];
  const candidates = process.env.CHUDPRESENCE_TEST_BROWSER ? [process.env.CHUDPRESENCE_TEST_BROWSER]
    : [playwright.chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  for (const [index, executablePath] of candidates.entries()) {
    try {
      context = await playwright.chromium.launchPersistentContext(path.join(scratch, 'profile-' + index), {
        executablePath, headless: !process.argv.includes('--headed'), viewport: { width: 1280, height: 900 },
        ignoreDefaultArgs: ['--disable-extensions'], args: ['--autoplay-policy=no-user-gesture-required',
          `--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
      });
      break;
    } catch (error) { failures.push(`${executablePath}: ${error.message.split('\n')[0]}`); }
  }
  if (!context) throw new Error('No extension-capable test browser found.\n' + failures.join('\n'));
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers().find(value => value.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: value => value.url().endsWith('/background.js') });
  const id = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${id}`);
  await settings.evaluate(async extensionId => {
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
  }, id);
  await settings.close();
  const controls = await context.newPage();
  await controls.goto(`chrome-extension://${id}/activities.html`);
  await controls.evaluate(async activityPackage => {
    const result = await chrome.runtime.sendMessage({ type: 'ACTIVITY_INSTALL', activityPackage });
    if (!result.ok) throw new Error(result.error);
  }, { metadata, source: fixtureSource, icon: `data:image/png;base64,${png.toString('base64')}` });
  const installedScripts = () => worker.evaluate(async () => (await chrome.userScripts.getScripts()).filter(script => script.id.includes('jellyfin')));
  assert.equal((await installedScripts()).length, 0, 'Installation alone must start no detector');
  const player = await context.newPage();
  await player.goto(base + 'web/#/video');
  await player.waitForFunction(() => document.querySelector('audio').src.startsWith('blob:'));
  await player.locator('audio').evaluate(element => element.play());
  assert.equal(apiRequests.length, 0, 'Unconfigured Jellyfin must make no server requests');
  // Keep the source tab selected while loading the popup as a background page.
  await player.bringToFront();
  const popupReady = context.waitForEvent('page');
  await worker.evaluate(() => chrome.tabs.create({ active: false, url: chrome.runtime.getURL('popup.html#settings') }));
  const popup = await popupReady;
  await popup.waitForLoadState();
  const card = popup.locator('.service-settings-card[data-activity-id="jellyfin"]');
  await card.locator('summary').click();
  await card.locator('.activity-site-current').waitFor();
  await card.locator('.activity-site-current').click();
  await card.locator('.activity-site-row').waitFor();
  await controls.waitForFunction(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return state.track?.media?.title === 'Browser fixture movie';
  }, null, { timeout: 15000 });
  const state = await controls.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
  assert.equal(state.track.activityId, 'jellyfin');
  assert.equal(state.track.playback.state, 'playing');
  assert.equal(JSON.stringify(state.track).includes('browser-fixture-secret'), false);
  assert.equal((await installedScripts()).length, 1);
  assert.ok(apiRequests.some(url => url.endsWith('/Sessions')), 'Blob playback must resolve the current client session');
  assert.equal(apiRequests.some(url => /wrong00/.test(url)), false, 'Other clients must not supply playback metadata');
  await controls.evaluate(async port => {
    const { createLinkClient, prepareLinkNetwork } = await import(chrome.runtime.getURL('link/client.js'));
    const client = createLinkClient({ origin: chrome.runtime.getURL('').replace(/\/$/, ''),
      storage: { get: async () => ({}), set: async () => {} }, prepareNetwork: () => prepareLinkNetwork(chrome),
      schedule: () => 0, cancel() {} });
    await client.pair({ code: '01234567', name: 'Browser fixture', port });
    await client.request('/v1/info');
  }, server.address().port);
  assert.ok(linkOrigins.length >= 3);
  assert.ok(linkOrigins.every(origin => origin === `chrome-extension://${id}`), 'Link identity must survive a Jellyfin loopback grant');
  await popup.screenshot({ path: path.join(artifacts, 'jellyfin-popup.png'), fullPage: true });
  await player.locator('audio').evaluate(element => { element.pause(); element.currentTime = 45; });
  await controls.waitForFunction(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return state.track?.playback?.state === 'paused' && state.track.playback.position >= 45;
  });
  await player.evaluate(() => {
    const audio = document.querySelector('audio');
    audio.removeAttribute('src'); audio.load(); location.hash = '#/home';
  });
  await player.bringToFront();
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.media?.title === 'Home');
  await player.evaluate(() => { location.hash = '#/music?topParentId=music-library'; });
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.media?.title === 'Music');
  playingItem = 'song001';
  await player.evaluate(async url => {
    const audio = document.querySelector('audio'); audio.src = url; await audio.play();
  }, base + 'Audio/song001/universal');
  await controls.waitForFunction(async () => {
    const track = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track;
    return track?.kind === 'song' && track.media.title === 'Browser fixture song' &&
      track.media.artist === 'Fixture artist' && track.media.album === 'Fixture album' &&
      track.display.state === 'Fixture artist' && track.playback.state === 'playing';
  });
  await player.evaluate(() => { location.hash = '#/home'; });
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.kind === 'song');
  await player.locator('audio').evaluate(element => { element.pause(); element.currentTime = 25; });
  await controls.waitForFunction(async () => {
    const track = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track;
    return track?.kind === 'song' && track.playback.state === 'paused' && track.playback.position >= 25;
  });
  await player.evaluate(() => { const audio = document.querySelector('audio'); audio.removeAttribute('src'); audio.load(); });
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.media?.title === 'Home');
  playingItem = 'item001';
  await player.evaluate(async () => {
    location.hash = '#/video';
    const audio = document.querySelector('audio'); audio.src = window.fixtureMediaUrl; await audio.play();
  });
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.media?.title === 'Browser fixture movie');
  await player.goto('about:blank');
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.activityId !== 'jellyfin');
  await player.goBack();
  await player.locator('audio').evaluate(element => element.play());
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.activityId === 'jellyfin');
  await controls.reload();
  await controls.locator('#tab-installed').click();
  await controls.locator('#installed-list [data-activity-id="jellyfin"] .activity-select').click();
  await controls.locator('.activity-site-row').waitFor();
  await controls.screenshot({ path: path.join(artifacts, 'jellyfin-library.png'), fullPage: true });
  await controls.locator('.activity-toggle-action').click();
  await controls.waitForFunction(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'ACTIVITY_LIBRARY_STATE' });
    return state.result.installed.find(activity => activity.id === 'jellyfin').enabled === false;
  });
  assert.equal((await installedScripts()).length, 0, 'Disabling must unregister the detector');
  const stoppedAt = apiRequests.length;
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(apiRequests.length, stoppedAt, 'Disabled Activity must stop its polling');
  await controls.locator('.activity-toggle-action').click();
  await controls.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).track?.activityId === 'jellyfin');
  await controls.locator('.activity-site-remove').click();
  await controls.waitForFunction(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'ACTIVITY_LIBRARY_STATE' });
    return state.result.installed.find(activity => activity.id === 'jellyfin').sites.length === 0;
  });
  assert.equal((await installedScripts()).length, 0, 'Removing the last server must unregister the detector');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', browser: await context.browser().version(),
    checks: ['no detector on install', 'popup per-site setup', 'HTTP reverse-proxy base path', 'real blob media playback',
      'page storage bridge without global ApiClient', 'current device and user session only', 'Jellyfin bubbling view lifecycle events',
      'music song playback/pause/seek', 'home browsing after music stops', 'video playback after music', 'native page exit and return',
      'Link Origin with loopback permission', 'pause and seek', 'disable stops requests', 'enable restores playback', 'remove server stops detection'], artifacts }, null, 2));
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
