import { browserApi as api, FIREFOX_ONBOARDING_KEY, openUserScriptsSettings } from './platform/browser-api.js';

const get = id => document.getElementById(id);
const enableButton = get('enable-activities');
const discordButton = get('connect-discord');
const finishButton = get('finish-setup');
let scriptsAllowed = false;
let activityReady = false;
let enabling = false;
let connecting = false;
let refreshing = false;
let finishing = false;

function feedback(message, type = '') {
  get('setup-feedback').textContent = message;
  get('setup-feedback').className = `setup-feedback ${type}`;
}

async function message(type) {
  const response = await api.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.error || 'ChudPresence could not check your setup. Reload this page to try again.');
  return response;
}

function renderLibrary(state) {
  scriptsAllowed = state.userScriptsPermission === true;
  const activities = state.installed || [];
  const ready = activities.filter(item => item.enabled && ['waiting', 'detected'].includes(item.status));
  const youtube = ready.find(item => item.id === 'youtube');
  activityReady = scriptsAllowed && ready.length > 0;
  enableButton.disabled = scriptsAllowed || enabling;
  enableButton.textContent = scriptsAllowed ? 'Activities enabled' : 'Enable Activities';
  get('permission-state').textContent = scriptsAllowed ? 'Allowed' : 'Required';
  get('permission-step').classList.toggle('is-complete', scriptsAllowed);
  get('activity-state').textContent = activityReady ? 'Ready to try' : scriptsAllowed ? 'Needs an Activity' : 'Next';
  get('activity-step').classList.toggle('is-complete', activityReady);
  get('try-youtube').disabled = !scriptsAllowed || !youtube;
  get('activity-description').textContent = youtube
    ? 'The YouTube Activity is installed and enabled. You’re ready to try it.'
    : activityReady ? `${ready[0].name} is ready. Open its website and check your local preview, or browse the Library to add YouTube.`
      : scriptsAllowed ? 'No Activity is ready yet. Open the Activity Library to install or enable an Activity and review any missing website permissions.'
        : 'YouTube is included, so you can try it without downloading anything else. Enable Activities above to get it ready.';
  finishButton.disabled = !activityReady || enabling || finishing;
  get('finish-title').textContent = activityReady ? 'Your first Activity is ready.' : 'Ready when you are.';
  get('finish-description').textContent = activityReady
    ? 'Finish setup and explore the Activity Library. Discord is optional.'
    : scriptsAllowed ? 'Install or enable an Activity in the Library to finish.' : 'Enable Activities to finish. Discord can wait.';
}

function renderDiscord(response) {
  const authenticated = response.setup?.authenticated === true || response.delivery?.authenticated === true;
  get('discord-state').textContent = authenticated ? 'Connected' : 'Optional';
  get('discord-step').classList.toggle('is-complete', authenticated);
  discordButton.disabled = authenticated || connecting;
  discordButton.textContent = authenticated ? 'Discord connected' : connecting ? 'Waiting for Discord…' : 'Connect Discord';
  if (authenticated) get('discord-feedback').textContent = 'Detected activity can now appear on your Discord profile.';
}

async function refreshSetup() {
  if (refreshing || enabling) return;
  refreshing = true;
  try {
    const response = await message('ACTIVITY_LIBRARY_STATE');
    renderLibrary(response.result);
    feedback(activityReady ? 'Activities are enabled. Try your first site below.'
      : scriptsAllowed ? 'Activities are enabled. Choose an Activity in the Library to continue.'
        : 'One permission gets your first Activity ready. Start with step 1.', activityReady ? 'success' : '');
  } catch (error) {
    feedback(error.message, 'error');
    enableButton.disabled = false;
    enableButton.textContent = 'Enable Activities';
  } finally {
    refreshing = false;
  }
}

enableButton.addEventListener('click', async () => {
  if (enabling) return;
  enabling = true;
  enableButton.disabled = true;
  enableButton.textContent = 'Approve the permission request…';
  feedback('In the Firefox prompt, review the warning, select “Allow unverified third-party scripts to access your data”, then choose Allow.');
  try {
    // Invoke directly in the click handler, before any other asynchronous work.
    const granted = await openUserScriptsSettings(api);
    if (!granted) {
      feedback('Activities are still off because the permission wasn’t granted. Click Enable Activities to try again, select the scripts checkbox in the Firefox prompt, then choose Allow.', 'error');
      return;
    }
    await message('ACTIVITY_RESTORE');
    const response = await message('ACTIVITY_LIBRARY_STATE');
    renderLibrary(response.result);
    feedback(activityReady ? 'Activities enabled. Your first Activity is ready to try in step 2.'
      : 'Permission granted. Open the Activity Library to check your first Activity.', activityReady ? 'success' : '');
  } catch (error) {
    feedback(`Could not finish enabling Activities. ${error.message} You can try again with the button below.`, 'error');
  } finally {
    enabling = false;
    enableButton.disabled = scriptsAllowed;
    enableButton.textContent = scriptsAllowed ? 'Activities enabled' : 'Enable Activities';
    finishButton.disabled = !activityReady;
  }
});

get('try-youtube').addEventListener('click', () => api.tabs.create({ url: 'https://www.youtube.com/' })
  .catch(error => feedback(`Could not open YouTube. ${error.message}`, 'error')));

discordButton.addEventListener('click', async () => {
  if (connecting) return;
  connecting = true;
  discordButton.disabled = true;
  discordButton.textContent = 'Waiting for Discord…';
  get('discord-feedback').textContent = 'Complete sign-in in the Discord window. You can also connect later.';
  try {
    renderDiscord(await message('CONNECT_DISCORD'));
  } catch (error) {
    get('discord-feedback').textContent = `Discord didn’t connect. ${error.message} You can retry or finish setup and connect later.`;
  } finally {
    connecting = false;
    await message('GET_DISCORD_SETUP').then(renderDiscord).catch(() => {
      discordButton.disabled = false;
      discordButton.textContent = 'Connect Discord';
    });
  }
});

finishButton.addEventListener('click', async () => {
  if (!activityReady || finishing) return;
  finishing = true;
  finishButton.disabled = true;
  try {
    // Recheck readiness: permission may have been removed in another tab.
    const response = await message('ACTIVITY_LIBRARY_STATE');
    renderLibrary(response.result);
    if (!activityReady) {
      feedback('Setup needs an enabled Activity. Follow the steps above to continue.', 'error');
      return;
    }
    await api.storage.local.set({ [FIREFOX_ONBOARDING_KEY]: { version: 1, completed: true } });
    location.href = 'activities.html?view=installed';
  } catch (error) {
    feedback(`Could not save setup. ${error.message} Try Finish setup again.`, 'error');
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
