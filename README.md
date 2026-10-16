# ChudPresence

ChudPresence is a Chromium extension that shares your browsing and playback activity on Discord through customizable Activities.

## Features

- Discover and manage Activities in the built-in Activity Library.
- See a local preview of detected playback before connecting Discord.
- Optionally publish your activity to Discord.
- Use a Manifest V3 extension on Chromium 135 or newer.

## Install

This repository provides the extension source. To load it in Chromium:

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the `extension/` folder. On Chrome 138 or newer, open the extension's details and enable **Allow User Scripts**.
4. Open ChudPresence and choose **Activity Library** to install Activities. Review the requested website permissions before approving them.

Playback detection and the local preview work without Discord. Connect Discord from the extension popup to publish your activity.

## Activities and API references

Activity packages are maintained separately from the extension:

- [Chat Presence Activity (V1)](https://github.com/ChudForks/ChudPresence-Activities) contains the existing official packages and V1 reference. V1 remains for compatibility and inspection; use V2 for new Activity development.
- [Chat Presence Activity V2](https://github.com/ChudForks/ChudPresence-Activities-V2) is the V2 package repository.
- [Activity API V2 development guide](https://github.com/ChudForks/ChudPresence/blob/master/extension/ACTIVITY_API_V2.md) documents the extension's V2 API and package authoring model.

Choose **Refresh catalog** in Activity Library to discover and install Activities from both the V1 and V2 repositories.

## Privacy

See [Privacy](PRIVACY.md) for information about permissions, data handling, and Discord publishing.
