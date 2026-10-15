# ChudPresence Chromium Activity Lab

This repository contains the **2.3.0 Manifest V3 Chromium development extension** for trusted Activity API V1 and declarative public Activity API V2. It installs playback Activities, selects the current media, shows a local presence preview, and optionally publishes it to Discord. It is a separate development build from the original ChudPresence Solo Chrome release.

Public V2 packages contain `metadata.json` and `activity.json`; ChudPresence
performs approved DOM/player inspection using bundled code. Start with the
[V2 developer guide](extension/ACTIVITY_API_V2.md) and [example package](examples/v2/html-media/metadata.json).

New V2 packages can use `schemaVersion: 2` to select the largest visible player,
bind metadata to its card, read public layout selectors, parse literal/numeric
fields, retain metadata while controls disappear, inspect visible canvas/photo
players and declare presentation. These rules ship in the Activity JSON, so
supported selector and formatting changes need only a package version/update.
Try the [generic feed example](examples/v2/generic-feed/activity.json).
Extension 2.2.0 adds reusable media modes, bounded shared containers, player
identity and approved same-origin public links; TikTok 1.1.0 uses these rules.
Existing schema 1 approvals and bundled service adapters remain compatible;
those packages are not automatically migrated to the new format.

V2 metadata lookups require a separately approved service policy. In Library
**Developer → Trusted lookup services**, select a policy JSON, review its exact
endpoint and inputs, enter its service token when required, and approve its
origins. An Activity names the service and declared media inputs; it cannot add
a destination, access the token or receive raw response data. The
[TMDB example](examples/v2/services/README.md) supplies a movie-artwork policy.
Unknown services and destinations are blocked. Policies can be updated or
revoked separately, without an extension release. V1 is unchanged.

## The three repositories in this workspace

| Checkout | Responsibility |
| --- | --- |
| This repository | Chromium runtime, Activity Library, popup, permissions, settings, Discord authorization and publishing, schemas, tests, and local packaging |
| [`ChudPresence-Activities/`](ChudPresence-Activities/README.md) | Trusted V1 packages, V1 catalog, canonical V1 contract and SDK types, authoring CLI, and shared artwork |
| [`ChudPresence-Activities-V2/`](ChudPresence-Activities-V2/README.md) | Declarative V2 packages including Prime Video, V2 catalog, canonical V2 contract and types, JSON authoring CLI, and validation |

Both Activities directories are independent Git checkouts ignored by the lab, outside the extension build. The V1 catalog contains **67Movies, Crunchyroll, Disney+, Hulu, Kick, SoundCloud, Twitch, YouTube, and YouTube Music**. The local V2 catalog contains **Google, Instagram, Prime Video, Roblox and TikTok**. Discover combines the official `ChudForks/ChudPresence-Activities` and `ChudForks/ChudPresence-Activities-V2` catalogs while retaining each package's repository and immutable revision. Editing a local checkout does not change Discover; use Developer mode to test local packages.

The extension bundles a copy of the YouTube Activity for the first install. Once user scripts are available, it installs automatically. Disabling it is preserved across bundled updates; removing it prevents automatic reinstallation. Other Activities are installed through the Library.

## Run locally

1. Use Chrome or another Chromium browser based on version 135 or newer. Open its extensions page (`chrome://extensions` in Chrome), enable **Developer mode**, and select **Load unpacked**.
2. Select this repository's `extension/` directory and open **Activity Library** from the popup.
3. On Chrome 138 or newer, open the extension's details page and enable **Allow User Scripts**, then reload the Library. Earlier supported Chrome versions use Developer mode. The Library reports API availability and missing website permissions.
4. Use **Refresh catalog** in Discover and approve access to the GitHub API and raw-file origins. Opening the Library initially reads its cached catalog. YouTube appears in Installed once user scripts are available; install the other Activities, including Hulu, from Discover. Approve their declared HTTPS website and network origins. 67Movies requests The Movie Database's API origin; Hulu declares its own series and movie page paths for artwork lookups.
5. Play media and inspect the popup's **Local playback diagnostics** and presence preview. Enable developer tools in the Library's Developer view for reports, clears, frame/document ownership, settings, permissions, logs, and network diagnostics.

In **Developer**, enable developer tools to open **Activity logs**. Choose one Activity or all, then filter Activity logs, network requests, or playback/runtime snapshots and log levels. **Copy visible** copies the filtered text; **Select all** prepares it for manual copying. Focusing the text area holds its view during refresh, and **Pause updates** freezes a snapshot while new diagnostics continue collecting. **Clear history** resets the selected Activity's diagnostic history (or all history with All Activities selected) while playback, settings, and running requests continue. Installed cards offer **View logs** to open an Activity directly.

To load a local package, enable developer tools and select `metadata.json` plus `activity.json` for public V2, or `activity.js` for trusted V1 development. Include `icon.png` when declared. V2 shows the extraction review before installation; local V1 uses the explicit **Run trusted V1 JavaScript** action. After changing V2 files, increase the package version and approve the update. **Reload Activity** reruns the stored package in its active documents. Website permissions are still required.

Disney+ is available locally in `ChudPresence-Activities/activities/disney-plus/`.
Load its three package files through Developer mode and approve Disney+ website
access. It presents episodes like Hulu: episode title first, series second,
season/episode artwork text, playback progress, and watch/service buttons.
The package uses API v1's page bridge for Disney's custom player metadata and
timeline and also supports ordinary video metadata on legacy `/video/` routes.
Live Disney+ playback still needs browser verification; local tests use synthetic
player fixtures.

Prime Video is available as a public API v2 package in
`ChudPresence-Activities-V2/activities/prime-video/`. Reload the updated extension,
then load `metadata.json`, `activity.json`, and `icon.png` through Developer mode and approve
the declared Prime Video/Amazon US video hosts. Its bundled adapter reads the
overlay player's title and progress, retaining previously visible title text
when controls disappear. Version 1.1.0 adds episode names, season/episode numbers
and matching public episode/show artwork through its explicit details mode.
Version 1.1.1 adds the official Prime Video service icon in the Library and popup.
Show the controls if installing during playback. It supports the modern
top-frame player, with no package JavaScript or network requests. See the
[package notes](ChudPresence-Activities-V2/activities/prime-video/README.md).

TikTok is available as API v2 version 1.1.1 in
`ChudPresence-Activities-V2/activities/tiktok/`. Reload extension **2.2.1**,
then reimport `metadata.json`, `activity.json` and `icon.png` in Developer mode
and approve the updated extraction review. The package now uses reusable
`schemaVersion: 2` capabilities with no TikTok-specific adapter. Its JSON owns
feed/detail/overlay/LIVE layouts, largest-visible player selection, canvas
rendering, creator identity, public same-origin buttons, artwork and formatting.
For You, Following and individual videos show the description first, creator
name and @username second, native progress, View TikTok and View Profile.
LIVE shows `Watching Live`, creator, viewing-session elapsed time, Watch Stream
and View Profile. Flat square TikTok app-logo artwork remains static.
The adapter-fix behaviors are covered by the same saved real-DOM fixtures.
Existing 1.0.x installations retain their approved compatibility behavior;
reloading the extension alone does not replace stored package JSON.
Live installed-extension and Discord verification still require applying the
update. See the [TikTok package notes](ChudPresence-Activities-V2/activities/tiktok/README.md).

Instagram is available as API v2 version **1.1.0** in
`ChudPresence-Activities-V2/activities/instagram/`. Reload extension **2.3.0**,
then reimport `metadata.json`, `activity.json` and `icon.png` in Developer mode
and approve the updated extraction review. Reels now use reusable
`schemaVersion: 2` capabilities: the package declares current-card and article
layouts, caption/@username presentation, native video progress, public reel/profile
buttons and the static Instagram app logo. The same real-DOM fixtures exercise
the adapter fix and the generic package. This update supports **reels only**;
story migration is deferred. Existing 1.0.0 approvals keep their compatibility
adapter and story behavior until replaced. Reloading alone retains stored JSON.
See the [package notes](ChudPresence-Activities-V2/activities/instagram/README.md)
and [capability report](V2_ADAPTER_REPORT.md). Installed-extension and Discord
publication still need verification after applying the update.

Google is available as API v2 version 1.0.1 in
`ChudPresence-Activities-V2/activities/google/`. Reload the updated extension,
then import `metadata.json`, `activity.json` and `icon.png` in Developer mode.
The empty homepage shows **Google** with **Homepage** beneath it.
Search uses **Google**, Images uses **Google Images**, and AI Mode uses **Google AI**,
with `Searching for : query`, official Google artwork and an elapsed session timer.
This package uses reusable page rules with no Google adapter or media player.
Mode changes retain the last presence during a bounded navigation handoff and
resample promptly as the destination becomes ready, updating the existing session.
Result counts are included only when visible; the current inspected Google layout
hides them. Unsupported sections and hidden tabs clear presence. See the
[Google package notes](ChudPresence-Activities-V2/activities/google/README.md).

Roblox is available as API v2 version 1.1.0 in
`ChudPresence-Activities-V2/activities/roblox/`. Reload the updated extension,
then import `metadata.json`, `activity.json` and `icon.png` in Developer mode.
The landing page and Home show `Browsing home`; Discover, Charts and chart
categories show `Browsing charts`; Marketplace shows `Browsing marketplace`,
and Robux shows `Browsing Robux`. Main sidebar sections have their own labels
for profiles, friends, avatar, inventory, trades, communities, messages, settings,
Roblox Plus and gift cards. An experience page shows
`Viewing: <experience name>` from its visible heading. All modes use the Roblox
name, official static icon and elapsed visible-page time. Hidden tabs and
unsupported sections clear presence; Create is excluded. Reloading the extension
does not replace an installed Activity's stored JSON: reimport the package to
update from 1.0.0. This package uses declarative page rules,
including bounded URL path tokens, route containers and literal browsing titles,
without a Roblox adapter. See the
[Roblox package notes](ChudPresence-Activities-V2/activities/roblox/README.md).

The extension also verifies page-report URLs in their exact sending document,
so Chromium's stale user-script sender URL cannot reject Home/Charts after
Roblox navigation. Apply this worker fix by reloading the extension and
refreshing Roblox; an installed Roblox 1.1.0 package does not need reimporting.

The popup lists installed Activities dynamically. Settings provides a global **Enable Activity Lab** switch and per-Activity enable, paused playback, status text, artwork, progress, and button preferences. Activity-defined settings are managed in the Library. Playing media takes priority over paused media, and the selected tab stays selected while eligible. Non-normal visibility produces no presence.

## Optional Discord connection

Playback detection and the local presence preview work without Discord. To publish, connect through the popup while **Enable Activity Lab** is on; sharing is enabled by default. The build uses the fixed public application ID `1549066134706323548`.

For an unpacked install, obtain the callback by opening the extension's service-worker DevTools from the extensions page and evaluating:

```js
chrome.identity.getRedirectURL('discord')
```

Register that exact callback for the application's OAuth setup in the Discord Developer Portal with **Public Client** enabled. The callback depends on the lab's actual extension ID. Discord publishing uses an experimental Headless Sessions transport.

Activity-authored song, artist, and album links can make Discord text and artwork clickable. During ordinary playback transitions, an empty presence is delayed to avoid flicker. Document exit and tab closure trigger immediate cleanup; a private offscreen document also keeps deferred deletion, when supported, and a document-exit keepalive fallback armed. The popup shows **Browser-close backup** and **Last Discord clear**. Failed deletions retain the session token for retries. The recorded Brave window-close check and its limits are in [TESTING.md](TESTING.md).

## Development gates

Use Node.js 20 or newer as declared by both repositories; the latest checks used Node.js 24.21.0. The extension has no npm dependencies to install. Run from this repository:

```sh
npm run check
npm test
npm run build
```

Run the package checks separately from each Activities checkout:

```sh
cd ChudPresence-Activities
npm ci
npm run check:contract
npm run check:catalog
npm run typecheck
npm test
node tools/check-version-bumps.mjs
```

The version-bump gate accepts `--base=<ref>` and otherwise uses GitHub event/base environment variables or `HEAD^`; use the intended review base. See the [Activities README](ChudPresence-Activities/README.md) and [verification record](TESTING.md) for the existing metadata/version discrepancy in this checkout.

`npm run check` validates extension syntax, local V1/V2 contracts, the V2 example, and bundled YouTube. When the corresponding nested checkout is present, it also checks that repository's contract and catalog outputs; V1 additionally checks bundled YouTube parity. V1 contract changes belong in `ChudPresence-Activities` and use `node tools/generate-api-contract.mjs`. V2 contract and validator changes belong in `ChudPresence-Activities-V2` and use `node tools/generate-api-v2.mjs`. Each generator refreshes the lab copies in this nested layout; standalone checkouts validate independently. Repeat the package commands above from `ChudPresence-Activities-V2`; its first commit has no earlier version baseline.

`npm run build` replaces `dist/` with `ChudPresence-Chromium-Activity-Lab-2.2.1/` and its zip. A system `tar` executable is required for packaging. On Windows, `build.bat` runs the same three extension gates. Load `extension/` directly while debugging. `dist/`, `baseline/`, `browser-profiles/`, and the Activities checkout are ignored here. Building performs no publication.

See [architecture](ARCHITECTURE.md), [the Activity API guide](extension/ACTIVITY_API.md), [verification results](TESTING.md), [privacy details](PRIVACY.md), [the original baseline](BASELINE.md), and [porting status and remaining checks](PORTING_PLAN.md). Activity API V1 is intended for trusted first-party packages.
