# ChudPresence 2.1.0

- Disabling Playback progress now shows continuous app elapsed time across
  songs, videos, and pauses, including background worker wakes. Enabling it
  retains per-item playback timing and the existing paused timer behavior.
- Added a device-linking tab beside the presence preview and Settings. Pair with
  ChudPresence Link using a browser code.
- Fixed false “Pair again” errors after successful pairing by preserving the
  browser's Origin on authenticated reads. Legacy localhost permission grants
  are removed automatically; the connection uses Link's CORS policy.
- The Link tab distinguishes an idle browser and startup session recovery from
  headless fallback. Publication confirmation is checked independently so an
  accepted activity can advance to publishing after Link finishes its RPC update.
- Link can publish through local Discord RPC, with serialized lease handoff,
  confirmed headless cleanup, regular heartbeats, and automatic headless fallback.
  Lost local requests and unresolved ownership after restart observe a 35-second grace period.
- Shared browser/phone services offer opt-in status display sync with a chosen
  starting device or value. Offline edits retain their base versions; conflicts
  adopt the server choice. Other preferences remain local.
- The extension popup's Settings tab now includes an editable Activity priority list with rules for
  individual Activities, playback/browsing state, and the viewed or other tabs.
  Defaults prefer playing media over browsing and paused media. Rules can be
  dragged or moved with keyboard arrows, saved automatically per browser, and reset to defaults.
- Priority selection responds immediately to tab/window focus changes, keeps
  overlapping Activities available, and preserves selection across Firefox
  background suspension. Routine heartbeat reports do not steal priority.
- V1/V2 reports can select `focusPolicy: 'foreground'` for browsing presence.
  Presence is published while the Activity's tab is selected in the focused
  browser window, including during supported toolbar-popup and address-bar use.
- Switching tabs or leaving the browser immediately suppresses foreground
  presence. Returning restores a still-valid report. Explicit clears, closure,
  stale-report cleanup, and background playback remain supported.
- Activities using the new focus policy require extension 2.0.5 and must be
  installed or updated separately.

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
