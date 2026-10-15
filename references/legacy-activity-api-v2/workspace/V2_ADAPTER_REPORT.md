# Activity API V2 reusable capabilities

Date: October 14, 2026. Implementation: Chromium lab 2.3.0.

V2 originally needed bundled Prime Video, TikTok and Instagram adapters because
its public JSON rules could select only one container, read a few text fields
and sample a native player. Card ranking, retention, custom playback evidence,
parsing and presentation were hardcoded for those sites.

New packages use `schemaVersion: 2` with reusable rules implemented in
`extension/core/activity-v2-generic.js`. Package-only updates can now change:

- Public tag/class/ID/data/role/label selectors inside an approved container.
- First-player or largest-visible-player selection with metadata from the same card.
- Literal values, absent-only fallbacks, prefix/suffix removal and bounded splitting.
- Integer season/episode fields and numeric or clock playback text.
- Native media, visible canvas/photo evidence and explicit playback-control labels.
- Same-player metadata retention and elapsed/live sessions.
- Literal presentation templates, static artwork and static buttons.
- Explicit media/layout modes, supported paths and required metadata.
- Bounded shared player/metadata containers and page/player identity bindings.
- Same-origin public path fields and buttons, without queries or fragments.
- Explicit public fade-ancestor and childless BR formatting grants.

Package configuration is data. It cannot access page objects, evaluate JavaScript,
call arbitrary methods, read form values or send raw network requests. Sensitive
ancestors and hidden fields/descendants remain excluded. Native accessibility and
canvas-renderer declarations exempt only the rendered source player's own marker;
they do not authorize hidden metadata reads. Every changed package requires a
higher version and review of its exact bytes.

Metadata lookup uses `lookup.service` plus a map from explicit parameters to
declared media fields. Service policies are reviewed independently through the
Library's **Trusted lookup services** control. The worker reconstructs the exact
GET endpoint, enforces typed inputs, omits cookies/referrers, rejects redirects,
limits responses and projects only approved public media/artwork fields. Policies
and private service tokens can change independently of extension releases.
An Activity cannot create its own destination approval. A supplied malicious
endpoint, unknown service, response URL or credential override cannot escape
that boundary. The [TMDB policy](examples/v2/services/README.md) demonstrates it.

Lookup results are checked against the exact sending document's current collector
snapshot and the Activity/service grants. Changing media, ending playback,
clearing presence, updating/disabling an Activity, navigating or revoking a
service invalidates pending results. Policy/host revocation removes already
published service output. Base playback survives an unavailable lookup.

TikTok 1.1.1 is now migrated to these reusable schema 2 capabilities. Its
package JSON declares feed/detail/overlay/LIVE selection, canvas rendering,
metadata and creator boundaries, real public media/profile buttons, timers and
presentation. The generic collector contains no TikTok selector or service
branch. The same inspected DOM fixtures exercise both the original adapter fix
and the migrated package. Import 1.1.1 after reloading lab 2.2.1; a runtime reload
alone does not replace an installed package's approved JSON.

Instagram 1.1.0 migrates **reels only** to schema 2 on lab 2.3.0. Its JSON
declares native video scopes, a bounded nearest single-player container, caption
selectors, a visible creator text/path match, reel/page link identity, static
artwork and presentation. The same deeply nested and article DOM fixtures run
against the old adapter and new package. Missing winning-card metadata clears;
it cannot borrow a smaller autoplaying neighbor. Stories are deferred and are
excluded from the new package's matches and supported paths.

The subsequent video Story audit stopped at a missing generic capability,
as requested: native media cannot require a unique visible Play/Pause control
bound to its creator header and shared panel. A required metadata field can
check a DIV control's visibility but still accepts multiple controls and rejects
valid SVG controls; using the control as scope cannot find a sibling video.
See the [capability gap and real-DOM probe results](ChudPresence-Activities-V2/INSTAGRAM_STORIES_CAPABILITY_GAP.md).
This audit makes documentation changes only; runtime 2.3.0 and the reels-only
Instagram 1.1.0 declaration remain unchanged.

Existing schema 1 packages and their exact approvals remain supported, including
older TikTok and Instagram versions. Prime Video and Instagram 1.0.0 still use
compatibility adapters; old Instagram story behavior remains available there. Cross-frame inspection, arbitrary site JavaScript, external extracted
button destinations, media-derived artwork and private/hidden text remain
unavailable, apart from explicitly reviewed, narrowly bounded public fade-layer
grants. A new permitted primitive can still require a runtime release; supported
site selectors and presentation now change in the package.

See the [developer guide](extension/ACTIVITY_API_V2.md),
[generic feed package](examples/v2/generic-feed/activity.json), and
[verification record](TESTING.md). V1's API, contract and packages are unchanged.
