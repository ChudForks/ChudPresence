# Prime Video (Activity API v2)

Version 1.1.0 reports the series, episode name, season/episode numbers, matching
preview artwork, play/pause state and progress. It supports `primevideo.com` and
Amazon US `/gp/video/` pages in the top frame, using the modern overlay player.
The title and episode selectors were inspected on Amazon's live player on
October 13, 2026. Other regional Amazon stores and legacy players are not included.

Version 1.1.1 adds the official Prime Video service icon for the Activity Library
and popup, following the other service packages' use of official artwork.
`icon.png` is the 152×152 Apple touch icon linked from
[Prime Video](https://www.primevideo.com/), downloaded from
`https://m.media-amazon.com/images/G/01/digital/video/DVUI/favicons/apple-touch-icon-152x152.png`.

Load `metadata.json`, `activity.json`, and `icon.png` together in **Activity Library →
Developer → Load local Activity**, review the extraction summary and approve
installation. Reload the updated Chromium lab extension first: this package
requires its bundled `prime-video` adapter. Local catalog changes appear in
Discover after the V2 activities repository is published and its catalog refreshed.

The adapter reads `.atvwebplayersdk-title-text` and
`.atvwebplayersdk-episode-info` inside `.dv-player-fullscreen`, alongside that
container's rendered video. It accepts the video's own `aria-hidden` accessibility
marker; hidden containers and private text remain excluded. Prime removes its
controls while playing, so the adapter retains previously visible metadata for
the same player, media source, duration and route. Until the title has been
sampled with controls visible, there is no presence; show the player controls if
the Activity is installed during playback. End/load/empty events, replacement
players, changed sources/routes and player close invalidate retained metadata.

The shared collector also rejects a text field when it contains a hidden
descendant, including CSS-hidden or transparent text. Rejected titles clear the
retained presence, and rejected episode text is omitted from reports and cached
metadata. Visible nested title formatting remains supported.

The explicit `player.metadata: "prime-video-details"` option enables bundled
episode parsing and public detail-page artwork inspection. For example,
`S1 E1 The Heart of The Cards` becomes series `Yu-Gi-Oh!`, episode name
`The Heart of The Cards`, season 1 and episode 1. Presence shows the clean
episode name first and the series second. Season/episode numbers remain in
the media metadata and artwork hover text, outside the title line.

Artwork comes from a matching public title under `#main`. An episode thumbnail
requires the series heading, episode heading and play-link season/episode label
to match the player. Matching show artwork is the fallback when the episode card
is unavailable. Hidden images and arbitrary URLs are rejected; only Amazon
title-image CDN paths are published. This package makes no network requests and
contains no custom JavaScript. Links and advertisement detection remain unavailable.

Reload the updated extension and reimport both JSON files plus `icon.png` to approve the 1.1.1
update. The older configuration retains its original reads until updated.

Validate and build from the `ChudPresence-Activities-V2` checkout:

```sh
node tools/chudpresence.mjs activity validate prime-video
node tools/chudpresence.mjs activity test prime-video
node tools/chudpresence.mjs activity build prime-video
```

Runtime behavior tests are in the Chromium lab's `test/prime-video-v2.test.js`;
`scripts/test-v2-browser.mjs` also exercises the observed structure in a real
Chromium DOM. These are fixture tests, not end-to-end Discord publication checks.
