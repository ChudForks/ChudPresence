const DOCUMENT_PATH = 'discord-cleanup.html';
const DOCUMENT_URL = globalThis.chrome?.runtime?.getURL(DOCUMENT_PATH) || '';
const PORT_NAME = 'discord-shutdown-cleanup';
const RESPONSE_TIMEOUT_MS = 3_000;

let cleanupPort = null;
let documentOperation = Promise.resolve();
let nextRequestId = 1;
const connectionWaiters = new Set();
const pendingResponses = new Map();
const cleanupObservers = new Set();
const activitySandboxLeases = new Set();

function serializeDocumentOperation(operation) {
  const result = documentOperation.then(operation);
  documentOperation = result.catch(() => {});
  return result;
}

export function onShutdownCleanup(listener) {
  cleanupObservers.add(listener);
}

function rejectPendingResponses(message) {
  for (const { reject, timer } of pendingResponses.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pendingResponses.clear();
}

globalThis.chrome?.runtime?.onConnect?.addListener((port) => {
  if (port.name !== PORT_NAME || port.sender?.url !== DOCUMENT_URL) return;

  cleanupPort = port;
  for (const resolve of connectionWaiters) resolve(port);
  connectionWaiters.clear();

  port.onMessage.addListener((message) => {
    if (message?.type === 'CLEANUP_EVENT' && ['started', 'confirmed', 'failed'].includes(message.state)) {
      const httpStatus = Number.isInteger(message.httpStatus) && message.httpStatus >= 100 && message.httpStatus <= 599
        ? message.httpStatus : null;
      for (const observer of cleanupObservers) observer({ state: message.state, httpStatus });
      return;
    }
    const pending = pendingResponses.get(message?.replyTo);
    if (!pending) return;
    pendingResponses.delete(message.replyTo);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message);
    else pending.reject(new Error(message.error || 'Discord cleanup command failed.'));
  });

  port.onDisconnect.addListener(() => {
    if (cleanupPort !== port) return;
    cleanupPort = null;
    rejectPendingResponses('Discord cleanup document disconnected.');
  });
});

async function hasCleanupDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [DOCUMENT_URL],
  });
  return contexts.length > 0;
}

export function ensureCleanupDocument() {
  return serializeDocumentOperation(async () => {
    if (await hasCleanupDocument()) return;
    await chrome.offscreen.createDocument({
      url: DOCUMENT_PATH,
      reasons: ['BLOBS', 'WORKERS'],
      justification: 'Keep deferred Discord cleanup with a Blob request body and run isolated Activity sandbox workers.',
    });
  });
}

export async function acquireActivitySandboxDocument(key) {
  if (typeof key !== 'string' || !key || key.length > 256) throw new TypeError('Activity sandbox document lease requires a bounded string key.');
  activitySandboxLeases.add(key);
  try { await ensureCleanupDocument(); }
  catch (error) { activitySandboxLeases.delete(key); throw error; }
}

export function releaseActivitySandboxDocument(key) {
  // Keep the shared document alive after the last sandbox exits: a restarted
  // service worker may not know whether its Discord shutdown fallback is armed.
  // A normal Discord disarm can close an idle document safely.
  return activitySandboxLeases.delete(key);
}

function waitForCleanupPort() {
  if (cleanupPort) return Promise.resolve(cleanupPort);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connectionWaiters.delete(onConnect);
      reject(new Error('Discord cleanup document did not connect.'));
    }, RESPONSE_TIMEOUT_MS);
    const onConnect = (port) => {
      clearTimeout(timer);
      resolve(port);
    };
    connectionWaiters.add(onConnect);
  });
}

async function sendCommand(command) {
  await ensureCleanupDocument();
  const port = await waitForCleanupPort();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResponses.delete(requestId);
      reject(new Error('Discord cleanup command timed out.'));
    }, RESPONSE_TIMEOUT_MS);
    pendingResponses.set(requestId, { resolve, reject, timer });
    try {
      port.postMessage({ ...command, requestId });
    } catch (error) {
      clearTimeout(timer);
      pendingResponses.delete(requestId);
      reject(error);
    }
  });
}

export async function armShutdownCleanup(accessToken, sessionToken) {
  const result = await sendCommand({ type: 'ARM', accessToken, sessionToken });
  // The document also owns a pagehide/keepalive fallback. Closing it when
  // fetchLater is unsupported would send cleanup while presence is active.
  return {
    armed: result.armed === true,
    deferred: result.supported === true,
    reason: ['unsupported', 'QuotaExceededError', 'TypeError', 'NotAllowedError', 'Error'].includes(result.reason)
      ? result.reason : '',
  };
}

export async function disarmShutdownCleanup() {
  if (!await hasCleanupDocument()) return;
  try {
    await sendCommand({ type: 'DISARM' });
  } finally {
    await serializeDocumentOperation(async () => {
      if (activitySandboxLeases.size || !await hasCleanupDocument()) return;
      // Acquisition marks a lease before entering this queue. Check again
      // after getContexts so no live worker is closed while that read awaits.
      if (!activitySandboxLeases.size) await chrome.offscreen.closeDocument();
    });
  }
}
