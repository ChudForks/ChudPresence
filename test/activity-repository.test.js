import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_REPOSITORIES, activityCatalogIconUrl, compareActivityVersions,
  downloadActivity, fetchCatalog, readCatalogCache, validateCatalog,
} from '../extension/core/activity-repository.js';

const originalFetch = globalThis.fetch;

test('orders Activity updates by SemVer precedence rather than locale collation', () => {
  const versions = ['1.0.0-1', '1.0.0-Z', '1.0.0-a-b', '1.0.0-alpha', '1.0.0-alpha.2',
    '1.0.0-alpha.10', '1.0.0-beta', '1.0.0'];
  for (let index = 1; index < versions.length; index += 1) {
    assert.equal(compareActivityVersions(versions[index - 1], versions[index]), -1);
    assert.equal(compareActivityVersions(versions[index], versions[index - 1]), 1);
  }
  assert.equal(compareActivityVersions('1.0.0+new-build', '1.0.0+old-build'), 0);
  assert.equal(compareActivityVersions('1.0.0-alpha.9007199254740993', '1.0.0-alpha.9007199254740992'), 1);
});

async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createFixture({ id = 'youtube-music', apiVersion = 1 } = {}) {
  const metadata = JSON.stringify({
    id,
    name: 'YouTube Music',
    description: 'Show current music playback.',
    version: '1.0.0',
    apiVersion,
    matches: ['https://music.youtube.com/*'],
    entry: 'activity.js',
    icon: 'icon.png',
    ...(apiVersion === 2 ? { pageAccess: { selectors: { title: { selector: 'h1', read: 'text' } } } } : {}),
  });
  const source = 'ChudPresence.report({ kind: "song", media: { title: "Song" } });';
  const icon = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const files = new Map([
    ['metadata.json', metadata],
    ['activity.js', source],
    ['icon.png', icon],
  ]);
  return { metadata, source, icon, files };
}

async function entryFor(fixture, overrides = {}) {
  const metadata = JSON.parse(fixture.metadata);
  const metadataFields = ['author', 'contributors', 'category', 'aliases', 'tags', 'matches', 'excludeMatches',
    'serviceUrl', 'homepage', 'repository', 'presence', 'defaultMediaKind', 'frames', 'network', 'settings', 'settingsUi',
    'pageAccess', 'minExtensionVersion'];
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    apiVersion: metadata.apiVersion,
    ...Object.fromEntries(metadataFields.filter((field) => metadata[field] !== undefined).map((field) => [field, metadata[field]])),
    entry: `activities/${metadata.id}/activity.js`,
    metadata: `activities/${metadata.id}/metadata.json`,
    sha256: await sha256(fixture.source),
    metadataSha256: await sha256(fixture.metadata),
    icon: `activities/${metadata.id}/icon.png`,
    iconSha256: await sha256(fixture.icon),
    ...overrides,
  };
}

test('validates expanded catalog metadata and carries it into the verified package', async () => {
  const fixture = createFixture();
  const metadata = JSON.parse(fixture.metadata);
  metadata.aliases = ['YT Music', 'YTM'];
  metadata.tags = ['music', 'streaming'];
  metadata.defaultMediaKind = 'song';
  metadata.excludeMatches = ['https://music.youtube.com/shorts/*'];
  metadata.contributors = [{ name: 'Sample Author', url: 'https://example.com/author' }];
  metadata.serviceUrl = 'https://music.youtube.com/';
  metadata.settingsUi = { statusLabels: { app: 'YouTube Music', artist: 'Artist', track: 'Song title' } };
  fixture.metadata = JSON.stringify(metadata);
  fixture.files.set('metadata.json', fixture.metadata);
  stubRepositoryFetch(fixture);
  try {
    const entry = await entryFor(fixture);
    const catalog = validateCatalog({ schemaVersion: 1, revision: 'c'.repeat(40), activities: [entry] });
    assert.deepEqual(catalog.activities[0].aliases, metadata.aliases);
    const activityPackage = await downloadActivity('youtube-music', catalog);
    assert.deepEqual(activityPackage.metadata.tags, metadata.tags);
    assert.deepEqual(activityPackage.metadata.excludeMatches, metadata.excludeMatches);
    assert.equal(activityPackage.metadata.defaultMediaKind, 'song');
    assert.equal(activityPackage.metadata.serviceUrl, metadata.serviceUrl);
    assert.deepEqual(activityPackage.metadata.settingsUi, metadata.settingsUi);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compares nested catalog metadata by value regardless of object key order', async () => {
  const fixture = createFixture();
  const metadata = JSON.parse(fixture.metadata);
  metadata.settings = [{
    id: 'displayMode', type: 'select', label: 'Display mode', default: 'artist',
    options: [{ label: 'Artist', value: 'artist' }, { label: 'Album', value: 'album' }],
  }];
  fixture.metadata = JSON.stringify(metadata);
  fixture.files.set('metadata.json', fixture.metadata);
  stubRepositoryFetch(fixture);
  try {
    const entry = await entryFor(fixture, {
      settings: [{
        options: [{ value: 'artist', label: 'Artist' }, { value: 'album', label: 'Album' }],
        default: 'artist', label: 'Display mode', type: 'select', id: 'displayMode',
      }],
    });
    const activityPackage = await downloadActivity('youtube-music', {
      revision: 'c'.repeat(40), activities: [entry],
    });
    assert.deepEqual(activityPackage.metadata.settings, metadata.settings);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function stubRepositoryFetch(fixture) {
  globalThis.fetch = async (url) => {
    const file = new URL(url).pathname.split('/').at(-1);
    const body = fixture.files.get(file);
    return body === undefined
      ? new Response('', { status: 404 })
      : new Response(body, { status: 200 });
  };
}

test('downloads and verifies an Activity service icon with its package', async () => {
  const fixture = createFixture();
  stubRepositoryFetch(fixture);
  try {
    const activityPackage = await downloadActivity('youtube-music', {
      revision: 'a'.repeat(40),
      activities: [await entryFor(fixture)],
    });
    assert.equal(activityPackage.metadata.icon, 'icon.png');
    assert.equal(activityPackage.icon, `data:image/png;base64,${Buffer.from(fixture.icon).toString('base64')}`);
    assert.equal(activityPackage.source, fixture.source);
    assert.deepEqual(activityPackage.provenance, {
      repository: 'ChudForks/ChudPresence-Activities',
      revision: 'a'.repeat(40),
      codeSha256: await sha256(fixture.source),
      metadataSha256: await sha256(fixture.metadata),
      iconSha256: await sha256(fixture.icon),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a service icon that fails its catalog integrity hash', async () => {
  const fixture = createFixture();
  stubRepositoryFetch(fixture);
  try {
    await assert.rejects(downloadActivity('youtube-music', {
      revision: 'a'.repeat(40),
      activities: [await entryFor(fixture, { iconSha256: '0'.repeat(64) })],
    }), /Activity icon integrity check failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps future Activity API versions readable in mixed catalogs', async () => {
  const fixture = createFixture();
  const currentEntry = await entryFor(fixture);
  const futureEntry = await entryFor(fixture, {
    id: 'future-activity',
    apiVersion: 2,
    minExtensionVersion: '1.12.0',
    metadata: 'activities/future-activity/metadata.json',
    entry: 'activities/future-activity/activity.js',
    icon: 'activities/future-activity/icon.png',
  });
  const catalog = validateCatalog({ schemaVersion: 1, revision: 'b'.repeat(40), activities: [currentEntry, futureEntry] });
  assert.equal(catalog.activities.length, 2);
  assert.equal(catalog.activities[1].apiVersion, 2);
  assert.equal(catalog.activities[1].minExtensionVersion, '1.12.0');
});

test('rejects unsafe catalog network permissions before an install prompt', async () => {
  const fixture = createFixture();
  const base = await entryFor(fixture);
  for (const network of [
    ['https://discord.com/api/*'],
    ['https://api.example.com/*', 'https://api.example.com/*'],
    ['http://api.example.com/*'],
  ]) {
    assert.throws(() => validateCatalog({ schemaVersion: 1, activities: [{ ...base, network }] }),
      /invalid network permissions/);
  }
});

test('rejects invalid catalog status labels before downloading an Activity', async () => {
  const base = await entryFor(createFixture());
  for (const settingsUi of [
    { statusLabels: { unknown: 'Unknown' } },
    { statusLabels: { track: '   ' } },
    { statusLabels: { track: 42 } },
  ]) {
    assert.throws(() => validateCatalog({ schemaVersion: 1, activities: [{ ...base, settingsUi }] }),
      /invalid settings UI labels/);
  }
});

test('rejects catalog display or permission fields that disagree with verified metadata', async () => {
  const fixture = createFixture();
  stubRepositoryFetch(fixture);
  try {
    const base = await entryFor(fixture);
    for (const override of [
      { name: 'Misleading Activity' },
      { network: ['https://api.example.com/*'] },
      { settings: [{ id: 'enabled', type: 'boolean', label: 'Enabled', default: true }] },
      { settingsUi: { statusLabels: { track: 'Video title' } } },
    ]) {
      await assert.rejects(downloadActivity('youtube-music', {
        revision: 'a'.repeat(40),
        activities: [{ ...base, ...override }],
      }), (error) => error.code === 'catalog_metadata_mismatch' &&
        /Activity metadata does not match its catalog entry/.test(error.message));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refuses to install a catalog package requiring an unsupported API version', async () => {
  const fixture = createFixture();
  const metadata = JSON.parse(fixture.metadata);
  metadata.apiVersion = 999;
  fixture.metadata = JSON.stringify(metadata);
  fixture.files.set('metadata.json', fixture.metadata);
  stubRepositoryFetch(fixture);
  try {
    await assert.rejects(downloadActivity('youtube-music', {
      revision: 'a'.repeat(40),
      activities: [await entryFor(fixture, { apiVersion: 999 })],
    }), /Activity API version 999 is not supported/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('v2 catalog page declarations are checked before asking for website permissions', async () => {
  const fixture = createFixture();
  const entry = await entryFor(fixture, { apiVersion: 2, pageAccess: {
    selectors: { secret: { selector: 'input[value^="x"]', read: 'text' } },
  } });
  assert.throws(() => validateCatalog({ schemaVersion: 1, activities: [entry] }), /invalid page access declarations/);
});

async function catalogFixture(t, { cache = {} } = {}) {
  const originalChrome = globalThis.chrome;
  const originalBrowser = globalThis.browser;
  const storage = structuredClone(cache);
  globalThis.browser = undefined;
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(storage),
    set: async (value) => Object.assign(storage, structuredClone(value)),
  } } };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
    globalThis.browser = originalBrowser;
  });
  const fixtures = [createFixture(), createFixture({ id: 'google', apiVersion: 2 })];
  const catalogs = await Promise.all(fixtures.map(async (fixture) => ({ schemaVersion: 1, activities: [await entryFor(fixture)] })));
  const revisions = ['a'.repeat(40), 'b'.repeat(40)];
  const failures = new Set();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    requests.push(href);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    for (const [index, repository] of ACTIVITY_REPOSITORIES.entries()) {
      if (href === `${repository.apiBaseUrl}commits/main`) {
        return failures.has(index) ? new Response('', { status: 503 }) : Response.json({ sha: revisions[index] });
      }
      const base = `${repository.rawBaseUrl}${revisions[index]}/`;
      if (!href.startsWith(base)) continue;
      if (href === `${base}catalog.json`) return Response.json(catalogs[index]);
      const entry = catalogs[index].activities.find((entry) => href.startsWith(`${base}activities/${entry.id}/`));
      if (!entry) break;
      const file = new URL(url).pathname.split('/').at(-1);
      return new Response(fixtures[index].files.get(file));
    }
    throw new Error(`Unexpected repository request: ${href}`);
  };
  return { storage, fixtures, catalogs, revisions, failures, requests };
}

test('merges V1 and V2 catalogs, caches their sources, and downloads from each immutable revision', async (t) => {
  const fixture = await catalogFixture(t);
  const result = await fetchCatalog();
  assert.equal(result.fromCache, false);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.catalog.activities.map((entry) => entry.id), ['youtube-music', 'google']);
  assert.deepEqual(result.catalog.sources, [
    { repository: 'ChudForks/ChudPresence-Activities', revision: fixture.revisions[0] },
    { repository: 'ChudForks/ChudPresence-Activities-V2', revision: fixture.revisions[1] },
  ]);
  for (const [index, entry] of result.catalog.activities.entries()) {
    const activityPackage = await downloadActivity(entry.id, result.catalog);
    assert.equal(activityPackage.metadata.apiVersion, index + 1);
    assert.equal(activityPackage.provenance.repository, result.catalog.sources[index].repository);
    assert.equal(activityPackage.provenance.revision, fixture.revisions[index]);
    assert.equal(activityPackage.source, fixture.fixtures[index].source);
    assert.ok(activityPackage.icon.startsWith('data:image/png;base64,'));
    assert.equal(activityCatalogIconUrl(entry), `${ACTIVITY_REPOSITORIES[index].rawBaseUrl}${fixture.revisions[index]}/${entry.icon}`);
  }
  const requestCount = fixture.requests.length;
  assert.deepEqual((await readCatalogCache()).catalog, result.catalog);
  assert.equal((await fetchCatalog()).fromCache, true);
  assert.equal(fixture.requests.length, requestCount);
  assert.equal(fixture.requests.some((url) => url.includes('/main/catalog.json')), false);
});

test('upgrades the existing V1 cache when fetching both repositories', async (t) => {
  const legacyEntry = await entryFor(createFixture());
  const legacyCatalog = { schemaVersion: 1, revision: 'c'.repeat(40), activities: [legacyEntry] };
  const fixture = await catalogFixture(t, { cache: { activityCatalogCache: legacyCatalog, activityCatalogFetchedAt: 123 } });
  assert.deepEqual(await readCatalogCache(), { catalog: legacyCatalog, fetchedAt: 123 });
  const result = await fetchCatalog();
  assert.equal(result.fromCache, false);
  assert.equal(result.catalog.sources.length, 2);
  assert.equal(fixture.requests.length, 4);
});

test('keeps cached V2 Activities when that repository fails while refreshing V1', async (t) => {
  const fixture = await catalogFixture(t);
  const initial = await fetchCatalog();
  fixture.failures.add(1);
  fixture.revisions[0] = 'c'.repeat(40);
  const refreshed = await fetchCatalog({ force: true });
  assert.equal(refreshed.catalog.activities.length, 2);
  assert.equal(refreshed.catalog.sources[0].revision, fixture.revisions[0]);
  assert.deepEqual(refreshed.catalog.activities[1], initial.catalog.activities[1]);
  assert.match(refreshed.warnings[0], /ChudPresence-Activities-V2.*Using its cached Activities/);
  assert.deepEqual((await readCatalogCache()).catalog, refreshed.catalog);
  const cached = structuredClone(fixture.storage);
  fixture.failures.add(0);
  await assert.rejects(fetchCatalog({ force: true }), /Could not refresh/);
  assert.deepEqual(fixture.storage, cached);
});

test('loads either available repository on first refresh and retries the missing catalog', async (t) => {
  const fixture = await catalogFixture(t);
  fixture.failures.add(0);
  const partial = await fetchCatalog();
  assert.deepEqual(partial.catalog.activities.map((entry) => entry.id), ['google']);
  assert.match(partial.warnings[0], /ChudPresence-Activities.*HTTP 503/);
  fixture.failures.clear();
  assert.equal((await fetchCatalog()).catalog.activities.length, 2);
});

test('prefers the V2 repository when both catalogs declare the same Activity ID', async (t) => {
  const fixture = await catalogFixture(t);
  fixture.catalogs[1].activities = [await entryFor(fixture.fixtures[0], { apiVersion: 2 })];
  const result = await fetchCatalog();
  assert.equal(result.catalog.activities.length, 1);
  assert.equal(result.catalog.activities[0].catalogSource.repository, 'ChudForks/ChudPresence-Activities-V2');
});

test('rejects untrusted catalog sources and paths escaping the pinned repository revision', async (t) => {
  const fixture = await catalogFixture(t);
  const { catalog } = await fetchCatalog();
  const entry = catalog.activities[1];
  for (const source of [
    { ...entry.catalogSource, repository: 'someone/ChudPresence-Activities-V2' },
    { ...entry.catalogSource, revision: 'main' },
  ]) {
    const invalidEntry = { ...entry, catalogSource: source };
    assert.throws(() => validateCatalog({ ...catalog, activities: [invalidEntry] }), /invalid repository source/);
    const requestsBefore = fixture.requests.length;
    await assert.rejects(downloadActivity(entry.id, { ...catalog, activities: [invalidEntry] }), /valid repository source/);
    assert.equal(activityCatalogIconUrl(invalidEntry), '');
    assert.equal(fixture.requests.length, requestsBefore);
  }
  assert.throws(() => validateCatalog({ ...catalog, sources: [catalog.sources[0]], activities: [entry] }), /invalid repository source/);
  for (const path of ['../../../ChudPresence-Activities/main/metadata.json', '../main/metadata.json', 'https://example.com/metadata.json']) {
    await assert.rejects(downloadActivity(entry.id, { ...catalog, activities: [{ ...entry, metadata: path }] }), /outside the configured repository/);
  }
  assert.equal(activityCatalogIconUrl({ ...entry, icon: '../icon.png' }), '');
});

test('V2 downloads enforce code, metadata, and icon hashes', async (t) => {
  const fixture = await catalogFixture(t);
  const { catalog } = await fetchCatalog();
  const entry = catalog.activities[1];
  for (const [field, message] of [
    ['sha256', /Activity code integrity check failed/],
    ['metadataSha256', /Activity metadata integrity check failed/],
    ['iconSha256', /Activity icon integrity check failed/],
  ]) {
    await assert.rejects(downloadActivity(entry.id, { ...catalog, activities: [{ ...entry, [field]: '0'.repeat(64) }] }), message);
  }
});
