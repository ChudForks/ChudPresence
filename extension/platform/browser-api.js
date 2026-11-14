// Firefox's browser namespace supplies Promise APIs. Keep the existing shared
// chrome call sites on those APIs, including popup and trusted worker host pages.
export const isFirefox = typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';
export const browserApi = isFirefox ? globalThis.browser : globalThis.chrome;
if (isFirefox) globalThis.chrome = browserApi;

function detectBrowserName() {
  if (isFirefox) return 'Firefox';
  const navigator = globalThis.navigator;
  const brands = navigator?.userAgentData?.brands || [];
  const hasBrand = name => brands.some(({ brand }) => brand === name);
  if (hasBrand('Microsoft Edge') || /\bEdg\//.test(navigator?.userAgent || '')) return 'Edge';
  // Brave shares Chrome's UA string, but exposes its own brand and navigator API.
  // Keep detection synchronous so background event listeners register immediately.
  if (hasBrand('Brave') || typeof navigator?.brave?.isBrave === 'function') return 'Brave';
  if (hasBrand('Google Chrome') || (!brands.length && /\bChrome\//.test(navigator?.userAgent || ''))) return 'Chrome';
  return 'Chromium';
}

export const browserName = detectBrowserName();
export const extensionsPageUrl = `${browserName === 'Edge' ? 'edge' : browserName === 'Brave' ? 'brave' : 'chrome'}://extensions`;

export function configureBrowserLabels(document) {
  for (const element of document.querySelectorAll('[data-browser-name]')) element.textContent = browserName;
  for (const element of document.querySelectorAll('[data-extensions-page]')) element.textContent = extensionsPageUrl;
}

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
  : `Allow User Scripts in ${browserName} settings`;
export const USER_SCRIPTS_SETTINGS_HINT = 'Open this extension’s Details and turn on Allow User Scripts. If that setting is missing in an older browser version, turn on Developer mode on the Extensions page instead.';
export const USER_SCRIPTS_UNAVAILABLE = isFirefox
  ? 'Activities need desktop Firefox 153 or newer and the User Scripts permission. Open Setup guide from the Activity Library and choose Enable Activities.'
  : `${browserName} does not expose the required userScripts.execute API. Use an up-to-date browser based on Chromium 135 or newer. ${USER_SCRIPTS_SETTINGS_HINT}`;

export function configureUserScriptsDialog(document) {
  if (!isFirefox) {
    configureBrowserLabels(document);
    document.getElementById('open-extension-details').textContent = `Open ${browserName} Extensions`;
    return;
  }
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

/** Register synchronously so the browser can wake the background for installation. */
export function registerOnboarding(api = browserApi) {
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

export function registerFirefoxOnboarding(api = browserApi) {
  if (isFirefox) registerOnboarding(api);
}

export function openUserScriptsSettings(api = browserApi) {
  if (isFirefox) return api.permissions.request({ permissions: ['userScripts'] });
  return api.tabs.create({ url: `${extensionsPageUrl}/?id=${encodeURIComponent(api.runtime.id)}` });
}
