import { ACTIVITY_REPOSITORY, compareActivityVersions, downloadActivity, fetchCatalog, readCatalogCache } from './core/activity-repository.js';
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
const installedSettingsScroll = new Map();
const disclosureStates = new WeakMap();
let discoverRenderKey = '';
let installedRenderKey = '';
let updatesRenderKey = '';

function replaceLibraryCards(target, cards) {
  const states = disclosureStates.get(target) || new Map();
  const active = document.activeElement;
  const focusedCard = active?.matches?.('summary') && active.closest('.activity-card');
  const focusedId = focusedCard && [...target.children].includes(focusedCard) ? focusedCard.dataset.activityId : null;
  for (const card of target.children) {
    const disclosure = card.querySelector('.card-page-access');
    if (disclosure) states.set(card.dataset.activityId, {
      open: disclosure.open,
      scrollTop: disclosure.querySelector('.page-access-list')?.scrollTop || 0,
    });
  }
  for (const card of cards) {
    const disclosure = card.querySelector('.card-page-access');
    if (disclosure && states.has(card.dataset.activityId)) disclosure.open = states.get(card.dataset.activityId).open;
  }
  disclosureStates.set(target, states);
  // Restore disclosures before attaching the complete grid so layout never sees
  // a temporarily collapsed page that could clamp the reader's scroll position.
  target.replaceChildren(...cards);
  for (const card of cards) {
    const list = card.querySelector('.page-access-list');
    if (list) list.scrollTop = states.get(card.dataset.activityId)?.scrollTop || 0;
  }
  if (focusedId) cards.find((card) => card.dataset.activityId === focusedId)?.querySelector('summary')?.focus({ preventScroll: true });
}

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
      ['repository', 'bundled'].includes(record?.source?.type) &&
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

function repositoryCardIcon(id, icon) {
  if (typeof id !== 'string' || typeof icon !== 'string') return '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || icon !== `activities/${id}/icon.png`) return '';
  return `${ACTIVITY_REPOSITORY.baseUrl}${icon}`;
}

function cardIcon(id, icon) {
  if (icon?.startsWith('data:image/png;base64,')) return icon;
  return repositoryCardIcon(id, icon);
}

function baseCard({ id, name, description, category, version, matches, apiVersion = 1, pageAccess, icon = '', local = false }) {
  const card = element('article', 'activity-card');
  card.dataset.activityId = id;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) card.classList.add(`activity-${id}`);
  const art = element('div', 'card-art');
  const artIcon = cardIcon(id, icon);
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
  meta.append(element('span', 'card-api', apiVersion === 2 ? 'API v2 · Sandboxed' : 'API v1 · Trusted code'));
  meta.append(element('span', 'card-sites', hostSummary(matches)));
  content.append(meta);
  if (apiVersion === 2) {
    const access = element('details', 'card-page-access');
    access.append(element('summary', '', 'Declared page access'));
    const descriptions = [];
    if (pageAccess?.url) descriptions.push('Page origin and path');
    if (pageAccess?.media) descriptions.push('Media playback and visibility');
    if (pageAccess?.queryParameters?.length) descriptions.push(`Query parameters: ${pageAccess.queryParameters.join(', ')}`);
    for (const [name, capture] of Object.entries(pageAccess?.selectors || {})) {
      descriptions.push(`${name}: ${capture.read} from ${capture.selector}`);
    }
    for (const [name, scope] of Object.entries(pageAccess?.mediaScopes || {})) {
      descriptions.push(`${name}: single-player container ${scope.container}, up to ${scope.ancestors} ancestors${scope.exclude ? `, stop at ${scope.exclude}` : ''}`);
      for (const [field, capture] of Object.entries(scope.selectors)) {
        descriptions.push(`${name}.${field}: ${capture.read}${capture.attribute ? ` ${capture.attribute}` : ''} from ${capture.selector}`);
      }
    }
    if (descriptions.length) {
      const list = element('ul', 'page-access-list');
      for (const description of descriptions) list.append(element('li', '', description));
      access.append(list);
    } else {
      access.append(element('p', '', 'No page reads'));
    }
    content.append(access);
  }
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
  const installedMap = installedById();
  const renderKey = JSON.stringify([Boolean(catalog), filtered.map((entry) => {
    const record = installedMap.get(entry.id);
    return [entry, Boolean(record), record?.version, record?.source?.type, compatibilityMessage(entry)];
  })]);
  if (renderKey === discoverRenderKey) return;
  discoverRenderKey = renderKey;
  if (!filtered.length) {
    const empty = element('div');
    appendEmpty(empty, catalog ? 'No matching Activities' : 'Catalog not connected', catalog
      ? 'Try a different search or category.'
      : 'Use Refresh catalog to connect to ChudForks/ChudPresence-Activities.');
    replaceLibraryCards(discoverList, [...empty.children]);
    return;
  }

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
    } else if (['repository', 'bundled'].includes(record.source?.type) &&
        compareActivityVersions(entry.version, record.version) > 0) {
      actions.append(actionButton(`Update to ${formatVersion(entry.version)}`, 'primary', () => installRepositoryActivity(entry)));
    } else {
      actions.append(actionButton('Installed', 'secondary', () => showView('installed'), true));
    }
    card.append(actions);
    cards.push(card);
  }
  replaceLibraryCards(discoverList, cards);
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
      const currentRecord = installed.find(({ id }) => id === record.id) || record;
      const previous = currentRecord.settingValues?.[setting.id] ?? setting.default;
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
        record.settingValues = { ...currentRecord.settingValues, [setting.id]: result.value ?? value };
        currentRecord.settingValues = record.settingValues;
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
  // Live diagnostics change frequently, but only these fields affect a card or
  // its actions. Keep the existing DOM while the visible library is unchanged.
  const renderKey = JSON.stringify([developerEnabled.checked, installed.map((record) => [
    record.id, record.name, record.description, record.category, record.version,
    record.matches, record.apiVersion, record.pageAccess, record.network,
    record.icon || catalog?.activities?.find((entry) => entry.id === record.id)?.icon,
    record.source?.type, record.enabled, record.status, record.compatibilityStatus,
    record.error, record.settings, record.settingValues,
  ])]);
  if (renderKey === installedRenderKey) return;
  installedRenderKey = renderKey;
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
    replaceLibraryCards(installedList, [...empty.children]);
    return;
  }
  for (const record of installed) {
    const catalogIcon = catalog?.activities?.find((entry) => entry.id === record.id)?.icon || '';
    const { card, actions } = baseCard({
      ...record,
      icon: record.icon || catalogIcon,
      local: record.source?.type === 'local',
    });
    card.classList.add('installed-activity-card');
    card.classList.toggle('has-developer-actions', developerEnabled.checked);
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
  replaceLibraryCards(installedList, cards);
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
      ['repository', 'bundled'].includes(record?.source?.type) &&
      compareActivityVersions(entry.version, record.version) > 0;
  });
  const renderKey = JSON.stringify([Boolean(catalog), pending.map((entry) => [entry, installedMap.get(entry.id).version])]);
  if (renderKey === updatesRenderKey) return;
  updatesRenderKey = renderKey;
  if (!pending.length) {
    const empty = element('div');
    appendEmpty(empty, 'You’re up to date', catalog
      ? 'No Activity updates are available.'
      : 'Refresh the catalog to check for updates.');
    replaceLibraryCards(updatesList, [...empty.children]);
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
  replaceLibraryCards(updatesList, cards);
}

function renderAll() {
  renderDiscover();
  renderInstalled();
  renderUpdates();
  refreshCounters();
  renderDeveloperConsole();
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
  for (const button of document.querySelectorAll('.tab')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
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
    setNotice(catalogNotice, 'Requesting access to the ChudPresence Activities catalog…');
    const granted = await requestRepositoryPermission(api);
    if (!granted) throw new Error('Catalog access was not granted. You can keep using cached or local Activities.');
    const result = await fetchCatalog({ force: true });
    catalog = result.catalog;
    describeCatalog(false, result.fetchedAt);
    renderCategories();
    setNotice(catalogNotice, `Loaded ${catalog.activities.length} Activities from ChudForks/ChudPresence-Activities.`, 'success');
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
  if (!await ensureActivityPermissions(
    [...activityPackage.metadata.matches, ...(activityPackage.metadata.network || [])],
    developerNotice,
  )) return null;
  const result = await extensionMessage({ type: 'ACTIVITY_INSTALL', activityPackage });
  await refreshInstalled();
  return result;
}

async function installRepositoryActivity(entry) {
  try {
    const compatibility = compatibilityMessage(entry);
    if (compatibility) throw new Error(compatibility);
    // Request declared site access from this click before downloading the package.
    if (!await ensureActivityPermissions([
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
      describeCatalog(false, refreshed.fetchedAt);
      renderCategories();
      renderAll();
      const updatedEntry = catalog.activities.find((item) => item.id === entry.id);
      if (!updatedEntry) throw new Error(`${entry.name} is no longer in the catalog.`);
      const updatedOrigins = [...updatedEntry.matches, ...(updatedEntry.network || [])].sort();
      if (JSON.stringify(previousOrigins) !== JSON.stringify(updatedOrigins)) {
        throw new Error('The Activity permissions changed. Review the updated catalog entry and install again.');
      }
      const updatedCompatibility = compatibilityMessage(updatedEntry);
      if (updatedCompatibility) throw new Error(updatedCompatibility);
      activityPackage = await downloadActivity(entry.id, catalog);
    }
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
  const { metadataFile, sourceFile, iconFile } = filesForLocalPackage();
  pendingLocalPackage = null;
  loadLocalButton.disabled = true;
  if (!metadataFile || !sourceFile) {
    selectedFiles.textContent = 'Choose metadata.json and activity.js together.';
    return;
  }
  try {
    const [metadataText, source, icon] = await Promise.all([
      metadataFile.text(), sourceFile.text(), readActivityIcon(iconFile),
    ]);
    if (revision !== localSelectionRevision) return;
    const metadata = validateActivityMetadata(JSON.parse(metadataText));
    validateActivitySource(source);
    if (Boolean(metadata.icon) !== Boolean(icon)) {
      throw new Error('Choose icon.png when metadata.json declares an icon, and include the metadata field when using an icon.');
    }
    pendingLocalPackage = { metadata, source, ...(icon ? { icon: `data:image/png;base64,${icon}` } : {}), sourceType: 'local' };
    selectedFiles.textContent = `${metadata.name} ${formatVersion(metadata.version)} ready to load.`;
    loadLocalButton.disabled = false;
  } catch (error) {
    if (revision !== localSelectionRevision) return;
    selectedFiles.textContent = error.message || 'Those files are not a valid Activity package.';
  }
}

async function loadLocalActivity() {
  loadLocalButton.disabled = true;
  try {
    if (!pendingLocalPackage) throw new Error('Select and validate metadata.json and activity.js first.');
    const { metadata } = pendingLocalPackage;
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
  const tabs = [...document.querySelectorAll('.tab')];
  for (const button of tabs) {
    button.addEventListener('click', () => showView(button.dataset.view));
    button.addEventListener('keydown', (event) => {
      const current = tabs.indexOf(button);
      const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      showView(tabs[next].dataset.view);
      tabs[next].focus({ preventScroll: true });
      tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
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
    setNotice(catalogNotice, '');
  } else {
    setNotice(catalogNotice, 'Connect to the ChudForks/ChudPresence-Activities catalog, or load an Activity locally in Developer.');
  }
  const requestedView = new URL(location.href).searchParams.get('view');
  if (['discover', 'installed', 'updates', 'developer'].includes(requestedView)) showView(requestedView);
}

initialize().catch((error) => setHeaderStatus(error.message || 'Activity Library could not start.', 'error'));
