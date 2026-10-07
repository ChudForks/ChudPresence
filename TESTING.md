# Chromium Activity Lab verification

## Current automated gates (October 2, 2026)

The documentation refresh checked the current working trees with Node.js 24.21.0 and npm 11.19.0. The lab is version 1.9.0 at committed base `2d59909`, including the existing uncommitted browser-close changes. The separate Activities checkout is at `ec0341a` with seven catalog packages. These checks do not constitute new browser verification.

| Repository | Gate | Result |
| --- | --- | --- |
| Chromium lab | `npm run check` | Passed manifest and extension syntax, shared contract, catalog hashes, and bundled YouTube parity |
| Chromium lab | `npm test` | 158 tests passed |
| Chromium lab | `npm run build` | Passed; unpacked 1.9.0 build and zip written under `dist/` |
| Activities | `npm run check:contract` | Passed generated schemas, runtime constants, and TypeScript definitions |
| Activities | `npm run check:catalog` | Passed metadata and hashes for seven packages |
| Activities | `npm run typecheck` | Passed |
| Activities | `npm test` | 25 top-level tests passed, including a scaffold test that runs its generated package test |
| Activities | `node --check` for each `activity.js` | Passed for all seven official packages |
| Activities | `node tools/check-version-bumps.mjs` | Failed against the default `HEAD^` base; existing Crunchyroll and Hulu metadata changes lack version increases |

In Activities commit `ec0341a`, Crunchyroll and Hulu changed their metadata category from `streaming` to `video` while retaining versions `1.0.8` and `1.0.9`. The version-bump gate requires an increase for changed package files; documentation edits do not resolve it. The script accepts `--base=<ref>`, also reads GitHub event/base environment variables, and otherwise uses `HEAD^`. It finds changed package paths between the merge base and `HEAD`, then compares each working-tree version with the base version. Choose the actual review base. The other passing checks do not establish that this version gate or the full workflow passes.

The Activities SDK scaffold test rebuilds the catalog as part of its exercise. Its original catalog bytes were restored after this run; no generated or package files were changed by the documentation refresh. Existing lab source changes and the recorded browser findings below were preserved.

## Initial automated gates (September 23, 2026)

On September 23, 2026, the lab passed `npm run check`, `npm test` (67 tests), and `npm run build`. The separate local `ChudPresence-Activities` copy passed `npm run check:contract`, `npm run check:catalog`, `npm run typecheck`, and `npm test` (4 tests). The original checkout remained at `3e3ff9acda7b0377e9e2bbea85c33a30c3be849c` with a clean working tree.

## Initial Chromium browser check (September 23, 2026)

Microsoft Edge 153 loaded the unpacked lab extension and its MV3 service worker. A clean profile showed the Library's **Allow User Scripts** guidance until the extension details toggle was enabled. With the toggle enabled, the Library reported an available user-script runtime.

In an isolated integration profile, the local Crunchyroll and YouTube Music packages installed as separate `USER_SCRIPT` registrations. Synthetic pages served at their real HTTPS origins through Chrome DevTools Protocol exercised the actual injected Activity code and service worker. The browser accepted a playing episode, a paused episode, and an ad report. The ad produced no final presence intent. Closing and reopening a tab, navigating to another episode in the same tab, switching to YouTube Music and back, and stopping the MV3 worker all produced the expected current Activity and intent. The same document reconnected and restored its report after the worker stopped. Activity reload reinjected the current document; removal unregistered its script and cleared its intent. An extension reload restored both installed registrations.

The integration profile pregranted the two Activity origins in a temporary copy of the manifest so headless Chromium would not stall on a permission prompt. The shipping lab manifest keeps those origins optional and requests them during installation. The clean profile confirmed the permission guidance, but interactive approval of each origin still needs a headed browser check.

Synthetic playback validates the Chromium port and message flow, not the current live Crunchyroll or YouTube Music player DOM. Before publishing, load `extension/` in a normal Chrome profile, grant each requested origin, and repeat the playing, paused, ad, navigation, and worker restart checks while signed in to the services. Discord publishing was outside this playback gate.

## Browser-close regression (October 2, 2026)

**Verified in the user's live Brave browser:** after reloading ChudPresence and the YouTube Music tab, the user closed all Brave windows using the window close button, left Brave closed for the requested 30-second observation, and confirmed that the Discord activity cleared. The original test had reproduced a paused YouTube Music activity remaining visible after full browser closure; the Discord profile card and native window inventory independently confirmed that failure.

The generated Activity runtime now sends a closing clear before running document-exit cleanup callbacks. The manager forwards the closing flag to immediate keepalive publication. This bypasses the normal 250 ms publish debounce and 1.5 second transient-clear delay: previously, an Activity clear could remove its report from the registry while leaving deletion queued, and the subsequent tab-removal handler would skip immediate cleanup because the report was already gone. Ordinary playback clears retain their delay, and late clears cannot remove a replacement document's report.

The deletion request starts before waiting for intent storage. The private offscreen document also retains a `pagehide`/`fetch` keepalive fallback when `fetchLater` is missing or cannot schedule a request; normal cleanup explicitly disarms that fallback before closing its document. The popup's **Browser-close backup** row reported **Armed (deferred + exit fallback)** in the live Brave session. Its persisted **Last Discord clear** records the source, time, outcome, and HTTP status of the last deletion attempt without credentials or response bodies.

`npm run check`, `npm test` (158 tests), and `npm run build` passed for the final code. Regression tests cover document-exit ordering, immediate publication, ordinary transient clears, failed deletion retention and retries, and offscreen fallback behavior. The live result verifies the tested Brave window-close flow; it does not establish crash recovery or behavior in other browsers.

## YouTube Music background timing regression (October 7, 2026)

The local YouTube Music package is now version 1.0.12. Live read-only inspection in the user's Brave tab reproduced a cumulative playlist timeline: Beneath the Mask displayed `3:00 / 4:38`, while the video element reported approximately `662.884 / 759.898` seconds at playback rate 1. Its seek slider exposed song-relative `aria-valuenow=180` and `aria-valuemax=278`, despite empty `value` and `max` properties. The next song displayed `4:13 / 7:47` while the video reported approximately `1013.884 / 1139.276` seconds. The page-player timing getters were unavailable in this live player.

The package now reads the seek slider's attributes, retains its duration for the confirmed song, and calibrates an offset between its relative position and the cumulative media clock. Audio advances the position when background rendering freezes, while additional playlist buffering cannot extend the song's duration. A confirmed new song gets a new offset and duration. Preloaded slider resets cannot restart the old song before its audio changes; real seeks, repeats, and delayed media-clock resets still recover. Temporary disappearance of the slider retains the calibrated clock.

The existing page-player and bar fallbacks remain available when no seek control has been observed. Missing player values remain unknown rather than becoming position zero. Early URL changes, next-song metadata, and stale clocks preserve the last confirmed song until its replacement is ready. Reads completing after navigation are discarded. New songs can report immediately; timing corrections suppressed by the Activity's short report interval schedule another read.

The Discord publisher retains the latest deferred intent and schedules its delivery. Activity changes and timestamp corrections of at least three seconds use the existing 4.2-second minimum interval, while ordinary timestamp jitter retains the 12-second interval. Server `retry_after` still takes precedence, and clearing presence cancels a pending update.

The extension passed all 162 tests; its existing build is unchanged by this package correction. The Activities checkout passed all 45 top-level tests and type checking; shared contract and catalog validation passed. Nine new regressions cover the observed cumulative playlist values, fixed duration during buffering, background slider freezes, consecutive song changes, early slider resets, real seeks and repeats, missing controls, ended media, and delayed media-timeline changes. The earlier timing and Discord delivery regressions still pass. These are automated checks; the corrected package has not been verified in the live Discord card. Browser control rejected the extension Library URL because its policy permits only HTTP and HTTPS pages, so the updated local package could not be installed through the available browser UI tools.

To apply the local fix, load `metadata.json`, `activity.js`, and `icon.png` together from `ChudPresence-Activities/activities/youtube-music/` in the Library's Developer view, then refresh YouTube Music. An extension reload alone does not replace the installed Activity's stored source. The existing extension build is under `dist/ChudPresence-Chromium-Activity-Lab-1.9.0/`; the separate Activity update has not been published to the remote catalog.
