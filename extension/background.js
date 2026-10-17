import { browserApi, isFirefox } from './platform/browser-api.js';
import { migratePlatformSettings } from './platform/migration.js';
import { selectActivity } from './core/activity.js';
import { ActivityRegistry } from './core/activity-registry.js';
import { createForegroundTracker } from './core/foreground.js';
import { ActivityManager, sanitizeDiagnosticValue } from './core/activity-manager.js';
import { registerActivityRestoreHandlers } from './core/activity-restore.js';
import {
  ensureBundledYouTubeInstalled,
  rememberBundledYouTubeRemoval,
} from './core/default-activity.js';
import { shouldInvalidateActivityTab, shouldRetireActivityTab } from './core/tab-lifecycle.js';
import { createPresenceIntent } from './core/presence.js';
import { createPresenceClearDelay } from './core/presence-clear-delay.js';
import {
  applicationIdForPresence,
  DEFAULT_SETTINGS,
  isTrackAllowed,
  LEGACY_APPLICATION_ID_SETTINGS,
  LEGACY_DETAIL_SETTINGS,
  RETIRED_PROVIDER_SETTINGS,
  normalizeSettings,
  presenceDetailsForTrack,
} from './core/settings.js';
import { presencePublisher } from './platform/presence-publisher.js';
import { EXTENSION_NAME } from './core/branding.js';

const activityRegistry = new ActivityRegistry();
const navigationClears = new Map();
const ACTIVITY_PRUNE_ALARM = 'activity-prune-stale';
let activeTabId = null;
let activityStateReady = !isFirefox;
let activityReady = null;
function ensureActivityReady() {
  if (activityStateReady) return Promise.resolve();
  if (!activityReady) {
    activityReady = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await Promise.all([loadSettings(), activityManager.load()]);
          activityStateReady = true;
          return;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
    })().catch(error => { activityReady = null; throw error; });
  }
  return activityReady;
}
const activityManager = new ActivityManager({
  sessionContext: {
    registry: activityRegistry,
    getActiveTab: () => activeTabId,
    setActiveTab: (tabId) => { activeTabId = tabId; },
  },
  onAttention({ tabId, documentId, focused }) {
    foreground.setPageFocus(tabId, documentId, focused);
  },
  onReport({ tabId, documentId, frameId, track }) {
    cancelNavigationClears(null, tabId, null, frameId);
    activityRegistry.update(tabId, documentId, track, frameId);
    void activityManager.checkpointSession?.();
    schedulePublish();
  },
  onClear(activityId, tabId, documentId, frameId, { closing = false, navigationGraceMs = 0 } = {}) {
    if (closing && navigationGraceMs > 0 && deferNavigationClear(activityId, tabId, documentId, frameId, navigationGraceMs)) return;
    cancelNavigationClears(activityId, tabId, documentId, frameId);
    const known = activityRegistry.clearActivity(activityId, tabId, documentId, frameId);
    if (!known) return;
    if (typeof tabId === 'number') clearActiveTab(tabId);
    void activityManager.checkpointSession?.();
    if (closing) publishCurrentActivity({ closing: true });
    else schedulePublish();
  },
});
let defaultInstallPromise = null;
function ensureDefaultYouTube() {
  if (defaultInstallPromise) return defaultInstallPromise;
  defaultInstallPromise = ensureBundledYouTubeInstalled({
    manager: activityManager,
    storage: chrome.storage.local,
    api: chrome,
  }).finally(() => { defaultInstallPromise = null; });
  return defaultInstallPromise;
}
let settings = { ...DEFAULT_SETTINGS };
let delivery = presencePublisher.status();
let pushTimer = 0;
const transientClear = createPresenceClearDelay(() => publishCurrentActivity());
function hasForegroundReports() {
  return [...activityRegistry.entries.values()].some(frames =>
    [...frames.values()].some(entry => entry.track?.focusPolicy === 'foreground'));
}
const foreground = createForegroundTracker({
  api: chrome,
  documentForTab: tabId => activityRegistry.entries.get(tabId)?.get(0)?.documentId,
  onChange() {
    // Reevaluate retained foreground reports immediately, bypassing playback's
    // debounce/clear grace. Do not discard them just because focus moved.
    if (!activityStateReady) {
      void ensureActivityReady().then(() => {
        if (hasForegroundReports()) void publishCurrentActivity();
      }).catch(() => {});
    } else if (hasForegroundReports()) void publishCurrentActivity();
  },
});

registerActivityRestoreHandlers({
  runtime: chrome.runtime,
  manager: activityManager,
  afterInstallRestore: ensureDefaultYouTube,
  beforeInstallRestore: async () => {
    await migratePlatformSettings(chrome);
    const stored = await chrome.storage.local.get(null);
    await chrome.storage.local.set(normalizeSettings(stored));
    await chrome.storage.local.remove([
      'bridgeUrl',
      'discordClientId',
      ...LEGACY_APPLICATION_ID_SETTINGS,
      ...LEGACY_DETAIL_SETTINGS,
      ...RETIRED_PROVIDER_SETTINGS,
    ]);
    // Chrome clears registered user scripts on an extension update.
  },
});

async function loadSettings() {
  await migratePlatformSettings(chrome);
  settings = normalizeSettings(await chrome.storage.local.get(null));
  if (!settings.enabled) discardNavigationClears();
}

function cancelNavigationClears(activityId = null, tabId = null, documentId = null, frameId = null) {
  for (const [key, pending] of navigationClears) {
    if (activityId !== null && pending.activityId !== activityId ||
        typeof tabId === 'number' && pending.tabId !== tabId ||
        documentId !== null && documentId !== undefined && pending.documentId !== documentId ||
        Number.isInteger(frameId) && pending.frameId !== frameId) continue;
    clearTimeout(pending.timer);
    navigationClears.delete(key);
  }
}

function discardNavigationClears() {
  for (const pending of navigationClears.values()) {
    activityRegistry.clearActivity(pending.activityId, pending.tabId, pending.documentId, pending.frameId);
  }
  cancelNavigationClears();
}

function deferNavigationClear(activityId, tabId, documentId, frameId, graceMs) {
  if (!activityRegistry.hasActivity(activityId, tabId, documentId, frameId)) return false;
  const key = JSON.stringify([activityId, tabId, documentId, frameId]);
  if (navigationClears.has(key)) return true; // Repeated signals cannot extend the deadline.
  const pending = { activityId, tabId, documentId, frameId };
  pending.timer = setTimeout(() => {
    navigationClears.delete(key);
    // clearDocument checks ownership, so an expired old document cannot erase
    // a newer report. The grace has already elapsed; do not add another delay.
    onDocumentGone(tabId, documentId, { closing: true, frameId });
  }, Math.min(5000, graceMs));
  navigationClears.set(key, pending);
  return true;
}

function currentTrack() {
  const eligible = activityRegistry.tracks((track, tabId) => foreground.allows(tabId, track) && isTrackAllowed(
    track,
    settings,
    track?.activityId ? activityManager.preferencesFor(track.activityId) : null,
  ));
  const selected = selectActivity(eligible, activeTabId);
  activeTabId = selected.tabId;
  return selected.track;
}

function localPresenceIntent(track) {
  return createPresenceIntent(
    track,
    Date.now(),
    presenceDetailsForTrack(
      track,
      settings,
      track?.activityId ? activityManager.preferencesFor(track.activityId) : null,
    ),
  );
}

function diagnosticForState(installed, track) {
  const selected = installed.find((record) => record.id === track?.activityId)
    || [...installed].sort((left, right) =>
      Date.parse(right.lastReport?.timestamp || right.lastClear?.timestamp || 0) -
      Date.parse(left.lastReport?.timestamp || left.lastClear?.timestamp || 0))[0];
  return {
    activityId: selected?.id || null,
    visibility: selected?.normalizedReport?.visibility || track?.visibility || null,
    playbackState: selected?.normalizedReport?.playback?.state || track?.playback?.state || null,
    lastReport: selected?.lastReport || null,
    lastClear: selected?.lastClear || null,
  };
}

function setAction(track) {
  const title = track?.media?.title || track?.title || '';
  const creator = track?.media?.artist || track?.media?.creator || track?.artist || '';
  const suffix = creator ? ` — ${creator}` : '';
  chrome.action.setTitle({ title: title ? `${title}${suffix}` : EXTENSION_NAME });
}

async function publishCurrentActivity({ closing = false, delayClear = false } = {}) {
  if (!activityStateReady) await ensureActivityReady();
  const track = currentTrack();
  void activityManager.checkpointSession?.();
  setAction(track);
  const intent = localPresenceIntent(track);
  if (!intent && delayClear && !closing) {
    transientClear.defer();
    return;
  }
  transientClear.cancel();
  const applicationId = applicationIdForPresence();
  delivery = await presencePublisher.publish(intent, applicationId, { closing });
}

async function connectDiscord() {
  delivery = await presencePublisher.connect();
  await publishCurrentActivity();
  return delivery;
}

async function disconnectDiscord() {
  delivery = await presencePublisher.disconnect();
  return delivery;
}

function schedulePublish() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = 0;
    publishCurrentActivity({ delayClear: true });
  }, 250);
}

function clearActiveTab(tabId) {
  if (activeTabId === tabId) activeTabId = null;
}

function pingRemaining() {
  for (const [tabId, track] of activityRegistry.tracks()) {
    // Activity user scripts receive messages through their own runtime channel.
    // A failed content-script ping is not evidence that an Activity tab closed.
    if (track?.activityId) continue;
    chrome.tabs.sendMessage(tabId, { type: 'FORCE_TICK' }).catch(() => {
      activityRegistry.clearTab(tabId);
      clearActiveTab(tabId);
      schedulePublish();
    });
  }
}

function onTabGone(tabId, { closing = false, retireDocuments = true, removed = false } = {}) {
  if (!activityStateReady) {
    void ensureActivityReady().then(() => onTabGone(tabId, { closing, retireDocuments, removed })).catch(() => {});
    return;
  }
  if (typeof tabId !== 'number') return;
  cancelNavigationClears(null, tabId);
  // Capture ownership before invalidateTab synchronously invokes onClear.
  // Otherwise that callback can consume the report and bypass immediate close.
  const known = activityRegistry.clearTab(tabId);
  clearActiveTab(tabId);
  activityManager.invalidateTab(tabId, { retireDocuments, removed }).catch(() => {});
  void activityManager.checkpointSession?.();
  if (!known) return;
  pingRemaining();
  publishCurrentActivity({ closing, delayClear: !closing });
}

function onDocumentGone(tabId, documentId, { closing = false, frameId = null } = {}) {
  if (!activityStateReady) {
    void ensureActivityReady().then(() => onDocumentGone(tabId, documentId, { closing, frameId })).catch(() => {});
    return;
  }
  if (typeof tabId !== 'number') return;
  const known = activityRegistry.clearDocument(tabId, documentId, frameId);
  if (!known) return;
  clearActiveTab(tabId);
  void activityManager.checkpointSession?.();
  pingRemaining();
  publishCurrentActivity({ closing, delayClear: !closing });
}

async function handleActivityLibraryMessage(message) {
  if (message.type === 'ACTIVITY_LIBRARY_STATE') {
    await ensureDefaultYouTube().catch(() => {});
    const state = await activityManager.status();
    const track = currentTrack();
    return {
      ...state,
      activityDiagnostics: diagnosticForState(state.installed, track),
      finalPresenceIntent: sanitizeDiagnosticValue(localPresenceIntent(track)),
    };
  }
  if (message.type === 'ACTIVITY_INSTALL') {
    const result = await activityManager.install(message.activityPackage);
    schedulePublish();
    return result;
  }
  if (message.type === 'ACTIVITY_REMOVE') {
    await defaultInstallPromise?.catch(() => {});
    const removed = await activityManager.remove(message.id);
    if (removed && message.id === 'youtube') {
      await rememberBundledYouTubeRemoval(chrome.storage.local);
    }
    publishCurrentActivity();
    return { removed };
  }
  if (message.type === 'ACTIVITY_RELOAD') {
    const result = await activityManager.reload(message.id);
    schedulePublish();
    return result;
  }
  if (message.type === 'ACTIVITY_SET_ENABLED') {
    const result = await activityManager.setEnabled(message.id, Boolean(message.enabled));
    publishCurrentActivity();
    return result;
  }
  if (message.type === 'ACTIVITY_SET_PREFERENCES') {
    const result = await activityManager.setPreferences(message.id, message.preferences);
    publishCurrentActivity();
    return result;
  }
  if (message.type === 'ACTIVITY_SET_SETTING') {
    return activityManager.setActivitySetting(message.id, message.settingId, message.value);
  }
  if (message.type === 'ACTIVITY_CLEAR_DIAGNOSTICS') {
    if (Object.hasOwn(message, 'id') && message.id !== null && typeof message.id !== 'string') {
      throw new TypeError('A valid Activity ID is required to clear its diagnostics.');
    }
    return activityManager.clearDiagnostics(message.id ?? null);
  }
  if (message.type === 'ACTIVITY_RESTORE') return activityManager.restoreAll();
  return null;
}

function handleUserScriptMessage(message, sender, sendResponse) {
  if (!activityStateReady) {
    ensureActivityReady().then(() => handleUserScriptMessage(message, sender, sendResponse))
      .catch(() => sendResponse({ ok: false, error: { code: 'runtime_error', message: 'Activity session restoration failed.' } }));
    return true;
  }
  activityManager.handleUserScriptMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      ok: false,
      error: { code: 'runtime_error', message: String(error?.message || 'Activity request failed.') },
    }));
  // Chrome requires the channel to stay open for an asynchronous response.
  return true;
}

function handleUserScriptConnect(port) {
  if (!activityStateReady) {
    void ensureActivityReady().then(() => handleUserScriptConnect(port)).catch(() => {});
    return;
  }
  void activityManager.handleUserScriptConnect(port);
}

function registerUserScriptMessageListener() {
  try {
    const event = chrome.runtime.onUserScriptMessage;
    if (event?.addListener && !event.hasListener?.(handleUserScriptMessage)) {
      event.addListener(handleUserScriptMessage);
    }
  } catch {
    // Chrome may hide this event while Allow User Scripts is off.
  }
}

function registerUserScriptConnectListener() {
  try {
    const event = chrome.runtime.onUserScriptConnect;
    if (event?.addListener && !event.hasListener?.(handleUserScriptConnect)) {
      event.addListener(handleUserScriptConnect);
    }
  } catch {
    // Chrome may hide this event while Allow User Scripts is off.
  }
}

registerUserScriptMessageListener();
registerUserScriptConnectListener();

function handleRuntimeMessage(message, sender, sendResponse) {
  if (!activityStateReady) {
    ensureActivityReady().then(() => handleRuntimeMessage(message, sender, sendResponse))
      .catch(() => sendResponse({ ok: false, error: 'Activity session restoration failed. Reload the extension to retry.' }));
    return true;
  }
  const privilegedDiscordMessage = [
    'GET_DISCORD_SETUP',
    'CONNECT_DISCORD',
    'DISCONNECT_DISCORD',
  ].includes(message?.type);
  const sentByExtensionPage = String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (privilegedDiscordMessage && !sentByExtensionPage) {
    sendResponse({ ok: false, error: 'Discord account controls are only available on extension pages.' });
    return false;
  }

  const libraryMessage = [
    'ACTIVITY_LIBRARY_STATE',
    'ACTIVITY_INSTALL',
    'ACTIVITY_REMOVE',
    'ACTIVITY_RELOAD',
    'ACTIVITY_SET_ENABLED',
    'ACTIVITY_SET_PREFERENCES',
    'ACTIVITY_SET_SETTING',
    'ACTIVITY_CLEAR_DIAGNOSTICS',
    'ACTIVITY_RESTORE',
  ].includes(message?.type);
  if (libraryMessage) {
    if (!sentByExtensionPage) {
      sendResponse({ ok: false, error: 'Activity controls are only available on extension pages.' });
      return false;
    }
    handleActivityLibraryMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not update the Activity Library.' }));
    return true;
  }

  if (message?.type === 'TRACK_UPDATE') {
    const tabId = sender.tab?.id;
    activityRegistry.update(tabId, sender.documentId, message.track, sender.frameId);
    schedulePublish();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'TAB_CLOSING') {
    onDocumentGone(sender.tab?.id, sender.documentId, { closing: true, frameId: sender.frameId });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'HEARTBEAT') {
    const tabId = sender.tab?.id;
    activityRegistry.heartbeat(tabId, sender.documentId, message.track, sender.frameId);
    schedulePublish();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'GET_STATE') {
    if (!sentByExtensionPage) {
      sendResponse({ ok: false, error: 'State diagnostics are only available on extension pages.' });
      return false;
    }
    activityManager.status().then((state) => {
      delivery = presencePublisher.status();
      const track = currentTrack();
      sendResponse({
        settings,
        delivery,
        track,
        activityDiagnostics: diagnosticForState(state.installed, track),
        finalPresenceIntent: sanitizeDiagnosticValue(localPresenceIntent(track)),
      });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_DISCORD_SETUP') {
    presencePublisher.initialize()
      .then(async () => sendResponse({ ok: true, setup: await presencePublisher.setup(), delivery: presencePublisher.status() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'CONNECT_DISCORD') {
    connectDiscord()
      .then(async () => sendResponse({ ok: true, delivery, setup: await presencePublisher.setup() }))
      .catch((error) => sendResponse({ ok: false, error: error.message, delivery: presencePublisher.status() }));
    return true;
  }

  if (message?.type === 'DISCONNECT_DISCORD') {
    disconnectDiscord()
      .then(async () => sendResponse({ ok: true, delivery, setup: await presencePublisher.setup() }))
      .catch((error) => sendResponse({ ok: false, error: error.message, delivery: presencePublisher.status() }));
    return true;
  }

  if (message?.type === 'SET_ENABLED') {
    settings.enabled = Boolean(message.enabled);
    if (!settings.enabled) discardNavigationClears();
    chrome.storage.local.set({ enabled: settings.enabled });
    publishCurrentActivity()
      .then(() => sendResponse({ ok: true, settings }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
}
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'foreground-popup') {
    if (port.sender?.url !== chrome.runtime.getURL('popup.html') || port.sender?.tab) return;
    port.onMessage.addListener(message => {
      if (Number.isInteger(message?.windowId) && message.windowId >= 0 && typeof message.focused === 'boolean') {
        foreground.setPopupFocus(port, message.windowId, message.focused);
      }
    });
    port.onDisconnect.addListener(() => foreground.setPopupFocus(port, null, null));
    return;
  }
  if (port.name !== 'presence') return;
  const tabId = port.sender?.tab?.id;
  const documentId = port.sender?.documentId;
  const frameId = port.sender?.frameId;
  if (typeof tabId === 'number' && !activityRegistry.has(tabId)) {
    chrome.tabs.sendMessage(tabId, { type: 'FORCE_TICK' }).catch(() => {});
  }
  port.onDisconnect.addListener(() => {
    if (typeof tabId !== 'number') return;
    chrome.tabs.get(tabId)
      .then((tab) => {
        if (!tab || tab.discarded) onTabGone(tabId, { closing: true });
        else onDocumentGone(tabId, documentId, { frameId });
      })
      .catch(() => onTabGone(tabId, { closing: true, removed: true }));
  });
});

chrome.tabs.onRemoved.addListener((tabId) => onTabGone(tabId, { closing: true, removed: true }));

function handleTabUpdated(tabId, changeInfo) {
  if (!activityStateReady) {
    void ensureActivityReady().then(() => handleTabUpdated(tabId, changeInfo)).catch(() => {});
    return;
  }
  // A loading update can accompany a player or route change in the same
  // document. Its report remains valid until that document ends or is replaced.
  if (shouldInvalidateActivityTab(changeInfo)) {
    onTabGone(tabId, { retireDocuments: shouldRetireActivityTab(changeInfo) });
  }
  if (changeInfo?.url) {
    // A same-document SPA route can enter an Activity's match pattern without
    // giving Chrome a new document in which to run the registered user script.
    // Run this even alongside a loading update: Hulu can report its route
    // transition that way while retaining the document that needs injection.
    activityManager.injectMatchingTab(tabId, changeInfo.url).catch(() => {});
  }
}
chrome.tabs.onUpdated.addListener(handleTabUpdated);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const relevant = Object.keys(changes).some((key) => key in DEFAULT_SETTINGS);
  if (!relevant) return;
  loadSettings().then(publishCurrentActivity);
});

function handleAlarm(alarm) {
  if (!activityStateReady) {
    void ensureActivityReady().then(() => handleAlarm(alarm)).catch(() => {});
    return;
  }
  if (alarm.name === ACTIVITY_PRUNE_ALARM) {
    activityManager.pruneStale().catch(() => {});
    return;
  }
  if (alarm.name !== 'discord-presence-renew') return;
  if (isFirefox) {
    // A renewal can be the first event after a long idle period. Apply the
    // restored report timestamps before renewing a saved Discord intent.
    activityManager.pruneStale().then(async (cleared) => {
      if (cleared || hasForegroundReports()) await publishCurrentActivity();
      else delivery = await presencePublisher.renew();
    }).catch(() => {});
    return;
  }
  if (hasForegroundReports()) {
    void publishCurrentActivity();
    return;
  }
  presencePublisher.renew().then((result) => {
    delivery = result;
  });
}
chrome.alarms.onAlarm.addListener(handleAlarm);

chrome.permissions?.onRemoved?.addListener(() => {
  activityManager.restoreAll().catch(() => {});
});

chrome.permissions?.onAdded?.addListener(() => {
  registerUserScriptMessageListener();
  registerUserScriptConnectListener();
  activityManager.restoreAll().then(ensureDefaultYouTube).catch(() => {});
});

chrome.alarms.create(ACTIVITY_PRUNE_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });

// A service worker can start for a message without an onStartup event. Restore
// independently of Discord initialization so a network/auth failure cannot
// prevent installed Activities from resuming.
if (isFirefox) {
  ensureActivityReady().then(() => activityManager.restoreAll()).then(ensureDefaultYouTube).catch(() => {});
} else {
  loadSettings().catch(() => {});
  activityManager.restoreAll().then(ensureDefaultYouTube).catch(() => {});
}
presencePublisher.initialize().then(() => {
  delivery = presencePublisher.status();
}).catch(() => {});
