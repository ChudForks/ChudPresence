# Chromium Activity Lab architecture

## Public Activity API V2

V2 packages contain `metadata.json` and `activity.json`. The shared V2 validator
accepts scoped text/attribute extraction rules and a bundled HTML media adapter.
Schema 2 adds reusable card/player selection, public layout attributes, literal
transforms, numeric fields, rendered custom players, metadata retention and
worker-derived presentation. Schema 1 packages retain their approved behavior.
`activity-v2-runtime.js` owns executable collection; the manager serializes only
bundled functions and validated package data into a top-frame USER_SCRIPT world.
V2 messages can report/clear approved media fields only, with live host, document
and generation checks. They cannot call V1 page, network, storage, settings or log
operations, or submit arbitrary presence URLs. Fixed adapters constrain
additional outputs: Prime Video details permits matching Amazon artwork and
TikTok permits only public video/LIVE/profile buttons for the reported creator.
Core derives TikTok's creator-first layout and square mobile app logo, while
the collector tracks video progress or the current LIVE viewing session.

`activity-v2-generic.js` implements the reusable schema 2 collector. Its rules
are data; collection and requests never evaluate package code. Reports contain
no destinations. `activity-v2-services.js` separately stores exact-byte reviewed
service policies and private tokens. It reconstructs a static GET endpoint with
typed declared media inputs, denies redirects/credentials and limits JSON output
projection. Policies can change independently of Activity packages and releases.
The worker rechecks document/player snapshots, Activity generation, host grants
and service authorization leases around asynchronous lookups. Revocation clears
derived output immediately, including during pending requests.

The Library stages V2 bytes and shows an extraction review dialog. Its approve
button requests declared hosts in a user gesture, then installation verifies the
staged digest. Stored configuration, metadata and icon hashes are checked on
registration and restart. Changed packages require a higher version and fresh
approval. V1/V2 ID collisions and source changes are rejected. V1 retains its
trusted execution model. See [the V2 guide](extension/ACTIVITY_API_V2.md) for
features, privacy boundaries, tooling and recovery limits.

## Repository boundaries

The lab owns the Chromium extension and its tests. Two independent, locally nested Git checkouts own the packages: `ChudPresence-Activities/` owns trusted V1 activities, the V1 catalog/contract/types, CLI, and shared artwork; `ChudPresence-Activities-V2/` owns declarative V2 activities such as Prime Video, the V2 catalog/contract/types, validator, and JSON CLI. Both are ignored by the lab and excluded from its build. The lab carries generated contract copies under `schemas/` and `extension/core/`; `npm run check` checks each checkout independently when present and verifies bundled YouTube against V1. The V2 validator has no dependency on the V1 SDK or checkout.

Discover uses `extension/core/activity-repository.js` to resolve each official repository's `main` commit, fetch its catalog from that immutable revision, and combine the entries. Downloads use the entry's owning repository/revision and verify SHA-256 hashes and metadata. V1 installation provenance is bound to `ChudForks/ChudPresence-Activities`; V2 is bound to `ChudForks/ChudPresence-Activities-V2`. Source failures retain useful cached entries and produce a notice. Conflicting IDs are omitted instead of selecting a repository implicitly. Installed records retain their revision and hashes. Local Developer installs read user-selected files. Editing either local Activities checkout does not affect Discover.

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

The manifest has no provider content-script entries. Legacy provider files remain in `extension/` for reference but are not registered by this manifest. `extension/default-activities/youtube/` is the first-install YouTube package. Manifest-declared YouTube host access allows that default install without a separate site prompt. Its removal decision is persisted, bundled updates preserve its disabled state, and an installed local or repository replacement is not overwritten by the bundled copy.

## Discord transport and shutdown cleanup

`extension/platform/presence-publisher.js` delegates to `extension/discord/`. Authorization uses the fixed application identity, PKCE, and the redirect URL derived from the actual Chromium extension ID. OAuth credentials and the headless session token are held in local extension storage; the last intent is held in session storage. Activity scripts receive neither. Connecting publishes the current intent when sharing is enabled.

The experimental Headless Sessions publisher serializes writes, limits ordinary update frequency, honors rate-limit retry delays, and renews every ten minutes. Deferred writes retain the latest intent and run when the interval permits, without requiring another Activity report. Changes to the activity or playback timestamps by at least three seconds use the 4.2-second minimum interval; ordinary clock jitter uses the 12-second interval. An update failure may create a replacement session only after deletion of the existing session succeeds. A deletion starts before waiting for intent storage; document-close deletion uses `fetch` keepalive. Failed deletion retains the session token and armed shutdown backup for renewal or restart retries. Disconnect completes deletion, attempts OAuth revocation, then clears local authorization.

`extension/discord/shutdown-cleanup.js` communicates with `discord-cleanup.html` over a private, URL-checked offscreen port. Its document retains an authenticated deletion request, schedules `fetchLater` when available, and sends a keepalive fallback on `pagehide`. The fallback remains armed when deferred scheduling is unavailable or fails. Normal cleanup explicitly disarms the request before closing the offscreen document. The worker persists the last deletion source, timestamp, outcome, and optional HTTP status; these diagnostics contain no credentials or response bodies. Document diagnostics may not reach the worker before shutdown.

See [TESTING.md](TESTING.md) for automated coverage and the recorded Brave window-close result. Browser shutdown delivery depends on the browser and network; the recorded check does not establish crash recovery or every Chromium variant.
