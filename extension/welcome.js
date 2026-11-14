import { browserApi as api, browserName, extensionsPageUrl, configureBrowserLabels, USER_SCRIPTS_SETTINGS_HINT, FIREFOX_ONBOARDING_KEY, openUserScriptsSettings } from './platform/browser-api.js';
import { createSetupGuide } from './setup-guide.js';

configureBrowserLabels(document);
const get = id => document.getElementById(id);
const enableButton = get('enable-activities');
const discordButton = get('connect-discord');
const finishButton = get('finish-setup');
const guide = createSetupGuide(document);
let scriptsAllowed = false;
let activityReady = false;
let opening = false;
let connecting = false;
let refreshing = false;
let finishing = false;
let restoring = false;
let discordConnected = false;
let linkPaired = false;
let discordFeedbackError = false;

function feedback(message, type = '') {
  get('setup-feedback').textContent = message;
  get('setup-feedback').className = `setup-feedback ${type}`;
}

async function message(type) {
  const response = await api.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.error || 'ChudPresence could not check your setup. Reload this page to try again.');
  return response;
}

function renderFinishDescription() {
  get('finish-description').textContent = !activityReady
    ? scriptsAllowed ? 'Install or enable an Activity in the Library to finish.' : 'Enable Activities to finish. You can connect Discord later.'
    : discordConnected || linkPaired ? 'Your sharing connection is ready. Finish setup and explore the Activity Library.'
      : 'Connect Discord or pair Link when you’re ready to share.';
}

function renderLibrary(state) {
  scriptsAllowed = state.userScriptsPermission === true;
  const activities = state.installed || [];
  const ready = activities.filter(item => item.enabled && ['waiting', 'detected'].includes(item.status));
  const youtube = scriptsAllowed && ready.find(item => item.id === 'youtube');
  activityReady = scriptsAllowed && ready.length > 0;
  enableButton.disabled = scriptsAllowed || opening;
  enableButton.textContent = scriptsAllowed ? 'Activities enabled' : `Open ${browserName} extension settings`;
  get('permission-state').textContent = scriptsAllowed ? 'Allowed' : state.userScriptsPermission === false ? 'Required' : 'Check needed';
  get('permission-step').classList.toggle('is-complete', scriptsAllowed);
  get('activity-state').textContent = activityReady ? 'Ready to try' : scriptsAllowed ? 'Needs an Activity' : state.userScriptsPermission === false ? 'Next' : 'Check needed';
  get('activity-step').classList.toggle('is-complete', activityReady);
  get('try-youtube').disabled = !scriptsAllowed || !youtube;
  get('activity-description').textContent = youtube
    ? 'The YouTube Activity is installed and enabled. You’re ready to try it.'
    : activityReady ? `${ready[0].name} is ready. Open its website and check your local preview, or browse the Library to add YouTube.`
      : scriptsAllowed ? 'No Activity is ready yet. Open the Activity Library to install or enable an Activity and review any missing website permissions.'
        : 'YouTube is included, so you can try it without downloading anything else. Go to Enable Activities to get it ready.';
  finishButton.disabled = !activityReady || finishing;
  get('finish-title').textContent = activityReady ? 'Your first Activity is ready.' : 'Ready when you are.';
  renderFinishDescription();
  guide.update({ scriptsAllowed, activityReady });
}

function renderDiscord(response) {
  const authenticated = response.setup?.authenticated === true || response.delivery?.authenticated === true;
  const linked = response.delivery?.link?.paired === true;
  const wasSharing = discordConnected || linkPaired;
  discordConnected = authenticated;
  linkPaired = linked;
  // Discord sign-in is only optional when ChudPresence Link shares activity instead.
  get('discord-state').textContent = authenticated ? 'Connected' : linked ? 'Optional' : 'Needed to share';
  get('discord-step').classList.toggle('is-complete', authenticated || linked);
  discordButton.disabled = authenticated || connecting;
  discordButton.textContent = authenticated ? 'Discord connected' : connecting ? 'Waiting for Discord…' : 'Connect Discord';
  if (authenticated) {
    discordFeedbackError = false;
    get('discord-feedback').textContent = 'Detected activity can now appear on your Discord profile.';
  } else if (!discordFeedbackError && !connecting) {
    get('discord-feedback').textContent = linked ? 'ChudPresence Link is paired and can share your detected activity.'
      : wasSharing ? 'Your sharing connection is disconnected. Connect Discord or pair Link again, or use the local preview.' : '';
  }
  renderFinishDescription();
  guide.update({ discordConnected: authenticated, linked });
}

async function refreshSetup() {
  if (refreshing || restoring) return;
  refreshing = true;
  try {
    let response = await message('ACTIVITY_LIBRARY_STATE');
    // Chrome does not notify the extension when the user flips the toggle, so
    // add the included Activity as soon as the permission is seen.
    if (response.result.userScriptsPermission === true && !(response.result.installed || []).length) {
      restoring = true;
      try {
        await message('ACTIVITY_RESTORE');
        response = await message('ACTIVITY_LIBRARY_STATE');
      } finally {
        restoring = false;
      }
    }
    renderLibrary(response.result);
    feedback(activityReady ? 'Activities are enabled. Your first Activity is ready.'
      : scriptsAllowed ? 'Activities are enabled. Choose an Activity in the Library to continue.'
        : 'One setting gets your first Activity ready. Start with Enable Activities.', activityReady ? 'success' : '');
  } catch (error) {
    renderLibrary({});
    feedback(`Could not finish checking Activities. ${error.message} Return to this tab to try again.`, 'error');
    enableButton.disabled = false;
    enableButton.textContent = `Open ${browserName} extension settings`;
  } finally {
    refreshing = false;
  }
}

enableButton.addEventListener('click', async () => {
  if (opening) return;
  opening = true;
  enableButton.disabled = true;
  try {
    await openUserScriptsSettings(api);
    feedback(`In the ${browserName} tab that opened: ${USER_SCRIPTS_SETTINGS_HINT} Then return to this tab.`);
  } catch (error) {
    feedback(`Could not open ${browserName}’s extension settings. ${error.message} Open ${extensionsPageUrl}. ${USER_SCRIPTS_SETTINGS_HINT}`, 'error');
  } finally {
    opening = false;
    enableButton.disabled = scriptsAllowed;
  }
});

get('try-youtube').addEventListener('click', () => api.tabs.create({ url: 'https://www.youtube.com/' })
  .catch(error => feedback(`Could not open YouTube. ${error.message}`, 'error')));

discordButton.addEventListener('click', async () => {
  if (connecting) return;
  connecting = true;
  discordFeedbackError = false;
  discordButton.disabled = true;
  discordButton.textContent = 'Waiting for Discord…';
  get('discord-feedback').textContent = 'Complete sign-in in the Discord window. You can also connect later.';
  try {
    renderDiscord(await message('CONNECT_DISCORD'));
  } catch (error) {
    discordFeedbackError = true;
    get('discord-feedback').textContent = `Discord didn’t connect. ${error.message} You can retry or finish setup and connect later.`;
  } finally {
    connecting = false;
    await message('GET_DISCORD_SETUP').then(renderDiscord).catch(() => {
      discordButton.disabled = discordConnected;
      discordButton.textContent = discordConnected ? 'Discord connected' : 'Connect Discord';
    });
  }
});

finishButton.addEventListener('click', async () => {
  if (!activityReady || finishing) return;
  finishing = true;
  finishButton.disabled = true;
  let readinessChecked = false;
  try {
    // Recheck readiness: the setting may have been turned off in another tab.
    const response = await message('ACTIVITY_LIBRARY_STATE');
    renderLibrary(response.result);
    readinessChecked = true;
    if (!activityReady) {
      feedback('Setup needs an enabled Activity. Return to Enable Activities to check permission, or open the Library to enable an Activity.', 'error');
      return;
    }
    await api.storage.local.set({ [FIREFOX_ONBOARDING_KEY]: { version: 1, completed: true } });
    location.href = 'activities.html?view=installed';
  } catch (error) {
    if (!readinessChecked) renderLibrary({});
    feedback(readinessChecked ? `Could not save setup. ${error.message} Try Finish setup again.`
      : `Could not verify setup. ${error.message} Return to this tab to check Activities again.`, 'error');
  } finally {
    finishing = false;
    finishButton.disabled = !activityReady;
  }
});

window.addEventListener('focus', () => {
  void refreshSetup();
  if (!connecting) void message('GET_DISCORD_SETUP').then(renderDiscord).catch(() => {});
});
void refreshSetup();
void message('GET_DISCORD_SETUP').then(renderDiscord).catch(error => {
  discordButton.disabled = false;
  discordButton.textContent = 'Connect Discord';
  get('discord-feedback').textContent = `Could not check Discord. ${error.message} You can still set up Activities.`;
});
