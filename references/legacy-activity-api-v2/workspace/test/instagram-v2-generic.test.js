import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { collectGenericActivityV2 } from '../extension/core/activity-v2-generic.js';
import { collectActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { validateActivityV2, validateV2Report, describeActivityV2, activityV2Digest, INSTAGRAM_LOGO_URL } from '../extension/core/activity-api-v2.js';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';

let source;
try { source = await fs.readFile(new URL('../ChudPresence-Activities-V2/activities/instagram/activity.json', import.meta.url), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = source && validateActivityV2(source);
const run = (name, fn) => test(name, { skip: !config && 'Local V2 Activities checkout unavailable' }, fn);

function element(tagName, properties = {}) {
  return { tagName, nodeType: 1, queries: {}, attributes: {}, childNodes: [], textContent: '',
    rect: { left: 0, top: 0, right: 320, bottom: 500 }, ...properties,
    matches(selector) { return selector === this.tagName.toLowerCase() || this.selectors?.includes(selector); },
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector.includes('head, script') ? node.sensitive || node.hidden || node.ariaHidden : node.matches(selector)) return node;
      }
      return null;
    },
    contains(child) { for (let node = child; node; node = node.parentElement) if (node === this) return true; return false; },
    querySelectorAll(selector) { return this.queries[selector] || []; },
    querySelector(selector) { return selector.includes('head, script') ? this.sensitiveChild || null : this.querySelectorAll(selector)[0] || null; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    getClientRects() { return this.noRects ? [] : [this.rect]; }, getBoundingClientRect() { return this.rect; },
  };
}

function fixture(article = false, href = 'https://www.instagram.com/reels/') {
  const root = element(article ? 'ARTICLE' : 'DIV');
  let wrapper = root;
  for (let i = 0; i < 12; i++) wrapper = element('DIV', { parentElement: wrapper });
  const video = element('VIDEO', { parentElement: wrapper, readyState: 4, ended: false, paused: false,
    currentTime: 12, duration: 60, playbackRate: 1 });
  const title = element(article ? 'H1' : 'DIV', { parentElement: root, textContent: 'A great reel #hello' });
  const creator = element('A', { parentElement: root, textContent: 'example.creator', attributes: { href: '/example.creator/reels/?tracking=private#fragment' } });
  const reel = element('A', { parentElement: root, attributes: { href: '/reels/Example_123-/?tracking=private#fragment' } });
  const creatorSelector = article ? 'header a' : 'a[aria-label$=" reels"]';
  const titleSelector = article ? 'h1' : '[role="button"] > div > div[dir="auto"]';
  root.queries = { [titleSelector]: [title], [creatorSelector]: [creator], a: [creator, reel], video: [video] };
  const document = { body: {}, documentElement: {}, videos: [video], querySelectorAll(selector) { return selector === 'video' ? this.videos : []; } };
  const window = { location: { href }, innerWidth: 1200, innerHeight: 800, getComputedStyle: node => ({
    display: node.cssHidden ? 'none' : 'block', opacity: node.transparent ? '0' : '1', visibility: node.visibility || 'visible', contentVisibility: node.contentVisibility || 'visible' }) };
  const state = {};
  return { root, video, title, creator, reel, creatorSelector, titleSelector, document, window, state,
    collect(configuration = config) { return collectActivityV2(configuration, document, window, state); },
    presence(report, preferences) { return createPresenceIntent(normalizeActivityReport(report, 2, config, window.location.href), 100000, preferences); } };
}

run('generic Instagram preserves feed, detail and article presence, progress, logo, clean links and preferences', () => {
  for (const article of [false, true]) for (const path of ['/reels', '/reels/', '/reel/Example_123-', '/reel/Example_123-/', '/reels/Example_123-', '/reels/Example_123-/']) {
    const f = fixture(article, 'https://www.instagram.com' + path + '?tracking=private#fragment');
    const report = f.collect(); assert.equal(report.modeId, article ? 'article' : 'default');
    assert.equal(report.media.creator, 'example.creator'); assert.equal(report.media.subtitle, 'Reel');
    const presence = f.presence(report);
    assert.equal(presence.details, 'A great reel #hello'); assert.equal(presence.state, '@example.creator');
    assert.deepEqual(presence.timestamps, { start: 88, end: 148 }); assert.equal(presence.assets.largeImage, INSTAGRAM_LOGO_URL);
    assert.deepEqual(presence.buttons, [{ label: 'View Reel', url: 'https://www.instagram.com/reels/Example_123-/' }, { label: 'View Profile', url: 'https://www.instagram.com/example.creator/' }]);
    assert.equal(f.presence(report, { statusDisplay: 'artist' }).statusDisplayType, 'state');
    const hidden = f.presence(report, { showArtwork: false, showButtons: false, showTimestamps: false });
    assert.equal(hidden.assets, null); assert.deepEqual(hidden.buttons, []); assert.equal(hidden.timestamps, null);
    f.video.paused = true; assert.equal(f.presence(f.collect()).timestamps, null);
  }
  const f = fixture(false, 'https://instagram.com/reel/Example_123-/');
  f.root.queries.a = [f.creator]; // Detail pages can supply an ID without a card permalink.
  assert.equal(f.presence(f.collect()).buttons[0].url, 'https://instagram.com/reel/Example_123-/');
  f.window.location.href = 'https://instagram.com/reels/';
  assert.deepEqual(f.presence(f.collect()).buttons, [{ label: 'View Profile', url: 'https://instagram.com/example.creator/' }]);
});

run('generic Instagram serializes without adapter dependencies and accepts package-only layout changes', () => {
  const f = fixture();
  const serialized = vm.runInNewContext(`(${collectGenericActivityV2.toString()})`, { Date, URL });
  assert.deepEqual(JSON.parse(JSON.stringify(serialized(config, f.document, f.window, {}))), f.collect());
  const updated = structuredClone(config); updated.fields.title.selectors = ['.new-caption'];
  f.root.queries['.new-caption'] = [f.title]; delete f.root.queries[f.titleSelector];
  assert.equal(f.collect().media.title, 'Watching Reel');
  assert.equal(f.collect(validateActivityV2(JSON.stringify(updated))).media.title, f.title.textContent);
  const review = describeActivityV2({ matches: ['https://www.instagram.com/reels*'] }, source);
  for (const grant of ['singlePlayer', 'matchText', '"links":{"media":1}', 'dir=', 'no site adapter runs']) assert.ok(review.includes(grant), grant);
});

run('generic Instagram ranks the current paused reel and never borrows an adjacent card after a winning-card failure', () => {
  const f = fixture(), neighbor = fixture(); neighbor.video.rect.bottom = 40; f.video.paused = true;
  neighbor.title.textContent = 'Adjacent autoplay'; neighbor.creator.textContent = 'neighbor'; neighbor.creator.attributes.href = '/neighbor/';
  f.document.videos = [neighbor.video, f.video];
  assert.equal(f.collect().media.title, f.title.textContent); assert.equal(f.collect().playback.state, 'paused');
  for (const mutate of [
    f => { f.title.hidden = true; }, f => { f.creator.hidden = true; },
    f => { delete f.root.queries[f.creatorSelector]; }, f => { f.root.queries.video.push(element('VIDEO')); },
    f => { f.root.selectors = ['[id^="mount_"]']; }, f => { f.root.tagName = 'MAIN'; },
  ]) {
    const current = fixture(); current.document.videos = [neighbor.video, current.video];
    assert.ok(current.collect()); mutate(current); assert.equal(current.collect(), null);
  }
});

run('generic Instagram rejects hidden or private captions, mismatched creators, oversized cards and inactive media', () => {
  for (const mutate of [
    f => { f.title.cssHidden = true; }, f => { f.title.transparent = true; }, f => { f.title.sensitiveChild = {}; },
    f => { f.title.textContent = ''; }, f => { f.title.textContent = 'x'.repeat(1025); },
    f => { f.creator.textContent = 'different.creator'; }, f => { f.creator.attributes.href = '//outside.example/example.creator/'; },
    f => { f.creator.attributes.href = 'https://www.instagram.com.evil.example/example.creator/'; },
    f => { f.creator.attributes.href = '/example%2ecreator/'; }, f => { f.creator.sensitiveChild = {}; },
    f => { f.root.sensitive = true; }, f => { f.video.ended = true; }, f => { f.video.readyState = 0; },
    f => { f.video.hidden = true; }, f => { f.video.rect.top = 900; },
    f => { let parent = f.root; for (let i = 0; i < 16; i++) parent = element('DIV', { parentElement: parent }); f.video.parentElement = parent; },
  ]) { const f = fixture(); assert.ok(f.collect()); mutate(f); assert.equal(f.collect(), null); assert.equal(f.state.generic, undefined); }
  const f = fixture();
  const hidden = element('SPAN', { parentElement: f.title, transparent: true }); f.title.queries['*'] = [hidden];
  Object.defineProperty(hidden, 'textContent', { get() { throw new Error('Hidden text must never be read'); } });
  assert.equal(f.collect(), null);
  f.title.queries['*'] = Array.from({ length: 65 }, () => element('SPAN', { parentElement: f.title })); assert.equal(f.collect(), null);
  f.title.queries['*'] = []; delete f.root.queries[f.titleSelector]; assert.equal(f.collect().media.title, 'Watching Reel');
});

run('generic Instagram defers stories, clears on route changes and rejects conflicting reel identity in both collector and worker', () => {
  const f = fixture(); const report = f.collect();
  f.window.location.href = 'https://www.instagram.com/reel/Example_123-/';
  f.root.queries.a.push(element('A', { parentElement: f.root, attributes: { href: '/reel/Different_ID/' } }));
  assert.equal(f.collect(), null); f.root.queries.a.pop();
  f.window.location.href = 'https://www.instagram.com/reel/Different_ID/'; assert.equal(f.collect(), null);
  assert.throws(() => validateV2Report(report, config, f.window.location.href), /link identity/);
  f.window.location.href = 'https://www.instagram.com/reel/Example_123-/'; assert.ok(f.collect());
  for (const path of ['/', '/direct/inbox/', '/accounts/edit/', '/example.creator/', '/explore/', '/stories/example.creator/123/', '/stories/highlights/123/', '/reels/one/extra/', '/reel/%31/']) {
    f.window.location.href = 'https://www.instagram.com' + path; assert.equal(f.collect(), null, path);
    assert.equal(f.state.generic, undefined); assert.throws(() => validateV2Report(report, config, f.window.location.href));
  }
  f.window.location.href = 'https://www.instagram.com/reels/';
  for (const change of [
    { ...report, modeId: 'story' }, { ...report, buttons: [] }, { ...report, artwork: {} },
    { ...report, links: { ...report.links, media: '/reel/Example_123-/?secret=value' } },
    { ...report, links: { ...report.links, profile: '/other.creator/' } },
    { ...report, links: { ...report.links, media: 'https://outside.example/reel/123/' } },
    { ...report, media: { ...report.media, subtitle: 'Story' } },
    { ...report, playback: { ...report.playback, live: true } },
  ]) assert.throws(() => validateV2Report(change, config, f.window.location.href));
});

run('generic Instagram installs and restores its exact reviewed package and verifies the current document before publishing', async () => {
  const directory = new URL('../ChudPresence-Activities-V2/activities/instagram/', import.meta.url);
  const metadata = JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8'));
  const icon = 'data:image/png;base64,' + (await fs.readFile(new URL('icon.png', directory))).toString('base64');
  const pkg = { metadata, source, icon, sourceType: 'local' }; pkg.approval = { digest: await activityV2Digest(pkg) };
  let version = '2.2.1', href = 'https://www.instagram.com/reel/Example_123-/';
  const data = {}, scripts = new Map(), reports = [];
  const api = {
    runtime: { getManifest: () => ({ version }) },
    storage: { local: { async get(key) { return structuredClone(key == null ? data : { [key]: data[key] }); },
      async set(value) { Object.assign(data, structuredClone(value)); }, async remove(keys) { for (const key of keys) delete data[key]; } } },
    permissions: { async contains() { return true; }, async remove() { return true; } },
    userScripts: { async getScripts() { return [...scripts.values()]; }, async configureWorld() {},
      async register(values) { for (const value of values) scripts.set(value.id, value); },
      async update(values) { for (const value of values) scripts.set(value.id, value); },
      async unregister({ ids }) { for (const id of ids) scripts.delete(id); },
      async execute(options) { return [{ documentId: options.target.documentIds?.[0], frameId: 0, result: href }]; } },
  };
  const manager = new ActivityManager({ api, onReport: value => reports.push(value) });
  await assert.rejects(manager.install(pkg), /2\.3\.0/); version = '2.3.0';
  await manager.install(pkg);
  assert.match([...scripts.values()][0].js[0].code, /collectGenericActivityV2/);
  const restored = new ActivityManager({ api }); await restored.load();
  assert.equal(restored.records.instagram.code, source);
  assert.equal(restored.records.instagram.metadata.minExtensionVersion, '2.3.0');
  const sender = { tab: { id: 7 }, frameId: 0, documentId: 'instagram-doc', url: 'https://www.instagram.com/reels/', userScriptWorldId: 'chudpresence.activity.instagram' };
  const send = report => manager.handleUserScriptMessage({ type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'instagram', activityVersion: metadata.version,
    apiVersion: 2, capability: manager.records.instagram.capability, requestId: 'probe', operation: 'presence.report', payload: { report } }, sender);
  const report = fixture().collect();
  assert.equal((await send(report)).ok, true);
  assert.equal(reports.at(-1).track.display.state, '@example.creator');
  assert.equal(reports.at(-1).track.buttons[0].url, 'https://www.instagram.com/reels/Example_123-/');
  for (const url of ['https://www.instagram.com/reel/Different_ID/', 'https://www.instagram.com/stories/example.creator/123/',
    'https://www.instagram.com.evil.example/reels/', 'https://www.instagram.com/direct/inbox/']) {
    href = url; assert.equal((await send(report)).ok, false, url);
  }
  assert.equal(reports.length, 1);
});
