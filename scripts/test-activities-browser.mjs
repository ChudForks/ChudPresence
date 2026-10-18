// Activity Library workflow and responsive smoke test, using a disposable
// Chromium extension profile and integrity-checked synthetic catalog packages.
// Run with a local Playwright install or CHUDPRESENCE_TEST_NODE_MODULES.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try {
  playwright = createRequire(process.env.CHUDPRESENCE_TEST_NODE_MODULES
    ? path.join(path.resolve(process.env.CHUDPRESENCE_TEST_NODE_MODULES), 'package.json') : import.meta.url)('playwright');
} catch {
  throw new Error('Install Playwright or set CHUDPRESENCE_TEST_NODE_MODULES to its node_modules directory.');
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'chudpresence-library-browser-'));
const artifacts = process.env.CHUDPRESENCE_UI_ARTIFACTS || scratch;
await fs.mkdir(artifacts, { recursive: true });
const revision = 'a'.repeat(40);
const repositories = ['ChudPresence-Activities', 'ChudPresence-Activities-V2'];
const sources = repositories.map(name => ({ repository: 'ChudForks/' + name, revision }));
const hash = text => createHash('sha256').update(text).digest('hex');
const packages = [
  { id: 'studio-player', name: 'Studio Player', category: 'streaming', apiVersion: 2,
    description: 'Share the film or episode playing in your browser.', pageAccess: { url: true, media: true, selectors: { title: { selector: 'h1', read: 'text' } } },
    settings: [{ id: 'label', label: 'Presence label', type: 'string', default: 'Watching' },
      { id: 'show-title', label: 'Show title', type: 'boolean', default: true }], aliases: ['Cinema'], tags: ['movies'] },
  { id: 'index-reader', name: 'Index Reader', category: 'utilities', apiVersion: 1,
    description: 'Show the public article you are reading.' },
  { id: 'long-name', name: 'An unusually long Activity name that must remain readable in every layout', category: 'utilities', apiVersion: 2,
    description: 'An unusually long description. '.repeat(14), pageAccess: { url: true }, minExtensionVersion: '99.0.0' },
].map(entry => {
  const metadata = { ...entry, version: '2.0.0', entry: 'activity.js', matches: ['https://www.youtube.com/*'] };
  const source = entry.apiVersion === 2 ? 'ChudPresence.onUpdate(() => ChudPresence.clear());' : 'ChudPresence.clear();';
  const metadataText = JSON.stringify(metadata);
  const catalogSource = sources[entry.apiVersion === 2 ? 1 : 0];
  return { metadata, source, metadataText, catalogEntry: { ...metadata, metadata: `activities/${entry.id}/metadata.json`,
    entry: `activities/${entry.id}/activity.js`, metadataSha256: hash(metadataText), sha256: hash(source), catalogSource } };
});
const catalog = { schemaVersion: 1, sources, activities: packages.map(item => item.catalogEntry) };
const errors = [];
const catalogRequests = [];
let failCatalog = false;
let context;
try {
  const candidates = process.env.CHUDPRESENCE_TEST_BROWSER ? [process.env.CHUDPRESENCE_TEST_BROWSER]
    : [playwright.chromium.executablePath(), ...(process.platform === 'win32'
      ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] : [])];
  const failures = [];
  for (const [index, executablePath] of candidates.entries()) {
    try {
      context = await playwright.chromium.launchPersistentContext(path.join(scratch, 'profile-' + index), {
        executablePath,
        headless: !process.argv.includes('--headed'), viewport: { width: 1440, height: 960 },
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`],
      });
      break;
    } catch (error) { failures.push(`${executablePath}: ${error.message.split('\n')[0]}`); }
  }
  if (!context) throw new Error('No test browser could launch. Set CHUDPRESENCE_TEST_BROWSER.\n' + failures.join('\n'));
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*' };
    if (url.hostname === 'api.github.com') return route.fulfill({ status: failCatalog ? 503 : 200, json: { sha: revision }, headers });
    if (url.hostname !== 'raw.githubusercontent.com') return route.abort();
    if (url.pathname.endsWith('/catalog.json')) {
      catalogRequests.push(url.pathname);
      const repo = url.pathname.split('/')[2];
      return route.fulfill({ json: { schemaVersion: 1, activities: catalog.activities.filter(entry => entry.catalogSource.repository.endsWith('/' + repo)) }, headers });
    }
    const item = packages.find(item => url.pathname.includes('/activities/' + item.metadata.id + '/'));
    if (!item) return route.abort();
    return route.fulfill({ contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript',
      body: url.pathname.endsWith('.json') ? item.metadataText : item.source, headers });
  });
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: worker => worker.url().endsWith('/background.js') });
  const extensionId = new URL(worker.url()).host;
  const preferences = await context.newPage();
  await preferences.goto(`chrome://extensions/?id=${extensionId}`);
  await preferences.evaluate(async extensionId => {
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true });
    for (const host of ['https://raw.githubusercontent.com/*', 'https://api.github.com/*']) {
      await chrome.developerPrivate.addHostPermission(extensionId, host);
    }
  }, extensionId);
  await preferences.close();
  await worker.evaluate(catalog => chrome.storage.local.set({ activityCatalogCache: catalog, activityCatalogFetchedAt: Date.now() }), catalog);
  const page = await context.newPage();
  const openActivity = async (id, view = 'discover') => {
    if (await page.locator('#activity-inspector').isVisible()) await page.locator('#inspector-close').click();
    await page.locator(`#${view}-list [data-activity-id="${id}"] .activity-select`).click();
    assert.equal(await page.locator('#catalog-region').isVisible(), false);
    assert.equal(await page.locator('#activity-inspector').isVisible(), true);
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/activities.html`);
  await page.locator('#discover-list .activity-row').first().waitFor();
  // Some Chromium versions configure site access via developerPrivate without
  // granting optional API access. Complete that first connection through its
  // real user gesture before exercising automatic refresh on later openings.
  let setupCatalogRequests = 0;
  const hasCatalogAccess = await page.evaluate(() => chrome.permissions.contains({
    origins: ['https://raw.githubusercontent.com/*', 'https://api.github.com/*'],
  }));
  if (!hasCatalogAccess) {
    await page.waitForFunction(() => !document.getElementById('refresh-catalog').disabled
      && document.getElementById('catalog-notice').textContent.includes('Use Refresh catalog'));
    assert.equal(catalogRequests.length, 0, 'Opening without permission must leave the request to a user gesture');
    await page.locator('#refresh-catalog').click();
    await page.locator('#catalog-notice.success').waitFor();
    await page.waitForFunction(() => !document.getElementById('refresh-catalog').disabled);
    setupCatalogRequests = catalogRequests.length;
    assert.equal(setupCatalogRequests, 2);
    await page.reload();
  }
  await page.waitForFunction(() => document.getElementById('catalog-age').textContent.startsWith('Updated'), null, { timeout: 5000 }).catch(async error => {
    console.error('Opening refresh diagnostics:', await page.evaluate(async () => ({
      notice: document.getElementById('catalog-notice').textContent,
      permissions: await chrome.permissions.getAll(),
    })));
    throw error;
  });
  await page.waitForFunction(() => !document.getElementById('refresh-catalog').disabled);
  const openingCatalogRequests = catalogRequests.length;
  assert.equal(openingCatalogRequests - setupCatalogRequests, 2, 'Opening the Library must refresh each repository once');
  assert.equal(await page.locator('#page-status, #status-dot, .header-status').count(), 0);
  assert.equal(await page.locator('#discover-list .activity-row').count(), 3);
  assert.equal(await page.locator('.inspector-name').innerText(), await page.locator('#discover-list .row-title').first().innerText());
  // Both catalog layouts and horizontal navigation must fit every breakpoint.
  for (const width of [1920, 1440, 1280, 1101, 1024, 768, 700, 520, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Collection overflow at ${width}px`);
    assert.equal(await page.locator('#library-tabs').getAttribute('aria-orientation'), 'horizontal');
    assert.equal(await page.locator('.workspace-mark').isVisible(), true, `Home navigation missing at ${width}px`);
    assert.equal(await page.locator('.activity-select button').count(), 0, 'Quick actions must not be nested inside the card button');
    assert.equal(await page.locator('#discover-list .activity-quick-action').count(), 3);
    await page.screenshot({ path: path.join(artifacts, `activity-collection-${width}.png`), animations: 'disabled' });
    await page.locator('#layout-list').click();
    assert.equal(await page.locator('#layout-list').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `List overflow at ${width}px`);
    const positions = await page.locator('#discover-list .activity-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().x));
    assert.equal(new Set(positions).size, 1, 'List entries must share a single column');
    if ([1440, 390].includes(width)) await page.screenshot({ path: path.join(artifacts, `activity-list-${width}.png`), animations: 'disabled' });
    await page.locator('#layout-grid').click();
    assert.equal(await page.locator('#layout-grid').getAttribute('aria-pressed'), 'true');
  }
  assert.equal(catalogRequests.length, openingCatalogRequests, 'Layout changes must not refresh the catalog');
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/activities.html`);
  await reopened.waitForFunction(() => document.getElementById('catalog-age').textContent.startsWith('Updated'));
  await reopened.waitForFunction(() => !document.getElementById('refresh-catalog').disabled);
  assert.equal(catalogRequests.length, openingCatalogRequests + 2, 'Opening another Library must fetch each repository again');
  await reopened.close();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#refresh-catalog').click();
  await page.locator('#catalog-notice.success').waitFor();
  assert.equal(catalogRequests.length, openingCatalogRequests + 4, 'Manual catalog refresh must remain available');
  await page.locator('#search').fill('Cinema');
  assert.equal(await page.locator('#discover-list .activity-row').count(), 1);
  await page.locator('#search').fill('no match');
  await page.locator('#discover-list .empty-state').waitFor();
  await page.locator('#search').fill('');
  await page.locator('#category-filter').selectOption('utilities');
  assert.equal(await page.locator('#discover-list .activity-row').count(), 2);
  await page.locator('#category-filter').selectOption('all');
  // Filtering has one focus indicator, and quick actions keep the collection open.
  await page.locator('#search').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#category-filter').evaluate(node => node === document.activeElement), true);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('category-filter')).borderTopColor === 'rgb(175, 164, 255)');
  const categoryFocus = await page.locator('#category-filter').evaluate(node => ({
    outline: getComputedStyle(node).outlineStyle, border: getComputedStyle(node).borderTopColor,
  }));
  assert.equal(categoryFocus.outline, 'none');
  assert.equal(categoryFocus.border, 'rgb(175, 164, 255)');
  await page.screenshot({ path: path.join(artifacts, 'activity-category-focus.png'), animations: 'disabled' });
  await page.locator('#category-filter').selectOption('streaming');
  await page.locator('#search').fill('Studio');
  const studioCard = page.locator('#discover-list [data-activity-id="studio-player"]');
  await studioCard.getByRole('button', { name: 'Add Studio Player', exact: true }).click();
  await studioCard.locator('.quick-remove').waitFor();
  assert.equal(await page.locator('#tab-discover').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#activity-inspector').isVisible(), false);
  assert.equal(await page.locator('#category-filter').inputValue(), 'streaming');
  assert.equal(await page.locator('#search').inputValue(), 'Studio');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('quick-remove')), true);
  await page.locator('#category-filter').selectOption('all');
  await page.locator('#search').fill('');
  await page.screenshot({ path: path.join(artifacts, 'activity-library-quick-actions.png'), animations: 'disabled' });
  await studioCard.getByRole('button', { name: 'Remove Studio Player', exact: true }).click();
  await studioCard.locator('.quick-add').waitFor();
  assert.equal(await page.locator('#activity-inspector').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('quick-add')), true);
  const rows = page.locator('#discover-list .activity-row');
  await rows.first().locator('.activity-select').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('#inspector-content .activity-detail').getAttribute('data-activity-id'),
    await rows.last().getAttribute('data-activity-id'));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#inspector-content .activity-detail').getAttribute('data-activity-id'),
    await rows.nth(1).getAttribute('data-activity-id'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#inspector-content .activity-detail').getAttribute('data-activity-id'),
    await rows.first().getAttribute('data-activity-id'));
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#inspector-content .activity-detail').getAttribute('data-activity-id'),
    await rows.nth(1).getAttribute('data-activity-id'));
  assert.equal(await page.locator('#discover-list .activity-select[aria-pressed="true"]').count(), 1);
  await openActivity('long-name');
  assert.equal(await page.locator('.activity-install-action').isDisabled(), true);
  assert.match(await page.locator('#inspector-content').innerText(), /Requires ChudPresence/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#catalog-region').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.activity-row').dataset.activityId), 'long-name');
  await openActivity('index-reader');
  assert.match(await page.locator('#inspector-content').innerText(), /Trusted Activity code/);
  assert.equal(await page.locator('.card-page-access').count(), 0);
  await openActivity('studio-player');
  await page.locator('.card-page-access summary').click();
  assert.match(await page.locator('.page-access-list').innerText(), /Media playback/);
  await page.locator('.activity-install-action').click();
  await page.waitForFunction(() => document.querySelector('#tab-installed').getAttribute('aria-selected') === 'true');
  assert.equal(await page.locator('.inspector-name').innerText(), 'Studio Player');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'inspector-name');
  const label = page.getByLabel('Presence label', { exact: true });
  await label.fill('Testing');
  await label.press('Tab');
  await page.waitForFunction(() => document.querySelector('.activity-settings input[type="text"]').disabled === false);
  const state = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ACTIVITY_LIBRARY_STATE' }));
  assert.equal(state.result.installed.find(entry => entry.id === 'studio-player').settingValues.label, 'Testing');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('.activity-settings')), true);
  await page.locator('.activity-toggle-action').click();
  await page.getByRole('button', { name: 'Enable', exact: true }).waitFor();
  await page.locator('.activity-toggle-action').click();
  await page.getByRole('button', { name: 'Disable', exact: true }).waitFor();
  await page.locator('#tab-developer').click();
  await page.locator('#developer-enabled').check();
  await page.locator('#developer-log-output').waitFor();
  await page.screenshot({ path: path.join(artifacts, 'activity-library-developer.png'), animations: 'disabled' });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Developer overflow at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `activity-developer-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#tab-installed').click();
  await openActivity('studio-player', 'installed');
  await page.locator('.activity-logs-action').click();
  assert.equal(await page.locator('#developer-log-activity').inputValue(), 'studio-player');
  const local = { id: 'local-reader', name: 'Local Reader', description: 'Local package smoke test', version: '1.0.0', apiVersion: 1,
    entry: 'activity.js', matches: ['https://www.youtube.com/*'] };
  await page.locator('#local-files').setInputFiles([
    { name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(local)) },
    { name: 'activity.js', mimeType: 'text/javascript', buffer: Buffer.from('ChudPresence.clear();') },
  ]);
  await page.locator('#load-local').click();
  await page.waitForFunction(() => document.querySelector('.inspector-name')?.textContent === 'Local Reader');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'inspector-name');
  await page.locator('.activity-remove-action').click();
  await page.waitForFunction(() => document.querySelector('.inspector-name')?.textContent === 'Studio Player');
  // Install an older repository package through the same integrity-checked path.
  const old = packages[0];
  const olderMetadata = { ...old.metadata, version: '1.0.0' };
  const olderText = JSON.stringify(olderMetadata);
  const update = await page.evaluate(async item => chrome.runtime.sendMessage({ type: 'ACTIVITY_INSTALL', activityPackage: {
    metadata: item.metadata, metadataSource: item.metadataText, source: item.source, sourceType: 'repository',
    provenance: { repository: item.repository, revision: item.revision, metadataSha256: item.metadataSha256, codeSha256: item.sha256 },
  } }), { metadata: olderMetadata, metadataText: olderText, source: old.source,
    repository: old.catalogEntry.catalogSource.repository, revision, metadataSha256: hash(olderText), sha256: hash(old.source) });
  assert.equal(update.ok, true, JSON.stringify(update));
  await page.reload();
  await page.locator('#tab-updates').click();
  await openActivity('studio-player', 'updates');
  await page.locator('.activity-install-action').click();
  await page.waitForFunction(() => document.querySelector('#tab-installed').getAttribute('aria-selected') === 'true');
  assert.match(await page.locator('#inspector-content').innerText(), /v2.0.0/);
  await page.screenshot({ path: path.join(artifacts, 'activity-library-desktop.png'), animations: 'disabled' });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#tab-discover').click();
    assert.equal(await page.locator('#activity-inspector').isVisible(), false);
    await openActivity('studio-player');
    assert.equal(await page.locator('#activity-inspector').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'inspector-name');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `activity-library-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.locator('#inspector-close').click();
    assert.equal(await page.locator('#activity-inspector').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'activity-select');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.activity-select').first().evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await page.locator('#tab-installed').click();
  await openActivity('studio-player', 'installed');
  await page.locator('.activity-remove-action').click();
  await page.locator('#installed-list [data-activity-id="studio-player"]').waitFor({ state: 'detached' });
  failCatalog = true;
  await page.locator('#tab-discover').click();
  await openActivity('index-reader');
  await page.locator('#refresh-catalog').click();
  await page.locator('#catalog-notice.error').waitFor();
  assert.match(await page.locator('#catalog-notice').innerText(), /cached catalog/);
  assert.equal(await page.locator('#activity-inspector').isVisible(), true);
  assert.equal(await page.locator('#catalog-notice').isVisible(), true);
  await page.locator('#inspector-close').click();
  assert.equal(await page.locator('#discover-list .activity-row').count(), 3);
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${extensionId}`);
  await settings.evaluate(extensionId => chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: false }), extensionId);
  await settings.close();
  await page.reload();
  await openActivity('studio-player');
  await page.locator('.activity-install-action').click();
  await page.locator('#user-scripts-dialog[open]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#close-user-scripts-dialog').click();
  assert.equal(await page.locator('#user-scripts-dialog').isVisible(), false);
  assert.equal(await page.locator('#library-feedback').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real Chromium extension one automatic catalog refresh per opening, manual refresh/cache errors, no header readiness text, search/filters, single category focus indicator, quick Add/Remove with focus and filter preservation, grid/list layouts, detail navigation and focus, V1/V2 disclosures, install/update/remove, settings, enable/disable, developer logs/local loading, User Scripts dialog, reduced motion, and 320–1920px layouts.');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await context?.close();
}
