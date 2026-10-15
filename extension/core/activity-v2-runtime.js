// Only this trusted bootstrap runs in USER_SCRIPT. Package JavaScript is passed
// to a dedicated extension worker; it never enters the website's JS world.
export function runActivityV2(config) {
  'use strict';
  const matches = (pattern, rawUrl) => {
    try {
      const url = new URL(rawUrl);
      const [, host, path] = /^https:\/\/([^/]+)(\/.*)$/.exec(pattern) || [];
      if (!host || url.protocol !== 'https:') return false;
      const hostname = url.hostname.toLowerCase();
      const declared = host.toLowerCase();
      if (!(declared.startsWith('*.')
        ? hostname === declared.slice(2) || hostname.endsWith(`.${declared.slice(2)}`)
        : hostname === declared)) return false;
      return new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`)
        .test(`${url.pathname}${url.search}`);
    } catch { return false; }
  };
  const allowed = (url = location.href) => config.matches.some((pattern) => matches(pattern, url)) &&
    !config.excludeMatches.some((pattern) => matches(pattern, url));
  if (!allowed() || (config.frames !== 'all' && window !== window.top)) return;
  if (globalThis.__chudpresenceActivityGeneration === config.capability) return;
  globalThis.__chudpresenceV2Stop?.();
  globalThis.__chudpresenceActivityGeneration = config.capability;
  let ended = false;
  let timer = null;
  let port = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let sequence = 0;
  let navigation = null;
  const onNavigate = (event) => {
    const url = event.destination?.url;
    navigation = config.navigationGraceMs > 0 && !event.defaultPrevented &&
      event.destination?.sameDocument === false && typeof url === 'string' && url.length <= 8192 && allowed(url)
      ? { url, signal: event.signal } : null;
  };
  const onNavigationError = () => { navigation = null; };
  const onPageShow = (event) => {
    window.removeEventListener('pageshow', onPageShow);
    if (!event.persisted || globalThis.__chudpresenceActivityGeneration !== config.capability) return;
    delete globalThis.__chudpresenceActivityGeneration;
    runActivityV2(config);
  };
  const send = async (operation, payload = {}) => {
    const response = await chrome.runtime.sendMessage({
      type: 'CHUDPRESENCE_ACTIVITY_REQUEST',
      activityId: config.id,
      activityVersion: config.version,
      apiVersion: 2,
      capability: config.capability,
      requestId: `v2-${++sequence}`,
      operation,
      payload,
    });
    if (response?.ok !== true) {
      const error = new Error(response?.error?.message || 'Activity request was rejected.');
      error.code = response?.error?.code || 'request_rejected';
      throw error;
    }
    return response.data;
  };
  const stop = (documentEnded = false) => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    clearTimeout(reconnectTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.navigation?.removeEventListener('navigate', onNavigate);
    window.navigation?.removeEventListener('navigateerror', onNavigationError);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onPageHide);
    try { port?.disconnect(); } catch { /* Extension was reloaded. */ }
    if (globalThis.__chudpresenceActivityGeneration === config.capability) {
      // A tabs.onUpdated injection can race a navigation's beforeunload while
      // the old document is still present. Do not restart that ended document.
      // Explicit reload already removes this marker before reinjection.
      if (!documentEnded) delete globalThis.__chudpresenceActivityGeneration;
      else window.addEventListener('pageshow', onPageShow, { once: true });
      delete globalThis.__chudpresenceV2Stop;
    }
  };
  const onPageHide = () => {
    if (!ended) void send('presence.clear', { closing: true,
      ...(navigation && !navigation.signal?.aborted ? { navigationUrl: navigation.url } : {}),
    }).catch(() => {});
    stop(true);
  };
  const fail = (error) => {
    if (ended) return;
    // Guest failures contain only guest-owned data. Never serialize the config
    // or a browser exception containing the private capability.
    void send('log.write', { level: 'error', args: ['V2 sandbox stopped', String(error?.message || 'Execution failed').slice(0, 240)] }).catch(() => {});
    void send('presence.clear', { closing: true }).catch(() => {});
    stop();
  };
  const request = (operation, payload) => {
    if (ended) return Promise.reject(new Error('Activity has stopped.'));
    if (!allowed()) {
      void send('presence.clear', { closing: true }).catch(() => {});
      stop();
      return Promise.reject(new Error('Page is outside the declared Activity scope.'));
    }
    return send(operation, payload);
  };
  const connect = () => {
    if (ended) return;
    try {
      const next = chrome.runtime.connect({ name: `chudpresence-activity-v2:${config.id}:${config.version}:${config.capability}` });
      port = next;
      next.onMessage.addListener((message) => {
        if (message?.activityId !== config.id || message.activityVersion !== config.version) return;
        if (message.type === 'CHUDPRESENCE_ACTIVITY_ABORT') stop();
        else if (message.type === 'CHUDPRESENCE_ACTIVITY_UPGRADE') {
          // V2 retains scoped storage through upgrades. No untrusted code runs
          // in the old document to perform privileged migration work.
          void request('lifecycle.upgradeComplete', {
            fromVersion: message.fromVersion, toVersion: message.toVersion,
          }).catch(fail);
        }
      });
      next.onDisconnect.addListener(() => {
        if (ended || port !== next) return;
        port = null;
        if (++reconnectAttempts >= 10) stop();
        else reconnectTimer = setTimeout(connect, 500);
      });
    } catch (error) { fail(error); }
  };
  globalThis.__chudpresenceV2Stop = stop;
  window.addEventListener('pagehide', onPageHide, { once: true });
  window.addEventListener('beforeunload', onPageHide, { once: true });
  window.navigation?.addEventListener('navigate', onNavigate);
  window.navigation?.addEventListener('navigateerror', onNavigationError);
  connect();
  let inFlight = false;
  let pendingVisibility = false;
  function onVisibilityChange() {
    // A known document navigation will retire the worker via onPageHide. Do not
    // let an intermediate hidden snapshot clear its presence before that handoff.
    if (navigation && !navigation.signal?.aborted) return;
    if (inFlight) pendingVisibility = true;
    else void tick();
  }
  const tick = async () => {
    if (ended || inFlight) return;
    if (!allowed()) { void send('presence.clear', { closing: true }).catch(() => {}); stop(); return; }
    inFlight = true;
    try {
      const broker = globalThis.ChudPresenceV2Page;
      if (typeof broker?.collectActivityV2Snapshot !== 'function') throw new Error('V2 page broker is unavailable.');
      await request('sandbox.update', { snapshot: broker.collectActivityV2Snapshot(config.pageAccess, document) });
      reconnectAttempts = 0;
    } catch (error) { if (error?.code !== 'rate_limited') fail(error); }
    finally {
      inFlight = false;
      if (pendingVisibility && !ended) { pendingVisibility = false; void tick(); }
    }
  };
  if (ended) return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  void tick();
  if (!ended) timer = setInterval(() => { void tick(); }, 2000);
}

export function activityV2ScriptDefinition(record) {
  const metadata = record.metadata;
  const config = {
    id: metadata.id, version: metadata.version, capability: record.capability,
    matches: metadata.matches, excludeMatches: metadata.excludeMatches || [],
    frames: metadata.frames || 'top', pageAccess: metadata.pageAccess,
    navigationGraceMs: metadata.presence?.navigationGraceMs || 0,
  };
  return {
    id: `chudpresence-activity-${metadata.id}`,
    worldId: `chudpresence.activity.v2.${metadata.id}`,
    world: 'USER_SCRIPT',
    matches: [...metadata.matches],
    ...(metadata.excludeMatches?.length ? { excludeMatches: [...metadata.excludeMatches] } : {}),
    allFrames: metadata.frames === 'all',
    runAt: 'document_end',
    js: [
      { file: 'core/activity-v2-page.generated.js' },
      { code: `(${runActivityV2.toString()})(${JSON.stringify(config)});` },
    ],
  };
}
