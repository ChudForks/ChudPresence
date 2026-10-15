import {
  isSupportedActivityApiVersion,
  MAX_ACTIVITY_SOURCE_BYTES,
  isActivityId,
  isSemanticVersion,
  validateMatchPattern,
  validateActivityMetadata,
  validateActivityPackageSource,
} from './activity-validator.js';
import { MAX_ACTIVITY_V2_BYTES, validateV2Metadata, V2_METADATA_FIELDS } from './activity-api-v2.js';
import { ACTIVITY_KIND_VALUES } from './activity-contract.generated.js';
import { MAX_ACTIVITY_ICON_BYTES, MAX_ACTIVITY_METADATA_BYTES } from './activity-contract.generated.js';

export const ACTIVITY_REPOSITORY = Object.freeze({
  apiVersion: 1,
  owner: 'ChudForks',
  name: 'ChudPresence-Activities',
  branch: 'main',
  baseUrl: 'https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities/main/',
  rawBaseUrl: 'https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities/',
  apiBaseUrl: 'https://api.github.com/repos/ChudForks/ChudPresence-Activities/',
  catalogPath: 'catalog.json',
});

export const ACTIVITY_V2_REPOSITORY = Object.freeze({
  apiVersion: 2,
  owner: 'ChudForks',
  name: 'ChudPresence-Activities-V2',
  branch: 'main',
  baseUrl: 'https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities-V2/main/',
  rawBaseUrl: 'https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities-V2/',
  apiBaseUrl: 'https://api.github.com/repos/ChudForks/ChudPresence-Activities-V2/',
  catalogPath: 'catalog.json',
});

export const ACTIVITY_REPOSITORIES = Object.freeze([ACTIVITY_REPOSITORY, ACTIVITY_V2_REPOSITORY]);

export function repositoryForActivityApiVersion(apiVersion) {
  return ACTIVITY_REPOSITORIES.find((repository) => repository.apiVersion === apiVersion) || null;
}

function repositoryName(repository) {
  return `${repository.owner}/${repository.name}`;
}

const CATALOG_CACHE_KEY = 'activityCatalogCache';
const CATALOG_FETCHED_KEY = 'activityCatalogFetchedAt';
const SOURCE_CACHES_KEY = 'activityCatalogCaches';
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = MAX_ACTIVITY_METADATA_BYTES;
const MAX_ICON_BYTES = MAX_ACTIVITY_ICON_BYTES;
const DEFAULT_MEDIA_KINDS = new Set(ACTIVITY_KIND_VALUES);

function extensionApi() {
  return globalThis.browser || globalThis.chrome;
}

function safeRepositoryPath(path, activityId, filename) {
  return typeof path === 'string' && path === `activities/${activityId}/${filename}`;
}

function validStringList(value, maxItems, maxLength, pattern = null) {
  return Array.isArray(value) && value.length <= maxItems && new Set(value).size === value.length &&
    value.every((item) => typeof item === 'string' && item.trim() === item && item.length > 0 &&
      item.length <= maxLength && (!pattern || pattern.test(item)));
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.keys(nested).sort().map((key) => [key, nested[key]]));
  });
}

export function validateCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
      !Array.isArray(value.activities) || value.activities.length > 2000) {
    throw new Error('The Activities repository catalog has an unsupported format.');
  }
  if (value.revision !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.revision)) {
    throw new Error('The Activities repository catalog has an invalid repository revision.');
  }
  const seen = new Set();
  for (const entry of value.activities) {
    if (!entry || typeof entry !== 'object' || !isActivityId(entry.id) || seen.has(entry.id)) {
      throw new Error('The Activities repository catalog contains an invalid or duplicate entry.');
    }
    seen.add(entry.id);
    if (!safeRepositoryPath(entry.metadata, entry.id, 'metadata.json') ||
        !safeRepositoryPath(entry.entry, entry.id, entry.apiVersion === 2 ? 'activity.json' : 'activity.js') ||
        !/^[a-f0-9]{64}$/i.test(entry.metadataSha256 || '') ||
        !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) {
      throw new Error(`The catalog entry for ${entry.id} has invalid paths or integrity hashes.`);
    }
    if (typeof entry.name !== 'string' || typeof entry.description !== 'string' ||
        typeof entry.version !== 'string' || !Number.isInteger(entry.apiVersion) || entry.apiVersion < 1 ||
        entry.name.length > 80 || entry.description.length > 500 ||
        !isSemanticVersion(entry.version) ||
        !Array.isArray(entry.matches) || entry.matches.length < 1 || entry.matches.length > 32 ||
        new Set(entry.matches).size !== entry.matches.length || !entry.matches.every(validateMatchPattern)) {
      throw new Error(`The catalog entry for ${entry.id} is missing required display or API fields.`);
    }
    if (entry.minExtensionVersion !== undefined && !isSemanticVersion(entry.minExtensionVersion)) {
      throw new Error(`The catalog entry for ${entry.id} has an invalid minimum extension version.`);
    }
    if (entry.apiVersion === 2) {
      for (const forbidden of ['network', 'settings', 'executionWorld', 'presence']) {
        if (entry[forbidden] !== undefined) throw new Error(`V2 catalog entry contains forbidden ${forbidden}.`);
      }
      const fields = Object.fromEntries(V2_METADATA_FIELDS.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]));
      validateV2Metadata({ ...fields, entry: 'activity.json', ...(entry.icon ? { icon: 'icon.png' } : {}) });
    }
    if (entry.network !== undefined &&
        (!Array.isArray(entry.network) || entry.network.length > 32 ||
         new Set(entry.network).size !== entry.network.length ||
         !entry.network.every(validateMatchPattern) ||
         entry.network.some((pattern) => /^(?:https:\/\/)(?:\*\.)?(?:[^/]*\.)?(?:discord\.com|discordapp\.com|discordapp\.net)\//i.test(pattern)))) {
      throw new Error(`The catalog entry for ${entry.id} has invalid network permissions.`);
    }
    if (entry.category !== undefined &&
        (typeof entry.category !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(entry.category))) {
      throw new Error(`The catalog entry for ${entry.id} has an invalid category.`);
    }
    if (entry.defaultMediaKind !== undefined &&
        !DEFAULT_MEDIA_KINDS.has(entry.defaultMediaKind)) {
      throw new Error(`The catalog entry for ${entry.id} has an invalid default media kind.`);
    }
    if (entry.settingsUi !== undefined) {
      const ui = entry.settingsUi;
      const labels = ui?.statusLabels;
      if (!ui || typeof ui !== 'object' || Array.isArray(ui) ||
          Object.keys(ui).some((key) => key !== 'statusLabels') ||
          (labels !== undefined && (!labels || typeof labels !== 'object' || Array.isArray(labels) ||
            Object.entries(labels).some(([key, value]) =>
              !['app', 'artist', 'track'].includes(key) || typeof value !== 'string' ||
              !value.trim() || value.length > 80)))) {
        throw new Error(`The catalog entry for ${entry.id} has invalid settings UI labels.`);
      }
    }
    if (entry.author !== undefined &&
        (!entry.author || typeof entry.author !== 'object' || Array.isArray(entry.author) ||
         typeof entry.author.name !== 'string' || !entry.author.name.trim() || entry.author.name.length > 80 ||
         Object.keys(entry.author).some((key) => !['name', 'url'].includes(key)) ||
         (entry.author.url !== undefined && !validHttpsUrl(entry.author.url)))) {
      throw new Error(`The catalog entry for ${entry.id} has an invalid author.`);
    }
    if (entry.aliases !== undefined && !validStringList(entry.aliases, 32, 80)) {
      throw new Error(`The catalog entry for ${entry.id} has invalid aliases.`);
    }
    if (entry.tags !== undefined && !validStringList(entry.tags, 32, 32, /^[a-z0-9][a-z0-9-]{0,31}$/)) {
      throw new Error(`The catalog entry for ${entry.id} has invalid tags.`);
    }
    if (entry.excludeMatches !== undefined &&
        (!Array.isArray(entry.excludeMatches) || entry.excludeMatches.length > 32 ||
         new Set(entry.excludeMatches).size !== entry.excludeMatches.length || !entry.excludeMatches.every(validateMatchPattern))) {
      throw new Error(`The catalog entry for ${entry.id} has invalid excludeMatches.`);
    }
    if (entry.contributors !== undefined &&
        (!Array.isArray(entry.contributors) || entry.contributors.length > 16 || entry.contributors.some((person) =>
          !person || typeof person !== 'object' || Array.isArray(person) || typeof person.name !== 'string' ||
          !person.name.trim() || person.name.length > 80 || Object.keys(person).some((key) => !['name', 'url'].includes(key)) ||
          (person.url !== undefined && !validHttpsUrl(person.url))))) {
      throw new Error(`The catalog entry for ${entry.id} has invalid contributors.`);
    }
    for (const field of ['serviceUrl', 'homepage', 'repository']) {
      if (entry[field] !== undefined && !validHttpsUrl(entry[field])) {
        throw new Error(`The catalog entry for ${entry.id} has an invalid ${field}.`);
      }
    }
    if ((entry.icon === undefined && entry.iconSha256 !== undefined) ||
        (entry.icon !== undefined &&
         (!safeRepositoryPath(entry.icon, entry.id, 'icon.png') || !/^[a-f0-9]{64}$/i.test(entry.iconSha256 || '')))) {
      throw new Error(`The catalog entry for ${entry.id} has an invalid icon path or integrity hash.`);
    }
  }
  return value;
}

function repositoryFileUrl(path, baseUrl) {
  const url = new URL(path, baseUrl);
  const base = new URL(baseUrl);
  const allowedBase = ACTIVITY_REPOSITORIES.some((repository) => {
    if (!base.href.startsWith(repository.rawBaseUrl)) return false;
    return /^(?:main|[a-f0-9]{40}|[a-f0-9]{64})\/$/i.test(base.href.slice(repository.rawBaseUrl.length));
  });
  if (!allowedBase || url.origin !== base.origin || !url.href.startsWith(base.href) || url.search || url.hash) {
    throw new Error('Activity repository path is outside the configured repository.');
  }
  return url;
}

async function responseText(path, maxBytes, baseUrl) {
  const url = repositoryFileUrl(path, baseUrl);
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json, text/plain;q=0.9' },
  });
  if (!response.ok) throw new Error(`Activity repository returned HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Repository file exceeds its size limit.');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Repository file exceeds its size limit.');
  return text;
}

async function responseBytes(path, maxBytes, baseUrl) {
  const url = repositoryFileUrl(path, baseUrl);
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'image/png' },
  });
  if (!response.ok) throw new Error(`Activity repository returned HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('Repository icon exceeds its size limit.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('Repository icon exceeds its size limit.');
  return bytes;
}

async function sha256(value) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const bytes = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function repositoryRevision(repository) {
  const response = await fetch(new URL(`commits/${repository.branch}`, repository.apiBaseUrl), {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`Could not resolve the Activities repository revision (HTTP ${response.status}).`);
  const result = await response.json();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(result?.sha || '')) {
    throw new Error('The Activities repository returned an invalid commit revision.');
  }
  return result.sha.toLowerCase();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function storageApi() {
  const storage = extensionApi()?.storage?.local;
  if (!storage) throw new Error('Extension storage is unavailable.');
  return storage;
}

function validateSourceCatalog(value, repository) {
  const catalog = validateCatalog(value);
  if (catalog.activities.some((entry) => entry.apiVersion !== repository.apiVersion)) {
    throw new Error(`${repositoryName(repository)} must contain only Activity API V${repository.apiVersion} packages.`);
  }
  return catalog;
}

async function readSourceCaches() {
  const result = await storageApi().get([SOURCE_CACHES_KEY, CATALOG_CACHE_KEY, CATALOG_FETCHED_KEY]);
  const caches = {};
  for (const repository of ACTIVITY_REPOSITORIES) {
    const name = repositoryName(repository);
    const saved = result[SOURCE_CACHES_KEY]?.[name];
    try {
      if (saved?.catalog) caches[name] = {
        catalog: validateSourceCatalog(saved.catalog, repository),
        fetchedAt: Number(saved.fetchedAt) || 0,
      };
    } catch { /* Ignore a corrupt source without discarding another source's cache. */ }
  }
  // The original cache belongs to the V1 repository. Never reinterpret its V2
  // entries as coming from the new repository, even when their IDs match.
  const legacyName = repositoryName(ACTIVITY_REPOSITORY);
  if (!caches[legacyName] && result[CATALOG_CACHE_KEY]) {
    try {
      const legacy = validateCatalog(result[CATALOG_CACHE_KEY]);
      caches[legacyName] = {
        catalog: { ...legacy, activities: legacy.activities.filter((entry) => entry.apiVersion === 1) },
        fetchedAt: Number(result[CATALOG_FETCHED_KEY]) || 0,
      };
    } catch { /* A legacy cache is optional. */ }
  }
  return caches;
}

function aggregateCatalog(sources) {
  const available = sources.filter((source) => source.catalog);
  const warnings = sources.filter((source) => source.error).map((source) =>
    `${source.repository}: ${source.error.replace(/[.!?]$/, '')}.${source.catalog ? ' Showing its cached catalog.' : ' Its Activities are unavailable.'}`);
  if (!available.length) return { catalog: null, fetchedAt: 0, fromCache: false, warnings };
  const entries = available.flatMap((source) => source.catalog.activities.map((entry) => ({
    ...entry,
    catalogSource: { repository: source.repository, ...(source.catalog.revision ? { revision: source.catalog.revision } : {}) },
  })));
  const counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const duplicateIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicateIds.length) warnings.push(`Duplicate Activity IDs across repositories were hidden: ${duplicateIds.join(', ')}. Each Activity must have a unique ID.`);
  const catalog = {
    schemaVersion: 1,
    sources: sources.map(({ catalog: sourceCatalog, ...source }) => ({
      ...source, available: Boolean(sourceCatalog), ...(sourceCatalog?.revision ? { revision: sourceCatalog.revision } : {}),
    })),
    activities: entries.filter((entry) => counts.get(entry.id) === 1),
  };
  return {
    catalog,
    fetchedAt: Math.min(...available.map((source) => source.fetchedAt || 0)),
    fromCache: available.some((source) => source.fromCache),
    warnings,
  };
}

export async function readCatalogCache() {
  const caches = await readSourceCaches();
  return aggregateCatalog(ACTIVITY_REPOSITORIES.map((repository) => ({
    repository: repositoryName(repository), ...caches[repositoryName(repository)], fromCache: true,
    ...(!caches[repositoryName(repository)] ? { error: 'No cached catalog is available; use Refresh catalog to connect this repository' } : {}),
  })));
}

export async function fetchCatalog({ force = false } = {}) {
  const caches = await readSourceCaches();
  const sources = await Promise.all(ACTIVITY_REPOSITORIES.map(async (repository) => {
    const name = repositoryName(repository);
    const cached = caches[name];
    if (!force && cached?.catalog.revision) return { repository: name, ...cached, fromCache: true };
    try {
      const revision = await repositoryRevision(repository);
      const text = await responseText(repository.catalogPath, MAX_CATALOG_BYTES, `${repository.rawBaseUrl}${revision}/`);
      const catalog = validateSourceCatalog({ ...JSON.parse(text), revision }, repository);
      const fetchedAt = Date.now();
      caches[name] = { catalog, fetchedAt };
      return { repository: name, catalog, fetchedAt, fromCache: false };
    } catch (error) {
      return { repository: name, ...cached, fromCache: Boolean(cached), error: error.message };
    }
  }));
  const result = aggregateCatalog(sources);
  if (!result.catalog) throw new Error(`Could not load the Activities catalogs. ${result.warnings.join(' ')}`);
  await storageApi().set({ [SOURCE_CACHES_KEY]: caches });
  return result;
}

function entryRepository(entry, catalog = null) {
  const sourceName = entry.catalogSource?.repository;
  const repository = sourceName
    ? ACTIVITY_REPOSITORIES.find((candidate) => repositoryName(candidate) === sourceName)
    : !catalog?.sources ? ACTIVITY_REPOSITORY : null;
  if (!repository || (entry.apiVersion === 2 ? repository.apiVersion !== 2 : repository.apiVersion !== 1)) {
    throw new Error('Activity catalog source does not match its API version or an allowed repository. Refresh the catalogs and retry.');
  }
  return repository;
}

export function repositoryActivityIconUrl(entry) {
  if (!safeRepositoryPath(entry?.icon, entry?.id, 'icon.png') || !isActivityId(entry?.id)) return '';
  try {
    const repository = entryRepository(entry);
    const revision = entry.catalogSource?.revision;
    if (revision !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)) return '';
    return repositoryFileUrl(entry.icon, revision ? `${repository.rawBaseUrl}${revision}/` : repository.baseUrl).href;
  } catch {
    return '';
  }
}

export async function downloadActivity(activityId, catalog) {
  const entries = catalog?.activities?.filter((item) => item.id === activityId) || [];
  if (entries.length > 1) throw new Error(`Activity ${activityId} has an ambiguous catalog source. Refresh the catalogs and retry.`);
  const entry = entries[0];
  if (!entry) throw new Error(`Activity ${activityId} is not present in the catalog.`);
  validateCatalog({ schemaVersion: 1, activities: [entry] });
  const repository = entryRepository(entry, catalog);
  const pinnedRevision = entry.catalogSource?.revision ?? (!catalog.sources ? catalog.revision : undefined);
  if (pinnedRevision !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(pinnedRevision)) {
    throw new Error('Activity catalog does not identify a valid repository revision.');
  }
  const revision = pinnedRevision ?? await repositoryRevision(repository);
  const immutableBase = `${repository.rawBaseUrl}${revision}/`;
  const [metadataText, source, iconBytes] = await Promise.all([
    responseText(entry.metadata, MAX_METADATA_BYTES, immutableBase),
    responseText(entry.entry, entry.apiVersion === 2 ? MAX_ACTIVITY_V2_BYTES : MAX_ACTIVITY_SOURCE_BYTES, immutableBase),
    entry.icon ? responseBytes(entry.icon, MAX_ICON_BYTES, immutableBase) : Promise.resolve(null),
  ]);
  if (await sha256(metadataText) !== entry.metadataSha256.toLowerCase()) {
    throw new Error('Activity metadata integrity check failed.');
  }
  if (await sha256(source) !== entry.sha256.toLowerCase()) {
    throw new Error('Activity code integrity check failed.');
  }
  if (iconBytes && await sha256(iconBytes) !== entry.iconSha256.toLowerCase()) {
    throw new Error('Activity icon integrity check failed.');
  }
  let metadata;
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(metadataText);
    metadata = validateActivityMetadata(packageMetadata);
  } catch (error) {
    throw new Error(`Activity metadata is invalid: ${error.message}`);
  }
  validateActivityPackageSource(source, metadata);
  const comparableFields = ['name', 'description', 'version', 'apiVersion', 'minExtensionVersion', 'matches',
    'category', 'aliases', 'tags', 'excludeMatches', 'author', 'contributors',
    'serviceUrl', 'homepage', 'repository', 'presence', 'defaultMediaKind',
    'frames', 'network', 'settings', 'settingsUi'];
  const mismatch = comparableFields.find((field) =>
    canonicalJson(packageMetadata[field]) !== canonicalJson(entry[field]));
  if (!isSupportedActivityApiVersion(metadata.apiVersion) || metadata.id !== entry.id ||
      mismatch || Boolean(metadata.icon) !== Boolean(iconBytes)) {
    const field = metadata.id !== entry.id ? 'id' : mismatch || 'icon or API version';
    const error = new Error(`Activity metadata does not match its catalog entry (${field}). Refresh the catalog and try again.`);
    error.code = 'catalog_metadata_mismatch';
    throw error;
  }
  const icon = iconBytes ? `data:image/png;base64,${bytesToBase64(iconBytes)}` : undefined;
  return {
    metadata,
    metadataSource: metadataText,
    source,
    ...(icon ? { icon } : {}),
    sourceType: 'repository',
    provenance: {
      repository: repositoryName(repository),
      revision: revision.toLowerCase(),
      codeSha256: entry.sha256.toLowerCase(),
      metadataSha256: entry.metadataSha256.toLowerCase(),
      ...(iconBytes ? { iconSha256: entry.iconSha256.toLowerCase() } : {}),
    },
  };
}

export function compareActivityVersions(left, right) {
  const parse = (version) => {
    const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[^+]+)?$/);
    return match && {
      core: match.slice(1, 4).map((part) => BigInt(part)),
      prerelease: match[4] ? match[4].split('.') : null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]);
    const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return BigInt(a.prerelease[index]) < BigInt(b.prerelease[index]) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    // SemVer uses ASCII ordering, independent of the browser's locale.
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1;
  }
  return 0;
}
