import { createLinkEvents } from './events.js';
import { configuredActivitySites } from '../core/activity-sites.js';

export const LINK_STORAGE_KEY = 'chudpresenceLink';
export const LINK_HOST_PERMISSION = 'http://127.0.0.1/*';
export const LINK_DEFAULT_PORT = 17879;
export async function prepareLinkNetwork(api) {
  // A legacy host-permission bypass suppresses Origin on Chromium GETs.
  // Link's CORS policy supplies access while retaining the browser's identity.
  if (api.permissions?.contains && api.permissions?.remove &&
      await api.permissions.contains({ origins: [LINK_HOST_PERMISSION] })) {
    const stored = await api.storage?.local?.get?.('installedActivities');
    const needed = Object.values(stored?.installedActivities || {}).some(record =>
      configuredActivitySites(record).some(site => {
        const url = new URL(site);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1';
      }));
    if (!needed) {
      // Required grants in a development build cannot be removed. Explicit
      // request Origin below also preserves Link identity when a grant stays.
      try { await api.permissions.remove({ origins: [LINK_HOST_PERMISSION] }); } catch {}
    }
  }
}

const DISPLAY_TO_LINK = Object.freeze({ app: 'app', artist: 'creator', track: 'title' });
const DISPLAY_FROM_LINK = Object.freeze({ app: 'app', creator: 'artist', title: 'track' });
export const LINK_SETTING_FIELDS = Object.freeze(['display', 'enabled', 'showWhilePaused', 'artwork', 'playbackProgress', 'actionButtons']);
const PREFERENCE_KEYS = Object.freeze({ showWhilePaused: 'showPaused', artwork: 'showArtwork',
  playbackProgress: 'showTimestamps', actionButtons: 'showButtons' });
const SERVICE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const isValue = (field, value) => field === 'display' ? Object.hasOwn(DISPLAY_FROM_LINK, value) : typeof value === 'boolean';
const valuesFor = (value, fields = LINK_SETTING_FIELDS) => Object.fromEntries(fields
  .filter(field => Object.hasOwn(value, field) && isValue(field, value[field])).map(field => [field, value[field]]));
const fieldsOf = value => LINK_SETTING_FIELDS.filter(field => Object.hasOwn(value, field) && isValue(field, value[field]));

function localPatch(values) {
  return Object.fromEntries(fieldsOf(values).map(field => field === 'display' ? ['statusDisplay', DISPLAY_FROM_LINK[values.display]]
    : [PREFERENCE_KEYS[field] || field, values[field]]));
}

function preferenceValues(patch) {
  return { ...(DISPLAY_TO_LINK[patch?.statusDisplay] ? { display: DISPLAY_TO_LINK[patch.statusDisplay] } : {}),
    ...(typeof patch?.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
    ...Object.fromEntries(Object.entries(PREFERENCE_KEYS).filter(([, key]) => typeof patch?.[key] === 'boolean')
      .map(([field, key]) => [field, patch[key]])) };
}
const MESSAGES = {
  unavailable: 'ChudPresence Link is unavailable. Open the app on this PC to reconnect.',
  identity_changed: 'This Link server has changed. Pair this browser again before reconnecting.',
  incompatible: 'This version of ChudPresence Link is not compatible with the extension.',
  unauthorized: 'This browser is no longer authorized. Create a new browser code in Link and pair again.',
  invalid_code: 'The browser pairing code is invalid or expired. Create a new code in Link.',
  rate_limited: 'Link is receiving too many requests. Try again in a minute.',
  discord_unavailable: 'Desktop Discord is unavailable. Using the headless connection.',
  publisher_busy: 'Another browser is using local Discord. Using the headless connection.',
  sync_conflict: 'The sync selection changed. Review the refreshed service list and try again.',
  origin_denied: 'Link did not accept this extension. Create a browser pairing code in the desktop app.',
};

export class LinkError extends Error {
  constructor(code = 'unavailable', status = 0) {
    super(MESSAGES[code] || 'Link could not complete this request. Refresh and try again.');
    this.code = code;
    this.status = status;
  }
}

export function linkServiceId(id) {
  const normalized = String(id || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
  return normalized.length <= 64 && SERVICE_ID.test(normalized) ? normalized : '';
}

export function linkInventory(activities, fields = LINK_SETTING_FIELDS) {
  const seen = new Set();
  return activities.flatMap(activity => {
    const id = linkServiceId(activity.id);
    const values = valuesFor(preferenceValues({ ...activity.preferences, enabled: activity.enabled }), fields);
    if (!id || !fieldsOf(values).length || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: String(activity.name || id).trim().slice(0, 80) || id, ...values,
      ...(values.display ? { displayChoices: ['app', 'creator', 'title'] } : {}) }];
  }).slice(0, 128);
}

/** Credentials and sync versions stay in the trusted background context. */
export function createLinkClient({ storage, fetch: fetchRequest = globalThis.fetch, now = Date.now,
  timeoutMs = 2000, schedule = setTimeout, cancel = clearTimeout, prepareNetwork = async () => {}, origin = '' } = {}) {
  let data = { pairing: null, baseline: {}, dirty: {}, edit: 0 };
  let loaded;
  let networkQueue = Promise.resolve();
  let mutationQueue = Promise.resolve();
  let syncing = null;
  let connected = false;
  let needsPairing = false;
  let message = 'Pair this browser with ChudPresence Link.';
  let services = [];
  let reported = '';
  let retryAt = 0;
  let capabilities = [];
  let hooks = {};
  let conflict = '';
  let eventPending = false;
  let eventTimer = null;
  const save = () => storage.set({ [LINK_STORAGE_KEY]: structuredClone(data) });
  const mutate = operation => (mutationQueue = mutationQueue.catch(() => {}).then(operation));
  const enqueue = operation => (networkQueue = networkQueue.catch(() => {}).then(operation));

  async function initialize() {
    if (!loaded) loaded = (async () => {
      await prepareNetwork();
      const stored = (await storage.get(LINK_STORAGE_KEY))[LINK_STORAGE_KEY];
      if (stored?.pairing?.token && /^http:\/\/127\.0\.0\.1:\d+$/.test(stored.pairing.endpoint)) {
        data = { pairing: stored.pairing, baseline: stored.baseline || {}, dirty: stored.dirty || {}, edit: stored.edit || 0 };
        for (const edit of Object.values(data.dirty)) {
          edit.edits ||= Object.fromEntries(fieldsOf(edit).map(field => [field, edit.edit]));
        }
        message = 'Reconnecting to ChudPresence Link…';
      }
    })().catch(error => { loaded = null; throw error; });
    return loaded;
  }

  function failed(error) {
    if (!(error instanceof LinkError)) error = new LinkError();
    if (['unauthorized', 'identity_changed', 'incompatible'].includes(error.code)) needsPairing = true;
    if (needsPairing) events.stop();
    if (error.code === 'discord_unavailable' || error.code === 'publisher_busy') connected = true;
    else if (!error.status || needsPairing || error.status >= 500) connected = false;
    message = error.message;
    return error;
  }

  async function raw(endpoint, path, { method = 'GET', body, token, keepalive = false, stream = false,
    controller = new AbortController() } = {}) {
    if (now() < retryAt) throw new LinkError('rate_limited', 429);
    const timeout = schedule(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchRequest(`${endpoint}${path}`, {
        method, mode: 'cors', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', keepalive,
        headers: { Accept: stream ? 'text/event-stream' : 'application/json',
          ...(/^(?:chrome|moz)-extension:\/\/[^/]+$/.test(origin) ? { Origin: origin } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (response.status === 429) retryAt = now() + Math.max(60, Number(response.headers?.get('Retry-After')) || 60) * 1000;
        throw new LinkError(response.status === 401 && path !== '/v1/pair' ? 'unauthorized' : result.error, response.status);
      }
      if (stream) {
        if (!response.body?.getReader || !response.headers?.get('Content-Type')?.startsWith('text/event-stream')) {
          controller.abort();
          throw new LinkError('incompatible');
        }
        return response;
      }
      return response.status === 204 ? null : await response.json();
    } catch (error) {
      throw error instanceof LinkError ? error : new LinkError();
    } finally {
      cancel(timeout);
    }
  }

  async function info(endpoint = data.pairing?.endpoint) {
    const result = await raw(endpoint, '/v1/info');
    if (result.protocolVersion !== 1 || typeof result.serverId !== 'string' || !result.serverId ||
        !Array.isArray(result.capabilities)) throw new LinkError('incompatible');
    return result;
  }

  async function verify() {
    const server = await info();
    if (server.serverId !== data.pairing.serverId) throw new LinkError('identity_changed');
    capabilities = server.capabilities;
    return server;
  }

  const settingsFields = () => capabilities.includes('service-settings-sync') && capabilities.includes('selective-settings-sync')
    ? LINK_SETTING_FIELDS : ['display'];

  function requestSync(revision = false) {
    if (!data.pairing || needsPairing) return;
    if (revision) eventPending = true;
    if (revision && syncing) return;
    if (eventTimer !== null) return;
    eventTimer = schedule(() => {
      eventTimer = null;
      if (syncing) void syncing.finally(() => requestSync()).catch(() => {});
      else void sync().catch(() => {});
    }, 50);
    eventTimer?.unref?.();
  }

  const events = createLinkEvents({ schedule, cancel,
    open: controller => request('/v1/events', { stream: true, controller }),
    onRevision(type, value) {
      if (type === 'revoked') { failed(new LinkError('unauthorized', 401)); return; }
      if (type !== 'revision') return;
      let event;
      try { event = JSON.parse(value); } catch { return; }
      if (event.serverId !== data.pairing?.serverId) { failed(new LinkError('identity_changed')); return; }
      events.received();
      if (Number.isSafeInteger(event.revision) && event.revision >= 0) requestSync(true);
    },
    onError(error) {
      // A closed hint stream alone does not invalidate a healthy desktop
      // lease. Bounded HTTP requests still establish transport availability.
      if (error instanceof LinkError) failed(error);
      return Boolean(data.pairing) && !needsPairing;
    },
  });

  async function request(path, options) {
    await initialize();
    if (!data.pairing || needsPairing) throw new LinkError('unauthorized', 401);
    try {
      // Probe before EVERY authenticated request: never send a saved bearer
      // token to a different process that has taken over the configured port.
      await verify();
      const result = await raw(data.pairing.endpoint, path, { ...options, token: data.pairing.token });
      connected = true;
      message = 'Connected to ChudPresence Link.';
      return result;
    } catch (error) { throw failed(error); }
  }

  async function applySnapshot(snapshot, sent = {}) {
    if (!snapshot?.services || typeof snapshot.services !== 'object' || Array.isArray(snapshot.services)) throw new LinkError('incompatible');
    await mutate(async () => {
      const activities = await hooks.getActivities();
      for (const service of services) {
        if (!service.syncActive) continue;
        const id = service.id;
        const remote = snapshot.services[id];
        if (!remote || !Number.isSafeInteger(remote.version) || remote.version < 1) continue;
        const values = valuesFor(remote, service.syncFields);
        if (!fieldsOf(values).length) continue;
        const activity = activities.find(item => linkServiceId(item.id) === id);
        if (!activity) continue;
        const dirty = data.dirty[id] && structuredClone(data.dirty[id]);
        const patch = {};
        const local = preferenceValues({ ...activity.preferences, enabled: activity.enabled });
        for (const field of fieldsOf(values)) {
          const pending = dirty && Object.hasOwn(dirty, field);
          const acknowledged = pending && sent[id]?.edits?.[field] === dirty.edits[field];
          // Preserve each newer field independently: an artwork edit must not
          // hide a simultaneous remote change to paused visibility.
          if (pending && !acknowledged) continue;
          if (local[field] !== values[field]) patch[field] = values[field];
          if (pending) { delete dirty[field]; delete dirty.edits[field]; }
        }
        if (fieldsOf(patch).length) await hooks.applySettings(activity.id, localPatch(patch));
        // Commit versions and acknowledgements only after local persistence.
        data.baseline[id] = { ...values, version: remote.version, syncFields: [...service.syncFields], syncVersion: service.syncVersion };
        if (dirty && fieldsOf(dirty).length) {
          const ownWrite = sent[id] && !snapshot.conflicts?.includes(id) &&
            fieldsOf(sent[id]).every(field => remote[field] === sent[id][field]);
          if (dirty.baseVersion === null || ownWrite) dirty.baseVersion = remote.version;
          data.dirty[id] = dirty;
        } else delete data.dirty[id];
      }
      if (snapshot.conflicts?.length) conflict = 'A newer choice from Link was kept. You can change the settings again in Settings.';
      await save();
    });
  }

  function discover(discovery, inventory) {
    if (!Array.isArray(discovery?.services)) throw new LinkError('incompatible');
    const own = new Set(inventory.map(item => item.id));
    services = discovery.services.filter(service => own.has(service.id)).map(service => {
      const displayChoices = (service.displayChoices || []).filter(choice => Object.hasOwn(DISPLAY_FROM_LINK, choice));
      const allowed = settingsFields();
      const supportedFields = (service.supportedFields || (displayChoices.length ? ['display'] : []))
        .filter(field => allowed.includes(field));
      return {
        id: service.id, name: String(service.name || service.id).slice(0, 80), shared: service.shared === true,
        syncEnabled: service.syncEnabled === true, syncRequested: service.syncRequested ?? service.syncEnabled === true,
        syncVersion: service.syncVersion, displayChoices, supportedFields,
        syncFields: (service.syncFields || ['display']).filter(field => allowed.includes(field)),
        participants: (service.participants || []).map(peer => ({ deviceId: peer.deviceId,
          name: String(peer.name || 'Device').slice(0, 80), kind: peer.kind, ...valuesFor(peer) })),
      };
    });
  }

  async function reportInventory() {
    const inventory = linkInventory(await hooks.getActivities(), settingsFields());
    const fingerprint = JSON.stringify(inventory);
    if (fingerprint === reported) return null;
    const result = await request('/v1/services', { method: 'PUT', body: { services: inventory } });
    reported = fingerprint;
    return { result, inventory };
  }

  async function syncPass() {
    await initialize();
    if (!data.pairing || needsPairing) return status();
    try {
      await verify();
      // Open before the inventory/settings reads so no desktop edit can fall
      // between the initial snapshot and subscribing to revision hints.
      if (capabilities.includes('settings-change-events')) await events.start();
      else events.stop();
      const report = await reportInventory();
      const inventory = report?.inventory || linkInventory(await hooks.getActivities(), settingsFields());
      discover(report?.result || await request('/v1/services'), inventory);
      const current = await request('/v1/settings');
      if (!current?.services || typeof current.services !== 'object' || Array.isArray(current.services)) throw new LinkError('incompatible');
      for (const service of services) service.syncActive = service.shared && service.syncEnabled &&
        service.syncFields.length > 0 && service.syncFields.every(field => service.supportedFields.includes(field)) &&
        Object.hasOwn(current.services, service.id);
      await mutate(async () => {
        const active = new Set(services.filter(service => service.syncActive).map(service => service.id));
        for (const id of Object.keys(data.dirty)) if (!active.has(id)) delete data.dirty[id];
        for (const [id, edit] of Object.entries(data.dirty)) {
          const service = services.find(service => service.id === id);
          const baseline = data.baseline[id];
          if (baseline?.syncVersion !== undefined && baseline.syncVersion !== service.syncVersion) {
            delete data.dirty[id];
            conflict = 'The sync selection changed. The new shared settings were kept.';
            continue;
          }
          for (const field of fieldsOf(edit)) {
            if (!service.syncFields.includes(field) || field === 'display' && !service.displayChoices.includes(edit.display)) {
              delete edit[field]; delete edit.edits[field];
              conflict = 'That setting is not supported by every linked device or is no longer selected for sync. The shared settings were kept.';
            }
          }
          if (!fieldsOf(edit).length) delete data.dirty[id];
        }
        for (const id of Object.keys(data.baseline)) if (!active.has(id)) delete data.baseline[id];
        await save();
      });
      const sent = structuredClone(data.dirty);
      const changes = Object.fromEntries(Object.entries(sent).filter(([, edit]) => Number.isSafeInteger(edit.baseVersion) && edit.baseVersion > 0)
        .map(([id, edit]) => [id, { ...valuesFor(edit), baseVersion: edit.baseVersion }]));
      const snapshot = Object.keys(changes).length
        ? await request('/v1/settings', { method: 'PATCH', body: { changes } })
        : current;
      // Only edits actually sent may be acknowledged by this response.
      await applySnapshot(snapshot, Object.fromEntries(Object.entries(sent).filter(([id]) => Object.hasOwn(changes, id))));
      // Remote application can change the last-known values offered as a
      // future sync source. Unchanged revision hints never create PUT loops.
      await reportInventory();
      return status();
    } catch (error) { throw failed(error); }
  }

  function sync() {
    if (!syncing) {
      syncing = enqueue(async () => {
        eventPending = false;
        return syncPass();
      }).finally(() => {
        syncing = null;
        // Yield between passes so a busy event stream cannot keep the desktop
        // publisher waiting behind an unbounded settings refresh.
        if (eventPending) requestSync(true);
      });
    }
    return syncing;
  }

  function status() {
    return { paired: Boolean(data.pairing), connected, needsPairing, message,
      deviceName: data.pairing?.name || '', port: Number(data.pairing?.endpoint?.split(':').at(-1)) || LINK_DEFAULT_PORT,
      deviceId: data.pairing?.deviceId || '', services: structuredClone(services),
      selectiveSettings: settingsFields().length > 1,
      pendingChanges: Object.keys(data.dirty).length, conflict };
  }

  return Object.freeze({
    initialize, request, status, sync, inventoryChanged: requestSync,
    configure(value) { hooks = value; },
    ready: () => Boolean(data.pairing) && !needsPairing,
    async pair({ code, name, port = LINK_DEFAULT_PORT }) {
      return enqueue(async () => {
        await initialize();
        if (typeof code !== 'string' || !/^\d{8}$/.test(code) || !Number.isInteger(port) || port < 1 || port > 65535 ||
            typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
          throw new Error('Enter an eight-digit browser code, a device name, and a valid local port.');
        }
        const endpoint = `http://127.0.0.1:${port}`;
        try {
          events.stop();
          const server = await info(endpoint);
          const result = await raw(endpoint, '/v1/pair', { method: 'POST', body: { code, name: name.trim(), kind: 'browser' } });
          if (result.serverId !== server.serverId || result.protocolVersion !== 1 ||
              typeof result.deviceId !== 'string' || !/^[a-f0-9]{64}$/i.test(result.token)) throw new LinkError('incompatible');
          await mutate(async () => {
            data = { pairing: { endpoint, serverId: result.serverId, deviceId: result.deviceId, token: result.token, name: name.trim() },
              baseline: {}, dirty: {}, edit: 0 };
            await save();
          });
          needsPairing = false; connected = true; reported = ''; services = []; conflict = '';
          capabilities = server.capabilities;
          message = 'Connected to ChudPresence Link.';
          return status();
        } catch (error) { throw failed(error); }
      });
    },
    async unpair() {
      return enqueue(async () => {
        events.stop();
        if (eventTimer !== null) cancel(eventTimer);
        eventTimer = null; eventPending = false;
        let revoked = false;
        if (data.pairing && !needsPairing) {
          try { await request('/v1/device', { method: 'DELETE' }); revoked = true; } catch {}
        }
        await mutate(async () => { data = { pairing: null, baseline: {}, dirty: {}, edit: 0 }; await save(); });
        services = []; reported = ''; connected = false; needsPairing = false; conflict = '';
        message = revoked ? 'Browser unlinked.' : 'Unlinked in this browser. Remove it in Link to revoke the offline pairing.';
        return { revoked };
      });
    },
    async setSync({ id, enabled, baseVersion, sourceDeviceId, initialDisplay, fields, initialSettings }) {
      return enqueue(async () => {
        const service = services.find(item => item.id === id);
        const selected = fields ?? ['display'];
        const sources = [sourceDeviceId, initialDisplay, initialSettings].filter(value => value !== undefined && value !== null).length;
        const source = service?.participants.find(peer => peer.deviceId === sourceDeviceId);
        const initial = sourceDeviceId ? source : initialSettings ?? (initialDisplay ? { display: initialDisplay } : {});
        if (!service || !Number.isSafeInteger(baseVersion) || baseVersion !== service.syncVersion || typeof enabled !== 'boolean' ||
            (enabled && (!service.shared || !Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length ||
              !selected.every(field => service.supportedFields.includes(field)) || sources !== 1 || !initial ||
              !selected.every(field => Object.hasOwn(initial, field) && isValue(field, initial[field]) &&
                (field !== 'display' || service.displayChoices.includes(initial[field]))) ||
              (initialSettings !== undefined && !settingsFields().includes('enabled'))))) {
          throw new Error('Refresh the service list, select supported settings, and choose an available starting device.');
        }
        try {
          await request(`/v1/services/${encodeURIComponent(id)}/sync`, { method: 'PUT',
            body: { enabled, baseVersion, ...(enabled ? { ...(fields !== undefined ? { fields: selected } : {}),
              ...(sourceDeviceId ? { sourceDeviceId } : initialSettings !== undefined ? { initialSettings } : { initialDisplay }) } : {}) } });
        } catch (error) {
          await syncPass().catch(() => {});
          throw error;
        }
        return syncPass();
      });
    },
    async editPreference(id, patch, apply) {
      await initialize();
      const result = await mutate(async () => {
        const before = (await hooks.getActivities()).find(item => item.id === id);
        const previous = before ? preferenceValues({ ...before.preferences, enabled: before.enabled }) : {};
        const result = await apply();
        const serviceId = linkServiceId(id);
        const service = services.find(item => item.id === serviceId);
        const baseline = data.baseline[serviceId];
        const allowed = service ? service.syncActive ? service.syncFields : [] : baseline?.syncFields ||
          (baseline ? ['display'] : LINK_SETTING_FIELDS);
        const values = preferenceValues(patch);
        const changed = fieldsOf(values).filter(field => allowed.includes(field) && values[field] !== previous[field]);
        // A saved baseline permits offline edits after a worker restart. Edits
        // during first discovery remain provisional until selected fields and
        // a fresh settings version have been read.
        if (data.pairing && changed.length && (!service || service.syncActive)) {
          const dirty = data.dirty[serviceId] || { baseVersion: baseline?.version ?? null, edits: {} };
          for (const field of changed) { dirty[field] = values[field]; dirty.edits[field] = ++data.edit; }
          data.dirty[serviceId] = dirty;
          conflict = ''; await save();
        }
        return result;
      });
      requestSync();
      return result;
    },
  });
}
