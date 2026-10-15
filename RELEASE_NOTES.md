# ChudPresence Chromium Activity Lab 2.0.4

Stable promotion: October 15, 2026. Release tag: `v2.0.4`.

Activity API V2 is the stable development baseline on `master`. The promotion
preserves the V2 branch's commit history and trusted Activity API V1 support.
The extension version remains 2.0.4 because promotion changes documentation and
the browser verification harness, with no additional shipped runtime changes.

## Included behavior

- Programmable V2 package JavaScript runs in dedicated QuickJS/WASM guests,
  with declared, filtered page snapshots, scoped services and resource limits.
- V2 supports browsing presence, bounded navigation grace and media scopes,
  plus shared V1/V2 status, state, artwork, progress and button controls.
- V1 supports navigation handoff for packages that opt into navigation grace.
- The Activity Library includes the accumulated installation, diagnostics,
  settings, scrolling and interaction improvements since the old master.
- Historical declarative V2 packages remain available under `references/`.

## Validation

On Node.js 24.21.0, clean dependency installs, extension checks, all 330 extension
tests and ZIP packaging passed. The disposable Edge 155.0.4283.45 smoke test
passed using the actual unpacked extension, user scripts and QuickJS/WASM:
page filtering, credential isolation, storage and network boundaries, presence
reports, execution interruption, failure/reload behavior, worker cleanup,
navigation grace and immediate clearing when a tab closes.

The separate local package repositories passed their contract, catalog and
TypeScript checks, all 96 V1 tests and all 56 V2 tests. V1 package version checks
used `origin/main`, the base of the local unpublished package commits; V2 used
its default `HEAD^` base. See [TESTING.md](TESTING.md) for details and older checks.

## Known limits and installation

Stable status applies to the extension baseline. Synthetic browser fixtures do
not certify every signed-in service, Chromium version, interactive permission
flow or current Discord profile rendering. Discord's Headless Sessions
transport remains experimental. The [remaining browser checks](PORTING_PLAN.md)
and [V2 security limits](extension/ACTIVITY_API_V2.md#security-limits-and-validation)
still apply.

Build with `npm ci`, `npm run check`, `npm test` and `npm run build`, then load
`extension/` or the extracted versioned folder from `dist/` as an unpacked
extension. On supported Chromium versions, enable user scripts as described in
[README.md](README.md). Existing locally installed Activities retain their
stored package source; load updated package files separately when needed.

V1 and V2 Activity repositories remain independent. This release does not push
their local commits, update their remote catalogs or publish to a browser store.
