import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticEntryCount, formatDeveloperDiagnostics } from '../extension/core/developer-diagnostics.js';

function fixture() {
  return [{
    id: 'example', name: 'Example Activity', version: '2.0.0', apiVersion: 1, enabled: true, status: 'detected',
    matches: ['https://example.com/*'], network: ['https://api.example.com/*'], frames: 'all',
    source: { type: 'repository', revision: 'saved-revision', codeSha256: 'saved-code-hash' },
    settingValues: { showArtwork: false },
    frameContexts: [{ frameId: 0, parentFrameId: -1, documentId: 'current-document', state: 'active',
      senderUrl: 'https://example.com/watch', retiredDocumentIds: ['retired-document'] }],
    rawReport: { media: { title: 'Current song' } },
    normalizedReport: { kind: 'song', playback: { state: 'playing' }, visibility: 'normal' },
    lastReport: { timestamp: '2026-10-13T16:00:00.000Z', tabId: 7, frameId: 0 },
    lastClear: { reason: 'navigation', documentId: 'previous-document' },
    lastError: { code: 'network_error', message: 'Request failed' },
    pendingUpgrade: { version: '2.1.0' }, lastUpgrade: { status: 'completed' },
    activityLogs: [
      { timestamp: '2026-10-13T16:00:03.000Z', level: 'info', tabId: 7, frameId: 0,
        activityId: 'example', activityName: 'Previous name', activityVersion: '1.0.0', args: ['later log', { secret: '[redacted]' }] },
      { timestamp: '2026-10-13T16:00:01.000Z', level: 'warn', tabId: 7, frameId: 2, args: ['first log', false, 0] },
    ],
    networkRequests: [{ startedAt: Date.parse('2026-10-13T16:00:02.000Z'), method: 'GET', url: 'https://api.example.com/media',
      tabId: 7, frameId: 0, documentId: 'current-document', requestId: 'request-1', senderUrl: 'https://example.com/watch',
      state: 'error', status: 503, responseBytes: 12, durationMs: 50, errorCode: 'network_error' }],
  }, {
    id: 'other', name: 'Other Activity', version: '3.0.0',
    activityLogs: [{ timestamp: '2026-10-13T16:00:02.000Z', level: 'debug', args: ['second Activity log'], tabId: 8, frameId: 0 }],
  }];
}

test('readable history combines Activities in chronological order without changing inputs', () => {
  const records = fixture();
  const before = structuredClone(records);
  const output = formatDeveloperDiagnostics(records);
  const history = output.slice(output.indexOf('Activity logs and network requests'));
  assert.ok(history.indexOf('first log') < history.indexOf('Request: GET'));
  assert.ok(history.indexOf('Request: GET') < history.indexOf('second Activity log'), 'equal times keep input order');
  assert.ok(history.indexOf('second Activity log') < history.indexOf('later log'));
  assert.match(history, /Previous name \(example\) v1\.0\.0 · tab 7 · frame 0/);
  assert.match(history, /\[2026-10-13T16:00:02\.000Z\] NETWORK · Example Activity \(example\) v2\.0\.0/);
  assert.match(history, /WARN · Example Activity \(example\) v2\.0\.0 · tab 7 · frame 2/);
  assert.match(history, /"secret": "\[redacted\]"/);
  assert.match(history, /status 503 · 50 ms · 12 bytes/);
  assert.deepEqual(records, before);
  assert.equal(diagnosticEntryCount(records), 4);
});

test('Activity and level filters select logs while keeping snapshots and network in all view', () => {
  const records = fixture();
  const options = { activityId: 'example', level: 'warn' };
  const output = formatDeveloperDiagnostics(records, options);
  assert.match(output, /Current raw report/);
  assert.match(output, /first log/);
  assert.match(output, /Request: GET/);
  assert.doesNotMatch(output, /later log|Other Activity|second Activity log/);
  assert.equal(diagnosticEntryCount(records, options), 2);
  assert.equal(diagnosticEntryCount(records, { ...options, kind: 'logs' }), 1);
});

test('kind filters keep history and snapshots separate and ignore level outside logs', () => {
  const records = fixture();
  const logs = formatDeveloperDiagnostics(records, { kind: 'logs', level: 'info' });
  assert.match(logs, /later log/);
  assert.doesNotMatch(logs, /first log|second Activity log|Request:|Current raw report|Source and provenance/);
  const network = formatDeveloperDiagnostics(records, { kind: 'network', level: 'error' });
  assert.match(network, /Request: GET/);
  assert.doesNotMatch(network, /later log|Current raw report/);
  assert.equal(diagnosticEntryCount(records, { kind: 'network', level: 'error' }), 1);
  const snapshots = formatDeveloperDiagnostics(records, { kind: 'snapshots', level: 'error' });
  assert.match(snapshots, /Current raw report/);
  assert.doesNotMatch(snapshots, /later log|Request: GET/);
  assert.equal(diagnosticEntryCount(records, { kind: 'snapshots', level: 'error' }), 2);
});

test('snapshots retain reports, ownership, provenance, permissions, settings, and current intent', () => {
  const records = fixture();
  const intent = { source: 'example', name: 'Example presence', details: 'Current song' };
  const output = formatDeveloperDiagnostics(records, {
    activityId: 'example', kind: 'snapshots', finalPresenceIntent: intent, grantedOrigins: ['https://granted.example.com/*'],
  });
  for (const value of ['Current song', 'navigation', 'Request failed', 'current-document', 'retired-document',
    'saved-revision', 'saved-code-hash', 'https://example.com/*', 'https://api.example.com/*', 'https://granted.example.com/*',
    '"showArtwork": false', '"source": "example"', '"version": "2.1.0"', '"status": "completed"']) {
    assert.ok(output.includes(value), value);
  }
  const other = formatDeveloperDiagnostics(records, { activityId: 'other', kind: 'snapshots', finalPresenceIntent: intent });
  assert.match(other, /Final presence intent:\n  none/);
  assert.doesNotMatch(other, /Example presence/);
  assert.equal(diagnosticEntryCount(records, { activityId: 'other', kind: 'snapshots' }), 1);
});

test('empty selections explain what is absent and have zero entries', () => {
  assert.match(formatDeveloperDiagnostics([]), /No Activity snapshots available/);
  assert.match(formatDeveloperDiagnostics([], { kind: 'logs' }), /No activity logs/);
  assert.match(formatDeveloperDiagnostics([], { kind: 'network' }), /No network requests/);
  assert.match(formatDeveloperDiagnostics([], { kind: 'snapshots' }), /No Activity snapshots/);
  assert.match(formatDeveloperDiagnostics(fixture(), { activityId: 'missing', kind: 'logs' }), /No activity logs/);
  assert.match(formatDeveloperDiagnostics(fixture(), { kind: 'logs', level: 'error' }), /No activity logs/);
  assert.equal(diagnosticEntryCount(fixture(), { activityId: 'missing' }), 0);
  assert.equal(diagnosticEntryCount(fixture(), { kind: 'logs', level: 'error' }), 0);
  assert.equal(diagnosticEntryCount(null), 0);
});

test('missing optional fields remain readable and invalid timestamps sort stably after timed entries', () => {
  const records = [{ id: 'minimal', name: 'Minimal', version: '1.0.0', activityLogs: [
    { level: 'debug', args: ['unknown first'] },
    { timestamp: 0, level: 'info', tabId: 0, frameId: 0, args: ['timed'] },
    { timestamp: 'invalid', level: 'debug', args: ['unknown second'] },
  ] }];
  const output = formatDeveloperDiagnostics(records, { kind: 'logs' });
  assert.ok(output.indexOf('timed') < output.indexOf('unknown first'));
  assert.ok(output.indexOf('unknown first') < output.indexOf('unknown second'));
  assert.match(output, /\[1970-01-01T00:00:00\.000Z\] INFO · Minimal \(minimal\) v1\.0\.0 · tab 0 · frame 0/);
  assert.match(output, /\[unknown time\] DEBUG · Minimal \(minimal\) v1\.0\.0 · tab unknown · frame unknown/);
});
