# Port baseline and maintenance

The implementation source was the existing current working tree of `E:\Projects\ChudPresenceSolo-Chromium-Activity-Lab`.

- Starting Chromium commit: `0f10283102305200016ff765c10d6527bdcccd80`.
- Starting commit subject: `Add V2 Activity catalog support and refresh documentation`.
- Starting commit time: October 15, 2026, 8:30:46 p.m. America/New_York.
- Initial `git status --porcelain=v1 --untracked-files=all`: empty. There were no tracked or untracked user edits to incorporate or overwrite. Ignored local Activity checkouts/dependencies were retained.
- Repository instruction search: no applicable `AGENTS.md` in this checkout or its drive/project ancestors.
- Existing remote: `https://github.com/ChudForks/ChudPresence.git`. No remote or branch was changed, no nested Git repository was created, and no push was made.

The two older Firefox repositories were read only for native Firefox behavior, legacy provider setting keys, and identity evidence. Their code, experimental add-on IDs and obsolete package contracts were not used as the implementation base.

## Shared source ownership

`extension/` remains the primary shared source and the directly loadable Chromium development tree. UI/HTML/CSS, Activity catalogs and contracts, registry, navigation, manager/broker, QuickJS/WASM engine, worker code, presence selection and Discord transport remain shared. Platform differences consist of:

- Chromium `extension/manifest.json`; Firefox `ChudPresence-Firefox/extension/manifest.json`.
- Shared `platform/browser-api.js` for Promise API selection, permission instructions and suspension state.
- Firefox `background.html`, private worker-host page and `discord/shutdown-cleanup.js` overlay.
- Shared no-op `platform/migration.js` with a Firefox legacy-settings overlay.
- Shared no-op `platform/activity-session.js` with a Firefox transient ownership-checkpoint overlay for event-page suspension/wake.
- The small shared OAuth redirect distinction in `config.js` and browser namespace selection inside generated Activity wrappers.

Commit Firefox source, tests, build scripts, both manifests and workflows together in this repository. Only generated `dist/` outputs and existing local dependency/catalog checkouts are ignored. Never copy the whole shared tree into the Firefox source overlay or create a second Activity catalog.

## Bringing future Chromium changes to Firefox

Make shared feature/fix changes once under `extension/`. Every Firefox build automatically consumes those current files and applies only the small overlay. When changing an overridden file, review both implementations explicitly; `git diff <previous-release> -- extension/discord/shutdown-cleanup.js extension/platform/migration.js extension/platform/activity-session.js` identifies the main cases. Keep manifest permissions, versions, resource paths and minimum browser versions intentional.

For Activity API changes, update the shared canonical contract/schema/generated runtime together, preserve support/version gates, and add shared conformance tests. New native API use must be checked against official Chromium and Firefox compatibility data. Raise the corresponding minimum or add an explicit platform implementation; never advertise an Activity API version with unsupported browser services. Existing Activities remain browser neutral and use the same V1/V2 catalogs.

Before every release run `npm ci --ignore-scripts`, static checks, all tests, both builds, package checks, Firefox lint, and the manual browser checklist. CI repeats the clean-checkout gates. Review Firefox suspension and document ownership whenever background, worker or messaging code changes; preserve `{closing:true}` and confirmed-deletion token retention whenever Discord transport changes. Record any production ID verification/version migration decisions in the Firefox README.
