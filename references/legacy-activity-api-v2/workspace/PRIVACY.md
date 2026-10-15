# Privacy — Chromium Activity Lab

Schema 2 V2 packages also declare reusable media-card selection, visible custom
player controls, literal/numeric field transforms and static presentation.
Network lookup policies are approved separately in the Library. Policies name
an exact public HTTPS endpoint, typed media inputs and bounded response fields.
An Activity can use an approved policy but cannot authorize a destination itself.
Requests omit cookies and referrers and reject redirects. Unapproved services,
private hosts and malformed responses are blocked; rejected lookups preserve
local playback. Approved service inputs leave the device even when Discord
sharing is off. The review shows which media fields go to which destination.

Policies and service tokens are stored locally in the extension. Tokens and raw
API responses never reach Activity code or public diagnostics. Lookup caches
are bounded, temporary and isolated by Activity, service policy and input.
Revoking a policy or its host permission removes its derived presence output
and cancels pending requests. V1 remains unchanged.

Public API V2 packages contain JSON configuration. Bundled ChudPresence code
reads only the approved container's declared text/attributes and an HTML media
snapshot, or explicitly declared page query parameters. Page packages can
declare static public HTTPS artwork and bounded literal text templates; extracted
values cannot alter artwork URLs. V2 cannot supply executable JavaScript, call
network/page/storage bridges, or choose arbitrary runtime artwork, buttons or
other presence URLs. Fixed
bundled adapters have constrained outputs: Prime Video details may publish
matching Amazon title artwork; TikTok may publish only the reported creator's
public video/LIVE/profile buttons. TikTok reads fixed public creator, handle,
description/title and link/player-ID fields from the selected visible player
card or open video overlay. Overlay inspection requires a matching public video
ID and a common metadata container within five ancestor steps; comments are not
read. Its artwork is a static square app icon from Google's image CDN, never a
video preview or avatar; page values cannot alter that URL. Messages, settings,
uploads and other unrelated TikTok routes produce no reports. Current LIVE reads
are fixed to the room's own header/profile or its active featured card; chat and
recommended-stream metadata are excluded. Only the known public featured-card
metadata fade layer may have zero opacity; sensitive elements, hidden fields,
other CSS hiding, players and other ancestors remain excluded. Each installation
and update requires review of these reads and exact-byte approval. Selected text
may still be sensitive; review that selectors identify media information before
sharing it with Discord. Field reads are skipped when the selected element or any
descendant fails visibility checks, including CSS hiding, zero opacity, and
`content-visibility: hidden`. Rejected Prime Video titles clear cached metadata;
rejected episode text is omitted from reports and cached metadata. V1 retains
its trusted executable development model.

Google's page activity reads the submitted `q` parameter and visible result-count
text, with the exact Search/Images/AI routes described in installation review.
The query can be published to Discord when sharing is enabled. Search inputs,
unsubmitted drafts, AI conversation content, account text, full URLs and tracking
values are not reported. Hidden tabs clear page activity. Page artwork is a
static official Google G image; elapsed time describes the visible search session.

This local development extension reads playback metadata on sites with installed Activities. It includes a YouTube Activity by default and declares YouTube host access in the manifest; you can disable or remove that Activity in the Library. A report can include the media title, creator or artist, playback state and position, artwork URL, and page, song, artist, or album links. Installed Activity code, icons, preferences, settings, and per-Activity storage are kept in local extension storage. Recent Activity reports, logs, and network diagnostics are held in the running worker and shown locally. Activity code runs in a Chromium user script world and does not receive Discord credentials or unrestricted extension APIs. V1 is intended for trusted first-party code with DOM and page-context access.

The Activity Library downloads and caches the public catalog and package files from the `ChudForks/ChudPresence-Activities` (V1) and `ChudForks/ChudPresence-Activities-V2` GitHub repositories when you refresh or install through Discover or Updates. It resolves a commit revision and verifies package hashes. Local file loading reads files you select; the nested Activities checkout is not uploaded by the lab. Requests through `ChudPresence.net.fetch()` are bounded HTTPS requests limited to declared network patterns; they omit cookies, reject redirects, and cannot target Discord endpoints. The 67Movies Activity uses this bridge to request title and artwork metadata from The Movie Database using the current page's movie or TV identifier. Hulu first fetches same-origin series and movie detail pages directly with cookies omitted and redirects allowed, then uses the restricted bridge if that request fails or lacks the needed metadata. Activity artwork can reference external HTTPS URLs, including shared images in the Activities repository; the popup and Discord may fetch those images.

The popup's local presence intent is computed inside the extension. No playback presence is sent to Discord until you explicitly connect it while sharing is enabled; the global sharing switch is on by default. Once connected, the extension sends the selected media details and links needed for the presence and stores OAuth credentials and the headless session token in local extension storage. The last presence intent is kept in session storage. Browser-close backup credentials are passed only to the extension's private offscreen document, which can issue a deferred or keepalive deletion request. Disconnect deletes the active session, attempts token revocation, and clears local authorization. If deletion fails, it retains the credentials and session token for retry and reports the failure. The Discord transport uses an undocumented Headless Sessions API and is experimental.

Browser-close diagnostics keep the last presence-deletion attempt locally: its time, whether it came from the worker or document-exit fallback, its outcome, and an HTTP status when available. This diagnostic record contains no credentials, playback details, or response bodies and is not uploaded. A document-exit diagnostic may not reach the worker before shutdown, so the displayed record is a best-effort observation.

This lab does not include analytics, advertising, or a remote telemetry service. Remove an Activity to unregister its script and delete its stored source. Uninstall the lab extension to delete its local storage. No release or publication is part of this repository's local porting workflow.
