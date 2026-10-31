// Real Chromium extension + loopback HTTP contract smoke, with no Discord login.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.CHUDPRESENCE_TEST_NODE_MODULES
  ? path.join(path.resolve(process.env.CHUDPRESENCE_TEST_NODE_MODULES), 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-link-browser-'));
const artifacts = process.env.CHUDPRESENCE_UI_ARTIFACTS || scratch;
await fs.mkdir(artifacts, { recursive: true });
const requests = [];
const errors = [];
async function until(read, predicate, message) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
let enabled = false;
let display = 'creator';
let version = 1;
let syncVersion = 0;
let revision = 1;
const modern = !process.argv.includes('--legacy');
const allFields = ['display', 'enabled', 'showWhilePaused', 'artwork', 'playbackProgress', 'actionButtons'];
let syncFields = ['display'];
let inventory = [];
const sharedValues = { enabled: true, showWhilePaused: true, artwork: true, playbackProgress: true, actionButtons: true };
let fixtureSync = false;
let fixtureVersion = 1;
const fixtureValues = { display: 'app', ...sharedValues };
const streams = new Set();
function notify() {
  for (const stream of streams) stream.write(`event: revision\ndata: ${JSON.stringify({ serverId: 'browser-test-server', revision })}\n\n`);
}
function editFixture(patch) { Object.assign(fixtureValues, patch); fixtureVersion++; revision++; notify(); }
let active = null;
let publishAt = 0;
let discordConnected = true;
let revoked = false;
let extensionId;
let context;
let browserOptions;
let profilePath;
const lease = { leaseId: 'browser-test-lease', expiresAt: '2026-10-26T12:00:30Z', heartbeatSeconds: 10, fallbackGraceSeconds: 5 };
const services = () => ({ revision, services: [{ id: 'youtube', name: 'YouTube', shared: true,
  syncEnabled: enabled, syncVersion, displayChoices: ['app', 'creator', 'title'],
  ...(modern ? { syncRequested: enabled, supportedFields: allFields, syncFields } : {}), participants: [
    { deviceId: 'browser', kind: 'browser', name: 'Test browser', display: 'app', ...(modern ? inventory.find(item => item.id === 'youtube') : {}) },
    { deviceId: 'phone', kind: 'mobile', name: 'My phone', display: 'creator', ...(modern ? sharedValues : {}) },
  ] }, ...(modern && inventory.some(item => item.id === 'link-fixture') ? [{ id: 'link-fixture', name: 'Link fixture', shared: true,
    syncEnabled: fixtureSync, syncRequested: fixtureSync, syncVersion: 1, supportedFields: allFields, syncFields: allFields,
    displayChoices: ['app', 'creator', 'title'], participants: [
      { deviceId: 'browser', kind: 'browser', name: 'Test browser', ...inventory.find(item => item.id === 'link-fixture') },
      { deviceId: 'phone', kind: 'mobile', name: 'My phone', ...fixtureValues },
    ] }] : [])] });
const settings = () => ({ revision, services: {
  ...(enabled ? { youtube: { ...(modern ? Object.fromEntries(syncFields.map(field => [field, field === 'display' ? display : sharedValues[field]])) : { display }), version } } : {}),
  ...(fixtureSync ? { 'link-fixture': { ...fixtureValues, version: fixtureVersion } } : {}),
} });
const server = http.createServer(async (request, reply) => {
  try {
    const origin = request.headers.origin;
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Private-Network': 'true' };
    if (request.method === 'OPTIONS') { reply.writeHead(204, headers); reply.end(); return; }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    const entry = { path: request.url, method: request.method, body, origin };
    requests.push(entry);
    const send = (result, status = 200) => { reply.writeHead(status, headers); reply.end(result === null ? undefined : JSON.stringify(result)); };
    if (request.url === '/v1/info') return send({ protocolVersion: 1, serverId: 'browser-test-server',
      capabilities: ['service-discovery', 'service-sync-opt-in', 'service-display-sync', 'desktop-presence-lease',
        ...(modern ? ['service-settings-sync', 'selective-settings-sync', 'settings-change-events'] : [])] });
    if (request.url === '/v1/pair') {
      assert.equal(origin, `chrome-extension://${extensionId}`);
      assert.equal(body.code, '01234567');
      assert.equal(body.kind, 'browser');
      return send({ protocolVersion: 1, serverId: 'browser-test-server', deviceId: 'browser', token: 'a'.repeat(64) });
    }
    assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(64)}`);
    if (origin !== `chrome-extension://${extensionId}`) return send({ error: 'unauthorized' }, 401);
    if (revoked) return send({ error: 'unauthorized' }, 401);
    if (request.url === '/v1/events') {
      assert.equal(request.headers.accept, 'text/event-stream');
      reply.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      reply.flushHeaders(); streams.add(reply); notify();
      reply.on('close', () => streams.delete(reply));
      return;
    }
    if (request.url === '/v1/services') {
      if (request.method === 'PUT') { inventory = body.services; revision++; notify(); }
      return send(services());
    }
    if (request.url === '/v1/services/youtube/sync') {
      assert.equal(body.baseVersion, syncVersion);
      enabled = body.enabled; syncVersion++; version++; revision++;
      if (body.fields) syncFields = [...body.fields];
      if (body.initialDisplay) display = body.initialDisplay;
      if (body.sourceDeviceId === 'browser') {
        const source = inventory.find(item => item.id === 'youtube');
        for (const field of syncFields) { if (field === 'display') display = source.display; else sharedValues[field] = source[field]; }
      }
      notify();
      return send(services());
    }
    if (request.url === '/v1/settings') {
      if (request.method === 'PATCH') {
        for (const [id, change] of Object.entries(body.changes)) {
          assert.equal(change.baseVersion, id === 'youtube' ? version : fixtureVersion);
          for (const [field, value] of Object.entries(change)) {
            if (field === 'baseVersion') continue;
            assert.ok((id === 'youtube' ? syncFields : allFields).includes(field));
            if (id === 'youtube') { if (field === 'display') display = value; else sharedValues[field] = value; }
            else fixtureValues[field] = value;
          }
          if (id === 'youtube') version++; else fixtureVersion++;
        }
        revision++; notify();
      }
      return send({ ...settings(), conflicts: [] });
    }
    if (request.url === '/v1/presence/lease') return discordConnected ? send(lease) : send({ error: 'discord_unavailable' }, 503);
    if (request.url === '/v1/presence') { active = body.intent; publishAt = Date.now() + 1000; return send(lease); }
    if (request.url === '/v1/status') return send({ discordConnected, published: Boolean(active) && Date.now() >= publishAt, deviceId: active ? 'browser' : null });
    if (request.url.startsWith('/v1/presence/lease/')) { active = null; return send(null, 204); }
    if (request.url === '/v1/device') { active = null; for (const stream of streams) stream.end(); return send(null, 204); }
    return send({ error: 'not_found' }, 404);
  } catch (error) {
    errors.push(error.message);
    reply.writeHead(500); reply.end('{}');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const candidates = process.env.CHUDPRESENCE_TEST_BROWSER ? [process.env.CHUDPRESENCE_TEST_BROWSER]
    : [chromium.executablePath(), ...(process.platform === 'win32' ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] : [])];
  for (const [index, executablePath] of candidates.entries()) {
    try {
      profilePath = path.join(scratch, 'profile-' + index);
      browserOptions = {
        executablePath, headless: !process.argv.includes('--headed'), viewport: { width: 420, height: 600 },
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`],
      };
      context = await chromium.launchPersistentContext(profilePath, browserOptions);
      break;
    } catch (error) { if (index === candidates.length - 1) throw error; }
  }
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let worker = context.serviceWorkers().find(worker => worker.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith('/background.js') });
  extensionId = new URL(worker.url()).host;
  const permissions = await context.newPage();
  await permissions.goto(`chrome://extensions/?id=${extensionId}`);
  await permissions.evaluate(async extensionId => {
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
  }, extensionId);
  let popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.equal(await popup.locator('.top-actions button').count(), 3);
  await popup.getByRole('button', { name: 'Device linking', exact: true }).click();
  await popup.locator('#link-pair-form').waitFor({ state: 'visible' });
  assert.equal(await popup.locator('#activity-view').isHidden(), true);
  assert.equal(await popup.locator('#settings-view').isHidden(), true);
  assert.equal(await popup.evaluate(() => document.body.scrollWidth), 420);
  assert.ok(await popup.locator('#link-pair').evaluate(button => button.getBoundingClientRect().bottom <= 600), 'Pair action should fit the initial popup');
  await popup.screenshot({ path: path.join(artifacts, 'link-pairing.png'), animations: 'disabled' });
  await popup.locator('#link-device-name').fill('My Chromium browser');
  await popup.locator('#link-code').fill('01234567');
  await popup.locator('.link-advanced summary').click();
  await popup.locator('#link-port').fill(String(server.address().port));
  await popup.getByRole('button', { name: 'Pair browser', exact: true }).click();
  await popup.waitForFunction(() => !document.getElementById('link-pair').disabled);
  assert.equal(await popup.locator('#link-badge').textContent(), 'Connected', 'Valid browser token must remain authorized on GET requests');
  assert.equal(await popup.evaluate(async () => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })), false,
    'Link must use CORS rather than a host-permission bypass that omits Origin on GET');
  await popup.getByRole('button', { name: 'Enable sync for YouTube', exact: true }).waitFor();
  assert.equal(enabled, false);
  assert.equal(await popup.locator('#link-badge').textContent(), 'Connected');
  await popup.waitForFunction(() => document.getElementById('link-transport').textContent === 'Waiting for activity');
  assert.equal(await popup.locator('#link-transport').textContent(), 'Waiting for activity');
  await context.close();
  context = await chromium.launchPersistentContext(profilePath, browserOptions);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: candidate => candidate.url().endsWith('/background.js') });
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html#link`);
  await popup.waitForFunction(() => document.getElementById('link-badge').textContent === 'Connected');
  assert.equal(requests.filter(request => request.path === '/v1/pair').length, 1, 'Saved pairing should survive browser restart without a new code');
  await popup.waitForFunction(() => document.getElementById('link-transport').textContent === 'Waiting for activity');
  assert.equal(await popup.locator('#link-transport').textContent(), 'Waiting for activity');
  const source = popup.getByRole('combobox', { name: 'Starting setting for YouTube' });
  await source.selectOption('device:phone');
  await popup.getByRole('button', { name: 'Enable sync for YouTube', exact: true }).click();
  await popup.getByRole('button', { name: 'Disable sync for YouTube', exact: true }).waitFor();
  assert.equal(requests.find(request => request.path.endsWith('/sync')).body.sourceDeviceId, 'phone');
  if (modern) {
    assert.deepEqual(requests.find(request => request.path.endsWith('/sync')).body.fields, allFields);
    assert.ok(requests.findIndex(request => request.path === '/v1/events') < requests.findIndex(request => request.path === '/v1/services'));
  }
  const preference = () => worker.evaluate(async () => (await chrome.storage.local.get('installedActivities')).installedActivities.youtube.preferences.statusDisplay);
  assert.equal(await preference(), 'artist');
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const statusChoice = popup.locator('[data-activity-id="youtube"][data-activity-preference="statusDisplay"]');
  await popup.locator('[data-activity-id="youtube"].service-settings-card > summary').click();
  await statusChoice.selectOption('track');
  await popup.getByRole('button', { name: 'Device linking', exact: true }).click();
  await popup.waitForFunction(() => document.getElementById('link-badge').textContent === 'Connected');
  await popup.locator('#link-refresh').click();
  await popup.waitForFunction(() => document.getElementById('link-feedback').textContent === 'Connection refreshed.');
  assert.equal(display, 'title');
  display = 'app'; version++; revision++; notify();
  if (modern) await until(preference, value => value === 'app', 'Live event did not apply the desktop display choice.');
  else {
    await popup.locator('#link-refresh').click();
    await popup.waitForFunction(() => document.getElementById('link-refresh').disabled === false);
  }
  assert.equal(await preference(), 'app');
  if (modern) {
    await popup.getByRole('combobox', { name: 'Settings to sync for YouTube', exact: true }).selectOption('selected');
    for (const field of ['discord bar display', 'service enabled', 'show while paused', 'playback progress']) {
      await popup.getByRole('checkbox', { name: `Sync ${field} for YouTube`, exact: true }).uncheck();
    }
    await popup.getByRole('combobox', { name: 'Starting setting for YouTube', exact: true }).selectOption('device:phone');
    await popup.getByRole('button', { name: 'Save sync settings for YouTube', exact: true }).click();
    await popup.waitForFunction(() => document.getElementById('link-feedback').textContent === 'Sync settings updated.');
    assert.deepEqual(requests.filter(request => request.path.endsWith('/sync')).at(-1).body.fields, ['artwork', 'actionButtons']);
    sharedValues.artwork = false; sharedValues.actionButtons = false; version++; revision++; notify();
    const localValues = () => worker.evaluate(async () => (await chrome.storage.local.get('installedActivities')).installedActivities.youtube);
    await until(localValues, value => !value.preferences.showArtwork && !value.preferences.showButtons, 'Boolean-only event did not apply.');
    assert.equal((await localValues()).preferences.statusDisplay, 'app');
    await popup.evaluate(async () => chrome.runtime.sendMessage({ type: 'ACTIVITY_SET_PREFERENCES', id: 'youtube',
      preferences: { showArtwork: true, showPaused: false } }));
    await until(async () => sharedValues.artwork, value => value, 'Local artwork edit did not reach Link.');
    const patch = requests.filter(request => request.method === 'PATCH').at(-1).body.changes.youtube;
    assert.equal(patch.artwork, true);
    assert.equal(Object.hasOwn(patch, 'showWhilePaused'), false);
    assert.equal(sharedValues.showWhilePaused, true);
    assert.equal((await localValues()).preferences.showPaused, false);
    await popup.screenshot({ path: path.join(artifacts, 'link-selected-settings.png'), animations: 'disabled' });
  }
  const fixture = 'https://www.youtube.com/chudpresence-link-fixture';
  await context.route(`${fixture}*`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Link fixture</title><h1>Test video</h1>' }));
  const install = await popup.evaluate(async fixture => chrome.runtime.sendMessage({ type: 'ACTIVITY_INSTALL', activityPackage: {
    metadata: { id: 'link-fixture', name: 'Link fixture', description: 'Local RPC browser smoke', version: '1.0.0',
      apiVersion: 1, minExtensionVersion: '2.0.5', entry: 'activity.js', matches: [`${fixture}*`] },
    source: `function tick() { ChudPresence.report({ kind: "video", media: { title: "Test video", creator: "Test creator" },
      playback: { state: document.documentElement.dataset.paused === "true" ? "paused" : "playing", position: 20, duration: 180 },
      artwork: { large: "https://example.com/cover.jpg", largeText: "Test artwork" },
      buttons: [{ label: "Watch video", url: "https://example.com/watch" }] }); }
      document.addEventListener("fixture-tick", tick);
      ChudPresence.lifecycle.onCleanup(() => document.removeEventListener("fixture-tick", tick));
      ChudPresence.lifecycle.interval(tick, 20000); tick();`,
  } }), fixture);
  assert.equal(install.ok, true, JSON.stringify(install));
  const media = await context.newPage();
  await media.goto(fixture);
  await popup.bringToFront();
  const delivery = await until(() => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).delivery),
    delivery => delivery.link.published === true, 'Local RPC did not publish the Activity report.');
  assert.equal(delivery.id, 'chudpresence-link', JSON.stringify({ delivery, requests: requests.slice(-16) }));
  assert.equal(delivery.link.published, true);
  assert.equal(JSON.stringify(delivery).includes('a'.repeat(64)), false);
  await popup.waitForFunction(() => document.getElementById('link-transport').textContent === 'Local Discord · publishing');
  if (modern) {
    // Simulate an explicit desktop opt-in, then desktop/phone preference edits.
    fixtureSync = true; fixtureVersion++; revision++; notify();
    const fixtureRecord = () => worker.evaluate(async () => (await chrome.storage.local.get('installedActivities')).installedActivities['link-fixture']);
    await until(() => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).delivery.link),
      value => value.services.some(service => service.id === 'link-fixture' && service.syncActive), 'Desktop opt-in was not discovered.');
    editFixture({ artwork: false, playbackProgress: false, actionButtons: false });
    await until(async () => active, value => value && !value.assets && value.timestamps?.start >= 0 && !value.timestamps.end && !value.buttons?.length,
      'Visibility settings did not rebuild the current desktop intent.');
    assert.equal((await fixtureRecord()).preferences.showArtwork, false);
    const appStartedAt = active.timestamps.start;
    editFixture({ artwork: true, actionButtons: true });
    await until(async () => active, value => value?.assets?.largeImage && value.timestamps?.start === appStartedAt && !value.timestamps.end && value.buttons?.length,
      'Changing synced artwork or buttons reset the continuous app timer.');
    await media.evaluate(() => { document.documentElement.dataset.paused = 'true'; document.dispatchEvent(new Event('fixture-tick')); });
    await until(async () => active, value => value?.state?.includes('Paused') && value.timestamps?.start === appStartedAt && !value.timestamps.end,
      'Pausing playback reset or hid the continuous app timer.');
    editFixture({ playbackProgress: true });
    await until(async () => active, value => value?.state?.includes('Paused') && !value.timestamps,
      'Synced playback progress did not restore the existing paused timer behavior.');
    editFixture({ showWhilePaused: false });
    await until(async () => active, value => value === null, 'Hiding paused playback did not clear the leased presence.');
    editFixture({ showWhilePaused: true });
    await until(async () => active, value => value?.state?.includes('Paused') && value.assets && value.buttons?.length && !value.timestamps,
      'Showing paused playback lost its media or retained timers.');
    editFixture({ enabled: false });
    await until(async () => active, value => value === null, 'Disabling the service did not clear presence.').catch(async error => {
      const record = await fixtureRecord();
      console.error(JSON.stringify({ active, enabled: record.enabled, preferences: record.preferences,
        delivery: (await popup.evaluate(async () => chrome.runtime.sendMessage({ type: 'GET_STATE' }))).delivery,
        recentRequests: requests.slice(-16) }));
      throw error;
    });
    await until(async () => inventory.find(item => item.id === 'link-fixture'), value => value?.enabled === false,
      'Disabled service disappeared from the sync inventory.');
    editFixture({ artwork: false });
    await until(fixtureRecord, value => value.enabled === false && !value.preferences.showArtwork, 'Disabled service stopped syncing.');
    editFixture({ enabled: true });
    await until(async () => active, value => value?.state?.includes('Paused') && !value.assets && !value.timestamps,
      'Reenabled service failed to retain its synced preferences.');
    await media.evaluate(() => { document.documentElement.dataset.paused = 'false'; document.dispatchEvent(new Event('fixture-tick')); });
    await until(async () => active, value => value?.timestamps?.end, 'Resuming playback did not rebuild progress timers.');
  }
  await popup.screenshot({ path: path.join(artifacts, 'link-connected.png'), animations: 'disabled' });
  discordConnected = false;
  await popup.locator('#link-refresh').click();
  await popup.waitForFunction(() => document.getElementById('link-refresh').disabled === false);
  const fallback = await until(() => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).delivery),
    delivery => delivery.link.transport === 'headless', 'Confirmed local release did not resume headless publishing.');
  assert.equal(fallback.link.transport, 'headless');
  assert.ok(requests.some(request => request.method === 'DELETE' && request.path.startsWith('/v1/presence/lease/')));
  // Settings sync is independent of Discord availability.
  assert.equal(await preference(), 'app');
  await popup.getByRole('button', { name: 'Disable sync for YouTube', exact: true }).click();
  await popup.getByRole('button', { name: 'Enable sync for YouTube', exact: true }).waitFor();
  assert.equal(enabled, false);
  revoked = true;
  await popup.locator('#link-refresh').click();
  await popup.locator('#link-pair-form').waitFor({ state: 'visible' });
  assert.equal(await popup.locator('#link-badge').textContent(), 'Pair again');
  await popup.locator('#link-unpair').click();
  await popup.waitForFunction(() => document.getElementById('link-badge').textContent === 'Unlinked');
  const privateState = await worker.evaluate(async () => (await chrome.storage.local.get('chudpresenceLink')).chudpresenceLink);
  assert.equal(privateState.pairing, null);
  assert.deepEqual(errors, []);
  console.log(`Link ${modern ? '0.4 selective settings + SSE' : 'legacy display-only'} browser smoke passed: saved pairing, explicit selection, both edit directions, RPC handoff, visibility, confirmed fallback, revocation and unlink.`);
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await context?.close();
  for (const stream of streams) stream.end();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
