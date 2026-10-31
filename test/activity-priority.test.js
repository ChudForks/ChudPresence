import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityRegistry } from '../extension/core/activity-registry.js';
import { activityPriorityState, DEFAULT_ACTIVITY_PRIORITY_RULES, normalizeActivityPriorityRules,
  selectPriorityActivity, validateActivityPriorityRules } from '../extension/core/activity-priority.js';

const report = (id, state = 'playing', extra = {}) => ({ activityId: id, kind: 'song',
  media: { title: id }, playback: { state }, visibility: 'normal', ...extra });
const rule = (state, activityId = '', scope = 'any') => ({ id: `${state}-${activityId || 'all'}-${scope}`, state, activityId, scope });
const candidate = (tabId, track, prioritySequence = 1) => ({ tabId, frameId: 0, documentId: `document-${tabId}`, track, prioritySequence });

test('uses isolated defaults for missing or corrupt settings and validates saved rules strictly', () => {
  for (const value of [undefined, null, {}, [{ ...rule('playing'), state: 'invalid' }]]) {
    const normalized = normalizeActivityPriorityRules(value);
    assert.deepEqual(normalized, DEFAULT_ACTIVITY_PRIORITY_RULES);
    normalized[0].state = 'paused';
    assert.equal(DEFAULT_ACTIVITY_PRIORITY_RULES[0].state, 'playing');
  }
  for (const value of [[rule('playing'), rule('playing')], [rule('playing', 'bad id')],
    [{ ...rule('playing'), priority: 99 }], Array(65).fill(rule('playing'))]) {
    assert.throws(() => validateActivityPriorityRules(value), TypeError);
  }
  assert.deepEqual(validateActivityPriorityRules([]), []);
});

test('classifies V1/V2 page reports using existing fields and preserves foreground media and legacy playback', () => {
  assert.equal(activityPriorityState(report('music', 'playing', { focusPolicy: 'foreground' })), 'playing');
  assert.equal(activityPriorityState(report('page', 'playing', { kind: 'generic', focusPolicy: 'foreground' })), 'browsing');
  assert.equal(activityPriorityState(report('page', 'playing', { kind: 'generic', playback: { state: 'playing', elapsed: true } })), 'browsing');
  assert.equal(activityPriorityState(report('legacy', 'playing', { kind: 'generic' })), 'playing');
  assert.equal(activityPriorityState({ title: 'Legacy', playing: true }), 'playing');
  assert.equal(activityPriorityState(report('music', 'paused')), 'paused');
});

test('default rules order viewed playback, background playback, viewed browsing, and viewed/background paused media', () => {
  const ranked = [
    candidate(9, report('viewed-playing')),
    candidate(10, report('background-playing')),
    candidate(9, report('viewed-browsing', 'playing', { kind: 'generic', focusPolicy: 'foreground' })),
    candidate(9, report('viewed-paused', 'paused')),
    candidate(10, report('background-paused', 'paused')),
  ];
  for (let index = 0; index < ranked.length; index++) {
    const chosen = selectPriorityActivity(ranked.slice(index).reverse(), { viewedTabId: 9, previous: 10 });
    assert.equal(chosen.track.activityId, ranked[index].track.activityId);
    assert.equal(chosen.ruleIndex, index);
  }
});

test('user rule order can put browsing or paused media ahead of playing media', () => {
  const music = candidate(10, report('music'));
  const page = candidate(9, report('page', 'playing', { kind: 'generic', focusPolicy: 'foreground' }));
  const paused = candidate(9, report('paused', 'paused'));
  assert.equal(selectPriorityActivity([music, page], { viewedTabId: 9, rules: [rule('browsing'), rule('playing')] }).track.activityId, 'page');
  assert.equal(selectPriorityActivity([music, paused], { viewedTabId: 9, rules: [rule('paused'), rule('playing')] }).track.activityId, 'paused');
});

test('Activity-specific rules rank reports in the same frame before any per-tab reduction', () => {
  const registry = new ActivityRegistry();
  registry.update(9, 'shared', report('music'), 0);
  registry.update(9, 'shared', report('video'), 0);
  const chosen = selectPriorityActivity(registry.candidates(), { viewedTabId: 9, rules: [rule('playing', 'music'), rule('playing')] });
  assert.equal(chosen.track.activityId, 'music');
  registry.clearActivity('music');
  assert.equal(selectPriorityActivity(registry.candidates()).track.activityId, 'video');
});

test('focus beats previous selection within an any-tab rule, and focus loss keeps the current source', () => {
  const candidates = [candidate(9, report('one')), candidate(10, report('two'), 2)];
  const options = { rules: [rule('playing')], viewedTabId: 9 };
  const first = selectPriorityActivity(candidates, options);
  assert.equal(first.tabId, 9);
  const next = selectPriorityActivity(candidates, { ...options, viewedTabId: 10, previous: first.source });
  assert.equal(next.tabId, 10);
  assert.equal(selectPriorityActivity(candidates, { ...options, viewedTabId: null, previous: next.source }).tabId, 10);
});

test('heartbeats cannot steal priority; fallback uses meaningful playback changes rather than tab insertion order', () => {
  const registry = new ActivityRegistry();
  registry.update(1, 'one', report('first'), 0);
  registry.update(2, 'two', report('second'), 0);
  registry.update(1, 'one', report('first', 'playing', { playback: { state: 'playing', position: 99 } }), 0);
  assert.equal(selectPriorityActivity(registry.candidates()).tabId, 2);
  registry.update(1, 'one', report('first', 'paused'), 0);
  registry.update(1, 'one', report('first'), 0);
  assert.equal(selectPriorityActivity(registry.candidates()).tabId, 1);
  const previous = selectPriorityActivity(registry.candidates()).source;
  registry.update(2, 'two', report('second', 'playing', { media: { title: 'New song' } }), 0);
  assert.equal(selectPriorityActivity(registry.candidates(), { previous }).tabId, 1);
  registry.clearActivity('first');
  assert.equal(selectPriorityActivity(registry.candidates(), { previous }).tabId, 2);
});

test('missing Activity rules fall through, unmatched eligible reports remain available, and hidden reports never win', () => {
  const candidates = [candidate(1, report('normal')), candidate(2, report('private', 'playing', { visibility: 'private' }))];
  assert.equal(selectPriorityActivity(candidates, { rules: [rule('any', 'private'), rule('any', 'missing')] }).track.activityId, 'normal');
  assert.equal(selectPriorityActivity(candidates, { rules: [] }).ruleIndex, -1);
  assert.equal(selectPriorityActivity([candidates[1]]).track, null);
  assert.equal(selectPriorityActivity([]).source, null);
});
