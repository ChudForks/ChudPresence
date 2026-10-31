import { isPlaying, isReportable } from './activity.js';

export const ACTIVITY_PRIORITY_STORAGE_KEY = 'activityPriorityRules';
export const MAX_ACTIVITY_PRIORITY_RULES = 64;
export const DEFAULT_ACTIVITY_PRIORITY_RULES = Object.freeze([
  Object.freeze({ id: 'playing-viewed', activityId: '', state: 'playing', scope: 'viewed' }),
  Object.freeze({ id: 'playing-background', activityId: '', state: 'playing', scope: 'background' }),
  Object.freeze({ id: 'browsing-viewed', activityId: '', state: 'browsing', scope: 'viewed' }),
  Object.freeze({ id: 'paused-viewed', activityId: '', state: 'paused', scope: 'viewed' }),
  Object.freeze({ id: 'paused-background', activityId: '', state: 'paused', scope: 'background' }),
]);

const STATES = new Set(['any', 'playing', 'browsing', 'paused']);
const SCOPES = new Set(['any', 'viewed', 'background']);
const MEDIA_KINDS = new Set(['song', 'video', 'movie', 'episode', 'stream']);

export function validateActivityPriorityRules(value) {
  if (!Array.isArray(value) || value.length > MAX_ACTIVITY_PRIORITY_RULES) {
    throw new TypeError(`Priority must be a list of at most ${MAX_ACTIVITY_PRIORITY_RULES} rules.`);
  }
  const ids = new Set();
  return value.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
        Object.keys(rule).some(key => !['id', 'activityId', 'state', 'scope'].includes(key)) ||
        typeof rule.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(rule.id) || ids.has(rule.id) ||
        typeof rule.activityId !== 'string' || (rule.activityId !== '' && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(rule.activityId)) ||
        !STATES.has(rule.state) || !SCOPES.has(rule.scope)) {
      throw new TypeError('Each priority rule needs a unique ID, a valid Activity, playback state, and tab scope.');
    }
    ids.add(rule.id);
    return { id: rule.id, activityId: rule.activityId, state: rule.state, scope: rule.scope };
  });
}

export function normalizeActivityPriorityRules(value) {
  try { return validateActivityPriorityRules(value); }
  catch { return DEFAULT_ACTIVITY_PRIORITY_RULES.map(rule => ({ ...rule })); }
}

// Foreground is an eligibility policy, not a media type. A foreground video
// remains media; elapsed generic reports are explicitly page activities in V2.
// Untyped/legacy reports retain their playback behavior unless they opt into
// foreground page presence, avoiding a new report field or package migration.
export function activityPriorityState(track) {
  if (!MEDIA_KINDS.has(track?.kind) &&
      (track?.playback?.elapsed === true || track?.focusPolicy === 'foreground')) return 'browsing';
  return isPlaying(track) ? 'playing' : 'paused';
}

export function describePriorityRule(rule, activityName = '') {
  const activity = rule.activityId ? activityName || rule.activityId : 'Any Activity';
  const state = { any: 'any state', playing: 'playing media', browsing: 'browsing / page activity', paused: 'paused media' }[rule.state];
  const scope = { any: 'any tab', viewed: 'viewed tab', background: 'other tabs' }[rule.scope];
  return `${activity} · ${state} · ${scope}`;
}

function sameSource(candidate, previous) {
  if (typeof previous === 'number') return candidate.tabId === previous;
  return previous && candidate.tabId === previous.tabId && candidate.frameId === previous.frameId &&
    candidate.documentId === previous.documentId && (candidate.track.activityId || '') === previous.activityId;
}

export function selectPriorityActivity(candidates, {
  rules = DEFAULT_ACTIVITY_PRIORITY_RULES, viewedTabId = null, previous = null,
} = {}) {
  const eligible = candidates.filter(candidate => isReportable(candidate.track));
  const viewed = candidate => candidate.tabId === viewedTabId;
  let pool = [];
  let ruleIndex = -1;
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    pool = eligible.filter(candidate => (!rule.activityId || candidate.track.activityId === rule.activityId) &&
      (rule.state === 'any' || activityPriorityState(candidate.track) === rule.state) &&
      (rule.scope === 'any' || viewed(candidate) === (rule.scope === 'viewed')));
    if (pool.length) { ruleIndex = index; break; }
  }
  if (!pool.length) pool = eligible;
  pool.sort((left, right) => Number(viewed(right)) - Number(viewed(left)) ||
    Number(Boolean(sameSource(right, previous))) - Number(Boolean(sameSource(left, previous))) ||
    (right.prioritySequence || 0) - (left.prioritySequence || 0) ||
    left.tabId - right.tabId || left.frameId - right.frameId ||
    String(left.track.activityId || '').localeCompare(String(right.track.activityId || '')));
  const selected = pool[0];
  if (!selected) return { tabId: null, track: null, source: null, ruleIndex: -1, reason: 'No eligible activity' };
  const { tabId, frameId, documentId, track } = selected;
  const label = ruleIndex < 0 ? '' : describePriorityRule(rules[ruleIndex],
    rules[ruleIndex].activityId ? track.activityName : '');
  return { tabId, track, source: { tabId, frameId, documentId, activityId: track.activityId || '' }, ruleIndex,
    reason: ruleIndex < 0 ? 'Other eligible activity' : `Priority ${ruleIndex + 1}: ${label}` };
}
