# Firefox port verification

Completed October 15, 2026, using Node 24.21.0 on Windows. Source baseline and initial clean Git state are recorded in [PORT_BASELINE.md](PORT_BASELINE.md).

| Check | Result |
| --- | --- |
| `npm run check` | Passed both manifest/JavaScript trees, V1/V2 generated contracts, QuickJS/page bundle freshness, bundled YouTube and available local official catalog hashes. |
| `npm test` | 380 passed; zero failures, skips or cancellations. Includes Firefox cold-wake, native API/permission, OAuth, migration, snapshot/ownership, worker lifecycle and package tests. |
| Fresh source snapshot | `npm ci --ignore-scripts`, checks and 370 tests passed without ignored local Activity checkouts/dependencies/builds. Ten optional catalog YouTube tests are present only when that local checkout exists. |
| `npm audit --audit-level=low` | Zero vulnerabilities. |
| `npm run build:all` | Both browser packages and unpacked folders built. |
| `npm run check:packages` | 53 Chromium files / 54 Firefox files; archive checksums, root manifests, referenced resources and shared contract/engine bytes passed. |
| `npm run lint:firefox` | Mozilla addons-linter 10.14.0: zero errors, notices or warnings; warnings treated as failures. |
| Reproducibility | Fresh clean-source and working-tree packages matched byte-for-byte. Python's independent ZIP reader passed CRC checks and root-manifest checks on both. |
| `npm run test:v2-browser` | Passed real Chromium security/lifecycle smoke in Microsoft Edge 155.0.4283.45 with a disposable profile and synthetic HTTPS fixtures. |
| Independent review | Reviewed integrated runtime, lifecycle, session checkpoints, migration, build scripts and workflows. Findings fixed and covered by regression tests; no remaining blocking findings. |
| `git diff --check` | Passed. Git's LF/CRLF conversion messages were informational. |

The browser smoke verified strict-CSP USER_SCRIPT injection, isolated workers, public DOM/shadow/JSON/media reads, credential isolation, scoped storage, denied network/selectors, presence reporting, CPU interruption, failure tombstones, reload/disable, navigation grace and immediate tab-close clearing.

No live Firefox installation, Discord account login, live-site playback, signed production upgrade or browser-close delivery test was performed. Those are the requested manual checks, documented in [README.md](README.md#manual-test-checklist). GitHub Actions has been prepared and its equivalent clean-source steps passed locally; no hosted workflow run, push, release publication or AMO submission is claimed.

## Packages

```text
dist/ChudPresence-2.0.4.zip
SHA256 a4fa3fe44f8be087f9f953d56dbbd5414c7c37bda5bda34a02813a6a57b54427

dist/ChudPresence-Firefox-2.0.4-unsigned-development.xpi
SHA256 1d20c4c59c79dac3daa4cdddb2ac15ffe55fb5e355382b00c84d9873235468de
```

The Firefox package uses the explicitly marked development ID and requires desktop Firefox 153.0+. The hidden AMO listing's production GUID remains unverified. Obtain that identity and register its exact OAuth callback before preparing a signed production update. Both browser manifests and package.json remain 2.0.4; the existing `v2.0.4` Git tag must not be reused for a future release.
