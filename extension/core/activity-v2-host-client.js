// Service-worker side of the private offscreen host channel. Guest workers see
// an opaque key and JSON only; their installed ownership capability stays here.
import { acquireActivitySandboxDocument, releaseActivitySandboxDocument } from '../discord/shutdown-cleanup.js';
export class ActivityV2HostClient {
  constructor({ api, onRequest, onFailure, acquireDocument, releaseDocument } = {}) {
    this.api = api;
    this.onRequest = onRequest;
    this.onFailure = onFailure;
    this.acquireDocument = acquireDocument;
    this.releaseDocument = releaseDocument;
    this.sessions = new Map();
    this.failedContexts = new Map();
    this.port = null;
    this.waiters = new Set();
    api?.runtime?.onConnect?.addListener(port => this.connect(port));
  }

  connect(port) {
    if (port?.name !== 'chudpresence-v2-host' || port.sender?.tab ||
        port.sender?.url !== this.api.runtime.getURL('discord-cleanup.html')) return false;
    if (this.port && this.port !== port) { try { this.port.disconnect(); } catch {} }
    this.port = port;
    for (const resolve of this.waiters) resolve(port);
    this.waiters.clear();
    port.onMessage.addListener(message => { void this.receive(port, message); });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      for (const session of [...this.sessions.values()]) {
        this.stop(session.key);
        void this.onFailure(session, 'Activity sandbox host disconnected.');
      }
    });
    return true;
  }

  async documentLease(key, acquire) {
    if (acquire && this.acquireDocument) return this.acquireDocument(key);
    if (!acquire && this.releaseDocument) return this.releaseDocument(key);
    return acquire ? acquireActivitySandboxDocument(key) : releaseActivitySandboxDocument(key);
  }

  waitForPort() {
    if (this.port) return Promise.resolve(this.port);
    return new Promise((resolve, reject) => {
      const done = port => { clearTimeout(timer); resolve(port); };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new Error('Activity sandbox host did not connect.'));
      }, 5000);
      this.waiters.add(done);
    });
  }

  async update({ identity, sender, source, snapshot }) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
        new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 262144) {
      throw new TypeError('Activity page snapshot is missing or exceeds 256 KiB.');
    }
    const context = `${identity.activityId}:${sender.tab.id}:${sender.frameId}:${sender.documentId}`;
    const failed = this.failedContexts.get(context);
    if (failed?.capability === identity.capability) throw new Error('Activity sandbox failed. Reload the Activity to try again.');
    this.failedContexts.delete(context);
    let session = [...this.sessions.values()].find(entry => entry.context === context);
    if (session && session.identity.capability !== identity.capability) { this.stop(session.key); session = null; }
    if (!session) {
      if (this.sessions.size >= 16) throw new Error('The Activity sandbox session limit has been reached.');
      session = { key: globalThis.crypto.randomUUID(), context, identity, sender, source };
      this.sessions.set(session.key, session);
    }
    session.sender = sender;
    try {
      await this.documentLease(session.key, true);
      const port = await this.waitForPort();
      if (this.sessions.get(session.key) !== session) return { accepted: false };
      port.postMessage({ type: 'update', key: session.key, ...(!session.sourceSent ? { source: session.source } : {}), snapshot });
      session.sourceSent = true;
      return { accepted: true };
    } catch (error) { this.stop(session.key); throw error; }
  }

  async receive(port, message) {
    if (port !== this.port) return;
    const session = this.sessions.get(message?.key);
    if (!session) return;
    if (message.type === 'error') {
      this.failedContexts.set(session.context, { capability: session.identity.capability,
        id: session.identity.activityId, tabId: session.sender.tab.id });
      while (this.failedContexts.size > 128) this.failedContexts.delete(this.failedContexts.keys().next().value);
      this.stop(session.key);
      await this.onFailure(session, String(message.message || 'Activity sandbox failed.').slice(0, 240));
      return;
    }
    if (message.type !== 'request' || !Number.isSafeInteger(message.requestId) || message.requestId < 1 ||
        !['presence.report', 'presence.clear', 'settings.get', 'settings.getAll', 'storage.get',
          'storage.set', 'storage.remove', 'storage.clear', 'net.fetch', 'log.write'].includes(message.operation)) return;
    let response;
    try { response = await this.onRequest(session, message.operation, message.payload); }
    catch { response = { ok: false, error: { message: 'Activity request failed.' } }; }
    if (this.port !== port || this.sessions.get(session.key) !== session) return;
    try {
      port.postMessage({ type: 'response', key: session.key, requestId: message.requestId,
        ok: response?.ok === true, ...(response?.ok === true ? { data: response.data }
          : { error: 'Activity request was rejected by the broker.' }) });
    } catch { this.stop(session.key); }
  }

  stop(key) {
    if (!this.sessions.delete(key)) return;
    try { this.port?.postMessage({ type: 'stop', key }); } catch {}
    void this.documentLease(key, false).catch(() => {});
  }

  stopActivity(id) {
    for (const session of [...this.sessions.values()]) if (session.identity.activityId === id) this.stop(session.key);
    for (const [context, failure] of this.failedContexts) if (failure.id === id) this.failedContexts.delete(context);
  }

  stopContext(id, tabId, documentId) {
    for (const session of [...this.sessions.values()]) {
      if (session.identity.activityId === id && session.sender.tab.id === tabId && session.sender.documentId === documentId) this.stop(session.key);
    }
  }

  stopTab(tabId) {
    for (const session of [...this.sessions.values()]) if (session.sender.tab.id === tabId) this.stop(session.key);
    for (const [context, failure] of this.failedContexts) if (failure.tabId === tabId) this.failedContexts.delete(context);
  }
}
