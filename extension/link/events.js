// Fetch-based SSE keeps the bearer token in a header, never in an event URL.
export function createLinkEvents({ open, onRevision, onError, schedule = setTimeout, cancel = clearTimeout,
  idleMs = 150_000 } = {}) {
  let running = false;
  let connection = null;
  let opening = null;
  let reconnectTimer = null;
  let idleTimer = null;
  let backoff = 1000;

  function stop() {
    running = false;
    if (reconnectTimer !== null) cancel(reconnectTimer);
    if (idleTimer !== null) cancel(idleTimer);
    reconnectTimer = idleTimer = null;
    connection?.abort();
    connection = null;
    opening = null;
  }

  function touch(controller) {
    if (idleTimer !== null) cancel(idleTimer);
    idleTimer = schedule(() => controller.abort(), idleMs);
    idleTimer?.unref?.();
  }

  async function consume(response, controller) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let event = '';
    let data = [];
    function line(value) {
      if (!value) {
        if (data.length) onRevision(event || 'message', data.join('\n'));
        event = ''; data = [];
      } else if (!value.startsWith(':')) {
        const colon = value.indexOf(':');
        const field = colon < 0 ? value : value.slice(0, colon);
        const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = content;
        if (field === 'data') data.push(content);
      }
    }
    try {
      touch(controller);
      while (running && connection === controller) {
        const { value, done } = await reader.read();
        if (done) break;
        touch(controller);
        pending += decoder.decode(value, { stream: true });
        // Hints are tiny. Bound incomplete lines and events from a bad peer.
        if (pending.length + data.join('').length > 64 * 1024) throw new Error('Invalid Link event stream.');
        let match;
        while ((match = /\r\n|\r|\n/.exec(pending))) {
          if (match[0] === '\r' && match.index === pending.length - 1) break;
          const value = pending.slice(0, match.index);
          pending = pending.slice(match.index + match[0].length);
          line(value);
          if (!running || connection !== controller) return;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function disconnected(error, controller) {
    if (!running || connection !== controller) return;
    if (idleTimer !== null) cancel(idleTimer);
    idleTimer = null;
    connection = null;
    controller.abort();
    if (onError(error) === false) { stop(); return; }
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      void start();
    }, backoff);
    reconnectTimer?.unref?.();
    backoff = Math.min(backoff * 2, 30_000);
  }

  function start() {
    running = true;
    if (opening) return opening;
    if (connection || reconnectTimer !== null) return Promise.resolve();
    const controller = new AbortController();
    connection = controller;
    const attempt = (async () => {
      try {
        const response = await open(controller);
        if (!running || connection !== controller) { controller.abort(); return; }
        // Reset only after receiving data, so an immediately closed connection
        // still backs off rather than opening a stream every second.
        const read = consume(response, controller);
        void read.then(() => disconnected(new Error('Link event stream closed.'), controller),
          error => disconnected(error, controller));
      } catch (error) { disconnected(error, controller); }
    })();
    opening = attempt;
    void attempt.finally(() => { if (opening === attempt) opening = null; });
    return attempt;
  }

  return Object.freeze({ start, stop, received() { backoff = 1000; } });
}
