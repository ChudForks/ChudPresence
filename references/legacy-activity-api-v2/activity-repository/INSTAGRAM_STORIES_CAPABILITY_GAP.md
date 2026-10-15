# Instagram video Stories: generic capability gap

Audit date: October 14, 2026. Runtime: Chromium lab 2.3.0. Package: Instagram 1.1.0.

**Migration stopped:** preserving the adapter's video Story eligibility checks
requires another extension capability. The user requested stopping at this
boundary. This audit changes documentation only; the runtime, package JSON,
versions, catalog and existing build artifacts are unchanged. Instagram 1.1.0
continues to support reels only. Photo Stories were not migrated.

## Missing capability

Generic v2 needs a **control evidence predicate for native media**: require one
matching Play/Pause control in the bounded Story panel, require that control to
be visible, and bind it to the creator header sharing the selected video. Reject
panels containing multiple matching controls. This must gate eligibility while
keeping the video's native paused/playing state, position and duration.

The compatibility adapter already implements this boundary. In the Chromium lab's
`extension/core/activity-v2-runtime.js`, its Story branch starts at a visible
`[role="button"] [aria-label="Pause"]` or
`[role="button"] [aria-label="Play"]`, finds a creator header matching the Story
URL, and finds media sharing that header within nine parent steps. It rejects a
panel unless it contains exactly one matching control. Neighbor previews cannot
stand in for the open Story's control/header/media combination.

Reading native video progress is already supported. Constant `Watching Story`
text, creator/page-path matching, static logo and clean Story/profile links are
also representable. The missing part is the control evidence boundary.

## Why the existing declarations do not cover it

- `container.required` checks for matching descendants with `querySelector`.
  It does not assert their visibility or cardinality. `singlePlayer` counts
  player matches, not Play/Pause controls.
- Using a Play/Pause control as `scope` does not select a sibling video. The
  collector queries players inside `scope`; a shared `container` expands the
  metadata root, not the player search root. This misses even the normal saved
  Story layout, where the header and video are siblings.
- Requiring a DOM attribute field for the control can reject a hidden DIV
  control, but cannot reject two controls. It also fails for a visible SVG
  control: generic DOM field extraction does not allow SVG elements. The
  adapter's visibility check accepts that control without reading its text.
- `player.state` is restricted to `dom-media`, whose players are IMG/CANVAS.
  Combining it with `html-media` is rejected with
  `V2 html-media uses only native playback state and timing.` Switching player
  types would lose native video selection and timing.
- Media modes compete independently; they cannot combine a control guard from
  one mode with a native video's playback evidence from another.

No existing rule expresses the required control count or the complete
control/header/video binding. Dropping those checks would weaken the adapter fix.

## Reproduction and observed results

An isolated headless Brave probe ran the current collectors as serialized
functions with network requests blocked. Both candidate generic declarations
passed the existing validator and existed only in memory. Neither was installed
or saved into `activity.json`.

The baseline uses the saved Story fixture shape from the lab's
`scripts/test-v2-browser.mjs`: a creator anchor and control inside a header,
with a ready native video beside the header in the same panel. The synthetic
video is playing at 12 of 60 seconds on
`/stories/example.creator/123456789/`. A reply form remains outside all reads.

The native control-scope candidate uses the Pause control as its scope, with a
nine-step single-player container requiring an anchor and video. The required
control-field candidate instead uses `scope: "video"`, the same bounded shared
panel, a visible text-matched creator path bound to URL segment 1, and:

```json
{
  "fields": {
    "category": {
      "source": "dom.attribute",
      "selectors": [
        "[role=\"button\"] [aria-label=\"Pause\"]",
        "[role=\"button\"] [aria-label=\"Play\"]"
      ],
      "attribute": "aria-label"
    }
  },
  "requiredFields": ["creator", "category"]
}
```

This fragment describes the attempted guard, not a complete installable package.

| Fixture | Compatibility adapter | Native control scope | Required control field |
| --- | --- | --- | --- |
| One visible DIV Pause control and ready video | Reports | Clears | Reports |
| Hide the control's button wrapper | Clears | Clears | Clears |
| Add a visible Play control to the same header | Clears | Clears | **Reports: ambiguous panel accepted** |
| Replace DIV Pause with a visible SVG Pause control | Reports | Clears | **Clears: valid control rejected** |

All four observed outcomes were asserted in the probe. The duplicated-control
case demonstrates the missing cardinality check even when the stronger metadata
field workaround enforces visibility. The SVG case and sibling-video case show
why control evidence cannot be replaced by an ordinary text/attribute field or
control scope.

## Requirements for a future capability

A reusable predicate would need bounded control selectors, literal label
matching, visibility checks that work for SVG controls without reading SVG text,
and an exactly-one match constraint inside the selected shared panel. It must
bind the matching creator header and selected native player without crossing
neighbor panels or reading reply/comment contents. It must preserve native
playback timing rather than replace it with a control-derived clock.

Before migrating video Stories, verify the normal, paused, hidden-control,
missing-control, duplicate-control, SVG-control and neighboring-preview cases;
creator/URL mismatches; loading/ended video; and route cleanup. Check Story links,
the static logo and existing preferences as part of that migration. No new API
shape or runtime implementation is introduced by this document.
