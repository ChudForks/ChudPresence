const KINDS = new Set(['all', 'logs', 'network', 'snapshots']);
const LEVELS = new Set(['all', 'debug', 'info', 'warn', 'error']);

function selection(records, { activityId = '', kind = 'all', level = 'all' } = {}) {
  return {
    records: (Array.isArray(records) ? records : []).filter((record) =>
      record && typeof record === 'object' && (!activityId || record.id === activityId)),
    kind: KINDS.has(kind) ? kind : 'all',
    level: LEVELS.has(level) ? level : 'all',
  };
}

function timeValue(value) {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? time : null;
}

function timestamp(value) {
  const time = timeValue(value);
  return time === null ? 'unknown time' : new Date(time).toISOString();
}

function history({ records, kind, level }) {
  const entries = [];
  for (const record of records) {
    if (kind === 'all' || kind === 'logs') {
      for (const entry of Array.isArray(record.activityLogs) ? record.activityLogs : []) {
        if (!entry || typeof entry !== 'object' || (level !== 'all' && entry.level !== level)) continue;
        entries.push({ record, entry, kind: 'logs', time: timeValue(entry.timestamp), order: entries.length });
      }
    }
    if (kind === 'all' || kind === 'network') {
      for (const entry of Array.isArray(record.networkRequests) ? record.networkRequests : []) {
        if (!entry || typeof entry !== 'object') continue;
        entries.push({ record, entry, kind: 'network', time: timeValue(entry.startedAt), order: entries.length });
      }
    }
  }
  return entries.sort((left, right) =>
    (left.time ?? Infinity) - (right.time ?? Infinity) || left.order - right.order);
}

function identity(record, entry = {}) {
  return `${entry.activityName || record.name || 'Unknown Activity'} (${entry.activityId || record.id || 'unknown'}) v${entry.activityVersion || record.version || 'unknown'}`;
}

function json(value, fallback = 'none') {
  return value === null || value === undefined ? fallback : JSON.stringify(value, null, 2) ?? fallback;
}

function indented(value) {
  return value.split('\n').map((line) => `  ${line}`).join('\n');
}

function origins(values) {
  return Array.isArray(values) && values.length ? values.map((value) => `  ${value}`).join('\n') : '  none';
}

function formatHistory({ record, entry, kind }) {
  const level = kind === 'logs' ? String(entry.level || 'unknown').toUpperCase() : 'NETWORK';
  const lines = [
    `[${timestamp(kind === 'logs' ? entry.timestamp : entry.startedAt)}] ${level} · ${identity(record, entry)} · tab ${entry.tabId ?? 'unknown'} · frame ${entry.frameId ?? 'unknown'}`,
  ];
  if (entry.documentId) lines.push(`  Document: ${entry.documentId}`);
  if (kind === 'logs') {
    lines.push('  Arguments:', indented(json(entry.args, '[]')));
  } else {
    lines.push(
      `  Request: ${entry.method || 'GET'} ${entry.url || 'unknown URL'}`,
      `  Request ID: ${entry.requestId ?? 'unknown'}`,
      `  State: ${entry.state || 'unknown'} · status ${entry.status ?? 'none'} · ${entry.durationMs ?? 0} ms · ${entry.responseBytes ?? 0} bytes`,
    );
    if (entry.errorCode) lines.push(`  Error: ${entry.errorCode}`);
    if (entry.senderUrl) lines.push(`  Sender: ${entry.senderUrl}`);
  }
  return lines.join('\n');
}

function formatSnapshot(record, { finalPresenceIntent, grantedOrigins }) {
  const currentIntent = finalPresenceIntent?.source === record.id ? finalPresenceIntent : null;
  const frames = Array.isArray(record.frameContexts) && record.frameContexts.length
    ? record.frameContexts : record.activeFrames || [];
  return [
    `${identity(record)} — current snapshot`,
    `Status: ${record.status || 'unknown'} · enabled ${record.enabled === true ? 'yes' : 'no'} · API v${record.apiVersion ?? 'unknown'}`,
    `Frame scope: ${record.frames || 'top'}`,
    ...(record.compatibilityStatus ? [`Compatibility: ${record.compatibilityStatus}`] : []),
    `Source and provenance:\n${indented(json(record.source))}`,
    `Declared website origins:\n${origins(record.matches)}`,
    `Declared network origins:\n${origins(record.network)}`,
    `Granted origins:\n${origins(grantedOrigins)}`,
    `Current settings:\n${indented(json(record.settingValues || {}))}`,
    `Frame ownership:\n${indented(Array.isArray(frames) && frames.length ? json(frames) : 'No frame reports yet.')}`,
    `Current raw report:\n${indented(json(record.rawReport))}`,
    `Normalized report:\n${indented(json(record.normalizedReport))}`,
    `Final presence intent:\n${indented(json(currentIntent))}`,
    `Last report:\n${indented(json(record.lastReport))}`,
    `Last clear:\n${indented(json(record.lastClear))}`,
    `Last error:\n${indented(json(record.lastError || record.error || null))}`,
    `Pending upgrade:\n${indented(json(record.pendingUpgrade))}`,
    `Last upgrade:\n${indented(json(record.lastUpgrade))}`,
  ].join('\n');
}

/** Format already sanitized Activity status records for viewing or copying. */
export function formatDeveloperDiagnostics(records, {
  activityId = '', kind = 'all', level = 'all', finalPresenceIntent = null, grantedOrigins = [],
} = {}) {
  const selected = selection(records, { activityId, kind, level });
  const sections = [];
  if (selected.kind === 'all' || selected.kind === 'snapshots') {
    sections.push(selected.records.length
      ? `Activity snapshots\n\n${selected.records.map((record) => formatSnapshot(record, { finalPresenceIntent, grantedOrigins })).join('\n\n')}`
      : 'No Activity snapshots available.');
  }
  if (selected.kind !== 'snapshots') {
    const entries = history(selected);
    const label = selected.kind === 'logs' ? 'Activity logs'
      : selected.kind === 'network' ? 'Network requests' : 'Activity logs and network requests';
    sections.push(entries.length ? `${label}\n\n${entries.map(formatHistory).join('\n\n')}`
      : `No ${label.toLowerCase()} match the selected filters.`);
  }
  return sections.join('\n\n');
}

/** Count historical entries using the same filters as the readable export. */
export function diagnosticEntryCount(records, { activityId = '', kind = 'all', level = 'all' } = {}) {
  const selected = selection(records, { activityId, kind, level });
  return selected.kind === 'snapshots' ? selected.records.length : history(selected).length;
}
