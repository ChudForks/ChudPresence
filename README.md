# ChudPresence

ChudPresence shares your browsing and playback activity on Discord through customizable Activities on Chromium and Firefox.

## Features

- Discover and manage Activities in the built-in Activity Library.
- See a local preview of detected playback before connecting Discord.
- Optionally publish your activity to Discord.
- Use a Manifest V3 extension on Chromium 135 or newer.
- Build Firefox 153 or newer from the same shared source with `npm run build:firefox`.

## Install

This repository provides the extension source. To load it in Chromium:

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the `extension/` folder. On Chrome 138 or newer, open the extension's details and enable **Allow User Scripts**.
4. Open ChudPresence and choose **Activity Library** to install Activities. Review the requested website permissions before approving them.

Playback detection and the local preview work without Discord. Connect Discord from the extension popup to publish your activity.

For the loadable unsigned Firefox build, permissions, OAuth callback setup, migration and AMO preparation, see [ChudPresence for Firefox](ChudPresence-Firefox/README.md). Use `npm run build:chromium`, `npm run build:firefox`, or `npm run build:all`; `npm run build` retains its Chromium default. Both browsers stay in this repository and consume the same Activity catalogs/contracts. [Testing](TESTING.md) describes checks and [the port baseline](ChudPresence-Firefox/PORT_BASELINE.md) records source provenance and future maintenance.

## Activities and API references

Activity packages are maintained separately from the extension:

- [ChudPresence Activity (V1)](https://github.com/ChudForks/ChudPresence-Activities) contains the existing official packages and V1 reference. V1 remains for compatibility and inspection; use V2 for new Activity development.
- [ChudPresence Activity V2](https://github.com/ChudForks/ChudPresence-Activities-V2) is the V2 package repository.
- [Activity API V2 development guide](https://github.com/ChudForks/ChudPresence/blob/master/extension/ACTIVITY_API_V2.md) documents the extension's V2 API and package authoring model.

Choose **Refresh catalog** in Activity Library to discover and install Activities from both the V1 and V2 repositories.

## Privacy

See [Privacy](PRIVACY.md) for information about permissions, data handling, and Discord publishing.

## Browser differences

The current build has shown the following difference for browsing presence while the Activity's tab remains selected:

- **Chromium:** Presence stays active when clicking into another app while the browser window remains open and isn't minimized. Minimizing the browser clears it.
- **Firefox:** Presence clears as soon as another app gains focus, even if the browser window remains visible.
