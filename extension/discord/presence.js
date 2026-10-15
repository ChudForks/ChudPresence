import {
  authorize,
  DiscordRateLimitError,
  discordRequest,
  getAccessToken,
  getAuthState,
  getClientId,
  getRedirectUrl,
  initializeAuth,
  revokeAuthorization,
} from './auth.js';
import { buildHeadlessActivity } from './activity-builder.js';
import { armShutdownCleanup, disarmShutdownCleanup, onShutdownCleanup } from './shutdown-cleanup.js';

const SESSION_STORAGE_KEY = 'discordHeadlessSession';
const LAST_INTENT_STORAGE_KEY = 'discordLastIntent';
const CLEANUP_DIAGNOSTIC_STORAGE_KEY = 'discordCleanupDiagnostic';
export const RENEW_ALARM = 'discord-presence-renew';
const ABSOLUTE_MIN_UPDATE_INTERVAL_MS = 4_200;
const MIN_UPDATE_INTERVAL_MS = 12_000;

let sessionToken = '';
let lastIntent = null;
let lastApplicationId = '';
let lastActivityIdentity = '';
let lastSentAt = 0;
let rateLimitUntil = 0;
let rateLimitTimer = 0;
let scheduledRateLimitUntil = 0;
let pendingIntent = null;
let pendingApplicationId = '';
let updateTimer = 0;
let scheduledUpdateAt = 0;
let pendingUpdate = null;
let pendingUpdateApplicationId = '';
let initialized = false;
let initializationPromise = null;
let writeQueue = Promise.resolve();
let shutdownCleanup = { state: 'not-armed', reason: '' };
let lastCleanupAttempt = null;
let currentStatus = {
  id: 'discord-headless',
  available: false,
  state: 'starting',
  message: 'Starting the experimental Discord transport…',
};

function recordCleanupAttempt(state, source = 'worker', httpStatus = null) {
  lastCleanupAttempt = {
    state, source, timestamp: Date.now(),
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
  };
  // Diagnostics must never delay or prevent the request during shutdown.
  void chrome.storage.local.set({ [CLEANUP_DIAGNOSTIC_STORAGE_KEY]: lastCleanupAttempt }).catch(() => {});
}

onShutdownCleanup(({ state, httpStatus }) => recordCleanupAttempt(state, 'document', httpStatus));

function setStatus(state, message, available = false) {
  currentStatus = {
    id: 'discord-headless',
    available,
    state,
    message,
    ...getAuthState(),
    shutdownCleanup,
    lastCleanupAttempt,
  };
  return currentStatus;
}

function refreshIdleStatus() {
  const authState = getAuthState();
  if (!authState.configured) {
    return setStatus('configuration-required', 'Discord connection is unavailable in this build.', false);
  }
  if (!authState.authenticated) {
    return setStatus('disconnected', 'Connect Discord to start sharing your activity.', false);
  }
  return setStatus('connected', `Connected as ${authState.user?.username || 'Discord user'}.`, true);
}

function clearPendingRetry() {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = 0;
  scheduledUpdateAt = 0;
  pendingUpdate = null;
  pendingUpdateApplicationId = '';
  pendingIntent = null;
  pendingApplicationId = '';
  if (rateLimitTimer) clearTimeout(rateLimitTimer);
  rateLimitTimer = 0;
  scheduledRateLimitUntil = 0;
}

function scheduleUpdate(intent, applicationId, delayMs) {
  pendingUpdate = intent;
  pendingUpdateApplicationId = applicationId || '';
  const updateAt = Date.now() + delayMs;
  if (updateTimer && scheduledUpdateAt <= updateAt) return;
  if (updateTimer) clearTimeout(updateTimer);
  scheduledUpdateAt = updateAt;
  updateTimer = setTimeout(() => {
    updateTimer = 0;
    scheduledUpdateAt = 0;
    const next = pendingUpdate;
    const nextApplicationId = pendingUpdateApplicationId;
    pendingUpdate = null;
    pendingUpdateApplicationId = '';
    if (!next || !getAuthState().authenticated) return;
    enqueue(() => updateSession(next, nextApplicationId))
      .then((result) => { currentStatus = result; })
      .catch((error) => { currentStatus = handleDeliveryError(error, next, nextApplicationId); });
  }, delayMs);
}

function timingChanged(intent) {
  return ['start', 'end'].some((field) => {
    const previous = lastIntent?.timestamps?.[field];
    const next = intent.timestamps?.[field];
    return (previous == null) !== (next == null) ||
      (previous != null && next != null && Math.abs(next - previous) >= 3);
  });
}

function retryDelayMessage(delayMs) {
  return `${Math.max(1, Math.ceil(delayMs / 1_000))} seconds`;
}

function scheduleRateLimitRetry() {
  if (!pendingIntent) return;
  if (rateLimitTimer && scheduledRateLimitUntil >= rateLimitUntil) return;
  if (rateLimitTimer) clearTimeout(rateLimitTimer);

  scheduledRateLimitUntil = rateLimitUntil;
  rateLimitTimer = setTimeout(() => {
    rateLimitTimer = 0;
    scheduledRateLimitUntil = 0;
    if (!pendingIntent || !getAuthState().authenticated) return;

    const intent = pendingIntent;
    const applicationId = pendingApplicationId;
    enqueue(() => updateSession(intent, applicationId, true))
      .then((result) => {
        currentStatus = result;
      })
      .catch((error) => {
        currentStatus = handleDeliveryError(error, intent, applicationId);
      });
  }, Math.max(0, rateLimitUntil - Date.now()));
}

function handleDeliveryError(error, intent, applicationId) {
  if (!(error instanceof DiscordRateLimitError)) {
    return setStatus('error', error.message || 'Discord presence update failed.', false);
  }

  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + error.retryAfterMs);
  pendingIntent = intent;
  pendingApplicationId = applicationId || '';
  scheduleRateLimitRetry();
  return setStatus(
    'rate-limited',
    `Discord is rate limiting presence updates. Retrying in ${retryDelayMessage(rateLimitUntil - Date.now())}.`,
    false,
  );
}

function activityIdentity(activity) {
  if (!activity) return '';
  const { timestamps, ...stable } = activity;
  void timestamps;
  return JSON.stringify(stable);
}

async function saveSession() {
  if (sessionToken) await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessionToken });
  else await chrome.storage.local.remove(SESSION_STORAGE_KEY);
}

async function saveLastIntent() {
  if (lastIntent) {
    await chrome.storage.session.set({
      [LAST_INTENT_STORAGE_KEY]: { intent: lastIntent, applicationId: lastApplicationId },
    });
  }
  else await chrome.storage.session.remove(LAST_INTENT_STORAGE_KEY);
}

async function armCurrentShutdownCleanup() {
  if (!sessionToken || !getAuthState().authenticated) return false;
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch {
    shutdownCleanup = { state: 'unavailable', reason: 'authentication' };
    return false;
  }
  try {
    const result = await armShutdownCleanup(accessToken, sessionToken);
    shutdownCleanup = {
      state: !result.armed ? 'unavailable' : result.deferred ? 'deferred' : 'exit-fallback',
      reason: result.reason,
    };
    return result.armed;
  } catch {
    shutdownCleanup = { state: 'unavailable', reason: 'document' };
    return false;
  }
}

async function updateSession(intent, applicationId, force = false) {
  if (!getAuthState().authenticated) return refreshIdleStatus();
  if (rateLimitUntil > Date.now()) {
    throw new DiscordRateLimitError(rateLimitUntil - Date.now());
  }
  const activity = buildHeadlessActivity(intent, applicationId || getClientId());
  if (!activity) return clearSession();

  const identity = activityIdentity(activity);
  const interval = identity === lastActivityIdentity && !timingChanged(intent)
    ? MIN_UPDATE_INTERVAL_MS : ABSOLUTE_MIN_UPDATE_INTERVAL_MS;
  const remaining = interval - (Date.now() - lastSentAt);
  if (!force && remaining > 0) {
    // Keep the latest correction even if a background tab has no further events.
    scheduleUpdate(intent, applicationId, remaining);
    return currentStatus;
  }

  const body = { activities: [activity] };
  if (sessionToken) body.token = sessionToken;
  let result;
  try {
    result = await discordRequest('/users/@me/headless-sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!body.token || error instanceof DiscordRateLimitError) throw error;
    // An update error does not prove the existing session is gone. Delete it
    // successfully before creating a replacement that would lose its token.
    await clearSession();
    result = await discordRequest('/users/@me/headless-sessions', {
      method: 'POST',
      body: JSON.stringify({ activities: [activity] }),
    });
  }

  sessionToken = result?.token || sessionToken;
  lastIntent = intent;
  lastApplicationId = applicationId || '';
  lastActivityIdentity = identity;
  lastSentAt = Date.now();
  clearPendingRetry();
  await Promise.all([saveSession(), saveLastIntent()]);
  await armCurrentShutdownCleanup().catch(() => false);
  return setStatus('active', `Sharing activity as ${getAuthState().user?.username || 'your Discord account'}.`, true);
}

async function clearSession({ keepalive = false } = {}) {
  clearPendingRetry();
  if (!sessionToken && !lastIntent && !lastActivityIdentity) {
    await disarmShutdownCleanup().catch(() => {});
    return refreshIdleStatus();
  }
  lastIntent = null;
  lastApplicationId = '';
  lastActivityIdentity = '';
  lastSentAt = 0;
  const token = sessionToken;
  if (token) recordCleanupAttempt('started');
  // Start the network request before waiting on storage: browser-close
  // callbacks may have only a short time left in their initiating context.
  const deletion = !token ? Promise.resolve() : !getAuthState().authenticated
    ? Promise.reject(new Error('Connect Discord to finish deleting the previous presence session.'))
    : discordRequest('/users/@me/headless-sessions/delete', {
      method: 'POST',
      // Firefox 133+ can keep this authenticated request alive after the last
      // source document starts closing. It is deliberately limited to cleanup:
      // normal presence writes should not outlive their initiating context.
      keepalive,
      body: JSON.stringify({ token }),
    });
  const confirmedDeletion = deletion.then(() => {
    if (token) recordCleanupAttempt('confirmed');
  }, (error) => {
    if (token) recordCleanupAttempt('failed', 'worker', error?.status);
    throw error;
  });
  await Promise.all([confirmedDeletion, saveLastIntent()]);
  if (token) {
    // Keep the token persisted and shutdown cleanup armed until Discord
    // confirms deletion, so a failed request can be retried after a restart.
    sessionToken = '';
    await saveSession();
  }
  await disarmShutdownCleanup().catch(() => {});
  shutdownCleanup = { state: 'not-armed', reason: '' };
  return refreshIdleStatus();
}

function enqueue(operation) {
  writeQueue = writeQueue.catch(() => {}).then(operation);
  return writeQueue;
}

async function loadPersistedSession() {
  await initializeAuth();
  const stored = await chrome.storage.local.get([SESSION_STORAGE_KEY, CLEANUP_DIAGNOSTIC_STORAGE_KEY]);
  const transient = await chrome.storage.session.get(LAST_INTENT_STORAGE_KEY);
  sessionToken = String(stored[SESSION_STORAGE_KEY] || '');
  const savedCleanup = stored[CLEANUP_DIAGNOSTIC_STORAGE_KEY];
  if (savedCleanup && ['started', 'confirmed', 'failed'].includes(savedCleanup.state)) {
    lastCleanupAttempt = {
      state: savedCleanup.state,
      source: savedCleanup.source === 'document' ? 'document' : 'worker',
      timestamp: Number(savedCleanup.timestamp) || 0,
      httpStatus: Number.isInteger(savedCleanup.httpStatus) ? savedCleanup.httpStatus : null,
    };
  }
  const savedPresence = transient[LAST_INTENT_STORAGE_KEY] || null;
  if (savedPresence?.intent) {
    lastIntent = savedPresence.intent;
    lastApplicationId = String(savedPresence.applicationId || '');
  } else {
    // Migrate the pre-service-profile session shape.
    lastIntent = savedPresence;
    lastApplicationId = '';
  }
  await chrome.alarms.create(RENEW_ALARM, { periodInMinutes: 10 });
  await armCurrentShutdownCleanup().catch(() => false);
  initialized = true;
  return refreshIdleStatus();
}

export const discordPresence = Object.freeze({
  async initialize() {
    if (initializationPromise) return initializationPromise;
    if (initialized) return currentStatus;
    initializationPromise = loadPersistedSession().finally(() => {
      initializationPromise = null;
    });
    return initializationPromise;
  },

  status() {
    return { ...currentStatus, shutdownCleanup, lastCleanupAttempt };
  },

  async connect() {
    await this.initialize();
    setStatus('connecting', 'Finish signing in to Discord to continue…', false);
    try {
      await authorize();
      return refreshIdleStatus();
    } catch (error) {
      setStatus('error', error.message || 'Discord authorization failed.', false);
      throw error;
    }
  },

  async disconnect() {
    await this.initialize();
    return enqueue(async () => {
      await clearSession();
      // Keep revocation in the same queue as presence writes. Otherwise a
      // concurrent publish can create a session with credentials about to go.
      await revokeAuthorization();
      return refreshIdleStatus();
    });
  },

  async publish(intent, applicationId = '', { closing = false } = {}) {
    await this.initialize();
    try {
      return await enqueue(() => (
        intent ? updateSession(intent, applicationId) : clearSession({ keepalive: closing })
      ));
    } catch (error) {
      return intent
        ? handleDeliveryError(error, intent, applicationId)
        : setStatus('error', error.message || 'Discord presence update failed.', false);
    }
  },

  async renew() {
    await this.initialize();
    try {
      return await enqueue(() => {
        if (!getAuthState().authenticated) return refreshIdleStatus();
        if (!lastIntent) return clearSession();
        return updateSession(lastIntent, lastApplicationId, true);
      });
    } catch (error) {
      return handleDeliveryError(error, lastIntent, lastApplicationId);
    }
  },

  async getSetup() {
    return { clientId: getClientId(), redirectUrl: await getRedirectUrl(), ...getAuthState() };
  },
});
