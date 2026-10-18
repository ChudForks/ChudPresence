import { activityCatalogIconUrl, compareActivityVersions, downloadActivity, fetchCatalog, readCatalogCache } from './core/activity-repository.js';
import { requestHostPermissions } from './core/activity-permissions.js';
import { diagnosticEntryCount, formatDeveloperDiagnostics } from './core/developer-diagnostics.js';
import { isFirefox, USER_SCRIPTS_REQUIRED, USER_SCRIPTS_UNAVAILABLE, configureUserScriptsDialog, openUserScriptsSettings } from './platform/browser-api.js';
import {
  MAX_ACTIVITY_ICON_BYTES,
  validateActivityIcon,
  validateActivityMetadata,
  validateActivitySource,
  isSupportedActivityApiVersion,
} from './core/activity-validator.js';

const api = globalThis.browser || globalThis.chrome;
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
const inspector = document.getElementById('activity-inspector');
const inspectorContent = document.getElementById('inspector-content');
const libraryLayout = document.getElementById('library-layout');

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
let currentView = 'discover';
const selectedActivities = new Map();
const inspectorDisclosures = new Map();
const pendingQuickActions = new Set();
let inspectorRenderKey = '';
let renderedInspectorId = '';
let discoverRenderKey = '';
let installedRenderKey = '';
let updatesRenderKey = '';

function visibleList() {
  return { discover: discoverList, installed: installedList, updates: updatesList }[currentView];
}

function activityRows(target = visibleList()) {
  return [...(target?.children || [])].filter((row) => row.dataset.activityId);
}

function rememberInspectorDisclosure() {
  if (!renderedInspectorId) return;
  const access = inspectorContent.querySelector('.card-page-access');
  if (access) inspectorDisclosures.set(renderedInspectorId, {
    open: access.open,
    scrollTop: access.querySelector('.page-access-list')?.scrollTop || 0,
  });
}

function updateRowSelection() {
  for (const list of [discoverList, installedList, updatesList]) {
    for (const row of activityRows(list)) {
      const selected = list === visibleList() && row.dataset.activityId === selectedActivities.get(currentView);
      row.classList.toggle('is-selected', selected);
      const button = row.querySelector('.activity-select');
      button.setAttribute('aria-pressed', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }
}

function selectActivity(id, { open = false } = {}) {
  rememberInspectorDisclosure();
  selectedActivities.set(currentView, id);
  updateRowSelection();
  renderInspector();
  if (open) {
    setInspectorOpen(true);
    focusInspector();
  }
}

function setInspectorOpen(open) {
  inspector.classList.toggle('is-open', open);
  inspector.hidden = !open;
  document.getElementById('catalog-region').hidden = open;
}

function closeInspector() {
  setInspectorOpen(false);
  const target = activityRows().find((row) => row.dataset.activityId === selectedActivities.get(currentView))?.querySelector('.activity-select')
    || document.getElementById(`tab-${currentView}`);
  target?.focus();
}

function focusInspector() {
  inspector.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  inspectorContent.querySelector('.inspector-name')?.focus({ preventScroll: true });
}

function settingControl(id) {
  for (const row of inspectorContent.querySelectorAll('.activity-setting')) {
    const control = row.querySelector('input') || row.querySelector('select');
    if (control?.dataset.settingId === id) return control;
  }
  return null;
}

function syncSelection() {
  const rows = activityRows();
  const selected = selectedActivities.get(currentView);
  if (rows.length && !rows.some((row) => row.dataset.activityId === selected)) {
    selectedActivities.set(currentView, rows[0].dataset.activityId);
  }
  updateRowSelection();
  renderInspector();
}

function replaceActivityRows(target, rows) {
  const active = document.activeElement;
  const focusedRow = active?.closest?.('.activity-row');
  const focusedId = focusedRow?.dataset.activityId;
  const focusedQuickAction = active?.matches?.('.activity-quick-action');
  const focusedIndex = activityRows(target).indexOf(focusedRow);
  target.replaceChildren(...rows);
  if (target === visibleList() && focusedId) {
    const row = rows.find((row) => row.dataset.activityId === focusedId)
      || (focusedQuickAction ? rows[Math.min(focusedIndex, rows.length - 1)] : null);
    const quickAction = focusedQuickAction && row?.querySelector('.activity-quick-action');
    if (quickAction?.disabled && quickAction.getAttribute('aria-busy') === 'true') return;
    (quickAction && !quickAction.disabled ? quickAction : row?.querySelector('.activity-select'))?.focus({ preventScroll: true });
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

async function requestRepositoryPermission({ automatic = false } = {}) {
  const origins = ['https://raw.githubusercontent.com/*', 'https://api.github.com/*'];
  return automatic ? api.permissions.contains({ origins }) : api.permissions.request({ origins });
}

function setLibraryStatus(message, type = '') {
  const feedback = document.getElementById('library-feedback');
  feedback.hidden = type !== 'error' && !nextPermissionStep;
  setNotice(feedback, feedback.hidden ? '' : message, type === 'error' ? 'error' : '');
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

function refreshCounters() {
  const installedMap = installedById();
  const updateCount = catalog?.activities?.filter((entry) => {
    const record = installedMap.get(entry.id);
    return !compatibilityMessage(entry) &&
      ['repository', 'bundled'].includes(record?.source?.type) &&
      compareActivityVersions(entry.version, record.version) > 0;
  }).length || 0;
  document.getElementById('discover-count').textContent = String(catalog?.activities?.length || 0);
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
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const hadFocus = document.activeElement === button;
    const quickId = button.classList.contains('activity-quick-action')
      ? button.closest('.activity-row')?.dataset.activityId : null;
    const actionView = currentView;
    const rowIndex = quickId ? activityRows().findIndex((row) => row.dataset.activityId === quickId) : -1;
    // Invoke the action before awaiting so browser permission requests retain
    // the original user gesture.
    const pending = action();
    if (!pending?.then) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Working…';
    try {
      await pending;
    } finally {
      button.disabled = disabled;
      button.setAttribute('aria-busy', 'false');
      button.textContent = text;
      // Native browsers blur a disabled button. After its card is refreshed,
      // restore quick-action focus unless the user has moved elsewhere.
      if (hadFocus && quickId && currentView === actionView && !inspector.classList.contains('is-open')
          && (!document.activeElement || document.activeElement === document.body || document.activeElement === button)) {
        const rows = activityRows();
        const row = rows.find((row) => row.dataset.activityId === quickId) || rows[Math.min(rowIndex, rows.length - 1)];
        const quickAction = row?.querySelector('.activity-quick-action');
        const target = quickAction && !quickAction.disabled ? quickAction : row?.querySelector('.activity-select')
          || document.getElementById(`tab-${currentView}`);
        target?.focus({ preventScroll: true });
      }
    }
  });
  return button;
}

function cardIcon(id, icon, catalogSource) {
  if (icon?.startsWith('data:image/png;base64,')) return icon;
  return activityCatalogIconUrl({ id, icon, catalogSource });
}

function activityLogo(entry) {
  const mark = element('span', 'activity-logo');
  mark.dataset.category = entry.category || 'other';
  const icon = cardIcon(entry.id, entry.icon, entry.catalogSource);
  if (icon) {
    const image = element('img', 'activity-logo-image');
    image.src = icon;
    image.alt = '';
    image.addEventListener('error', () => { image.remove(); mark.textContent = entry.name?.charAt(0) || 'A'; });
    mark.append(image);
  } else mark.textContent = entry.name?.charAt(0) || 'A';
  return mark;
}

function activityState(record) {
  if (!record) return 'Not installed';
  const status = {
    detected: 'Site detected', waiting: 'Waiting for site', disabled: 'Disabled',
    incompatible: record.compatibilityStatus || 'Requires newer ChudPresence',
    'permission-missing': 'Permission missing', error: 'Error',
  }[record.status] || (record.enabled === false ? 'Disabled' : 'Waiting for site');
  return status;
}

function stateClass(record) {
  return record?.status === 'detected' ? ' active'
    : ['incompatible', 'permission-missing', 'error'].includes(record?.status) ? ' issue' : '';
}

function activityRow(entry, state, className = '') {
  const row = element('article', 'activity-row');
  row.dataset.activityId = entry.id;
  const button = element('button', 'activity-select');
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-controls', 'inspector-content');
  button.tabIndex = -1;
  const content = element('span', 'row-content');
  const category = element('span', 'card-category', (entry.category || 'other').replaceAll('-', ' '));
  const name = element('span', 'row-title', entry.name);
  name.title = entry.name;
  const description = element('span', 'row-description', entry.description || 'No description provided.');
  const meta = element('span', 'row-meta');
  meta.append(category, element('span', 'row-version', formatVersion(entry.version || '0.0.0')),
    element('span', '', `API v${entry.apiVersion || 1}`));
  content.append(name, description, meta);
  button.append(activityLogo(entry), content);
  button.addEventListener('click', () => selectActivity(entry.id, { open: true }));
  button.addEventListener('keydown', (event) => {
    const rows = activityRows();
    const index = rows.indexOf(row);
    const next = ['ArrowDown', 'ArrowRight'].includes(event.key) ? Math.min(index + 1, rows.length - 1)
      : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectActivity(rows[next].dataset.activityId);
    rows[next].querySelector('.activity-select').focus({ preventScroll: true });
    rows[next].scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  });
  const footer = element('div', 'card-footer');
  const actions = element('div', 'card-actions');
  const details = element('button', 'row-open', 'Details');
  details.type = 'button';
  details.tabIndex = -1; // The main card button already provides keyboard access to details.
  details.setAttribute('aria-label', `Details for ${entry.name}`);
  details.addEventListener('click', () => selectActivity(entry.id, { open: true }));
  const record = installed.find(({ id }) => id === entry.id);
  const compatibility = record ? '' : compatibilityMessage(entry);
  const quickAction = actionButton(record ? 'Remove' : 'Add',
    `activity-quick-action ${record ? 'quick-remove' : 'quick-add'}`, async () => {
      if (pendingQuickActions.has(entry.id)) return;
      pendingQuickActions.add(entry.id);
      selectActivity(entry.id);
      try {
        if (record) await removeActivity(record, { stayInView: true });
        else await installRepositoryActivity(entry, { stayInView: true });
      } finally {
        pendingQuickActions.delete(entry.id);
        renderAll();
      }
    }, Boolean(compatibility) || pendingQuickActions.has(entry.id));
  if (pendingQuickActions.has(entry.id)) {
    quickAction.textContent = 'Working…';
    quickAction.setAttribute('aria-busy', 'true');
  }
  quickAction.setAttribute('aria-label', `${record ? 'Remove' : 'Add'} ${entry.name}`);
  quickAction.title = compatibility || `${record ? 'Remove' : 'Add'} ${entry.name}`;
  actions.append(details, quickAction);
  footer.append(element('span', 'row-state' + className, state), actions);
  row.append(button, footer);
  return row;
}

function appendPageAccess(content, pageAccess) {
  const access = element('details', 'card-page-access');
  access.append(element('summary', '', 'Declared page access'));
  const descriptions = [];
  if (pageAccess?.url) descriptions.push('Page origin and path');
  if (pageAccess?.media) descriptions.push('Media playback and visibility');
  if (pageAccess?.queryParameters?.length) descriptions.push(`Query parameters: ${pageAccess.queryParameters.join(', ')}`);
  for (const [name, capture] of Object.entries(pageAccess?.selectors || {})) {
    descriptions.push(`${name}: ${capture.read}${capture.attribute ? ' ' + capture.attribute : ''}${capture.path ? ' at ' + capture.path.join('.') : ''} from ${capture.selector}${capture.all ? ' (all matches)' : ''}`);
  }
  for (const [name, scope] of Object.entries(pageAccess?.mediaScopes || {})) {
    descriptions.push(`${name}: single-player container ${scope.container}, up to ${scope.ancestors} ancestors${scope.exclude ? ', stop at ' + scope.exclude : ''}`);
    for (const [field, capture] of Object.entries(scope.selectors || {})) {
      descriptions.push(`${name}.${field}: ${capture.read}${capture.attribute ? ' ' + capture.attribute : ''} from ${capture.selector}`);
    }
  }
  if (descriptions.length) {
    const list = element('ul', 'page-access-list');
    for (const description of descriptions) list.append(element('li', '', description));
    access.append(list);
  } else access.append(element('p', '', 'No page reads'));
  content.append(access);
}

function inspectorSection(title) {
  const section = element('section', 'inspector-section');
  section.append(element('h3', '', title));
  return section;
}

function renderInspector() {
  const id = selectedActivities.get(currentView);
  const record = installed.find((entry) => entry.id === id);
  const catalogEntry = catalog?.activities?.find((entry) => entry.id === id);
  const entry = currentView === 'installed' ? record : catalogEntry;
  const hasRow = activityRows().some((row) => row.dataset.activityId === id);
  const data = entry && hasRow ? {
    ...entry, icon: entry.icon || catalogEntry?.icon || '', catalogSource: catalogEntry?.catalogSource,
  } : null;
  // Diagnostics change every few seconds. Keep settings, disclosures and focused
  // actions intact unless the selected Activity's visible information changes.
  const metadataKey = JSON.stringify([currentView, data && [
    data.id, data.name, data.description, data.category, data.version, data.apiVersion,
    data.matches, data.network, data.pageAccess, data.minExtensionVersion, data.icon, data.catalogSource,
  ], record && [record.version, record.apiVersion, record.matches, record.network, record.enabled, record.status, record.source, record.error,
    record.compatibilityStatus, record.settings, record.settingValues], developerEnabled.checked]);
  if (metadataKey === inspectorRenderKey) return;
  rememberInspectorDisclosure();
  inspectorRenderKey = metadataKey;
  const active = document.activeElement;
  const sameActivity = renderedInspectorId === currentView + ':' + id;
  const focusClass = sameActivity && ['activity-logs-action', 'activity-reload-action', 'activity-toggle-action',
    'activity-remove-action', 'activity-install-action'].find((name) => active?.matches?.('.' + name));
  const focusSummary = sameActivity && active?.matches?.('summary') && active.closest('.activity-detail');
  const focusName = sameActivity && active?.matches?.('.inspector-name');
  const focusedSetting = sameActivity && active?.closest?.('.activity-settings') ? active.dataset.settingId : null;
  const selection = focusedSetting && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd] : null;
  const scrollTop = inspector.scrollTop;
  if (!data) {
    renderedInspectorId = '';
    const empty = element('div', 'inspector-empty');
    empty.append(element('h2', '', 'Select an Activity'),
      element('p', '', 'Its details, access requirements, and controls appear here.'));
    inspectorContent.replaceChildren(empty);
    return;
  }
  renderedInspectorId = currentView + ':' + id;
  const detail = element('article', 'activity-detail');
  detail.dataset.activityId = id;
  const overview = element('div', 'detail-overview');
  const introduction = element('div', 'detail-introduction');
  const columns = element('div', 'detail-columns');
  const configuration = element('div', 'detail-configuration');
  const identity = element('div', 'inspector-identity');
  const name = element('h2', 'inspector-name', data.name);
  name.tabIndex = -1;
  const title = element('div');
  title.append(name, element('span', 'inspector-category', (data.category || 'other').replaceAll('-', ' ')));
  identity.append(activityLogo(data), title);
  introduction.append(identity, element('p', 'inspector-description', data.description || 'No description provided.'),
    element('div', 'inspector-state' + stateClass(record), record ? 'Installed · ' + activityState(record) : 'Available to install'));
  const actions = element('div', 'inspector-actions');
  const compatibility = compatibilityMessage(data);
  const canUpdate = record && currentView !== 'installed' && ['repository', 'bundled'].includes(record.source?.type)
    && compareActivityVersions(data.version, record.version) > 0;
  if (!record || canUpdate) {
    actions.append(actionButton(compatibility ? 'Unavailable' : canUpdate ? 'Update to ' + formatVersion(data.version) : 'Install Activity',
      'primary activity-install-action', () => installRepositoryActivity(data), Boolean(compatibility)));
  }
  if (record) {
    actions.append(actionButton(record.enabled ? 'Disable' : 'Enable', 'secondary activity-toggle-action', () => toggleActivity(record)),
      actionButton('Remove', 'secondary remove activity-remove-action', () => removeActivity(record)));
    if (developerEnabled.checked) {
      actions.append(actionButton('View logs', 'secondary activity-logs-action', () => showActivityLogs(record.id)));
      const reload = actionButton('Reload Activity', 'secondary activity-reload-action', () => reloadActivity(record),
        !record.enabled || Boolean(record.compatibilityStatus));
      reload.title = record.compatibilityStatus || (record.enabled ? 'Rerun this Activity' : 'Enable this Activity to reload it');
      actions.append(reload);
    }
  }
  overview.append(introduction, actions);
  detail.append(overview);
  if (compatibility || record?.error || record?.compatibilityStatus) {
    detail.append(element('p', 'notice error', compatibility || record.error || record.compatibilityStatus));
  }
  if (record) renderActivitySettings(record, configuration);
  const information = inspectorSection('Package details');
  const metadata = element('dl', 'inspector-metadata');
  const fields = [
    [currentView === 'installed' ? 'Version' : 'Catalog version', formatVersion(data.version || '0.0.0')],
    ...(record && currentView !== 'installed' ? [['Installed', formatVersion(record.version)]] : []),
    ['Activity API', data.apiVersion === 2 ? 'v2 · Sandboxed' : !data.apiVersion || data.apiVersion === 1 ? 'v1 · Trusted code' : `v${data.apiVersion} · Unsupported`],
    ['Source', currentView === 'installed' && record.source?.type === 'local' ? 'Local package'
      : currentView === 'installed' && record.source?.type === 'bundled' ? 'Included with extension'
        : (currentView === 'installed' ? record.source?.repository : data.catalogSource?.repository) || 'ChudPresence repository'],
    ['Identifier', data.id],
    ...(data.minExtensionVersion ? [['Requires', 'ChudPresence ' + formatVersion(data.minExtensionVersion)]] : []),
  ];
  for (const [label, value] of fields) metadata.append(element('dt', '', label),
    element('dd', ['Version', 'Catalog version', 'Installed', 'Identifier'].includes(label) ? 'version-value' : '', value));
  information.append(metadata);
  configuration.append(information);
  const websites = inspectorSection('Supported websites');
  const sites = element('ul', 'inspector-sites');
  for (const match of data.matches || []) sites.append(element('li', '', match));
  websites.append(sites);
  configuration.append(websites);
  const access = inspectorSection('Access & privacy');
  if (record && currentView !== 'installed' && (record.version !== data.version || record.apiVersion !== data.apiVersion)) {
    access.append(element('p', 'access-explanation', 'The access below applies to catalog ' + formatVersion(data.version) + '. Select this Activity in Installed to review the installed package.'));
  }
  const trusted = !data.apiVersion || data.apiVersion === 1;
  access.append(element('span', 'trust-label', data.apiVersion === 2 ? 'Sandboxed Activity' : trusted ? 'Trusted Activity code' : 'Unsupported Activity API'),
    element('p', 'access-explanation', data.apiVersion === 2
      ? 'Runs in a sandbox. Page reads are limited to the fields declared below, on websites you approve.'
      : trusted ? 'Runs as trusted JavaScript on approved websites. V1 code can read page content and does not have V2’s sandbox or declared page-read restrictions.'
        : 'This Activity API is not supported by this extension version. Update ChudPresence before reviewing and installing this package.'));
  if (data.apiVersion === 2) appendPageAccess(access, data.pageAccess);
  const network = element('p', 'access-explanation', data.network?.length
    ? 'Additional network access is requested for these declared origins:' : 'No additional network origins declared.');
  access.append(network);
  if (data.network?.length) {
    const origins = element('ul', 'inspector-sites');
    for (const origin of data.network) origins.append(element('li', '', origin));
    access.append(origins);
  }
  access.append(element('p', 'access-explanation', 'Installation and enabling request browser access to the declared websites and network origins. Activity reports are checked before becoming Discord Rich Presence.'));
  columns.append(configuration, access);
  detail.append(columns);
  const disclosure = detail.querySelector('.card-page-access');
  const previous = inspectorDisclosures.get(renderedInspectorId);
  if (disclosure && previous) disclosure.open = previous.open;
  inspectorContent.replaceChildren(detail);
  if (disclosure && previous) {
    const list = disclosure.querySelector('.page-access-list');
    if (list) list.scrollTop = previous.scrollTop;
  }
  inspector.scrollTop = sameActivity ? scrollTop : 0;
  if (focusName) name.focus({ preventScroll: true });
  if (focusedSetting) {
    const control = settingControl(focusedSetting);
    control?.focus({ preventScroll: true });
    if (selection && control?.type === 'text') control.setSelectionRange(...selection);
  }
  if (focusSummary) disclosure?.querySelector('summary')?.focus({ preventScroll: true });
  if (focusClass) {
    const button = detail.querySelector('.' + focusClass);
    (button?.disabled ? detail.querySelector('.activity-toggle-action') : button)?.focus({ preventScroll: true });
  }
}

function renderDiscover() {
  const entries = catalog?.activities || [];
  const query = searchInput.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const filtered = entries.filter((entry) => {
    const matchesQuery = !query || [entry.name, entry.description, entry.id, entry.category, entry.serviceUrl,
      ...(entry.matches || []),
      ...(entry.aliases || []), ...(entry.tags || [])]
      .some((value) => String(value || '').toLowerCase().includes(query));
    return matchesQuery && (category === 'all' || entry.category === category);
  });
  document.getElementById('discover-results').textContent = filtered.length + (filtered.length === 1 ? ' activity' : ' activities');
  const installedMap = installedById();
  const renderKey = JSON.stringify([Boolean(catalog), filtered.map((entry) => {
    const record = installedMap.get(entry.id);
    return [entry, Boolean(record), record?.version, record?.source?.type, record?.enabled, record?.status, compatibilityMessage(entry), pendingQuickActions.has(entry.id)];
  })]);
  if (renderKey !== discoverRenderKey) {
    discoverRenderKey = renderKey;
    const rows = filtered.map((entry) => {
      const record = installedMap.get(entry.id);
      const compatibility = compatibilityMessage(entry);
      const update = record && ['repository', 'bundled'].includes(record.source?.type) && compareActivityVersions(entry.version, record.version) > 0;
      return activityRow(entry, compatibility ? 'Unavailable' : update ? 'Update available' : record ? 'Installed' : 'Available',
        compatibility ? ' issue' : update ? ' update' : !record ? ' available' : '');
    });
    if (!rows.length) {
      const empty = element('div');
      appendEmpty(empty, catalog ? 'No matching Activities' : 'Catalog not connected', catalog
        ? 'Try a different search or category.' : 'Use Refresh catalog to connect to the ChudPresence V1 and V2 repositories.');
      rows.push(...empty.children);
    }
    replaceActivityRows(discoverList, rows);
  }
  if (currentView === 'discover') syncSelection();
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
    control.dataset.settingId = setting.id;
    control.addEventListener('change', async () => {
      const hadFocus = document.activeElement === control;
      const selection = control.type === 'text' ? [control.selectionStart, control.selectionEnd] : null;
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
        setLibraryStatus(status.textContent, 'error');
      } finally {
        control.disabled = false;
        // Disabling a saving input can move native browser focus to the body.
        // Restore it after replacement, unless the user moved to another field.
        if (hadFocus && (!document.activeElement || document.activeElement === document.body || document.activeElement === control)) {
          const target = settingControl(setting.id);
          target?.focus({ preventScroll: true });
          if (selection && target?.type === 'text') target.setSelectionRange(...selection);
        }
      }
    });
    row.append(control);
    group.append(row);
  }
  group.append(status);
  card.append(group);
}

function renderInstalled() {
  const entries = installed.map((record) => {
    const catalogEntry = catalog?.activities?.find((entry) => entry.id === record.id);
    return { ...record, icon: record.icon || catalogEntry?.icon || '', catalogSource: catalogEntry?.catalogSource };
  });
  const key = JSON.stringify(entries.map((entry) => [entry.id, entry.name, entry.description, entry.category,
    entry.version, entry.apiVersion, entry.icon, entry.catalogSource, entry.enabled, entry.status, entry.error, entry.source?.type, pendingQuickActions.has(entry.id)]));
  if (key !== installedRenderKey) {
    installedRenderKey = key;
    const rows = entries.map((entry) => activityRow(entry,
      (entry.source?.type === 'local' ? 'Local · ' : entry.source?.type === 'bundled' ? 'Included · ' : '') + activityState(entry), stateClass(entry)));
    if (!rows.length) {
      const empty = element('div');
      appendEmpty(empty, 'No Activities installed', 'Browse Discover or load a local Activity in Developer.');
      rows.push(...empty.children);
    }
    replaceActivityRows(installedList, rows);
  }
}

function renderUpdates() {
  const installedMap = installedById();
  const pending = (catalog?.activities || []).filter((entry) => {
    const record = installedMap.get(entry.id);
    return !compatibilityMessage(entry) && ['repository', 'bundled'].includes(record?.source?.type)
      && compareActivityVersions(entry.version, record.version) > 0;
  });
  const key = JSON.stringify([Boolean(catalog), pending.map((entry) => [entry, installedMap.get(entry.id).version, pendingQuickActions.has(entry.id)])]);
  if (key === updatesRenderKey) return;
  updatesRenderKey = key;
  const rows = pending.map((entry) => activityRow(entry, 'Update to ' + formatVersion(entry.version), ' update'));
  if (!rows.length) {
    const empty = element('div');
    appendEmpty(empty, catalog ? 'You’re up to date' : 'Check for updates', catalog
      ? 'No Activity updates are available.' : 'Refresh the catalog to check for updates.');
    rows.push(...empty.children);
  }
  replaceActivityRows(updatesList, rows);
}

function renderAll() {
  renderDiscover();
  renderInstalled();
  renderUpdates();
  syncSelection();
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
  rememberInspectorDisclosure();
  currentView = view;
  for (const button of document.querySelectorAll('.tab')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `${view}-view`;
  libraryLayout.classList.toggle('is-developer', view === 'developer');
  setInspectorOpen(false);
  syncSelection();
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
  setLibraryStatus(
    nextPermissionStep || (state.userScriptsPermission ? '' : USER_SCRIPTS_REQUIRED),
    state.userScriptsPermission ? 'on' : 'error',
  );
  renderAll();
}

async function refreshCatalog({ automatic = false } = {}) {
  const button = document.getElementById('refresh-catalog');
  if (button.disabled) return;
  button.disabled = true;
  try {
    setNotice(catalogNotice, automatic ? 'Refreshing the Activities catalog…' : 'Requesting access to the ChudPresence Activities catalog…');
    // Opening a page cannot prompt for optional permissions. The manual button
    // remains the user gesture for connecting the catalog for the first time.
    const granted = await requestRepositoryPermission({ automatic });
    if (!granted && automatic) {
      setNotice(catalogNotice, 'Use Refresh catalog to allow catalog access and connect to the ChudPresence Activities repositories.');
      return;
    }
    if (!granted) throw new Error('Catalog access was not granted. You can keep using cached or local Activities.');
    const result = await fetchCatalog({ force: true });
    catalog = result.catalog;
    describeCatalog(false, result.fetchedAt);
    renderCategories();
    const warnings = result.warnings || [];
    setNotice(catalogNotice, warnings.length
      ? `Loaded ${catalog.activities.length} Activities. ${warnings.join(' ')}`
      : automatic ? '' : `Loaded ${catalog.activities.length} Activities from the ChudPresence V1 and V2 repositories.`, warnings.length ? 'error' : 'success');
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
  if (isFirefox) {
    if (!userScriptsAvailable) {
      // Firefox marks userScripts as optional-only, so request it by itself.
      const scriptsGranted = await api.permissions.request({ permissions: ['userScripts'] });
      if (!scriptsGranted) throw new Error('The Firefox User Scripts permission was not granted.');
      if (typeof api.userScripts?.execute !== 'function') throw new Error(USER_SCRIPTS_UNAVAILABLE);
      userScriptsAvailable = true;
      nextPermissionStep = 'User Scripts allowed · click the action again to approve site access';
      await refreshInstalled();
      const message = 'Firefox granted User Scripts access. Click the action again to approve this Activity’s site/network access and continue.';
      if (noticeElement) setNotice(noticeElement, message, 'success');
      else setLibraryStatus(message, 'on');
      return false;
    }

    // Request the Activity's declared site and network origins separately.
    nextPermissionStep = '';
    const hostsAllowed = await requestHostPermissions(matches, api);
    if (!hostsAllowed) throw new Error('The Activity’s declared site or network access was not granted. It was not installed.');
    return true;
  }
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

async function installRepositoryActivity(entry, { stayInView = false } = {}) {
  try {
    const compatibility = compatibilityMessage(entry);
    if (compatibility) throw new Error(compatibility);
    // Request declared site access from this click before downloading the package.
    if (!await ensureActivityPermissions([
      ...entry.matches,
      ...(entry.network || []),
    ])) return;
    setNotice(catalogNotice, `Downloading ${entry.name}…`);
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
    if (stayInView) return;
    selectedActivities.set('installed', entry.id);
    showView('installed');
    setInspectorOpen(true);
    focusInspector();
  } catch (error) {
    setNotice(catalogNotice, error.message, 'error');
    setLibraryStatus('Activity installation failed', 'error');
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
    setLibraryStatus(error.message, 'error');
  }
}

async function removeActivity(record, { stayInView = false } = {}) {
  try {
    await extensionMessage({ type: 'ACTIVITY_REMOVE', id: record.id });
    await refreshInstalled();
    if (stayInView) {
      setNotice(catalogNotice, `${record.name} removed.`, 'success');
      if (!activityRows().length) document.getElementById(`tab-${currentView}`)?.focus({ preventScroll: true });
      return;
    }
    if (inspector.classList.contains('is-open') && activityRows().length) {
      focusInspector();
      return;
    }
    setInspectorOpen(false);
    const target = activityRows().find((row) => row.dataset.activityId === selectedActivities.get(currentView))?.querySelector('.activity-select')
      || document.getElementById(`tab-${currentView}`);
    target.focus({ preventScroll: true });
  } catch (error) {
    setLibraryStatus(error.message, 'error');
  }
}

async function reloadActivity(record) {
  try {
    const result = await extensionMessage({ type: 'ACTIVITY_RELOAD', id: record.id });
    await refreshInstalled();
    setNotice(catalogNotice, `${record.name} reloaded in ${result.reloadedFrames} active frame${result.reloadedFrames === 1 ? '' : 's'}.`, 'success');
  } catch (error) {
    setLibraryStatus(error.message || 'Could not reload this Activity.', 'error');
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
    selectedActivities.set('installed', metadata.id);
    showView('installed');
    setInspectorOpen(true);
    focusInspector();
  } catch (error) {
    setNotice(developerNotice, error.message || 'Could not load this Activity.', 'error');
  } finally {
    loadLocalButton.disabled = !pendingLocalPackage;
  }
}

async function initialize() {
  configureUserScriptsDialog(document);
  const tabs = [...document.querySelectorAll('.tab')];
  for (const button of tabs) {
    button.addEventListener('click', () => showView(button.dataset.view));
    button.addEventListener('keydown', (event) => {
      const current = tabs.indexOf(button);
      const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (current + 1) % tabs.length
        : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (current + tabs.length - 1) % tabs.length
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
      const granted = await openUserScriptsSettings(api);
      if (isFirefox) {
        if (!granted) throw new Error('Firefox did not grant the User Scripts permission.');
        userScriptsDialog.close();
        await refreshInstalled();
      }
    } catch {
      setNotice(
        developerNotice,
        isFirefox ? USER_SCRIPTS_UNAVAILABLE : 'Chrome could not open extension settings automatically. Open chrome://extensions, choose this extension’s Details, and turn on Allow User Scripts.',
        'error',
      );
      userScriptsDialog.close();
    }
  });
  document.getElementById('inspector-close').addEventListener('click', closeInspector);
  inspector.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !userScriptsDialog.open) {
      event.preventDefault();
      closeInspector();
    }
  });
  for (const layout of ['grid', 'list']) {
    document.getElementById(`layout-${layout}`).addEventListener('click', () => {
      libraryLayout.classList.toggle('is-list', layout === 'list');
      for (const choice of ['grid', 'list']) {
        const button = document.getElementById(`layout-${choice}`);
        button.setAttribute('aria-pressed', String(choice === layout));
        button.classList.toggle('is-active', choice === layout);
      }
    });
  }
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
  await refreshInstalled().catch((error) => setLibraryStatus(error.message, 'error'));
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
    setNotice(catalogNotice, 'Connect to the ChudPresence V1 and V2 catalogs, or load an Activity locally in Developer.');
  }
  const requestedView = new URL(location.href).searchParams.get('view');
  if (['discover', 'installed', 'updates', 'developer'].includes(requestedView)) showView(requestedView);
  await refreshCatalog({ automatic: true });
}

initialize().catch((error) => setLibraryStatus(error.message || 'Activity Library could not start.', 'error'));
