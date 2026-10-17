# ChudPresence for Firefox

This directory is the Firefox source overlay in the same Git repository as Chromium. The build copies the current shared `extension/`, then applies `ChudPresence-Firefox/extension/`. Do not install this overlay directory by itself: use the assembled build below. No separate Activity copies or Firefox Activity repository are needed.

## Build and temporary installation

Use Node **24.21.0** (the exact CI version) and the committed lockfile:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build:all
npm run check:packages
npm run lint:firefox
```

`npm run build` and `build.bat` retain the Chromium default. Explicit targets are `npm run build:chromium`, `npm run build:firefox`, and `npm run build:all`. Builds use the working tree, including edits, rather than exporting HEAD. Each target replaces only its own current-version outputs.

For version 2.0.5 the outputs are:

- `dist/ChudPresence-2.0.5/` and `dist/ChudPresence-2.0.5.zip` for Chromium.
- `dist/ChudPresence-Firefox-2.0.5-unsigned-development/` and `dist/ChudPresence-Firefox-2.0.5-unsigned-development.xpi` for Firefox.

Use **desktop Firefox 153.0 or newer**. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the assembled Firefox folder's `manifest.json` (or the unsigned XPI). Temporary add-ons are removed on browser restart; ordinary permanent installation requires an AMO-signed XPI. The source overlay is intentionally incomplete without the shared files.

Open Activity Library. Installing/enabling an Activity requests Firefox's optional **User Scripts** permission and its declared website/network access from the same click. If needed, the **Allow Activity scripts** dialog requests User Scripts separately. The bundled YouTube Activity installs once permission is available; respect its removal and disabled state. Refresh catalog requests the same official GitHub V1 and V2 catalogs used by Chromium. Playback preview works before Discord login.

## Supported APIs and Firefox architecture

The minimum is intentional: Mozilla compatibility data adds both native [`userScripts.execute`](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/userScripts.json) and [`MessageSender.documentId`](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/runtime.json) in Firefox 153. Earlier releases do not provide the document-targeted execution and ownership required by this runtime. [Firefox 153 release notes](https://www.firefox.com/en-US/firefox/153.0/releasenotes/).

Firefox uses a [nonpersistent MV3 event page](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts), loaded by `background.html`. Shared browser API setup selects Firefox's Promise API namespace. The small Firefox shutdown module hosts the shared V2 worker plumbing in a private background iframe instead of a Chromium offscreen document. Its URL-checked private port, per-document sessions, QuickJS/WASM guest isolation, memory/stack/CPU limits, worker watchdogs, bounded JSON, scoped storage/network services, and credential separation remain shared. Neither package code nor Discord credentials are sent into the other's execution context.

Both V1 and V2 use native isolated per-Activity `USER_SCRIPT` worlds and the dedicated user-script message/port channels. Firefox's [`userScripts` permission is optional-only](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts). Existing URL scope, frame/document ownership, navigation, reload, disable/removal, and stale-report cleanup remain in the shared manager/registry. A bounded Firefox-only `storage.session` checkpoint restores report ownership, retired documents, selection and original stale-report timestamps before processing cold-wake close events or renewal. It contains no OAuth credentials or package source, expires on browser restart, and cannot revive a different installed Activity generation. API versions and `minExtensionVersion` keep their existing meanings; Firefox does not claim capabilities through an older-browser fallback.

Real tab/document close signals still pass `{ closing: true }` through the publisher into `clearSession({ keepalive: true })`. The shared Discord transport retains session tokens until deletion succeeds and reports failed deletions. Ordinary background suspension does not delete presence, including an iframe-host disconnect during suspension. Firefox has no Chromium `fetchLater`/offscreen shutdown backup; setup diagnostics therefore show that backup as unavailable. Browser shutdown, crashes, offline cleanup, and OAuth token-refresh races still need manual assessment. Keepalive is best effort, and a hard process kill cannot guarantee immediate Discord clearing.

## Discord OAuth and add-on identity

The production identity of the existing hidden AMO listing **could not be verified**. The explicit development identity is:

```text
chudpresence-firefox-development@chudforks.local
```

Do not submit this ID as an update to the existing listing. Both older reference repositories use an explicitly experimental `@local` ID, and their available XPIs are unsigned. A cached AMO listing at `chudpresence-solo-experimental` identifies version 1.8.0, but its live page is hidden/404 and the public API requires authentication without exposing the GUID. This is not proof of the production ID.

Before submission, obtain the **exact add-on ID/GUID** from the listing's AMO developer dashboard or a previously signed production XPI's manifest. Replace only the Firefox manifest's `browser_specific_settings.gecko.id` with that verified identity, remove the development suffix from its display name, and choose a version greater than the listing's latest upload. Keep the shared package version and both manifests aligned for release automation. No experimental repository is the implementation base.

Firefox calls [`identity.getRedirectURL()` without arguments](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/getRedirectURL); Chromium retains its `/discord` callback. Copy the **exact OAuth callback shown in Discord setup** and register it with the existing Discord application (`1549066134706323548`) before connecting. The development ID and verified production ID derive different callbacks. PKCE, state validation, authorization-code exchange, credential storage, and session deletion remain shared. An unregistered callback prevents Discord login but not local playback testing.

## Upgrade and settings migration

The Firefox platform migration runs before shared update cleanup or Activity loading. It preserves global `enabled`, existing Activities/settings, developer preferences, scoped Activity storage, OAuth credentials/client identity, and the saved Discord session token. Existing current Activity values take precedence.

Known obsolete provider settings for YouTube, YouTube Music, Crunchyroll, 67Movies, Twitch, and Kick migrate to the official Activity IDs. Provider `ShowPaused`, artwork, timestamps, buttons, and status display move to Activity preferences; legacy global detail booleans are fallback values. Old status labels map `creator/artist/streamer/series` to `artist`, and `video/track/episode/stream` to `track`. A disabled obsolete provider remains disabled on its first Activity installation. Preferences for uninstalled Activities are deferred until the user installs those official packages; the migration does not download or install remote packages. Consumed defaults are removed so modern removal/reinstallation does not revive obsolete settings.

The marker `firefoxSettingsMigrationVersion: 1` makes the migration idempotent. Deferred values live in `firefoxLegacyActivityDefaults`; no extra copy of credentials is made. Unknown old keys remain untouched. A different development add-on ID has separate storage, so a temporary development install cannot prove an in-place production upgrade. Test the production-identity upgrade in an isolated profile with the old signed build and a signed candidate once the identity is verified. Obsolete packages with unrecognized schemas still require inspection; no unverifiable production storage format is silently assumed.

## AMO preparation and signing

The Firefox manifest declares Mozilla's [built-in data-consent categories](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) for authentication and Activities that transmit browsing URLs, playback, public page content, or search terms. It does not claim `none`. Discord sharing remains user initiated; installed Activities can make only their declared brokered network requests. Confirm listing disclosures and categories against the final official catalog and [PRIVACY.md](../PRIVACY.md).

Before updating the existing hidden listing:

1. Verify/set the existing listing ID and an acceptable newer version, then rebuild and rerun every check above.
2. Register the production OAuth callback and test migration using the same add-on ID.
3. Submit the unsigned archive through the **existing listing's** version-upload flow, preserving its intended visibility/distribution. Supply the full matching source checkout, `package-lock.json`, build scripts, schemas, QuickJS source dependency/version and bundled notice as requested for generated-code review. The lockfile and `npm ci --ignore-scripts` reproduce the build; `npm run build:v2-engine` regenerates the checked-in QuickJS/page bundles.
4. Resolve AMO reviewer findings, obtain the signed XPI, and test that signed candidate. Store metadata, privacy disclosures and signing credentials must be supplied through the AMO account. Nothing in the local or GitHub build signs or submits an add-on.

The pinned Mozilla `addons-linter` 10.14.0 runs with warnings treated as failures. No Node development dependencies are bundled in either extension.

## GitHub checks and releases

`.github/workflows/checks.yml` installs the lockfile with exact Node 24.21.0, runs static/generated-contract checks and tests, builds both browsers, verifies archives and shared files, lints Firefox, and uploads both packages as one workflow artifact. Actions are pinned to commit hashes.

`.github/workflows/release.yml` runs only when a deliberately pushed `vX.Y.Z` tag exactly matches `package.json` and both manifests. It runs the same gates and attaches the Chromium ZIP and clearly labeled unsigned Firefox XPI to the **same GitHub Release**. There is no release on ordinary branch pushes. For a future version, update all three version fields, run the checks, commit, and deliberately create/push that version tag when ready. Do not reuse an existing version tag. No push, release publication, signing or AMO submission was performed during this port.

## Manual test checklist

- With a `focusPolicy: 'foreground'` browsing report, open ChudPresence's popup,
  another extension's popup and the address bar. Switch tabs/windows and leave
  Firefox, then return. Check immediate suppression/restoration, popup blur and
  closure, and retained background playback. Both native window and native page
  focus being unavailable for a third-party popup must fail closed.

- Temporarily load the assembled Firefox manifest on 153+, open popup/Activity Library, and check Firefox's extension console for errors.
- Grant/deny User Scripts, catalog and site permissions; install official V1 and V2 packages. Verify preview and all settings, then revoke/regrant access and reload Activities on already-open tabs.
- Exercise SPA navigation, full reload, iframe playback, multiple tabs, paused/ended media, disabled/removed Activities, and stale reports. Verify selection changes and old frames cannot clear a newer document's report.
- Register the exact shown callback, connect Discord, publish, disconnect, and reconnect. Check V2 logs/scoped storage/network denial and that credentials never appear in Activity diagnostics.
- Close a playing tab, the last window, and the browser. Observe immediate clearing and cleanup diagnostics. Test network-failed deletion and verify its session token remains available for retry. Suspend/reawaken an idle background and ensure active presence is not cleared.
- With the verified production ID and signed builds, upgrade from the obsolete version and check migrated enabled/preferences, retained credentials/session token and deferred Activity preferences. Development-ID installs cannot access production-ID storage.

See [PORT_BASELINE.md](PORT_BASELINE.md) for the starting revision and ongoing maintenance process, and [TESTING.md](../TESTING.md) for automated coverage.
