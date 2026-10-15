# Chromium Activity API V1 conformance coverage

`activity-conformance.test.js` is the integration-level Activity runtime suite. It runs the registered Chromium `USER_SCRIPT` wrapper in a synthetic page VM and drives its `chrome.runtime` requests against an `ActivityManager` backed by a deterministic fake extension API.

| Contract area | Coverage |
| --- | --- |
| Install and registration | Isolated `USER_SCRIPT` world and Activity `worldId`; registration match and `excludeMatches` patterns; `document_end` and frame configuration; injection into already-open matching tabs and same-document URL updates; a live document is not restarted by a repeat injection of the same capability; restore after script registration state is lost; bundled YouTube installation, version updates, disabled-state preservation and remembered removal. |
| Chromium ownership | Accepts matching world, message Activity ID, Activity version, installed record, capability and sender URL; rejects mismatches, malformed or stale capabilities, excluded/out-of-match URLs, disabled/uninstalled records and wrong connection versions. |
| Missing `userScriptWorldId` | Authenticates with the persisted Activity ID and capability; rejects another Activity's capability, malformed IDs, missing capabilities and page/content-script forgeries. |
| Capability rotation and secrecy | Reinstall rotates per-install ownership; old messages stop working; the capability is absent from public state, diagnostics, errors, logs, normalized reports, network diagnostics and presence tracks. |
| Public runtime API | Frozen `ChudPresence` surface and coverage for report/clear, `page.execute`, `net.fetch`, storage, settings, navigation, media, DOM, logs and lifecycle. The Activity receives no direct `chrome` or `browser` extension API. |
| Page execution | Uses `chrome.userScripts.execute` in `MAIN`, bound to the sender's `documentId`; covers stale documents, protected pages, code/argument limits, malformed JSON/results, and structured page exceptions. |
| Navigation and documents | Coalesced rapid History API transitions, same-document queue URL changes, and true document replacement/invalidation. Loading-only and loading-plus-URL updates retain active frame reports and document IDs, so the same document can report again immediately. A later different document ID retires the previous top frame and its children. Discard retires a document even after a non-retiring invalidation. Delayed reports are rejected and stale clears cannot remove a replacement report. |
| Frames | Top and embedded reports, frame and parent-frame identity, per-frame document ownership, child/top replacement, stale child reports, and frame-specific clears. |
| External network broker | Declared origin plus host permission, HTTPS, omitted credentials, rejected redirects and Discord endpoints, method/header restrictions, body/response/time limits, JSON errors, structured diagnostics, global/per-Activity concurrency, and invocation of native worker `fetch` with the global receiver. |
| Activity storage | Namespacing and isolation, get/set/remove/clear, JSON and key validation, quota/errors, update persistence, and uninstall cleanup. |
| Settings | Boolean, select, string, range and number defaults; persistence; validation; change notifications to running instances; compatible updates and new-schema fallback. |
| Lifecycle and upgrades | Disable/enable, update, reload, uninstall and permission loss; abort signals, timers, intervals and cleanup; document-exit closing clear sent before Activity cleanup and forwarded to the manager's clear callback; persisted one-time upgrade notifications, migration failure/success and restart behavior. |
| Reports, logs and diagnostics | All supported report kinds, report size and field validation, playback/display/artwork/buttons/media/visibility normalization, structured errors, rate limits, bounded logs, last report/clear/error/upgrade and network diagnostics. |
| MV3 recovery and rollback | Cold `ActivityManager` restoration, persisted capabilities and pending upgrades, disabled and permission-missing records, synthetic `runtime.onInstalled`/`onStartup` restoration after Chrome clears registrations, install/disable/update rollback failures, immutable repository provenance/hash rechecks and obsolete host-permission removal after committed updates. |

Chromium-specific conformance points are capability-based ownership when `sender.userScriptWorldId` is absent, per-install capability rotation and redaction, `chrome.userScripts.execute`, same-document route injection, document-bound `MAIN`-world page execution, loading updates that retain reports and document IDs, and Manifest V3 service-worker and extension-update restoration. The suite also verifies that minute-spaced background reports remain active within the 90-second stale-report window.

Related synthetic suites cover the publication path beyond the Activity manager:

| Suite | Coverage |
| --- | --- |
| `background-cleanup.test.js` | Document-exit clear publishes immediately with closing semantics; ordinary clear uses the 250 ms publication schedule and 1.5-second transient-clear grace; a late exit clear cannot remove a replacement report. |
| `presence-clear-delay.test.js` | Repeated defer calls share one pending clear, and returning presence cancels it. |
| `activity-registry.test.js` | Document/frame ownership, late-clear protection and restoration of another live frame when the current frame clears. |
| `discord-presence.test.js` and `shutdown-cleanup.test.js` | Confirmed session deletion, retained cleanup state on failures, persisted retry/diagnostic outcomes, browser-close deletion ordering and keepalive, deferred cleanup support, and private-port delivery of document-exit outcomes. |

The suite is synthetic: its fake `chrome.storage.local`, `chrome.permissions`, `chrome.userScripts`, `chrome.tabs` and `chrome.runtime` APIs make behavior deterministic without starting Chrome. The extension update test dispatches the same runtime lifecycle handler registered by the background worker; it does not simulate Chrome internals. These tests do not replace real-browser checks for user-script permission prompts, actual frame injection, service-worker suspension, or end-to-end Activity installation and reporting.

Run all suites with `npm test`, or run the Activity runtime suite alone with
`node --test test/activity-conformance.test.js`.
