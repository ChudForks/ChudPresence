// Session storage survives event-page suspension and resets on browser restart.
// Only report ownership is checkpointed; OAuth/session credentials and package
// source are never read or copied by this module.
const STORAGE_KEY = 'firefoxActivitySession';
const MAX_CONTEXTS = 2048;
const MAX_ACTIVITIES = 256;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TRACK_BYTES = 20 * 1024;
const REPORT_FIELDS = ['kind', 'media', 'playback', 'display', 'artwork', 'buttons', 'visibility', 'focusPolicy'];
const states = new WeakMap();

function stateFor(manager) {
  if (!states.has(manager)) states.set(manager, { restore: null, writes: Promise.resolve() });
  return states.get(manager);
}

function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function documentId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null; }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function senderLocation(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? `${url.origin}${url.pathname}`.slice(0, 8192) : '';
  } catch { return ''; }
}
function currentRecord(manager, id, version, capability) {
  const record = manager.records?.[id];
  return record?.enabled === true && record.metadata?.id === id &&
    record.metadata.version === version && record.capability === capability &&
    /^[a-f0-9]{64}$/.test(capability || '') ? record : null;
}

function reportTrack(value, record) {
  if (!plain(value) || value.activityId !== record.metadata.id ||
      value.activityVersion !== record.metadata.version || typeof value.kind !== 'string' ||
      !plain(value.media) || !plain(value.playback)) return null;
  try {
    const report = Object.fromEntries(REPORT_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
    const json = JSON.stringify(report);
    if (new TextEncoder().encode(json).byteLength > MAX_TRACK_BYTES) return null;
    return { ...JSON.parse(json), source: 'activity', activityId: record.metadata.id,
      activityVersion: record.metadata.version, activityName: record.metadata.name,
      activityCategory: record.metadata.category || 'other' };
  } catch { return null; }
}

function capture(manager) {
  const registry = manager.sessionContext?.registry;
  const snapshot = { schemaVersion: 1, activeTabId: manager.sessionContext?.getActiveTab?.() ?? null,
    sequence: integer(registry?.sequence) ? registry.sequence : 0,
    removedTabs: [...(manager.removedTabs || [])].filter(integer).slice(-1024), activities: [], registry: [] };
  let count = 0;
  for (const [id, tabs] of manager.lastSeen || []) {
    const installed = manager.records?.[id];
    const record = currentRecord(manager, id, installed?.metadata?.version, installed?.capability);
    if (!record || snapshot.activities.length >= MAX_ACTIVITIES) continue;
    const activity = { id, version: record.metadata.version, capability: record.capability, contexts: [] };
    for (const [tabId, frames] of tabs) {
      if (!integer(tabId) || manager.removedTabs?.has(tabId)) continue;
      for (const [frameId, context] of frames) {
        if (++count > MAX_CONTEXTS) throw new RangeError('Firefox Activity session exceeds its context limit.');
        if (!integer(frameId) || !plain(context) || !Number.isFinite(context.lastSeen) || context.lastSeen < 0) continue;
        const track = reportTrack(context.track, record);
        if (context.active !== false && !track) continue;
        activity.contexts.push({ tabId, frameId, documentId: documentId(context.documentId),
          lastDocumentId: documentId(context.lastDocumentId), parentFrameId: integer(context.parentFrameId) ? context.parentFrameId : null,
          senderUrl: senderLocation(context.senderUrl),
          lastSeen: context.lastSeen, active: context.active !== false, track,
          retiredDocumentIds: [...(context.retiredDocumentIds || [])].filter(value => documentId(value)).slice(-32) });
      }
    }
    if (activity.contexts.length) snapshot.activities.push(activity);
  }
  const owners = new Map(snapshot.activities.flatMap(activity => activity.contexts
    .filter(context => context.active && context.documentId)
    .map(context => [`${activity.id}:${context.tabId}:${context.frameId}:${context.documentId}`, activity])));
  for (const [tabId, frames] of registry?.entries || []) {
    for (const [frameId, entry] of frames) {
      const owner = owners.get(`${entry.track?.activityId}:${tabId}:${frameId}:${entry.documentId}`);
      if (!owner || !integer(entry.sequence)) continue;
      const track = reportTrack(entry.track, manager.records[owner.id]);
      if (track) snapshot.registry.push({ tabId, frameId, documentId: entry.documentId, sequence: entry.sequence, track });
    }
  }
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError('Firefox Activity session exceeds its size limit.');
  }
  return snapshot;
}

async function restore(manager) {
  const storage = manager.api?.storage?.session;
  const registry = manager.sessionContext?.registry;
  if (!storage?.get || !registry) return false;
  const snapshot = (await storage.get(STORAGE_KEY))?.[STORAGE_KEY];
  if (!plain(snapshot) || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.activities) ||
      snapshot.activities.length > MAX_ACTIVITIES || !Array.isArray(snapshot.registry) ||
      snapshot.registry.length > MAX_CONTEXTS) return false;
  if (snapshot.activities.reduce((count, activity) => count + (Array.isArray(activity?.contexts) ? activity.contexts.length : 0), 0) > MAX_CONTEXTS) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) return false;
  } catch { return false; }
  // Tab IDs are unique within the browser session. Retain the manager's existing
  // closed-tab guard so queued sandbox/service requests cannot recreate a VM
  // after a later suspension has discarded the in-memory tombstones.
  for (const tabId of (Array.isArray(snapshot.removedTabs) ? snapshot.removedTabs : []).slice(-1024)) {
    if (integer(tabId)) manager.removedTabs.add(tabId);
  }
  while (manager.removedTabs.size > 1024) manager.removedTabs.delete(manager.removedTabs.values().next().value);
  const owners = new Map();
  let count = 0;
  const now = Date.now();
  for (const activity of snapshot.activities) {
    if (!plain(activity) || !Array.isArray(activity.contexts)) continue;
    const record = currentRecord(manager, activity.id, activity.version, activity.capability);
    if (!record) continue;
    for (const context of activity.contexts) {
      if (++count > MAX_CONTEXTS) return false;
      if (!plain(context) || !integer(context.tabId) || !integer(context.frameId) ||
          manager.removedTabs?.has(context.tabId) || !Number.isFinite(context.lastSeen) || context.lastSeen < 0 ||
          typeof context.senderUrl !== 'string' || context.senderUrl.length > 8192) continue;
      const track = reportTrack(context.track, record);
      if (context.active !== false && (!track || !documentId(context.documentId))) continue;
      const restored = { tabId: context.tabId, frameId: context.frameId,
        documentId: documentId(context.documentId), lastDocumentId: documentId(context.lastDocumentId),
        parentFrameId: integer(context.parentFrameId) ? context.parentFrameId : null,
        // Keep the original freshness deadline. A clock rollback must not make
        // a restored report immune to stale pruning for an arbitrary duration.
        senderUrl: senderLocation(context.senderUrl), lastSeen: Math.min(context.lastSeen, now), active: context.active !== false, track,
        retiredDocumentIds: new Set((Array.isArray(context.retiredDocumentIds) ? context.retiredDocumentIds : [])
          .filter(value => documentId(value)).slice(-32)) };
      if (!manager.lastSeen.has(activity.id)) manager.lastSeen.set(activity.id, new Map());
      const tabs = manager.lastSeen.get(activity.id);
      if (!tabs.has(context.tabId)) tabs.set(context.tabId, new Map());
      tabs.get(context.tabId).set(context.frameId, restored);
      if (restored.active) owners.set(`${activity.id}:${context.tabId}:${context.frameId}:${restored.documentId}`, record);
    }
  }
  for (const entry of snapshot.registry) {
    if (!plain(entry) || !integer(entry.tabId) || !integer(entry.frameId) || !integer(entry.sequence)) continue;
    const record = owners.get(`${entry.track?.activityId}:${entry.tabId}:${entry.frameId}:${entry.documentId}`);
    const track = record && reportTrack(entry.track, record);
    if (!track) continue;
    if (!registry.entries.has(entry.tabId)) registry.entries.set(entry.tabId, new Map());
    registry.entries.get(entry.tabId).set(entry.frameId, { documentId: entry.documentId, frameId: entry.frameId, sequence: entry.sequence, track });
    registry.sequence = Math.max(registry.sequence || 0, entry.sequence);
  }
  if (integer(snapshot.sequence)) registry.sequence = Math.max(registry.sequence || 0, snapshot.sequence);
  manager.sessionContext.setActiveTab?.(integer(snapshot.activeTabId) && registry.has(snapshot.activeTabId) ? snapshot.activeTabId : null);
  return true;
}

export function restoreActivitySession(manager) {
  const state = stateFor(manager);
  if (!state.restore) state.restore = restore(manager).catch(error => { state.restore = null; throw error; });
  return state.restore;
}

export function saveActivitySession(manager) {
  // Capture immediately: a later queued write must not observe newer mutable
  // Maps and overwrite a removal with an older report snapshot.
  let snapshot;
  try { snapshot = capture(manager); } catch (error) { return Promise.reject(error); }
  const storage = manager.api?.storage?.session;
  if (!storage?.set) return Promise.resolve(false);
  const state = stateFor(manager);
  const write = state.writes.catch(() => {}).then(async () => {
    await storage.set({ [STORAGE_KEY]: snapshot });
    return true;
  });
  state.writes = write;
  return write;
}
