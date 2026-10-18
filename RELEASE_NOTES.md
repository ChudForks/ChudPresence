# ChudPresence 2.0.5 (unreleased)

- V1/V2 reports can select `focusPolicy: 'foreground'` for browsing presence.
  Presence is published while the Activity's tab is selected in the focused
  browser window, including during supported toolbar-popup and address-bar use.
- Switching tabs or leaving the browser immediately suppresses foreground
  presence. Returning restores a still-valid report. Explicit clears, closure,
  stale-report cleanup, and background playback remain supported.
- Activities using the new focus policy require extension 2.0.5 and must be
  installed or updated separately.

# ChudPresence 2.0.4

October 15, 2026.

- Activity API V2 is the stable baseline for new Activities. V1 remains supported.
- Programmable V2 Activities run in isolated QuickJS/WebAssembly guests with
  declared page reads, scoped services, and resource limits.
- V2 supports browsing presence, navigation grace, and media scopes, plus
  shared V1/V2 status, artwork, progress, and button controls.
- V1 Activities can opt into navigation grace.
- Activity Library includes improvements to installation, diagnostics, settings,
  scrolling, and interaction.
- The extension, popup, Activity Library, Discord fallback labels, and release
  packages use the ChudPresence name.

## Compatibility and limitations

Discord's Headless Sessions transport remains experimental. Behavior can vary
by website and browser; immediate presence clearing cannot be guaranteed after
a crash or network outage. See the [V2 security limits](extension/ACTIVITY_API_V2.md#security-limits-and-validation)
for Activity access boundaries.

See [installation instructions](README.md#install) for browser setup. Activity
packages update separately from the extension. Existing locally loaded
Activities retain their stored source until you load updated package files.
