import { LinkError } from './client.js';

export const LINK_PUBLISHER_KEY = 'chudpresenceLinkPublisher';
export const LINK_POLL_ALARM = 'chudpresence-link-poll';
const POLL_MS = 10_000;
const UPDATE_MS = 5_000;
const STATUS_MS = 1_500;
const FALLBACK_MS = 35_000;

// Link bounds UTF-8 bytes; the shared headless formatter bounds characters.
function byteText(value, limit) {
  const encoder = new TextEncoder();
  let result = '';
  for (const character of String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()) {
    if (encoder.encode(result + character).length > limit) break;
    result += character;
  }
  return result;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 256) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 256 ? url.href : undefined;
  } catch { return undefined; }
}

export function desktopIntent(intent) {
  if (!intent) return null;
  const result = { name: byteText(intent.name, 128), details: byteText(intent.details, 128),
    type: ['playing', 'listening', 'watching', 'competing', 'streaming'].includes(intent.type) ? intent.type : 'playing',
    statusDisplayType: ['name', 'state', 'details'].includes(intent.statusDisplayType) ? intent.statusDisplayType : 'name' };
  if (intent.state) result.state = byteText(intent.state, 128);
  for (const field of ['detailsUrl', 'stateUrl']) if (httpsUrl(intent[field])) result[field] = httpsUrl(intent[field]);
  const start = intent.timestamps?.start;
  const end = intent.timestamps?.end;
  if (Number.isSafeInteger(start) && start >= 0) {
    result.timestamps = { start, ...(Number.isSafeInteger(end) && end >= start ? { end } : {}) };
  }
  if (intent.assets) {
    const assets = {};
    for (const field of ['largeImage', 'largeUrl', 'smallImage']) if (httpsUrl(intent.assets[field])) assets[field] = httpsUrl(intent.assets[field]);
    for (const field of ['largeText', 'smallText']) if (intent.assets[field]) assets[field] = byteText(intent.assets[field], 128);
    if (Object.keys(assets).length) result.assets = assets;
  }
  if (Array.isArray(intent.buttons)) {
    result.buttons = intent.buttons.slice(0, 2).map(button => ({ label: byteText(button.label, 32), url: httpsUrl(button.url) }))
      .filter(button => button.label && button.url);
  }
  return result;
}

/** The only owner of headless/desktop handoffs, writes, and renewal. */
export function createLinkPublisher({ headless, client, storage, now = Date.now,
  monotonic = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
  let initialization;
  let queue = Promise.resolve();
  let hooks = {};
  let lease = null;
  let sequence = 0;
  let acquireAfter = 0;
  let lastDesktopAt = -Infinity;
  let lastDesktopHadIntent = false;
  let pendingDesktop = null;
  let updateTimer = 0;
  let statusTimer = 0;
  let timer = 0;
  let timerAt = 0;
  let guard = false;
  let quarantined = false;
  let recovery = '';
  let fallbackAt = 0;
  let localStatus = null;
  let transport = 'headless';
  let note = '';
  const enqueue = operation => (queue = queue.catch(() => {}).then(operation));
  const saveGuard = () => storage.set({ [LINK_PUBLISHER_KEY]: { guarded: guard, recordedAt: now() } });

  async function initialize() {
    if (!initialization) initialization = (async () => {
      await Promise.all([client.initialize(), headless.initialize()]);
      const saved = (await storage.get(LINK_PUBLISHER_KEY))[LINK_PUBLISHER_KEY];
      if (saved?.guarded) {
        // Worker death loses the monotonic clock and may lose a response. A
        // full window after wake prevents wall-clock changes shortening it.
        guard = true; quarantined = true; fallbackAt = monotonic() + FALLBACK_MS;
        recovery = 'startup'; transport = 'waiting';
      }
      schedulePoll();
    })().catch(error => { initialization = null; throw error; });
    return initialization;
  }

  function schedulePoll() {
    if (!client.ready() && !guard) { if (timer) cancel(timer); timer = 0; return; }
    const remaining = quarantined ? Math.max(1, fallbackAt - monotonic()) : POLL_MS;
    const delay = Math.min(POLL_MS, remaining);
    if (timer && timerAt <= monotonic() + delay) return;
    if (timer) cancel(timer);
    timerAt = monotonic() + delay;
    timer = schedule(() => { timer = 0; void refresh().catch(() => {}); }, delay);
  }

  async function armGuard() {
    guard = true;
    await saveGuard(); // Survive worker termination before a response.
  }

  async function clearGuard() {
    cancelDesktopUpdate();
    cancelStatusCheck();
    lease = null; guard = false; quarantined = false; fallbackAt = 0; localStatus = null;
    recovery = '';
    await saveGuard();
  }

  async function quarantine(error) {
    cancelDesktopUpdate();
    cancelStatusCheck();
    lease = null; transport = 'waiting'; quarantined = true; guard = true;
    recovery = 'connection-lost';
    // Called AFTER the request has completed or its bounded timeout fired.
    fallbackAt = monotonic() + FALLBACK_MS;
    note = error?.message || 'The local Discord connection was interrupted.';
    await saveGuard();
  }

  async function release() {
    cancelDesktopUpdate();
    cancelStatusCheck();
    if (!lease) return false;
    const id = lease.leaseId;
    try {
      await client.request(`/v1/presence/lease/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await clearGuard();
      return true;
    } catch (error) {
      if (error.code === 'lease_lost') { await clearGuard(); return true; }
      await quarantine(error);
      return false;
    }
  }

  function cancelDesktopUpdate() {
    if (updateTimer) cancel(updateTimer);
    updateTimer = 0;
    pendingDesktop = null;
  }

  function deferDesktop(intent, applicationId, options) {
    pendingDesktop = { intent, applicationId, options };
    if (!updateTimer) updateTimer = schedule(() => {
      updateTimer = 0;
      void enqueue(async () => {
        const next = pendingDesktop;
        pendingDesktop = null;
        if (next) await route(next.intent, next.applicationId, next.options);
      }).catch(() => {});
    }, Math.max(1, lastDesktopAt + UPDATE_MS - monotonic()));
  }

  function cancelStatusCheck() {
    if (statusTimer) cancel(statusTimer);
    statusTimer = 0;
  }

  function scheduleStatusCheck() {
    if (statusTimer || !lease || transport !== 'local' || !lastDesktopHadIntent || localStatus?.published) return;
    const expectedLease = lease.leaseId;
    statusTimer = schedule(() => {
      statusTimer = 0;
      void enqueue(async () => {
        if (lease?.leaseId !== expectedLease || transport !== 'local') return;
        try {
          // Acceptance precedes Link's asynchronous RPC publish. Read status
          // without another PUT, which would mark the activity pending again.
          localStatus = await client.request('/v1/status');
          if (!localStatus?.discordConnected) {
            note = 'Desktop Discord disconnected. Using the headless connection.';
            if (await release()) {
              const current = await hooks.currentPresence?.();
              if (current) await route(current.intent, current.applicationId);
            }
          } else scheduleStatusCheck();
        } catch (error) { await quarantine(error); }
        schedulePoll();
      }).catch(() => {});
    }, STATUS_MS);
  }

  function status() {
    const fallback = headless.status();
    const link = client.status();
    const remaining = quarantined ? Math.max(0, Math.ceil((fallbackAt - monotonic()) / 1000)) : 0;
    const delivery = transport === 'local'
      ? { ...fallback, id: 'chudpresence-link', state: !lastDesktopHadIntent ? 'connected' : localStatus?.published ? 'active' : 'accepted',
          available: localStatus?.discordConnected === true, authenticated: true,
          message: !lastDesktopHadIntent ? 'Connected through ChudPresence Link. No activity to share.'
            : localStatus?.published ? 'Sharing through local Discord with ChudPresence Link.' : 'Local Discord accepted the activity; waiting for publication.' }
      : transport === 'waiting'
        ? { ...fallback, id: 'chudpresence-link', state: recovery === 'startup' ? 'startup-wait' : 'fallback-wait', available: false,
            message: recovery === 'startup' ? `Waiting for the previous local session to clear safely. ${remaining}s remaining.`
              : `Local Discord disconnected. Resuming presence in ${remaining}s.` }
        : transport === 'idle'
          ? { ...fallback, id: 'chudpresence-link', state: 'waiting-for-activity', available: false,
              message: 'Connected to Link. Local Discord starts when there is activity to share.' }
          : fallback;
    return { ...delivery, headlessAuthenticated: fallback.authenticated === true,
      link: { ...link, transport, recovery, fallbackSeconds: remaining, publishingMessage: note,
        hasPresence: transport === 'local' && lastDesktopHadIntent,
        discordConnected: localStatus?.discordConnected === true, published: localStatus?.published === true } };
  }

  async function route(intent, applicationId, options = {}) {
    if (quarantined) {
      if (monotonic() < fallbackAt) { transport = 'waiting'; return status(); }
      await clearGuard();
    }
    if (lease && (!client.ready() || !client.status().connected)) {
      await quarantine(new LinkError());
      return status();
    }
    if (client.ready() && client.status().connected && (intent || lease) && (lease || monotonic() >= acquireAfter)) {
      if (!lease) {
        try {
          await armGuard();
          const acquired = await client.request('/v1/presence/lease', { method: 'POST', body: {} });
          if (!acquired?.leaseId || acquired.heartbeatSeconds !== 10 || acquired.fallbackGraceSeconds !== 5) throw new LinkError('incompatible');
          lease = acquired; sequence = 0;
        } catch (error) {
          note = error.message;
          if (['discord_unavailable', 'publisher_busy', 'unauthorized', 'identity_changed', 'origin_denied',
            'desktop_browser_only', 'local_network_only', 'rate_limited'].includes(error.code)) {
            await clearGuard();
            acquireAfter = monotonic() + POLL_MS;
          }
          else { await quarantine(error); return status(); }
        }
        if (lease) {
          try {
            // Cleanup errors must prevent desktop publication. Cancellation
            // covers queued headless writes, retries, and renewal as well.
            await headless.suspend();
          } catch {
            note = 'Headless cleanup could not finish. Keeping the headless connection.';
            if (!await release()) return status();
          }
        }
      }
      if (lease) {
        if (monotonic() - lastDesktopAt < UPDATE_MS) {
          if (intent) deferDesktop(intent, applicationId, options);
          else if (!lastDesktopHadIntent) { cancelDesktopUpdate(); return status(); }
          if (intent) return status();
        }
        cancelDesktopUpdate();
        cancelStatusCheck();
        try {
          await armGuard();
          const renewed = await client.request('/v1/presence', { method: 'PUT', keepalive: options.closing === true,
            body: { leaseId: lease.leaseId, sequence: sequence++, intent: desktopIntent(intent) } });
          if (renewed?.leaseId !== lease.leaseId) throw new LinkError('incompatible');
          lease = renewed;
          lastDesktopAt = monotonic();
          lastDesktopHadIntent = Boolean(intent);
          localStatus = await client.request('/v1/status');
          if (!localStatus?.discordConnected) {
            note = 'Desktop Discord disconnected. Using the headless connection.';
            if (!await release()) return status();
          } else {
            transport = 'local'; note = '';
            scheduleStatusCheck();
            return status();
          }
        } catch (error) {
          if (error.code === 'lease_lost') await clearGuard();
          else { await quarantine(error); return status(); }
        }
      }
    }
    const fallback = await headless.publish(intent, applicationId, options);
    transport = !intent && client.ready() && client.status().connected && fallback?.state !== 'error' ? 'idle' : 'headless';
    if (fallback?.state === 'error') note = fallback.message;
    if (transport === 'idle') note = '';
    return status();
  }

  async function refreshPass() {
    await initialize();
    const hadLease = Boolean(lease || guard);
    // Heartbeat before settings I/O so a slow sync cannot consume the lease.
    if (hadLease) {
      const current = await hooks.currentPresence?.();
      if (current) await route(current.intent, current.applicationId);
    }
    try { await client.sync(); } catch (error) { note = error.message; }
    if (!hadLease) {
      const current = await hooks.currentPresence?.();
      if (current) await route(current.intent, current.applicationId);
    } else if (lease && !client.status().connected) await quarantine(new LinkError());
    schedulePoll();
    return status();
  }

  function refresh() { return enqueue(refreshPass); }

  return Object.freeze({
    initialize, status, refresh,
    configure(value) { hooks = value; client.configure(value); },
    async publish(intent, applicationId, options) {
      return enqueue(async () => {
        await initialize();
        const result = await route(intent, applicationId, options);
        schedulePoll();
        return result;
      });
    },
    async renew() {
      return enqueue(async () => {
        await initialize();
        if (lease || guard || client.ready()) return refreshPass();
        await headless.renew();
        return status();
      });
    },
    // Interactive OAuth can take minutes. Headless has its own write queue;
    // account controls must not block the active desktop lease's heartbeat.
    async connect() { await initialize(); await headless.connect(); return status(); },
    async disconnect() { await initialize(); await headless.disconnect(); return status(); },
    setup: () => headless.getSetup(),
    editPreference: (...args) => client.editPreference(...args),
    inventoryChanged: () => client.inventoryChanged(),
    async pair(value) {
      return enqueue(async () => {
        await initialize();
        if (lease && !await release()) throw new Error('Wait for the previous local presence to clear before pairing again.');
        await client.pair(value);
        return refreshPass();
      });
    },
    async unpair() {
      return enqueue(async () => {
        await initialize();
        if (lease) await release();
        const result = await client.unpair();
        if (result.revoked) await clearGuard();
        const current = await hooks.currentPresence?.();
        if (current) await route(current.intent, current.applicationId);
        schedulePoll();
        return status();
      });
    },
    async setSync(value) {
      return enqueue(async () => { await initialize(); await client.setSync(value); return status(); });
    },
  });
}
