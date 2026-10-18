import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as validator from '../extension/core/activity-validator.js';
import * as developerDiagnostics from '../extension/core/developer-diagnostics.js';
import * as browserPlatform from '../extension/platform/browser-api.js';
import { activityCatalogIconUrl, compareActivityVersions } from '../extension/core/activity-repository.js';

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.dataset = {};
    this.value = '';
    this.attributes = new Map();
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.open = false;
    this.scrollHeight = 600;
    this.clientHeight = 300;
    this.classList = {
      add: (...names) => { this.className += ` ${names.join(' ')}`; },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }
  append(...children) {
    this.children.push(...children);
    for (const child of children) if (typeof child === 'object') child.parent = this;
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  add(child) { this.append(child); }
  get options() { return this.children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
  emit(type, event = {}) { return this.listeners.get(type)?.({ target: this, ...event }); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  scrollIntoView(options) { this.scrollIntoViewOptions = options; }
  select() { this.setSelectionRange(0, this.value.length); }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  matches(selector) {
    return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tag === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelector(selector) {
    for (const child of this.children) {
      if (typeof child !== 'object') continue;
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (typeof child !== 'object') continue;
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

async function createLibrary({ installed = [], catalog = null, developerMode = false, respond = null, narrow = false,
  downloadActivityImpl = null, fetchCatalogImpl = null, repositoryPermission = true } = {}) {
  installed = structuredClone(installed);
  const [source, html] = await Promise.all([
    readFile(new URL('../extension/activities.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/activities.html', import.meta.url), 'utf8'),
  ]);
  const elements = new Map([...html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)].map((match) => {
    const node = new Element(match[1]);
    node.id = match[3];
    node.className = /\bclass="([^"]*)"/.exec(match[2])?.[1] || '';
    node.hidden = /\bhidden\b/.test(match[2]);
    node.dataset.view = /\bdata-view="([^"]*)"/.exec(match[2])?.[1];
    for (const attribute of ['aria-selected', 'tabindex']) {
      const value = new RegExp(`\\b${attribute}="([^"]*)"`).exec(match[2])?.[1];
      if (value !== undefined) node.setAttribute(attribute, value);
    }
    node.readOnly = /\breadonly\b/.test(match[2]);
    if (node.tag === 'select') {
      const body = html.slice(match.index + match[0].length).split('</select>')[0];
      node.value = /<option\b[^>]*\bvalue="([^"]*)"/.exec(body)?.[1] || '';
    }
    return [match[3], node];
  }));
  const document = {
    activeElement: null, hidden: false,
    getElementById: (id) => elements.get(id),
    createElement(tag) { const node = new Element(tag); node.ownerDocument = document; return node; },
    querySelectorAll: (selector) => {
      const matches = new Set();
      for (const node of elements.values()) {
        if (node.matches(selector)) matches.add(node);
        for (const child of node.querySelectorAll(selector)) matches.add(child);
      }
      return [...matches];
    },
  };
  for (const node of elements.values()) node.ownerDocument = document;
  const calls = [];
  const copied = [];
  const catalogFetches = [];
  const permissionChecks = [];
  const permissionRequests = [];
  let failState = false;
  let failSave = false;
  let failCopy = false;
  let polling;
  const chrome = {
    runtime: {
      getManifest: () => ({ version: '1.9.0' }),
      async sendMessage(message) {
        calls.push(message);
        if (respond) {
          const result = await respond(message);
          if (result !== undefined) return result;
        }
        if (message.type === 'ACTIVITY_LIBRARY_STATE') {
          if (failState) throw new Error('Worker unavailable');
          return { ok: true, result: { installed: structuredClone(installed), userScriptsPermission: true } };
        }
        if (message.type === 'ACTIVITY_SET_SETTING' && failSave) return { ok: false, error: 'Setting rejected' };
        if (message.type === 'ACTIVITY_INSTALL') return { ok: true, result: message.activityPackage.metadata };
        return { ok: true, result: {} };
      },
    },
    storage: { local: { get: async () => ({ developerMode }), set: async () => {} } },
    permissions: {
      contains: async request => { permissionChecks.push(request); return repositoryPermission; },
      request: async request => { permissionRequests.push(request); return true; },
    },
    userScripts: { execute() {} },
  };
  const context = vm.createContext({
    ...validator, ...developerDiagnostics, ...browserPlatform, document, chrome, JSON, URL, Uint8Array, btoa, structuredClone,
    navigator: { clipboard: { async writeText(value) { if (failCopy) throw new Error('Clipboard unavailable'); copied.push(value); } } },
    location: { href: 'https://example.test/activities.html' },
    window: { matchMedia: () => ({ matches: narrow }) },
    matchMedia: () => ({ matches: narrow }),
    Option: class extends Element { constructor(label, value) { super('option'); this.textContent = label; this.value = value; } },
    activityCatalogIconUrl,
    compareActivityVersions,
    downloadActivity: downloadActivityImpl || (async () => { throw new Error('Unexpected package download'); }),
    fetchCatalog: async options => {
      catalogFetches.push(options);
      return fetchCatalogImpl ? fetchCatalogImpl(options) : { catalog: catalog || { activities: [] }, fetchedAt: 1 };
    },
    readCatalogCache: async () => ({ catalog, fetchedAt: 0 }),
    requestHostPermissions: async () => true,
    setInterval: (callback) => { polling = callback; },
  });
  vm.runInContext(source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, ''), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    document, elements, calls, copied, catalogFetches, permissionChecks, permissionRequests, poll: () => polling(),
    setInstalled(next) { installed = structuredClone(next); },
    failState: () => { failState = true; }, failSave: () => { failSave = true; }, failCopy: () => { failCopy = true; },
  };
}

function packageFiles(id, readMetadata = null) {
  const metadata = JSON.stringify({ id, name: id, description: 'Local playback', version: '1.0.0', apiVersion: 1,
    matches: ['https://example.test/*'], entry: 'activity.js' });
  return [{ name: 'metadata.json', text: readMetadata || (async () => metadata) },
    { name: 'activity.js', text: async () => 'ChudPresence.clear();' }];
}

test('opening the Library forces one fresh catalog fetch, while navigation and installed-state polling do not', async () => {
  const catalog = { activities: simpleCatalogEntries() };
  let openings = 0;
  const options = { catalog, fetchCatalogImpl: async () => {
    openings++;
    return { catalog, fetchedAt: 1 };
  } };
  const ui = await createLibrary(options);
  assert.equal(ui.catalogFetches.length, 1);
  assert.equal(ui.catalogFetches[0].force, true);
  assert.equal(ui.permissionChecks.length, 1);
  assert.equal(ui.permissionRequests.length, 0);
  assert.equal(ui.elements.has('page-status'), false);
  assert.equal(ui.elements.has('status-dot'), false);
  assert.equal(ui.elements.get('catalog-notice').textContent, '');
  for (const view of ['installed', 'updates', 'developer', 'discover']) await showView(ui, view);
  await ui.elements.get('layout-list').emit('click');
  await ui.poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.catalogFetches.length, 1);
  await createLibrary(options);
  assert.equal(openings, 2, 'a new Library opening must fetch even with a cached catalog');
});

test('cached Activities stay usable during the opening refresh and a second refresh cannot overlap it', async () => {
  const catalog = { activities: simpleCatalogEntries() };
  let finishRefresh;
  const pending = new Promise(resolve => { finishRefresh = resolve; });
  const ui = await createLibrary({ catalog, fetchCatalogImpl: () => pending });
  const refresh = ui.elements.get('refresh-catalog');
  assert.equal(refresh.disabled, true);
  assert.equal(ui.elements.get('discover-list').children.length, 3);
  const search = ui.elements.get('search');
  search.value = 'alpha';
  await search.emit('input');
  await refresh.emit('click');
  assert.equal(ui.catalogFetches.length, 1);
  const freshCatalog = { activities: catalog.activities.map(entry => ({ ...entry, name: entry.name + ' updated' })) };
  finishRefresh({ catalog: freshCatalog, fetchedAt: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refresh.disabled, false);
  assert.equal(search.value, 'alpha');
  assert.equal(ui.elements.get('discover-list').children.length, 1);
  assert.equal(listRow(ui, 'discover', 'alpha').querySelector('.row-title').textContent, 'ALPHA updated');
  assert.equal(ui.elements.get('activity-inspector').hidden, true);
});

test('an opening refresh failure preserves cached Activities and exposes a retryable error', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() }, fetchCatalogImpl: async () => {
    throw new Error('Offline');
  } });
  assert.equal(ui.catalogFetches.length, 1);
  assert.equal(ui.elements.get('discover-list').children.length, 3);
  assert.match(ui.elements.get('catalog-notice').textContent, /cached catalog.*Offline/);
  assert.equal(ui.elements.get('refresh-catalog').disabled, false);
  assert.equal(ui.permissionRequests.length, 0);
});

test('opening without catalog permission keeps the cache and leaves the permission prompt to manual Refresh', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() }, repositoryPermission: false });
  assert.equal(ui.catalogFetches.length, 0);
  assert.equal(ui.permissionRequests.length, 0);
  assert.equal(ui.elements.get('discover-list').children.length, 3);
  assert.match(ui.elements.get('catalog-notice').textContent, /Use Refresh catalog to allow catalog access/);
  await ui.elements.get('refresh-catalog').emit('click');
  assert.equal(ui.permissionRequests.length, 1);
  assert.deepEqual([...ui.permissionRequests[0].origins], ['https://raw.githubusercontent.com/*', 'https://api.github.com/*']);
  assert.equal(ui.catalogFetches.length, 1);
  assert.equal(ui.catalogFetches[0].force, true);
  assert.match(ui.elements.get('catalog-notice').textContent, /Loaded 3 Activities/);
});

test('a slower previous file selection cannot replace the local package being loaded', async () => {
  const ui = await createLibrary();
  let finishOld;
  const oldMetadata = new Promise((resolve) => { finishOld = resolve; });
  const files = ui.elements.get('local-files');
  files.files = packageFiles('old-package', () => oldMetadata);
  const readingOld = files.emit('change');
  files.files = packageFiles('new-package');
  await files.emit('change');
  finishOld(await packageFiles('old-package')[0].text());
  await readingOld;
  await ui.elements.get('load-local').emit('click');
  const install = ui.calls.find((call) => call.type === 'ACTIVITY_INSTALL');
  assert.equal(install.activityPackage.metadata.id, 'new-package');
});

test('clearing files invalidates an unfinished package read', async () => {
  const ui = await createLibrary();
  let finish;
  const files = ui.elements.get('local-files');
  files.files = packageFiles('old-package', () => new Promise((resolve) => { finish = resolve; }));
  const reading = files.emit('change');
  files.files = [];
  await files.emit('change');
  finish(await packageFiles('old-package')[0].text());
  await reading;
  assert.equal(ui.elements.get('load-local').disabled, true);
  assert.equal(ui.elements.get('selected-files').textContent, 'Choose metadata.json and activity.js together.');
});

const record = {
  id: 'test-activity', name: 'Test', version: '1.0.0', apiVersion: 1, enabled: true,
  matches: ['https://example.test/*'],
  settings: [{ id: 'label', type: 'string', label: 'Label', default: 'Original' }],
};

test('local installation focuses the selected Installed inspector after selection changes', async () => {
  let stored = diagnosticRecords();
  let ui;
  ui = await createLibrary({ installed: stored, developerMode: true, narrow: true, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_REMOVE') {
      stored = stored.filter((entry) => entry.id !== message.id);
      ui?.setInstalled(stored);
      return { ok: true, result: {} };
    }
    if (message.type === 'ACTIVITY_INSTALL') {
      const metadata = message.activityPackage.metadata;
      stored = [...stored, { ...metadata, enabled: true, status: 'waiting', source: { type: 'local' } }];
      ui?.setInstalled(stored);
      return { ok: true, result: metadata };
    }
  } });
  await showView(ui, 'installed');
  await selectRow(ui, 'installed', 'beta');
  await ui.elements.get('inspector-content').querySelector('.activity-remove-action').emit('click');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'alpha');

  const files = ui.elements.get('local-files');
  files.files = packageFiles('new-local');
  await files.emit('change');
  await ui.elements.get('load-local').emit('click');
  assert.equal(ui.elements.get('installed-view').hidden, false);
  assert.equal(inspectorDetail(ui).dataset.activityId, 'new-local');
  assert.equal(listRow(ui, 'installed', 'new-local').querySelector('.activity-select').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.elements.get('activity-inspector').classList.contains('is-open'), true);
  const name = inspectorDetail(ui).querySelector('.inspector-name');
  assert.equal(ui.document.activeElement, name);
  assert.equal(name.focusOptions.preventScroll, true);
  assert.equal(ui.elements.get('activity-inspector').scrollIntoViewOptions.block, 'start');
});

test('repository installation focuses the selected Installed inspector', async () => {
  const entry = {
    id: 'remote-new', name: 'Remote New', description: 'Repository fixture', version: '1.0.0', apiVersion: 2,
    matches: ['https://remote.example.test/*'], pageAccess: { url: true },
  };
  let stored = [diagnosticRecords()[0]];
  let ui;
  ui = await createLibrary({ installed: stored, catalog: { activities: [entry] }, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_INSTALL') {
      const metadata = message.activityPackage.metadata;
      stored = [...stored, { ...metadata, enabled: true, status: 'waiting', source: { type: message.activityPackage.sourceType } }];
      ui?.setInstalled(stored);
      return { ok: true, result: metadata };
    }
  }, narrow: true, downloadActivityImpl: async () => ({ metadata: entry, source: 'fixture', code: 'void 0;' }) });
  await showView(ui, 'installed');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'alpha');
  await showView(ui, 'discover');
  await ui.elements.get('inspector-content').querySelector('.activity-install-action').emit('click');
  assert.equal(ui.elements.get('installed-view').hidden, false);
  assert.equal(inspectorDetail(ui).dataset.activityId, 'remote-new');
  assert.equal(listRow(ui, 'installed', 'remote-new').querySelector('.activity-select').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.elements.get('activity-inspector').classList.contains('is-open'), true);
  const name = inspectorDetail(ui).querySelector('.inspector-name');
  assert.equal(ui.document.activeElement, name);
  assert.equal(name.focusOptions.preventScroll, true);
  assert.equal(ui.elements.get('activity-inspector').scrollIntoViewOptions.block, 'start');
});

test('removing the last installed Activity returns focus to the Installed tab', async () => {
  let stored = [{ ...record }];
  let ui;
  ui = await createLibrary({ installed: stored, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_REMOVE') {
      stored = [];
      ui?.setInstalled(stored);
      return { ok: true, result: {} };
    }
  } });
  await showView(ui, 'installed');
  assert.equal(inspectorDetail(ui).dataset.activityId, record.id);

  await ui.elements.get('inspector-content').querySelector('.activity-remove-action').emit('click');

  assert.equal(listRow(ui, 'installed', record.id), undefined);
  assert.equal(inspectorDetail(ui), null);
  const installedTab = ui.elements.get('tab-installed');
  assert.equal(ui.document.activeElement, installedTab);
  assert.equal(installedTab.focusOptions.preventScroll, true);
});

async function showView(ui, view) {
  await ui.elements.get(`tab-${view}`).emit('click');
}

function listRow(ui, view, id) {
  return ui.elements.get(`${view}-list`).children.find((row) => row.dataset.activityId === id);
}

async function selectRow(ui, view, id) {
  const row = listRow(ui, view, id);
  assert.ok(row, `expected ${id} row in ${view}`);
  await row.querySelector('.activity-select').emit('click');
  return row;
}

function inspectorDetail(ui) {
  return ui.elements.get('inspector-content').querySelector('.activity-detail');
}

function textContentTree(node) {
  return [node?.textContent || '', ...(node?.children || []).filter((child) => typeof child === 'object').map(textContentTree)].join(' ');
}

test('a rejected Activity setting remains editable when the worker cannot refresh', async () => {
  const ui = await createLibrary({ installed: [record] });
  await showView(ui, 'installed');
  const input = ui.elements.get('inspector-content').querySelector('input');
  input.value = 'Changed';
  ui.failSave();
  ui.failState();
  await input.emit('change');
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Original');
  assert.match(ui.elements.get('library-feedback').textContent, /Setting rejected/);
});

test('a successful setting save survives a failed refresh and reports the refresh failure', async () => {
  const ui = await createLibrary({ installed: [record] });
  await showView(ui, 'installed');
  const input = ui.elements.get('inspector-content').querySelector('input');
  input.value = 'Changed';
  ui.failState();
  await input.emit('change');
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Changed');
  assert.match(ui.elements.get('library-feedback').textContent, /Saved, but Activity state could not refresh/);
  input.value = 'Rejected change';
  ui.failSave();
  await input.emit('change');
  assert.equal(input.value, 'Changed');
});

test('a successful setting save restores focus and text selection to that setting after refresh', async () => {
  const configured = {
    ...record,
    settings: [
      { id: 'label', type: 'string', label: 'Label', default: 'Original' },
      { id: 'endpoint', type: 'string', label: 'Endpoint', default: 'https://old.example.test' },
    ],
  };
  let stored = [structuredClone(configured)];
  let ui;
  ui = await createLibrary({ installed: stored, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_SET_SETTING') {
      stored = stored.map((entry) => entry.id === message.id
        ? { ...entry, settingValues: { ...entry.settingValues, [message.settingId]: message.value } }
        : entry);
      ui?.setInstalled(stored);
      return { ok: true, result: { value: message.value } };
    }
  } });
  await showView(ui, 'installed');
  const original = ui.elements.get('inspector-content').querySelectorAll('input')
    .find((control) => control.dataset.settingId === 'endpoint');
  original.value = 'https://new.example.test/path';
  original.focus();
  original.setSelectionRange(8, 17);

  await original.emit('change');

  const replacement = ui.elements.get('inspector-content').querySelectorAll('input')
    .find((control) => control.dataset.settingId === 'endpoint');
  assert.notEqual(replacement, original);
  assert.equal(replacement.value, 'https://new.example.test/path');
  assert.equal(ui.document.activeElement, replacement);
  assert.equal(replacement.focusOptions.preventScroll, true);
  assert.deepEqual([replacement.selectionStart, replacement.selectionEnd], [8, 17]);
});

test('Library polling preserves text being edited in Activity settings', async () => {
  const ui = await createLibrary({ installed: [record] });
  await showView(ui, 'installed');
  const input = ui.elements.get('inspector-content').querySelector('input');
  input.value = 'Unsaved text';
  ui.document.activeElement = input;
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('inspector-content').querySelector('input'), input);
  assert.equal(input.value, 'Unsaved text');
});

test('a pending Library poll cannot replace a setting input when editing starts', async () => {
  const ui = await createLibrary({ installed: [record] });
  await showView(ui, 'installed');
  const input = ui.elements.get('inspector-content').querySelector('input');
  ui.poll();
  input.value = 'Unsaved text';
  ui.document.activeElement = input;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('inspector-content').querySelector('input'), input);
  assert.equal(input.value, 'Unsaved text');
});

test('Library polling preserves focus on the same Activity action without scrolling', async () => {
  const records = diagnosticRecords();
  const ui = await createLibrary({ installed: records, developerMode: true });
  await showView(ui, 'installed');
  await selectRow(ui, 'installed', 'beta');
  for (const action of ['activity-logs-action', 'activity-reload-action', 'activity-toggle-action', 'activity-remove-action']) {
    const oldButton = ui.elements.get('inspector-content').querySelector(`.${action}`);
    oldButton.focus();
    records[1].name = `Beta ${action}`;
    ui.setInstalled(records);
    ui.poll();
    await new Promise((resolve) => setImmediate(resolve));
    const newButton = ui.elements.get('inspector-content').querySelector(`.${action}`);
    assert.notEqual(newButton, oldButton);
    assert.equal(ui.document.activeElement, newButton);
    assert.equal(newButton.focusOptions.preventScroll, true);
  }
});

test('A focused Reload action moves to Enable when that Activity becomes disabled', async () => {
  const records = diagnosticRecords();
  const ui = await createLibrary({ installed: records, developerMode: true });
  await showView(ui, 'installed');
  ui.elements.get('inspector-content').querySelector('.activity-reload-action').focus();
  records[0].enabled = false;
  records[0].status = 'disabled';
  ui.setInstalled(records);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('inspector-content').querySelector('.activity-reload-action').disabled, true);
  const enable = ui.elements.get('inspector-content').querySelector('.activity-toggle-action');
  assert.equal(enable.textContent, 'Enable');
  assert.equal(ui.document.activeElement, enable);
  assert.equal(enable.focusOptions.preventScroll, true);
});

function pageAccessLibrary() {
  const entry = {
    id: 'page-access', name: 'Page access', version: '2.0.0', apiVersion: 2,
    description: 'Page access disclosure fixture', matches: ['https://example.test/*'],
    pageAccess: { url: true, queryParameters: ['video'] },
  };
  return { catalog: { activities: [entry] }, installed: [
    { ...entry, version: '1.0.0', enabled: true, status: 'waiting', source: { type: 'repository' } },
  ] };
}

test('Discover, Installed, and Updates load V2 catalog icons from the pinned V2 repository', async () => {
  const state = pageAccessLibrary();
  const entry = state.catalog.activities[0];
  entry.icon = `activities/${entry.id}/icon.png`;
  entry.catalogSource = { repository: 'ChudForks/ChudPresence-Activities-V2', revision: 'b'.repeat(40) };
  const ui = await createLibrary(state);
  for (const grid of ['discover-list', 'installed-list', 'updates-list']) {
    assert.equal(ui.elements.get(grid).querySelector('.activity-logo-image').src,
      `https://raw.githubusercontent.com/ChudForks/ChudPresence-Activities-V2/${'b'.repeat(40)}/${entry.icon}`);
  }
});

test('Live diagnostics update without replacing unchanged rows or the selected inspector', async () => {
  const state = pageAccessLibrary();
  const ui = await createLibrary({ ...state, developerMode: true });
  const lists = ['discover-list', 'installed-list', 'updates-list'];
  const rows = lists.map((id) => ui.elements.get(id).children[0]);
  const detail = inspectorDetail(ui);
  const access = detail.querySelector('.card-page-access');
  access.open = true;
  state.installed[0].activityLogs = [{ timestamp: '2026-10-15T12:00:00Z', level: 'info', args: ['New live diagnostic'] }];
  ui.setInstalled(state.installed);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  for (const [index, id] of lists.entries()) assert.equal(ui.elements.get(id).children[0], rows[index]);
  assert.equal(inspectorDetail(ui), detail);
  assert.equal(inspectorDetail(ui).querySelector('.card-page-access').open, true);
  assert.match(ui.elements.get('developer-log-output').value, /New live diagnostic/);
});

test('Installed inspector keeps its controls when only diagnostic keys change', async () => {
  const records = diagnosticRecords();
  records[0].settings = [{ id: 'label', type: 'string', label: 'Label', default: 'Original' }];
  const ui = await createLibrary({ installed: records, developerMode: true });
  await showView(ui, 'installed');
  const detail = inspectorDetail(ui);
  const setting = detail.querySelector('input');
  const updated = diagnosticRecords();
  updated[0].settings = records[0].settings;
  updated[0].activityLogs.push({ timestamp: '2026-10-15T12:00:05Z', level: 'info', args: ['Installed-only diagnostic marker'] });
  updated[0].networkRequests.push({ startedAt: '2026-10-15T12:00:06Z', method: 'GET', url: 'https://alpha.test/new', state: 'complete', status: 200 });
  updated[0].normalizedReport = { media: { title: 'Updated installed snapshot' } };
  ui.setInstalled(updated);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspectorDetail(ui), detail);
  assert.equal(inspectorDetail(ui).querySelector('input'), setting);
  assert.match(ui.elements.get('developer-log-output').value, /Installed-only diagnostic marker/);
});

for (const view of ['discover', 'installed', 'updates']) {
  for (const pending of [false, true]) {
    test(`${view} preserves declared access and keyboard focus across a card update${pending ? ' already in flight' : ''}`, async () => {
      const state = pageAccessLibrary();
      const ui = await createLibrary(state);
      await showView(ui, view);
      const original = ui.elements.get('inspector-content').querySelector('.card-page-access');
      const summary = original.querySelector('summary');
      state.installed[0].version = '1.1.0';
      ui.setInstalled(state.installed);
      if (pending) ui.poll();
      original.open = true;
      original.querySelector('.page-access-list').scrollTop = 70;
      summary.focus();
      if (!pending) ui.poll();
      await new Promise((resolve) => setImmediate(resolve));
      const refreshed = ui.elements.get('inspector-content').querySelector('.card-page-access');
      assert.notEqual(refreshed, original);
      assert.equal(refreshed.open, true);
      assert.equal(refreshed.querySelector('.page-access-list').tag, 'ul');
      assert.deepEqual(refreshed.querySelector('.page-access-list').children.map((item) => [item.tag, item.textContent]), [
        ['li', 'Page origin and path'], ['li', 'Query parameters: video'],
      ]);
      assert.equal(refreshed.querySelector('.page-access-list').scrollTop, 70);
      assert.equal(ui.document.activeElement, refreshed.querySelector('summary'));
      assert.equal(ui.document.activeElement.focusOptions.preventScroll, true);

      refreshed.open = false;
      state.installed[0].version = '1.2.0';
      ui.setInstalled(state.installed);
      ui.poll();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(ui.elements.get('inspector-content').querySelector('.card-page-access').open, false);
    });
  }
}

test('Discover remembers disclosures through filtering without opening them in another Library view', async () => {
  const ui = await createLibrary(pageAccessLibrary());
  const grid = ui.elements.get('discover-list');
  ui.elements.get('inspector-content').querySelector('.card-page-access').open = true;
  const search = ui.elements.get('search');
  search.value = 'no matching Activity';
  await search.emit('input');
  assert.equal(grid.children[0].className, 'empty-state');
  assert.equal(inspectorDetail(ui), null);
  search.value = '';
  await search.emit('input');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'page-access');
  assert.equal(ui.elements.get('inspector-content').querySelector('.card-page-access').open, true);
  await showView(ui, 'installed');
  assert.equal(ui.elements.get('inspector-content').querySelector('.card-page-access').open, false);
});

function simpleCatalogEntries() {
  return ['alpha', 'beta', 'gamma'].map((id) => ({
    id, name: id.toUpperCase(), version: '1.0.0', apiVersion: 2,
    description: `${id} Activity`, matches: [`https://${id}.example.test/*`],
    pageAccess: { url: true },
  }));
}

test('Discover search matches aliases and tags and combines with category filtering', async () => {
  const entries = [
    { id: 'alpha', name: 'Alpha Audio', description: 'Audio player', category: 'music', aliases: ['moon alias'], tags: ['indie-tag'], version: '1.0.0', apiVersion: 2, matches: ['https://alpha.example.test/*'] },
    { id: 'beta', name: 'Beta Video', description: 'Video player', category: 'media', aliases: ['screen name'], tags: ['cinema-tag'], version: '1.0.0', apiVersion: 2, matches: ['https://beta.example.test/*'] },
    { id: 'gamma', name: 'Gamma Audio', description: 'Another player', category: 'music', aliases: [], tags: ['ambient-tag'], version: '1.0.0', apiVersion: 2, matches: ['https://gamma.example.test/*'] },
  ];
  const ui = await createLibrary({ catalog: { activities: entries } });
  const search = ui.elements.get('search');
  const category = ui.elements.get('category-filter');
  const visibleIds = () => ui.elements.get('discover-list').children.map((row) => row.dataset.activityId).filter(Boolean);

  search.value = 'moon alias';
  await search.emit('input');
  assert.deepEqual(visibleIds(), ['alpha']);
  search.value = 'cinema-tag';
  await search.emit('input');
  assert.deepEqual(visibleIds(), ['beta']);

  search.value = '';
  category.value = 'music';
  await category.emit('change');
  assert.deepEqual(visibleIds(), ['alpha', 'gamma']);
  search.value = 'Beta';
  await search.emit('input');
  assert.deepEqual(visibleIds(), []);
  assert.equal(inspectorDetail(ui), null);
  category.value = 'all';
  await category.emit('change');
  assert.deepEqual(visibleIds(), ['beta']);
  assert.equal(inspectorDetail(ui).dataset.activityId, 'beta');
});

test('The inspector states V1 trust clearly and lists V2 page reads and network origins', async () => {
  const entries = [
    { id: 'trusted-v1', name: 'Trusted V1', version: '1.0.0', apiVersion: 1, matches: ['https://v1.example.test/*'] },
    { id: 'sandboxed-v2', name: 'Sandboxed V2', version: '1.0.0', apiVersion: 2,
      matches: ['https://v2.example.test/*'], network: ['https://api.example.test/*'],
      pageAccess: { url: true, queryParameters: ['video'] } },
  ];
  const ui = await createLibrary({ catalog: { activities: entries } });
  const trusted = inspectorDetail(ui);
  assert.equal(trusted.dataset.activityId, 'trusted-v1');
  assert.equal(trusted.querySelector('.trust-label').textContent, 'Trusted Activity code');
  assert.match(textContentTree(trusted), /V1 code can read page content/);
  assert.equal(trusted.querySelector('.card-page-access'), null);

  await selectRow(ui, 'discover', 'sandboxed-v2');
  const sandboxed = inspectorDetail(ui);
  assert.equal(sandboxed.querySelector('.trust-label').textContent, 'Sandboxed Activity');
  assert.match(textContentTree(sandboxed), /Page reads are limited to the fields declared below/);
  assert.deepEqual(sandboxed.querySelector('.page-access-list').children.map((item) => item.textContent), [
    'Page origin and path', 'Query parameters: video',
  ]);
  assert.match(textContentTree(sandboxed), /Additional network access is requested for these declared origins/);
  assert.match(textContentTree(sandboxed), /https:\/\/api\.example\.test\/\*/);
});

test('Activity rows select one item and support Arrow, Home, and End navigation', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() } });
  const list = ui.elements.get('discover-list');
  const selectors = list.children.map((row) => row.querySelector('.activity-select'));
  assert.deepEqual(selectors.map((button) => button.tabIndex), [0, -1, -1]);
  assert.deepEqual(selectors.map((button) => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  for (const row of list.children) {
    assert.equal(row.querySelectorAll('.activity-select').length, 1);
    assert.equal(row.querySelector('.activity-select').querySelector('button'), null);
    assert.ok(row.querySelector('.activity-quick-action'));
    assert.equal(row.querySelector('.activity-settings'), null);
    assert.equal(row.querySelector('.card-page-access'), null);
  }

  let prevented = false;
  await selectors[0].emit('keydown', { key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const beta = listRow(ui, 'discover', 'beta').querySelector('.activity-select');
  assert.equal(ui.document.activeElement, beta);
  assert.equal(beta.tabIndex, 0);
  assert.equal(beta.getAttribute('aria-pressed'), 'true');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'beta');

  await beta.emit('keydown', { key: 'End', preventDefault() {} });
  const gamma = listRow(ui, 'discover', 'gamma').querySelector('.activity-select');
  assert.equal(ui.document.activeElement, gamma);
  assert.equal(gamma.getAttribute('aria-pressed'), 'true');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'gamma');

  await gamma.emit('keydown', { key: 'Home', preventDefault() {} });
  const alpha = listRow(ui, 'discover', 'alpha').querySelector('.activity-select');
  assert.equal(ui.document.activeElement, alpha);
  assert.equal(alpha.getAttribute('aria-pressed'), 'true');
  assert.equal(inspectorDetail(ui).dataset.activityId, 'alpha');
});

test('Selecting an Activity opens its details and closing returns focus to the catalog', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() }, narrow: true });
  const inspector = ui.elements.get('activity-inspector');
  const betaRow = listRow(ui, 'discover', 'beta');
  const betaButton = betaRow.querySelector('.activity-select');
  await betaButton.emit('click');
  assert.equal(inspector.classList.contains('is-open'), true);
  assert.equal(inspectorDetail(ui).dataset.activityId, 'beta');
  assert.equal(ui.document.activeElement, inspectorDetail(ui).querySelector('.inspector-name'));

  await ui.elements.get('inspector-close').emit('click');
  assert.equal(inspector.classList.contains('is-open'), false);
  assert.equal(ui.document.activeElement, betaButton);
});

test('Full-width details retain filters on Escape and restore the catalog when changing sections', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() } });
  const search = ui.elements.get('search');
  search.value = 'beta';
  await search.emit('input');
  const button = listRow(ui, 'discover', 'beta').querySelector('.activity-select');
  await button.emit('click');
  const inspector = ui.elements.get('activity-inspector');
  assert.equal(inspector.hidden, false);
  assert.equal(ui.elements.get('catalog-region').hidden, true);
  assert.equal(ui.document.activeElement, inspectorDetail(ui).querySelector('.inspector-name'));
  let prevented = false;
  await inspector.emit('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(inspector.hidden, true);
  assert.equal(ui.elements.get('catalog-region').hidden, false);
  assert.equal(search.value, 'beta');
  assert.equal(ui.document.activeElement, button);
  await button.emit('click');
  await showView(ui, 'installed');
  assert.equal(inspector.hidden, true);
  assert.equal(ui.elements.get('catalog-region').hidden, false);
  assert.equal(ui.elements.get('installed-view').hidden, false);
});

test('Catalog layout switching preserves selection and survives background refreshes', async () => {
  const ui = await createLibrary({ catalog: { activities: simpleCatalogEntries() } });
  const list = ui.elements.get('discover-list');
  await list.children[0].querySelector('.activity-select').emit('keydown', { key: 'ArrowRight', preventDefault() {} });
  const selected = listRow(ui, 'discover', 'beta');
  await ui.elements.get('layout-list').emit('click');
  await ui.poll();
  assert.equal(ui.elements.get('library-layout').classList.contains('is-list'), true);
  assert.equal(ui.elements.get('layout-list').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.elements.get('layout-grid').getAttribute('aria-pressed'), 'false');
  assert.equal(listRow(ui, 'discover', 'beta'), selected);
  assert.equal(selected.querySelector('.activity-select').getAttribute('aria-pressed'), 'true');
  await ui.elements.get('layout-grid').emit('click');
  assert.equal(ui.elements.get('library-layout').classList.contains('is-list'), false);
  assert.equal(selected.querySelector('.activity-select').getAttribute('aria-pressed'), 'true');
});

test('Catalog search includes declared websites and service URLs', async () => {
  const entries = simpleCatalogEntries();
  entries[0].matches = ['https://playback.example.test/*'];
  entries[1].serviceUrl = 'https://articles.example.test/';
  const ui = await createLibrary({ catalog: { activities: entries } });
  const search = ui.elements.get('search');
  for (const [query, id] of [['playback.example.test', 'alpha'], ['articles.example.test', 'beta']]) {
    search.value = query;
    await search.emit('input');
    assert.deepEqual(ui.elements.get('discover-list').children.map(row => row.dataset.activityId), [id]);
  }
});

test('Activity settings and advanced management stay in the inspector alongside quick removal on cards', async () => {
  const managed = {
    ...record, apiVersion: 2, pageAccess: { url: true },
    settings: [{ id: 'label', type: 'string', label: 'Label', default: 'Original' }],
  };
  const ui = await createLibrary({ installed: [managed], developerMode: true });
  await showView(ui, 'installed');
  const row = listRow(ui, 'installed', managed.id);
  const detail = inspectorDetail(ui);

  assert.equal(row.querySelectorAll('.activity-select').length, 1);
  assert.equal(row.querySelector('.activity-select').querySelector('button'), null);
  assert.equal(row.querySelector('.activity-quick-action').textContent, 'Remove');
  assert.ok(row.querySelector('.activity-select'));
  for (const selector of ['.activity-settings', '.card-page-access', '.activity-toggle-action', '.activity-remove-action', '.activity-reload-action']) {
    assert.equal(row.querySelector(selector), null);
  }
  assert.ok(detail.querySelector('.activity-settings'));
  assert.ok(detail.querySelector('.card-page-access'));
  for (const selector of ['.activity-logs-action', '.activity-reload-action', '.activity-toggle-action', '.activity-remove-action']) {
    assert.ok(detail.querySelector(selector), `expected inspector control ${selector}`);
  }
});

test('quick Add switches to Remove and back without leaving filtered Discover or opening details', async () => {
  const entry = { ...simpleCatalogEntries()[0], category: 'music' };
  let stored = [];
  const ui = await createLibrary({ catalog: { activities: [entry] }, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_INSTALL') {
      stored = [{ ...message.activityPackage.metadata, enabled: true, source: { type: 'repository' } }];
      return { ok: true, result: stored[0] };
    }
    if (message.type === 'ACTIVITY_REMOVE') {
      stored = stored.filter(({ id }) => id !== message.id);
      return { ok: true, result: {} };
    }
  }, downloadActivityImpl: async () => ({ metadata: entry, source: 'fixture' }) });
  await choose(ui, 'category-filter', 'music');
  const search = ui.elements.get('search');
  search.value = 'alpha';
  await search.emit('input');
  const quickAction = () => listRow(ui, 'discover', entry.id).querySelector('.activity-quick-action');
  assert.equal(quickAction().textContent, 'Add');
  assert.equal(quickAction().getAttribute('aria-label'), 'Add ALPHA');
  quickAction().focus();
  await quickAction().emit('click');
  assert.equal(quickAction().textContent, 'Remove');
  assert.equal(ui.document.activeElement, quickAction());
  assert.equal(ui.elements.get('installed-count').textContent, '1');
  await quickAction().emit('click');
  assert.equal(quickAction().textContent, 'Add');
  assert.equal(ui.document.activeElement, quickAction());
  assert.equal(ui.elements.get('installed-count').textContent, '0');
  assert.equal(ui.elements.get('category-filter').value, 'music');
  assert.equal(search.value, 'alpha');
  assert.equal(ui.elements.get('discover-view').hidden, false);
  assert.equal(ui.elements.get('activity-inspector').hidden, true);
  assert.equal(ui.calls.filter(({ type }) => type === 'ACTIVITY_INSTALL').length, 1);
  assert.equal(ui.calls.filter(({ type }) => type === 'ACTIVITY_REMOVE').length, 1);
});

test('installed cards offer Remove for disabled, local, bundled, and incompatible packages', async () => {
  const entries = simpleCatalogEntries();
  entries[2].minExtensionVersion = '99.0.0';
  const stored = entries.map((entry, index) => ({ ...entry, enabled: false, status: 'disabled',
    source: { type: ['local', 'bundled', 'repository'][index] } }));
  const ui = await createLibrary({ installed: stored, catalog: { activities: entries } });
  for (const view of ['discover', 'installed']) {
    for (const entry of entries) {
      const action = listRow(ui, view, entry.id).querySelector('.activity-quick-action');
      assert.equal(action.textContent, 'Remove');
      assert.equal(action.disabled, false);
    }
  }
});

test('quick Add respects compatibility and prevents repeated clicks while a download is pending', async () => {
  const entries = simpleCatalogEntries();
  entries[1].apiVersion = 999;
  entries[2].minExtensionVersion = '99.0.0';
  let rejectDownload;
  const pending = new Promise((_, reject) => { rejectDownload = reject; });
  let downloads = 0;
  const ui = await createLibrary({ catalog: { activities: entries }, downloadActivityImpl: () => {
    downloads++;
    return pending;
  } });
  for (const entry of entries.slice(1)) {
    const action = listRow(ui, 'discover', entry.id).querySelector('.activity-quick-action');
    assert.equal(action.disabled, true);
    assert.match(action.title, /Requires/);
    await action.emit('click');
  }
  const add = listRow(ui, 'discover', 'alpha').querySelector('.activity-quick-action');
  const adding = add.emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(add.disabled, true);
  assert.equal(add.getAttribute('aria-busy'), 'true');
  await add.emit('click');
  assert.equal(downloads, 1);
  // A background refresh must not create an enabled duplicate action.
  ui.setInstalled([{ ...record, id: 'unrelated', status: 'detected' }]);
  await ui.poll();
  await new Promise(resolve => setImmediate(resolve));
  const refreshingAdd = listRow(ui, 'discover', 'alpha').querySelector('.activity-quick-action');
  assert.notEqual(refreshingAdd, add);
  assert.equal(refreshingAdd.disabled, true);
  assert.equal(refreshingAdd.getAttribute('aria-busy'), 'true');
  await refreshingAdd.emit('click');
  assert.equal(downloads, 1);
  rejectDownload(new Error('Download failed'));
  await adding;
  const retry = listRow(ui, 'discover', 'alpha').querySelector('.activity-quick-action');
  assert.equal(retry.disabled, false);
  assert.equal(retry.textContent, 'Add');
  assert.match(ui.elements.get('catalog-notice').textContent, /Download failed/);
  assert.equal(ui.elements.get('activity-inspector').hidden, true);
});

test('quick removal keeps focus on the next Installed card and the tab when the list becomes empty', async () => {
  let stored = simpleCatalogEntries().slice(0, 2).map(entry => ({ ...entry, source: { type: 'repository' } }));
  const ui = await createLibrary({ installed: stored, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE') {
      return { ok: true, result: { installed: structuredClone(stored), userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_REMOVE') {
      stored = stored.filter(({ id }) => id !== message.id);
      return { ok: true, result: {} };
    }
  } });
  await showView(ui, 'installed');
  const first = listRow(ui, 'installed', 'alpha').querySelector('.activity-quick-action');
  first.focus();
  await first.emit('click');
  const next = listRow(ui, 'installed', 'beta').querySelector('.activity-quick-action');
  assert.equal(ui.document.activeElement, next);
  await next.emit('click');
  assert.equal(ui.document.activeElement, ui.elements.get('tab-installed'));
  assert.equal(ui.elements.get('activity-inspector').hidden, true);
});

test('Library tabs support click selection and standard keyboard navigation', async () => {
  const ui = await createLibrary();
  const tabs = ['discover', 'installed', 'updates', 'developer'].map((view) => ui.elements.get(`tab-${view}`));
  await tabs[1].emit('click');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false');
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(ui.elements.get('installed-view').hidden, false);
  assert.equal(ui.elements.get('discover-view').hidden, true);

  for (const [from, key, to] of [[1, 'ArrowRight', 2], [2, 'End', 3], [3, 'ArrowRight', 0], [0, 'ArrowLeft', 3], [3, 'Home', 0]]) {
    let prevented = false;
    await tabs[from].emit('keydown', { key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.document.activeElement, tabs[to]);
    assert.equal(tabs[to].scrollIntoViewOptions.inline, 'nearest');
    assert.equal(tabs[to].scrollIntoViewOptions.block, 'nearest');
    assert.equal(tabs[to].scrollIntoViewOptions.behavior, 'instant');
    assert.equal(tabs[to].getAttribute('aria-selected'), 'true');
    assert.equal(tabs[to].tabIndex, 0);
    assert.equal(ui.elements.get(`${tabs[to].dataset.view}-view`).hidden, false);
    assert.equal(tabs.filter((tab) => tab.tabIndex === 0).length, 1);
    assert.equal(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length, 1);
  }
});

function diagnosticRecords() {
  return [
    {
      id: 'alpha', name: 'Alpha', version: '1.0.0', apiVersion: 1, enabled: true,
      activityLogs: [
        { timestamp: '2026-10-13T12:00:00Z', level: 'info', args: ['Alpha info marker'], tabId: 1, frameId: 0 },
        { timestamp: '2026-10-13T12:00:01Z', level: 'debug', args: ['Alpha debug marker'], tabId: 1, frameId: 0 },
      ],
      networkRequests: [{ startedAt: '2026-10-13T12:00:02Z', method: 'GET', url: 'https://alpha.test/resource', state: 'complete', status: 200 }],
      normalizedReport: { media: { title: 'Alpha playback marker' }, playback: { state: 'playing' } },
    },
    {
      id: 'beta', name: 'Beta', version: '1.0.0', apiVersion: 1, enabled: true,
      activityLogs: [{ timestamp: '2026-10-13T12:00:03Z', level: 'warn', args: ['Beta warning marker'], tabId: 2, frameId: 0 }],
      networkRequests: [{ startedAt: '2026-10-13T12:00:04Z', method: 'POST', url: 'https://beta.test/resource', state: 'error', errorCode: 'network_error' }],
      normalizedReport: { media: { title: 'Beta playback marker' }, playback: { state: 'paused' } },
    },
  ];
}

async function choose(ui, id, value) {
  const control = ui.elements.get(id);
  control.value = value;
  await control.emit('change');
}

test('Developer console combines Activity, diagnostic kind, and log level filters', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
  const output = ui.elements.get('developer-log-output');
  assert.equal(output.readOnly, true);
  assert.match(output.value, /Alpha info marker/);
  assert.match(output.value, /Beta warning marker/);
  assert.match(output.value, /Alpha playback marker/);

  await choose(ui, 'developer-log-activity', 'alpha');
  await choose(ui, 'developer-log-kind', 'logs');
  await choose(ui, 'developer-log-level', 'info');
  assert.match(output.value, /Alpha info marker/);
  assert.doesNotMatch(output.value, /Alpha debug marker|Beta warning marker|alpha\.test|Alpha playback marker/);
  assert.equal(ui.elements.get('developer-log-count').textContent, '1 entry');

  await choose(ui, 'developer-log-kind', 'network');
  assert.match(output.value, /https:\/\/alpha\.test\/resource/);
  assert.doesNotMatch(output.value, /Beta|Alpha info marker|Alpha playback marker/);
  assert.equal(ui.elements.get('developer-log-level').disabled, true);

  await choose(ui, 'developer-log-kind', 'snapshots');
  assert.match(output.value, /Alpha playback marker/);
  assert.doesNotMatch(output.value, /Beta|Alpha info marker/);
  assert.equal(ui.elements.get('developer-log-count').textContent, '1 Activity');
});

test('Developer console copies exactly the visible filters and selects all for manual copying', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
  await choose(ui, 'developer-log-activity', 'beta');
  await choose(ui, 'developer-log-kind', 'logs');
  const output = ui.elements.get('developer-log-output');
  const visible = output.value;
  await ui.elements.get('developer-copy-logs').emit('click');
  assert.deepEqual(ui.copied, [visible]);
  assert.match(ui.elements.get('developer-log-status').textContent, /copied/i);
  await ui.elements.get('developer-select-logs').emit('click');
  assert.equal(ui.document.activeElement, output);
  assert.deepEqual([output.selectionStart, output.selectionEnd], [0, visible.length]);
});

test('Clipboard failures select the visible diagnostics and explain Ctrl+C', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
  ui.failCopy();
  const output = ui.elements.get('developer-log-output');
  const visible = output.value;
  await ui.elements.get('developer-copy-logs').emit('click');
  assert.deepEqual(ui.copied, []);
  assert.equal(output.value, visible);
  assert.equal(ui.document.activeElement, output);
  assert.deepEqual([output.selectionStart, output.selectionEnd], [0, visible.length]);
  assert.match(ui.elements.get('developer-log-status').textContent, /Ctrl\+C/);
});

for (const pending of [false, true]) {
  test(`Developer polling preserves selected diagnostic text${pending ? ' when focus starts during a pending response' : ''}`, async () => {
    const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
    await choose(ui, 'developer-log-kind', 'logs');
    const output = ui.elements.get('developer-log-output');
    const visible = output.value;
    const next = diagnosticRecords();
    next[0].activityLogs.push({ timestamp: '2026-10-13T12:00:05Z', level: 'info', args: ['New polling marker'] });
    ui.setInstalled(next);
    if (pending) ui.poll();
    output.focus();
    output.setSelectionRange(10, 30);
    output.scrollTop = 75;
    if (!pending) ui.poll();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ui.elements.get('developer-log-output'), output);
    assert.equal(output.value, visible);
    assert.deepEqual([output.selectionStart, output.selectionEnd, output.scrollTop], [10, 30, 75]);

    ui.document.activeElement = null;
    await output.emit('blur');
    assert.match(output.value, /New polling marker/);
  });
}

test('Paused diagnostics keep collecting while filters apply to the held snapshot', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
  const pause = ui.elements.get('developer-pause-logs');
  const output = ui.elements.get('developer-log-output');
  pause.checked = true;
  await pause.emit('change');
  const visible = output.value;
  const next = diagnosticRecords();
  next[0].activityLogs.push({ timestamp: '2026-10-13T12:00:05Z', level: 'info', args: ['Collected while paused'] });
  next[0].normalizedReport.media.title = 'Updated while paused';
  ui.setInstalled(next);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(output.value, visible);
  await choose(ui, 'developer-log-activity', 'alpha');
  await choose(ui, 'developer-log-kind', 'logs');
  assert.match(output.value, /Alpha info marker/);
  assert.doesNotMatch(output.value, /Collected while paused|Beta warning marker/);
  pause.checked = false;
  await pause.emit('change');
  assert.match(output.value, /Collected while paused/);
  assert.doesNotMatch(output.value, /Beta warning marker/);
});

test('Paused runtime snapshots remain unchanged when an Activity setting is saved', async () => {
  const records = diagnosticRecords();
  records[0].settings = [{ id: 'label', type: 'string', label: 'Label', default: 'Original setting' }];
  records[0].settingValues = { label: 'Original setting' };
  const ui = await createLibrary({ installed: records, developerMode: true });
  await choose(ui, 'developer-log-activity', 'alpha');
  await choose(ui, 'developer-log-kind', 'snapshots');
  const pause = ui.elements.get('developer-pause-logs');
  pause.checked = true;
  await pause.emit('change');
  await showView(ui, 'installed');
  const setting = ui.elements.get('inspector-content').querySelector('input');
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('inspector-content').querySelector('input'), setting);
  setting.value = 'Saved while paused';
  ui.failState();
  await setting.emit('change');

  // Changing a filter redraws the held snapshot after the installed record was
  // edited locally by the successful save, without a replacement worker state.
  await choose(ui, 'developer-log-kind', 'all');
  const output = ui.elements.get('developer-log-output');
  assert.match(output.value, /Original setting/);
  assert.doesNotMatch(output.value, /Saved while paused/);
  pause.checked = false;
  await pause.emit('change');
  assert.match(output.value, /Saved while paused/);
});

test('Activity selection survives refreshed names and returns to all when an Activity is removed', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true });
  await choose(ui, 'developer-log-activity', 'alpha');
  await choose(ui, 'developer-log-kind', 'logs');
  const records = diagnosticRecords();
  records[0].name = 'Renamed Alpha';
  ui.setInstalled(records);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('developer-log-activity').value, 'alpha');
  assert.match(ui.elements.get('developer-log-output').value, /Alpha info marker/);
  assert.doesNotMatch(ui.elements.get('developer-log-output').value, /Beta warning marker/);
  ui.setInstalled([records[1]]);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('developer-log-activity').value, '');
  assert.match(ui.elements.get('developer-log-output').value, /Beta warning marker/);
  assert.doesNotMatch(ui.elements.get('developer-log-output').value, /Alpha info marker/);
});

test('Clearing selected or all history keeps filters and refreshes even a paused selection', async () => {
  let records = diagnosticRecords();
  let ui;
  ui = await createLibrary({ installed: records, developerMode: true, respond(message) {
    if (message.type !== 'ACTIVITY_CLEAR_DIAGNOSTICS') return;
    records = records.map((record) => message.id && message.id !== record.id ? record
      : { ...record, activityLogs: [], networkRequests: [] });
    ui.setInstalled(records);
    return { ok: true, result: { activityLogsCleared: 2, networkRequestsCleared: 1, diagnosticsCleared: 1, pendingNetworkRequests: message.id ? 1 : 0 } };
  } });
  await choose(ui, 'developer-log-activity', 'alpha');
  await choose(ui, 'developer-log-kind', 'logs');
  const pause = ui.elements.get('developer-pause-logs');
  pause.checked = true;
  await pause.emit('change');
  ui.elements.get('developer-log-output').focus();
  await ui.elements.get('developer-clear-logs').emit('click');
  const selectedClear = ui.calls.find((call) => call.type === 'ACTIVITY_CLEAR_DIAGNOSTICS');
  assert.deepEqual({ ...selectedClear }, { type: 'ACTIVITY_CLEAR_DIAGNOSTICS', id: 'alpha' });
  assert.equal(ui.elements.get('developer-log-activity').value, 'alpha');
  assert.equal(ui.elements.get('developer-log-kind').value, 'logs');
  assert.doesNotMatch(ui.elements.get('developer-log-output').value, /Alpha info marker|Alpha debug marker/);
  assert.match(ui.elements.get('developer-log-status').textContent, /1 network request is still running/);
  assert.equal(ui.elements.get('developer-clear-logs').disabled, false);

  await choose(ui, 'developer-log-activity', '');
  assert.match(ui.elements.get('developer-log-output').value, /Beta warning marker/);
  await ui.elements.get('developer-clear-logs').emit('click');
  const allClear = ui.calls.filter((call) => call.type === 'ACTIVITY_CLEAR_DIAGNOSTICS').at(-1);
  assert.deepEqual({ ...allClear }, { type: 'ACTIVITY_CLEAR_DIAGNOSTICS' });
  assert.doesNotMatch(ui.elements.get('developer-log-output').value, /Beta warning marker/);
});

test('A failed clear preserves diagnostics and leaves the action available to retry', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true, respond(message) {
    if (message.type === 'ACTIVITY_CLEAR_DIAGNOSTICS') return { ok: false, error: 'History clear rejected' };
  } });
  const output = ui.elements.get('developer-log-output');
  const visible = output.value;
  await ui.elements.get('developer-clear-logs').emit('click');
  assert.equal(output.value, visible);
  assert.match(ui.elements.get('developer-log-status').textContent, /History clear rejected/);
  assert.equal(ui.elements.get('developer-clear-logs').disabled, false);
});

test('A poll started before clearing history cannot restore the cleared entries', async () => {
  let records = diagnosticRecords();
  let holdNextState = false;
  let releaseOldPoll;
  const oldPollBlocked = new Promise((resolve) => { releaseOldPoll = resolve; });
  let markOldPollStarted;
  const oldPollStarted = new Promise((resolve) => { markOldPollStarted = resolve; });
  let ui;
  ui = await createLibrary({ installed: records, developerMode: true, async respond(message) {
    if (message.type === 'ACTIVITY_LIBRARY_STATE' && holdNextState) {
      holdNextState = false;
      const staleRecords = structuredClone(records);
      markOldPollStarted();
      await oldPollBlocked;
      return { ok: true, result: { installed: staleRecords, userScriptsPermission: true } };
    }
    if (message.type === 'ACTIVITY_CLEAR_DIAGNOSTICS') {
      records = records.map((record) => ({ ...record, activityLogs: [], networkRequests: [] }));
      ui.setInstalled(records);
      return { ok: true, result: { activityLogsCleared: 3, networkRequestsCleared: 2, diagnosticsCleared: 2, pendingNetworkRequests: 0 } };
    }
  } });
  await choose(ui, 'developer-log-kind', 'logs');
  holdNextState = true;
  ui.poll();
  await oldPollStarted;
  await ui.elements.get('developer-clear-logs').emit('click');
  const output = ui.elements.get('developer-log-output');
  assert.doesNotMatch(output.value, /Alpha info marker|Beta warning marker/);
  releaseOldPoll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(output.value, /Alpha info marker|Beta warning marker/);
  assert.equal(ui.elements.get('developer-log-count').textContent, '0 entries');
});

test('A successful clear reports that history was cleared when the following refresh fails', async () => {
  const ui = await createLibrary({ installed: diagnosticRecords(), developerMode: true, respond(message) {
    if (message.type === 'ACTIVITY_CLEAR_DIAGNOSTICS') return { ok: true, result: { pendingNetworkRequests: 0 } };
  } });
  ui.failState();
  await ui.elements.get('developer-clear-logs').emit('click');
  const status = ui.elements.get('developer-log-status').textContent;
  assert.match(status, /cleared/i);
  assert.match(status, /refresh/i);
  assert.match(status, /Worker unavailable/);
  assert.equal(ui.elements.get('developer-clear-logs').disabled, false);
});
