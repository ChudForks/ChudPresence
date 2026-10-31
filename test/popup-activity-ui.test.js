import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { DEFAULT_ACTIVITY_PREFERENCES } from '../extension/core/activity-settings.js';
import { DEFAULT_SETTINGS } from '../extension/core/settings.js';
import { DEFAULT_ACTIVITY_PRIORITY_RULES, normalizeActivityPriorityRules } from '../extension/core/activity-priority.js';
import { createPopupPriorityEditor } from '../extension/popup-priority.js';
import { createPopupLink } from '../extension/popup-link.js';

class FakeClassList {
  constructor(element) { this.element = element; }
  values() { return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean)); }
  add(value) { const values = this.values(); values.add(value); this.element.className = [...values].join(' '); }
  remove(...items) { const values = this.values(); for (const value of items) values.delete(value); this.element.className = [...values].join(' '); }
  contains(value) { return this.values().has(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.contains(value) : Boolean(force);
    if (shouldAdd) this.add(value);
    else this.remove(value);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div', { id = '', className = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this._text = '';
    this._src = '';
    this.type = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.scrollTop = 0;
    this.onerror = null;
  }

  set src(value) { this._src = String(value); this.attributes.set('src', this._src); }
  get src() { return this._src; }
  set textContent(value) { this.replaceChildren(String(value ?? '')); }
  get textContent() { return this._text + this.children.map((child) => typeof child === 'string' ? child : child.textContent).join(''); }
  set innerHTML(value) { this.textContent = value; }

  append(...items) {
    for (const item of items) {
      if (typeof item === 'string') { this._text += item; continue; }
      item.remove?.();
      item.parentElement = this;
      this.children.push(item);
    }
  }
  appendChild(item) { this.append(item); return item; }
  replaceChildren(...items) { this.children = []; this._text = ''; this.append(...items); }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this._src = ''; }
  addEventListener(type, callback) {
    const entries = this.listeners.get(type) || [];
    entries.push(callback);
    this.listeners.set(type, entries);
  }
  async emit(type, event = {}) {
    const pending = (this.listeners.get(type) || []).map((listener) => listener({
      target: this,
      currentTarget: this,
      stopPropagation() {},
      ...event,
    }));
    await Promise.all(pending);
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() { this.wasScrolledIntoView = true; }
  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
  matches(selector) {
    if (selector === 'input') return this.tagName === 'INPUT';
    if (selector === 'select') return this.tagName === 'SELECT';
    if (selector === 'img') return this.tagName === 'IMG';
    if (selector === 'summary') return this.tagName === 'SUMMARY';
    if (selector === 'strong') return this.tagName === 'STRONG';
    const attr = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const key = attr[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      return Object.hasOwn(this.dataset, key) && (attr[2] === undefined || this.dataset[key] === attr[2]);
    }
    const service = selector.match(/^\.([\w-]+)\[data-service="([^"]+)"\]$/);
    if (service) return this.classList.contains(service[1]) && this.dataset.service === service[2];
    const openCard = selector.match(/^\.([\w-]+)\[open\]$/);
    if (openCard) return this.classList.contains(openCard[1]) && this.open;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  descendants() {
    return this.children.flatMap((child) => typeof child === 'string' ? [] : [child, ...child.descendants()]);
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const targetSelector = parts.at(-1);
    const ancestors = parts.slice(0, -1);
    return this.descendants().filter((candidate) => {
      if (!candidate.matches(targetSelector)) return false;
      let ancestor = candidate.parentElement;
      for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        while (ancestor && !ancestor.matches(ancestors[index])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  querySelector(selector) {
    if (this.parts && selector in this.parts) return this.parts[selector];
    return this.querySelectorAll(selector)[0] || null;
  }
}

function makeSettingsCard() {
  const card = new FakeElement('details', { className: 'service-settings-card' });
  const summary = new FakeElement('summary');
  const iconWrap = new FakeElement('span', { className: 'service-summary-icon' });
  const icon = new FakeElement('img');
  iconWrap.append(icon);
  const copy = new FakeElement('span', { className: 'setting-copy' });
  const name = new FakeElement('strong');
  const description = new FakeElement('small');
  copy.append(name, description);
  const masterWrap = new FakeElement('span', { className: 'toggle service-master' });
  const master = new FakeElement('input');
  master.type = 'checkbox';
  masterWrap.append(master);
  summary.append(iconWrap, copy, masterWrap);

  const options = new FakeElement('div', { className: 'service-options' });
  const controls = {};
  for (const [setting, tag] of [['paused', 'input'], ['status', 'select'], ['artwork', 'input'], ['timestamps', 'input'], ['buttons', 'input']]) {
    const row = new FakeElement('label', { className: 'compact-row' });
    const labelCopy = new FakeElement('span');
    const label = new FakeElement('strong');
    label.textContent = setting === 'status' ? 'Status text' : setting;
    labelCopy.append(label);
    const controlWrap = new FakeElement('span', { className: 'toggle compact' });
    const control = new FakeElement(tag);
    if (tag === 'input') control.type = 'checkbox';
    control.dataset.setting = setting;
    controlWrap.append(control);
    row.append(labelCopy, controlWrap);
    options.append(row);
    controls[`[data-setting="${setting}"]`] = control;
    controls[`row-${setting}`] = row;
  }
  card.append(summary, options);
  card.parts = {
    '.service-summary-icon img': icon,
    '.setting-copy strong': name,
    '.setting-copy small': description,
    '.service-master input': master,
    ...Object.fromEntries(Object.entries(controls).filter(([key]) => key.startsWith('[data-setting='))),
    '.compact-row': controls['row-paused'],
    summary,
  };
  return card;
}

function createPopupDocument(html) {
  const elements = new Map();
  for (const id of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id[1], new FakeElement('div', { id: id[1] }));
  const body = new FakeElement('body');
  body.dataset = { view: 'activity' };
  const activityView = elements.get('activity-view');
  const settingsView = elements.get('settings-view');
  const serviceGrid = new FakeElement('div', { className: 'service-grid' });
  elements.set('service-grid', serviceGrid);
  activityView.append(serviceGrid);
  const priorityCard = elements.get('priority-card');
  priorityCard.className = 'priority-card';
  priorityCard.append(...['priority-list', 'priority-add', 'priority-reset', 'priority-retry', 'priority-status'].map(id => elements.get(id)));
  const form = elements.get('settings-form');
  form.append(priorityCard);
  const enabled = new FakeElement('input');
  enabled.id = 'enabled';
  enabled.name = 'enabled';
  enabled.type = 'checkbox';
  form.append(enabled);
  const activitySettings = elements.get('activity-settings');
  const activitySection = elements.get('activity-settings-section');
  form.append(activitySection);
  activitySection.append(activitySettings);
  settingsView.append(form);
  const linkView = elements.get('link-view');
  linkView.append(...['link-pair-form', 'link-paired-actions', 'link-services-section', 'link-feedback'].map(id => elements.get(id)));
  body.append(activityView, settingsView, linkView);

  const templateCard = makeSettingsCard();
  const template = {
    content: { firstElementChild: templateCard },
  };
  templateCard.cloneNode = () => {
    const card = makeSettingsCard();
    for (const element of [card, ...card.descendants()]) element.ownerDocument = document;
    return card;
  };
  elements.set('service-settings-template', template);

  const document = {
    body,
    hidden: false,
    activeElement: null,
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      const element = new FakeElement(tag);
      element.ownerDocument = document;
      return element;
    },
    querySelectorAll(selector) {
      const alternatives = selector.split(',').map((part) => part.trim());
      const result = [];
      for (const alternative of alternatives) {
        if (alternative.startsWith('#')) {
          const [parentSelector, childSelector] = alternative.split(/\s+/, 2);
          const parent = elements.get(parentSelector.slice(1));
          if (parent && childSelector) result.push(...parent.querySelectorAll(childSelector));
          else if (parent) result.push(parent);
        } else result.push(...body.querySelectorAll(alternative));
      }
      return [...new Set(result)];
    },
    querySelector(selector) {
      if (selector === '.service-grid') return serviceGrid;
      if (selector.startsWith('.service-tile[data-service=')) return serviceGrid.querySelector(selector);
      if (selector.startsWith('.service-settings-card[data-service=')) {
        return body.querySelectorAll('.service-settings-card').find((card) => card.matches(selector)) || null;
      }
      return document.querySelectorAll(selector)[0] || null;
    },
  };
  for (const element of elements.values()) element.ownerDocument = document;
  serviceGrid.ownerDocument = document;
  form.elements = {
    namedItem(name) { return form.descendants().find((element) => element.name === name) || null; },
  };
  form.emitChange = (target) => form.emit('change', { target });
  return { document, elements, serviceGrid, form };
}

const popupSourcePromise = readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
const popupHtmlPromise = readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');

async function createPopupHarness({ activities = [], state = {}, rejectNext = null,
  firefox = false, setupCompleted = false, userScriptsPermission = true,
  priorityRules = normalizeActivityPriorityRules(), respond = null } = {}) {
  const [source, html, settingsModule, activitySettingsModule] = await Promise.all([
    popupSourcePromise,
    popupHtmlPromise,
    import('../extension/core/settings.js'),
    import('../extension/core/activity-settings.js'),
  ]);
  const dom = createPopupDocument(html);
  const installed = structuredClone(activities).map((activity) => ({
    ...activity,
    preferences: { ...DEFAULT_ACTIVITY_PREFERENCES, ...activity.preferences },
  }));
  const calls = [];
  const storageWrites = [];
  const dashboard = {
    settings: { ...DEFAULT_SETTINGS },
    delivery: { authenticated: false, available: false },
    track: null,
    activityDiagnostics: {
      visibility: 'normal', playbackState: 'playing',
      lastReport: { title: 'Latest report', timestamp: 1_700_000_000_000 },
      lastClear: { reason: 'replaced', timestamp: 1_700_000_001_000 },
    },
    finalPresenceIntent: { name: 'Current intent', details: 'A report is active', state: 'playing' },
    ...structuredClone(state),
  };
  let rejection = rejectNext;
  const chrome = {
    runtime: {
      connect() { return { postMessage() {} }; },
      async sendMessage(message) {
        calls.push(structuredClone(message));
        if (respond) {
          const result = await respond(message);
          if (result !== undefined) return result;
        }
        if (message.type === 'GET_STATE') return structuredClone({ ...dashboard, settings: dashboard.settings, priorityRules });
        if (message.type === 'ACTIVITY_LIBRARY_STATE') return { ok: true, result: { installed: structuredClone(installed), userScriptsPermission, priorityRules: structuredClone(priorityRules) } };
        if (message.type === 'ACTIVITY_SET_PRIORITY') {
          if (rejection?.type === message.type) {
            const current = rejection;
            rejection = null;
            return { ok: false, error: current.error || 'Could not save priority' };
          }
          priorityRules = structuredClone(message.rules);
          return { ok: true, result: { priorityRules: structuredClone(priorityRules) } };
        }
        if (message.type === 'ACTIVITY_SET_ENABLED' || message.type === 'ACTIVITY_SET_PREFERENCES') {
          if (rejection?.type === message.type) {
            const currentRejection = rejection;
            rejection = null;
            if (currentRejection.removeActivity) {
              const index = installed.findIndex((activity) => activity.id === message.id);
              if (index >= 0) installed.splice(index, 1);
            }
            return { ok: false, error: currentRejection.error || 'Activity was removed while settings were open.' };
          }
          const activity = installed.find((entry) => entry.id === message.id);
          if (!activity) return { ok: false, error: `Activity ${message.id} is not installed.` };
          if (message.type === 'ACTIVITY_SET_ENABLED') activity.enabled = message.enabled;
          else Object.assign(activity.preferences, message.preferences);
          return { ok: true, result: { id: message.id, ...(message.preferences ? { preferences: activity.preferences } : { enabled: activity.enabled }) } };
        }
        return { ok: false, error: `Unexpected message: ${message.type}` };
      },
    },
    windows: { async getCurrent() { return { id: 1 }; } },
    storage: {
      local: {
        async get() { return { firefoxOnboarding: { completed: setupCompleted } }; },
        async set(values) { storageWrites.push(structuredClone(values)); dashboard.settings = { ...dashboard.settings, ...values }; },
      },
    },
  };
  const context = vm.createContext({
    document: dom.document,
    window: { addEventListener() {} },
    chrome,
    isFirefox: firefox, FIREFOX_ONBOARDING_KEY: 'firefoxOnboarding',
    location: { hash: '' },
    setInterval() { return 0; },
    setTimeout() { return 0; },
    clearTimeout() {},
    console,
    __settings: settingsModule,
    __activitySettings: activitySettingsModule,
    createPopupPriorityEditor,
    createPopupLink,
  });
  const executableSource = source
    .replace("import { createPopupLink } from './popup-link.js';", '')
    .replace("import { createPopupPriorityEditor } from './popup-priority.js';", '')
    .replace(/^import \{[^}]+\} from '\.\/platform\/browser-api.js';\r?\n/gm, '')
    .replace("import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.js';", 'const { DEFAULT_SETTINGS, normalizeSettings } = __settings;')
    .replace("import { DEFAULT_ACTIVITY_PREFERENCES } from './core/activity-settings.js';", 'const { DEFAULT_ACTIVITY_PREFERENCES } = __activitySettings;');
  vm.runInContext(`${executableSource}\nglobalThis.__popupTest = { refresh, refreshInstalledActivities, showActivitySettings, renderDashboard };`, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { ...dom, context, calls, storageWrites, installed, dashboard };
}

function activityTiles(harness) {
  return harness.serviceGrid.querySelectorAll('[data-activity-id]');
}

test('the third popup tab opens device linking and local RPC identifies the headless fallback controls', async () => {
  const popup = await createPopupHarness({ state: { delivery: { authenticated: true, headlessAuthenticated: false,
    available: true, link: { transport: 'local', paired: true, connected: true, services: [], deviceName: 'My browser' } } },
    respond: async message => message.type === 'LINK_REFRESH' ? { ok: true, result: { paired: true, connected: true, services: [] } } : undefined });
  assert.equal(popup.document.getElementById('discord-action').textContent, 'Connect fallback');
  assert.equal(popup.document.getElementById('discord-title').textContent, 'Local Discord connected');
  await popup.document.getElementById('link-tab').emit('click');
  assert.equal(popup.document.body.dataset.view, 'link');
  assert.equal(popup.document.getElementById('link-view').hidden, false);
  assert.equal(popup.document.getElementById('settings-view').hidden, true);
  assert.equal(popup.document.getElementById('activity-view').hidden, true);
  assert.equal(popup.document.getElementById('link-tab').getAttribute('aria-pressed'), 'true');
  assert.ok(popup.calls.some(call => call.type === 'LINK_REFRESH'));
});

test('Link popup distinguishes idle, startup safety, and actual fallback while keeping the app connected', async () => {
  const popup = await createPopupHarness({ state: { delivery: { link: {
    paired: true, connected: true, transport: 'idle', services: [], deviceName: 'My browser',
  } } } });
  const label = popup.document.getElementById('link-transport');
  const help = popup.document.getElementById('link-presence-help');
  assert.equal(label.textContent, 'Waiting for activity');
  assert.match(help.textContent, /Local Discord starts when an Activity can be shared/);
  popup.dashboard.delivery.link = { ...popup.dashboard.delivery.link, transport: 'waiting', recovery: 'startup', fallbackSeconds: 35 };
  popup.context.__popupTest.renderDashboard(popup.dashboard);
  assert.equal(label.textContent, 'Previous session · 35s');
  assert.doesNotMatch(label.textContent, /headless|disconnected/i);
  assert.match(help.textContent, /previous local session/);
  assert.equal(popup.document.getElementById('link-badge').textContent, 'Connected');
  popup.dashboard.delivery.link.recovery = 'connection-lost';
  popup.context.__popupTest.renderDashboard(popup.dashboard);
  assert.equal(label.textContent, 'Resuming presence in 35s');
});

test('popup priority lives in Settings; keyboard reordering saves immediately and survives reopening', async () => {
  const popup = await createPopupHarness();
  const list = popup.document.getElementById('priority-list');
  assert.equal(popup.document.getElementById('priority-card').closest('#settings-view'), popup.document.getElementById('settings-view'));
  assert.equal(popup.document.getElementById('activity-view').querySelector('#priority-card'), null);
  assert.equal(list.children.length, 5);
  const moveUp = () => ({ key: 'ArrowUp', preventDefault() {} });
  await list.children[2].querySelector('.priority-handle').emit('keydown', moveUp());
  await list.children[1].querySelector('.priority-handle').emit('keydown', moveUp());
  const saved = popup.calls.filter(call => call.type === 'ACTIVITY_SET_PRIORITY').at(-1).rules;
  assert.equal(saved[0].state, 'browsing');
  assert.equal(list.children[0].dataset.ruleId, 'browsing-viewed');
  assert.equal(popup.document.activeElement, list.children[0].querySelector('.priority-handle'));
  assert.equal(popup.document.getElementById('priority-status').textContent, 'Saved automatically');
  const reopened = await createPopupHarness({ priorityRules: saved });
  assert.equal(reopened.document.getElementById('priority-list').children[0].dataset.ruleId, 'browsing-viewed');
});

test('popup drag handles show the drop position and save the new priority order', async () => {
  const popup = await createPopupHarness();
  const list = popup.document.getElementById('priority-list');
  await list.children[0].querySelector('.priority-handle').emit('dragstart', { dataTransfer: { setData() {} } });
  await list.children[2].emit('dragover', { preventDefault() {} });
  assert.equal(list.children[2].classList.contains('drop-after'), true);
  await list.children[2].emit('drop', { preventDefault() {} });
  assert.equal(list.children[2].dataset.ruleId, 'playing-viewed');
  assert.equal(popup.calls.filter(call => call.type === 'ACTIVITY_SET_PRIORITY').at(-1).rules[2].id, 'playing-viewed');
  assert.equal(list.children.some(row => row.classList.contains('drop-after') || row.classList.contains('is-dragging')), false);
});

test('popup priority supports Activity-specific rules, inline editing, removal, and automatic reset', async () => {
  const popup = await createPopupHarness({ activities: [{ id: 'music', name: 'Music', enabled: true }] });
  const list = popup.document.getElementById('priority-list');
  await popup.document.getElementById('priority-add').emit('click');
  assert.equal(list.children.length, 6);
  assert.equal(list.children[0].querySelector('.priority-rule-fields').hidden, false);
  assert.equal(list.children[0].querySelector('.priority-activityId').value, 'music');
  const select = list.children[0].querySelector('.priority-state');
  select.value = 'paused';
  await select.emit('change');
  const saved = popup.calls.filter(call => call.type === 'ACTIVITY_SET_PRIORITY').at(-1).rules;
  assert.equal(saved[0].activityId, 'music');
  assert.equal(saved[0].state, 'paused');
  await list.children[0].querySelector('.priority-remove').emit('click');
  assert.equal(list.children.length, 5);
  await list.children[2].querySelector('.priority-handle').emit('keydown', { key: 'ArrowUp', preventDefault() {} });
  await popup.document.getElementById('priority-reset').emit('click');
  assert.deepEqual(popup.calls.filter(call => call.type === 'ACTIVITY_SET_PRIORITY').at(-1).rules, DEFAULT_ACTIVITY_PRIORITY_RULES);
});

test('popup priority keeps failed edits through refresh and provides a working retry', async () => {
  const popup = await createPopupHarness({ rejectNext: { type: 'ACTIVITY_SET_PRIORITY', error: 'Storage unavailable' } });
  const list = popup.document.getElementById('priority-list');
  await list.children[2].querySelector('.priority-handle').emit('keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.equal(popup.document.getElementById('priority-status').textContent, 'Storage unavailable');
  assert.equal(popup.document.getElementById('priority-retry').hidden, false);
  await popup.context.__popupTest.refresh();
  assert.equal(list.children[1].dataset.ruleId, 'browsing-viewed');
  await popup.document.getElementById('priority-retry').emit('click');
  assert.equal(popup.document.getElementById('priority-retry').hidden, true);
  assert.equal(popup.document.getElementById('priority-status').textContent, 'Saved automatically');
});

test('a late popup state response cannot undo a newly saved priority order', async () => {
  let holdNextState = false;
  let releaseState;
  const popup = await createPopupHarness({ respond: message => {
    if (message.type === 'GET_STATE' && holdNextState) {
      holdNextState = false;
      return new Promise(resolve => { releaseState = resolve; });
    }
  } });
  holdNextState = true;
  const pending = popup.context.__popupTest.refresh();
  const list = popup.document.getElementById('priority-list');
  await list.children[2].querySelector('.priority-handle').emit('keydown', { key: 'ArrowUp', preventDefault() {} });
  releaseState({ settings: { enabled: true }, delivery: {}, track: null, priorityRules: normalizeActivityPriorityRules() });
  await pending;
  assert.equal(list.children[1].dataset.ruleId, 'browsing-viewed');
});

test('Firefox popup keeps setup accessible while permission or first-run completion is pending', async () => {
  for (const [userScriptsPermission, setupCompleted, hidden] of [[false, false, false], [true, false, false], [true, true, true], [false, true, false]]) {
    const popup = await createPopupHarness({ firefox: true, userScriptsPermission, setupCompleted });
    assert.equal(popup.document.getElementById('firefox-setup-card').hidden, hidden);
    assert.equal(popup.document.getElementById('firefox-setup-help').hidden, false);
    assert.match(popup.document.getElementById('firefox-setup-label').textContent, userScriptsPermission ? /Continue/ : /Set up/);
  }
});

function activityCard(harness, id) {
  return harness.document.querySelectorAll('#activity-settings .service-settings-card')
    .find((card) => card.dataset.activityId === id) || null;
}

test('popup handles zero installed Activities and dynamically renders enabled and disabled Activities', async () => {
  const empty = await createPopupHarness();
  assert.equal(activityTiles(empty).length, 0);
  assert.equal(empty.document.getElementById('activity-settings-section').hidden, true);

  const alpha = {
    id: 'example-streaming-service', name: 'Example Streaming Service', enabled: true,
    description: 'A generic media Activity.', icon: 'data:image/png;base64,AAAA', preferences: { showPaused: false },
  };
  const beta = {
    id: 'second-generic-activity', name: 'Second Activity', enabled: false,
    matches: ['https://example.test/*'], icon: '', preferences: { showButtons: false },
  };
  const popup = await createPopupHarness({ activities: [alpha, beta] });
  const tiles = activityTiles(popup);
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].querySelector('strong').textContent, alpha.name);
  assert.match(tiles[0].getAttribute('aria-label'), /enabled/i);
  assert.equal(tiles[0].querySelector('img').src, alpha.icon);
  tiles[0].querySelector('img').onerror();
  assert.equal(tiles[0].querySelector('img').src, 'icons/icon32.png');
  assert.equal(tiles[1].querySelector('img').src, 'icons/icon32.png');
  assert.match(tiles[1].getAttribute('aria-label'), /disabled/i);

  const alphaCard = activityCard(popup, alpha.id);
  const betaCard = activityCard(popup, beta.id);
  assert.ok(alphaCard);
  assert.ok(betaCard);
  assert.equal(alphaCard.querySelector('.setting-copy small').textContent, alpha.description);
  assert.equal(betaCard.querySelector('.setting-copy small').textContent, 'https://example.test/*');
  assert.equal(alphaCard.querySelector('[data-setting="paused"]').checked, false);
  assert.equal(alphaCard.querySelector('[data-setting="artwork"]').checked, DEFAULT_ACTIVITY_PREFERENCES.showArtwork);
  assert.equal(betaCard.querySelector('[data-setting="buttons"]').checked, false);
  assert.equal(betaCard.querySelector('[data-setting="buttons"]').disabled, true);

  await tiles[0].emit('click');
  const opened = activityCard(popup, alpha.id);
  assert.equal(popup.document.body.dataset.view, 'settings');
  assert.equal(opened.open, true);
  assert.equal(popup.document.activeElement, opened.querySelector('summary'));
  assert.equal(opened.wasScrolledIntoView, true);
});

test('Activity preference, status, and enable changes use backend messages', async () => {
  const activity = {
    id: 'generic-listening-service', name: 'Generic Listening Service', enabled: true,
    icon: 'data:image/png;base64,BBBB',
    preferences: { ...DEFAULT_ACTIVITY_PREFERENCES, showButtons: false },
  };
  const popup = await createPopupHarness({ activities: [activity] });
  let card = activityCard(popup, activity.id);
  let artwork = card.querySelector('[data-setting="artwork"]');
  assert.equal(artwork.getAttribute('aria-label'), 'Show artwork for Generic Listening Service');
  artwork.checked = false;
  await popup.form.emitChange(artwork);
  assert.deepEqual(popup.calls.find((message) => message.type === 'ACTIVITY_SET_PREFERENCES'), {
    type: 'ACTIVITY_SET_PREFERENCES', id: activity.id, preferences: { showArtwork: false },
  });
  card = activityCard(popup, activity.id);
  assert.equal(card.querySelector('[data-setting="artwork"]').checked, false);
  assert.equal(popup.document.getElementById('save-status').textContent, 'Saved');

  const status = card.querySelector('[data-setting="status"]');
  assert.deepEqual(status.children.map((option) => [option.value, option.textContent]), [
    ['app', 'Activity name'], ['artist', 'Artist / creator'], ['track', 'Media title'],
  ]);
  status.value = 'artist';
  await popup.form.emitChange(status);
  const statusMessage = popup.calls.filter((message) => message.type === 'ACTIVITY_SET_PREFERENCES').at(-1);
  assert.deepEqual(statusMessage.preferences, { statusDisplay: 'artist' });
  assert.equal(activityCard(popup, activity.id).querySelector('[data-setting="status"]').value, 'artist');

  card = activityCard(popup, activity.id);
  const master = card.querySelector('.service-master input');
  master.checked = false;
  await popup.form.emitChange(master);
  assert.deepEqual(popup.calls.find((message) => message.type === 'ACTIVITY_SET_ENABLED'), {
    type: 'ACTIVITY_SET_ENABLED', id: activity.id, enabled: false,
  });
  card = activityCard(popup, activity.id);
  assert.equal(card.classList.contains('is-disabled'), true);
  assert.equal(card.querySelector('.service-master input').checked, false);
  assert.equal(card.querySelector('[data-setting="status"]').disabled, true);
  assert.equal(popup.installed[0].preferences.showArtwork, false);
  assert.equal(popup.installed[0].preferences.statusDisplay, 'artist');
  assert.equal(popup.installed[0].preferences.showButtons, false);

  assert.equal(popup.calls.some((message) => message.type === 'ACTIVITY_SET_PREFERENCES' && message.id === activity.id), true);

  await popup.context.__popupTest.refreshInstalledActivities();
  assert.equal(popup.storageWrites.length, 0, 'opening or refreshing Activity state does not rewrite preferences');
  assert.equal(popup.installed[0].preferences.statusDisplay, 'artist');
});

test('Activity status labels customize only option text and retain saved values', async () => {
  const activity = {
    id: 'youtube-music', name: 'YouTube Music', enabled: true,
    settingsUi: { statusLabels: { app: 'YouTube Music', artist: 'Artist', track: 'Song title' } },
    preferences: { statusDisplay: 'track' },
  };
  const fallback = { id: 'older-activity', name: 'Older Activity', enabled: true };
  const popup = await createPopupHarness({ activities: [activity, fallback] });
  const options = activityCard(popup, activity.id).querySelector('[data-setting="status"]');
  assert.deepEqual(options.children.map((option) => [option.value, option.textContent]), [
    ['app', 'YouTube Music'], ['artist', 'Artist'], ['track', 'Song title'],
  ]);
  assert.equal(options.value, 'track');
  const fallbackOptions = activityCard(popup, fallback.id).querySelector('[data-setting="status"]');
  assert.deepEqual(fallbackOptions.children.map((option) => option.textContent),
    ['Activity name', 'Artist / creator', 'Media title']);
  fallback.settingsUi = { statusLabels: { artist: 'Presenter' } };
  popup.installed[1].settingsUi = fallback.settingsUi;
  await popup.context.__popupTest.refreshInstalledActivities();
  const partialOptions = activityCard(popup, fallback.id).querySelector('[data-setting="status"]');
  assert.deepEqual(partialOptions.children.map((option) => option.textContent),
    ['Activity name', 'Presenter', 'Media title']);
  options.value = 'artist';
  await popup.form.emitChange(options);
  assert.deepEqual(popup.calls.filter((call) => call.type === 'ACTIVITY_SET_PREFERENCES').at(-1).preferences,
    { statusDisplay: 'artist' });
  assert.equal(activityCard(popup, activity.id).querySelector('[data-setting="status"]').value, 'artist');
});

test('popup exposes browser-close fallback and a failed Discord cleanup outcome', async () => {
  const popup = await createPopupHarness({ state: {
    delivery: {
      shutdownCleanup: { state: 'exit-fallback', reason: 'unsupported' },
      lastCleanupAttempt: { state: 'failed', source: 'document', httpStatus: 403, timestamp: 1_700_000_000_000 },
    },
  } });
  assert.equal(popup.document.getElementById('discord-cleanup-backup').textContent, 'Armed (exit fallback only) · unsupported');
  assert.match(popup.document.getElementById('discord-cleanup-last').textContent, /^Document exit: failed \(HTTP 403\)/);
});

test('active dynamic Activity uses its own name and package icon while Chromium diagnostics remain visible', async () => {
  const activity = {
    id: 'fresh-service-id', name: 'Fresh Service Name', enabled: true,
    icon: 'data:image/png;base64,CCCC', preferences: { ...DEFAULT_ACTIVITY_PREFERENCES },
  };
  const popup = await createPopupHarness({
    activities: [activity],
    state: {
      track: {
        activityId: activity.id,
        activityName: activity.name,
        source: activity.id,
        media: { title: 'A normalized title', artist: 'A normalized creator' },
        playback: { state: 'playing' },
      },
    },
  });
  assert.equal(popup.document.getElementById('active-service-icon').src, activity.icon);
  assert.equal(popup.document.getElementById('kicker').textContent, `Now playing · ${activity.name}`);
  assert.equal(popup.document.getElementById('title').textContent, 'A normalized title');
  assert.equal(popup.document.getElementById('artist').textContent, 'A normalized creator');
  assert.equal(popup.document.getElementById('local-visibility').textContent, 'normal');
  assert.equal(popup.document.getElementById('local-playback').textContent, 'playing');
  assert.match(popup.document.getElementById('local-last-report').textContent, /Latest report/);
  assert.match(popup.document.getElementById('local-last-clear').textContent, /replaced/);
  assert.equal(popup.document.getElementById('local-presence-intent').textContent, 'A report is active · playing');

  const noIcon = await createPopupHarness({
    activities: [{ ...activity, icon: '' }],
    state: { track: { activityId: activity.id, activityName: activity.name, media: { title: 'No icon title' }, playback: { state: 'playing' } } },
  });
  assert.equal(noIcon.document.getElementById('active-service-icon').src, 'icons/icon32.png');
  const tileIcon = activityTiles(noIcon)[0].querySelector('img');
  tileIcon.onerror();
  assert.equal(tileIcon.src, 'icons/icon32.png');
});

test('YouTube Music shows a pause badge on album art only while paused', async () => {
  const activity = {
    id: 'youtube-music', name: 'YouTube Music', enabled: true, icon: 'icons/icon32.png',
  };
  const popup = await createPopupHarness({
    activities: [activity],
    state: {
      track: {
        activityId: activity.id,
        activityName: activity.name,
        media: { title: 'A Song', artist: 'An Artist' },
        playback: { state: 'paused' },
        artwork: { large: 'https://example.com/cover.png' },
      },
    },
  });
  assert.equal(popup.document.getElementById('pause-mark').hidden, false);
  assert.equal(popup.document.getElementById('service-mark').hidden, true);
  assert.equal(popup.document.getElementById('kicker').textContent, 'Paused · YouTube Music');

  popup.dashboard.track.playback.state = 'playing';
  await popup.context.__popupTest.refresh();
  assert.equal(popup.document.getElementById('pause-mark').hidden, true);
  assert.equal(popup.document.getElementById('service-mark').hidden, false);

  const other = await createPopupHarness({
    activities: [{ id: 'fresh-service-id', name: 'Fresh Service Name', enabled: true }],
    state: {
      track: {
        activityId: 'fresh-service-id',
        activityName: 'Fresh Service Name',
        media: { title: 'A Video' },
        playback: { state: 'paused' },
      },
    },
  });
  assert.equal(other.document.getElementById('pause-mark').hidden, true);
  assert.equal(other.document.getElementById('service-mark').hidden, false);
});

test('rejected updates restore backend state and stale removed Activities disappear from the popup', async () => {
  const activity = {
    id: 'stale-while-popup-open', name: 'Stale Activity', enabled: true,
    preferences: { ...DEFAULT_ACTIVITY_PREFERENCES, showArtwork: true },
  };
  const rejected = await createPopupHarness({
    activities: [activity],
    rejectNext: { type: 'ACTIVITY_SET_PREFERENCES', error: 'Activity rejected this setting.' },
  });
  const input = activityCard(rejected, activity.id).querySelector('[data-setting="artwork"]');
  input.checked = false;
  await rejected.form.emitChange(input);
  assert.equal(activityCard(rejected, activity.id).querySelector('[data-setting="artwork"]').checked, true);
  assert.equal(rejected.document.getElementById('save-status').textContent, 'Activity rejected this setting.');

  const removed = await createPopupHarness({
    activities: [activity],
    rejectNext: {
      type: 'ACTIVITY_SET_PREFERENCES',
      error: 'Activity stale-while-popup-open is not installed.',
      removeActivity: true,
    },
  });
  const staleControl = activityCard(removed, activity.id).querySelector('[data-setting="showPaused"]') ||
    activityCard(removed, activity.id).querySelector('[data-setting="paused"]');
  staleControl.checked = false;
  await removed.form.emitChange(staleControl);
  assert.equal(activityTiles(removed).length, 0);
  assert.equal(activityCard(removed, activity.id), null);
  assert.equal(removed.document.getElementById('activity-settings-section').hidden, true);
  assert.match(removed.document.getElementById('save-status').textContent, /not installed/);
});
