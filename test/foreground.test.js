import assert from 'node:assert/strict';
import test from 'node:test';
import { createForegroundTracker } from '../extension/core/foreground.js';

const foreground = { focusPolicy: 'foreground' };
const event = () => {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, emit(...args) { for (const listener of listeners) listener(...args); } };
};

function harness({ windows = [{ id: 1, focused: true, tabs: [{ id: 9, active: true }] }], getAll, documentForTab } = {}) {
  const api = {
    tabs: Object.fromEntries(['onActivated', 'onRemoved', 'onDetached', 'onAttached', 'onReplaced', 'onUpdated'].map(name => [name, event()])),
    windows: { onFocusChanged: event(), onRemoved: event(), getAll: getAll || (async () => structuredClone(windows)) },
  };
  let changes = 0;
  const tracker = createForegroundTracker({ api, documentForTab, onChange() { changes++; } });
  return { api, tracker, windows, changes: () => changes };
}

test('only the selected tab of the focused window is eligible; background window activation is independent', async () => {
  const { api, tracker, windows } = harness({ windows: [
    { id: 1, focused: true, tabs: [{ id: 9, active: true }] },
    { id: 2, focused: false, tabs: [{ id: 10, active: true }] },
  ] });
  assert.equal(tracker.allows(9, foreground), false, 'unknown startup state fails closed');
  assert.equal(tracker.allows(9, {}), true);
  assert.equal(tracker.allows(9, { focusPolicy: 'background' }), true);
  await tracker.ready;
  assert.equal(tracker.allows(9, foreground), true);
  assert.equal(tracker.allows(10, foreground), false);
  windows[1].tabs = [{ id: 11, active: true }];
  api.tabs.onActivated.emit({ windowId: 2, tabId: 11 });
  assert.equal(tracker.allows(9, foreground), true);
  assert.equal(tracker.allows(11, foreground), false);
  windows[0].focused = false; windows[1].focused = true;
  api.windows.onFocusChanged.emit(2);
  assert.equal(tracker.allows(9, foreground), false);
  assert.equal(tracker.allows(11, foreground), true);
  await tracker.refresh();
  assert.equal(tracker.allows(11, foreground), true);
});

test('focus loss is synchronous and stale asynchronous snapshots cannot restore an old tab', async () => {
  const queries = [];
  const { api, tracker } = harness({ getAll: () => new Promise(resolve => queries.push(resolve)) });
  queries[0]([{ id: 1, focused: true, tabs: [{ id: 9, active: true }] }]);
  await tracker.ready;
  const slow = tracker.refresh();
  api.tabs.onActivated.emit({ windowId: 1, tabId: 10 });
  assert.equal(tracker.allows(10, foreground), true);
  queries[1]([{ id: 1, focused: true, tabs: [{ id: 9, active: true }] }]);
  await slow;
  assert.equal(tracker.allows(9, foreground), false);
  api.windows.onFocusChanged.emit(-1);
  assert.equal(tracker.allows(10, foreground), false);
  queries[2]([{ id: 1, focused: true, tabs: [{ id: 10, active: true }] }]);
  await Promise.resolve();
  assert.equal(tracker.allows(10, foreground), false, 'an older activation query cannot undo focus loss');
  queries[3]([{ id: 1, focused: false, tabs: [{ id: 10, active: true }] }]);
  await Promise.resolve();
  api.windows.onFocusChanged.emit(1);
  assert.equal(tracker.allows(10, foreground), true);
});

test('tab moves, replacement, discarded tabs and window removal reconcile eligibility', async () => {
  const { api, tracker, windows } = harness();
  await tracker.ready;
  api.tabs.onDetached.emit(9);
  assert.equal(tracker.allows(9, foreground), false);
  windows[0].tabs = [];
  windows.push({ id: 2, focused: false, tabs: [{ id: 9, active: true }] });
  api.tabs.onAttached.emit(9);
  await tracker.refresh();
  assert.equal(tracker.allows(9, foreground), false);
  windows[0].focused = false; windows[1].focused = true;
  api.windows.onFocusChanged.emit(2);
  assert.equal(tracker.allows(9, foreground), true);
  windows[1].tabs = [{ id: 12, active: true }];
  api.tabs.onReplaced.emit(12, 9);
  assert.equal(tracker.allows(9, foreground), false);
  assert.equal(tracker.allows(12, foreground), true);
  windows[1].tabs[0].discarded = true;
  api.tabs.onUpdated.emit(12, { discarded: true });
  assert.equal(tracker.allows(12, foreground), false);
  api.windows.onRemoved.emit(2);
  assert.equal(tracker.allows(12, foreground), false);
  await tracker.refresh();
  assert.equal(tracker.allows(12, foreground), false);
});

test('failed state reads and minimized windows suppress only foreground reports', async () => {
  const fixture = harness();
  await fixture.tracker.ready;
  fixture.api.windows.getAll = async () => { throw new Error('Browser state unavailable'); };
  await fixture.tracker.refresh();
  assert.equal(fixture.tracker.allows(9, foreground), false);
  assert.equal(fixture.tracker.allows(9, {}), true);
  fixture.api.windows.getAll = async () => [{ id: 1, focused: true, state: 'minimized', tabs: [{ id: 9, active: true }] }];
  await fixture.tracker.refresh();
  assert.equal(fixture.tracker.allows(9, foreground), false);
});

test('native page focus covers toolbar WINDOW_ID_NONE and native blur revokes it immediately', async () => {
  const { api, tracker, windows } = harness();
  await tracker.ready;
  tracker.setPageFocus(9, 'current-document', true);
  windows[0].focused = false;
  api.windows.onFocusChanged.emit(-1);
  assert.equal(tracker.allows(9, foreground), true);
  await tracker.refresh();
  assert.equal(tracker.allows(9, foreground), true);
  tracker.setPageFocus(9, 'current-document', false);
  assert.equal(tracker.allows(9, foreground), false);
  tracker.setPageFocus(9, 'current-document', true);
  assert.equal(tracker.allows(9, foreground), true);
  tracker.setPageFocus(9, 'current-document', null);
  assert.equal(tracker.allows(9, foreground), false);
});

test('own popup focus covers a blurred page and disconnect/blur cannot leave eligibility stuck', async () => {
  const { api, tracker, windows } = harness();
  await tracker.ready;
  tracker.setPageFocus(9, 'current-document', false);
  tracker.setPopupFocus('popup', 1, true);
  windows[0].focused = false;
  api.windows.onFocusChanged.emit(-1);
  assert.equal(tracker.allows(9, foreground), true);
  tracker.setPopupFocus('popup', 1, false);
  assert.equal(tracker.allows(9, foreground), false);
  tracker.setPopupFocus('popup', 1, true);
  tracker.setPopupFocus('popup', null, null);
  assert.equal(tracker.allows(9, foreground), false);
});

test('a cold popup wake resolves the last browser window without treating it as focused', async () => {
  const documentId = 'new-document';
  const fixture = harness({ windows: [{ id: 1, focused: false, tabs: [{ id: 9, active: true }] }] });
  fixture.api.windows.getLastFocused = async () => ({ id: 1, focused: false });
  await fixture.tracker.ready;
  fixture.tracker.setPageFocus(9, documentId, true);
  await fixture.tracker.refresh();
  assert.equal(fixture.tracker.allows(9, foreground), true);
  fixture.tracker.setPageFocus(9, documentId, false);
  assert.equal(fixture.tracker.allows(9, foreground), false);
});

test('an old document focus signal or disconnect cannot override the replacement document', async () => {
  const { api, tracker, windows } = harness({ documentForTab: () => 'new-document' });
  await tracker.ready;
  tracker.setPageFocus(9, 'old-document', true);
  tracker.setPageFocus(9, 'new-document', false);
  windows[0].focused = false;
  api.windows.onFocusChanged.emit(-1);
  assert.equal(tracker.allows(9, foreground), false);
  tracker.setPageFocus(9, 'new-document', true);
  tracker.setPageFocus(9, 'old-document', null);
  assert.equal(tracker.allows(9, foreground), true);
});
