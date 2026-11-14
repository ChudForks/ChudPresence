import { discordPresence } from '../discord/presence.js';
import { createLinkClient, prepareLinkNetwork } from '../link/client.js';
import { createLinkPublisher, LINK_POLL_ALARM } from '../link/publisher.js';

const storage = {
  get: keys => chrome.storage.local.get(keys),
  set: values => chrome.storage.local.set(values),
};
const client = createLinkClient({ storage, prepareNetwork: () => prepareLinkNetwork(chrome),
  origin: chrome.runtime.getURL('').replace(/\/$/, '') });
const publisher = createLinkPublisher({ headless: discordPresence, client, storage });
let configured = false;

export const presencePublisher = Object.freeze({
  ...publisher,
  configureLink(hooks) {
    publisher.configure(hooks);
    if (configured) return;
    configured = true;
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === LINK_POLL_ALARM) void publisher.refresh().catch(() => {});
    });
    void chrome.alarms.create(LINK_POLL_ALARM, { periodInMinutes: 0.5 });
    // Pairing and OAuth credentials belong to trusted extension contexts.
    void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});
  },
});
