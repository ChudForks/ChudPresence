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

## Production identity

`npm run build:firefox:production` builds a candidate named **ChudPresence** using
the permanent add-on ID **`chudpresence@chudforks`**, configured in
[`production.json`](production.json). Mozilla will check the ID's availability
when this new listing is submitted. Keep the ID unchanged for future updates.

The candidate is `dist/ChudPresence-Firefox-2.1.0-unsigned-production.xpi` (with the
current version in its filename). It still requires Mozilla signing before
normal installation. `npm run build:firefox` continues to build the separate
development identity; `npm run build:all` builds Chromium and both Firefox
candidates. GitHub release uploads currently include the development Firefox
package; the production candidate is not published by that workflow.

## Activities and permissions

On first installation, a **Welcome to ChudPresence** tab opens automatically:

1. Choose **Enable Activities**. In Firefox's **User Scripts** request, review
   the warning, select **Allow unverified third-party scripts to access your
   data**, then choose **Allow**.
   An Activity teaches ChudPresence how to detect playback on a website. The
   Services list stays empty until this permission is granted.
2. The included YouTube Activity is added automatically. Open YouTube and play a
   video, then open ChudPresence from Firefox's Extensions menu (the puzzle
   piece) to check the **Local presence preview**.
3. Optionally choose **Connect Discord** to share your activity. You can finish
   setup without connecting and sign in later from the popup.

If you dismiss the permission request, choose **Enable Activities** again to
retry. Reopen the guide from **Settings → Open setup guide** in the
popup, or **Setup guide** in the Activity Library. Closing the guide or
choosing **Set up later** keeps setup available in the popup. Updates and browser
restarts do not automatically open the guide.

Open **Activity Library** and choose **Refresh catalog** to discover more
Activities. Approve catalog access, then review the website/network access
requested by each Activity before installing it.

The bundled YouTube Activity becomes available once permission is granted.
**Refresh catalog** uses the same official V1 and V2 repositories as Chromium.
Playback detection and the local preview work without a Discord connection.

See [Privacy](../PRIVACY.md) for permissions and data handling, and the
[Activity API V2 guide](../extension/ACTIVITY_API_V2.md) for creating Activities.

## Discord connection

Connect Discord from the popup to publish your activity. After temporarily
loading the production candidate, run `browser.identity.getRedirectURL()` in
that add-on's extension debugger console. Register the exact returned URL with
the extension's Discord application (`1549066134706323548`), then test sign-in.
The development and production identities have different callbacks. Until the
appropriate callback is registered, local playback preview remains available,
but Discord sign-in cannot complete.

The current unsigned package uses the development add-on ID
`chudpresence-firefox-development@chudforks.local`. It has separate storage from
an existing signed installation and does not replace that installation or carry
over its settings. The production identity is configured locally; AMO signing,
its Discord callback registration, and signed upgrades remain unverified.

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
