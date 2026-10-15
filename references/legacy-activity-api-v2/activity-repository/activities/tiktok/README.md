# TikTok 1.1.1 (API V2, generic capabilities)

Reload Chromium lab **2.2.1** or later, then import `metadata.json`,
`activity.json`, and `icon.png` through Activity Library → Developer and approve
the updated extraction review. An extension reload alone retains the installed
package's old JSON. This package uses `schemaVersion: 2` and the generic native
media collector, with no TikTok adapter, package JavaScript or network requests.

| Activity / Page | Presence details | Presence state | Timer | Buttons |
| --- | --- | --- | --- | --- |
| For You / Following | Video description | Creator name (@username) | Video progress | View TikTok, View Profile |
| Individual video / Explore, profile or search video overlay | Video description | Creator name (@username) | Video progress | View TikTok, View Profile |
| LIVE room / featured LIVE feed | Watching Live | Creator name | Viewing-session elapsed | Watch Stream, View Profile |

The flat square TikTok Android app icon remains the Library and presence artwork.
Video previews, posters, covers and creator avatars are never used. User
preferences still control artwork, buttons, progress, paused playback and status
text. LIVE time measures this viewing session, not the broadcaster's uptime.

The package now owns all site selectors, supported paths, layout modes, required
fields, player/metadata boundaries, public button paths and presentation. Feed
cards select the largest on-screen ready player, using playing state to break
area ties. An opacity-zero video clock requires its overlapping visible SR canvas
inside the same `.tiktok-web-player`. Childless BR description formatting is
allowed; other hidden text and descendants remain rejected.

Overlays bind the matching player ID to the individual video URL, then find the
nearest shared description/creator container within five ancestor steps. They
cannot use the app/main/body root, preloaded players, another creator, comments
or Explore hover previews. `browse-username` supplies the display name (including
emoji); the inner username in `browser-nickname` supplies the public handle,
excluding its posted date. Overlay captions explicitly allow up to 64 visible
formatting descendants instead of the default 16, while retaining every hidden,
sensitive and text-length check.

LIVE rooms bind their header to the active room's immediate shared panel, keeping
chat and recommendations outside metadata reads. An absent public title uses
`TikTok LIVE`; a present hidden/rejected title clears. Featured cards explicitly
grant only their `.ee35qag0` public metadata ancestor's zero opacity. Hidden
fields, descendants, players, other ancestors and every other hiding mechanism
remain rejected. LIVE sessions reset on stream/creator, player, source, mode or
URL changes, playback exit and reload.

Buttons use approved same-origin public path patterns, explicit creator bindings,
and real page/link/player IDs. Query strings and fragments are discarded. When
no real video ID exists, only View Profile appears. External links cannot supply
handles or destinations; extracted text cannot become artwork or an external URL.
Messages, settings, uploads, profiles without an open video, unrelated browsing,
off-screen, unready and ended players produce no presence.

Versions 1.0.1–1.0.3 fixed current creator cards, canvas rendering, overlays and
LIVE layouts in the compatibility adapter; 1.0.4 aligned description/creator
formatting. Version **1.1.0** moves those behaviors into reusable declarations.
Future supported selector/formatting changes require a package version increase
and reimport, without a TikTok-specific extension change. Existing 1.0.x approvals
remain supported until the user imports the new package. Version **1.1.1** fixes
Explore overlays whose display name differs from their handle, and captions
containing many mention/hashtag nodes. The earlier fixture used identical names
and handles with a short caption, so it missed both failures.

Verification uses the Chromium lab's `test/tiktok-v2-generic.test.js`, worker
install/restore tests, and the same real-DOM feed, canvas, overlay, current LIVE
and featured-card fixtures as the adapter fix in `scripts/test-v2-browser.mjs`.
These run in an isolated browser with synthetic playback and extension APIs.
Live installed-extension and Discord publication still need verification after
applying the update. No TikTok login is performed; site markup can change.
