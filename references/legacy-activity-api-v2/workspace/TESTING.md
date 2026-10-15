# Chromium Activity Lab verification

## TikTok Explore overlay correction (October 14, 2026)

Read-only inspection of the user's open Explore video reproduced a null report
with TikTok 1.1.0. The live `browse-username` contains the creator's display name,
while `browser-nickname` contains a nested public handle plus the date. The
fixture had identical name/handle values, masking the reversed field mappings.
The actual caption also had 21 visible descendants from mentions/hashtags,
exceeding the generic default of 16.

TikTok 1.1.1 maps these overlay fields explicitly and requests `maxDescendants:
64` only for its caption. Lab 2.2.1 adds that reviewed field option (1–128),
retaining the default 16 and all visibility, sensitive-content and 1,024/256
character text limits. A regression fixture uses distinct display name/handle
values and 21 formatted descendants. Hidden/sensitive descendants after the
sixteenth node still clear; missing grants, oversized captions, wrong identities,
preloads and hidden overlays remain rejected.

The corrected generic collector returned the public caption, `Menlégende😂🔥`,
`@menlegende`, real progress and matching video/profile paths from the same live
DOM. Its JSON report passed worker validation and presence formatting with both
buttons. No live page state was changed and Discord publication was not tested.

Validation: 357 extension tests, 19 SDK tests, contract/catalog checks,
TypeScript, both isolated Brave browser suites, build/ZIP byte verification and
whitespace checks. Reload lab 2.2.1 and reimport TikTok 1.1.1's three package
files to apply the newly reviewed caption grant and field mappings.

## TikTok migration to generic V2 (October 14, 2026)

TikTok 1.1.0 uses schema 2 generic native media collection on lab 2.2.0.
The package owns all TikTok selectors, feed/detail/overlay/LIVE modes, public
path/creator/player bindings, canvas rendering, artwork, buttons and formatting.
Reusable additions cover bounded shared containers, required fields, first-present
extraction, public handles/paths, same-origin links and explicit public fade/BR
grants. Existing schema 1 approvals and adapters remain compatible; the new
package requires reimport and fresh review after the extension reload.

Verified: extension syntax/contracts/catalogs, **356 extension tests**, V2
contract/catalog checks, TypeScript, **19 SDK tests**, both isolated Brave browser
suites, and extension/package ZIPs. The version gate against `208e0b6` sees only
committed changes; a separate working-tree comparison confirms TikTok increases
from 1.0.4 to 1.1.0. Both repositories pass whitespace checks.

The actual 1.1.0 JSON runs through the serialized generic function against the
same inspected feed, canvas, overlay, current LIVE and featured-card DOM as the
adapter fix. Checks cover description/creator formatting, native progress,
absence-only LIVE title fallback, paused/session timing, player/page identity,
same-origin buttons without tracking, hidden/private text and rejected fade
ancestors. Worker tests cover install/restore, stale SPA sender URLs, mode-specific
service enrichment/presentation and paths rejected after route changes. Generic
contract tests reject nested modes/rules, unsupported sources, external link
templates, unbounded ancestor/ID reads and undeclared fields.

Live installed-extension and Discord publication were not exercised. Reload the
extension and import `metadata.json`, `activity.json`, and `icon.png` from the
TikTok package or its ZIP. The package/catalog remain local and unpublished.

## Reusable V2 capabilities and trusted services (October 14, 2026)

Release 2.1.0 adds schema 2 collection/presentation rules and independently
approved service policies. All three checkouts were clean and committed before
work: lab `f20ba1b`, V1 `dd642c2`, V2 `c7f0593`. V1 checkout, API guide, canonical
contract/schema/types and bundled packages remain unchanged.

Verified gates:

- Lab `npm run check`, 348 tests through `npm test`, and `npm run build`.
- V2 `check:contract`, `check:catalog`, TypeScript, all 18 SDK tests, and
  `check-version-bumps.mjs --base=c7f0593` (no existing package changes).
- Existing `scripts/test-v2-browser.mjs` fixtures, preserving schema 1 behavior.
- New `scripts/test-v2-generic-browser.mjs` real-DOM, serialized runtime and
  Library service review fixtures in an isolated headless Brave session.

New cases cover selected-card binding, largest paused players, scoped public
selectors, numeric/literal transforms, visible custom player clocks, retention,
hidden/private descendants with throwing getters, exact package/policy approval,
credential redaction, malformed/oversized API responses, redirect/URL substitution,
cache/rate/concurrency limits, timeout, pending review cancellation/replacement,
and revocation during the final publication check. Lookup snapshots also reject
changed/ended media, replaced documents, clears, disabled generations and revoked
permissions. Revoked service output is removed immediately; presentation is
rerendered from trusted enrichment.

Headless scripts use the bundled Playwright path via
`CHUDPRESENCE_TEST_NODE_MODULES` and installed Brave via
`CHUDPRESENCE_TEST_BROWSER`. They use synthetic media/extension APIs and no user
browser profile. Desktop/mobile service review screenshots are under ignored
`browser-profiles/v2-service-review-{desktop,mobile}.png`.
No live TMDB token, installed-extension request or Discord publication was used
for this change. The TMDB example's first-search-result artwork is illustrative;
it does not prove exact movie identity. Existing service packages retain their
schema 1 compatibility adapters and were not silently migrated.

## Google mode transitions (October 14, 2026)

Switching Google's All, Images and AI Mode previously sent an immediate
document-exit clear before the replacement page reported. The page runtime now
recognizes navigation between approved same-origin routes. The worker validates
both routes, metadata matches/exclusions and the outgoing document before asking
the publisher to retain its last valid report for a five-second handoff window.
The replacement report cancels the window and updates the existing Discord
session. A stalled destination expires the held report. Actual tab removal,
switching away in the same browser window, and Activity teardown cancel the hold;
unsupported and external destinations receive ordinary exit cleanup.

Page navigation and readiness events now request a coalesced sample after 100 ms.
Mutation notifications only resample while the page is unready or its URL changed;
streaming AI DOM updates do not create extra report heartbeats. The two-second
poll remains a fallback. Same-document mode changes keep their last valid report
while the approved replacement root briefly rebuilds. Timer reset rules and the
declared extraction data are unchanged. Discord's existing minimum update interval
and retry-after handling remain in effect while the old session stays visible.

Validation passed: **300 extension tests**, extension/V1/V2 contract and catalog
checks, and isolated Brave fixtures. The new browser fixture follows real
Navigation API/full-document navigation from Search to Images, delays creation
of the destination root by 250 ms, and verifies readiness without waiting for the
two-second heartbeat. It also tests a History API transition to AI Mode while
the root is temporarily absent, and an unsupported Shopping exit. Worker,
background and transport regressions cover rejected handoff hints, expiry,
replacement/late-document ownership, tab closure/activation, another browser
window, teardown and rapid mode switching with the same Discord session token.

Reload the updated extension to apply this to existing Google 1.0.0 installations;
the package JSON and approval digest are unchanged. Live Discord rendering after
reload still needs the user's check.

## Google declarative page activity (October 14, 2026)

Google V2 1.0.0 adds Google Search, Google Images and Google AI Mode through
reusable page declarations, with no Google adapter or package JavaScript.
Core derives the route's static name, submitted-query details, optional visible
result summary, static official Google artwork and elapsed visible-session timer.
Hidden tabs and unsupported Google modes clear reports. The worker checks route
and declared query values against the sending document before formatting them.

Read-only inspection of current Google Search, Images and AI pages verified the
visible #main scope, udm=2 Images and udm=50 AI routes. Both inspected result-count
nodes were hidden, so those counts are omitted. AI responses, input drafts,
account text, result descriptions and tracking values are not read or reported.

Validation passed: **293 extension tests**, **8 V2 tooling tests**, V2 type
checking, extension/V1/V2 contract and catalog checks, diff whitespace checks,
isolated Brave real-DOM fixtures and the extension build. Tests cover modern and
legacy Images URLs, Search/Web/AI names, query decoding and bounds, forged
reports, hidden/sensitive summaries, real elapsed timestamps without a Live
marker, empty state omission in Discord payloads, session resets, and visibility
events arriving during a pending report. Installation/restoration tests verify
that page packages require no player and preserve Google Images through the
worker. Existing media fixtures also pass.

Load the updated extension, then import metadata.json, activity.json and icon.png
from ChudPresence-Activities-V2/activities/google/ through Developer mode. The
package and catalog remain local; Discover requires repository publication.
Installed-extension behavior and the final Discord card still need that live
installation check. The rebuilt extension zip is in dist/.

## TikTok line order (October 14, 2026)

After the user confirmed playback works, the bundled TikTok formatter was
changed to match the extension's established title/creator order. Videos show
their description on the first line and creator name (@username) on the second.
LIVE shows the fixed heading `Watching Live` first and the creator name second,
including when a stream title exists in the collected media metadata. The
existing Paused marker is appended to the creator line. Creator status maps to
state; Video / LIVE status maps to details. Playback detection, declared reads,
permissions, artwork, links and timing are unchanged.

The layout applies to existing installed TikTok packages after extension reload.
Package metadata is version 1.0.4 to update its description and status-option
label; its activity.json and icon bytes are unchanged from 1.0.3. Importing that
metadata update follows the usual exact-byte review.

Validation passed: all **280 extension tests**, all **7 V2 tooling tests**,
contract/catalog/type checks, extension build and all real-DOM Brave fixtures.
Existing assertions now verify description-first / creator-second video and
Explore layouts, the constant LIVE heading above creator, paused creator text,
and the Creator/Video status preference mapping. Final display in the installed
browser/Discord still requires the user's extension reload.

## TikTok current LIVE rooms and featured feeds (October 14, 2026)

TikTok 1.0.3 adds the current LIVE layouts found through read-only inspection of
the user's playing stream and a temporary `/live` feed tab. The direct stream's
video is inside `live-room-content`; its public `live-header-container` is a
sibling in the same bounded panel. The creator name is `room-header-anchor-name`
inside a public profile link. The link must match the individual LIVE URL.
This layout exposes no stream title, so absent public titles use the static
state `TikTok LIVE`. Present but hidden/rejected titles still clear reports.
Chat, app/body roots, recommendations and other creators cannot supply metadata.

The featured feed player is inside `discover-list-live-card`. Its public title,
creator and stream links fade behind the fixed `.ee35qag0` metadata layer while
playback continues. The approved 1.0.3 selectors use `.e1xspjl31` for title and
`.e1xspjl34` for creator. Only that layer's zero opacity is exempted; display,
visibility/accessibility hiding, hidden fields/descendants, sensitive elements,
other zero-opacity ancestors and hidden players remain rejected. Old approved
1.0.0–1.0.2 configurations remain valid without acquiring these extra reads.
The Library review explicitly describes this exception and the absent-title
fallback before approving the new package bytes.

The corrected bundled collector returned playing stream reports for the actual
`@cancelleddunks` room (state `TikTok LIVE`) and the featured `@tylercarsells`
stream (creator `Tyler Edwards`, title `Lets Go LIVE!`). Both included the clean
Watch Stream / View Profile buttons and live elapsed-session semantics. The
temporary feed tab was closed, leaving the user's original stream open.

Validation passed: all **280 extension tests**, all **7 V2 tooling tests**,
contract/catalog/type checks, the initial-history version gate, extension build,
and real-DOM Brave fixtures. New coverage exercises elapsed sessions, pause,
visible/absent/rejected titles, mismatched creator URLs, public-panel boundaries,
private chat/recommendation isolation, featured-card fades, sensitive descendants
and legacy approval boundaries. Existing TikTok video/Explore/canvas and
Library/Prime browser fixtures also pass.

The installed extension and final Local Presence/Discord display still require
manual verification. Browser Use's previously observed URL policy blocks
internal extension pages; no workaround or repeated blocked access was attempted.
Reload the updated extension, import TikTok 1.0.3's `metadata.json`,
`activity.json`, and `icon.png`, approve its updated reads, then refresh TikTok.
The package and regenerated catalog remain local.

## TikTok current-player and Explore-overlay fixes (October 14, 2026)

TikTok 1.0.2 corrects the initial integration using live read-only browser
inspection. The user's feed/detail player rendered through a visible sibling
`tt-vod-sr-wrap` canvas while its clock VIDEO had zero opacity. Its creator was
a paragraph under `DivCreatorInfoContainer`, its handle was in the profile link,
and the player ID used `xgwrapper`. Empty BR formatting nodes in the description
also failed the initial blanket descendant-rectangle test. Version 1.0.1 added
those fixed reads and a narrow canvas-backed opacity exemption; hidden ancestors,
missing/hidden canvases and non-empty hidden text remain rejected. Legacy 1.0.0
configuration stays valid for approved-record restoration.

The Explore video opened in an overlay outside the page's main container, with
hashed container classes and fixed `browse-video`, `browse-video-desc`,
`browser-nickname` and `browse-username` markers. Version 1.0.2 locates their
nearest shared metadata container within five ancestor steps and requires the
player ID to match the current public video URL. App/body roots, preloads,
comments, mismatched creators, hidden text and Explore grid previews are excluded.
The nickname's visible `SpanEllipsis` supplies the name without its posted date.
Read-only execution of the corrected bundled collector returned the expected
playing report, description, progress and clean public buttons for the actual
`@funnyasiandude` feed/detail video and `@mw10.03` Explore-overlay video.

Both Library and presence artwork now use the unchanged flat 512 × 512 Android
icon from TikTok's official Google Play listing. Its background is opaque and
square, with no baked-in iOS rounded bevel. Discord can still apply its own
corner mask. Page content cannot change the static hosted logo URL.

Validation passed: all **276 extension tests**, all **7 V2 tooling tests**, V2
types/version gate, synchronized schemas/catalog hashes, extension build and
real-DOM Brave fixtures for current canvas playback and Explore overlays, as well
as the existing Library/Prime/TikTok fixtures. The new overlay unit tests reject
unbounded ancestry, app roots, hidden fields and incorrect player/creator IDs.
The regression fixture includes an unrelated Explore grid, a preloaded next
video, nested hashtag markup and a private comment draft; only public metadata
from the current overlay is reported.

Browser Use blocked the extension's internal page because its URL policy permits
only HTTP/HTTPS pages. No workaround was attempted. The installed-extension
update and final Local Presence/Discord verification must be performed manually:
reload the updated extension, import TikTok 1.0.2's `metadata.json`,
`activity.json`, and `icon.png`, approve the update, then refresh TikTok. Local
source/build/catalog updates have not been published.

## TikTok API V2 (October 14, 2026)

Added the local TikTok 1.0.0 JSON package and fixed bundled `tiktok` adapter.
For You, Following and individual videos show creator name/handle, description,
progress and public video/profile buttons. LIVE shows the creator, stream title,
elapsed viewing session and stream/profile buttons. Core always supplies a square
black TikTok mobile icon with cyan/red offsets; reports cannot supply previews.
The Library icon comes from TikTok's official asset pack, and the fixed presence
image is TikTok's current App Store square icon hosted by Apple's image CDN.

Validation passed: extension syntax/contracts/catalogs, all **274 extension
tests**, all **7 V2 tooling tests**, V2 type checking and version gate, extension
build, and whitespace checks in both repositories. The isolated Brave real-DOM
fixture passed TikTok card selection, creator/description isolation, clean
buttons, logo-only artwork, hidden text rejection, pause, individual video,
Following, LIVE timing and private-route cleanup. Existing Library and Prime
Video browser fixtures passed in the same run. Unit tests also exercise the
serialized collector, stream/player transitions, invalid configuration/URLs,
preference handling and off-screen/sensitive metadata rejection. A partially
visible neighboring autoplay video cannot steal the larger paused card.

These tests use synthetic public-player fixtures. Live TikTok markup, actual
website permission approval and Discord publishing have not been verified for
this package. The package/catalog changes remain local. Reload the updated
extension and load `metadata.json`, `activity.json`, and `icon.png` from
`ChudPresence-Activities-V2/activities/tiktok/` through Library → Developer.


## Separate V1 and V2 repositories (October 13, 2026)

V1 packages and tooling remain in the independent nested `ChudPresence-Activities/`
checkout. V2 contracts, standalone validator/types, authoring tools, catalog and
Prime Video 1.1.0 now live in `ChudPresence-Activities-V2/`, published at
[ChudForks/ChudPresence-Activities-V2](https://github.com/ChudForks/ChudPresence-Activities-V2).
Both checkouts are ignored by the lab and excluded from extension packaging.

| Scope | Verification | Result |
| --- | --- | --- |
| Extension | `npm run check`, `npm test`, `npm run build` | Passed; 267 tests, both contract/catalog checkouts, bundled YouTube parity, and 2.0.0 archive |
| V1 Activities | Contract/catalog checks, typecheck, tests, version gate | Passed; nine packages and 80 tests |
| V2 Activities | Contract/catalog checks, typecheck, tests, initial-commit version gate | Passed; Prime Video 1.1.0 and eight tests, including a standalone SDK fixture without the lab or V1 |
| Published V2 | [GitHub Actions](https://github.com/ChudForks/ChudPresence-Activities-V2/actions/runs/38499966783) | Passed on initial commit `1338f7b` |
| Live catalog download | Actual extension repository client against both public GitHub repositories | Ten activities, two independently pinned revisions, no warnings; Prime Video metadata/configuration SHA-256 checks passed |

Regression fixtures cover separate repository routing, immutable icon/package URLs,
partial failures and per-source cache fallback, legacy V1 cache migration,
conflicting IDs, wrong repository provenance, and source-aware updates. The live
network check exercised published catalog/package downloads; live playback and
Discord publishing were not exercised as part of this repository split.

## V2 hidden-descendant privacy regression (October 13, 2026)

The shared collector previously checked the selected field element's visibility
but read its full `textContent`, including CSS-hidden descendants. Five regression
checks (including serialized runtime publication and Prime Video cache behavior)
and the real-DOM browser fixture reproduced the leak before the fix.

The collector now rejects the entire field before reading text or attributes
when any of its bounded descendants fails visibility checks. This includes
`display: none`, hidden/collapsed visibility, zero opacity, absent layout
rectangles, and `content-visibility: hidden` on the target, descendants or
ancestors. Visible nested formatting and safe selector fallbacks still work.
Prime rejects and clears cached titles containing hidden text, and omits rejected
episode text from both current and retained reports.

All **251 lab tests**, `npm run check`, Prime Video package validation/tests, and
the isolated headless Edge fixture passed. The browser fixture checks nested
hidden title/episode content, clearing, cache invalidation, recovery and ordinary
playback. Extension APIs and media state are fixtures; live Prime playback and
Discord publication were not exercised. Reload the rebuilt extension and refresh
the Prime Video tab to activate the bundled collector fix.

## Declarative public Activity API V2 (October 13, 2026)

The 2.0.0 lab supports V2 `metadata.json` / `activity.json` packages using only
bundled ChudPresence DOM and HTML media collectors. The V1 execution contract
remains separate. Schema/validator copies, SDK declarations, local loading,
immutable catalog downloads, exact-byte approval, and developer documentation
are synchronized between the lab and the separate Activities checkout.

`npm run check`, all **242 lab tests**, `npm run build`, SDK contract/catalog
checks, TypeScript checking, and all **81 SDK tests** passed. Security regressions
cover executable/unknown config rejection, protected/local hosts, wrapper escape
strings remaining data, bridge/URL denial, source identity collisions, stale and
unapproved generations, changed-byte approval, disabled update preservation,
rollback/storage failure, corrupt restoration, revocation, asynchronous update
races, scoped DOM reads, hidden/sensitive nodes, and authenticated SPA exit clears.
Origin cleanup preserves overlapping grants and required baseline hosts.

`scripts/test-v2-browser.mjs` passed in an isolated headless Edge context. It
verified the actual Library's staged review, cancellation, denied/granted site
requests from the approval gesture, desktop/390px dialog layout, digest binding,
real DOM extraction, and sensitive form-node rejection. Screenshots were visually
inspected. Extension APIs and media properties were synthetic fixtures; native
userScripts registration/CSP/permission dialogs, live site playback, Discord
publishing, and Chrome Web Store approval were not exercised by this check.

The build output is `dist/ChudPresence-Chromium-Activity-Lab-2.0.0.zip`. Selected
DOM text still needs review for privacy. Custom player adapters, artwork/links,
child frames, and a durable update transaction journal are outside this first V2
implementation; the developer guide states those limits.

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

## Instagram API V2 — October 14, 2026

Added the declarative Instagram 1.0.0 package in the separate V2 checkout and
the bundled `instagram` adapter, synchronized contracts/types/validators and
the three-package local V2 catalog. All supported modes use the static Instagram
app logo. Reels use caption/@username with native video timing; video and photo
stories use Watching Story/@username. Photo stories have no fabricated timer.

`npm run check` and all **284 extension tests** passed. The V2 checkout's
contract/catalog checks, typecheck and all **7 SDK tests** passed; its version
gate against `HEAD` passed (Instagram is a new 1.0.0 package). The extension
build and both repositories' whitespace checks also passed.

The isolated Brave real-DOM fixture passed for the serialized V2 collector on
Reels feed/individual/article layouts, largest-visible-card selection including
paused current reels, bounded creator/caption extraction, captionless fallback,
hidden/sensitive text rejection, clean links and logo-only formatting. Story
fixtures cover video and loaded photo content, Play/Pause state, creator/route
matching, neighboring previews/replies, unready/ended/hidden media and clearing
outside eligible routes. Existing Prime Video, TikTok and V2 Library fixtures
also passed.

Live read-only Instagram markup inspection confirmed the current Reels card's
deep player wrappers, caption block, creator profile links and the story viewer's
creator/control/media layout. Synthetic media clocks do not verify a real
installed Activity or Discord publication; those checks still require reloading
the updated extension and importing Instagram's three package files.
See [V2_ADAPTER_REPORT.md](V2_ADAPTER_REPORT.md) for why the adapter is needed.

## Roblox API V2 — October 14, 2026

Added Roblox 1.0.0 in the separate V2 checkout and regenerated its five-package
catalog. Homepage/Home shows `Browsing Roblox`; Discover/Charts and chart
categories show `Browsing experiences`; experience detail pages show
`Viewing: <visible experience heading>`. Static official Roblox artwork and
elapsed visible-page time apply throughout; the second status line is omitted.

The reusable page contract now supports bounded whole `{number}` / `{segment}`
path tokens, reviewed route containers and static route titles. Static titles
skip extraction and are checked by the worker. Both serialized route predicates
agree, and the session key includes the route/path so changing experience IDs
resets the timer even when names match. No Roblox adapter is added.

Validation passed: extension check, **308 extension tests**, V2 contract/catalog
checks, type checking, **10 V2 SDK/package tests**, and isolated Brave real-DOM
fixtures. Coverage includes all three statuses, experience-heading scoping,
hidden/sensitive text and hidden descendants, ignored search drafts/descriptions,
static title forgery, bounded path rejection, route/timer/tab cleanup, approved
worker install/restore/navigation handoff, preference handling and Discord payload
formatting. Existing Google, Instagram, TikTok, Prime Video and Library browser
fixtures also passed.

The extension build, Roblox package ZIP byte verification and both repositories'
whitespace checks passed. The build contains the updated page runtime/validator;
the separate Roblox ZIP contains the three import files and package notes.

Read-only public Roblox inspection confirmed `#react-landing-container`, the
current Charts route, Discover's redirect to Charts, and Brookhaven's visible
`h1.game-name` inside `#game-detail-page`. The current site spells that heading
`Brookhaven 🏡RP`; the package preserves it. Logged-in Home and live installed
extension/Discord publication still need manual verification. Native Roblox
client gameplay is outside this browser activity's scope.

Reload the updated extension and import `metadata.json`, `activity.json` and
`icon.png` from `ChudPresence-Activities-V2/activities/roblox/` in Activity
Library's Developer view. The package and local catalog have not been published.

## Roblox 1.1.0 section statuses — October 14, 2026

Expanded Roblox from the initial three-state package to distinct `Browsing home`,
`Browsing charts`, `Browsing marketplace`, `Browsing Robux` and main sidebar
labels: Roblox Plus, profiles, friends, avatar, inventory, trades, communities,
messages, settings and gift cards. Catalog items retain the marketplace label;
numeric profile/friends/inventory and community-detail routes retain their
section label. Experience pages still show their visible game heading. Create
and Creator Dashboard remain excluded.

Charts now declares its visible `#game-carousel-web-app` container. Read-only
inspection of the signed-in browser verified Home, current Charts/Marketplace
and Robux layouts, main navigation/sidebar URLs, and Plus/gift-card containers.
The package defines sixteen routes, so the reusable V2 page route limit is now
32 while all selector, text, path, report and byte limits remain intact. Browsing
routes use literals and never read section contents, balances, message bodies,
inventory items or usernames.

Validation passed: extension check, all **308 extension tests**, V2
contract/catalog checks and type checking, all **10 SDK/package tests**, and
isolated Brave real-DOM fixtures. Tests cover every section's Discord details,
numeric routes, visibility, title isolation, static title verification, the
32-route boundary and worker install/restore of expanded declarations. Existing
media and Google/Library browser checks also passed.

Apply the update by reloading the updated extension, then reimporting the three
Roblox package files and approving 1.1.0. Reloading alone retains 1.0.0's stored
JSON. Live installed-extension and Discord rendering need this update applied;
the package and local catalog remain unpublished.

## Roblox same-document navigation validation — October 14, 2026

The user reported that Home appeared on initial entry, Charts never appeared,
Marketplace/Robux worked and Home stopped appearing on return. Their snapshot
showed the same document ID continuing to identify its sender URL as `/catalog`
while the live page was Charts. The last error was `invalid_report` with
`V2 page report must match an approved route.` Live read-only Charts inspection
confirmed its declared container and normal visibility.

The worker now reads the current URL using bundled code executed in the exact
sending top document and Activity world before validating a V2 page report.
It requires the returned document ID to match, rechecks permissions/generation,
and enforces metadata matches/exclusions and the approved page route/query rules.
Unavailable, replaced or child documents fail closed. Package URL overrides and
unrelated tab URLs cannot supply the verification. Diagnostics/ownership record
the verified current page URL. The Roblox package remains 1.1.0; apply the fix by
reloading the updated extension and refreshing Roblox, without reimporting JSON.

Validation passed: extension check, **312 extension tests**, V2 contract/catalog
checks and type checking, **10 SDK/package tests**, and the isolated Brave browser
suite. The new browser fixture connects the serialized collector to the actual
Activity Manager, freezes the sender URL at `/catalog`, rebuilds DOM containers
after navigation, and verifies Home → Charts → Marketplace → Robux → Home → Charts
→ Home publishes each correct label promptly. Unit regressions additionally cover
same-route query changes, false page/tab URL evidence, replaced/unavailable
documents, outside grants, and revocation/generation races. Live installed
extension/Discord rendering still requires the extension reload.

## Instagram generic V2 reels migration — October 14, 2026

Migrated Instagram 1.1.0 in the independent V2 checkout to schema 2 and the
reusable collector. The package requires Chromium lab 2.3.0 and declares reels
feed/detail/article layouts, caption/@username presentation, native progress,
static Instagram artwork and same-origin reel/profile buttons. Stories are
explicitly deferred: the new package excludes them, while existing 1.0.0
approvals and their compatibility story adapter remain supported until replaced.

Added generic single-player container searches (up to sixteen ancestors, keeping
the existing five-step default), bounded native video/audio scopes, public dir/id
selector literals, visible anchor text/path matching and public link/page identity.
No Instagram branch or selector was added to the generic collector. A winning
player without its own metadata clears instead of publishing a smaller neighbor.
The SDK validator, canonical/generated schemas, types and developer guides are
synchronized; the local catalog contains the updated package hashes.

Validation passed: all **363 extension tests**, **20 V2 SDK/package tests**, SDK
type checking, extension syntax/contract/catalog checks, and both isolated Brave
browser suites. The same saved twelve-wrapper card and article DOM fixtures now
exercise the compatibility adapter and generic package. Coverage includes paused
current reels beside autoplay, caption fallback, hidden/private descendants,
visible creator text/path checks, absent current metadata, conflicting reel IDs,
query/fragment stripping, public buttons, logo, timing and preferences. Approved
install/restore verifies the exact package, minimum extension version, frozen
sender versus current document URL, and rejection of story/unrelated/foreign-host
reports. Legacy story fixtures and existing TikTok/Google/Roblox/Prime Video and
Library fixtures still pass. Both repositories pass whitespace checks.

Built the ignored extension archive
`dist/ChudPresence-Chromium-Activity-Lab-2.3.0.zip` and standalone package archive
`dist/Instagram-1.1.0-V2.zip`. Compared the staged runtime/validator and every
package ZIP entry with the checked source bytes. Reload extension 2.3.0, then
reimport Instagram's metadata.json, activity.json and icon.png and approve 1.1.0.
Live installed-extension and Discord publication remain manual verification;
local changes and the catalog have not been published.
