# ChudPresence Chromium Activity Lab

This repository contains the **1.9.0 Manifest V3 Chromium development extension** for Activity API V1. It installs playback Activities, selects the current media, shows a local presence preview, and optionally publishes it to Discord. It is a separate development build from the original ChudPresence Solo Chrome release.

The previous declarative V2 implementation is retained as a [historical reference](references/legacy-activity-api-v2/README.md), including all five Activities, their presence construction, tests, and migration findings. The active extension has returned to the last baseline before V2 was introduced. A replacement V2 has not been implemented.

## The repositories in this workspace

| Checkout | Responsibility |
| --- | --- |
| This repository | Chromium runtime, Activity Library, popup, permissions, settings, Discord authorization and publishing, schemas, tests, and local packaging |
| [`ChudPresence-Activities/`](ChudPresence-Activities/README.md) | Official first-party packages, generated catalog, canonical V1 contract and SDK types, authoring CLI, shared artwork, and package validation |
| [`ChudPresence-Activities-V2/`](ChudPresence-Activities-V2/README.md) | Historical declarative V2 packages and tooling, preserved for reference until replacement Activities are available |

`ChudPresence-Activities/` is a separate Git checkout ignored by this repository, not a submodule or part of the extension build. Its checked-out catalog contains **67Movies, Crunchyroll, Disney+, Hulu, Kick, SoundCloud, Twitch, YouTube, and YouTube Music**. Discover fetches the official `ChudForks/ChudPresence-Activities` catalog from GitHub; editing the local checkout does not change Discover. Use Developer mode to test local packages.

The extension bundles a copy of the YouTube Activity for the first install. Once user scripts are available, it installs automatically. Disabling it is preserved across bundled updates; removing it prevents automatic reinstallation. Other Activities are installed through the Library.

## Run locally

1. Use Chrome or another Chromium browser based on version 135 or newer. Open its extensions page (`chrome://extensions` in Chrome), enable **Developer mode**, and select **Load unpacked**.
2. Select this repository's `extension/` directory and open **Activity Library** from the popup.
3. On Chrome 138 or newer, open the extension's details page and enable **Allow User Scripts**, then reload the Library. Earlier supported Chrome versions use Developer mode. The Library reports API availability and missing website permissions.
4. Use **Refresh catalog** in Discover and approve access to the GitHub API and raw-file origins. Opening the Library initially reads its cached catalog. YouTube appears in Installed once user scripts are available; install the other Activities, including Hulu, from Discover. Approve their declared HTTPS website and network origins. 67Movies requests The Movie Database's API origin; Hulu declares its own series and movie page paths for artwork lookups.
5. Play media and inspect the popup's **Local playback diagnostics** and presence preview. Enable developer tools in the Library's Developer view for reports, clears, frame/document ownership, settings, permissions, logs, and network diagnostics.

In **Developer**, enable developer tools to open **Activity logs**. Choose one Activity or all, then filter Activity logs, network requests, or playback/runtime snapshots and log levels. **Copy visible** copies the filtered text; **Select all** prepares it for manual copying. Focusing the text area holds its view during refresh, and **Pause updates** freezes a snapshot while new diagnostics continue collecting. **Clear history** resets the selected Activity's diagnostic history (or all history with All Activities selected) while playback, settings, and running requests continue. Installed cards offer **View logs** to open an Activity directly.

To load a local package, enable developer tools and select its `metadata.json`, `activity.js`, and `icon.png` when declared, for example from `ChudPresence-Activities/activities/hulu/`. After editing or rebuilding a local package, select its files again and use **Load local Activity** to replace the installed source. **Reload Activity** reruns the stored package in its active documents. Website permissions are still required.

Disney+ is available locally in `ChudPresence-Activities/activities/disney-plus/`.
Load its three package files through Developer mode and approve Disney+ website
access. It presents episodes like Hulu: episode title first, series second,
season/episode artwork text, playback progress, and watch/service buttons.
The package uses API v1's page bridge for Disney's custom player metadata and
timeline and also supports ordinary video metadata on legacy `/video/` routes.
Live Disney+ playback still needs browser verification; local tests use synthetic
player fixtures.

The popup lists installed Activities dynamically. Settings provides a global **Enable Activity Lab** switch and per-Activity enable, paused playback, status text, artwork, progress, and button preferences. Activity-defined settings are managed in the Library. Playing media takes priority over paused media, and the selected tab stays selected while eligible. Non-normal visibility produces no presence.

## Optional Discord connection

Playback detection and the local presence preview work without Discord. To publish, connect through the popup while **Enable Activity Lab** is on; sharing is enabled by default. The build uses the fixed public application ID `1549066134706323548`.

For an unpacked install, obtain the callback by opening the extension's service-worker DevTools from the extensions page and evaluating:

```js
chrome.identity.getRedirectURL('discord')
```

Register that exact callback for the application's OAuth setup in the Discord Developer Portal with **Public Client** enabled. The callback depends on the lab's actual extension ID. Discord publishing uses an experimental Headless Sessions transport.

Activity-authored song, artist, and album links can make Discord text and artwork clickable. During ordinary playback transitions, an empty presence is delayed to avoid flicker. Document exit and tab closure trigger immediate cleanup; a private offscreen document also keeps deferred deletion, when supported, and a document-exit keepalive fallback armed. The popup shows **Browser-close backup** and **Last Discord clear**. Failed deletions retain the session token for retries. The recorded Brave window-close check and its limits are in [TESTING.md](TESTING.md).

## Development gates

Use Node.js 20 or newer as declared by both repositories; the latest checks used Node.js 24.21.0. The extension has no npm dependencies to install. Run from this repository:

```sh
npm run check
npm test
npm run build
```

Run the package checks separately from the Activities checkout:

```sh
cd ChudPresence-Activities
npm ci
npm run check:contract
npm run check:catalog
npm run typecheck
npm test
node tools/check-version-bumps.mjs
```

The version-bump gate accepts `--base=<ref>` and otherwise uses GitHub event/base environment variables or `HEAD^`; use the intended review base. See the [Activities README](ChudPresence-Activities/README.md) and [verification record](TESTING.md) for the existing metadata/version discrepancy in this checkout.

`npm run check` validates the extension manifest and JavaScript, local contract outputs, and bundled YouTube files. When the Activities checkout is present, it also checks its generated contract and catalog hashes, compares canonical contract copies, and verifies bundled YouTube parity. Changes to the canonical contract belong in the Activities repository. Run `node tools/generate-api-contract.mjs` there to regenerate its outputs; in this workspace layout it also refreshes the lab's contract, schemas, and runtime constants. For standalone checkouts, synchronize those copies separately.

`npm run build` replaces `dist/` with `ChudPresence-Chromium-Activity-Lab-1.9.0/` and its zip. A system `tar` executable is required for packaging. On Windows, `build.bat` runs the same three extension gates. Load `extension/` directly while debugging. `dist/`, `baseline/`, `browser-profiles/`, and the Activities checkout are ignored here. Building performs no publication.

See [architecture](ARCHITECTURE.md), [the Activity API guide](extension/ACTIVITY_API.md), [verification results](TESTING.md), [privacy details](PRIVACY.md), [the original baseline](BASELINE.md), and [porting status and remaining checks](PORTING_PLAN.md). Activity API V1 is intended for trusted first-party packages.
