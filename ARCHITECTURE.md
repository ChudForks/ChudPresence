# ChudPresence architecture

## Activity API v2 sandbox

Version 2.0.0 adds programmable v2 while preserving v1's runtime and canonical
contract. `activity-v2-runtime.js` registers a small page broker and
a trusted bootstrap in `chudpresence.activity.v2.<id>`, separate from v1's world.
The background authenticates page snapshots and relays them over a private port
to `activity-v2-host.js` in a private host document: Chromium's offscreen document
or a Firefox background iframe. That host creates
dedicated extension workers running the locally bundled QuickJS/WASM engine.
Package source goes only to its worker as data supplied to QuickJS, never to
the website world or native browser evaluation. Website CSP cannot block it.
Each guest has its own WebAssembly instance/allocator, heap and stack quotas,
interrupt deadline, bounded promise work, and bounded async JSON requests.
Only compiled WASM code is cached across guests. The bridge never returns a
browser reference, host function, or ownership capability to guest code.

`activity-v2-page.js` validates fixed metadata declarations and collects bounded
snapshots of public DOM text/attributes, selected JSON paths, native media, and
optional origin/path. It filters sensitive controls and containers, credential
keys/patterns, URL credentials/query/fragments, and selector predicates that
could probe secret attribute values. Package callbacks run on host-controlled
polling and may combine data with ordinary JavaScript and existing scoped
storage/settings/network services. No v2 operation executes arbitrary code in
the page world; the manager rejects `page.execute` for v2 independently of the
guest bridge. Lifecycle teardown disposes the interpreter on disable/removal,
reload, document exit, route scope loss, or execution failure.

Version 2.0.2 adds optional `pageAccess.mediaScopes` inside the existing broker.
Each native player can carry sanitized descendant reads from its nearest
declared single-player ancestor (at most 16 steps), with rejected-field evidence.
Root, visibility, sensitivity, containment and multi-player checks fail closed;
native players in open shadow roots count toward ambiguity. Shared page capture,
read and output limits remain in force, with extra aggregate traversal limits.
Guest code receives only JSON; worker isolation, bridge operations, network
permissions and V1 remain unchanged. Instagram's Reels selection and formatting
live in its independent V2 package, with no Instagram adapter in the extension.

See [the v2 contract and threat model](extension/ACTIVITY_API_V2.md) for exact
capabilities, resource limits, migration guidance, and limits of data filtering.
The broader native Activity wrapper described below applies to v1.

## Repository boundaries

This repository owns both browser builds and their tests. `extension/` remains shared source and the directly loadable Chromium tree; `ChudPresence-Firefox/extension/` contains only the Firefox manifest/platform overlay. The separate, locally nested `ChudPresence-Activities/` Git checkout owns the official packages, catalog, canonical Activity API V1 contract, generated schemas and SDK types, CLI, and shared artwork. It is ignored by this repository and is not included by the build. This repository carries contract copies under `schemas/` and `extension/core/activity-contract.generated.js`; `npm run check` validates them and compares them with the Activities checkout when present. It also checks the bundled YouTube package against that checkout.

Discover uses `extension/core/activity-repository.js` to resolve the `main` commits of both official repositories, `ChudForks/ChudPresence-Activities` and `ChudForks/ChudPresence-Activities-V2`, and merge their catalogs. Each entry retains its repository and immutable revision for package and icon downloads. If an Activity ID appears in both catalogs, the V2 repository takes precedence. A failed repository refresh retains its cached entries when available while the other repository can still refresh. Package downloads validate metadata and verify SHA-256 hashes; installed records retain their repository, revision, and hashes. Local Developer installs read user-selected files. Editing either local Activities checkout does not affect the remote catalog used by Discover.

## Worker and Activity runtime

`extension/background.js` is the Manifest V3 service worker. It owns the Activity Manager, report registry, tab lifecycle, selection, global settings, local presence intent, and Discord publisher. Installed package code and settings are persisted in local extension storage. `extension/core/activity-restore.js` restores registrations on extension install/update and worker startup; restoration runs independently of Discord initialization.

`extension/core/activity-manager.js` validates and registers each enabled package with `chrome.userScripts` in its own `USER_SCRIPT` world with messaging enabled. Registered scripts run at `document_end`, in the top frame by default or matching frames when metadata selects `frames: all`. The generated wrapper supplies the frozen `ChudPresence` API for reports, settings, per-Activity storage, navigation, media, DOM, lifecycle, logging, page execution, and the network bridge. V1 is intended for trusted first-party code with broad website-observation capabilities; isolating credentials does not make it an untrusted-code sandbox.

Reports and runtime requests use the user-script message channel. The manager checks installed identity, a rotating per-install capability, the sending world when Chromium provides it, tab/frame/document ownership, URL scope, schemas, rates, and declared network patterns. Credentials and capabilities are redacted from public diagnostics. `ChudPresence.page.execute()` runs in the requesting document's `MAIN` world through document-targeted `userScripts.execute()`, with bounded serialized input and output and a document check after execution.

Install, enable, reload, and restore also inject into already-open matching tabs. A same-document URL update can enter an Activity's scope without creating a new document, so the worker injects on URL updates even when they also report loading. The wrapper suppresses duplicate execution of the same installed package in a live document. Reload or a changed install capability permits a new run and cleans up the prior wrapper. Explicit injection for `frames: all` targets all frames of a matching tab; sender validation still rejects requests from frames outside the declared URL scope.

## Reports, selection, and clearing

Reports remain associated with their Activity, tab, frame, and document. A `status: loading` update alone retains the report and document: player and SPA transitions can occur without replacing the page. A new document ID retires the old document, and a replacement top document retires its child frames. Discarded and closed tabs are invalidated. Late clears or reports from retired documents cannot erase a newer report.

`extension/core/activity-registry.js` stores reports per frame and selects the most recently updated surviving frame for each tab. `extension/core/activity.js` prefers playing media over paused media, retaining the selected tab while eligible. Global sharing and each Activity's paused preference filter candidates. `extension/core/presence.js` converts the selected normal-visibility report into a transport-neutral intent using generic media semantics and per-Activity presentation preferences. It includes optional clickable details, state, and artwork URLs; paused reports have no playback timestamps.

The manager uses a 90-second report freshness window to allow background timers to report roughly once a minute. A worker alarm runs stale pruning every 30 seconds; pruning clears reports after the window, so expiration is not an exact 90-second timer. Reports, logs, and network diagnostics remain runtime state; installed packages, Activity storage, settings, and preferences survive worker restart. Active documents attempt to reconnect and resend their last report after a worker restart.

Ordinary reports and clears schedule publication through a 250 ms debounce. If no intent remains, a further 1.5-second transient-clear delay allows playback to recover. The wrapper's `pagehide`/`beforeunload` handler sends an internal closing clear before Activity cleanup callbacks. Closing clears and tab removals publish immediately and bypass these delays. Removing or disabling an Activity also recomputes the current presence.

## Library, popup, and permissions

`extension/activities.*` implements Discover, Installed, Updates, local loading, Activity-defined settings, and Developer diagnostics. It reads the cached catalog initially and requests GitHub API/raw-file origins when refreshing. Installation checks user-script availability and requests declared HTTPS website and network origins as optional host permissions. Chrome 138 and newer requires the extension's **Allow User Scripts** setting; earlier supported Chrome versions use Developer mode. The minimum Chromium version is 135 because the runtime uses document-targeted `userScripts.execute()`.

`extension/popup.*` renders installed Activities dynamically with package names and icons, the local preview, Discord state, per-Activity presence preferences, and report/clear/cleanup diagnostics. The only global playback preference is `enabled`; retired provider-specific settings are removed during installation/update. **Restore default settings** resets the global switch; per-Activity preferences are stored separately. All Activities use the fixed Discord application ID in `extension/config.js`.

The manifest has no provider content-script entries. Provider detection lives in Activity packages. `extension/default-activities/youtube/` is the first-install YouTube package. Manifest-declared YouTube host access allows that default install without a separate site prompt. Its removal decision is persisted, bundled updates preserve its disabled state, and an installed local or repository replacement is not overwritten by the bundled copy.

## Discord transport and shutdown cleanup

`extension/platform/presence-publisher.js` delegates to `extension/discord/`. Authorization uses the fixed application identity, PKCE, and the redirect URL derived from the actual Chromium extension ID. OAuth credentials and the headless session token are held in local extension storage; the last intent is held in session storage. Activity scripts receive neither. Connecting publishes the current intent when sharing is enabled.

The experimental Headless Sessions publisher serializes writes, limits ordinary update frequency, honors rate-limit retry delays, and renews every ten minutes. Deferred writes retain the latest intent and run when the interval permits, without requiring another Activity report. Changes to the activity or playback timestamps by at least three seconds use the 4.2-second minimum interval; ordinary clock jitter uses the 12-second interval. An update failure may create a replacement session only after deletion of the existing session succeeds. A deletion starts before waiting for intent storage; document-close deletion uses `fetch` keepalive. Failed deletion retains the session token and armed shutdown backup for renewal or restart retries. Disconnect completes deletion, attempts OAuth revocation, then clears local authorization.

`extension/discord/shutdown-cleanup.js` communicates with `discord-cleanup.html` over a private, URL-checked offscreen port. Its document retains an authenticated deletion request, schedules `fetchLater` when available, and sends a keepalive fallback on `pagehide`. The fallback remains armed when deferred scheduling is unavailable or fails. Normal cleanup explicitly disarms the request before closing the offscreen document. The worker persists the last deletion source, timestamp, outcome, and optional HTTP status; these diagnostics contain no credentials or response bodies. Document diagnostics may not reach the worker before shutdown.

The Firefox build overrides that shutdown module: a hidden event-page iframe hosts the same V2 workers, with no credential-bearing offscreen or deferred cleanup request. Real close events retain the shared `{closing:true}` publisher and fetch keepalive deletion. Firefox suspension/parent page exit suppresses host-disconnect failure clearing; ordinary event-page suspension does not delete active presence. API calls use Firefox's Promise namespace, User Scripts is requested as an optional permission, OAuth uses the zero-argument Firefox redirect generator, and a platform migration transfers known legacy provider settings before shared cleanup. Firefox 153 is the minimum for native document-targeted execution and sender document IDs. See [Firefox setup, AMO preparation and maintenance](ChudPresence-Firefox/README.md).

See [TESTING.md](TESTING.md) for automated coverage and the recorded Brave window-close result. Browser shutdown delivery depends on the browser and network; the recorded check does not establish crash recovery or every Chromium variant.
