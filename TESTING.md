# Testing

Install locked development tools with `npm ci --ignore-scripts` on Node 24.21.0. Run:

```sh
npm run check
npm test
npm run build:all
npm run check:packages
npm run lint:firefox
```

Static checks cover both manifests and JavaScript trees, generated V1/V2 contracts, the QuickJS/page bundles and bundled YouTube files. A local optional official Activity checkout additionally enables canonical contract and catalog-hash comparisons; clean CI does not require that ignored checkout.

The shared test suite covers Activity validation/provenance, report selection and navigation, tab/frame/document retirement, stale reports, reload/disable/removal, settings and UI, V2 QuickJS isolation/resource limits/private broker services, network and credential boundaries, OAuth, close-related keepalive, deletion failure/token retention and Chromium shutdown backup behavior. Firefox tests additionally cover native API requirements and optional permission declaration, Promise API selection, zero-argument Firefox OAuth callbacks with full PKCE/state/cancel behavior, background worker-host leases, suspension handling and legacy settings migration/deferred defaults.

Package checks independently read ZIP entries, inflate data, validate checksums and references, compare archive/unpacked bytes, reject development-directory leaks, and require byte-identical shared Activity contract/engine artifacts. Mozilla `addons-linter` uses the exact locked version and rejects warnings. Firefox session/wake tests cover ownership restoration before the first cold-wake close event, stale generation rejection, preserved selection/timestamps and ordered checkpoint writes.

`npm run test:v2-browser` is the existing optional real Chromium security smoke test. It needs Playwright and an extension-capable Chromium executable; it uses a disposable profile and synthetic HTTPS fixtures. Configure `CHUDPRESENCE_TEST_NODE_MODULES` and `CHUDPRESENCE_TEST_BROWSER` when necessary. It is not a Firefox automation claim and does not perform Discord login.

`npm run test:foreground-browser` uses a headed disposable Chromium profile and
synthetic V1/V2 Activities. It opens ChudPresence's popup and a second extension's
popup, switches tabs/windows, minimizes/restores the browser, returns after an
explicit clear, and closes the source tab. It checks local presence intent and
reports the webpage's native focus during each popup; no Discord login is used.
The same Playwright/browser environment overrides apply. On October 17, 2026,
the smoke passed in Microsoft Edge 155.0.4283.45 and Brave (Chromium
155.0.8059.85). In those runs toolbar popups
reported `WINDOW_ID_NONE` while the source document retained native focus.
Firefox popup behavior and actual Discord delivery remain manual checks.

Firefox installation, live-site playback, OAuth with the registered callback, signed production upgrades and browser-close delivery are manual checks. Follow [the Firefox checklist](ChudPresence-Firefox/README.md#manual-test-checklist). Automated tests cannot guarantee delivery after process termination or a network outage. No manual Firefox or Discord result is asserted by the implementation.
