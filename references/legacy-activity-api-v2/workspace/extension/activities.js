import { compareActivityVersions, downloadActivity, fetchCatalog, readCatalogCache, repositoryActivityIconUrl, repositoryForActivityApiVersion } from './core/activity-repository.js';
import { activityV2Digest, describeActivityV2 } from './core/activity-api-v2.js';
import { validateV2ServicePolicy, describeV2ServicePolicy, v2ServiceDigest } from './core/activity-v2-services.js';
import { validateActivityPackageSource } from './core/activity-validator.js';
import { requestHostPermissions } from './core/activity-permissions.js';
import { diagnosticEntryCount, formatDeveloperDiagnostics } from './core/developer-diagnostics.js';
import {
  MAX_ACTIVITY_ICON_BYTES,
  validateActivityIcon,
  validateActivityMetadata,
  validateActivitySource,
  isSupportedActivityApiVersion,
} from './core/activity-validator.js';

const api = globalThis.browser || globalThis.chrome;
const pageStatus = document.getElementById('page-status');
const statusDot = document.getElementById('status-dot');
const catalogNotice = document.getElementById('catalog-notice');
const catalogAge = document.getElementById('catalog-age');
const discoverList = document.getElementById('discover-list');
const installedList = document.getElementById('installed-list');
const updatesList = document.getElementById('updates-list');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const localFiles = document.getElementById('local-files');
const loadLocalButton = document.getElementById('load-local');
const developerNotice = document.getElementById('developer-notice');
const selectedFiles = document.getElementById('selected-files');
const developerEnabled = document.getElementById('developer-enabled');
const developerPanel = document.getElementById('developer-panel');
const userScriptsDialog = document.getElementById('user-scripts-dialog');
const logActivity = document.getElementById('developer-log-activity');
const logKind = document.getElementById('developer-log-kind');
const logLevel = document.getElementById('developer-log-level');
const logOutput = document.getElementById('developer-log-output');
const logPause = document.getElementById('developer-pause-logs');
const logStatus = document.getElementById('developer-log-status');
const clearLogsButton = document.getElementById('developer-clear-logs');

let catalog = null;
let installed = [];
let pendingLocalPackage = null;
let localSelectionRevision = 0;
let userScriptsAvailable = false;
let nextPermissionStep = '';
let libraryDiagnostics = { grantedOrigins: [], finalPresenceIntent: null };
let developerSnapshot = null;
let developerActivityOptions = '';
let libraryRefreshRevision = 0;
let pendingServicePolicy = null;
let serviceSelectionRevision = 0;
let lookupServices = [];
const installedSettingsScroll = new Map();

function rememberInstalledSettingsScroll() {
  if (document.getElementById('installed-view').hidden) return;
  for (const card of installedList.children) {
    const slot = card.querySelector('.card-settings-slot');
    if (slot) installedSettingsScroll.set(card.dataset.activityId, slot.scrollTop);
  }
}

function restoreInstalledSettingsScroll() {
  for (const card of installedList.children) {
    const slot = card.querySelector('.card-settings-slot');
    if (slot) slot.scrollTop = installedSettingsScroll.get(card.dataset.activityId) || 0;
  }
}

function renderDeveloperConsole({ force = false, capture = false } = {}) {
  if (!developerEnabled.checked) return;
  const options = installed.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const optionsKey = JSON.stringify(options);
  if (optionsKey !== developerActivityOptions) {
    const selected = logActivity.value;
    logActivity.replaceChildren(new Option('All Activities', ''));
    for (const { id, name } of options) logActivity.add(new Option(name, id));
    logActivity.value = options.some(({ id }) => id === selected) ? selected : '';
    developerActivityOptions = optionsKey;
  }
  const selected = installed.find(({ id }) => id === logActivity.value);
  clearLogsButton.textContent = selected ? `Clear ${selected.name} history` : 'Clear all history';
  logLevel.disabled = !['all', 'logs'].includes(logKind.value);
  const held = document.activeElement === logOutput;
  document.getElementById('developer-log-update').textContent = logPause.checked
    ? 'Updates paused. New diagnostics continue to collect.'
    : held ? 'Text focused · updates held for selection.' : 'Live · updates every 3 seconds.';
  if (!force && developerSnapshot && (logPause.checked || held)) return;
  if (!developerSnapshot || capture || (!logPause.checked && !held)) {
    developerSnapshot = { records: structuredClone(installed), ...structuredClone(libraryDiagnostics) };
  }
  const filters = { activityId: logActivity.value, kind: logKind.value, level: logLevel.value };
  const text = formatDeveloperDiagnostics(developerSnapshot.records, { ...developerSnapshot, ...filters });
  if (text !== logOutput.value) {
    const scrollTop = logOutput.scrollTop;
    logOutput.value = text;
    logOutput.scrollTop = scrollTop;
  }
  const count = diagnosticEntryCount(developerSnapshot.records, filters);
  document.getElementById('developer-log-count').textContent = logKind.value === 'snapshots'
    ? `${count} ${count === 1 ? 'Activity' : 'Activities'}` : `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

function logFeedback(message, error = false) {
  logStatus.textContent = message;
  logStatus.classList.toggle('error', error);
}

function selectDeveloperLogs() {
  logOutput.focus();
  logOutput.select();
  renderDeveloperConsole();
}

async function copyDeveloperLogs() {
  const visibleText = logOutput.value;
  try {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(visibleText);
    logFeedback('Visible diagnostics copied.');
  } catch {
    selectDeveloperLogs();
    logFeedback('Use Ctrl+C to copy the selected diagnostics.', true);
  }
}

async function clearDeveloperLogs() {
  const id = logActivity.value;
  const name = installed.find((record) => record.id === id)?.name || 'all Activities';
  clearLogsButton.disabled = true;
  let cleared = false;
  try {
    const result = await extensionMessage({ type: 'ACTIVITY_CLEAR_DIAGNOSTICS', ...(id ? { id } : {}) });
    cleared = true;
    libraryRefreshRevision += 1;
    await refreshInstalled();
    renderDeveloperConsole({ force: true, capture: true });
    const pending = result.pendingNetworkRequests || 0;
    logFeedback(`History cleared for ${name}.${pending ? ` ${pending} network request${pending === 1 ? ' is' : 's are'} still running.` : ''}`);
  } catch (error) {
    logFeedback(cleared ? `History cleared, but the view could not refresh: ${error.message}`
      : error.message || 'Could not clear diagnostic history.', true);
  } finally {
    clearLogsButton.disabled = false;
  }
}

function showActivityLogs(id) {
  logActivity.value = id;
  showView('developer');
  renderDeveloperConsole({ force: true, capture: !logPause.checked });
}

async function requestRepositoryPermission() {
  const origins = ['https://raw.githubusercontent.com/*', 'https://api.github.com/*'];
  return chrome.permissions.request({ origins });
}

function setHeaderStatus(message, type = '') {
  pageStatus.textContent = message;
  statusDot.className = type;
}

function setNotice(element, message, type = '') {
  element.textContent = message;
  element.className = `notice${type ? ` ${type}` : ''}`;
}

function showUserScriptsDialog() {
  if (!userScriptsDialog.open) userScriptsDialog.showModal();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function extensionMessage(message) {
  return api.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || 'ChudPresence could not complete that action.');
    return response.result;
  });
}

function installedById() {
  return new Map(installed.map((item) => [item.id, item]));
}

function sameActivitySource(entry, record) {
  if ((record.apiVersion || 1) !== entry.apiVersion) return false;
  const repository = repositoryForActivityApiVersion(entry.apiVersion);
  const name = entry.catalogSource?.repository || (repository ? `${repository.owner}/${repository.name}` : '');
  return record.source?.type === 'bundled' ? entry.apiVersion === 1
    : record.source?.type === 'repository' && record.source.repository === name;
}

function formatVersion(version) {
  return `v${version}`;
}

function compatibilityMessage(entry) {
  const currentVersion = api.runtime?.getManifest?.().version || '0.0.0';
  if (!isSupportedActivityApiVersion(entry.apiVersion)) return `Requires Activity API v${entry.apiVersion}`;
  if (entry.minExtensionVersion && compareActivityVersions(currentVersion, entry.minExtensionVersion) < 0) {
    return `Requires ChudPresence ${formatVersion(entry.minExtensionVersion)} or newer`;
  }
  return '';
}

function hostSummary(matches = []) {
  return matches.map((pattern) => {
    const match = pattern.match(/^https:\/\/([^/]+)/i);
    if (!match) return pattern;
    return match[1].startsWith('*.') ? `${match[1].slice(2)} and subdomains` : match[1];
  }).join(', ');
}

function refreshCounters() {
  const updateCount = catalog?.activities?.filter((entry) => {
    const record = installedById().get(entry.id);
    return !compatibilityMessage(entry) &&
      record && sameActivitySource(entry, record) &&
      compareActivityVersions(entry.version, record.version) > 0;
  }).length || 0;
  document.getElementById('installed-count').textContent = String(installed.length);
  document.getElementById('update-count').textContent = String(updateCount);
}

function appendEmpty(target, title, detail) {
  const empty = element('div', 'empty-state');
  empty.append(element('strong', '', title), element('span', '', detail));
  target.append(empty);
}

function actionButton(text, className, action, disabled = false) {
  const button = element('button', `button ${className}`, text);
  button.type = 'button';
  button.disabled = disabled;
  button.addEventListener('click', action);
  return button;
}

function cardIcon(entry) {
  const { icon } = entry;
  if (icon?.startsWith('data:image/png;base64,')) return icon;
  return repositoryActivityIconUrl(entry);
}

function baseCard({ id, name, description, category, version, matches, icon = '', local = false, apiVersion = 1, catalogSource }) {
  const card = element('article', 'activity-card');
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) card.classList.add(`activity-${id}`);
  const art = element('div', 'card-art');
  const artIcon = cardIcon({ id, icon, apiVersion, catalogSource });
  if (artIcon) {
    const watermark = element('img', 'card-watermark');
    watermark.src = artIcon;
    watermark.alt = '';
    watermark.addEventListener('error', () => watermark.remove());
    art.append(watermark);
  }
  const mark = element('span', 'activity-logo');
  if (artIcon) {
    const image = element('img', 'activity-logo-image');
    image.src = artIcon;
    image.alt = '';
    image.addEventListener('error', () => { image.remove(); mark.textContent = name?.charAt(0) || 'A'; });
    mark.append(image);
  } else {
    mark.textContent = name?.charAt(0) || 'A';
  }
  const categoryLabel = (category || 'other').replaceAll('-', ' ');
  const artBadge = element('span', 'badge category-badge', categoryLabel);
  art.append(mark, artBadge);
  const top = element('div', 'card-top');
  const identity = element('div', 'card-identity');
  const heading = element('h3', '', name);
    heading.title = name;
  identity.append(heading);
  const badge = element('span', `badge status-badge${local ? ' local' : ''}`, local ? 'Local' : '');
  if (!local) badge.hidden = true;
  top.append(identity, badge);
  const content = element('div', 'card-content');
  content.append(top, element('p', 'card-description', description || 'No description provided.'));
  const meta = element('div', 'card-meta');
  meta.append(element('span', '', formatVersion(version || '0.0.0')));
  meta.append(element('span', 'card-sites', hostSummary(matches)));
  content.append(meta);
  card.append(art, content);
  return { card, actions: element('div', 'card-actions') };
}

function renderDiscover() {
  const cards = [];
  const entries = catalog?.activities || [];
  const query = searchInput.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const filtered = entries.filter((entry) => {
    const matchesQuery = !query || [entry.name, entry.description, entry.id, entry.category,
      ...(entry.aliases || []), ...(entry.tags || [])]
      .some((value) => String(value || '').toLowerCase().includes(query));
    return matchesQuery && (category === 'all' || entry.category === category);
  });
  if (!filtered.length) {
    const empty = element('div');
    appendEmpty(empty, catalog ? 'No matching Activities' : 'Catalog not connected', catalog
      ? 'Try a different search or category.'
      : 'Use Refresh catalog to connect to the V1 and V2 Activities repositories.');
    discoverList.replaceChildren(...empty.children);
    return;
  }

  const installedMap = installedById();
  for (const entry of filtered) {
    const { card, actions } = baseCard(entry);
    const record = installedMap.get(entry.id);
    const compatibility = compatibilityMessage(entry);
    if (compatibility) {
      card.querySelector('.status-badge').textContent = compatibility;
      card.querySelector('.status-badge').className = 'badge status-badge issue';
      card.querySelector('.status-badge').hidden = false;
      card.querySelector('.card-description').textContent = `${entry.description} ${compatibility}.`;
      actions.append(actionButton('Unavailable', 'secondary', () => {}, true));
    } else if (!record) {
      actions.append(actionButton('Install', 'primary', () => installRepositoryActivity(entry)));
    } else if (!sameActivitySource(entry, record)) {
      card.querySelector('.status-badge').textContent = 'ID used by another source';
      card.querySelector('.status-badge').hidden = false;
      actions.append(actionButton('Remove installed Activity first', 'secondary', () => showView('installed'), true));
    } else if (sameActivitySource(entry, record) &&
        compareActivityVersions(entry.version, record.version) > 0) {
      actions.append(actionButton(`Update to ${formatVersion(entry.version)}`, 'primary', () => installRepositoryActivity(entry)));
    } else {
      actions.append(actionButton('Installed', 'secondary', () => showView('installed'), true));
    }
    card.append(actions);
    cards.push(card);
  }
  discoverList.replaceChildren(...cards);
}

function renderActivitySettings(record, card) {
  if (!record.settings?.length) return;
  const group = element('fieldset', 'activity-settings');
  group.append(element('legend', '', 'Activity settings'));
  const status = element('div', 'setting-status');
  for (const setting of record.settings) {
    const row = element('label', 'activity-setting');
    row.append(element('span', '', setting.label));
    let control;
    if (setting.type === 'boolean') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = record.settingValues?.[setting.id] ?? setting.default;
    } else if (setting.type === 'select') {
      control = document.createElement('select');
      for (const option of setting.options || []) {
        const choice = new Option(option.label, option.value);
        control.add(choice);
      }
      control.value = record.settingValues?.[setting.id] ?? setting.default;
    } else {
      control = document.createElement('input');
      control.type = setting.type === 'number' ? 'number' : setting.type;
      if (setting.type === 'number' || setting.type === 'range') {
        control.min = String(setting.min);
        control.max = String(setting.max);
        if (setting.step !== undefined) control.step = String(setting.step);
        const currentValue = record.settingValues?.[setting.id] ?? setting.default;
        control.value = String(currentValue);
        if (setting.type === 'range') {
          const output = element('output', 'setting-output', String(currentValue));
          control.addEventListener('input', () => { output.value = control.value; output.textContent = control.value; });
          row.append(output);
        }
      } else {
        control.type = 'text';
        control.maxLength = setting.maxLength ?? 256;
        control.value = record.settingValues?.[setting.id] ?? setting.default;
      }
    }
    control.setAttribute('aria-label', setting.label);
    control.addEventListener('change', async () => {
      const previous = record.settingValues?.[setting.id] ?? setting.default;
      const value = setting.type === 'boolean'
        ? control.checked
        : setting.type === 'number' || setting.type === 'range'
          ? Number(control.value)
          : control.value;
      control.disabled = true;
      status.textContent = '';
      let saved = false;
      try {
        const result = await extensionMessage({ type: 'ACTIVITY_SET_SETTING', id: record.id, settingId: setting.id, value });
        record.settingValues = { ...record.settingValues, [setting.id]: result.value ?? value };
        saved = true;
        await refreshInstalled();
      } catch (error) {
        if (!saved) {
          if (setting.type === 'boolean') control.checked = previous;
          else control.value = String(previous);
          const output = row.querySelector('output');
          if (output) { output.value = control.value; output.textContent = control.value; }
        }
        status.textContent = saved
          ? `Saved, but Activity state could not refresh: ${error.message}`
          : error.message || 'Could not save this setting.';
        setHeaderStatus(status.textContent, 'error');
      } finally {
        control.disabled = false;
      }
    });
    row.append(control);
    group.append(row);
  }
  group.append(status);
  card.append(group);
}

function renderInstalled() {
  rememberInstalledSettingsScroll();
  const active = document.activeElement;
  const focusedActivityId = active?.closest?.('.installed-activity-card')?.dataset.activityId;
  const focusedAction = ['activity-logs-action', 'activity-reload-action', 'activity-toggle-action', 'activity-remove-action']
    .find((className) => active?.matches?.(`.${className}`));
  const cards = [];
  for (const id of installedSettingsScroll.keys()) {
    if (!installed.some((record) => record.id === id)) installedSettingsScroll.delete(id);
  }
  if (!installed.length) {
    const empty = element('div');
    appendEmpty(empty, 'No Activities installed', 'Browse Discover or load a local Activity in Developer.');
    installedList.replaceChildren(...empty.children);
    return;
  }
  for (const record of installed) {
    const catalogEntry = catalog?.activities?.find((entry) => entry.id === record.id && sameActivitySource(entry, record));
    const { card, actions } = baseCard({
      ...record,
      icon: record.icon || catalogEntry?.icon || '',
      catalogSource: catalogEntry?.catalogSource,
      local: record.source?.type === 'local',
    });
    card.classList.add('installed-activity-card');
    card.classList.toggle('has-developer-actions', developerEnabled.checked);
    card.dataset.activityId = record.id;
    const statusText = {
      detected: 'Site detected',
      waiting: 'Waiting for site',
      disabled: 'Disabled',
      incompatible: record.compatibilityStatus || 'Requires newer ChudPresence',
      'permission-missing': 'Permission missing',
      error: 'Error',
    }[record.status] || 'Waiting for site';
    const badge = card.querySelector('.status-badge');
    badge.textContent = `${record.source?.type === 'local' ? 'Local · '
      : record.source?.type === 'bundled' ? 'Included · ' : ''}${statusText}`;
    badge.title = record.error || '';
    badge.className = `badge status-badge${record.status === 'detected' ? ' active' : ['incompatible', 'permission-missing', 'error'].includes(record.status) ? ' issue' : record.source?.type === 'local' ? ' local' : ''}`;
    badge.hidden = false;
    const settingsSlot = element('div', 'card-settings-slot');
    renderActivitySettings(record, settingsSlot);
    if (!record.settings?.length) {
      settingsSlot.classList.add('is-empty');
      settingsSlot.append(element('span', '', 'No additional settings'));
    }
    card.append(settingsSlot);
    if (developerEnabled.checked) {
      actions.append(actionButton('View logs', 'secondary activity-logs-action', () => showActivityLogs(record.id)));
      const reload = actionButton('Reload Activity', 'secondary activity-reload-action',
        () => reloadActivity(record), !record.enabled || Boolean(record.compatibilityStatus));
      reload.title = record.compatibilityStatus || (record.enabled ? 'Rerun this Activity' : 'Enable this Activity to reload it');
      actions.append(reload);
    }
    actions.append(actionButton(record.enabled ? 'Disable' : 'Enable', 'secondary activity-toggle-action', () => toggleActivity(record)));
    actions.append(actionButton('Remove', 'secondary remove activity-remove-action', () => removeActivity(record)));
    card.append(actions);
    cards.push(card);
  }
  // Attach the complete grid before scroll restoration triggers browser layout.
  // A partially attached grid can temporarily shorten the page and clamp scrollY.
  installedList.replaceChildren(...cards);
  restoreInstalledSettingsScroll();
  if (focusedAction && !document.getElementById('installed-view').hidden) {
    const card = cards.find((entry) => entry.dataset.activityId === focusedActivityId);
    const button = card?.querySelector(`.${focusedAction}`);
    const focusTarget = button?.disabled ? card.querySelector('.activity-toggle-action') : button;
    focusTarget?.focus({ preventScroll: true });
  }
}

function renderUpdates() {
  const cards = [];
  const entries = catalog?.activities || [];
  const installedMap = installedById();
  const pending = entries.filter((entry) => {
    const record = installedMap.get(entry.id);
    return !compatibilityMessage(entry) &&
      record && sameActivitySource(entry, record) &&
      compareActivityVersions(entry.version, record.version) > 0;
  });
  if (!pending.length) {
    const empty = element('div');
    appendEmpty(empty, 'You’re up to date', catalog
      ? 'No Activity updates are available.'
      : 'Refresh the catalog to check for updates.');
    updatesList.replaceChildren(...empty.children);
    return;
  }
  for (const entry of pending) {
    const record = installedMap.get(entry.id);
    const { card, actions } = baseCard(entry);
    card.querySelector('.card-description').textContent = `${entry.description} Installed ${formatVersion(record.version)} · latest ${formatVersion(entry.version)}.`;
    actions.append(actionButton(`Update to ${formatVersion(entry.version)}`, 'primary', () => installRepositoryActivity(entry)));
    card.append(actions);
    cards.push(card);
  }
  updatesList.replaceChildren(...cards);
}

function renderAll() {
  renderDiscover();
  renderInstalled();
  renderUpdates();
  refreshCounters();
  renderDeveloperConsole();
  renderLookupServices();
}

function renderLookupServices() {
  const list = document.getElementById('lookup-services-list');
  const cards = lookupServices.map((service) => {
    const card = document.createElement('p');
    const text = document.createElement('span');
    text.textContent = `${service.name} · ${service.endpoint} `;
    const remove = actionButton('Revoke service', 'secondary', async () => {
      try {
        await extensionMessage({ type: 'ACTIVITY_V2_SERVICE_REMOVE', id: service.id });
        await refreshInstalled();
        setNotice(document.getElementById('lookup-service-notice'), `${service.name} revoked.`, 'success');
      } catch (error) { setNotice(document.getElementById('lookup-service-notice'), error.message, 'error'); }
    });
    card.append(text, remove);
    return card;
  });
  if (!cards.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No lookup services approved. V2 Activities cannot send network requests.';
    cards.push(empty);
  }
  list.replaceChildren(...cards);
}

async function selectLookupService() {
  const revision = ++serviceSelectionRevision;
  const button = document.getElementById('lookup-service-review');
  const notice = document.getElementById('lookup-service-notice');
  pendingServicePolicy = null;
  button.disabled = true;
  const file = document.getElementById('lookup-service-file').files?.[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('Service policy exceeds 64 KB.');
    const source = await file.text();
    const policy = validateV2ServicePolicy(source);
    const digest = await v2ServiceDigest(policy);
    if (revision !== serviceSelectionRevision) return;
    pendingServicePolicy = { policy, digest, sourceName: file.name };
    button.disabled = false;
    setNotice(notice, `${policy.name} ready for review. Approving this policy authorizes its destination.`);
  } catch (error) { if (revision === serviceSelectionRevision) setNotice(notice, error.message, 'error'); }
}

function reviewLookupService() {
  if (!pendingServicePolicy) return;
  const staged = structuredClone(pendingServicePolicy);
  let active = true;
  const dialog = document.getElementById('lookup-service-dialog');
  const approve = document.getElementById('lookup-service-approve');
  const cancel = document.getElementById('lookup-service-cancel');
  const token = document.getElementById('lookup-service-token');
  const notice = document.getElementById('lookup-service-notice');
  document.getElementById('lookup-service-summary').textContent = `Selected file: ${staged.sourceName}\n\n${describeV2ServicePolicy(staged.policy)}\n\nPolicy digest: ${staged.digest}`;
  document.getElementById('lookup-service-token-label').hidden = staged.policy.auth !== 'bearer';
  token.value = '';
  approve.disabled = false;
  const finish = () => {
    active = false;
    approve.removeEventListener('click', accept);
    cancel.removeEventListener('click', finish);
    dialog.removeEventListener('cancel', finish);
    token.value = '';
    dialog.close();
  };
  const accept = async () => {
    approve.disabled = true;
    const approvalToken = token.value;
    try {
      const origins = [...new Set([staged.policy.endpoint, ...Object.values(staged.policy.outputs)
        .filter((rule) => rule.baseUrl).map((rule) => rule.baseUrl)].map((url) => `${new URL(url).origin}/*`))];
      if (!await requestHostPermissions(origins, api)) throw new Error('Service origin permission was not granted.');
      if (!active) return;
      await extensionMessage({ type: 'ACTIVITY_V2_SERVICE_APPROVE', policy: staged.policy, digest: staged.digest, token: approvalToken });
      setNotice(notice, `${staged.policy.name} approved for V2 lookups.`, 'success');
      finish();
      await refreshInstalled();
    } catch (error) { if (active) { setNotice(notice, error.message, 'error'); approve.disabled = false; } }
  };
  approve.addEventListener('click', accept);
  cancel.addEventListener('click', finish);
  dialog.addEventListener('cancel', finish);
  dialog.showModal();
}

function renderCategories() {
  const selected = categoryFilter.value;
  const categories = [...new Set((catalog?.activities || []).map((entry) => entry.category).filter(Boolean))].sort();
  categoryFilter.replaceChildren(new Option('All categories', 'all'));
  for (const value of categories) categoryFilter.add(new Option(value.replaceAll('-', ' '), value));
  categoryFilter.value = categories.includes(selected) ? selected : 'all';
}

function showView(view) {
  rememberInstalledSettingsScroll();
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('is-active', button.dataset.view === view);
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `${view}-view`;
  if (view === 'installed') restoreInstalledSettingsScroll();
}

function describeCatalog(cached, fetchedAt) {
  if (fetchedAt) {
    const date = new Date(fetchedAt);
    catalogAge.textContent = `${cached ? 'Cached' : 'Updated'} · ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  } else {
    catalogAge.textContent = '';
  }
}

async function refreshInstalled({ polling = false } = {}) {
  const revision = ++libraryRefreshRevision;
  const state = await extensionMessage({ type: 'ACTIVITY_LIBRARY_STATE' });
  if (revision !== libraryRefreshRevision) return;
  if (polling && document.activeElement?.closest('.activity-settings')) return;
  installed = state.installed || [];
  lookupServices = state.lookupServices || [];
  libraryDiagnostics = {
    grantedOrigins: state.grantedOrigins || [],
    finalPresenceIntent: state.finalPresenceIntent || null,
  };
  userScriptsAvailable = state.userScriptsPermission === true;
  setHeaderStatus(
    nextPermissionStep || (state.userScriptsPermission
      ? `${installed.length} installed · Ready`
      : 'Allow User Scripts in Chrome settings'),
    state.userScriptsPermission ? 'on' : 'error',
  );
  renderAll();
}

async function refreshCatalog() {
  const button = document.getElementById('refresh-catalog');
  button.disabled = true;
  try {
    setNotice(catalogNotice, 'Requesting access to the ChudPresence V1 and V2 Activities catalogs…');
    const granted = await requestRepositoryPermission(api);
    if (!granted) throw new Error('Catalog access was not granted. You can keep using cached or local Activities.');
    const result = await fetchCatalog({ force: true });
    catalog = result.catalog;
    describeCatalog(result.fromCache, result.fetchedAt);
    renderCategories();
    setNotice(catalogNotice, `Loaded ${catalog.activities.length} Activities from the V1 and V2 repositories.${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`, result.warnings?.length ? 'error' : 'success');
    await refreshInstalled();
  } catch (error) {
    const cached = await readCatalogCache().catch(() => ({ catalog: null, fetchedAt: 0 }));
    catalog = cached.catalog;
    describeCatalog(Boolean(catalog), cached.fetchedAt);
    renderCategories();
    if (catalog) {
      setNotice(catalogNotice, `Could not refresh the repository. Showing the cached catalog. ${error.message}`, 'error');
    } else {
      setNotice(catalogNotice, `${error.message} Local Activity loading remains available in Developer.`, 'error');
    }
    renderAll();
  } finally {
    button.disabled = false;
  }
}

async function ensureActivityPermissions(matches, noticeElement = catalogNotice) {
  if (!userScriptsAvailable || !api.userScripts?.execute) {
    const message = 'Activity scripts are unavailable. In Chrome 138 or newer, open this extension’s details and turn on Allow User Scripts, then reload this page.';
    if (noticeElement) setNotice(noticeElement, message, 'error');
    showUserScriptsDialog();
    throw new Error(message);
  }
  nextPermissionStep = '';
  const hostsAllowed = await requestHostPermissions(matches, api);
  if (!hostsAllowed) throw new Error('The Activity’s declared site or network access was not granted. It was not installed.');
  return true;
}

async function installPackage(activityPackage) {
  if (activityPackage.metadata.apiVersion === 2) {
    if (!await approveV2Package(activityPackage, developerNotice)) return null;
  } else if (!await ensureActivityPermissions(
    [...activityPackage.metadata.matches, ...(activityPackage.metadata.network || [])],
    developerNotice,
  )) return null;
  const result = await extensionMessage({ type: 'ACTIVITY_INSTALL', activityPackage });
  await refreshInstalled();
  return result;
}

async function approveV2Package(activityPackage, noticeElement = catalogNotice) {
  const dialog = document.getElementById('v2-approval-dialog');
  const approve = document.getElementById('approve-v2');
  const decline = document.getElementById('decline-v2');
  document.getElementById('v2-access-summary').textContent = describeActivityV2(activityPackage.metadata, activityPackage.source);
  document.getElementById('v2-approval-title').textContent = `Review ${activityPackage.metadata.name} ${formatVersion(activityPackage.metadata.version)}`;
  // Hash the staged bytes before showing the approval control. Installation
  // verifies this again and persists the exact configuration approval.
  const digest = await activityV2Digest(activityPackage);
  const sourceLabel = activityPackage.sourceType === 'repository' ? activityPackage.provenance?.repository : 'User-selected local files';
  document.getElementById('v2-access-summary').textContent = `Source: ${sourceLabel}\n\n${describeActivityV2(activityPackage.metadata, activityPackage.source)}\n\nPackage digest: ${digest}`;
  approve.disabled = false;
  dialog.showModal();
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      approve.removeEventListener('click', accept);
      decline.removeEventListener('click', cancel);
      dialog.removeEventListener('cancel', cancel);
    };
    const cancel = () => { settled = true; cleanup(); dialog.close(); resolve(false); };
    const accept = async () => {
      approve.disabled = true;
      try {
        // This call starts directly in the approval button's user gesture.
        await ensureActivityPermissions(activityPackage.metadata.matches, noticeElement);
        if (settled) return;
        activityPackage.approval = { digest };
        cleanup(); dialog.close(); resolve(true);
      } catch (error) {
        setNotice(noticeElement, error.message, 'error');
        cleanup(); dialog.close(); resolve(false);
      }
    };
    approve.addEventListener('click', accept);
    decline.addEventListener('click', cancel);
    dialog.addEventListener('cancel', cancel);
  });
}

async function installRepositoryActivity(entry) {
  try {
    const compatibility = compatibilityMessage(entry);
    if (compatibility) throw new Error(compatibility);
    // Request declared site access from this click before downloading the package.
    if (entry.apiVersion !== 2 && !await ensureActivityPermissions([
      ...entry.matches,
      ...(entry.network || []),
    ])) return;
    setHeaderStatus(`Downloading ${entry.name}…`);
    let activityPackage;
    try {
      activityPackage = await downloadActivity(entry.id, catalog);
    } catch (error) {
      if (error.code !== 'catalog_metadata_mismatch') throw error;
      const previousOrigins = [...entry.matches, ...(entry.network || [])].sort();
      const refreshed = await fetchCatalog({ force: true });
      catalog = refreshed.catalog;
      describeCatalog(refreshed.fromCache, refreshed.fetchedAt);
      renderCategories();
      renderAll();
      const updatedEntry = catalog.activities.find((item) => item.id === entry.id);
      if (!updatedEntry) throw new Error(`${entry.name} is no longer in the catalog.`);
      if (updatedEntry.apiVersion !== entry.apiVersion || updatedEntry.catalogSource?.repository !== entry.catalogSource?.repository) {
        throw new Error('The Activity source changed. Review the updated catalog entry and install again.');
      }
      const updatedOrigins = [...updatedEntry.matches, ...(updatedEntry.network || [])].sort();
      if (JSON.stringify(previousOrigins) !== JSON.stringify(updatedOrigins)) {
        throw new Error('The Activity permissions changed. Review the updated catalog entry and install again.');
      }
      const updatedCompatibility = compatibilityMessage(updatedEntry);
      if (updatedCompatibility) throw new Error(updatedCompatibility);
      activityPackage = await downloadActivity(entry.id, catalog);
    }
    if (activityPackage.metadata.apiVersion === 2 && !await approveV2Package(activityPackage)) return;
    const result = await extensionMessage({
      type: 'ACTIVITY_INSTALL',
      activityPackage: { ...activityPackage, sourceType: 'repository' },
    });
    setNotice(catalogNotice, `${result.name} ${formatVersion(result.version)} installed.`, 'success');
    await refreshInstalled();
    showView('installed');
  } catch (error) {
    setNotice(catalogNotice, error.message, 'error');
    setHeaderStatus('Activity installation failed', 'error');
  }
}

async function toggleActivity(record) {
  try {
    if (!record.enabled && !await ensureActivityPermissions([
      ...record.matches,
      ...(record.network || []),
    ], null)) return;
    await extensionMessage({ type: 'ACTIVITY_SET_ENABLED', id: record.id, enabled: !record.enabled });
    await refreshInstalled();
  } catch (error) {
    setHeaderStatus(error.message, 'error');
  }
}

async function removeActivity(record) {
  try {
    await extensionMessage({ type: 'ACTIVITY_REMOVE', id: record.id });
    await refreshInstalled();
  } catch (error) {
    setHeaderStatus(error.message, 'error');
  }
}

async function reloadActivity(record) {
  try {
    const result = await extensionMessage({ type: 'ACTIVITY_RELOAD', id: record.id });
    await refreshInstalled();
    setHeaderStatus(`${record.name} reloaded in ${result.reloadedFrames} active frame${result.reloadedFrames === 1 ? '' : 's'}.`, 'on');
  } catch (error) {
    setHeaderStatus(error.message || 'Could not reload this Activity.', 'error');
  }
}

function filesForLocalPackage() {
  const files = [...(localFiles.files || [])];
  return {
    metadataFile: files.find((file) => file.name === 'metadata.json'),
    sourceFile: files.find((file) => file.name === 'activity.js'),
    configurationFile: files.find((file) => file.name === 'activity.json'),
    iconFile: files.find((file) => file.name === 'icon.png'),
  };
}

async function readActivityIcon(file) {
  if (!file) return '';
  if (file.size > MAX_ACTIVITY_ICON_BYTES) throw new Error('Activity icon exceeds the 256 KB size limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return validateActivityIcon(`data:image/png;base64,${btoa(binary)}`);
}

async function updateSelectedFiles() {
  const revision = ++localSelectionRevision;
  const { metadataFile, sourceFile, configurationFile, iconFile } = filesForLocalPackage();
  pendingLocalPackage = null;
  loadLocalButton.disabled = true;
  loadLocalButton.textContent = 'Load local Activity';
  if (!metadataFile || (!sourceFile && !configurationFile)) {
    selectedFiles.textContent = 'Choose metadata.json and activity.json (V2) or activity.js (trusted V1) together.';
    return;
  }
  try {
    const metadataText = await metadataFile.text();
    const metadata = validateActivityMetadata(JSON.parse(metadataText));
    if (metadata.apiVersion === 2 && sourceFile) throw new Error('V2 packages cannot include activity.js.');
    const entryFile = metadata.apiVersion === 2 ? configurationFile : sourceFile;
    if (!entryFile) throw new Error(`Choose the declared ${metadata.entry} file.`);
    const [source, icon] = await Promise.all([entryFile.text(), readActivityIcon(iconFile)]);
    if (revision !== localSelectionRevision) return;
    validateActivityPackageSource(source, metadata);
    if (Boolean(metadata.icon) !== Boolean(icon)) {
      throw new Error('Choose icon.png when metadata.json declares an icon, and include the metadata field when using an icon.');
    }
    pendingLocalPackage = { metadata, source, ...(metadata.apiVersion === 2 ? { metadataSource: metadataText } : {}), ...(icon ? { icon: `data:image/png;base64,${icon}` } : {}), sourceType: 'local' };
    selectedFiles.textContent = `${metadata.name} ${formatVersion(metadata.version)} ready to load.`;
    loadLocalButton.textContent = metadata.apiVersion === 1 ? 'Run trusted V1 JavaScript' : 'Review V2 Activity';
    loadLocalButton.disabled = false;
  } catch (error) {
    if (revision !== localSelectionRevision) return;
    selectedFiles.textContent = error.message || 'Those files are not a valid Activity package.';
  }
}

async function loadLocalActivity() {
  loadLocalButton.disabled = true;
  try {
    if (!pendingLocalPackage) throw new Error('Select and validate metadata.json and its declared entry file first.');
    const { metadata } = pendingLocalPackage;
    if (metadata.apiVersion === 1) pendingLocalPackage.trustedLocalV1 = true;
    if (!await installPackage(pendingLocalPackage)) return;
    setNotice(developerNotice, `${metadata.name} ${formatVersion(metadata.version)} loaded locally.`, 'success');
    showView('installed');
  } catch (error) {
    setNotice(developerNotice, error.message || 'Could not load this Activity.', 'error');
  } finally {
    loadLocalButton.disabled = !pendingLocalPackage;
  }
}

async function initialize() {
  for (const button of document.querySelectorAll('.tab')) {
    button.addEventListener('click', () => showView(button.dataset.view));
  }
  document.getElementById('refresh-catalog').addEventListener('click', refreshCatalog);
  document.getElementById('close-user-scripts-dialog').addEventListener('click', () => userScriptsDialog.close());
  document.getElementById('open-extension-details').addEventListener('click', async () => {
    try {
      await api.tabs.create({ url: `chrome://extensions/?id=${encodeURIComponent(api.runtime.id)}` });
    } catch {
      setNotice(
        developerNotice,
        'Chrome could not open extension settings automatically. Open chrome://extensions, choose this extension’s Details, and turn on Allow User Scripts.',
        'error',
      );
      userScriptsDialog.close();
    }
  });
  searchInput.addEventListener('input', renderDiscover);
  categoryFilter.addEventListener('change', renderDiscover);
  localFiles.addEventListener('change', updateSelectedFiles);
  loadLocalButton.addEventListener('click', loadLocalActivity);
  document.getElementById('lookup-service-file').addEventListener('change', selectLookupService);
  document.getElementById('lookup-service-review').addEventListener('click', reviewLookupService);
  developerEnabled.addEventListener('change', async () => {
    developerPanel.hidden = !developerEnabled.checked;
    renderAll();
    await api.storage.local.set({ developerMode: developerEnabled.checked });
  });
  for (const control of [logActivity, logKind, logLevel]) {
    control.addEventListener('change', () => renderDeveloperConsole({ force: true }));
  }
  logPause.addEventListener('change', () => renderDeveloperConsole({ force: true, capture: !logPause.checked }));
  logOutput.addEventListener('focus', () => renderDeveloperConsole());
  logOutput.addEventListener('blur', () => renderDeveloperConsole());
  document.getElementById('developer-copy-logs').addEventListener('click', copyDeveloperLogs);
  document.getElementById('developer-select-logs').addEventListener('click', selectDeveloperLogs);
  clearLogsButton.addEventListener('click', clearDeveloperLogs);

  const [cache, localSettings] = await Promise.all([
    readCatalogCache().catch(() => ({ catalog: null, fetchedAt: 0 })),
    api.storage.local.get('developerMode').catch(() => ({})),
  ]);
  catalog = cache.catalog;
  describeCatalog(Boolean(catalog), cache.fetchedAt);
  developerEnabled.checked = localSettings.developerMode === true;
  developerPanel.hidden = !developerEnabled.checked;
  renderCategories();
  await refreshInstalled().catch((error) => setHeaderStatus(error.message, 'error'));
  setInterval(() => {
    const editingSetting = document.activeElement?.closest('.activity-settings');
    if (!document.hidden && !editingSetting && !clearLogsButton.disabled) {
      refreshInstalled({ polling: true }).catch(() => {});
    }
  }, 3000);
  renderAll();
  if (catalog) {
    setNotice(catalogNotice, cache.warnings?.join(' ') || '', cache.warnings?.length ? 'error' : '');
  } else {
    setNotice(catalogNotice, 'Connect to the V1 and V2 Activities catalogs, or load an Activity locally in Developer.');
  }
  const requestedView = new URL(location.href).searchParams.get('view');
  if (['discover', 'installed', 'updates', 'developer'].includes(requestedView)) showView(requestedView);
}

initialize().catch((error) => setHeaderStatus(error.message || 'Activity Library could not start.', 'error'));
