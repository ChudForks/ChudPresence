# ChudPresence 2.1.1

- Fixed Series and Episode status selection for episode layouts, including
  Crunchyroll, regardless of which value appears on the first display line.
- Updated the bundled YouTube Activity to 1.0.6. Buffering is reported as
  non-playing until playback resumes, with immediate updates for playback events.
- Popup playback and visibility diagnostics now follow the selected presence
  tab. Activity report and clear history are labeled separately.
- Added GPL-3.0-only licensing and copyright notices to the repository and all
  browser packages.

## Compatibility and limitations

Discord's Headless Sessions transport remains experimental. Behavior can vary
by website and browser; immediate presence clearing cannot be guaranteed after
a crash or network outage. See the [V2 security limits](extension/ACTIVITY_API_V2.md#security-limits-and-validation)
for Activity access boundaries.

See [installation instructions](README.md#install) for browser setup. Activity
packages update separately from the extension. Existing locally loaded
Activities retain their stored source until you load updated package files.
