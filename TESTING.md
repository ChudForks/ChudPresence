# Chromium Activity Lab verification

## Anikoto V1 navigation handoff (October 15, 2026)

Extension **2.0.4** extends the existing V2 `presence.navigationGraceMs`
metadata option to V1. Anikoto **1.0.3** opts into four seconds and replaces
SPA reports directly without an intermediate clear. A confirmed in-scope
top-document transition stops the outgoing runtime while retaining its last
presence until a replacement report or the fixed deadline. The V1 generation
marker prevents reinjection into the outgoing document; a back/forward-cache
restore restarts the runtime. Missing, canceled, excluded and out-of-scope
navigation hints receive no grace. Both API schemas, authoring tools and the
V2 SDK snapshot reflect the shared option.

Validation passed: **330 extension tests**, **96 V1 repository tests** and
**56 V2 repository tests**. The disposable Edge browser fixture used the real
Anikoto package and extension, clicked an internal link with its response
delayed, and repeatedly observed a nonempty final presence while the outgoing
document was retired. The replacement document reported successfully. A form
submission with a stalled response cleared at the four-second deadline and
recovered after the new document loaded. Leaving the declared site or closing
the tab during handoff cleared promptly. Existing playback, focus, logo,
display-preference and real V2 guest checks also passed without page errors.
These use synthetic site responses and do not exercise Discord publication.

Reload/update to **2.0.4** and reimport Anikoto **1.0.3** to apply the fix.
The broader V2 worker-target cleanup observation recorded below remains a
separate unresolved optional smoke result; this change does not alter the
V2 sandbox worker lifecycle.

## Shared V1/V2 browsing presentation (October 15, 2026)

Extension **2.0.3** adds opt-in `display.statusDisplayOverride` and
`display.hideState` to both report APIs, their schemas, validators, TypeScript
types, and the independent V2 SDK snapshot. Existing reports retain the saved
status preference and existing state fallbacks. Anikoto **1.0.2** requires
2.0.3 and uses these options only while browsing, with the site's public PNG
favicon as its large image. Playback retains its series/episode preference.

Validation passed: extension check and **327 tests**, V1 package checks and
**94 tests**, V2 SDK/type/catalog checks and **56 tests**. A simultaneous run
first hit the existing 50 ms QuickJS execution limit; the complete extension
suite passed when run on its own. The isolated browser fixture accepted the
real Anikoto V1 package, verified the formatted logo URL, application-name
status despite a saved media-line preference, omitted state, playback
preference restoration, focus/visibility behavior and existing player checks.
It also installed a real V2 QuickJS guest and accepted/formatted both shared
controls with the saved preference intact. No page errors occurred.

The broader optional `scripts/test-v2-browser.mjs` check remains unresolved:
two runs timed out at `Closed navigation fixture retained workers` after the
navigation tab closed. Presence had cleared and the tab/frame registry was
empty, but one worker target remained. The same check passed against HEAD's
runtime in a temporary baseline checkout. No worker-lifecycle code changed in
this update; this separate cleanup observation is not counted as a pass.

The logo endpoint returned HTTP 200 and the expected valid PNG bytes. These
checks do not verify Discord's external image proxy or live profile rendering.
Reload/update the extension to **2.0.3**, then reimport Anikoto's three package
files to apply the change in an existing browser profile.

## Instagram Saved and generic fallback (October 15, 2026)

Instagram **2.3.0** adds a generic `Saved` state for `/<username>/saved/`, with
any valid username and collection descendants. The user's open Saved URL
confirmed that shape. Reports omit the owner and collection names/IDs; posts
opened from Saved keep its label and elapsed timer. All other routes without
a specific handler show only `On Instagram`, including unknown-source posts.
The remaining challenge/checkpoint exclusions were removed to allow fallback.
Hidden/foreign pages and invalid required Reel metadata retain their clear behavior.

The independent V2 repository passed build/check, **56 tests**, current-extension
integration and all browser fixtures. Regressions cover multiple Saved usernames,
collection pages, source retention, generic fallback without stale captions or
handles, timer continuity/reset and hidden-tab cleanup. The real broker,
QuickJS and Discord builders accept both new states. No additional declared
reads, network access or extension changes were added. Reimport Instagram
**2.3.0**'s three package files to apply it; installed preview and Discord
publication remain unverified after reimport.

## Instagram Stories, Messages and Settings (October 15, 2026)

Instagram **2.2.0** adds `Watching story` with the URL owner's `@username`,
Story-index/highlight states, generic `Messages` for every `/direct/...` page,
and only `Settings` for every `/accounts/...` page. Story owner changes reset
elapsed time, while Story IDs for the same owner retain it. Messages/settings
retain their timers across thread/subpage changes. Photo stories need no player.
Reports include no conversation identity/text, account field, settings subpage,
Story ID or reply content. These states do not become `/p/...` post sources.

The user's open Story URL confirmed the owner/numeric-ID route. No navigation
or Story-content inspection was needed. Package exclusions now retain only
challenge/checkpoint paths. Existing declared reads and extension code are
unchanged; Activity Lab **2.0.2** remains sufficient.

The independent V2 repository passed build/check, **54 tests**, current-extension
integration and all browser fixtures. New browser cases use a player-free DOM
with seeded conversation/account/input fields: snapshots contain no reads or
media, and production presence/Discord builders receive the expected generic
labels, public Story owner and elapsed-only timestamps. Route boundaries,
malformed Story paths, timer retention and discarded post context also pass.
Reimport Instagram **2.2.0**'s three package files to apply the change; installed
preview and Discord publication remain unverified after reimport.

## Instagram post-viewer source context (October 15, 2026)

Instagram **2.1.1** retains the preceding Home, Search or profile activity while
the same document opens, pages through or closes `/p/<id>/` posts. This shared
route does not identify a source by itself. Profile posts retain the source
`@username` and profile button; Search posts keep `Browsing Search`. Elapsed
time continues without using post captions, creators or playback metadata.
Leaving browsing resets context. Hidden tabs clear presence and reset the timer,
while retaining their known source for return; direct posts without a known
source clear. A new document has no remembered source.

Live read-only inspection confirmed a Search video at `/p/<id>/` with Search
still selected behind its modal. The independent package repository passed
build/check, **51 tests** and browser fixtures through the production collector,
QuickJS and Discord builder. The same post URL is tested after Home, Search and
two different profiles, with no source misclassification. Additional checks
cover retained/reset timers, source replacement and unknown/malformed posts.
Reimport Instagram **2.1.1**'s three package files to apply this change.

## Instagram Home, Search and profiles (October 15, 2026)

Instagram **2.1.0** adds generic browsing activity for Home (`Browsing Home`),
Search (`Browsing Search`) and public profile routes (`Viewing profile` with
`@username`). Profiles include Reels, Tagged and Reposts tabs. Browsing uses
elapsed time, the static Instagram logo and a public profile button where
applicable. Existing Reel caption/creator, native playback progress and buttons
remain supported. No extension update beyond **2.0.2** is needed.

The independent V2 repository passed build/check, **47 tests**, current-extension
QuickJS integration and browser fixtures for all three packages. New regressions
cover both Instagram origins, current-profile identity despite stale players,
timer retention/reset, hidden tabs, unsupported/private routes and same-document
Home/Search/profile/Reels transitions. Browser reports pass through production
normalization, presence and Discord builders, including generic activity type,
omitted empty state, elapsed-only timestamps, artwork and progress preferences.
Search inputs are not sampled. The catalog includes the new matches and hashes.

Live read-only navigation confirmed the sidebar Search link targets `/explore/`
and the viewed profile's public handle is in its pathname. The original profile
page was restored. Reimport Instagram's `metadata.json`, `activity.js` and
`icon.png` to use **2.1.0**; installed preview and Discord publication still need
verification after reimport.

## Instagram first Reel opened from Home (October 15, 2026)

Instagram **2.0.2** fixes a package metadata issue on the first Reel opened from
Home and when returning to it. The user supplied a `card-fields-rejected` log
naming `links`. Live DOM inspection confirmed a hidden audio-control anchor
alongside its visible duplicate in the selected card, with both marked by an
`Audio image` SVG label. Broad anchor reads rejected that hidden control and
prevented reporting. The updated scoped permalink declaration excludes audio
controls; hidden metadata and hidden Reel permalinks remain rejected normally.

The synthetic browser regression reproduces the old rejection and verifies
Home -> first Reel -> next -> return in one document/QuickJS guest with the new
metadata. The corrected selector was also checked against the live card: four
anchors/one hidden candidate become two anchors/no hidden candidates. Extension
2.0.2 is sufficient; reimport the updated Instagram package. This does not verify
the reimported package's report in the user's blocked extension Library.

## Instagram avatar-first creator fix (October 15, 2026)

The initial Instagram 2.0.0 synthetic fixture omitted the empty avatar anchor
that precedes the visible username anchor on live Reels. Both match the same
aria-label selector, so creator text was empty and the package always cleared.
The user's snapshot showed no accepted reports or errors. Before a frame's first
report, the current manager ignores its clears as stale, so last-clear was also
empty. The package had no diagnostic logging to distinguish those conditions.

Instagram **2.0.1** narrows creator reads to the username link and adds bounded,
deduplicated reason logs without page values. Live read-only DOM inspection
confirmed that the old selector returns empty text while the new selector returns
the visible username and its matching public profile path. The updated browser
fixture includes the avatar before the username, reproduces the old clear and
checks the new report through the actual broker and QuickJS. Avatar-only cards
still clear. No further extension change is needed; reimport all three updated
Instagram files. Browser policy blocks the user's extension Library, so its
installed report and actual Discord publication cannot be verified directly.

## Instagram Reels and bounded media scopes (October 15, 2026)

Extension **2.0.2** adds optional `pageAccess.mediaScopes`, binding sanitized
card metadata to its own native player without exposing DOM handles or page
execution. It retains existing public-field filters and shared capture/read/
output budgets. New aggregate limits bound scoped candidate selection, ancestor
steps and card/shadow discovery. Hidden/sensitive fields, invalid first matches,
ambiguous native/shadow players, app roots, outside nodes and exhausted budgets
fail closed. Existing V1 and unscoped V2 snapshots retain their contracts.

The independent V2 repository adds Instagram **2.0.0**, requiring extension
2.0.2, with the archived Reels-only presence: caption, @creator, native progress,
static Instagram logo and public Reel/Profile buttons. Default and article
layouts use declared scopes; all selection and formatting stay in the package.

`npm run check` and all **314 extension tests** passed. The V2 repository passed
build/check, **43 tests**, version checks, production QuickJS integration, and
browser fixtures for Prime Video, Google and Instagram. Instagram's fixture
passes deep nested cards, paused main player beside smaller autoplay, invalid
winner clearing, missing-caption fallback, clean/matching URLs, article/detail
routes, hidden/sensitive fields, native/shadow-player ambiguity and visibility
cleanup. Its reports pass through the real presence and Discord payload builders,
including timing and artwork/button/progress preferences.

The actual unpacked-extension `npm run test:v2-browser` passed on **Microsoft
Edge 155.0.4283.45** using a disposable profile. Its native canvas media stream
supplies real playback state across isolated worlds; scoped sanitized reads
reach the guest as deeply frozen JSON. Credential isolation, strict CSP,
resource failures, teardown and navigation-grace checks also pass. No browser
permissions, network authority or guest bridge operations were added.

These checks use synthetic HTTPS responses. Signed-in Instagram layout
compatibility and actual Discord publishing have not been checked. Reload the
2.0.2 extension and reimport all three Instagram package files for a live check.

## Google navigation smoothing (October 15, 2026)

Extension **2.0.1** adds the V2 metadata preference
`presence.navigationGraceMs` (0–5000 ms, default 0). Google **2.0.1** opts into
4000 ms. A trusted Navigation API hint must identify an in-scope, non-excluded,
top-document navigation; the background retains its document-owned report until
the replacement reports or the fixed deadline expires. It does not keep the
outgoing guest running. A missing navigation hint retains immediate exit cleanup.
Google separately tolerates a temporarily replaced header for up to four seconds
on an established supported page, reporting the new query/mode without old stats.

`npm run check`, all **308 extension tests**, and `npm run build` passed. The V2
repository passed its checks, **38 tests**, version gate, QuickJS integration,
and browser fixtures; the generated catalog and pinned SDK are synchronized.

Tab removal cancels any pending grace and clears immediately. Closed tab IDs
reject queued Activity messages so late updates cannot resurrect workers or
presence. An ended bootstrap cannot restart from a loading-tab injection;
explicit reload and persisted back/forward restoration still restart correctly.
Global disable, Activity teardown and direct closing/failure clears bypass the
pending navigation deadline. Stale documents/deadlines cannot remove new reports.

The real unpacked-extension smoke passed on Edge 155.0.4283.45 with synthetic
HTTPS responses: a mode link and a submitted search held the old presence while
the new document response was blocked; a replacement report updated directly;
closing the tab during the pending submitted search cleared before the four-second
deadline and left no guest workers. Existing sandbox/security and browser-close
backup tests remain in the test suite. The checks use no existing browser profile,
live Google account, or Discord publication. Google live rendering still needs
an installed-session check after reloading extension and package files.

## Google programmable V2 activity (October 14, 2026)

Added `ChudPresence-Activities-V2/activities/google/` using the archived Google
presence layout: Homepage, Search/Web, Images and AI Mode, submitted queries,
visible-only result statistics, Google artwork and elapsed time. Package reads
are limited to declared `q`/`udm`/`tbm`, `#gbwa`, and `#main #result-stats`.

The generic V2 report contract now adds bounded `display.name` mode labels and
`playback.elapsed` for generic pages without a live marker or duration. Empty
elapsed-page state stays omitted through Discord formatting. URL snapshots add
document visibility; declared query snapshots flag duplicate key names without
exposing their additional values. Visibility events request an immediate update
and queue a follow-up when a snapshot is in flight. V1 schemas stay unchanged.

`npm run check`, all **299 extension tests**, and `npm run build` passed. The
independent V2 repository passed build/check, **36 tests**, the version gate,
production QuickJS integration, and synthetic Chromium DOM-to-QuickJS checks.
Those checks cover mode layouts, route/query restrictions, duplicate parameters,
visibility/readiness clearing, timer resets, Unicode and missing statistics;
seeded drafts, result snippets, AI responses and tracking stay outside snapshots.
Live Google and Discord publishing still require an installed-session check.
The unpacked-extension `npm run test:v2-browser` smoke also passed on Microsoft
Edge 155.0.4283.45, including strict-CSP USER_SCRIPT injection, offscreen workers,
credential isolation, presence reporting and lifecycle cleanup.

## Programmable Activity API v2 sandbox (October 14, 2026)

Implemented on `codex/activity-api-v2-sandbox`, based on the unchanged V1 branch
`codex/activity-api-v1-conformance` at `2e3ec6b`. The independent V1 Activities
checkout remains clean at `dd642c2`. All nine V1 packages, their canonical
contract, and bundled YouTube remain unchanged; V1 is still supported by the
existing runtime. This is a separate programmable V2, independent of the archived
declarative implementation.

`npm run check`, all **295 tests**, and the example's strict TypeScript check
passed. `npm run build` produced the version 2.0.0 extension folder and ZIP.
The full dependency audit reports no known vulnerabilities. New tests
cover guest constructor/prototype escapes, unavailable browser/network/storage
globals, JSON-only service marshalling, private result handles, CPU/promise/heap/
stack/WASM memory limits, native VM faults, worker watchdog and stale-ack races,
fixed selector grammar and attribute probes, sensitive DOM filtering, selected
JSON paths, public open-shadow/media reads, explicit query parameters, scoped
storage, host authentication, lifecycle/SPA clearing, failure tombstones, and
shared offscreen-document races. Contract tests preserve the exact V1 report
schema and verify actual sandbox limits against V2's published contract.

`npm run test:v2-browser` passed on **Microsoft Edge 155.0.4283.45** in a disposable
profile using synthetic HTTPS fixtures. The website's strict CSP forbids WASM;
the trusted page broker runs there while the interpreter runs in a dedicated
extension worker hosted by the existing offscreen document. Tests verified
public DOM/shadow/JSON/media access, absence of seeded cookie/local-storage/input/
hidden/script/JSON credential values, no extension ownership capability or
Discord storage sentinel in the guest, scoped storage, denied undeclared network
and credential selectors, accepted presence reports, CPU interruption, reload,
and worker removal on disable. A failing async guest remained stopped across
poll intervals, and explicit reload restarted it once before stopping again.

Browser testing exposed and resolved two real integration problems that Node
tests could not catch: page CSP prevented in-page WASM compilation, and extension
service workers disallow dynamic imports. The final implementation runs WASM
outside the website and uses static service-worker imports. The downloaded
Playwright Chromium build could not launch on this Windows host; the test used
the installed Edge executable. It did not use an existing browser profile,
real account credentials, live service playback, or Discord publishing. It does
not establish compatibility with every supported Chromium version or website.

Selected page data remains subject to the filtering limitations documented in
[the v2 threat model](extension/ACTIVITY_API_V2.md). Unknown secrets disguised as
ordinary selected text or URL paths cannot be reliably recognized.

## Library scroll-jump regression (October 13, 2026)

The three-second Library poll could move a scrolled page upward after a settings area had been scrolled. Installed rendering emptied the live grid, attached its first card, and restored that card's settings scroll before attaching the remaining rows. This forced browser layout while the document was temporarily shorter. Hovering a lower card exposed the timing but was not the cause.

Discover, Installed, and Updates now construct their card lists detached and replace each grid once. Installed settings scrolling is restored after the complete grid is attached. A focused card action is restored with `preventScroll`; a newly disabled Reload action falls back to Enable/Disable.

An isolated browser fixture reproduced four failures before the fix: desktop scroll position `795` fell to `205`, and narrow scroll position `3919` fell to `279`, with and without hover. After the fix, all four cases retained their exact positions in both Edge and Brave; eight ordinary scroll/hover/settings/action cases also passed in Edge. Two permanent UI regressions cover action focus and disabled Reload fallback. `npm run check`, all 207 tests, `npm run build`, and `git diff --check` passed. The browser fixture uses synthetic backend state and a 32-setting Activity to exercise nonzero settings scrolling, without accessing a live browser profile.

## Uniform Activity card layout verification (October 13, 2026)

Installed cards now reserve consistent artwork, title/status, description, settings, and action areas. The grid gives every card the same height across rows, and action buttons use consistent widths and positions. Activities without settings show a reserved empty state; longer settings lists scroll within their 176px area. Disabled Activities retain a disabled Reload control in Developer mode. Settings scroll position survives visible and hidden polling and view changes.

The isolated Edge fixture used metadata and icons from all seven official packages with mixed enabled/local states. All card widths, heights, and section/footer offsets matched at 1280px (four columns), 800px (two), and 390px/320px (one), with Developer mode on and off. Heights were 592px with Developer actions and 550px without. A 32-setting stress case kept the last control reachable and preserved its scroll position through visible and hidden polls. There was no page overflow or clipped action/control geometry. Desktop screenshots were visually inspected. `npm run check`, all 205 tests, `npm run build`, and `git diff --check` passed.

## Developer console verification (October 13, 2026)

The Developer view now contains one selectable console with Activity, diagnostic kind, and log-level filters; Copy visible and Select all controls; paused snapshots; and scoped history clearing. Installed cards link directly to an Activity's logs. History clearing removes logs, completed network history, and diagnostic snapshots while preserving live presence, settings, Activity storage, registrations, upgrade transitions, and running requests.

`npm run check`, `npm test` (205 tests), `npm run build`, and `git diff --check` passed. New regressions cover readable formatting and counts, filter combinations, clipboard success/fallback, selection during pending polls, paused snapshot immutability, Activity selection changes, scoped/all clearing and retry behavior, stale polls completing after a clear, clear-success/refresh-failure feedback, extension-page access controls, invalid scopes, and requests that finish after clearing.

An isolated headless Microsoft Edge check served the actual Library files with synthetic Activity/backend fixtures. It verified clipboard text (allowing Windows newline normalization), Activity/level filters, text selection across a polling interval, pause/filter behavior, selected/all clearing, and a 390-pixel layout with no page overflow. Desktop and narrow screenshots were inspected under `browser-profiles/developer-console-*.png`. This verifies UI behavior with fixtures; it does not exercise live service playback or Discord.

## Bugfix sweep verification (October 13, 2026)

The sweep started from clean working trees at lab commit `99673da` and Activities commit `fc9d856`. Node.js 24.21.0 and npm 11.19.0 passed the final automated gates below. These results cover local fixes and deterministic regression fixtures; live website playback and Discord OAuth/API behavior were not exercised during this sweep.

| Repository | Gate | Result |
| --- | --- | --- |
| Chromium lab | `npm run check` | Passed syntax, manifest, shared contract, seven-package catalog hashes, and bundled YouTube parity |
| Chromium lab | `npm test` | 183 tests passed (162 before the sweep) |
| Chromium lab | `npm run build` | Passed; unpacked 1.9.0 build and zip refreshed under `dist/` |
| Activities | `npm run check:contract`, `npm run check:catalog`, `npm run typecheck` | Passed |
| Activities | `npm test` | 65 tests passed (55 before the sweep), including the SDK scaffold test |
| Activities | `node tools/check-version-bumps.mjs` | Passed against its default `HEAD^` base; the three locally edited packages also increase their versions above `HEAD` |
| Both | `git diff --check` | Passed |

Regression coverage includes imperative Activity injection URL/frame scope, playing-frame selection and per-Activity paused preferences, runtime rollback after storage failures, SemVer precedence and numeric prerelease validation, local package file-read races, settings recovery and polling while editing, concurrent Discord initialization/disconnect, and short-lived OAuth expiration. Package fixtures cover YouTube seeks to zero and player-state precedence, finite live DVR windows on Kick/Twitch, and repository metadata URL validation.

YouTube is now `1.0.3` in both the catalog and bundled extension copy; Kick and Twitch are `1.0.2`. The catalog hashes were regenerated. To exercise these local changes, reload the extension and replace already-installed package sources through the Library's Developer view. Discover reads the remote repository, so it will expose these package versions after publication.

## Automated gates (October 2, 2026)

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

The local YouTube Music package is now version 1.0.14. Live read-only inspection in the user's Brave tab reproduced a cumulative playlist timeline: Beneath the Mask displayed `3:00 / 4:38`, while the video element reported approximately `662.884 / 759.898` seconds at playback rate 1. Its seek slider exposed song-relative `aria-valuenow=180` and `aria-valuemax=278`, despite empty `value` and `max` properties. The next song displayed `4:13 / 7:47` while the video reported approximately `1013.884 / 1139.276` seconds. The read-only DOM inspection did not expose page-player timing getters.

The package now reads the seek slider's attributes, retains its duration for the confirmed song, and calibrates an offset between its relative position and the cumulative media clock. Audio advances the position when background rendering freezes, while additional playlist buffering cannot extend the song's duration. A confirmed new song gets a new offset and duration. Preloaded slider resets cannot restart the old song before its audio changes; real seeks, repeats, and delayed media-clock resets still recover. Temporary disappearance of the slider retains the calibrated clock.

Version 1.0.12 could retain the previous song after a click on the home page. The live tab stayed at `https://music.youtube.com/`, its current player link identified `9QubKb7pjps`, and its canonical link still identified `0d9Oqm0Dt60`. The stale canonical ID was selected before the current player link, so the timing guard could reject the replacement indefinitely. Version 1.0.13 prefers current player links over route parameters and excludes canonical links from playback identity. When no current ID is available, timing and transition guards consistently use the title-and-artist identity.

The next live inspection found Love From The Other Side at `1:53 / 4:40` in YTM, with seek values `113 / 280` and raw media values `897.562882 / 1023.136461`, while the user's Discord screenshot showed `4:40 / 4:40`. Regression tests reproduce a transition in which the new slider maximum appears before its old elapsed value resets. Treating the changed maximum alone as confirmation anchors the replacement song to the previous song's elapsed time. This also fits the user's report that a shorter third song recovered: the carried elapsed value can exceed that song's maximum and be rejected.

Version 1.0.14 waits for fresh elapsed timing or an independently aligned media clock before confirming the replacement. It recalibrates the offset when the song-relative slider advances after a delayed media-clock switch. If the media timeline jumps while the slider is frozen, it preserves elapsed listening time using the playback rate instead of counting the discontinuity as playback. Normal seeks and a legitimately resumed song at the same elapsed position remain supported.

The existing page-player and bar fallbacks remain available when no seek control has been observed. Missing player values remain unknown rather than becoming position zero. Early URL changes, next-song metadata, and stale clocks preserve the last confirmed song until its replacement is ready. Reads completing after navigation are discarded. New songs can report immediately; timing corrections suppressed by the Activity's short report interval schedule another read.

The Discord publisher retains the latest deferred intent and schedules its delivery. Activity changes and timestamp corrections of at least three seconds use the existing 4.2-second minimum interval, while ordinary timestamp jitter retains the 12-second interval. Server `retry_after` still takes precedence, and clearing presence cancels a pending update.

The extension previously passed all 162 tests; its code and existing build are unchanged by this package correction. The Activities checkout passed all 55 top-level tests, including 34 YouTube Music tests, and type checking; shared contract and catalog validation passed. Four song-click regressions failed before the 1.0.13 correction and now pass: home-page playback with stale canonical IDs both with and without the page bridge, title-only playback identity, and current player links while route parameters preload or stay stale. Six additional 1.0.14 regressions cover carryover on a longer second song in both foreground and background playback, a correct shorter third song, delayed media-clock switches, advancing stale elapsed values, frozen slider transitions, and a legitimate resume at the same elapsed position. The cumulative timing, background playback, and early-reset regressions still pass. The user subsequently reported that 1.0.14 appears to work and plans to observe another two or three songs. Browser control rejected the extension Library URL because its policy permits only HTTP and HTTPS pages, so the updated local package could not be installed or independently verified through the available browser UI tools.

To apply the local fix, load `metadata.json`, `activity.js`, and `icon.png` together from `ChudPresence-Activities/activities/youtube-music/` in the Library's Developer view, then refresh YouTube Music. An extension reload alone does not replace the installed Activity's stored source. The existing extension build is under `dist/ChudPresence-Chromium-Activity-Lab-1.9.0/`; the separate Activity update has not been published to the remote catalog.

## YouTube ended playback and hover previews (October 13, 2026)

The catalog and bundled YouTube Activity are both version `1.0.5`. Ended player states, ended media elements, and paused finite timelines at their end now clear the report. The main video's `ended` event clears immediately and invalidates an in-flight player read. Ordinary paused playback remains eligible.

Player and media lookup now use the watch, embed, live, active Shorts, or visible miniplayer context. Browsing previews, hidden players, and inactive Shorts cannot supply playback. The page bridge reads the same scoped player as the DOM fallback.

Validation passed: extension syntax/manifest, shared API contract, catalog hashes and bundled parity; all 227 extension tests (including 20 regressions exercising both YouTube copies); all 67 Activity repository tests; Activity type checking; extension build; and whitespace checks in both repositories. Regression coverage includes ended playback with and without the page bridge, immediate ended events and pending reads, replay, normal pausing, paused live playback, home/search/subscription/channel previews, navigation away from watching, sidebar previews, hidden players, Shorts, embeds, live routes, and miniplayer playback. These are automated DOM/player fixtures; the current live YouTube UI was not tested.

Reload the rebuilt extension and refresh YouTube to activate the bundled update. An installed local or repository replacement retains its own source and must be updated separately to the `1.0.5` package. The local catalog update has not been published.
