# Legacy Activity API V2 reference

Archived October 14, 2026. Keep these files as references for Activity behavior and
presence construction until replacement Activities are available for the newer
V2. This is the retired declarative implementation, not the replacement SDK.

The active extension is restored to `c9c56c1`, the last commit before V2 was
introduced, with documentation and this reference directory added afterward.
Its V1 implementation is unchanged. The separate V1 Activities repository stays
at `dd642c2`.

## Preserved snapshots

| Directory | Contents | Source commit |
| --- | --- | --- |
| [workspace/](workspace/README.md) | Complete tracked extension workspace at version 2.3.0: runtime, presence builders, UI, contracts, examples, tests, and reports | `33e15a2401459c56eacf706758dfaeddccefeb10` |
| [activity-repository/](activity-repository/README.md) | Complete tracked V2 Activities repository: packages, icons, catalog, schemas, SDK tools, examples, service policies, and Stories audit | `a6d0fc46eaf48e83abdc13f1f6f53aebe9a4212b` |

Both source repositories have the annotated tag
`archive/declarative-v2-2026-10-14` pointing to these respective commits. This
retains the complete history after deletion of the extension's V2 branch.
The original `ChudPresence-Activities-V2/` checkout also remains in the workspace
as an independent repository; its root README now identifies its reference status.

The [snapshot manifest](snapshot-manifest.json) records the source commits, Git
blob IDs, and SHA-256 checksums of all 160 source files. The snapshots use exact
Git blob bytes; archive attributes preserve their canonical line endings. Dependencies,
browser profiles, and generated builds are outside these tracked snapshots.

## Activities to replace

| Activity | Archived version | Behavior reference |
| --- | --- | --- |
| Google | 1.0.1 | [Package and guide](activity-repository/activities/google/README.md): Homepage, Search, Images, AI Mode, submitted queries, artwork, and elapsed time |
| Instagram | 1.1.0 | [Package and guide](activity-repository/activities/instagram/README.md): Reels captions, creators, native playback progress, artwork, and public links |
| Prime Video | 1.1.1 | [Package and guide](activity-repository/activities/prime-video/README.md): movies and episodes, retained metadata, playback, and artwork |
| Roblox | 1.1.0 | [Package and guide](activity-repository/activities/roblox/README.md): browsing routes, experience headings, artwork, and elapsed time |
| TikTok | 1.1.1 | [Package and guide](activity-repository/activities/tiktok/README.md): video/feed modes, LIVE, creator identity, artwork, and public links |

Instagram 1.1.0 is Reels-only. The original Stories behavior remains in the
archived bundled collector. Its failed package-only migration is documented in
[the Stories capability-gap report](activity-repository/INSTAGRAM_STORIES_CAPABILITY_GAP.md).

## How presence was constructed

Read the package's `activity.json` alongside the runtime. Package declarations
alone do not capture the hardcoded formatting and artwork used by older adapters.

1. [The bundled collector](workspace/extension/core/activity-v2-runtime.js)
   contains the original site adapters, including Instagram Stories.
   [The generic collector](workspace/extension/core/activity-v2-generic.js)
   interprets the newer package-driven TikTok and Instagram configurations.
2. [The manager](workspace/extension/core/activity-manager.js) registers Activities,
   authenticates reports, selects current documents, and integrates
   [approved lookup services](workspace/extension/core/activity-v2-services.js).
3. [The validator and presentation builder](workspace/extension/core/activity-validator.js)
   applies templates and legacy site formatting through
   `applyActivityV2Presentation` and `normalizeActivityReport`.
4. [The presence intent builder](workspace/extension/core/presence.js), particularly
   `createPresenceIntent`, constructs display fields, playback timing, artwork,
   and buttons.
5. [The Discord activity builder](workspace/extension/discord/activity-builder.js),
   particularly `buildHeadlessActivity`, serializes the final Discord payload.

The [archived tests](workspace/test/) preserve expected behavior for each Activity
and the shared builders. Browser fixture scripts are in
[workspace/scripts/](workspace/scripts/). Existing synthetic fixture results and
live-browser limitations remain in [the testing record](workspace/TESTING.md).

When replacing an Activity, compare its title/state ordering, media identity,
playback and clear conditions, timestamps, artwork, and buttons against these
references. Decide the newer V2's security contract separately; retaining old
behavior does not require retaining the old adapters or declarative language.

## Design and migration records

- [Archived developer guide](workspace/extension/ACTIVITY_API_V2.md)
- [Adapter and capability report](workspace/V2_ADAPTER_REPORT.md)
- [Architecture](workspace/ARCHITECTURE.md)
- [Privacy model](workspace/PRIVACY.md)
- [Trusted service examples](activity-repository/services/README.md)

These source snapshots are outside the active `extension/` directory and its
build inputs. Their instructions and versions describe the historical system.

## Archive verification

- Verified all 160 archived source files against the original Git blob IDs.
- Confirmed active `extension/`, `schemas/`, `test/`, `scripts/`, and `package.json`
  have no differences from the pre-V2 baseline `c9c56c1`.
- `npm run check` passed, including the V1 contract and all nine V1 catalog entries.
- `npm test` passed all 229 active extension tests.
- Confirmed the independent V1 Activities repository remains clean at `dd642c2`.
