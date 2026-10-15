import { hasHostPermissions } from './activity-permissions.js';

// Service policies are approved independently of Activities. An Activity can
// name a policy and its declared media inputs, but cannot provide destinations,
// request options, credentials, response paths, or executable code.
const STORAGE_KEY = 'activityV2ServicePolicies';
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;
const REQUEST_INTERVAL_MS = 10_000;
const MAX_RUNNING = 4;
const MAX_CACHE_ENTRIES = 100;
const MAX_POLICIES = 32;
const POLICY_ID = /^[a-z][a-z0-9-]{1,63}$/;
const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const MEDIA_OUTPUTS = ['subtitle', 'series', 'artist', 'album', 'creator', 'channel', 'category', 'game', 'playlist'];
const MEDIA_INPUTS = ['title', ...MEDIA_OUTPUTS, 'season', 'episode'];
const OUTPUTS = new Set(['artwork.large', 'artwork.small', 'artwork.largeText', 'artwork.smallText', ...MEDIA_OUTPUTS.map((field) => `media.${field}`)]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DIAGNOSTIC_CODES = new Set(['invalid_service_policy', 'invalid_stored_policy', 'service_storage_unavailable', 'invalid_service_response',
  'response_too_large', 'invalid_service_output', 'lookup_not_current', 'service_not_approved', 'invalid_lookup_input', 'lookup_rate_limited',
  'lookup_busy', 'service_token_missing', 'service_network_unavailable', 'service_timeout']);

function fail(message, code = 'invalid_service_policy') {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a JSON object.`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || keys && !keys.includes(key)) fail(`${label} contains an unsupported field.`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be bounded non-empty text.`);
}

function publicHost(host) {
  return host.includes('.') && host.length <= 253 &&
    host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) &&
    !/^\d+(?:\.\d+)*$/.test(host) &&
    !['localhost', 'local', 'localdomain', 'lan', 'home', 'home.arpa', 'intranet', 'corp', 'internal', 'test', 'invalid', 'onion',
      'discord.com', 'discordapp.com', 'discordapp.net'].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function staticHttpsUrl(value, label) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/[a-z0-9.-]+\/[^\s?#{}]*$/.test(value)) {
    fail(`${label} requires a static public HTTPS URL without credentials, ports, queries or fragments.`);
  }
  let url;
  try { url = new URL(value); } catch { fail(`${label} is invalid.`); }
  if (!publicHost(url.hostname) || url.username || url.password || url.port || url.search || url.hash || url.href !== value) {
    fail(`${label} requires a canonical public HTTPS URL.`);
  }
  return url;
}

function canonical(value) {
  return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map((key) => [key, nested[key]])) : nested);
}

function policySource(input) {
  const policy = validateV2ServicePolicy(input);
  return { policy, source: typeof input === 'string' ? input : canonical(policy) };
}

export function validateV2ServicePolicy(input) {
  let policy = input;
  if (typeof input === 'string') {
    if (!input.trim() || new TextEncoder().encode(input).byteLength > MAX_POLICY_BYTES) fail('Service policy JSON is limited to 64 KB.');
    try { policy = JSON.parse(input); } catch { fail('Service policies must be JSON, never executable code.'); }
  }
  object(policy, ['schemaVersion', 'id', 'name', 'description', 'endpoint', 'parameters', 'staticQuery', 'outputs', 'auth'], 'Service policy');
  if (policy.schemaVersion !== 1 || !POLICY_ID.test(policy.id || '')) fail('Service policy version or ID is invalid.');
  boundedText(policy.name, 80, 'Service name');
  boundedText(policy.description, 500, 'Service description');
  staticHttpsUrl(policy.endpoint, 'Service endpoint');
  if (policy.auth !== undefined && policy.auth !== 'bearer') fail('Service authentication supports only a privately stored bearer token.');
  object(policy.parameters, null, 'Service parameters');
  if (Object.keys(policy.parameters).length > 8) fail('Service policies support at most eight input parameters.');
  for (const [name, rule] of Object.entries(policy.parameters)) {
    if (!PARAMETER_NAME.test(name)) fail('Service parameter names must be explicit bounded identifiers.');
    object(rule, rule?.type === 'integer' ? ['type', 'minimum', 'maximum'] : ['type', 'maxLength'], 'Service parameter');
    if (rule.type === 'text') {
      if (!Number.isInteger(rule.maxLength) || rule.maxLength < 1 || rule.maxLength > 256) fail('Text parameter limits must be between 1 and 256.');
    } else if (rule.type === 'integer') {
      if (!Number.isSafeInteger(rule.minimum) || !Number.isSafeInteger(rule.maximum) || rule.minimum < 0 ||
          rule.maximum > 1_000_000_000 || rule.minimum > rule.maximum) fail('Integer parameters require bounded nonnegative minimum and maximum.');
    } else fail('Service parameters support only text or integer values.');
  }
  if (policy.staticQuery !== undefined) {
    object(policy.staticQuery, null, 'Static service query');
    if (Object.keys(policy.staticQuery).length > 8) fail('Service policies support at most eight static query parameters.');
    for (const [name, value] of Object.entries(policy.staticQuery)) {
      if (!PARAMETER_NAME.test(name) || Object.hasOwn(policy.parameters, name)) fail('Static query parameters need distinct explicit names.');
      boundedText(value, 256, 'Static service query value');
    }
  }
  object(policy.outputs, null, 'Service outputs');
  if (!Object.keys(policy.outputs).length || Object.keys(policy.outputs).length > 8) fail('Service policies require one to eight approved output fields.');
  for (const [target, rule] of Object.entries(policy.outputs)) {
    if (!OUTPUTS.has(target)) fail('Services may enrich optional media text and artwork only.');
    object(rule, ['path', 'type', 'baseUrl', 'maxLength'], 'Service output');
    if (!Array.isArray(rule.path) || !rule.path.length || rule.path.length > 8 || rule.path.some((part) =>
      typeof part === 'number' ? !Number.isInteger(part) || part < 0 || part > 99 :
        typeof part !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(part) || FORBIDDEN_KEYS.has(part))) {
      fail('Service response paths must contain bounded literal property names and array indexes.');
    }
    const image = target === 'artwork.large' || target === 'artwork.small';
    if (image) {
      if (rule.type !== 'image-path' || rule.maxLength !== undefined) fail('Artwork outputs require image-path values.');
      staticHttpsUrl(rule.baseUrl, 'Service image base');
    } else {
      if (rule.type !== 'text' || rule.baseUrl !== undefined || rule.maxLength !== undefined &&
          (!Number.isInteger(rule.maxLength) || rule.maxLength < 1 || rule.maxLength > 256)) fail('Media and artwork text outputs require bounded text values.');
    }
  }
  let source;
  try { source = JSON.stringify(policy); } catch { fail('Service policy must be JSON-compatible.'); }
  if (new TextEncoder().encode(source).byteLength > MAX_POLICY_BYTES) fail('Service policy JSON is limited to 64 KB.');
  return JSON.parse(source);
}

export function describeV2ServicePolicy(input) {
  const policy = validateV2ServicePolicy(input);
  return [
    `${policy.name}: ${policy.description}`,
    `Service ID: ${policy.id}. Endpoint: ${policy.endpoint}. GET requests only; browser cookies and referrers are omitted; redirects are blocked.`,
    ...Object.entries(policy.parameters).map(([name, rule]) => `Input ${name}: ${rule.type === 'text' ? `approved media text, up to ${rule.maxLength} characters` : `integer ${rule.minimum}–${rule.maximum}`}. These values are shared with ${new URL(policy.endpoint).hostname}.`),
    ...(policy.staticQuery ? [`Static query: ${JSON.stringify(policy.staticQuery)}.`] : []),
    ...Object.entries(policy.outputs).map(([target, rule]) => `Output ${target}: ${rule.type} from ${JSON.stringify(rule.path)}${rule.baseUrl ? `; image destination ${rule.baseUrl}` : ''}.`),
    `Authentication: ${policy.auth === 'bearer' ? 'a separately entered bearer token, kept in extension storage and never exposed to Activities' : 'none'}.`,
    'This approval trusts this service destination independently of any Activity. Activities cannot add other destinations or change this policy. Requests are limited to one per Activity/service every ten seconds, four concurrent requests, five seconds and 256 KB of JSON.',
  ].join('\n');
}

export async function v2ServiceDigest(input) {
  const { source } = policySource(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function limitedJson(response) {
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300 ||
      response.redirected || !/^(?:application\/json|application\/[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || '')) {
    fail('The service did not return a successful JSON response.', 'invalid_service_response');
  }
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail('The service response exceeds its size limit.', 'response_too_large');
  const reader = response.body?.getReader?.();
  if (!reader) fail('A bounded streaming service response is required.', 'invalid_service_response');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('The service returned an invalid response stream.', 'invalid_service_response');
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) fail('The service response exceeds its size limit.', 'response_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('The service returned invalid JSON.', 'invalid_service_response'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('The service response must be a JSON object.', 'invalid_service_response');
  return data;
}

function projectOutputs(policy, data) {
  const outputs = {};
  for (const [target, rule] of Object.entries(policy.outputs)) {
    let value = data;
    for (const part of rule.path) {
      if (!value || typeof value !== 'object' || typeof part === 'number' && !Array.isArray(value) || !Object.hasOwn(value, part)) { value = undefined; break; }
      value = value[part];
    }
    if (value === undefined || value === null) continue;
    if (rule.type === 'image-path') {
      if (typeof value !== 'string' || !/^\/[A-Za-z0-9_-]{1,200}\.(?:jpg|png|webp)$/.test(value)) fail('The service returned an invalid artwork path.', 'invalid_service_output');
      outputs[target] = rule.baseUrl.replace(/\/$/, '') + value;
    } else {
      if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) fail('The service returned invalid media text.', 'invalid_service_output');
      const clean = value.replace(/\s+/g, ' ').trim().slice(0, rule.maxLength || 256);
      if (clean) outputs[target] = clean;
    }
  }
  return outputs;
}

function applyOutputs(report, outputs) {
  if (!Object.keys(outputs).length) return report;
  const result = { ...report, media: { ...report.media }, artwork: { ...report.artwork } };
  for (const [target, value] of Object.entries(outputs)) {
    const [group, field] = target.split('.');
    result[group][field] = value;
  }
  return result;
}

export class ActivityV2Services {
  #api;
  #fetch;
  #records = new Map();
  #loading;
  #mutation = Promise.resolve();
  #cache = new Map();
  #lastRequest = new Map();
  #controllers = new Map();
  #running = 0;
  #diagnostics = [];

  constructor({ api = globalThis.browser || globalThis.chrome, fetchImpl = globalThis.fetch } = {}) {
    this.#api = api;
    this.#fetch = fetchImpl;
  }

  get lastDiagnostic() { return this.#diagnostics.at(-1) ? { ...this.#diagnostics.at(-1) } : null; }
  diagnostics() { return this.#diagnostics.map((entry) => ({ ...entry })); }

  #diagnose(id, activityId, code) {
    this.#diagnostics.push({ serviceId: POLICY_ID.test(id || '') ? id : '', activityId, code, at: Date.now() });
    while (this.#diagnostics.length > 100) this.#diagnostics.shift();
  }

  async #load() {
    if (!this.#loading) this.#loading = (async () => {
      const stored = await this.#api?.storage?.local?.get?.(STORAGE_KEY);
      const records = stored?.[STORAGE_KEY];
      if (!records || typeof records !== 'object' || Array.isArray(records)) return;
      for (const [id, record] of Object.entries(records).slice(0, MAX_POLICIES)) {
        try {
          object(record, ['source', 'digest', 'token', 'approvedAt'], 'Stored service approval');
          if (typeof record.source !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest || '') ||
              !Number.isFinite(record.approvedAt) || record.approvedAt <= 0 || await v2ServiceDigest(record.source) !== record.digest) fail('Stored service policy no longer matches its approved bytes.');
          const policy = validateV2ServicePolicy(record.source);
          if (policy.id !== id) fail('Stored service policy identity changed.');
          this.#validateToken(policy, record.token);
          this.#records.set(id, { ...record, policy });
        } catch { this.#diagnose(id, '', 'invalid_stored_policy'); }
      }
    })().catch(() => { this.#diagnose('', '', 'service_storage_unavailable'); });
    await this.#loading;
  }

  #validateToken(policy, token) {
    if (typeof token !== 'string' || token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(token) || policy.auth !== 'bearer' && token) fail('Service token is invalid.');
  }

  #invalidate(id) {
    for (const [key, entry] of this.#cache) if (entry.serviceId === id) this.#cache.delete(key);
    for (const [controller, serviceId] of this.#controllers) if (serviceId === id) controller.abort();
  }

  #origins(policy) {
    return [...new Set([`${new URL(policy.endpoint).origin}/*`, ...Object.values(policy.outputs)
      .filter((rule) => rule.baseUrl).map((rule) => `${new URL(rule.baseUrl).origin}/*`)])];
  }

  // A lease exposes only validity checks. It cannot expose policy storage,
  // bearer tokens, or mutable internal records to callers.
  async authorization(id) {
    await this.#load();
    const record = this.#records.get(id);
    const isApproved = () => Boolean(record && this.#records.get(id) === record);
    return {
      isApproved,
      isCurrent: async () => isApproved() && await hasHostPermissions(this.#origins(record.policy), this.#api) && isApproved(),
    };
  }

  async reconcilePermissions() {
    await this.#load();
    const affected = [];
    for (const [id, record] of this.#records) {
      if (await hasHostPermissions(this.#origins(record.policy), this.#api) || this.#records.get(id) !== record) continue;
      // Keep approval installed, but retire the old identity so already-returned
      // results and outstanding leases cannot survive permission revocation.
      this.#records.set(id, { ...record });
      this.#invalidate(id);
      affected.push(id);
    }
    return affected;
  }

  async #persist(records) {
    if (typeof this.#api?.storage?.local?.set !== 'function') fail('Extension service policy storage is unavailable.', 'service_storage_unavailable');
    await this.#api.storage.local.set({ [STORAGE_KEY]: Object.fromEntries([...records].map(([id, record]) =>
      [id, { source: record.source, digest: record.digest, token: record.token, approvedAt: record.approvedAt }])) });
  }

  async list() {
    await this.#load();
    return [...this.#records.values()].map(({ policy, digest, approvedAt, token }) => ({
      ...structuredClone(policy), digest, approvedAt, authenticated: Boolean(token),
    }));
  }

  async approve(input, digest, token = '') {
    const { policy, source } = policySource(input);
    if (!/^[a-f0-9]{64}$/.test(digest || '') || await v2ServiceDigest(source) !== digest) fail('Review and approve these exact service policy bytes first.', 'service_approval_required');
    this.#validateToken(policy, token);
    const operation = this.#mutation.then(async () => {
      await this.#load();
      if (!this.#records.has(policy.id) && this.#records.size >= MAX_POLICIES) fail('At most 32 service policies can be installed.');
      const record = { policy, source, digest, token, approvedAt: Date.now() };
      const next = new Map(this.#records); next.set(policy.id, record);
      await this.#persist(next);
      this.#records = next;
      this.#invalidate(policy.id);
      return { ...structuredClone(policy), digest, approvedAt: record.approvedAt, authenticated: Boolean(token) };
    });
    this.#mutation = operation.catch(() => {});
    return operation;
  }

  async remove(id) {
    if (!POLICY_ID.test(id || '')) fail('Service policy ID is invalid.');
    const operation = this.#mutation.then(async () => {
      await this.#load();
      if (!this.#records.has(id)) return false;
      const next = new Map(this.#records); next.delete(id);
      await this.#persist(next);
      this.#records = next;
      this.#invalidate(id);
      return true;
    });
    this.#mutation = operation.catch(() => {});
    return operation;
  }

  async enrich(config, report, { activityId = report?.activityId || '', isCurrent } = {}) {
    if (!config?.lookup) return report;
    const id = config.lookup.service;
    try {
      await this.#load();
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(activityId) || typeof isCurrent !== 'function') fail('Lookup requires a current approved Activity.', 'lookup_not_current');
      object(config.lookup, ['service', 'input'], 'Activity lookup');
      const record = this.#records.get(id);
      if (!record) fail('The lookup service has no independent approval.', 'service_not_approved');
      const policy = record.policy;
      object(config.lookup.input, Object.keys(policy.parameters), 'Activity lookup inputs');
      const inputs = {};
      for (const [parameter, rule] of Object.entries(policy.parameters)) {
        const field = config.lookup.input[parameter];
        if (!MEDIA_INPUTS.includes(field) || !Object.hasOwn(config.fields || {}, field) || !Object.hasOwn(report.media || {}, field)) {
          fail('Lookup inputs must use declared media fields.', 'invalid_lookup_input');
        }
        const value = report.media[field];
        if (rule.type === 'text') {
          if (typeof value !== 'string' || !value.trim() || value.length > rule.maxLength || /[\u0000-\u001f\u007f]/.test(value)) fail('Lookup media text exceeds its approved bounds.', 'invalid_lookup_input');
          inputs[parameter] = value;
        } else {
          if (typeof value !== 'string' && typeof value !== 'number' || typeof value === 'string' && !/^\d{1,10}$/.test(value) ||
              !Number.isSafeInteger(Number(value)) || Number(value) < rule.minimum || Number(value) > rule.maximum) fail('Lookup integer exceeds its approved bounds.', 'invalid_lookup_input');
          inputs[parameter] = Number(value);
        }
      }
      const current = async () => this.#records.get(id) === record && await hasHostPermissions(this.#origins(policy), this.#api) &&
        this.#records.get(id) === record && await isCurrent() && this.#records.get(id) === record;
      if (!await current()) fail('The lookup is no longer approved or permitted.', 'lookup_not_current');
      const inputKey = canonical(inputs);
      const cacheKey = canonical([activityId, id, record.digest, inputKey]);
      const cached = this.#cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_MS) {
        if (!await current()) fail('The lookup is no longer approved or permitted.', 'lookup_not_current');
        return applyOutputs(report, cached.outputs);
      }
      if (cached) this.#cache.delete(cacheKey);
      const rateKey = canonical([activityId, id]);
      const lastRequest = this.#lastRequest.get(rateKey);
      if (lastRequest !== undefined && Date.now() - lastRequest < REQUEST_INTERVAL_MS) fail('The lookup request rate limit was reached.', 'lookup_rate_limited');
      if (this.#running >= MAX_RUNNING) fail('Too many service requests are running.', 'lookup_busy');
      if (policy.auth === 'bearer' && !record.token) fail('The approved service requires a separately entered token.', 'service_token_missing');
      if (typeof this.#fetch !== 'function') fail('Extension service requests are unavailable.', 'service_network_unavailable');
      const url = new URL(policy.endpoint);
      for (const [key, value] of Object.entries(policy.staticQuery || {})) url.searchParams.set(key, value);
      for (const [key, value] of Object.entries(inputs)) url.searchParams.set(key, String(value));
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
      this.#lastRequest.set(rateKey, Date.now());
      while (this.#lastRequest.size > 200) this.#lastRequest.delete(this.#lastRequest.keys().next().value);
      this.#running += 1;
      this.#controllers.set(controller, id);
      let outputs;
      try {
        const init = { method: 'GET', headers: { Accept: 'application/json', ...(record.token ? { Authorization: `Bearer ${record.token}` } : {}) },
          credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal };
        const fetchPromise = (async () => {
          const response = await Reflect.apply(this.#fetch, globalThis, [url.href, init]);
          if (!await current()) fail('The lookup is no longer approved or permitted.', 'lookup_not_current');
          const data = await limitedJson(response);
          if (!await current()) fail('The lookup is no longer approved or permitted.', 'lookup_not_current');
          return projectOutputs(policy, data);
        })();
        const aborted = new Promise((_, reject) => {
          const rejectAbort = () => { const error = new Error('The service request ended.'); error.code = timedOut ? 'service_timeout' : 'lookup_not_current'; reject(error); };
          if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        outputs = await Promise.race([fetchPromise, aborted]);
      } finally {
        clearTimeout(timer);
        this.#controllers.delete(controller);
        this.#running -= 1;
      }
      if (!await current()) fail('The lookup is no longer approved or permitted.', 'lookup_not_current');
      this.#cache.set(cacheKey, { serviceId: id, at: Date.now(), outputs });
      while (this.#cache.size > MAX_CACHE_ENTRIES) this.#cache.delete(this.#cache.keys().next().value);
      return applyOutputs(report, outputs);
    } catch (error) {
      // Never retain request URLs, inputs, response data, or token-bearing errors
      // in diagnostics. A lookup is optional; rejected results preserve presence.
      this.#diagnose(id, /^[a-z0-9][a-z0-9-]{1,63}$/.test(activityId) ? activityId : '',
        DIAGNOSTIC_CODES.has(error?.code) ? error.code : 'service_request_failed');
      return report;
    }
  }
}
