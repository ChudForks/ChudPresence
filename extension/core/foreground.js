// Browser/tab focus is distinct from document focus: toolbar popups, the
// address bar and other browser UI can blur the page without leaving its tab.
// Only IDs and native focus flags are read; no tabs permission is needed.
export function createForegroundTracker({ api, onChange = () => {}, documentForTab = () => null }) {
  let focusedWindowId = null;
  let lastFocusedWindowId = null;
  const activeTabs = new Map();
  const pageFocus = new Map();
  const popupFocus = new Map();
  let revision = 0;
  let query = 0;
  let initialized = false;

  function selectedTab() {
    if (focusedWindowId !== null) return activeTabs.get(focusedWindowId) ?? null;
    // Some browsers report WINDOW_ID_NONE for toolbar UI while the underlying
    // page still has native focus. The trusted runtime supplies that positive
    // signal; blur/hidden events revoke it without a grace period.
    const popupWindow = [...popupFocus.values()].find(value => value.focused)?.windowId;
    if (popupWindow !== undefined) return activeTabs.get(popupWindow) ?? null;
    const tabId = activeTabs.get(lastFocusedWindowId);
    const contexts = pageFocus.get(tabId);
    const documentId = documentForTab(tabId);
    const focused = documentId ? contexts?.get(documentId) : [...(contexts?.values() || [])].some(Boolean);
    return focused ? tabId : null;
  }

  function update(change) {
    const before = selectedTab();
    change();
    if (before !== selectedTab()) onChange();
  }

  async function refresh() {
    const currentQuery = ++query;
    const currentRevision = revision;
    try {
      const windows = await api.windows.getAll({ populate: true, windowTypes: ['normal', 'popup'] });
      const lastWindow = lastFocusedWindowId === null && !windows.some(window => window.focused)
        ? await api.windows.getLastFocused?.({ windowTypes: ['normal', 'popup'] }) : null;
      // A slow startup/focus query cannot undo a newer activation or removal.
      if (currentQuery !== query || currentRevision !== revision) return;
      const wasInitialized = initialized;
      const before = selectedTab();
      update(() => {
        activeTabs.clear();
        focusedWindowId = null;
        if (lastWindow && windows.some(window => window.id === lastWindow.id)) lastFocusedWindowId = lastWindow.id;
        for (const window of windows) {
          if (window.focused && window.state !== 'minimized') {
            focusedWindowId = window.id;
            lastFocusedWindowId = window.id;
          }
          const tab = window.state !== 'minimized' && window.tabs?.find(tab => tab.active && !tab.discarded);
          if (tab) activeTabs.set(window.id, tab.id);
        }
      });
      initialized = true;
      if (!wasInitialized && before === selectedTab()) onChange();
    } catch {
      if (currentQuery !== query || currentRevision !== revision) return;
      // Unknown focus fails closed for foreground reports; background reports
      // retain their existing behavior. A later event can recover the state.
      const wasInitialized = initialized;
      const before = selectedTab();
      update(() => { focusedWindowId = null; activeTabs.clear(); });
      initialized = true;
      if (!wasInitialized && before === selectedTab()) onChange();
    }
  }

  function change(updateState) {
    revision++;
    update(updateState);
    void refresh();
  }

  api.tabs.onActivated.addListener(({ tabId, windowId }) => {
    change(() => activeTabs.set(windowId, tabId));
  });
  api.windows.onFocusChanged.addListener(windowId => {
    change(() => {
      focusedWindowId = windowId >= 0 ? windowId : null;
      if (focusedWindowId !== null) lastFocusedWindowId = focusedWindowId;
    });
  });
  api.windows.onRemoved.addListener(windowId => {
    change(() => {
      activeTabs.delete(windowId);
      if (focusedWindowId === windowId) focusedWindowId = null;
    });
  });
  function forgetTab(tabId) {
    pageFocus.delete(tabId);
    for (const [windowId, activeTabId] of activeTabs) {
      if (activeTabId === tabId) activeTabs.delete(windowId);
    }
  }
  api.tabs.onRemoved.addListener(tabId => {
    // The background's removal handler owns publication, including keepalive
    // cleanup. Do not race it with an ordinary non-closing clear.
    revision++;
    forgetTab(tabId);
    void refresh();
  });
  api.tabs.onDetached.addListener(tabId => change(() => forgetTab(tabId)));
  api.tabs.onAttached.addListener(() => change(() => {}));
  api.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    change(() => {
      for (const [windowId, activeTabId] of activeTabs) {
        if (activeTabId === removedTabId) activeTabs.set(windowId, addedTabId);
      }
    });
  });
  api.tabs.onUpdated.addListener((tabId, changes) => {
    if (changes.discarded) change(() => forgetTab(tabId));
  });

  return {
    ready: refresh(),
    refresh,
    setPageFocus(tabId, documentId, focused) {
      update(() => {
        if (focused === null) {
          pageFocus.get(tabId)?.delete(documentId);
          if (!pageFocus.get(tabId)?.size) pageFocus.delete(tabId);
        } else {
          if (!pageFocus.has(tabId)) pageFocus.set(tabId, new Map());
          pageFocus.get(tabId).set(documentId, focused === true);
        }
      });
    },
    setPopupFocus(owner, windowId, focused) {
      update(() => {
        if (focused === null) popupFocus.delete(owner);
        else popupFocus.set(owner, { windowId, focused: focused === true });
      });
    },
    allows(tabId, track) {
      return track?.focusPolicy !== 'foreground' || selectedTab() === tabId;
    },
  };
}
