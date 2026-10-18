# ChudPresence for Firefox

ChudPresence requires **desktop Firefox 153 or newer**. It uses the same Activity
Library, V1/V2 Activities, settings, and playback preview as the Chromium version.

## Installation

Check [Releases](https://github.com/ChudForks/ChudPresence/releases) for an assembled
Firefox package. Packages labeled `unsigned-development` are unsigned and can be
loaded temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select the unsigned XPI, or the `manifest.json` inside its extracted folder.

Temporary add-ons are removed when Firefox restarts. Permanent installation
requires an AMO-signed XPI. The `ChudPresence-Firefox/extension/` source directory
contains only Firefox-specific files and cannot be loaded by itself.

## Activities and permissions

Open **Activity Library** to install Activities. Approve Firefox's optional
**User Scripts** permission and the Activity's requested website/network access.
If needed, choose **Allow Activity scripts** in the Library to request User
Scripts separately.

The bundled YouTube Activity becomes available once permission is granted.
**Refresh catalog** uses the same official V1 and V2 repositories as Chromium.
Playback detection and the local preview work without a Discord connection.

See [Privacy](../PRIVACY.md) for permissions and data handling, and the
[Activity API V2 guide](../extension/ACTIVITY_API_V2.md) for creating Activities.

## Discord connection

Connect Discord from the popup to publish your activity. Sign-in requires the
exact OAuth callback shown in **Discord setup** to be registered with the
extension's Discord application. If it is not registered for your build, local
playback preview remains available, but Discord sign-in cannot complete.

The current unsigned package uses the development add-on ID
`chudpresence-firefox-development@chudforks.local`. It has separate storage from
an existing signed installation and does not replace that installation or carry
over its settings. The production add-on identity has not yet been verified.

## Existing settings

When updating an installation with the same add-on ID, the extension preserves
existing Activities, settings, and Discord authorization. Recognized older
provider preferences migrate to the corresponding Activity preferences. Those
Activities still need to be installed through the Library.

## Current limitations

- Firefox clears foreground browsing presence when another app gains focus,
  even if the browser window remains visible.
- Firefox has no Chromium offscreen browser-close backup. Tab and document
  closure use the shared presence-clearing path, but a crash, forced shutdown,
  or network outage can prevent immediate clearing.
- Discord sign-in, live-site playback, signed upgrades, and browser-close
  delivery still require manual verification on Firefox.
