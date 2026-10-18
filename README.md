# ChudPresence

ChudPresence shares your browsing and playback activity on Discord through customizable Activities on Chromium and Firefox.

## Features

- Discover and manage Activities in the built-in Activity Library.
- See a local preview of detected playback before connecting Discord.
- Optionally publish your activity to Discord.
- Use Chromium 135 or newer, or Firefox 153 or newer.

## Install

Available packages are listed under [Releases](https://github.com/ChudForks/ChudPresence/releases).
To load ChudPresence in Chromium:

1. Extract the Chromium ZIP, or download the repository source to use its `extension/` folder.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted extension folder. On Chrome 138 or newer, open the extension's details and enable **Allow User Scripts**.
4. Open ChudPresence and choose **Activity Library** to install Activities. Review the requested website permissions before approving them.

Playback detection and the local preview work without Discord. Connect Discord from the extension popup to publish your activity.

For Firefox installation, permissions, and current limitations, see
[ChudPresence for Firefox](ChudPresence-Firefox/README.md).

## Activities and API references

Activity packages are maintained separately from the extension:

- [ChudPresence Activity (V1)](https://github.com/ChudForks/ChudPresence-Activities) contains the existing official packages and V1 reference. V1 remains for compatibility and inspection; use V2 for new Activity development.
- [ChudPresence Activity V2](https://github.com/ChudForks/ChudPresence-Activities-V2) is the V2 package repository.
- [Activity API V2 development guide](extension/ACTIVITY_API_V2.md) documents the extension's V2 API and package authoring model.

Choose **Refresh catalog** in Activity Library to discover and install Activities from both the V1 and V2 repositories.

## Privacy

See [Privacy](PRIVACY.md) for information about permissions, data handling, and Discord publishing.

## Browser differences

The current build has shown the following difference for browsing presence while the Activity's tab remains selected:

- **Chromium:** Presence stays active when clicking into another app while the browser window remains open and isn't minimized. Minimizing the browser clears it.
- **Firefox:** Presence clears as soon as another app gains focus, even if the browser window remains visible.
