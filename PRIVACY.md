# Privacy — ChudPresence

Activity API v2 runs package JavaScript inside an embedded QuickJS/WASM
interpreter. Packages receive only their declared, filtered page snapshots and
their scoped settings, storage, and service results. Browser/extension globals,
cookies, local/session storage, input values, raw DOM, and arbitrary page-code
execution are unavailable. Public text/attribute/JSON declarations are shown
in the Library. URL queries/fragments and recognizable credentials are filtered;
anonymous network calls omit browser credentials and reject redirects.

Version 2.0.2 adds optional, declared media scopes: sanitized public fields from
a bounded single-player card are returned alongside that player's playback.
This exposes their relationship as well as the values. Scopes appear in the
Library's access review, use the same sensitive-content filters and shared read
limits, and provide no DOM handles or additional browser permissions. Existing
packages receive no scoped fields unless updated and reimported.

Selected visible text can still be private, and unknown or disguised secrets
cannot always be recognized. Packages can transmit data they are allowed to
read using declared network endpoints or presence reports. Review those
declarations. The following existing v1 behavior remains available for trusted
packages and retains broader page access. See the
[v2 guide](extension/ACTIVITY_API_V2.md) for the complete security boundary.

ChudPresence reads playback metadata on sites with installed Activities. It includes a YouTube Activity by default and declares YouTube host access in the manifest; you can disable or remove that Activity in the Library. A report can include the media title, creator or artist, playback state and position, artwork URL, and page, song, artist, or album links. Installed Activity code, icons, preferences, settings, and per-Activity storage are kept in local extension storage. Recent Activity reports, logs, and network diagnostics are held in the running worker and shown locally. Activity code runs in a Chromium user script world and does not receive Discord credentials or unrestricted extension APIs. V1 is intended for trusted first-party code with DOM and page-context access.

The Activity Library downloads and caches the public catalog and package files from the `ChudForks/ChudPresence-Activities` GitHub repository when you refresh or install through Discover or Updates. It resolves a commit revision and verifies package hashes. Local file loading reads files you select; the nested Activities checkout is not uploaded by ChudPresence. Requests through `ChudPresence.net.fetch()` are bounded HTTPS requests limited to declared network patterns; they omit cookies, reject redirects, and cannot target Discord endpoints. The 67Movies Activity uses this bridge to request title and artwork metadata from The Movie Database using the current page's movie or TV identifier. Hulu first fetches same-origin series and movie detail pages directly with cookies omitted and redirects allowed, then uses the restricted bridge if that request fails or lacks the needed metadata. Activity artwork can reference external HTTPS URLs, including shared images in the Activities repository; the popup and Discord may fetch those images.

The popup's local presence intent is computed inside the extension. No playback presence is sent to Discord until you explicitly connect it while sharing is enabled; the global sharing switch is on by default. Once connected, the extension sends the selected media details and links needed for the presence and stores OAuth credentials and the headless session token in local extension storage. The last presence intent is kept in session storage. Browser-close backup credentials are passed only to the extension's private offscreen document, which can issue a deferred or keepalive deletion request. Disconnect deletes the active session, attempts token revocation, and clears local authorization. If deletion fails, it retains the credentials and session token for retry and reports the failure. The Discord transport uses an undocumented Headless Sessions API and is experimental.

Browser-close diagnostics keep the last presence-deletion attempt locally: its time, whether it came from the worker or document-exit fallback, its outcome, and an HTTP status when available. This diagnostic record contains no credentials, playback details, or response bodies and is not uploaded. A document-exit diagnostic may not reach the worker before shutdown, so the displayed record is a best-effort observation.

ChudPresence does not include analytics, advertising, or a remote telemetry service. Remove an Activity to unregister its script and delete its stored source. Uninstall ChudPresence to delete its local storage. No release or publication is part of this repository's local build workflow.
