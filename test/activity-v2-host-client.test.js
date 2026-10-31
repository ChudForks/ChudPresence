import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityV2HostClient } from '../extension/core/activity-v2-host-client.js';

const url = 'chrome-extension://extension-id/discord-cleanup.html';
function fixture() {
  const sent = [];
  const requests = [];
  const failures = [];
  const leases = new Set();
  const port = { name: 'chudpresence-v2-host', sender: { url },
    postMessage(message) { sent.push(message); },
    onMessage: { addListener() {} }, onDisconnect: { addListener(callback) { port.disconnect = callback; } } };
  const client = new ActivityV2HostClient({
    api: { runtime: { getURL() { return url; }, onConnect: { addListener() {} } } },
    async acquireDocument(key) { leases.add(key); },
    async releaseDocument(key) { leases.delete(key); },
    async onRequest(session, operation, payload) { requests.push({ session, operation, payload }); return { ok: true, data: { value: 'scoped' } }; },
    async onFailure(session, message) { failures.push({ session, message }); },
  });
  assert.equal(client.connect(port), true);
  return { client, port, sent, requests, failures, leases };
}
const update = (overrides = {}) => ({
  identity: { type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-v2', activityVersion: '1.0.0', capability: 'a'.repeat(64), apiVersion: 2 },
  sender: { tab: { id: 7 }, frameId: 0, documentId: 'doc-7', url: 'https://example.com/watch' },
  source: 'ChudPresence.onUpdate(() => {});', snapshot: { reads: { title: 'Public' }, page: {}, media: [] },
  ...overrides,
});

test('host channel rejects other extension pages, website tabs, and forged ports', () => {
  const { client, port } = fixture();
  assert.equal(client.connect({ ...port, sender: { url: 'chrome-extension://extension-id/activities.html' } }), false);
  assert.equal(client.connect({ ...port, sender: { url, tab: { id: 7 } } }), false);
  assert.equal(client.connect({ ...port, name: 'attacker' }), false);
});

test('host receives opaque keys/source/snapshots while ownership and sender remain private', async () => {
  const { client, sent, leases } = fixture();
  await client.update(update());
  assert.equal(leases.size, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['key', 'snapshot', 'source', 'type']);
  assert.doesNotMatch(JSON.stringify(sent), /aaaaaa|capability|doc-7|activityVersion/);
  await client.update(update());
  assert.equal(client.sessions.size, 1);
  assert.equal(sent[0].key, sent[1].key);
});

test('guest operations are rebound to authenticated identity and cannot execute arbitrary page code', async () => {
  const { client, port, sent, requests } = fixture();
  await client.update(update());
  const key = sent[0].key;
  await client.receive(port, { type: 'request', key, requestId: 1, operation: 'page.execute', payload: {} });
  await client.receive(port, { type: 'request', key: 'forged', requestId: 2, operation: 'storage.get', payload: {} });
  assert.equal(requests.length, 0);
  await client.receive(port, { type: 'request', key, requestId: 3, operation: 'storage.get', payload: { key: 'x' } });
  assert.equal(requests[0].session.identity.capability, update().identity.capability);
  assert.equal(requests[0].session.sender.documentId, 'doc-7');
  assert.equal(sent.at(-1).type, 'response');
  assert.deepEqual(sent.at(-1).data, { value: 'scoped' });
});

test('stopped sessions discard outstanding replies and release shared document leases', async () => {
  const { client, port, sent, leases } = fixture();
  await client.update(update());
  const key = sent[0].key;
  client.stopContext('sample-v2', 7, 'doc-7');
  assert.equal(client.sessions.size, 0);
  assert.equal(leases.size, 0);
  assert.equal(sent.at(-1).type, 'stop');
  const count = sent.length;
  await client.receive(port, { type: 'request', key, requestId: 1, operation: 'storage.get', payload: {} });
  assert.equal(sent.length, count);
});

test('capability rotation replaces the prior worker and disconnect clears all sessions', async () => {
  const { client, port, sent, failures, leases } = fixture();
  await client.update(update());
  const oldKey = sent[0].key;
  await client.update(update({ identity: { ...update().identity, capability: 'b'.repeat(64) } }));
  assert.equal(client.sessions.has(oldKey), false);
  assert.equal(client.sessions.size, 1);
  port.disconnect();
  assert.equal(client.sessions.size, 0);
  assert.equal(leases.size, 0);
  assert.equal(failures.length, 1);
});

test('oversized snapshots and more than sixteen live contexts are rejected before dispatch', async () => {
  const { client } = fixture();
  await assert.rejects(client.update(update({ snapshot: { text: 'x'.repeat(262145) } })), /256 KiB/);
  for (let index = 0; index < 16; index++) {
    await client.update(update({ sender: { ...update().sender, documentId: `doc-${index}` } }));
  }
  await assert.rejects(client.update(update({ sender: { ...update().sender, documentId: 'doc-over-limit' } })), /session limit/);
});

test('execution failures stop automatic restart until explicit activity reload', async () => {
  const { client, port, sent, failures } = fixture();
  await client.update(update());
  await client.receive(port, { type: 'error', key: sent[0].key, message: 'Execution failed.' });
  assert.equal(failures.length, 1);
  await assert.rejects(client.update(update()), /Reload the Activity/);
  assert.equal(client.sessions.size, 0);
  client.stopActivity('sample-v2');
  await client.update(update());
  assert.equal(client.sessions.size, 1);
});
