# Chromium Activity Lab verification

## Validation workflow

Use Node.js 20 or newer. From this repository run:

```sh
npm ci
npm run check
npm test
npm run build
```

The check validates extension JavaScript, generated V1/V2 contracts, bundled
YouTube files and, when present, the independent V1 catalog and contract copies.
The build recreates `dist/`; remove that directory when its output is no longer
needed. No validation or build command publishes anything.

Validate each Activity repository separately using its README. Their tests,
fixtures and integration helpers are optional ignored local files; CI checks
tracked contracts, types, catalog/package validity and version increases.
`npm test` still runs the preserved local suites. Select the intended version
comparison base, for example `--base=origin/main` for the V1 unpublished changes.
The historical metadata/version discrepancy was superseded by the stable checks
below; do not treat the old October 2 result as the current gate status.

## Recorded stable 2.0.4 checks (October 15, 2026)

These are the recorded release results, not a claim that every command was rerun
by this documentation cleanup. They used Node.js 24.21.0:

| Repository | Result |
| --- | --- |
| Chromium lab | Clean dependency install, manifest/syntax/contracts, 330 tests, and ZIP packaging passed |
| V1 Activities | Contract/catalog validation, TypeScript, 96 local tests, and version checks against `origin/main` passed |
| V2 Activities | SDK contract/catalog validation, TypeScript, 56 local tests, and default version checks passed |

The disposable Edge 155.0.4283.45 unpacked-extension smoke passed with synthetic
HTTPS pages and the real USER_SCRIPT, worker and QuickJS/WASM runtime. It covered
public DOM/shadow/JSON/native-media snapshots, credential filtering, scoped
storage/network access, guest isolation and resource failure, explicit reload,
disable cleanup, navigation handoff and tab-close clearing.

The harness excludes a stale worker target only when its URL is empty, process
ID is zero, parent target is missing and no offscreen extension context exists.
Targets with any sign of liveness still count. The complete smoke passed after
that harness correction; the earlier cleanup observation is resolved.

## Current regression coverage

- V1: package registration/restoration, frame/document ownership, permissions,
  capability rotation, network/storage/settings boundaries, stale-report and
  lifecycle cleanup. See [the conformance map](test/ACTIVITY_CONFORMANCE.md).
- V2: filtered page reads and media scopes, bounded interpreter execution,
  navigation grace, guest teardown/restart rules and shared presence preferences.
- Anikoto: real-package synthetic navigation through delayed link/form responses,
  fixed grace expiry, recovery, leaving scope and closing the tab.
- Library: installation, diagnostics filters/copy/pause/clear, card interaction,
  scrolling and narrow layouts. Scratch screenshots and browser profiles are
  ignored and are not required to run the extension.
- Package behavior: V1 local suites include YouTube ended/preview isolation and
  YouTube Music background-clock/track-transition regressions. V2 coverage and
  live-service limits belong in its own [testing guide](ChudPresence-Activities-V2/TESTING.md).

## Recorded live evidence

On October 2, 2026, the user verified in Brave that Discord presence cleared after
closing all windows and observing for 30 seconds. This covers that normal-close
flow; crash recovery and other Chromium browsers still need verification.

October 7 YouTube Music inspection found cumulative native-media timestamps and
song-relative slider values. The local regressions preserve calibration across
background rendering, stale canonical links and delayed song/clock changes.
The user reported the updated package appeared to work; a complete fresh live
service and Discord run was not independently verified.

Earlier signed-in Instagram inspection identified an avatar-first username link,
hidden audio anchors, and post-viewer source context. These informed package
regressions; fixture success does not establish the currently installed package
or Discord output. Current per-service limits are in the Activity guides.

## Remaining browser checks before distribution

- Test signed-in playback and current DOM detection for each affected Activity:
  navigation, media changes, pause/play, ads, artwork and clickable links.
- Approve declared origins in a normal profile; verify user-script unavailability,
  permission loss and recovery guidance.
- Exercise enable/disable, local reload, update/remove, extension reload/update,
  worker suspension/restart, frame replacement, discarded tabs and background
  reporting. Reimport changed package files: Reload Activity reruns stored source.
- Verify the actual unpacked OAuth callback, then connect, toggle sharing,
  disconnect, trigger rate limits and deletion retries, and close tabs/browser
  windows in the target browser. Observe actual Discord rendering.

Record browser/package versions, setup, observations and limits for affected
changes. Keep live findings distinct from synthetic coverage. Older detailed
verification history remains in Git; the retired implementation is preserved
as an [ignored local snapshot](references/README.md).
