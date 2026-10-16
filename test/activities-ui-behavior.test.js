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
}

async function createLibrary({ installed = [], catalog = null, developerMode = false, respond = null } = {}) {
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
    querySelectorAll: (selector) => [...elements.values()].filter((node) => node.matches(selector)),
  };
  for (const node of elements.values()) node.ownerDocument = document;
  const calls = [];
  const copied = [];
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
    userScripts: { execute() {} },
  };
  const context = vm.createContext({
    ...validator, ...developerDiagnostics, ...browserPlatform, document, chrome, JSON, URL, Uint8Array, btoa, structuredClone,
    navigator: { clipboard: { async writeText(value) { if (failCopy) throw new Error('Clipboard unavailable'); copied.push(value); } } },
    location: { href: 'https://example.test/activities.html' },
    Option: class extends Element { constructor(label, value) { super('option'); this.textContent = label; this.value = value; } },
    activityCatalogIconUrl,
    compareActivityVersions,
    readCatalogCache: async () => ({ catalog, fetchedAt: 0 }),
    requestHostPermissions: async () => true,
    setInterval: (callback) => { polling = callback; },
  });
  vm.runInContext(source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, ''), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    document, elements, calls, copied, poll: () => polling(),
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

test('a rejected Activity setting remains editable when the worker cannot refresh', async () => {
  const ui = await createLibrary({ installed: [record] });
  const input = ui.elements.get('installed-list').querySelector('input');
  input.value = 'Changed';
  ui.failSave();
  ui.failState();
  await input.emit('change');
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Original');
  assert.match(ui.elements.get('page-status').textContent, /Setting rejected/);
});

test('a successful setting save survives a failed refresh and reports the refresh failure', async () => {
  const ui = await createLibrary({ installed: [record] });
  const input = ui.elements.get('installed-list').querySelector('input');
  input.value = 'Changed';
  ui.failState();
  await input.emit('change');
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'Changed');
  assert.match(ui.elements.get('page-status').textContent, /Saved, but Activity state could not refresh/);
  input.value = 'Rejected change';
  ui.failSave();
  await input.emit('change');
  assert.equal(input.value, 'Changed');
});

test('Library polling preserves text being edited in Activity settings', async () => {
  const ui = await createLibrary({ installed: [record] });
  const input = ui.elements.get('installed-list').querySelector('input');
  input.value = 'Unsaved text';
  ui.document.activeElement = input;
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('installed-list').querySelector('input'), input);
  assert.equal(input.value, 'Unsaved text');
});

test('a pending Library poll cannot replace a setting input when editing starts', async () => {
  const ui = await createLibrary({ installed: [record] });
  const input = ui.elements.get('installed-list').querySelector('input');
  ui.poll();
  input.value = 'Unsaved text';
  ui.document.activeElement = input;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('installed-list').querySelector('input'), input);
  assert.equal(input.value, 'Unsaved text');
});

test('Library polling preserves focus on the same Activity action without scrolling', async () => {
  const records = diagnosticRecords();
  const ui = await createLibrary({ installed: records, developerMode: true });
  ui.elements.get('installed-view').hidden = false;
  for (const action of ['activity-logs-action', 'activity-reload-action', 'activity-toggle-action', 'activity-remove-action']) {
    const oldCard = ui.elements.get('installed-list').children.find((card) => card.dataset.activityId === 'beta');
    const oldButton = oldCard.querySelector(`.${action}`);
    oldButton.focus();
    records[1].name = `Beta ${action}`;
    ui.setInstalled(records);
    ui.poll();
    await new Promise((resolve) => setImmediate(resolve));
    const newCard = ui.elements.get('installed-list').children.find((card) => card.dataset.activityId === 'beta');
    const newButton = newCard.querySelector(`.${action}`);
    assert.notEqual(newButton, oldButton);
    assert.equal(ui.document.activeElement, newButton);
    assert.equal(newButton.focusOptions.preventScroll, true);
  }
});

test('A focused Reload action moves to Enable when that Activity becomes disabled', async () => {
  const records = diagnosticRecords();
  const ui = await createLibrary({ installed: records, developerMode: true });
  ui.elements.get('installed-view').hidden = false;
  const oldCard = ui.elements.get('installed-list').children.find((card) => card.dataset.activityId === 'alpha');
  oldCard.querySelector('.activity-reload-action').focus();
  records[0].enabled = false;
  records[0].status = 'disabled';
  ui.setInstalled(records);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  const newCard = ui.elements.get('installed-list').children.find((card) => card.dataset.activityId === 'alpha');
  assert.equal(newCard.querySelector('.activity-reload-action').disabled, true);
  const enable = newCard.querySelector('.activity-toggle-action');
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

test('Live diagnostics update without replacing unchanged cards in any Library grid', async () => {
  const state = pageAccessLibrary();
  const ui = await createLibrary({ ...state, developerMode: true });
  const grids = ['discover-list', 'installed-list', 'updates-list'];
  const cards = grids.map((id) => ui.elements.get(id).children[0]);
  for (const card of cards) card.querySelector('.card-page-access').open = true;
  state.installed[0].activityLogs = [{ timestamp: '2026-10-15T12:00:00Z', level: 'info', args: ['New live diagnostic'] }];
  ui.setInstalled(state.installed);
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  for (const [index, id] of grids.entries()) {
    assert.equal(ui.elements.get(id).children[0], cards[index]);
    assert.equal(cards[index].querySelector('.card-page-access').open, true);
  }
  assert.match(ui.elements.get('developer-log-output').value, /New live diagnostic/);
});

for (const view of ['discover', 'installed', 'updates']) {
  for (const pending of [false, true]) {
    test(`${view} preserves declared access and keyboard focus across a card update${pending ? ' already in flight' : ''}`, async () => {
      const state = pageAccessLibrary();
      const ui = await createLibrary(state);
      const grid = ui.elements.get(`${view}-list`);
      const original = grid.children[0].querySelector('.card-page-access');
      const summary = original.querySelector('summary');
      state.installed[0].version = '1.1.0';
      ui.setInstalled(state.installed);
      if (pending) ui.poll();
      original.open = true;
      original.querySelector('.page-access-list').scrollTop = 70;
      summary.focus();
      if (!pending) ui.poll();
      await new Promise((resolve) => setImmediate(resolve));
      const refreshed = grid.children[0].querySelector('.card-page-access');
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
      assert.equal(grid.children[0].querySelector('.card-page-access').open, false);
    });
  }
}

test('Discover remembers disclosures through filtering without opening them in another Library view', async () => {
  const ui = await createLibrary(pageAccessLibrary());
  const grid = ui.elements.get('discover-list');
  grid.children[0].querySelector('.card-page-access').open = true;
  const search = ui.elements.get('search');
  search.value = 'no matching Activity';
  await search.emit('input');
  assert.equal(grid.children[0].className, 'empty-state');
  search.value = '';
  await search.emit('input');
  assert.equal(grid.children[0].querySelector('.card-page-access').open, true);
  assert.equal(ui.elements.get('installed-list').querySelector('.card-page-access').open, false);
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
  const setting = ui.elements.get('installed-list').querySelector('input');
  ui.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.elements.get('installed-list').querySelector('input'), setting);
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
