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
  ? 'Set up Activities to get started. Activities need the User Scripts permission to detect playback on sites you approve.'
  : 'Allow User Scripts in Chrome settings';
export const USER_SCRIPTS_UNAVAILABLE = isFirefox
  ? 'Activities need desktop Firefox 153 or newer and the User Scripts permission. Open Setup guide from the Activity Library and choose Enable Activities.'
  : 'Chrome does not expose the required userScripts.execute API. Use Chrome 135 or newer; on Chrome 138 or newer, enable Allow User Scripts on the extension details page.';

export function configureUserScriptsDialog(document) {
  if (!isFirefox) return;
  const dialog = document.getElementById('user-scripts-dialog');
  document.getElementById('user-scripts-title').textContent = 'Enable Activities';
  dialog.querySelector('.eyebrow').textContent = 'Permission needed';
  dialog.querySelector('p').textContent = 'An Activity teaches ChudPresence how to read playback from a supported website. Firefox calls the permission to run these Activities “User Scripts”. Without it, your Services list stays empty.';
  const steps = dialog.querySelectorAll('li');
  steps[0].textContent = 'Use Firefox 153 or newer.';
  steps[1].textContent = 'Choose Enable Activities below. In Firefox’s request, review the warning, select “Allow unverified third-party scripts to access your data”, then choose Allow. If you dismiss it, you can try again here.';
  steps[2].textContent = 'The included YouTube Activity will be added automatically. Use Refresh catalog for more Activities, then approve only the websites requested by the ones you install.';
  document.getElementById('open-extension-details').textContent = 'Enable Activities';
}

export const FIREFOX_ONBOARDING_KEY = 'firefoxOnboarding';

/** Register synchronously so Firefox can wake the event page for installation. */
export function registerFirefoxOnboarding(api = browserApi) {
  if (!isFirefox) return;
  api.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    try {
      const stored = await api.storage.local.get(FIREFOX_ONBOARDING_KEY);
      if (stored[FIREFOX_ONBOARDING_KEY]) return;
      await api.tabs.create({ url: api.runtime.getURL('welcome.html') });
      await api.storage.local.set({ [FIREFOX_ONBOARDING_KEY]: { version: 1, completed: false } });
    } catch {
      // Setup remains available from the popup and Library if opening fails.
    }
  });
}

export function openUserScriptsSettings(api = browserApi) {
  if (isFirefox) return api.permissions.request({ permissions: ['userScripts'] });
  return api.tabs.create({ url: `chrome://extensions/?id=${encodeURIComponent(api.runtime.id)}` });
}
