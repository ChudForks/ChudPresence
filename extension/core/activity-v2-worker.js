// This dedicated extension worker never receives browser capabilities or Discord
// credentials. Only the embedded QuickJS guest evaluates Activity source.
import './activity-v2-engine.generated.js';

const { createActivityV2Sandbox, ACTIVITY_V2_SANDBOX_LIMITS: limits } = globalThis.ChudPresenceV2Engine;
const requests = new Map();
let sandbox = null;
let key = null;
let initializing = false;
let ended = false;
let sequence = 0;

function post(type, fields = {}) {
  if (!ended) globalThis.postMessage({ type, key, ...fields });
}

function fail() {
  if (ended) return;
  post('error', { message: 'Activity sandbox worker stopped after an execution or resource error.' });
  ended = true;
  try { sandbox?.dispose(); } catch { /* The host will terminate this worker. */ }
  requests.clear();
}

function update(snapshot, turnId) {
  if (ended || !sandbox) return;
  try {
    if (sandbox.update(snapshot) !== true) { fail(); return; }
    post('updated', { turnId });
  } catch { fail(); }
}

function request(operation, payload) {
  if (ended || requests.size >= limits.pendingRequests || sequence >= Number.MAX_SAFE_INTEGER) {
    return Promise.reject(new Error('Activity worker request limit reached.'));
  }
  const requestId = ++sequence;
  return new Promise((resolve, reject) => {
    requests.set(requestId, { resolve, reject });
    post('request', { requestId, operation, payload });
  });
}

globalThis.addEventListener('message', event => {
  const message = event.data;
  if (ended || !message || typeof message !== 'object') return;
  if (message.type === 'init') {
    if (initializing || sandbox || typeof message.key !== 'string' || !message.key || message.key.length > 200) { fail(); return; }
    key = message.key;
    initializing = true;
    void createActivityV2Sandbox({ source: message.source, request, onError: fail }).then(created => {
      if (ended) { created.dispose(); return; }
      sandbox = created;
      initializing = false;
      post('ready');
      update(message.snapshot, message.turnId);
    }).catch(fail);
    return;
  }
  if (message.key !== key) return;
  if (message.type === 'update') {
    if (initializing) { fail(); return; }
    update(message.snapshot, message.turnId);
    return;
  }
  if (message.type === 'response') {
    const entry = requests.get(message.requestId);
    if (!entry) return;
    requests.delete(message.requestId);
    if (message.ok === true) entry.resolve(message.data);
    else entry.reject(new Error('Activity request was rejected by the broker.'));
    // Resolving the host promise resumes QuickJS in native microtasks. The host
    // watchdog stays armed until those microtasks return and this task can run.
    setTimeout(() => post('updated', { turnId: message.turnId }), 0);
  }
});

globalThis.addEventListener('messageerror', fail);
