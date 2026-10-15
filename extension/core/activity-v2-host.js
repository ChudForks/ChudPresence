// The offscreen document hosts trusted worker plumbing only. Activity source
// remains data here and is executed solely in the worker's QuickJS guest.
const PORT_NAME = 'chudpresence-v2-host';
const MAX_SESSIONS = 16;
const SOURCE_BYTES = 512 * 1024;
const JSON_BYTES = 256 * 1024;
const STARTUP_MS = 5_000;
const EXECUTION_MS = 2_000;
const INACTIVITY_MS = 120_000;
const sessions = new Map();
const encoder = new TextEncoder();
let port = null;
let reconnectTimer = null;

function post(message) {
  try { port?.postMessage(message); } catch { /* The disconnect handler disposes workers. */ }
}

function validKey(key) { return typeof key === 'string' && key.length > 0 && key.length <= 200; }

function validSnapshot(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' && text.length <= JSON_BYTES && encoder.encode(text).byteLength <= JSON_BYTES;
  } catch { return false; }
}

function stop(key, message = null) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  for (const timer of session.watchdogs.values()) clearTimeout(timer);
  clearTimeout(session.inactivity);
  session.worker.terminate();
  if (message) post({ type: 'error', key, message });
}

function watch(session, startup = false) {
  const turnId = ++session.sequence;
  session.watchdogs.set(turnId, setTimeout(() => {
    stop(session.key, 'Activity sandbox worker exceeded its execution deadline.');
  }, startup ? STARTUP_MS : EXECUTION_MS));
  return turnId;
}

function touch(session) {
  clearTimeout(session.inactivity);
  session.inactivity = setTimeout(() => {
    stop(session.key, 'Activity sandbox worker stopped after inactivity.');
  }, INACTIVITY_MS);
}

function sendUpdate(session, snapshot) {
  session.busy = true;
  session.updateTurnId = watch(session);
  session.worker.postMessage({ type: 'update', key: session.key, turnId: session.updateTurnId, snapshot });
}

function create(message) {
  const { key, source, snapshot } = message;
  if (sessions.size >= MAX_SESSIONS) {
    post({ type: 'error', key, message: 'The Activity sandbox session limit has been reached.' });
    return;
  }
  if (typeof source !== 'string' || source.length > SOURCE_BYTES || encoder.encode(source).byteLength > SOURCE_BYTES) {
    post({ type: 'error', key, message: 'Activity sandbox source is missing or exceeds its size limit.' });
    return;
  }
  let worker;
  try { worker = new Worker(new URL('./activity-v2-worker.js', import.meta.url), { type: 'module', name: 'Activity API V2' }); }
  catch { post({ type: 'error', key, message: 'Activity sandbox worker could not be created.' }); return; }
  const session = { key, worker, busy: true, queued: undefined, watchdogs: new Map(), sequence: 0,
    updateTurnId: null, inactivity: null, requests: new Set() };
  sessions.set(key, session);
  worker.addEventListener('message', event => {
    if (sessions.get(key) !== session) return;
    const response = event.data;
    if (!response || response.key !== key) { stop(key, 'Activity sandbox worker sent an invalid message.'); return; }
    if (response.type === 'error') { stop(key, 'Activity sandbox worker stopped after an execution or resource error.'); return; }
    if (response.type === 'request') {
      if (!Number.isSafeInteger(response.requestId) || response.requestId < 1 || typeof response.operation !== 'string'
        || session.requests.has(response.requestId) || session.requests.size >= 16) {
        stop(key, 'Activity sandbox worker sent an invalid request.'); return;
      }
      session.requests.add(response.requestId);
      post({ type: 'request', key, requestId: response.requestId, operation: response.operation, payload: response.payload });
      return;
    }
    if (response.type === 'ready') { post({ type: 'ready', key }); return; }
    if (response.type === 'updated') {
      if (!session.watchdogs.has(response.turnId)) return;
      clearTimeout(session.watchdogs.get(response.turnId));
      session.watchdogs.delete(response.turnId);
      post({ type: 'updated', key });
      if (response.turnId !== session.updateTurnId) return;
      session.updateTurnId = null;
      session.busy = false;
      if (session.queued !== undefined) {
        const snapshot = session.queued;
        session.queued = undefined;
        sendUpdate(session, snapshot);
      }
    }
  });
  worker.addEventListener('error', event => {
    event.preventDefault();
    stop(key, 'Activity sandbox worker failed.');
  });
  worker.addEventListener('messageerror', () => stop(key, 'Activity sandbox worker message could not be read.'));
  session.updateTurnId = watch(session, true);
  touch(session);
  worker.postMessage({ type: 'init', key, turnId: session.updateTurnId, source, snapshot });
}

function receive(message) {
  if (!message || !validKey(message.key)) return;
  const { key } = message;
  if (message.type === 'stop') { stop(key); return; }
  if (message.type === 'response') {
    const session = sessions.get(key);
    if (!session || !Number.isSafeInteger(message.requestId) || !session.requests.delete(message.requestId)) return;
    const turnId = watch(session);
    // The worker receives only the result of an already authorized request.
    session.worker.postMessage({ type: 'response', key, turnId, requestId: message.requestId, ok: message.ok === true,
      ...(message.ok === true ? { data: message.data } : {}) });
    return;
  }
  if (message.type !== 'update') return;
  if (!validSnapshot(message.snapshot)) {
    if (sessions.has(key)) stop(key, 'Activity snapshot exceeds its JSON size limit.');
    else post({ type: 'error', key, message: 'Activity snapshot exceeds its JSON size limit.' });
    return;
  }
  const session = sessions.get(key);
  if (!session) { create(message); return; }
  touch(session);
  if (session.busy) session.queued = message.snapshot;
  else sendUpdate(session, message.snapshot);
}

function connect() {
  reconnectTimer = null;
  try {
    const next = chrome.runtime.connect({ name: PORT_NAME });
    port = next;
    next.onMessage.addListener(message => { if (port === next) receive(message); });
    next.onDisconnect.addListener(() => {
      if (port !== next) return;
      port = null;
      for (const key of [...sessions.keys()]) stop(key);
      reconnectTimer = setTimeout(connect, 250);
    });
  } catch { reconnectTimer = setTimeout(connect, 250); }
}

globalThis.addEventListener('pagehide', () => {
  clearTimeout(reconnectTimer);
  for (const key of [...sessions.keys()]) stop(key);
  const previous = port;
  port = null;
  try { previous?.disconnect(); } catch { /* The extension is shutting down. */ }
});

connect();
