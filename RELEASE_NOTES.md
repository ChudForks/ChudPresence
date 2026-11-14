# ChudPresence 2.1.3

- Setup and Activity Library guidance now use Chrome, Brave, or Edge names
  and extension settings addresses to match the current browser.
- Added support for the official Jellyfin V1 Activity, including HTTP/HTTPS
  server setup from the popup or Activity Library. It runs only on servers
  explicitly added by the user while the Activity is enabled; installation
  alone starts no page detection.
- Saved server scopes preserve protocol, port, and reverse-proxy base paths,
  survive Activity updates, and can be removed individually. Existing static
  Activity matches and V2 restrictions remain compatible.
- Kept ChudPresence Link's browser identity intact when an approved local
  Jellyfin server needs loopback website permission.

# ChudPresence 2.1.2

- Added a first-run setup page for Chromium browsers. It opens on first install and guides you through allowing User Scripts, connecting Discord, and trying the included YouTube Activity.
- Setup (Chromium and Firefox) now puts Connect Discord at step 2. Discord sign-in is optional only when the ChudPresence Link desktop app is paired, and the page links to its GitHub download and the Microsoft Store.
- The popup setup card and the Activity Library setup notice and guide link now appear in Chromium too.

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

See [installation instructions](README.md#manual-installation) for browser setup. Activity
packages update separately from the extension. Existing locally loaded
Activities retain their stored source until you load updated package files.
