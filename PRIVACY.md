# Privacy — ChudPresence

_Last updated: October 15, 2026. This notice describes ChudPresence extension 2.0.4 and the current first-party Activity packages. Activity packages update separately from the extension, so review their current source and access declarations before installing or updating them._

## In brief

ChudPresence reads activity from supported webpages on your device. It does not have a ChudPresence account, project-operated backend, analytics service, advertising code, or crash-reporting endpoint. The extension does not send a copy of your browser history, Activity reports, Discord credentials, selected local files, or diagnostics to me, the project maintainer, or to a server I operate. When a feature needs a network request, the extension connects directly to the named provider below; it does not relay that request through a ChudPresence server.

There is one provider-side caveat: the 67Movies Activity makes requests to TMDB with a shared project API key and the current movie or TV identifier. TMDB receives that information and can associate requests with the key. TMDB controls its own request records and any usage information available to the key owner. The extension sends no copy to me, but I cannot promise what TMDB may show the key owner in its own tools.

If you choose to send information in a GitHub issue, discussion, message, or copied diagnostic log, that is a separate disclosure you make to that service and potentially to the project maintainer. Do not share logs or screenshots containing information you want to keep private.

## What Activities can read

An Activity runs only on its declared website matches, after you grant the requested site permissions. ChudPresence includes a YouTube Activity by default; other Activities are installed separately. Disabling an Activity stops it from reading its supported pages.

Activity API V1 is trusted code for first-party Activities. V1 packages can inspect the page DOM, and V1's `page.execute()` can run code in the webpage's main context. That code can access page-script-visible data and initiate requests using the webpage's own capabilities; those requests are not constrained by ChudPresence's network broker. V1 is not a sandbox for public or community-authored code. The [V1 repository](https://github.com/ChudForks/ChudPresence-Activities) is published for review and transparency.

Activity API V2 runs package JavaScript in an isolated sandbox. A V2 package can receive only its declared page fields, approved media snapshots, selected URL components, scoped settings and storage, and the results of its declared network requests. It does not receive browser cookies, raw DOM objects, browser APIs, or Discord credentials. Its access declarations are shown for review in the Activity Library. Filtering removes many credential-like values, but it cannot identify every private or disguised value. Visible text can still be sensitive.

For example, the current V2 Google package can report the search term in the `q` URL parameter. The Instagram package can report a profile name or a selected Reel caption and creator. These values remain on your device unless the Activity reports them to Discord or sends them to a declared network endpoint. The [V2 repository](https://github.com/ChudForks/ChudPresence-Activities-V2) is separate from V1, and both repositories are listed in Discover; packages installed from either repository or from local files should be reviewed like any other code.

Selecting local Activity files stores their package source in your browser profile; ChudPresence does not upload the selected files by itself. The Activity code you load still has the access described above and could send data according to that code.

## Where information goes

| Recipient | Information and purpose |
| --- | --- |
| **Your browser profile** | ChudPresence stores installed Activity source, metadata and icons; preferences and scoped Activity storage; the cached V1 and V2 catalogs; Discord OAuth credentials and the Discord session token. These use Chromium `storage.local` on this device. Pending sign-in data and the latest presence intent use temporary `storage.session`. The extension does not use Chrome Sync storage or add its own encryption layer for saved credentials. |
| **Discord** | Only after you connect Discord does ChudPresence send OAuth requests and, while sharing is enabled, the current presence. OAuth requests go directly to `discord.com` and request `openid` and `sdk.social_layer_presence`; Discord returns an authorization code, tokens, and user information (Discord user ID and username) to the extension. Presence requests go to `discord.com/api/v10/users/@me/headless-sessions`; cleanup goes to its `/delete` endpoint. A report may include the Activity name/type, media or page title, artist/creator/profile name, state, playback position and timestamps, artwork URL, button labels, and links supplied by the Activity. Discord may display that information according to your Discord settings. The global sharing switch is on by default, but you must connect Discord before presence is sent. The transport uses Discord's undocumented, experimental Headless Sessions endpoints. |
| **GitHub** | When you open or refresh Discover or check for Activity updates, the extension may request the V1 and V2 catalog revisions from `api.github.com/repos/ChudForks/ChudPresence-Activities/commits/main` and `api.github.com/repos/ChudForks/ChudPresence-Activities-V2/commits/main`, then download catalog, metadata, code, and icons from the corresponding repositories on `raw.githubusercontent.com`. These requests do not include a GitHub account token or your Activity reports. GitHub receives ordinary request metadata such as your IP address, requested file, and request time. |
| **The Movie Database (TMDB)** | The official 67Movies V1 Activity sends GET requests to `api.themoviedb.org/3/` for the current movie or TV identifier, with a shared application API key and `language=en-US`, to retrieve title and artwork metadata. It does not use your TMDB account or send a TMDB login credential. TMDB receives the requested identifier, the API key, and ordinary network request metadata. |
| **Hulu** | The official Hulu V1 Activity can request a Hulu series or movie details page, such as `/series/<id>` or `/movie/<id>`, to read public title/artwork metadata. The request omits browser cookies. Its direct same-site request can follow redirects; the fallback Activity network request omits credentials and referrer and rejects redirects. Hulu receives the request and ordinary network metadata. |
| **Other Activity endpoints and image hosts** | Through ChudPresence's network broker, an Activity may request only HTTPS endpoints declared in its metadata and granted by you. The broker supports GET and POST, omits browser credentials and referrer, rejects redirects, and blocks Discord endpoints. The current official V1 packages declare TMDB and Hulu as described above; the current packages in the V2 repository declare no network endpoints. An Activity may also provide an external artwork URL: the popup may load it for its preview, and Discord may request it to display the presence. The image host then receives those requests. |

Activity-initiated requests to TMDB, Hulu, or another declared endpoint can happen while the matching Activity is enabled, even if you have not connected Discord or have turned global sharing off. Turning off global sharing prevents new presence from being published to Discord; it does not stop an enabled Activity from reading its page or making its own requests. Disable or remove the Activity to stop its page access and Activity-initiated requests.

The websites you visit also receive your normal browser requests. Reading a page does not by itself send its contents back to that website. A locally loaded or modified V1 Activity can use webpage capabilities to send data to destinations chosen by its code, so inspect and trust that code before loading it. Its behavior may differ from the built-in packages described here.

## Local diagnostics and controls

Recent Activity reports, Activity logs, and network-request diagnostics are kept in extension-worker memory and shown locally in Activity Library → Developer. They may contain media titles, page paths, Activity output, request hosts/paths, status codes, and timing. Diagnostic URLs omit query strings, and common credential patterns are redacted, but this filtering is not a guarantee that every private value is removed. Use **Clear all history** to clear the visible diagnostic history. Copying logs is a manual action; ChudPresence does not upload them. A separate local cleanup record stores only the last Discord presence-deletion attempt's time, source, result, and HTTP status when available.

The global sharing switch and per-Activity preferences control what gets reported to Discord. Paused playback is allowed by default, and artwork, timestamps, and Activity-provided buttons are on by default; you can change these settings. Turn off global sharing to stop new Discord presence updates. Disable or remove an Activity to stop it from reading matching pages and making Activity-initiated requests. Select **Disconnect** to delete the active Discord presence session and attempt to revoke authorization. If Discord cannot confirm session deletion, ChudPresence retains the token locally so it can retry and reports the failure; it does not silently claim the remote session was removed. Disconnect before uninstalling if possible. Uninstalling removes ChudPresence's extension-managed data from the browser, but cannot erase information already received or retained by Discord, GitHub, TMDB, Hulu, or another provider.

Removing an Activity unregisters its script and clears its installed source, settings, and scoped storage. You can review the extension's [Discord authorization and presence code](extension/discord/) and [Activity API V2 security guide](extension/ACTIVITY_API_V2.md) in this repository.

## Third-party privacy policies

ChudPresence does not control the providers' collection, security, or retention practices. Review their notices for details about information they receive directly:

- [Discord Privacy Policy](https://discord.com/privacy)
- [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
- [TMDB Privacy Policy](https://www.themoviedb.org/privacy-policy) and [TMDB API authentication](https://developer.themoviedb.org/docs/authentication-application)
- [Hulu / Disney Privacy Policy](https://www.hulu.com/privacy)
