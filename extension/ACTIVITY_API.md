# ChudPresence Activity API v1

Activity API V1 is a trusted, first-party runtime for official ChudPresence
Activities. V1 grants broad website-observation capabilities to support rich
service integrations, including DOM access, page-context inspection, and
declared external networking. Install V1 Activities from the official
ChudPresence Activities repository or through Developer mode.

Activities run in an isolated Chromium `USER_SCRIPT` world and use the
restricted `ChudPresence` runtime. The extension owns Discord formatting,
credentials, transport, and publishing. Activities do not receive Discord
OAuth/session credentials, extension storage, or unrestricted `browser.*`
access.

V1 is designed for trusted first-party code. A future public/community API may
use a different trust and permission model; this document does not specify that
model or a V2 contract.

## Package files

Each Activity is a self-contained directory with `metadata.json` and
`activity.js`. Add an optional `icon.png` and set `"icon": "icon.png"` in the
metadata. The icon is stored as a validated PNG when the Activity is installed.
Metadata and report schemas live in `ChudPresence-Activities/schemas/`.

`matches` applies separately to each page frame. Metadata may set
`"frames": "all"` to run the same bundled `activity.js` in every matching
frame; it defaults to `"top"`. Use `ChudPresence.runtime.frame.isTop` and the
current page URL to decide which frame should report. For example, declare both
the service page and embedded player host in `matches` to let a child frame
report playback for the parent service.

Optional discovery metadata includes `category`, searchable `aliases` and
`tags`, `contributors`, `author`, `homepage`, `repository`, `serviceUrl`, and
`defaultMediaKind`. `settingsUi.statusLabels` may rename the popup's
status-display choices. The keys are `app`, `artist`, and `track`; each label
is 1 to 80 characters. Those choices are extension preferences, not Activity
settings, and `ChudPresence.settings` does not return them. Optional
`presence.kind` may be `music`, `video`, `streaming`, or `generic`. This
runtime accepts that field but does not copy it onto the published track.
`excludeMatches` removes matching URLs from the Activity's runtime scope even
when they also match `matches`. Match, exclude, and network patterns are HTTPS
URLs with a host and path: at most 32 unique patterns, each up to 256
characters. The package contract keeps a single bundled `activity.js`;
`frames: "all"` applies that entry to matching frames. Metadata is limited to
64 KB and an optional icon to 256 KB.

Registered scripts run at `document_end`, once the DOM exists. Chromium does
not start a registered user script when a same-document History API navigation
newly matches an Activity. The extension injects enabled Activities on those
tab URL updates, including an update that also reports `status: loading`.
Installing, enabling, reloading, or restoring an Activity also injects it into
already-open matching tabs. Discarded tabs are skipped. Injecting the same
installed package into a document that is already running that package does not
run the script again. Use `navigation.onChange()` for later route changes in
that document. Reload and a new install capability run the script again.

## Runtime and reports

The current V1 runtime exposes `ChudPresence.report()` and
`ChudPresence.clear()`:

```js
ChudPresence.report({
  kind: 'episode',
  media: {
    title: 'Episode title',
    series: 'Series name',
    season: 1,
    episode: 3,
  },
  playback: { state: 'playing', position: 120, duration: 1440 },
  artwork: { large: 'https://cdn.example.com/episode.jpg' },
  buttons: [{ label: 'Watch', url: location.href }],
});
```

Call `ChudPresence.clear()` when the page no longer has a reportable activity.
Reports use the nested `kind`, `media`, `playback`, `display`, `artwork`,
`buttons`, and `visibility` structure in the report schema. `media.title` is
required; other media fields are optional. If `display` is omitted, songs use
title / artist, episodes use series or title / episode title, movies use title,
streams and videos use title / creator or channel, games use the game name or
title / category, and other kinds use title / subtitle. `display.statusDisplay`
defaults to `details` and may be `name`, `details`, or `state`. Playback
defaults to playing at position zero, duration zero, not live, and rate one.
Visibility defaults to `normal`. Supported values are `normal`, `idle`,
`private`, and `ad`; only `normal` reports are published.

Optional `display.detailsUrl` and `display.stateUrl` make the corresponding
presence text clickable. `artwork.largeUrl` makes the large image clickable
when `artwork.large` is present. For a song, use the song URL as `detailsUrl`,
the displayed artist URL as `stateUrl`, and the album URL as `largeUrl`.
These links are independent of the two-button limit and must be HTTPS URLs.

`ChudPresence.runtime` provides the registered `activityId`, package
`activityVersion`, `apiVersion`, `extensionVersion`, a frame descriptor, and
`has(feature)`. `lifecycle` provides an abort signal, cleanup callbacks, and
managed timers. `navigation.current` and `navigation.onChange()` observe SPA
URL changes without replacing History API methods. A change callback receives
`{ oldUrl, newUrl, type }` after the URL settles; rapid changes in one turn are
coalesced. `media.find()`, `media.findAll()`, `media.snapshot()`, and
`media.onChange()` work with ordinary audio and video elements. `find()` prefers
a playing, visible element that has not ended. `snapshot()` returns `playing`,
`paused`, `ended`, `currentTime`, `duration`, `playbackRate`, `volume`, and
`muted`, or `null`. `onChange()` can filter by `element` or event `type`, emit
the current element when `immediate` is true, and stop on `signal`. Runtime
capabilities can be checked with `runtime.has(feature)`.

`lifecycle.onUpgrade(({ fromVersion, toVersion }) => ...)` runs for a pending
Activity version transition. Use it for migrations in this Activity's isolated
storage. A completed transition is persisted; a migration error remains pending
and appears in Developer diagnostics. A normal browser restart does not create
an upgrade transition.

`page.execute(fn, args = [])` runs a self-contained, synchronous function in
the current document's page `MAIN` world and resolves to its JSON-compatible
return value:

```js
const title = await ChudPresence.page.execute(
  (key) => window[key]?.title ?? null,
  ['playerState'],
);
```

The function cannot use Activity-scope closures and must return synchronously.
A returned Promise is rejected. Arguments must be an array;
the function source and serialized arguments are each limited to 16 KB, and a
serialized result is limited to 64 KB. Results cross a JSON serialization
boundary, so functions, cyclic values, `undefined`, and other non-JSON results
are rejected. A thrown exception rejects the call with an `Error` carrying its
`name`, `message`, and `code`. The runtime targets the requesting document by
its browser document ID and reports a stale-document error if navigation
replaces it before execution returns.

The page can see and interfere with code and data passed through `page.execute`.
The bridge is unavailable on Discord pages. It runs in Chromium's `MAIN` world,
which has no WebExtension-only APIs, and does not expose ChudPresence's Discord
credentials or extension storage. `runtime.has('pageExecute')` reports whether
this capability is present.

`net.fetch(url, options)` makes a bounded request from the extension context.
Declare allowed HTTPS URL patterns in metadata:

```json
{
  "network": ["https://api.example.com/v1/*"]
}
```

```js
const response = await ChudPresence.net.fetch(
  'https://api.example.com/v1/search',
  { method: 'POST', json: { query: 'episode' }, responseType: 'json' },
);
console.log(response.status, response.data);
```

Only `GET` and `POST` are supported. Use `body` for text or `json` for a JSON
request body; choose `responseType: 'json'` (the default) or `'text'`. Do not
set both `body` and `json`. GET requests cannot include a body. `timeoutMs`
must be an integer from 100 to 15000 and defaults to 10000. URLs must be HTTPS
without credentials or fragments. Headers are a plain object of at most 32
string values, 8 KB in total, with each value limited to 2048 characters.
Cookie, host, content-length, origin, referer, `sec-*`, and `proxy-*` headers
are rejected. A completed call resolves to `{ status, ok, contentType, data }`.
The Library requests the declared network host permissions during installation,
and each request must match a declared pattern. Requests omit cookies and
referrers, reject redirects, and cannot target Discord domains. Activities do
not receive an extension `Response` object, browser APIs, or Discord OAuth
material. Request bodies are limited to 64 KB, response bodies to 1 MB, and
concurrency is capped at two requests per Activity and four for the extension.
Failures reject with an `Error` carrying `name`, `message`, and `code`; HTTP
error statuses resolve normally with `ok: false`. Developer Mode records each
request with its Activity, frame, sanitized URL path, status, size, and timing.
Query strings are omitted from diagnostics. `runtime.has('netFetch')` reports
this feature.

`storage` provides per-Activity JSON storage:

```js
const choice = await ChudPresence.storage.get('choice');
await ChudPresence.storage.set('choice', { mode: 'compact' });
const removed = await ChudPresence.storage.remove('choice');
const clearedCount = await ChudPresence.storage.clear();
```

Keys are non-empty strings up to 128 characters. A missing key returns `null`;
`set()` resolves to `true`, `remove()` resolves to whether a value existed, and
`clear()` resolves to the number of removed keys. Values must be JSON-compatible
and each Activity has a 64 KB quota. Storage is isolated by the registered
Activity ID, survives package updates, and is deleted when the Activity is
uninstalled. Failures reject with an `Error` carrying `name`, `message`, and
`code`. `runtime.has('storage')` reports this feature.

Activities can declare up to 32 settings in `metadata.json`. Supported types are
`boolean`, `select`, `string`, `number`, and `range`; numeric settings declare
`min` and `max`, with an optional positive `step`. The Library renders the
matching control and saves values with the Activity. Activity code can read
settings and listen for changes:

```js
const displayMode = await ChudPresence.settings.get('displayMode');
const values = await ChudPresence.settings.getAll();
const unsubscribe = ChudPresence.settings.onChange(({ id, value, settings }) => {
  if (id === 'displayMode') updateDisplay(value, settings);
});
```

Change listeners are removed with the Activity lifecycle. Values persist across
updates when the new setting definition still accepts them; changed or removed
values fall back to their new defaults. Invalid setting IDs or values are
rejected. `runtime.has('settings')` reports this feature.

`dom.waitFor(selector, options)` resolves to the first matching element already
present or added later. Selectors are limited to 512 characters. It accepts
`root`, `timeoutMs` (default 10 seconds, maximum 5 minutes; `0` rejects
immediately), and `signal`; timeout and cancellation reject with `TimeoutError`
or `AbortError`. `dom.observe(selector, callback, options)` calls back with each
matching element found immediately or added later. The callback receives the
element and `{ type: 'added' }`. Set `immediate: false` to skip existing
elements, `attributes: true` to observe selector changes caused by attributes,
and an optional `attributeFilter` when attributes are observed. Pass `root` or
`signal` to scope or cancel it. Both helpers use `MutationObserver` and clean up
with the Activity lifecycle. `runtime.has('dom')` reports this feature.

`log.debug()`, `log.info()`, `log.warn()`, and `log.error()` write structured
diagnostic entries for the current Activity. Pass up to eight JSON-compatible
values per call; a log entry is limited to 4 KB. Entries include the Activity
identity, tab, frame, document, and timestamp. Developer Mode keeps a bounded
recent log list and redacts common credential fields, bearer/JWT tokens, and
URL query strings before display. `runtime.has('log')` reports this feature.

URLs must use HTTPS. Text fields are limited to 256 characters, playback values
are bounded, serialized reports are limited to 16 KB, and reports can contain
at most two buttons with 32-character labels. Supported kinds are `video`,
`movie`, `episode`, `song`, `stream`, `game`, and `generic`. Discord's activity
type follows that kind: `song` is listening, `stream` is watching, `game` and
`generic` are playing, and the other kinds are watching. The extension does not
format an Activity report by Activity ID.

Activity identity comes from the registered user-script world, not from report
data. Runtime calls use structured request/response messages internally; the
extension checks the sending world, page URL, report shape, field sizes, and
request rate. Each Activity may send 30 runtime requests per tab in a 10-second
window. Each report remains tied to its tab, frame, document, and sender URL.
Keep sending reports while playback continues: a frame that has not reported
for 90 seconds is dropped and its presence is cleared. If the extension runtime
disconnects, the script reconnects and resubmits its last report.

A same-document History API URL change keeps that document eligible to report,
including queued playback transitions. A tab loading update clears the published
presence but does not retire the document ID, so the next report from the same
document is accepted immediately. A report with a different document ID retires
the previous document. Replacing the top document also retires reports from its
child frames. Discarding or closing a tab retires its documents. The runtime
ignores reports and clears from a retired document. Developer Mode shows frame
state (`active`, `loading`, or `retired`), frame IDs, URLs, and document IDs.
Activities do not receive direct `browser.*` or `chrome.*` API references. Keep
packages under 512 KB.

## Permissions and trust

The extension declares `userScripts` at install time. Chrome 138 or newer also
requires **Allow User Scripts** on the extension details page. The Library asks
for the HTTPS host patterns in the validated catalog entry or local metadata
when an Activity is installed. It downloads and verifies a repository package
after the host permission prompt. An
Activity can read and observe pages on its approved sites. Review its source
before installing it.
Repository hash checks detect mismatched or corrupted downloads; they do not
establish that an Activity is trustworthy.

Catalog format support is independent from runtime support. Activities requiring
an unsupported `apiVersion`, or declaring a newer `minExtensionVersion`, stay
visible in Discover with a compatibility message while compatible packages in
the same catalog remain available. Repository installs pin the catalog and
package files to one immutable Git revision. Installed repository records keep
that revision and their metadata, script, and icon hashes. Updates preserve
settings and per-Activity storage; a failed pre-commit update restores the old
package and its live documents. Repository package-file changes require a
strictly higher semantic version in CI.
