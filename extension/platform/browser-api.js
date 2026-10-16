// Firefox's browser namespace supplies Promise APIs. Keep the existing shared
// chrome call sites on those APIs, including popup and trusted worker host pages.
export const isFirefox = typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';
export const browserApi = isFirefox ? globalThis.browser : globalThis.chrome;
if (isFirefox) globalThis.chrome = browserApi;

let backgroundSuspending = false;
if (isFirefox) {
  browserApi.runtime.onSuspend?.addListener(() => { backgroundSuspending = true; });
  browserApi.runtime.onSuspendCanceled?.addListener(() => { backgroundSuspending = false; });
  // A child worker-host frame can disconnect while its parent event page is
  // unloading. That is a lifecycle transition, not an Activity sandbox failure.
  if (globalThis.location?.pathname === '/background.html') {
    globalThis.addEventListener('pagehide', () => { backgroundSuspending = true; });
  }
}
export function isBackgroundSuspending() { return backgroundSuspending; }

export const USER_SCRIPTS_REQUIRED = isFirefox
  ? 'Allow Activity scripts in Firefox'
  : 'Allow User Scripts in Chrome settings';
export const USER_SCRIPTS_UNAVAILABLE = isFirefox
  ? 'Activity scripts require Firefox 153 or newer and the optional User Scripts permission. Choose Allow Activity scripts in the Activity Library.'
  : 'Chrome does not expose the required userScripts.execute API. Use Chrome 135 or newer; on Chrome 138 or newer, enable Allow User Scripts on the extension details page.';

export function configureUserScriptsDialog(document) {
  if (!isFirefox) return;
  const dialog = document.getElementById('user-scripts-dialog');
  dialog.querySelector('.eyebrow').textContent = 'Firefox permission';
  dialog.querySelector('p').textContent = 'Allow ChudPresence to run the Activities you install on websites you approve.';
  const steps = dialog.querySelectorAll('li');
  steps[0].textContent = 'Use Firefox 153 or newer.';
  steps[1].textContent = 'Choose Allow Activity scripts below and approve Firefox’s User Scripts permission.';
  steps[2].textContent = 'Install an Activity and approve its website permissions. Existing tabs are detected automatically.';
  document.getElementById('open-extension-details').textContent = 'Allow Activity scripts';
}

export function openUserScriptsSettings(api = browserApi) {
  if (isFirefox) return api.permissions.request({ permissions: ['userScripts'] });
  return api.tabs.create({ url: `chrome://extensions/?id=${encodeURIComponent(api.runtime.id)}` });
}
