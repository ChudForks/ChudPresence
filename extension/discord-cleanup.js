const PORT_NAME = 'discord-shutdown-cleanup';
const DELETE_ENDPOINT = 'https://discord.com/api/v10/users/@me/headless-sessions/delete';

let cleanupAbort = null;
let cleanupRequest = null;
let activePort = null;

function reportCleanup(state, httpStatus = null) {
  try {
    activePort?.postMessage({ type: 'CLEANUP_EVENT', state, httpStatus });
  } catch {
    // Shutdown can disconnect the worker before this diagnostic arrives.
  }
}

function reply(port, requestId, result) {
  port.postMessage({ replyTo: requestId, ...result });
}

function disarm() {
  cleanupAbort?.abort();
  cleanupAbort = null;
  cleanupRequest = null;
}

function arm(accessToken, sessionToken) {
  if (typeof accessToken !== 'string' || !accessToken || typeof sessionToken !== 'string' || !sessionToken) {
    return { ok: false, error: 'Missing Discord cleanup credentials.' };
  }

  const body = new Blob([JSON.stringify({ token: sessionToken })], { type: 'application/json' });
  const request = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  };
  // Keep an immediate document-exit fallback even when deferred fetch is
  // unavailable or cannot reserve quota. No storage or worker message is
  // needed to start this request during browser shutdown.
  cleanupRequest = request;
  if (typeof globalThis.fetchLater !== 'function') {
    return { ok: true, armed: true, supported: false, reason: 'unsupported' };
  }

  const nextAbort = new AbortController();
  try {
    globalThis.fetchLater(DELETE_ENDPOINT, {
      ...request,
      signal: nextAbort.signal,
    });
  } catch (error) {
    nextAbort.abort();
    const reason = ['QuotaExceededError', 'TypeError', 'NotAllowedError'].includes(error?.name) ? error.name : 'Error';
    return { ok: true, armed: true, supported: false, reason };
  }

  // Keep the previous request armed until its replacement is known to exist.
  cleanupAbort?.abort();
  cleanupAbort = nextAbort;
  return { ok: true, armed: true, supported: true };
}

globalThis.addEventListener('pagehide', () => {
  if (!cleanupRequest) return;
  const request = cleanupRequest;
  cleanupRequest = null;
  // Leave the deferred request armed as a second chance until a normal
  // cleanup has confirmed deletion. Both requests target the same session.
  try {
    const deletion = fetch(DELETE_ENDPOINT, { ...request, keepalive: true });
    reportCleanup('started');
    void deletion.then((response) => {
      reportCleanup(response.ok ? 'confirmed' : 'failed', response.status);
    }).catch(() => reportCleanup('failed'));
  } catch {
    reportCleanup('failed');
    // The worker's persisted session token remains available for a retry.
  }
});

function connect() {
  const port = chrome.runtime.connect({ name: PORT_NAME });
  activePort = port;

  port.onMessage.addListener((message) => {
    const requestId = message?.requestId;
    if (!requestId) return;

    if (message.type === 'ARM') {
      reply(port, requestId, arm(message.accessToken, message.sessionToken));
      return;
    }

    if (message.type === 'DISARM') {
      disarm();
      reply(port, requestId, { ok: true, supported: typeof globalThis.fetchLater === 'function' });
    }
  });

  port.onDisconnect.addListener(() => {
    if (activePort === port) activePort = null;
    setTimeout(connect, 250);
  });
}

connect();
