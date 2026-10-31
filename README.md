# ChudPresence

ChudPresence shares your browsing and playback activity on Discord through customizable Activities on Chromium and Firefox.

## Features

- Discover and manage Activities in the built-in Activity Library.
- See a local preview of detected playback before connecting Discord.
- Optionally publish your activity to Discord.
- Pair with ChudPresence Link for local Discord RPC and selective service settings sync with your phone.
- Use Chromium 135 or newer, or Firefox 153 or newer.

## Install

Available packages are listed under [Releases](https://github.com/ChudForks/ChudPresence/releases).
To load ChudPresence in Chromium:

1. Extract the Chromium ZIP, or download the repository source to use its `extension/` folder.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted extension folder. On Chrome 138 or newer, open the extension's details and enable **Allow User Scripts**.
4. Open ChudPresence and choose **Activity Library** to install Activities. Review the requested website permissions before approving them.

Playback detection and the local preview work without Discord. Connect Discord from the extension popup, or pair with ChudPresence Link, to publish your activity.

Each Activity's **Playback progress** setting shows elapsed and remaining playback time when enabled. Turn it off to show continuous app elapsed time across songs, videos, seeking, and pauses. The app timer starts a new session when presence clears or switches to another Activity.

## ChudPresence Link

Open the chain-link tab in the popup. In the ChudPresence Link desktop app on this PC, choose **Pair browser**, then enter its eight-digit code and a browser name in the extension. The default local port is `17879`; **Connection options** supports a custom port.

When desktop Discord is available, Link publishes through local RPC. The extension first acquires ownership and confirms deletion of its headless session, then starts local publishing. If Link or desktop Discord is unavailable, the extension uses its existing headless connection. Connect a fallback Discord account in the popup to use headless publishing while Link is offline. If a local request loses its response, fallback waits 35 seconds to let the previous lease clear safely. Browser restart also observes this grace period when local ownership was left unresolved.

The Link tab's **Connected** badge confirms the app connection. **Waiting for activity** means there is no eligible presence to publish yet; RPC ownership starts with a valid Activity. After a browser restart, **Previous session** counts down the safety wait without implying the Link app is offline. **Local Discord · accepted** means Link has received the activity; **publishing** appears after its background publisher confirms publication.

Pair your phone in Link to discover services supported by both devices. With Link 0.4 or newer, choose **All supported settings** or **Selected settings** for each service, then choose the starting device and **Enable sync**. Supported settings are Discord bar display (application name, creator/artist, or title), service enabled, show while paused, artwork, playback progress, and action buttons. Only your selected settings sync; matching services never enable sync themselves. Use **Save sync settings** to change the selection. Existing display-only selections stay display-only until you change them, and older Link versions continue to sync display choices only.

Changes made in Link or on a linked device update the current activity through authenticated live events. Disabling a service hides its activity while its settings continue syncing. Offline edits retain their original versions; conflicting edits adopt Link's authoritative settings. Disabling sync keeps current local values. Activity code, credentials, priority rules, and playback sessions stay local.

Syncing **Playback progress** uses the browser's existing timer behavior: on shows media progress; off keeps the continuous app timer, including while paused.

**Unlink browser** releases local publishing and removes this browser's pairing. If Link is offline, remove the browser in the desktop app as well to revoke that token. The sharing switch in Settings controls presence on both transports. While local RPC is active, **Disconnect fallback** disconnects only the headless account.

## Activity priority

In the extension popup, open **Settings → Activity priority** to choose which Activity appears when several are available. By default, playing media in the viewed tab wins, followed by playing media in other tabs, browsing in the viewed tab, and paused media in the viewed or other tabs.

Expand Activity priority and drag the handles to reorder rules, or focus a handle and use the up/down arrow keys. Each rule can match a specific installed Activity, playing media, browsing/page activity, paused media, and a tab scope. Changes save and apply automatically. Use each row’s edit button to adjust its Activity, state, or tab scope. **Reset to default** restores and saves the default list. The list is saved in this browser and survives Activity updates.

The first matching rule wins; other eligible reports are considered afterward. Within a rule, the viewed tab wins, then the current source is retained to avoid switching on routine reports. Hidden/private reports and Activities with paused presence disabled remain ineligible regardless of priority.

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
