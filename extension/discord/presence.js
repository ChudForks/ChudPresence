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
let pendingUpdateGeneration = 0;
let pendingIntentGeneration = 0;
let intentGeneration = 0;
let retryGeneration = 0;
let initialized = false;
let initializationPromise = null;
let writeQueue = Promise.resolve();
let shutdownCleanup = { state: 'not-armed', reason: '' };
let lastCleanupAttempt = null;
let disconnectWarning = '';
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
    return setStatus('disconnected', disconnectWarning || 'Connect Discord to start sharing your activity.', false);
  }
  return setStatus('connected', `Connected as ${authState.user?.username || 'Discord user'}.`, true);
}

function clearPendingRetry() {
  // Timer callbacks may already be waiting behind an in-flight Discord write.
  // Clearing their handles alone cannot cancel those queued operations.
  retryGeneration += 1;
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

function enqueueScheduledUpdate(intent, applicationId, force, generation) {
  const retry = retryGeneration;
  const isCurrent = () => generation === intentGeneration && retry === retryGeneration;
  if (!isCurrent() || !getAuthState().authenticated) return;
  enqueue(() => isCurrent() ? updateSession(intent, applicationId, force, generation) : currentStatus)
    .then((result) => { if (isCurrent()) currentStatus = result; })
    .catch((error) => {
      // Internal session replacement also cancels retry handles. Its failures
      // still belong to this desired intent and must retain normal recovery.
      currentStatus = handleDeliveryError(error, intent, applicationId, generation);
    });
}

function scheduleUpdate(intent, applicationId, delayMs, generation) {
  pendingUpdate = intent;
  pendingUpdateApplicationId = applicationId || '';
  pendingUpdateGeneration = generation;
  const updateAt = Date.now() + delayMs;
  if (updateTimer && scheduledUpdateAt <= updateAt) return;
  if (updateTimer) clearTimeout(updateTimer);
  scheduledUpdateAt = updateAt;
  updateTimer = setTimeout(() => {
    updateTimer = 0;
    scheduledUpdateAt = 0;
    const next = pendingUpdate;
    const nextApplicationId = pendingUpdateApplicationId;
    const generation = pendingUpdateGeneration;
    // Retain the desired intent while its callback waits in the write queue;
    // a renewal ahead of it must see the same latest correction.
    if (next) enqueueScheduledUpdate(next, nextApplicationId, false, generation);
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
    enqueueScheduledUpdate(intent, applicationId, true, pendingIntentGeneration);
  }, Math.max(0, rateLimitUntil - Date.now()));
}

function handleDeliveryError(error, intent, applicationId, generation = intentGeneration) {
  if (!getAuthState().authenticated) return refreshIdleStatus();
  if (error instanceof DiscordRateLimitError) {
    rateLimitUntil = Math.max(rateLimitUntil, Date.now() + error.retryAfterMs);
  }
  if (generation !== intentGeneration) return currentStatus;
  if (!(error instanceof DiscordRateLimitError)) {
    return setStatus('error', error.message || 'Discord presence update failed.', false);
  }

  pendingIntent = intent;
  pendingApplicationId = applicationId || '';
  pendingIntentGeneration = generation;
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

async function updateSession(intent, applicationId, force = false, generation = intentGeneration) {
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
    scheduleUpdate(intent, applicationId, remaining, generation);
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

  async suspend() {
    intentGeneration += 1;
    clearPendingRetry();
    await this.initialize();
    // Handoff must observe cleanup failures. Ordinary publish(null) instead
    // returns an error status and retains its token for later recovery.
    return enqueue(() => clearSession());
  },

  async connect() {
    await this.initialize();
    setStatus('connecting', 'Finish signing in to Discord to continue…', false);
    try {
      await authorize();
      disconnectWarning = '';
      return refreshIdleStatus();
    } catch (error) {
      setStatus('error', error.message || 'Discord authorization failed.', false);
      throw error;
    }
  },

  async disconnect() {
    intentGeneration += 1;
    await this.initialize();
    return enqueue(async () => {
      let cleanupFailed = false;
      try {
        await clearSession();
      } catch {
        cleanupFailed = true;
      }
      // Keep revocation in the same queue as presence writes. Otherwise a
      // concurrent publish can create a session with credentials about to go.
      await revokeAuthorization();
      clearPendingRetry();
      rateLimitUntil = 0;
      // An explicit disconnect is also the recovery path for broken auth.
      // Unlike routine presence clearing, it must not depend on remote cleanup.
      if (cleanupFailed) {
        sessionToken = '';
        lastIntent = null;
        lastApplicationId = '';
        lastActivityIdentity = '';
        lastSentAt = 0;
        await Promise.all([saveSession(), saveLastIntent()]);
        await disarmShutdownCleanup().catch(() => {});
        shutdownCleanup = { state: 'not-armed', reason: '' };
      }
      disconnectWarning = cleanupFailed
        ? 'Disconnected from Discord. The last activity could not be removed and may remain visible until its session expires. You can connect again.'
        : '';
      return refreshIdleStatus();
    });
  },

  async publish(intent, applicationId = '', { closing = false } = {}) {
    const generation = ++intentGeneration;
    await this.initialize();
    try {
      return await enqueue(() => (
        intent ? updateSession(intent, applicationId, false, generation) : clearSession({ keepalive: closing })
      ));
    } catch (error) {
      return intent
        ? handleDeliveryError(error, intent, applicationId, generation)
        : setStatus('error', error.message || 'Discord presence update failed.', false);
    }
  },

  async renew() {
    const generation = intentGeneration;
    let intent = null;
    let applicationId = '';
    await this.initialize();
    try {
      return await enqueue(() => {
        if (generation !== intentGeneration) return currentStatus;
        if (!getAuthState().authenticated) return refreshIdleStatus();
        // Renew the newest waiting intent so confirming a renewal cannot
        // discard an unsent correction when it cancels pending timers.
        if (pendingIntent && pendingIntentGeneration === generation) {
          intent = pendingIntent;
          applicationId = pendingApplicationId;
        } else if (pendingUpdate && pendingUpdateGeneration === generation) {
          intent = pendingUpdate;
          applicationId = pendingUpdateApplicationId;
        } else {
          intent = lastIntent;
          applicationId = lastApplicationId;
        }
        if (!intent) return clearSession();
        return updateSession(intent, applicationId, true, generation);
      });
    } catch (error) {
      return handleDeliveryError(error, intent, applicationId, generation);
    }
  },

  async getSetup() {
    return { clientId: getClientId(), redirectUrl: await getRedirectUrl(), ...getAuthState() };
  },
});
