# Chromium Activity Lab porting status

## Scope and current state

The original plan was to create a separate Chromium MV3 lab, port Activity API V1 from the Firefox experiment, and validate Crunchyroll and YouTube Music with local presence intent before testing Discord. That runtime, Library, and packaging work formed the 1.9.0 baseline. Extension **2.0.4** is the stable line on `master`, adding programmable sandboxed Activity API V2 alongside trusted V1. See [release notes](RELEASE_NOTES.md) for the promotion checks and known limits. The original ChudPresence Solo Chrome release remains the historical comparison described in [BASELINE.md](BASELINE.md).

The workspace has three independent Git repositories. This lab owns extension behavior and copied contract outputs. `ChudPresence-Activities/` owns the canonical V1 contract, authoring tools, and official V1 packages; `ChudPresence-Activities-V2/` owns programmable V2 packages and SDK tooling. Both local package checkouts are ignored by the lab. Promoting the extension does not publish either package repository. Discover reads the official remote catalog, while Developer mode loads local files.

## Implemented platform decisions

- Programmable V2 packages execute in dedicated QuickJS/WASM guests, with bounded declared page snapshots and scoped host services. Trusted V1 packages retain their existing runtime.
- Chromium 135 minimum, with per-Activity `USER_SCRIPT` worlds and document-targeted `userScripts.execute()` for page inspection and reload.
- Manifest V3 worker restoration on cold start and install/update, independent of Discord availability.
- Install-time `userScripts` permission, optional declared website/network origins, and guidance for **Allow User Scripts** on Chrome 138 and newer.
- A bundled removable YouTube default, with persisted removal and disabled decisions. Provider content scripts are absent from the lab manifest.
- Document/frame ownership, rotating Activity capabilities, structured reports/errors, bounded network and storage bridges, declarative settings, lifecycle helpers, and diagnostics.
- Injection into already-open matching tabs and same-document routes. Loading updates preserve reports until document exit, replacement, discard, or stale pruning.
- Generic presence formatting, clickable text/artwork links, dynamic popup services, and per-Activity presentation preferences.
- Optional Discord authorization and Headless Sessions publishing using the lab's own Chromium callback, with rate-limit handling, renewal, deletion retries, and offscreen browser-close backups.

## Verification recorded so far

[TESTING.md](TESTING.md) records current automated checks separately from earlier browser evidence. The initial Edge integration exercised actual injected Crunchyroll and YouTube Music packages on synthetic pages, including playing, paused, ad, navigation, reload/removal, extension reload, and worker restart behavior. It did not verify current signed-in service DOMs or every interactive permission prompt.

The October 2, 2026 record also documents the user's live Brave window-close regression check: Discord presence cleared after closing all windows and observing for 30 seconds. That result is specific to the tested flow and does not establish crash recovery or behavior across browsers.

## Ongoing development workflow

1. Edit provider detection in the Activities repository and runtime/UI behavior in the lab. Use local Developer installs to test unpublished packages.
2. For package file changes, bump the Activity version and rebuild the catalog. For contract changes, run the Activities contract generator and update both API guides. In this nested workspace the generator also refreshes the lab's canonical contract copy and generated schemas/runtime constants; synchronize those copies separately for standalone checkouts.
3. Keep `extension/default-activities/youtube/` identical to the Activities YouTube package when changing the bundled default. The lab check enforces this when the checkout is available.
4. Run the lab's `check`, `test`, and `build` scripts and the Activities repository's contract, catalog, typecheck, test, and version-bump gates. These produce local artifacts only. The current version-bump discrepancy is recorded in [TESTING.md](TESTING.md).
5. Repeat affected browser scenarios and record the browser, package/build versions, setup, observations, and limits in `TESTING.md`.

## Remaining browser checks before distribution

- Test live, signed-in playback and current DOM detection for each affected Activity, including navigation, media changes, paused/playing state, ads, and artwork or clickable links where supported.
- Approve declared origins interactively in a normal profile; confirm user-script unavailability and permission loss are explained and recoverable.
- Repeat Activity enable/disable, local reload, update, remove, extension reload/update, worker suspension/restart, frame replacement, discarded tabs, and background-tab reporting.
- Verify the actual unpacked callback before OAuth testing, then exercise connect, sharing off/on, disconnect, rate limits, failed deletion/retry, and normal tab/browser closure in the target browser.

Keep browser findings distinct from synthetic and unit-test coverage. Local builds and checks do not publish the extension or Activity packages.
