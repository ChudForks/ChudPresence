import { isPlaying, isReportable } from './activity.js';

function normalizeDocumentId(documentId) {
  return typeof documentId === 'string' && documentId ? documentId : null;
}

function normalizeFrameId(frameId) {
  return Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
}

function entryKey(frameId, track) {
  return `${normalizeFrameId(frameId)}:${track?.activityId || ''}`;
}

function contentIdentity(track) {
  return JSON.stringify([track?.kind, track?.url, track?.media?.title || track?.title,
    track?.media?.artist || track?.artist, track?.media?.album || track?.album]);
}

/**
 * Keeps each report tied to the tab, frame, and document that produced it.
 * When a frame clears, the most recently updated report from another live
 * frame can become current again.
 */
export class ActivityRegistry {
  constructor() {
    this.entries = new Map();
    this.retiredDocuments = new Map();
    this.sequence = 0;
  }

  update(tabId, documentId, track, frameId = 0) {
    if (typeof tabId !== 'number') return false;
    frameId = normalizeFrameId(frameId);
    documentId = normalizeDocumentId(documentId);
    const documentKey = `${tabId}:${frameId}`;
    const retired = this.retiredDocuments.get(documentKey) || new Set();
    if (documentId && retired.has(documentId)) return false;
    if (!this.entries.has(tabId)) this.entries.set(tabId, new Map());
    const frames = this.entries.get(tabId);
    // Every Activity in a frame belongs to the same live document. Replacing
    // that document also retires reports from overlapping Activities.
    for (const [otherKey, entry] of frames) {
      if (entry.frameId === frameId && entry.documentId && documentId && entry.documentId !== documentId) {
        retired.add(entry.documentId);
        frames.delete(otherKey);
      }
    }
    if (retired.size) {
      while (retired.size > 32) retired.delete(retired.values().next().value);
      this.retiredDocuments.set(documentKey, retired);
    }
    const key = entryKey(frameId, track);
    const previous = frames.get(key);
    const sequence = ++this.sequence;
    const changed = !previous || previous.documentId !== normalizeDocumentId(documentId) ||
      isPlaying(previous.track) !== isPlaying(track) || isReportable(previous.track) !== isReportable(track) ||
      contentIdentity(previous.track) !== contentIdentity(track);
    frames.set(key, {
      documentId: normalizeDocumentId(documentId),
      frameId: normalizeFrameId(frameId),
      track: track || { idle: true },
      sequence,
      prioritySequence: changed ? sequence : previous.prioritySequence,
    });
    return true;
  }

  heartbeat(tabId, documentId, track = null, frameId = 0) {
    if (track && typeof tabId === 'number') return this.update(tabId, documentId, track, frameId);
    if (typeof tabId !== 'number' || this.entries.has(tabId)) return false;
    return this.update(tabId, documentId, { idle: true }, frameId);
  }

  clearDocument(tabId, documentId, frameId = null) {
    const frames = this.entries.get(tabId);
    if (!frames) return false;
    const closing = normalizeDocumentId(documentId);
    const targets = [...frames.entries()].filter(([, entry]) =>
      (!Number.isInteger(frameId) || entry.frameId === frameId) && (!closing || entry.documentId === closing));
    let cleared = false;
    for (const [currentFrameId, entry] of targets) {
      if (!entry) continue;
      if (entry.documentId && closing && entry.documentId !== closing) continue;
      frames.delete(currentFrameId);
      cleared = true;
    }
    if (!frames.size) this.entries.delete(tabId);
    return cleared;
  }

  clearActivity(activityId, tabId = null, documentId = null, frameId = null) {
    let cleared = false;
    for (const [currentTabId, frames] of this.entries) {
      if (typeof tabId === 'number' && currentTabId !== tabId) continue;
      for (const [currentFrameId, entry] of frames) {
        if (Number.isInteger(frameId) && entry.frameId !== frameId) continue;
        if (entry.track?.activityId !== activityId) continue;
        const owner = entry.documentId;
        const closing = normalizeDocumentId(documentId);
        if (owner && closing && owner !== closing) continue;
        frames.delete(currentFrameId);
        cleared = true;
      }
      if (!frames.size) this.entries.delete(currentTabId);
    }
    return cleared;
  }

  clearTab(tabId) {
    for (const key of this.retiredDocuments.keys()) if (key.startsWith(`${tabId}:`)) this.retiredDocuments.delete(key);
    return this.entries.delete(tabId);
  }

  has(tabId) {
    return Boolean(this.entries.get(tabId)?.size);
  }

  hasActivity(activityId, tabId, documentId, frameId) {
    const entry = this.entries.get(tabId)?.get(entryKey(frameId, { activityId }));
    return Boolean(entry && entry.track?.activityId === activityId &&
      entry.documentId === normalizeDocumentId(documentId));
  }

  documentForTab(tabId) {
    return [...(this.entries.get(tabId)?.values() || [])]
      .filter(entry => entry.frameId === 0).sort((a, b) => b.sequence - a.sequence)[0]?.documentId || null;
  }

  candidates(isEligible = () => true) {
    return [...this.entries].flatMap(([tabId, frames]) => [...frames.values()]
      .filter(entry => isEligible(entry.track, tabId)).map(entry => ({ ...entry, tabId })));
  }

  restoreEntry(tabId, entry) {
    const retired = new Set((entry.retiredDocumentIds || []).filter(id => id !== entry.documentId));
    if (retired.size) this.retiredDocuments.set(`${tabId}:${entry.frameId}`, retired);
    const { retiredDocumentIds, ...reportEntry } = entry;
    if (!this.entries.has(tabId)) this.entries.set(tabId, new Map());
    this.entries.get(tabId).set(entryKey(entry.frameId, entry.track), reportEntry);
    this.sequence = Math.max(this.sequence, entry.sequence);
  }

  tracks(isEligible = () => true) {
    const tracks = new Map();
    for (const [tabId, frames] of this.entries) {
      const latest = [...frames.values()]
        .filter((entry) => isEligible(entry.track, tabId))
        .sort((left, right) => right.sequence - left.sequence);
      const reportable = latest.filter((entry) => isReportable(entry.track));
      const current = reportable.find((entry) => isPlaying(entry.track)) || reportable[0] || latest[0];
      if (current) tracks.set(tabId, current.track);
    }
    return tracks;
  }
}
