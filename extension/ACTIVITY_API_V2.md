# Activity API v2

V2 keeps programmable JavaScript and V1's presence reports while removing an
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
and `rect`. They omit signed playback sources. `page.info()` exposes only
`origin` and `pathname` when `url` is declared.

For search/video routes, explicitly declare `queryParameters: ["q", "v"]` in
`pageAccess` and read `page.info().query.q` or `.v`. Only the first value for each
declared key is exposed (missing keys are `null`), with credential-pattern
filtering. This works independently of `url: true`. Up to 16 unique public
parameter names are allowed; credential/OAuth names such as `token`, `code`,
`state`, `key`, and `SAMLResponse` are rejected. Undeclared query values and the
URL fragment stay inaccessible.

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
| `report(report)` / `clear()` | Existing validated V1 report/clear protocol |
| `settings.get(id)` / `settings.getAll()` | Activity-defined settings |
| `storage.get(key)` / `set(key, value)` / `remove(key)` / `clear()` | Activity-scoped JSON storage, 64 KiB total |
| `net.fetch(url, options)` | `{ status, ok, contentType, data }` |
| `log.debug/info/warn/error(...args)` | Redacted local diagnostics, up to eight values and 4 KiB |

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
`schemas/activity-v2.schema.json`; TypeScript declarations are in
`schemas/activity-api-v2.d.ts`. The runtime additionally validates selector
grammar, key safety, byte budgets, and DOM context; schema validation alone is
insufficient. Generate contracts with `node scripts/generate-v2-contract.mjs` and
the locally embedded VM with `npm run build:v2-engine`.

Run `npm ci`, `npm run check`, `npm test`, and `npm run build`. The optional
`node scripts/test-v2-browser.mjs` checks the actual unpacked extension, real
userScripts/WASM execution, private-data exclusions, guest escapes, storage,
presence, and interruption using an isolated browser profile and synthetic
HTTPS fixtures. It needs Playwright; see its environment overrides in the script.
