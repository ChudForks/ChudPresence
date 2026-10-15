export function createPresenceClearDelay(callback, {
  delayMs = 1500,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let timer = null;
  return {
    defer() {
      if (timer !== null) return;
      timer = schedule(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timer === null) return;
      cancel(timer);
      timer = null;
    },
  };
}
