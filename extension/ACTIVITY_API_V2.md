# Activity API v2

V2 keeps programmable JavaScript and V1-compatible presence reports while removing an
Activity's direct access to the website and the browser. Set `apiVersion: 2` in
`metadata.json` and ship `activity.js` as before. Load the files in the Library's
Developer view. The v1 packages and canonical v1 contract remain supported.

This implementation is independent of the archived declarative V2 under
`references/`. Activities contain JavaScript, including functions, closures,
regular expressions, promises, and custom selection and formatting logic.

## Execution boundary

The trusted extension loads a pinned, locally bundled QuickJS WebAssembly
interpreter inside a dedicated extension worker for each live Activity document.
An offscreen extension document owns those workers; a separate v2 `USER_SCRIPT`
world collects only approved page snapshots. Package JavaScript never enters
the website's execution world. It executes inside the interpreter and has no browser `document`,
`window`, `chrome`, `browser`, `navigator`, cookies, local/session storage,
network APIs, DOM nodes, host functions, module loader, or WebAssembly API.
`Function` and constructor chains create functions inside the guest interpreter.
They cannot recover browser globals.

The only native bridge accepts a bounded JSON string and returns a guest string.
Async service results also cross as JSON. The guest never receives the extension
ownership capability or another Activity's storage namespace. Source travels as
data from the background to its worker, never evaluated by native browser
JavaScript. The page broker's CSP denies native string evaluation, WASM
compilation, and direct network connections. The extension's own policy allows
locally bundled WASM; strict website policies cannot block interpreter startup.
No new extension permissions are added.

Each guest owns a separate WASM instance with a 32 MiB linear-memory ceiling;
QuickJS heap/stack limits are 16 MiB/256 KiB. Each interpreter entry and promise
drain has a 50 ms deadline, at most 256 pending jobs, 16 outstanding requests,
and 30 requests per 10 seconds. Each entry includes its microtasks in the same
budget. Execution and memory failures dispose the VM and clear its presence.
Requests that exceed broker quotas are rejected.
The parent additionally terminates a worker that fails to complete startup in
five seconds or an update/promise resumption in two seconds, including native
engine operations. At most 16 live v2 document sessions run per extension; idle
workers expire after 120 seconds without snapshots. The shared offscreen document
preserves the existing private Discord cleanup lifecycle. Workers never receive
its Discord credentials. These safeguards are not an operating-system process
quota; selector evaluation and aggregate browser memory remain browser-managed.

## Declare page reads

Page access defaults to none. All reads are fixed in package metadata and visible
on the Activity's Library card. Package code cannot introduce new selectors at
runtime. A metadata/source change goes through package installation again.

```json
{
  "id": "example-video-v2",
  "name": "Example Video",
  "description": "Report playback from public player metadata.",
  "version": "1.0.0",
  "apiVersion": 2,
  "matches": ["https://example.com/*"],
  "entry": "activity.js",
  "pageAccess": {
    "url": true,
    "media": true,
    "selectors": {
      "title": { "selector": "main h1", "read": "text" },
      "creators": { "selector": ".player .creator", "read": "text", "all": true },
      "artwork": { "selector": "meta[property='og:image']", "read": "attribute", "attribute": "content" },
      "episode": { "selector": "script[type='application/ld+json']", "read": "json", "path": ["episode"] },
      "shadowTitle": { "selector": "site-player >>> .title", "read": "text" }
    }
  }
}
```

`text` traverses public text, excluding forms, inputs, editables, hidden elements,
scripts, styles, templates, and marked authentication/payment containers.
`attribute` allows only `title`, `alt`, `aria-label`, `href`, `src`, `poster`,
`content`, and `datetime`. URL attributes are HTTPS-only and lose credentials,
query strings, and fragments. `content` is limited to known public social/title
metadata, such as `og:image`; a CSRF meta element cannot provide its content.

`json` reads only typed `application/json` or `application/ld+json` script blocks
and requires an explicit nonempty own-property path. Credential keys and
prototype paths are rejected, nested credential keys are omitted, and output is
bounded. It does not execute script text or read arbitrary page globals.
Recognizable credential strings are redacted from all string reads. This includes
Bearer/JWT/Discord tokens and credential assignments; embedded URL queries and
fragments are removed.

Selectors support combinators, classes, IDs, nested `:is`, `:where`, `:not`,
`:has`, structural/nth pseudos, and `>>>` to traverse open shadow roots. Attribute
predicates use a fixed public allowlist. `value`, `content`, arbitrary `data-*`,
CSS escapes, and stateful pseudos are rejected. These restrictions also prevent
probing a secret value by checking whether an element matches a selector.

Each snapshot allows 32 declarations, 32 matches per declaration (`all: true`),
128 successful element reads, 4,096 characters per string, 64 KiB of captured
values, and 16 media elements. Missing/filtered scalar reads return `null`;
`all` reads return arrays. JSON parsing, traversal depth, scanned candidates, and
text traversal are bounded. Exhausted budgets can omit later values.

Media snapshots expose playback state and geometry, plus a sanitized poster:
`currentTime`, `duration`, `paused`, `ended`, `playbackRate`, `muted`, `visible`,
and `rect`. They omit signed playback sources. When `url` is declared,
`page.info()` exposes `origin`, `pathname`, and the document's `visibilityState`
(`visible`, `hidden`, or `prerender`). Visibility changes trigger an immediate
snapshot, including when an earlier update is still in flight.

For search/video routes, explicitly declare `queryParameters: ["q", "v"]` in
`pageAccess` and read `page.info().query.q` or `.v`. Only the first value for each
declared key is exposed (missing keys are `null`), with credential-pattern
filtering. `page.info().queryDuplicates`, when present, lists only declared key
names that occur more than once; additional values are never exposed. This works
independently of `url: true`. Up to 16 unique public
parameter names are allowed; credential/OAuth names such as `token`, `code`,
`state`, `key`, and `SAMLResponse` are rejected. Undeclared query values and the
URL fragment stay inaccessible.

## Bind metadata to a native player (extension 2.0.2)

Declare `media: true` and up to four `mediaScopes` to read public text or
attributes from the nearest matching ancestor of each video/audio element:

```json
{
  "media": true,
  "mediaScopes": {
    "card": {
      "container": ".reel-card",
      "ancestors": 16,
      "exclude": ".application-root",
      "selectors": {
        "caption": { "selector": ".caption", "read": "text" },
        "creator": { "selector": "header a", "read": "attribute", "attribute": "href" }
      }
    }
  }
}
```

`media.getAll()` retains its existing DOM order and adds `readyState`,
`visibleArea` (pixels clipped to the viewport), and `scopes` only when scopes
are declared. For example, `player.scopes.card` is either `null`, or
`{ reads: { caption: "Example", creator: "https://example.com/creator/" }, rejected: [] }`.
Playback and scoped reads belong to the same native element; no DOM identity,
node, persistent handle, page globals or execution capability crosses the sandbox.

The broker walks at most 16 ancestors and stops before HTML, BODY, MAIN,
`role="main"`, an excluded boundary or a hidden/sensitive container. The nearest
matching container must contain exactly one native player, counting hidden
players and players inside open shadow roots. Ambiguity fails closed. Reads
are limited to that container's descendants, including explicitly declared open
shadow traversal. Scoped JSON reads are not supported. `dir` joins the public
selector-attribute allowlist for caption layouts; it is not a new readable attribute.

Missing captures return `null` (or `[]` with `all`). Hidden, sensitive, oversized,
out-of-boundary or budget-limited captures additionally list their name in
`rejected`. A scalar uses its first matching element and does not skip an invalid
first candidate. Scoped text rejects hidden/sensitive descendants rather than
silently dropping them. Packages can therefore distinguish an absent caption
from an invalid caption and clear when winning-card metadata is rejected.
The ordinary public-string and URL sanitizers apply to every value.

All page and scoped declarations share the existing **32 captures, 128 reads
and 64 KiB captured-value budget** per snapshot. Scoped work additionally shares
512 selected candidates, 256 ancestor steps and 2048 inspected card descendants;
these limits do not multiply per player. Native discovery retains the existing
16-player cap. Scope budgets are spent on the largest visible players first;
output media order stays unchanged. Packages should select their player before
validating its metadata and clear on an invalid winner. They must not select a
smaller player merely because its metadata is complete.

Scopes are fixed metadata, displayed in the Library's declared-page-access
review, and supplied through normal package installation. Adding them requires
reimporting the updated package. Existing packages gain no scoped reads.

## Write an Activity

The host updates the snapshot approximately every two seconds, including SPA
route changes. Chromium can throttle background timers. Keep callbacks short;
select and format data with ordinary JavaScript. For example:

```js
ChudPresence.onUpdate(async () => {
  const title = ChudPresence.page.read('title') || ChudPresence.page.read('shadowTitle');
  const player = ChudPresence.media.getAll().find(media => media.visible && !media.ended);
  if (!title || !player) { await ChudPresence.clear(); return; }
  const artwork = ChudPresence.page.read('artwork');
  await ChudPresence.report({
    kind: 'video',
    media: { title },
    playback: {
      state: player.paused ? 'paused' : 'playing',
      position: player.currentTime,
      duration: player.duration,
      rate: player.playbackRate
    },
    ...(artwork ? { artwork: { large: artwork } } : {})
  });
});
```

`onUpdate(callback)` also passes the current deeply frozen JSON snapshot to the
callback and returns an unsubscribe function. Snapshot reads are synchronous.
Settings, storage, reports, clearing, logging, and network services are async:

| API | Result |
| --- | --- |
| `ChudPresence.apiVersion` | `2` |
| `page.read(name)` / `page.info()` / `media.getAll()` | Current snapshot data |
| `report(report)` / `clear()` | Validated V1-compatible reports and V2 presentation options / clear |
| `settings.get(id)` / `settings.getAll()` | Activity-defined settings |
| `storage.get(key)` / `set(key, value)` / `remove(key)` / `clear()` | Activity-scoped JSON storage, 64 KiB total |
| `net.fetch(url, options)` | `{ status, ok, contentType, data }` |
| `log.debug/info/warn/error(...args)` | Redacted local diagnostics, up to eight values and 4 KiB |

V2 reports additionally accept `display.name` (a nonempty name up to 256
characters) to label modes of one Activity. `kind: 'generic'` page activities can
set `playback.elapsed: true` with `position` in seconds to show an elapsed timer
without a Live label. They must omit duration (or use zero) and cannot set
`live: true`. Their empty `display.state` stays omitted in Discord. For example:

```js
await ChudPresence.report({
  kind: 'generic', media: { title: 'Submitted query' },
  display: { name: 'Search Images', details: 'Searching for : Submitted query', state: '', statusDisplay: 'name' },
  playback: { state: 'playing', elapsed: true, position: 12 }
});
```

Use guest `Date.now()` and a closure to measure the current page session, resetting
it when query, mode, readiness or visibility changes. These fields add no page or
browser authority. V1 retains its original report contract.

### Presence during navigation

Starting in extension 2.0.1, a V2 package may declare
`"presence": { "kind": "generic", "navigationGraceMs": 4000 }` in metadata.
The optional grace is an integer from **0 to 5000 ms**, defaulting to zero.
The extension retains the outgoing presence for at most that duration when a
top-level link, form submission or other Navigation API event identifies a new
document within the package's declared matches (and outside its exclusions).
A replacement report cancels the deadline and updates the presence directly.
Repeated unload signals do not extend it. Without a valid navigation hint, the
existing immediate document-exit cleanup remains in force.

The outgoing guest is stopped immediately; this option delays only its presence
removal. Tab removal overrides the grace immediately, including if the outgoing
document has already been retired. Activity teardown, disabling sharing, and a
closing/failure clear also bypass the pending navigation deadline. Late old
documents and canceled deadlines cannot erase replacement reports. The browser
close backup retains its existing immediate cleanup behavior.

This is an extension-enforced metadata preference, not a guest timer or an
arbitrary delay argument to `clear()`. In-page DOM loading gaps can be handled
inside the Activity using short, bounded retention across `onUpdate` snapshots.
An unsupported route or hidden page should still clear rather than retaining
stale content indefinitely.

The network broker retains v1's declared HTTPS path/origin permissions, user host
permission checks, GET/POST support, limited headers/body/response sizes,
concurrency bounds, and timeouts. Browser credentials are omitted, redirects
are rejected, and no referrer is sent. Discord endpoints remain reserved for
extension core. Activities supply their own request data; user/extension login
credentials are never supplied by the broker. Anonymous network results are
still untrusted external data. Prefer declaring narrow network paths.

No guest timers are installed; updates are host-controlled. Save long-lived
state in scoped storage. Disabling, removing, reloading, leaving the matched
route, destroying the document, or exhausting execution limits tears down the
guest. A failed guest stays stopped until an explicit reload or a new document;
polling does not retry failing source. Storage survives updates. V1-specific `page.execute`, direct DOM access,
and native lifecycle/navigation helpers require migration to snapshots and
`onUpdate`. There is no opt-in switch to re-enable native page execution in v2.

For custom players, select public DOM/JSON metadata, open shadow roots, native
media state, and anonymous API data, then combine them in JavaScript. If a site
requires a new protected capability, extend the trusted broker with a narrow,
reviewed data operation rather than adding an arbitrary-code bridge. This keeps
package logic flexible without granting access to the site's credential stores.

## Security limits and validation

This separates code execution from page authority; it cannot classify every
piece of page data. A website can display a credential as ordinary public text,
use an unrecognized field name, or put secrets in URL paths. An Activity can
publish or transmit data it is allowed to read, including private visible text.
Filtering is defense in depth, not proof that arbitrary selected data is public.
Review declarations and install packages you trust with those selected fields.
V1 retains its broader trusted-code model, so installing V1 alongside V2 does
not sandbox the V1 Activity. Browser/WASM/QuickJS vulnerabilities remain part of
the trusted computing base; keep pinned dependencies reviewed and updated.

The JSON contracts are in `schemas/activity-api-v2.json` and
`schemas/activity-v2.schema.json`; the V2 report schema is
`schemas/activity-v2-report.schema.json`. TypeScript declarations are in
`schemas/activity-api-v2.d.ts`. The runtime additionally validates selector
grammar, key safety, byte budgets, and DOM context; schema validation alone is
insufficient. Generate contracts with `node scripts/generate-v2-contract.mjs` and
the locally embedded VM with `npm run build:v2-engine`.

Run `npm ci`, `npm run check`, `npm test`, and `npm run build`. The optional
`node scripts/test-v2-browser.mjs` checks the actual unpacked extension, real
userScripts/WASM execution, private-data exclusions, guest escapes, storage,
presence, and interruption using an isolated browser profile and synthetic
HTTPS fixtures. It needs Playwright; see its environment overrides in the script.
