import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_REPOSITORY, ACTIVITY_V2_REPOSITORY, compareActivityVersions, downloadActivity, fetchCatalog, readCatalogCache, repositoryActivityIconUrl, validateCatalog } from '../extension/core/activity-repository.js';

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

function createFixture() {
  const metadata = JSON.stringify({
    id: 'youtube-music',
    name: 'YouTube Music',
    description: 'Show current music playback.',
    version: '1.0.0',
    apiVersion: 1,
    matches: ['https://music.youtube.com/*'],
    entry: 'activity.js',
    icon: 'icon.png',
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
    'serviceUrl', 'homepage', 'repository', 'presence', 'defaultMediaKind', 'frames', 'network', 'settings', 'settingsUi'];
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    apiVersion: metadata.apiVersion,
    ...Object.fromEntries(metadataFields.filter((field) => metadata[field] !== undefined).map((field) => [field, metadata[field]])),
    entry: `activities/${metadata.id}/${metadata.entry}`,
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
    apiVersion: 3,
    minExtensionVersion: '1.12.0',
    metadata: 'activities/future-activity/metadata.json',
    entry: 'activities/future-activity/activity.js',
    icon: 'activities/future-activity/icon.png',
  });
  const catalog = validateCatalog({ schemaVersion: 1, revision: 'b'.repeat(40), activities: [currentEntry, futureEntry] });
  assert.equal(catalog.activities.length, 2);
  assert.equal(catalog.activities[1].apiVersion, 3);
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
  metadata.apiVersion = 3;
  fixture.metadata = JSON.stringify(metadata);
  fixture.files.set('metadata.json', fixture.metadata);
  stubRepositoryFetch(fixture);
  try {
    await assert.rejects(downloadActivity('youtube-music', {
      revision: 'a'.repeat(40),
      activities: [await entryFor(fixture, { apiVersion: 3 })],
    }), /Activity API version 3 is not supported/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createV2Fixture(id = 'prime-video') {
  const fixture = createFixture();
  const metadata = { id, name: 'Prime Video', description: 'Current video playback.', version: '1.0.0', apiVersion: 2,
    matches: ['https://www.primevideo.com/*'], entry: 'activity.json', icon: 'icon.png' };
  fixture.metadata = JSON.stringify(metadata);
  fixture.source = JSON.stringify({ schemaVersion: 1, kind: 'video', scope: '#player',
    fields: { title: { source: 'dom.text', selectors: ['.title'] } }, player: { adapter: 'html-media', selectors: ['video'] } });
  fixture.files = new Map([['metadata.json', fixture.metadata], ['activity.json', fixture.source], ['icon.png', fixture.icon]]);
  return fixture;
}

async function withCatalogStorage(initial, run) {
  const originalChrome = globalThis.chrome;
  const data = structuredClone(initial);
  globalThis.chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries(keys.map((key) => [key, structuredClone(data[key])])); },
    async set(values) { Object.assign(data, structuredClone(values)); },
  } } };
  try { await run(data); }
  finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
}

function catalogFetch(catalogs, { failures = [], fixtures = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    calls.push(url.href);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    const name = Object.keys(catalogs).find((candidate) => url.pathname.startsWith(`/repos/${candidate}/`) || url.pathname.startsWith(`/${candidate}/`));
    if (!name || failures.includes(name)) throw new Error('Source unavailable');
    const { catalog, revision } = catalogs[name];
    if (url.hostname === 'api.github.com') {
      assert.equal(url.pathname, `/repos/${name}/commits/main`);
      return Response.json({ sha: revision });
    }
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    assert.ok(url.pathname.startsWith(`/${name}/${revision}/`), url.href);
    if (url.pathname.endsWith('/catalog.json')) return Response.json(catalog);
    const body = fixtures[name]?.files.get(url.pathname.split('/').at(-1));
    return body === undefined ? new Response('', { status: 404 }) : new Response(body);
  };
  return calls;
}

const v1Name = `${ACTIVITY_REPOSITORY.owner}/${ACTIVITY_REPOSITORY.name}`;
const v2Name = `${ACTIVITY_V2_REPOSITORY.owner}/${ACTIVITY_V2_REPOSITORY.name}`;

test('aggregates independently pinned V1 and V2 catalogs and downloads from their owning repository', async () => {
  const v1 = createFixture();
  const v2 = createV2Fixture();
  const catalogs = {
    [v1Name]: { revision: '1'.repeat(40), catalog: { schemaVersion: 1, activities: [await entryFor(v1)] } },
    [v2Name]: { revision: '2'.repeat(40), catalog: { schemaVersion: 1, activities: [await entryFor(v2)] } },
  };
  await withCatalogStorage({}, async (data) => {
    const calls = catalogFetch(catalogs, { fixtures: { [v1Name]: v1, [v2Name]: v2 } });
    const result = await fetchCatalog();
    assert.equal(result.fromCache, false);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.catalog.activities.length, 2);
    assert.deepEqual(result.catalog.activities.map((entry) => entry.catalogSource), [
      { repository: v1Name, revision: '1'.repeat(40) }, { repository: v2Name, revision: '2'.repeat(40) },
    ]);
    for (const [name, id] of [[v1Name, 'youtube-music'], [v2Name, 'prime-video']]) {
      const activityPackage = await downloadActivity(id, result.catalog);
      assert.equal(activityPackage.provenance.repository, name);
      assert.equal(activityPackage.provenance.revision, catalogs[name].revision);
      const entry = result.catalog.activities.find((entry) => entry.id === id);
      assert.equal(repositoryActivityIconUrl(entry), `https://raw.githubusercontent.com/${name}/${catalogs[name].revision}/activities/${id}/icon.png`);
    }
    assert.equal(Object.keys(data.activityCatalogCaches).length, 2);
    assert.equal(calls.filter((url) => url.includes('/commits/main')).length, 2);
    const before = calls.length;
    const cached = await fetchCatalog();
    assert.equal(cached.fromCache, true);
    assert.equal(calls.length, before);
    assert.deepEqual(cached.catalog.activities, result.catalog.activities);
  });
});

test('refreshes available sources and keeps the other source pinned to its cached revision on failure', async () => {
  const v1Entry = await entryFor(createFixture());
  const v2Entry = await entryFor(createV2Fixture());
  const oldV2Revision = 'b'.repeat(40);
  await withCatalogStorage({ activityCatalogCaches: {
    [v2Name]: { catalog: { schemaVersion: 1, revision: oldV2Revision, activities: [v2Entry] }, fetchedAt: 123 },
  } }, async (data) => {
    catalogFetch({
      [v1Name]: { revision: 'a'.repeat(40), catalog: { schemaVersion: 1, activities: [v1Entry] } },
      [v2Name]: {},
    }, { failures: [v2Name] });
    const result = await fetchCatalog({ force: true });
    assert.equal(result.catalog.activities.length, 2);
    assert.equal(result.fromCache, true);
    assert.match(result.warnings.join(' '), /ChudPresence-Activities-V2: Source unavailable\. Showing its cached catalog/);
    assert.equal(result.catalog.activities.find((entry) => entry.apiVersion === 2).catalogSource.revision, oldV2Revision);
    assert.equal(data.activityCatalogCaches[v2Name].catalog.revision, oldV2Revision);
    assert.equal(data.activityCatalogCaches[v1Name].catalog.revision, 'a'.repeat(40));
    assert.equal(result.catalog.sources.find((source) => source.repository === v2Name).fromCache, true);
  });
});

test('loads one useful catalog when another is unavailable and rejects only when neither has data', async () => {
  await withCatalogStorage({}, async () => {
    const catalogs = {
      [v1Name]: { revision: 'a'.repeat(40), catalog: { schemaVersion: 1, activities: [await entryFor(createFixture())] } },
      [v2Name]: {},
    };
    catalogFetch(catalogs, { failures: [v2Name] });
    const result = await fetchCatalog({ force: true });
    assert.equal(result.catalog.activities.length, 1);
    assert.match(result.warnings.join(' '), /V2: Source unavailable\. Its Activities are unavailable/);
  });
  await withCatalogStorage({}, async () => {
    catalogFetch({ [v1Name]: {}, [v2Name]: {} }, { failures: [v1Name, v2Name] });
    await assert.rejects(fetchCatalog(), /Could not load the Activities catalogs/);
  });
});

test('migrates the legacy V1 cache without assigning its V2 packages to the new repository', async () => {
  await withCatalogStorage({
    activityCatalogCache: { schemaVersion: 1, revision: 'a'.repeat(40), activities: [await entryFor(createFixture()), await entryFor(createV2Fixture())] },
    activityCatalogFetchedAt: 100,
  }, async () => {
    const cache = await readCatalogCache();
    assert.deepEqual(cache.catalog.activities.map((entry) => entry.id), ['youtube-music']);
    assert.deepEqual(cache.catalog.activities[0].catalogSource, { repository: v1Name, revision: 'a'.repeat(40) });
    assert.equal(cache.fetchedAt, 100);
    assert.equal(cache.catalog.sources.find((source) => source.repository === v2Name).available, false);
  });
});

test('rejects a catalog placed in the wrong API repository and preserves independently valid caches', async () => {
  const v1Entry = await entryFor(createFixture());
  await withCatalogStorage({ activityCatalogCaches: {
    [v1Name]: { catalog: { schemaVersion: 1, revision: 'a'.repeat(40), activities: [v1Entry] }, fetchedAt: 100 },
    [v2Name]: { catalog: { schemaVersion: 1, revision: 'b'.repeat(40), activities: [v1Entry] }, fetchedAt: 200 },
  } }, async () => {
    assert.equal((await readCatalogCache()).catalog.activities.length, 1);
    catalogFetch({ [v1Name]: {}, [v2Name]: { revision: 'c'.repeat(40), catalog: { schemaVersion: 1, activities: [v1Entry] } } }, { failures: [v1Name] });
    const result = await fetchCatalog({ force: true });
    assert.match(result.warnings.join(' '), /must contain only Activity API V2 packages/);
    assert.equal(result.catalog.activities.length, 1);
  });
});

test('hides conflicting IDs across repositories and refuses ambiguous downloads', async () => {
  const v1Entry = await entryFor(createFixture());
  const v2Entry = await entryFor(createV2Fixture('youtube-music'));
  await withCatalogStorage({}, async () => {
    catalogFetch({
      [v1Name]: { revision: 'a'.repeat(40), catalog: { schemaVersion: 1, activities: [v1Entry] } },
      [v2Name]: { revision: 'b'.repeat(40), catalog: { schemaVersion: 1, activities: [v2Entry] } },
    });
    const result = await fetchCatalog();
    assert.equal(result.catalog.activities.length, 0);
    assert.match(result.warnings.join(' '), /Duplicate Activity IDs across repositories were hidden: youtube-music/);
    await assert.rejects(downloadActivity('youtube-music', { activities: [v1Entry, v2Entry] }), /ambiguous catalog source/);
  });
});

test('refuses paths and repository provenance that could misroute package or icon requests', async () => {
  const v1Entry = await entryFor(createFixture());
  const v2Entry = await entryFor(createV2Fixture());
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Unexpected request'); };
  try {
    for (const entry of [
      { ...v1Entry, metadata: 'https://outside.example/metadata.json' },
      { ...v1Entry, entry: '../activities/youtube-music/activity.js' },
      { ...v1Entry, catalogSource: { repository: v2Name, revision: 'a'.repeat(40) } },
      { ...v2Entry, catalogSource: { repository: v1Name, revision: 'a'.repeat(40) } },
      { ...v2Entry, catalogSource: { repository: `${v2Name}-other`, revision: 'a'.repeat(40) } },
      v2Entry,
    ]) {
      await assert.rejects(downloadActivity(entry.id, { revision: 'a'.repeat(40), activities: [entry] }), /invalid paths|catalog source/);
    }
    assert.equal(calls, 0);
    for (const revision of ['', 'main', '../main', 'https://outside.example/']) {
      await assert.rejects(downloadActivity(v1Entry.id, { activities: [{ ...v1Entry, catalogSource: { repository: v1Name, revision } }] }), /valid repository revision/);
    }
    assert.equal(calls, 0);
    assert.equal(repositoryActivityIconUrl({ ...v2Entry, catalogSource: { repository: v1Name } }), '');
    assert.equal(repositoryActivityIconUrl({ ...v1Entry, icon: 'https://outside.example/icon.png' }), '');
    assert.equal(repositoryActivityIconUrl({ ...v1Entry, catalogSource: { repository: v1Name, revision: 'main' } }), '');
  } finally { globalThis.fetch = originalFetch; }
});
