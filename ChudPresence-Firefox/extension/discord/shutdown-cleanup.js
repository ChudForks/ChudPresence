// Firefox MV3 uses an event page. Unloading/suspending that page is not evidence
// that a browsing document closed: never delete a Discord session on its unload.
// Shared tab/document close handling publishes {closing:true}, which retains the
// authenticated fetch keepalive deletion and confirmed-deletion token policy.
const leases = new Set();
let hostFrame = null;

export async function ensureCleanupDocument() {
  if (hostFrame?.isConnected) return;
  if (!globalThis.document?.body) throw new Error('The Firefox background page is unavailable.');
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = chrome.runtime.getURL('discord-cleanup.html');
  frame.title = 'Activity sandbox host';
  // The frame owns trusted worker plumbing. Guest code receives JSON and an
  // opaque session key only, with no Discord credentials or installed capability.
  document.body.append(frame);
  hostFrame = frame;
}

export async function acquireActivitySandboxDocument(key) {
  if (typeof key !== 'string' || !key || key.length > 256) throw new TypeError('Activity sandbox document lease requires a bounded string key.');
  leases.add(key);
  try { await ensureCleanupDocument(); }
  catch (error) { leases.delete(key); throw error; }
}

export async function releaseActivitySandboxDocument(key) {
  // Retain the idle frame while this event page exists. It contains no cleanup
  // request; keeping it cannot clear active presence during normal suspension.
  return leases.delete(key);
}

export function onShutdownCleanup() {}
export async function armShutdownCleanup() {
  // No fetchLater/offscreen fallback exists in Firefox. Do not retain tokens in
  // this module or share them with the Activity worker host.
  return { armed: false, deferred: false, reason: 'unsupported' };
}
export async function disarmShutdownCleanup() {}
