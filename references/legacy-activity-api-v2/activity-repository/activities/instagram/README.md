# Instagram (API V2, schema 2)

Version **1.1.0** supports **reels only** using the reusable generic collector.
Reload Chromium lab **2.3.0** or newer, then reimport `metadata.json`,
`activity.json` and `icon.png` through **Activity Library → Developer** and approve
the extraction review and website access. Reloading alone keeps the installed
package's approved JSON. This package contains no executable code or network access.

| Page | First line | Second line | Progress | Buttons |
| --- | --- | --- | --- | --- |
| Reels feed (`/reels/`) | Caption, or Watching Reel | @username | Native video progress | View Reel when an ID exists, View Profile |
| Individual/card/article reel (`/reel/<id>/`, `/reels/<id>/`) | Caption, or Watching Reel | @username | Native video progress | View Reel, View Profile |

Trailing slashes are optional. Stories are deferred and excluded from this
version's routes and website matches. Existing Instagram 1.0.0 installations
retain the compatibility adapter and video/photo story support until replaced.

The video Story audit found a missing generic capability: a visible, unique
Play/Pause control bound to the selected native video's creator header and panel.
Migration stopped as requested before making another extension change. See the
[capability gap and reproduction results](../../INSTAGRAM_STORIES_CAPABILITY_GAP.md).

All reels use the same static square **Instagram app logo**, never a video
preview or avatar. `icon.png` and presence artwork come from the official
[Instagram Google Play listing](https://play.google.com/store/apps/details?id=com.instagram.android).
Pause, artwork, progress, button and status-field preferences use normal settings.

The package declares native video scopes and nearest single-player containers
within sixteen ancestors. It stops at app/main/body/html roots, hidden or sensitive
ancestors and containers holding another video. The largest visible ready player
wins, including a paused current reel beside smaller autoplaying neighbors.
Missing winning-card metadata clears presence. Current creator anchors and article
headers bind their visible username text to the same-origin public profile path;
comments and unrelated headings cannot supply metadata. Caption selectors use
public role/dir attributes, with a 64-descendant formatting grant and normal
visibility checks on every descendant. Accepted captions are limited to 256
characters; a missing caption uses Watching Reel, while hidden/rejected text clears.

Reel and profile buttons use declared same-origin public paths without queries
or fragments. A detail page's reel ID must match the selected card's public reel
links. Feed cards without a public ID show only View Profile; no ID is invented.
Both singular `/reel/` and plural `/reels/` public URLs are supported.

Selectors, boundaries, fields, presentation and buttons now live in
`activity.json`; supported layout changes need a reviewed package update.
The extension keeps the old adapter for existing approvals. The generic collector
contains no Instagram selector or site branch.

Verification uses unit tests, approved install/restore and document-bound worker
checks, plus the same isolated real-DOM fixtures as the adapter fix: deeply nested
Reels cards, article layouts, adjacent autoplay, creator/caption boundaries, clean
links, pause, absent metadata and route cleanup. The reference DOM was inspected
on October 14, 2026. Live installed-extension and Discord publication still need
verification after applying this update; Instagram can change its markup.
