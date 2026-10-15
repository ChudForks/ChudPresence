// Optional real-DOM / Library smoke test. Uses an isolated headless browser and
// synthetic extension/media APIs; it never touches a user's browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { INSTAGRAM_FIELDS, matchActivityV2Page } from '../extension/core/activity-api-v2.js';
import { collectActivityV2, runActivityV2 } from '../extension/core/activity-v2-runtime.js';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { activityV2Digest } from '../extension/core/activity-api-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const moduleRoot = process.env.CHUDPRESENCE_TEST_NODE_MODULES;
const require = moduleRoot ? createRequire(path.join(moduleRoot, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const exampleMetadata = await fs.readFile(path.join(root, 'examples/v2/html-media/metadata.json'), 'utf8');
const exampleConfiguration = await fs.readFile(path.join(root, 'examples/v2/html-media/activity.json'), 'utf8');
const googleConfiguration = JSON.parse(await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/google/activity.json'), 'utf8'));
const robloxConfiguration = JSON.parse(await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/roblox/activity.json'), 'utf8'));
const genericTikTokConfiguration = JSON.parse(await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/tiktok/activity.json'), 'utf8'));
const genericInstagramConfiguration = JSON.parse(await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/instagram/activity.json'), 'utf8'));
const primeConfiguration = {
  schemaVersion: 1, kind: 'video', scope: '.dv-player-fullscreen',
  fields: { title: { source: 'dom.text', selectors: ['.atvwebplayersdk-title-text'] },
    subtitle: { source: 'dom.text', selectors: ['.atvwebplayersdk-episode-info'] } },
  player: { adapter: 'prime-video', selectors: ['.atvwebplayersdk-video-surface video'] },
};
const tiktokConfiguration = {
  schemaVersion: 1, kind: 'video', scope: '#main-content',
  fields: {
    title: { source: 'dom.text', selectors: ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="user-profile-live-title"]', '[class*="DivDetailsLine"], .e1xspjl31'] },
    creator: { source: 'dom.text', selectors: ['[data-e2e="video-author-nickname"]', '[data-e2e="browser-nickname"]', '[data-e2e="user-profile-nickname"]', '[class*="SpanNickName"], [class*="DivCreatorInfoContainer"] a p, [data-e2e="room-header-anchor-name"], .e1xspjl34'] },
    channel: { source: 'dom.text', selectors: ['[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]', '[data-e2e="user-profile-uid"]'] },
  }, player: { adapter: 'tiktok', selectors: ['video'] },
};
const instagramConfiguration = { schemaVersion: 1, kind: 'video', scope: '.x5lhr3w',
  fields: INSTAGRAM_FIELDS, player: { adapter: 'instagram', selectors: ['video', 'img'] } };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/fixture.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><main><section id="player"><h1 class="media-title"> Example   playback </h1><span class="media-creator" title="Example creator">Creator</span><video style="width:320px;height:180px"></video><form><span class="private">Private account value</span></form></section></main>');
    return;
  }
  if (pathname === '/tiktok-fixture.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><style>article {height:600px} video {width:320px;height:400px}</style><main id="main-content">
      <article data-e2e="recommend-list-item-container"><h3 data-e2e="video-author-uniqueid">old.creator</h3><span data-e2e="video-author-nickname">Old Creator</span><div data-e2e="video-desc">Previous video</div><video></video></article>
      <article data-e2e="recommend-list-item-container" id="current"><h3 data-e2e="video-author-uniqueid">example.creator</h3><span data-e2e="video-author-nickname">Example Creator</span><div data-e2e="video-desc">Current video description</div><a href="https://www.tiktok.com/@example.creator/video/123456789?tracking=private">Open video</a><video poster="https://example.com/private-preview.jpg"></video></article>
      <form><span data-e2e="video-desc">Private form description</span></form></main>`);
    return;
  }
  if (pathname === '/tiktok-canvas-fixture.html') {
    // Structure inspected in the user's current TikTok player on Oct 14, 2026:
    // opacity-zero VIDEO supplies the clock; a sibling SR canvas renders it.
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><style>
      .tiktok-web-player {position:relative;width:320px;height:500px}
      video {position:absolute;inset:0;width:100%;height:100%;opacity:0}
      tt-vod-sr-wrap {position:absolute;inset:0;display:block} canvas {width:320px;height:500px}
      .description br {display:none}
      </style><main id="main-content-video_detail"><article data-e2e="recommend-list-item-container" id="one-column-item-0">
      <section id="media-card-0" data-e2e="feed-video">
      <div class="tiktok-web-player" id="xgwrapper-0-7685627074924530958"><div><video></video><tt-vod-sr-wrap><canvas width="1080" height="1920"></canvas></tt-vod-sr-wrap></div></div>
      <div class="css-example--DivCreatorInfoContainer"><a href="/@funnyasiandude"><div><p>Jimmy O Yang</p><svg><defs></defs></svg></div></a><span> · 9-15</span></div>
      <div data-e2e="video-desc" class="description"><span>My new special Finally Home is now on HULU! </span><br><a href="/tag/jimmyoyang"><p>#jimmyoyang</p></a><span> </span><a href="/tag/finallyhome"><p>#finallyhome</p></a><span></span></div>
      </section></article></main>`);
    return;
  }
  if (pathname === '/tiktok-overlay-fixture.html' || pathname === '/tiktok-overlay-formatted-fixture.html') {
    const formatted = pathname === '/tiktok-overlay-formatted-fixture.html';
    const caption = formatted ? Array.from({ length: 7 }, (_, index) => `<a href="/tag/tag${index}"><strong>#tag${index} </strong></a><span> </span>`).join('') : '<span>What are you looking at?🐶</span><a href="/tag/funny"><strong>#Funny </strong></a><span> and Adorable Pet Videos Recommended</span>';
    // Explore's open-video overlay is a sibling of its grid and has no stable
    // detail-container class. Only these fixed public fields form its boundary.
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><style>
      .tiktok-web-player {width:320px;height:500px} video {width:320px;height:500px}
      #preload {position:absolute;top:1000px} #metadata {position:absolute;left:400px;top:0}
      </style><div id="app"><main id="main-content-explore_page"><h1>Explore grid</h1><span data-e2e="video-author-nickname">Grid creator</span></main>
      <div class="css-random-modal" id="overlay"><div><div><div><div data-e2e="browse-video"><div class="tiktok-web-player" id="xgwrapper-2-7665376071667240212"><div><video></video></div></div></div>
      <div id="preload" data-e2e="browse-video"><div class="tiktok-web-player" id="xgwrapper-2-7674420773972430100"><video></video></div></div>
      </div></div></div><div id="metadata"><span data-e2e="browse-username"><span class="SpanEllipsis">${formatted ? 'Example Creator 🐶' : 'mw10.03'}</span></span>
      <span data-e2e="browser-nickname"><span class="SpanEllipsis">mw10.03</span><span> · </span><span>7-22</span></span>
      <div data-e2e="browse-video-desc">${caption}</div>
      <form><textarea>PRIVATE COMMENT DRAFT</textarea></form></div></div></div>`);
    return;
  }
  if (pathname === '/tiktok-live-fixture.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><style>
      video {width:640px;height:360px} #feed video {width:320px;height:180px}
      </style><main id="tiktok-live-main-container-id"><aside><a href="/@sidebar.creator/live">Sidebar creator</a></aside>
      <div data-e2e="live-content-container"><section id="room-panel"><div data-e2e="live-header-container"><a href="/@example.creator"><p data-e2e="room-header-anchor-name">Actual LIVE Creator</p></a><p>5.6K likes</p></div>
      <div data-e2e="live-room-content"><div class="xgplayer"><video id="room-video"></video></div></div></section>
      <section id="recommendations"><span data-e2e="video-author-nickname">Wrong recommendation creator</span><div data-e2e="user-profile-live-title">Wrong recommendation title</div><a href="/@recommendation/live">Recommendation</a></section></div>
      <div contenteditable="true"><p data-e2e="room-header-anchor-name">PRIVATE CHAT NAME</p><span data-e2e="user-profile-live-title">PRIVATE CHAT DRAFT</span></div>
      <div data-e2e="discover-list-live-card" id="feed" style="display:none"><video id="feed-video"></video><div class="ee35qag0" style="opacity:0"><div class="e1xspjl31">Feed stream title</div><div class="e1xspjl34">Featured LIVE Creator</div><a href="/@feed.creator/live">Watch featured LIVE</a></div></div></main>`);
    return;
  }
  const filename = path.resolve(extension, `.${pathname}`);
  if (pathname === '/prime-fixture.html') {
    // Structure observed in Amazon's live Prime Video player. The background
    // trailer and an inactive player must never supply the presence title.
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><main><div class="draper-player-container"><video></video><h1>Browse title</h1></div></main><div id="dv-web-player" style="display:none" class="dv-player-fullscreen"><video></video></div><div id="dv-web-player-2" class="dv-player-fullscreen"><div class="atvwebplayersdk-video-surface"><video aria-hidden="true" style="width:320px;height:180px"></video></div><div class="controls"><div class="atvwebplayersdk-title-text">Yu-Gi-Oh!</div><span class="atvwebplayersdk-episode-info">S1 E1 The Heart of The Cards</span></div></div>');
    return;
  }
  if (!filename.startsWith(extension + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'text/plain';
    const body = await fs.readFile(filename);
    response.writeHead(200, { 'Content-Type': type }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHUDPRESENCE_TEST_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await page.route('https://**', (route) => route.abort()); // Fixture artwork never makes external requests.
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__installs = [];
    window.__permissionRequests = [];
    window.__grantPermission = true;
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '2.0.0' }),
        async sendMessage(message) {
          if (message.type === 'ACTIVITY_LIBRARY_STATE') return { ok: true, result: { installed: [], userScriptsPermission: true } };
          if (message.type === 'ACTIVITY_INSTALL') {
            const { activityV2Digest } = await import('/core/activity-api-v2.js');
            if (message.activityPackage.approval.digest !== await activityV2Digest(message.activityPackage)) throw new Error('staged digest mismatch');
            window.__installs.push(message.activityPackage);
            return { ok: true, result: message.activityPackage.metadata };
          }
          return { ok: true, result: {} };
        },
      },
      storage: { local: { get: async (key) => key === 'developerMode' ? { developerMode: true } : {}, set: async () => {} } },
      userScripts: { execute() {} },
      permissions: { async request({ origins }) { window.__permissionRequests.push({ origins, userGesture: navigator.userActivation.isActive }); return window.__grantPermission; } },
    };
  });
  await page.goto(base + '/activities.html?view=developer');
  const files = [
    { name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(exampleMetadata) },
    { name: 'activity.json', mimeType: 'application/json', buffer: Buffer.from(exampleConfiguration) },
  ];
  await page.locator('#local-files').setInputFiles(files);
  await page.locator('#load-local:not([disabled])').waitFor();
  await page.locator('#load-local').click();
  await page.locator('#v2-approval-dialog[open]').waitFor();
  assert.match(await page.locator('#v2-access-summary').innerText(), /title: dom.text/);
  assert.match(await page.locator('#v2-access-summary').innerText(), /Package digest: [a-f0-9]{64}/);
  assert.equal(await page.evaluate(() => window.__permissionRequests.length), 0);
  await page.locator('#decline-v2').click();
  assert.equal(await page.evaluate(() => window.__installs.length), 0);
  await page.locator('#load-local').click();
  await page.locator('#v2-approval-dialog[open]').waitFor();
  await fs.mkdir(path.join(root, 'browser-profiles'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'browser-profiles/v2-approval-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const dialogFits = await page.locator('#v2-approval-dialog').evaluate((element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; });
  assert.equal(dialogFits, true);
  await page.screenshot({ path: path.join(root, 'browser-profiles/v2-approval-mobile.png') });
  await page.evaluate(() => { window.__grantPermission = false; });
  await page.locator('#approve-v2').click();
  await page.locator('#v2-approval-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__installs.length), 0);
  await page.evaluate(() => { window.__grantPermission = true; });
  await page.locator('#load-local').click();
  await page.locator('#v2-approval-dialog[open]').waitFor();
  await page.locator('#approve-v2').click();
  await page.waitForFunction(() => window.__installs.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__permissionRequests.map((request) => request.userGesture)), [true, true]);
  assert.deepEqual(await page.evaluate(() => window.__permissionRequests.at(-1).origins), ['https://example.com/watch/*']);
  assert.deepEqual(errors, []);
  await page.goto(base + '/fixture.html');
  const report = await page.evaluate(async (source) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const config = JSON.parse(source);
    const video = document.querySelector('video');
    Object.defineProperties(video, { readyState: { value: 4 }, paused: { value: false }, ended: { value: false }, duration: { value: 120 }, currentTime: { value: 30 } });
    const report = collectActivityV2(config, document, window);
    const title = document.querySelector('.media-title');
    for (const css of ['display:none', 'visibility:hidden', 'visibility:collapse', 'opacity:0', 'content-visibility:hidden;display:block']) {
      const wrapper = document.createElement('span');
      const hidden = document.createElement('span');
      hidden.style.cssText = css; hidden.textContent = 'PRIVATE HIDDEN TEXT';
      wrapper.append(hidden); title.append(wrapper);
      if (collectActivityV2(config, document, window) !== null) throw new Error(`V2 hidden descendant was read: ${css}`);
      wrapper.remove();
      if (collectActivityV2(config, document, window)?.media.title !== 'Example playback') throw new Error('V2 visible title did not recover');
    }
    const visible = document.createElement('strong'); visible.textContent = ' visible suffix'; title.append(visible);
    if (collectActivityV2(config, document, window)?.media.title !== 'Example playback visible suffix') throw new Error('V2 visible nested markup was rejected');
    visible.remove();
    title.style.contentVisibility = 'hidden';
    if (collectActivityV2(config, document, window) !== null) throw new Error('V2 content-visibility hidden title was read');
    title.style.contentVisibility = '';
    config.fields.title.selectors = ['.private'];
    if (collectActivityV2(config, document, window) !== null) throw new Error('sensitive form text was read');
    return report;
  }, exampleConfiguration);
  assert.equal(report.media.title, 'Example playback');
  assert.equal(report.media.creator, 'Example creator');
  assert.equal(report.playback.position, 30);
  await page.goto(base + '/prime-fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { validateActivityV2 } = await import('/core/activity-api-v2.js');
    validateActivityV2(JSON.stringify(config));
    const video = document.querySelector('#dv-web-player-2 video');
    let source = 'blob:https://www.amazon.com/episode-1';
    Object.defineProperties(video, { readyState: { value: 4 }, paused: { value: false, configurable: true }, ended: { value: false },
      duration: { value: 1246.432 }, currentTime: { value: 90 }, currentSrc: { get: () => source } });
    const environment = { getComputedStyle: window.getComputedStyle.bind(window), location: { href: 'https://www.amazon.com/gp/video/detail/episode-1' } };
    const state = {};
    const collect = () => collectActivityV2(config, document, environment, state);
    const first = collect();
    if (first?.media.title !== 'Yu-Gi-Oh!' || first.media.subtitle !== 'S1 E1 The Heart of The Cards' || first.playback.position !== 90) throw new Error('Prime player extraction failed');
    const controls = document.querySelector('.controls');
    const player = document.querySelector('#dv-web-player-2');
    const title = controls.querySelector('.atvwebplayersdk-title-text');
    const subtitle = controls.querySelector('.atvwebplayersdk-episode-info');
    for (const css of ['display:none', 'visibility:hidden', 'visibility:collapse', 'opacity:0', 'content-visibility:hidden;display:block']) {
      const wrapper = document.createElement('span');
      const hidden = document.createElement('span');
      hidden.style.cssText = css; hidden.textContent = 'PRIVATE HIDDEN TEXT';
      wrapper.append(hidden); title.append(wrapper);
      if (collect() !== null || state.primeVideo !== undefined) throw new Error(`Prime hidden title survived: ${css}`);
      controls.remove();
      if (collect() !== null) throw new Error(`Prime rejected title reappeared from cache: ${css}`);
      wrapper.remove(); player.append(controls);
      if (collect()?.media.title !== 'Yu-Gi-Oh!') throw new Error('Prime visible title did not recover');
      subtitle.append(wrapper);
      if (collect()?.media.subtitle !== undefined) throw new Error(`Prime hidden episode text was read: ${css}`);
      controls.remove();
      const retained = collect();
      if (retained?.media.title !== 'Yu-Gi-Oh!' || retained.media.subtitle !== undefined) throw new Error('Prime rejected episode text reappeared from cache');
      wrapper.remove(); player.append(controls);
      if (collect()?.media.subtitle !== 'S1 E1 The Heart of The Cards') throw new Error('Prime visible episode text did not recover');
    }
    controls.remove();
    Object.defineProperty(video, 'paused', { value: true });
    if (collect()?.playback.state !== 'paused') throw new Error('Prime removed-controls retention failed');
    source += '-next';
    if (collect() !== null) throw new Error('Prime stale source metadata survived');
    document.querySelector('#dv-web-player-2').append(controls);
    if (!collect()) throw new Error('Prime fresh title did not recover');
    controls.setAttribute('aria-hidden', 'true');
    if (collect() !== null) throw new Error('Prime hidden metadata was read');
    controls.removeAttribute('aria-hidden');
    if (!collect()) throw new Error('Prime public metadata did not recover');
    const episodeImage = `https://images-na.ssl-images-amazon.com/images/S/pv-target-images/${'a'.repeat(64)}._SX720_FMjpg_.jpg`;
    const heroImage = `https://m.media-amazon.com/images/S/pv-target-images/${'b'.repeat(64)}._SX1080_FMjpg_.jpg`;
    document.querySelector('main').id = 'main';
    document.querySelector('main').innerHTML = `<div class="DVWebNode-detail-atf-wrapper"><h1><img width="200" height="60" alt="Yu-Gi-Oh!"></h1><img width="300" height="150" alt="Yu-Gi-Oh!" src="${heroImage}"></div><div id="tab-content-episodes"><li id="av-ep-episode-0"><input type="checkbox"><h3><span>1. The Heart of The Cards</span></h3><a data-testid="episodes-playbutton" aria-label="Watch for free, Resume S1 E1"><svg aria-hidden="true"></svg>Play</a><div data-testid="episode-image"><picture><img width="160" height="90" src="${episodeImage}"></picture></div></li></div>`;
    const richConfig = { ...config, player: { ...config.player, metadata: 'prime-video-details' } };
    const rich = () => collectActivityV2(richConfig, document, environment, state);
    validateActivityV2(JSON.stringify(richConfig));
    const episodeReport = rich();
    if (episodeReport?.kind !== 'episode' || episodeReport.media.title !== 'The Heart of The Cards' || episodeReport.media.season !== 1 ||
        episodeReport.media.episode !== 1 || episodeReport.artwork?.large !== episodeImage) throw new Error('Prime rich metadata failed in the real DOM');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const normalized = normalizeActivityReport(episodeReport, 2, richConfig);
    if (normalized.display.details !== 'The Heart of The Cards' || normalized.display.state !== 'Yu-Gi-Oh!') throw new Error('Prime episode title and series formatting was incorrect');
    document.querySelector('[data-testid="episode-image"] img').hidden = true;
    if (rich()?.artwork?.large !== heroImage) throw new Error('Prime hidden thumbnail did not fall back to matching show art');
    document.querySelector('.DVWebNode-detail-atf-wrapper h1 img').alt = 'Another Series';
    if (rich()?.artwork !== undefined) throw new Error('Prime artwork from another series was accepted');
    document.querySelector('#dv-web-player-2').style.display = 'none';
    if (collect() !== null) throw new Error('Prime closed player still reported');
  }, primeConfiguration);
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.goto(base + '/tiktok-fixture.html');
  await page.locator('#current').scrollIntoViewIfNeeded();
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { validateActivityV2, TIKTOK_LOGO_URL } = await import('/core/activity-api-v2.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    validateActivityV2(JSON.stringify(config));
    const root = document.querySelector('#current');
    const video = root.querySelector('video');
    for (const player of document.querySelectorAll('video')) Object.defineProperties(player, {
      readyState: { value: 4 }, ended: { value: false }, paused: { value: false, configurable: true },
      duration: { value: 60 }, currentTime: { value: 10 },
    });
    const environment = { location: { href: 'https://www.tiktok.com/foryou' }, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      getComputedStyle: window.getComputedStyle.bind(window) };
    const state = {}; const collect = () => collectActivityV2(config, document, environment, state);
    const report = collect();
    if (report?.media.creator !== 'Example Creator' || report.media.title !== 'Current video description') throw new Error('TikTok mixed neighboring feed metadata');
    const intent = createPresenceIntent(normalizeActivityReport(report, 2, config), 100000);
    if (intent.details !== 'Current video description' || intent.state !== 'Example Creator (@example.creator)' ||
        intent.assets?.largeImage !== TIKTOK_LOGO_URL || intent.buttons[0]?.url !== 'https://www.tiktok.com/@example.creator/video/123456789') throw new Error('TikTok video presence layout failed');
    const hidden = document.createElement('span'); hidden.style.display = 'none'; hidden.textContent = 'PRIVATE';
    root.querySelector('[data-e2e="video-desc"]').append(hidden);
    if (collect() !== null) throw new Error('TikTok hidden description was read');
    hidden.remove();
    Object.defineProperty(video, 'paused', { value: true });
    if (collect()?.playback.state !== 'paused') throw new Error('TikTok paused card was not retained');
    environment.location.href = 'https://www.tiktok.com/@example.creator/video/123456789';
    if (collect()?.buttons[0]?.url !== 'https://www.tiktok.com/@example.creator/video/123456789') throw new Error('TikTok individual video link failed');
    environment.location.href = 'https://www.tiktok.com/live';
    const live = collect();
    state.tiktok.startedAt -= 15000;
    const elapsed = collect();
    const liveIntent = createPresenceIntent(normalizeActivityReport(elapsed, 2, config));
    if (live?.kind !== 'stream' || elapsed.playback.position < 15 || elapsed.playback.duration !== 0 ||
        liveIntent.details !== 'Watching Live' || liveIntent.state !== 'Example Creator • Paused' ||
        liveIntent.buttons[0]?.label !== 'Watch Stream') throw new Error('TikTok LIVE session/layout failed');
    environment.location.href = 'https://www.tiktok.com/messages';
    if (collect() !== null || state.tiktok !== undefined) throw new Error('TikTok private route or stale LIVE session survived');
    environment.location.href = 'https://www.tiktok.com/following';
    if (collect()?.kind !== 'video') throw new Error('TikTok Following feed failed');
  }, tiktokConfiguration);
  await page.goto(base + '/tiktok-canvas-fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    const video = document.querySelector('video');
    Object.defineProperties(video, { readyState: { value: 4 }, paused: { value: false, configurable: true }, ended: { value: false }, duration: { value: 51.446484 }, currentTime: { value: 19.765333 } });
    const environment = { location: { href: 'https://www.tiktok.com/@funnyasiandude/video/7685627074924530958' }, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      getComputedStyle: window.getComputedStyle.bind(window) };
    const collect = () => collectActivityV2(config, document, environment, {});
    const report = collect();
    if (!report) throw new Error('TikTok visible SR canvas playback was rejected');
    const intent = createPresenceIntent(normalizeActivityReport(report, 2, config), 100000);
    if (intent.state !== 'Jimmy O Yang (@funnyasiandude)' || !intent.details.startsWith('My new special Finally Home is now on HULU!') ||
        intent.buttons[0]?.url !== environment.location.href || intent.timestamps?.end !== 132) throw new Error('TikTok current DOM presence was incorrect');
    const canvas = document.querySelector('canvas');
    canvas.style.display = 'none'; if (collect() !== null) throw new Error('TikTok invisible canvas was accepted');
    canvas.style.display = '';
    const wrapper = document.querySelector('tt-vod-sr-wrap');
    wrapper.style.opacity = '0'; if (collect() !== null) throw new Error('TikTok transparent canvas ancestor was accepted');
    wrapper.style.opacity = '';
    const card = document.querySelector('#media-card-0');
    card.style.visibility = 'hidden'; if (collect() !== null) throw new Error('TikTok hidden canvas card was accepted');
    card.style.visibility = '';
    canvas.remove(); if (collect() !== null) throw new Error('TikTok arbitrary transparent video was accepted');
    wrapper.append(canvas);
    const description = document.querySelector('[data-e2e="video-desc"]');
    const hidden = document.createElement('span'); hidden.style.opacity = '0'; hidden.textContent = 'PRIVATE'; description.append(hidden);
    if (collect() !== null) throw new Error('TikTok hidden description text was accepted'); hidden.remove();
    environment.location.href = 'https://www.tiktok.com/foryou';
    if (collect()?.buttons[0]?.url !== 'https://www.tiktok.com/@funnyasiandude/video/7685627074924530958') throw new Error('TikTok current feed player ID or creator profile extraction failed');
    environment.location.href = 'https://www.tiktok.com/following';
    if (collect()?.media.channel !== '@funnyasiandude') throw new Error('TikTok current Following profile handle extraction failed');
  }, tiktokConfiguration);
  await page.goto(base + '/tiktok-overlay-fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    for (const video of document.querySelectorAll('video')) Object.defineProperties(video, {
      readyState: { value: 4 }, paused: { value: false, configurable: true }, ended: { value: false }, duration: { value: 5.199863 }, currentTime: { value: 2.310204 },
    });
    const environment = { location: { href: 'https://www.tiktok.com/@mw10.03/video/7665376071667240212' }, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      getComputedStyle: window.getComputedStyle.bind(window) };
    const collect = () => collectActivityV2(config, document, environment, {});
    const report = collect();
    if (!report || report.media.creator !== 'mw10.03' || report.media.channel !== '@mw10.03' ||
        report.media.title !== 'What are you looking at?🐶#Funny and Adorable Pet Videos Recommended') throw new Error(`TikTok Explore overlay metadata failed: ${JSON.stringify(report)}`);
    const presence = createPresenceIntent(normalizeActivityReport(report, 2, config), 100000);
    if (presence.state !== 'mw10.03 (@mw10.03)' || presence.details !== report.media.title || presence.buttons[0]?.url !== environment.location.href || !presence.timestamps?.end) throw new Error('TikTok Explore presence layout failed');
    const preload = document.querySelector('#preload');
    preload.style.top = '0';
    if (collect()?.buttons[0]?.url !== environment.location.href) throw new Error('TikTok preloaded overlay stole the current video');
    document.querySelector('[data-e2e="browse-username"] .SpanEllipsis').textContent = 'other.creator';
    if (collect() !== null) throw new Error('TikTok overlay borrowed another creator');
    document.querySelector('[data-e2e="browse-username"] .SpanEllipsis').textContent = 'mw10.03';
    const hidden = document.createElement('span'); hidden.textContent = 'PRIVATE'; hidden.hidden = true;
    document.querySelector('[data-e2e="browse-video-desc"]').append(hidden);
    if (collect() !== null) throw new Error('TikTok overlay read hidden text'); hidden.remove();
    const overlay = document.querySelector('#overlay'); overlay.setAttribute('aria-hidden', 'true');
    if (collect() !== null) throw new Error('TikTok closed/hidden overlay survived'); overlay.removeAttribute('aria-hidden');
    environment.location.href = 'https://www.tiktok.com/explore';
    if (collect() !== null) throw new Error('TikTok Explore grid previews produced presence');
  }, tiktokConfiguration);
  await page.goto(base + '/tiktok-live-fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    const { TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS } = await import('/core/activity-api-v2.js');
    for (const video of document.querySelectorAll('video')) Object.defineProperties(video, {
      readyState: { value: 4, configurable: true }, paused: { value: false, configurable: true }, ended: { value: false, configurable: true }, duration: { value: Infinity }, currentTime: { value: 8000 },
    });
    const environment = { location: { href: 'https://www.tiktok.com/@example.creator/live' }, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      getComputedStyle: window.getComputedStyle.bind(window) };
    const state = {}; const collect = () => collectActivityV2(config, document, environment, state);
    let report = collect();
    if (report?.kind !== 'stream' || report.media.creator !== 'Actual LIVE Creator' || report.media.channel !== '@example.creator' ||
        report.media.title !== 'TikTok LIVE' || report.playback.position !== 0) throw new Error('TikTok current LIVE header/title fallback failed');
    state.tiktok.startedAt -= 15000; report = collect();
    let presence = createPresenceIntent(normalizeActivityReport(report, 2, config));
    if (report.playback.position < 15 || report.playback.duration !== 0 || presence.details !== 'Watching Live' ||
        presence.state !== 'Actual LIVE Creator' || !presence.timestamps?.start || presence.timestamps.end || presence.buttons[0]?.url !== environment.location.href) throw new Error('TikTok LIVE session formatting failed');
    const panel = document.querySelector('#room-panel');
    const title = document.createElement('div'); title.setAttribute('data-e2e', 'user-profile-live-title'); title.textContent = 'Actual stream title'; panel.append(title);
    if (collect()?.media.title !== 'Actual stream title' || collect().playback.position < 15) throw new Error('TikTok visible LIVE title/session failed');
    title.style.opacity = '0'; if (collect() !== null || state.tiktok !== undefined) throw new Error('TikTok hidden title used a fallback'); title.remove();
    const profile = document.querySelector('[data-e2e="live-header-container"] a');
    profile.href = '/@other.creator'; if (collect() !== null) throw new Error('TikTok LIVE borrowed a mismatched creator'); profile.href = '/@example.creator';
    const roomVideo = document.querySelector('#room-video'); Object.defineProperty(roomVideo, 'paused', { value: true });
    if (createPresenceIntent(normalizeActivityReport(collect(), 2, config)).timestamps !== null) throw new Error('TikTok paused LIVE retained a timer');
    panel.style.display = 'none'; if (collect() !== null) throw new Error('TikTok hidden LIVE still reported');
    const feed = document.querySelector('#feed'); feed.style.display = ''; environment.location.href = 'https://www.tiktok.com/live';
    report = collect(); presence = createPresenceIntent(normalizeActivityReport(report, 2, config));
    if (report?.media.title !== 'Feed stream title' || presence.details !== 'Watching Live' || presence.state !== 'Featured LIVE Creator' ||
        presence.buttons[0]?.url !== 'https://www.tiktok.com/@feed.creator/live') throw new Error('TikTok featured LIVE faded metadata failed');
    const fade = feed.querySelector('.ee35qag0'); fade.style.display = 'none';
    if (collect() !== null) throw new Error('TikTok LIVE fade exemption bypassed display:none'); fade.style.display = '';
    fade.setAttribute('aria-hidden', 'true'); if (collect() !== null) throw new Error('TikTok LIVE fade exemption bypassed aria-hidden'); fade.removeAttribute('aria-hidden');
    const feedTitle = feed.querySelector('.e1xspjl31'); const hidden = document.createElement('span'); hidden.style.opacity = '0'; hidden.textContent = 'PRIVATE'; feedTitle.append(hidden);
    if (collect() !== null) throw new Error('TikTok LIVE fade exemption exposed hidden child text'); hidden.remove();
    const privateInput = document.createElement('input'); feedTitle.append(privateInput);
    if (collect() !== null) throw new Error('TikTok LIVE fade exemption exposed sensitive field descendants'); privateInput.remove();
    feed.style.opacity = '0'; if (collect() !== null) throw new Error('TikTok LIVE fade exemption bypassed an unrelated ancestor'); feed.style.opacity = '';
    for (const fields of [TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS]) {
      if (collectActivityV2({ ...config, fields }, document, environment, {}) !== null) throw new Error('Legacy TikTok package gained unapproved LIVE reads');
    }
  }, tiktokConfiguration);
  await page.goto(base + '/fixture.html');
  // Run the actual migrated package against the same inspected markup as the
  // legacy adapter. These use only the serialized generic collector.
  for (const [fixture, href, expectedTitle, expectedCreator] of [
    ['tiktok-fixture.html', 'https://www.tiktok.com/foryou', 'Current video description', 'Example Creator'],
    ['tiktok-canvas-fixture.html', 'https://www.tiktok.com/@funnyasiandude/video/7685627074924530958', 'My new special Finally Home is now on HULU! #jimmyoyang #finallyhome', 'Jimmy O Yang'],
    ['tiktok-overlay-fixture.html', 'https://www.tiktok.com/@mw10.03/video/7665376071667240212', 'What are you looking at?🐶#Funny and Adorable Pet Videos Recommended', 'mw10.03'],
    ['tiktok-overlay-formatted-fixture.html', 'https://www.tiktok.com/@mw10.03/video/7665376071667240212', '#tag0 #tag1 #tag2 #tag3 #tag4 #tag5 #tag6', 'Example Creator 🐶'],
    ['tiktok-live-fixture.html', 'https://www.tiktok.com/@example.creator/live', 'TikTok LIVE', 'Actual LIVE Creator'],
  ]) {
    await page.goto(base + '/' + fixture);
    await page.evaluate(async ({ config, href, expectedTitle, expectedCreator, fixture }) => {
      const { collectGenericActivityV2 } = await import('/core/activity-v2-generic.js');
      const { normalizeActivityReport } = await import('/core/activity-validator.js');
      const { createPresenceIntent } = await import('/core/presence.js');
      const { validateActivityV2, TIKTOK_LOGO_URL } = await import('/core/activity-api-v2.js');
      validateActivityV2(JSON.stringify(config));
      const serialized = new Function(`return (${collectGenericActivityV2.toString()})`)();
      document.querySelector('#current')?.scrollIntoView({ block: 'start' });
      for (const video of document.querySelectorAll('video')) Object.defineProperties(video, {
        readyState: { value: 4, configurable: true }, ended: { value: false, configurable: true }, paused: { value: false, configurable: true },
        currentTime: { value: 12 }, duration: { value: 60 }, playbackRate: { value: 1 },
      });
      const environment = { location: { href }, innerWidth, innerHeight, getComputedStyle: window.getComputedStyle.bind(window) };
      const state = {}, collect = () => serialized(config, document, environment, state);
      const check = (condition, message) => { if (!condition) throw new Error(`Generic TikTok ${fixture}: ${message}`); };
      let report = collect();
      check(report?.media.title === expectedTitle && report?.media.creator === expectedCreator, `wrong metadata ${JSON.stringify(report)}`);
      let presence = createPresenceIntent(normalizeActivityReport(report, 2, config, environment.location.href), 100000);
      check(presence.assets.largeImage === TIKTOK_LOGO_URL && presence.buttons.length === 2, 'logo or public buttons lost');
      check(presence.details === (report.kind === 'stream' ? 'Watching Live' : expectedTitle), 'details changed');
      check(presence.state === (report.kind === 'stream' ? expectedCreator : `${expectedCreator} (${report.media.channel})`), 'creator changed');
      check(!JSON.stringify(report).includes('tracking=') && !JSON.stringify(report).includes('private-preview'), 'raw URLs leaked');
      if (fixture === 'tiktok-canvas-fixture.html') {
        check(presence.buttons[0].url === href && presence.timestamps.end === 148, 'canvas identity or progress failed');
        const canvas = document.querySelector('canvas'); canvas.style.display = 'none'; check(collect() === null, 'hidden canvas survived'); canvas.style.display = '';
        const wrapper = document.querySelector('.tiktok-web-player'); wrapper.style.opacity = '0'; check(collect() === null, 'hidden canvas ancestor survived'); wrapper.style.opacity = '';
        const title = document.querySelector('[data-e2e="video-desc"]');
        const hidden = document.createElement('span'); hidden.style.opacity = '0'; title.append(hidden); check(collect() === null, 'empty hidden formatting span was read'); hidden.remove();
      }
      if (fixture === 'tiktok-overlay-fixture.html' || fixture === 'tiktok-overlay-formatted-fixture.html') {
        const player = document.querySelector('.tiktok-web-player'), saved = player.id;
        player.id = 'xgwrapper-2-7674420773972430100'; check(collect() === null, 'preload identity used'); player.id = saved;
        const username = document.querySelector('[data-e2e="browser-nickname"] [class*="SpanEllipsis"]'); const savedName = username.textContent;
        username.textContent = 'other.creator'; check(collect() === null, 'another creator used'); username.textContent = savedName;
        document.querySelector('#overlay').setAttribute('aria-hidden', 'true'); check(collect() === null, 'hidden overlay survived');
        document.querySelector('#overlay').removeAttribute('aria-hidden');
        if (fixture === 'tiktok-overlay-formatted-fixture.html') {
          const caption = document.querySelector('[data-e2e="browse-video-desc"]');
          check(caption.querySelectorAll('*').length === 21, 'fixture missed formatted-caption boundary');
          const last = caption.lastElementChild; last.style.opacity = '0'; check(collect() === null, 'hidden formatting past the default limit was read'); last.style.opacity = '';
          const input = document.createElement('input'); caption.append(input); check(collect() === null, 'large caption read a private input'); input.remove();
          const limits = structuredClone(config); delete limits.modes.find(mode => mode.id === 'overlay').fields.title.maxDescendants;
          check(serialized(limits, document, environment, {}) === null, 'caption grant widened the default limit');
        }
        environment.location.href = 'https://www.tiktok.com/explore'; check(collect() === null, 'Explore hover previews produced presence');
      }
      if (fixture === 'tiktok-live-fixture.html') {
        state.generic.startedAt -= 15000; report = collect();
        presence = createPresenceIntent(normalizeActivityReport(report, 2, config, environment.location.href));
        check(report.playback.position >= 15 && presence.timestamps.start && !presence.timestamps.end && presence.state === expectedCreator, 'LIVE elapsed or layout failed');
        const panel = document.querySelector('#room-panel'), title = document.createElement('div');
        title.setAttribute('data-e2e', 'user-profile-live-title'); title.textContent = 'Visible public title'; panel.append(title);
        check(collect().media.title === title.textContent, 'visible room title missed'); title.style.opacity = '0'; check(collect() === null, 'rejected title fell back'); title.remove();
        const profile = document.querySelector('[data-e2e="live-header-container"] a'); profile.href = '/@other.creator'; check(collect() === null, 'mismatched LIVE identity used'); profile.href = '/@example.creator';
        const video = document.querySelector('#room-video'); Object.defineProperty(video, 'paused', { value: true, configurable: true });
        check(createPresenceIntent(normalizeActivityReport(collect(), 2, config, environment.location.href)).timestamps === null, 'paused LIVE kept timer');
        panel.style.display = 'none'; const feed = document.querySelector('#feed'); feed.style.display = ''; environment.location.href = 'https://www.tiktok.com/live';
        report = collect(); presence = createPresenceIntent(normalizeActivityReport(report, 2, config, environment.location.href));
        check(report.modeId === 'live-featured' && presence.state === 'Featured LIVE Creator' && presence.buttons[0].url === 'https://www.tiktok.com/@feed.creator/live', 'featured faded metadata failed');
        const fade = feed.querySelector('.ee35qag0'); fade.style.display = 'none'; check(collect() === null, 'fade exception bypassed display'); fade.style.display = '';
        fade.setAttribute('aria-hidden', 'true'); check(collect() === null, 'fade exception bypassed aria-hidden'); fade.removeAttribute('aria-hidden');
        feed.querySelector('.e1xspjl34').style.opacity = '0'; check(collect() === null, 'fade exception bypassed creator opacity');
      }
    }, { config: genericTikTokConfiguration, href, expectedTitle, expectedCreator, fixture });
  }
  for (const configuration of [instagramConfiguration, genericInstagramConfiguration]) {
    await page.goto(base + '/fixture.html');
    await page.evaluate(async (config) => {
      const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
      const { collectGenericActivityV2 } = await import('/core/activity-v2-generic.js');
      const { validateActivityV2, INSTAGRAM_LOGO_URL } = await import('/core/activity-api-v2.js');
      const { normalizeActivityReport } = await import('/core/activity-validator.js');
      const { createPresenceIntent } = await import('/core/presence.js');
      validateActivityV2(JSON.stringify(config));
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const environment = { location: { href: 'https://www.instagram.com/reels/Example_123/?tracking=private' },
        innerWidth: window.innerWidth, innerHeight: window.innerHeight, getComputedStyle: window.getComputedStyle.bind(window) };
      const serialized = new Function(`return (${collectActivityV2.toString()})`)();
      const generic = new Function(`return (${collectGenericActivityV2.toString()})`)();
      const collect = () => serialized(config, document, environment, {}, generic);
      const handleOf = report => report?.media.channel || (report?.media.creator && '@' + report.media.creator);
      const prepareVideo = (video) => Object.defineProperties(video, {
        readyState: { value: 4, configurable: true }, ended: { value: false, configurable: true },
        paused: { value: false, configurable: true }, currentTime: { value: 12 }, duration: { value: 60 }, playbackRate: { value: 1 },
      });
      // Current Instagram Reels has twelve nested layout wrappers between the
      // VIDEO and its common creator/caption container (inspected Oct 14, 2026).
      const card = (handle, title, id = '') => `<div class="x5lhr3w"><a aria-label="${handle} reels" href="/${handle}/reels/?tracking=private"><span>${handle}</span></a>
        <div role="button"><div><div dir="auto" class="caption">${title}</div></div></div>
        ${'<div>'.repeat(12)}<video poster="https://private.example/preview.jpg"></video>${'</div>'.repeat(12)}
        ${id ? `<a href="/reels/${id}/?tracking=private">Open reel</a>` : ''}</div>`;
      document.body.innerHTML = `<style>video{width:320px;height:500px} #previous{position:absolute;top:-480px} #current{width:340px} .offscreen{position:absolute;top:2000px}</style>
        <main><div id="previous">${card('previous', 'Previous reel')}</div><div id="current">${card('example.creator', 'A great reel <a href="/explore/tags/hello/">#hello</a>', 'Example_123')}</div>
        <aside><a href="/commenter/">PRIVATE commenter</a><h1>PRIVATE comment</h1></aside></main>`;
      for (const video of document.querySelectorAll('video')) prepareVideo(video);
      let report = collect();
      check(report?.media.title === 'A great reel #hello' && handleOf(report) === '@example.creator', 'Instagram mixed adjacent card or comment metadata');
      let presence = createPresenceIntent(normalizeActivityReport(report, 2, config, environment.location.href), 100000);
      check(presence.details === report.media.title && presence.state === '@example.creator' && presence.assets.largeImage === INSTAGRAM_LOGO_URL &&
        presence.buttons[0].url === `https://www.instagram.com/${config.schemaVersion === 2 ? 'reels' : 'reel'}/Example_123/` && presence.timestamps.end === 148, 'Instagram reel presence/logo/progress failed');
      const current = document.querySelector('#current'); const video = current.querySelector('video');
      Object.defineProperty(video, 'paused', { value: true });
      check(handleOf(collect()) === '@example.creator' && collect().playback.state === 'paused', 'Adjacent autoplay stole paused Instagram reel');
      for (const route of ['https://www.instagram.com/reels/', 'https://instagram.com/reel/Example_123/', 'https://www.instagram.com/reels/Example_123/']) {
        environment.location.href = route; check(collect()?.media.title === 'A great reel #hello', 'Instagram feed/individual route failed');
      }
      const caption = current.querySelector('.caption');
      for (const css of ['display:none', 'opacity:0', 'visibility:hidden', 'content-visibility:hidden']) {
        const hidden = document.createElement('span'); hidden.textContent = 'PRIVATE'; hidden.style.cssText = css; caption.append(hidden);
        check(collect() === null, 'Instagram exposed hidden caption text'); hidden.remove();
      }
      caption.parentElement.remove();
      check(collect()?.media.title === 'Watching Reel', 'Instagram captionless reel fallback failed');
      current.querySelector('a[aria-label]').setAttribute('href', 'https://www.instagram.com.evil.example/other/reels/');
      check(collect() === null, 'Instagram accepted external creator link or borrowed adjacent metadata');
      document.body.innerHTML = '<style>video{width:320px;height:500px}</style><main><article><header><a href="https://www.instagram.com/example.creator/"><span>example.creator</span></a></header><video></video><h1>Individual caption</h1><ul><li><span>PRIVATE comment</span></li></ul></article></main>';
      prepareVideo(document.querySelector('video'));
      check(collect()?.media.title === 'Individual caption', 'Instagram article reel failed');
      document.querySelector('header').remove();
      check(collect() === null, 'Instagram borrowed a commenter without a creator header');

      if (config.schemaVersion === 2) {
        // A visible winning player without its own metadata cannot fall through
        // to a smaller ready neighbor, even when both layout modes see it.
        document.body.innerHTML = `<style>video{width:320px;height:500px} #neighbor{position:absolute;top:-480px}</style><main><div id="neighbor">${card('neighbor', 'Neighbor caption')}</div><div id="winner"><video></video></div></main>`;
        for (const video of document.querySelectorAll('video')) prepareVideo(video);
        environment.location.href = 'https://www.instagram.com/reels/';
        check(collect() === null, 'Instagram borrowed adjacent metadata for an unbound winning player');
        document.querySelector('#winner').innerHTML = card('example.creator', 'Current caption', 'Different_ID');
        prepareVideo(document.querySelector('#winner video'));
        environment.location.href = 'https://www.instagram.com/reel/Example_123/';
        check(collect() === null, 'Instagram accepted mismatched reel/page identity');
        document.querySelector('#winner a[aria-label] span').textContent = 'other.creator';
        environment.location.href = 'https://www.instagram.com/reels/';
        check(collect() === null, 'Instagram accepted a creator path/text mismatch');
        document.querySelector('#winner a[aria-label] span').textContent = 'example.creator';
        document.querySelector('#winner a[aria-label]').closest('.x5lhr3w').removeAttribute('class');
        check(collect()?.media.creator === 'example.creator', 'Instagram retained an adapter class dependency');
        environment.location.href = 'https://www.instagram.com/stories/example.creator/123/';
        check(collect() === null, 'Reels-only package emitted a story');
      } else {
        environment.location.href = 'https://www.instagram.com/stories/example.creator/123456789/?private=value';
        document.body.innerHTML = `<style>video,.story-photo{width:320px;height:500px} .preview{position:absolute;left:500px} .preview img{width:209px;height:372px}</style><section>
          <div class="preview"><a href="/stories/neighbor/999/"><img></a><span>PRIVATE neighbor</span></div>
          <div id="story"><div class="story-header"><a href="https://www.instagram.com/example.creator/"><span>example.creator</span></a>
          <div role="button"><div aria-label="Pause">Pause</div></div></div><video></video><form><textarea>PRIVATE reply</textarea></form></div></section>`;
        const panel = document.querySelector('#story'); let storyVideo = panel.querySelector('video'); prepareVideo(storyVideo);
        report = collect();
        check(report?.media.title === 'Watching Story' && report.media.channel === '@example.creator' && report.playback.duration === 60, 'Instagram video story failed');
        presence = createPresenceIntent(normalizeActivityReport(report, 2, config), 100000);
        check(presence.assets.largeImage === INSTAGRAM_LOGO_URL && presence.buttons[0].url === 'https://www.instagram.com/stories/example.creator/123456789/', 'Instagram story logo/clean URL failed');
        Object.defineProperty(storyVideo, 'ended', { value: true }); check(collect() === null, 'Instagram ended story survived');
        Object.defineProperty(storyVideo, 'ended', { value: false });
        Object.defineProperty(storyVideo, 'readyState', { value: 0 }); check(collect() === null, 'Instagram story preload survived');
        storyVideo.remove();
        const image = document.createElement('img'); image.className = 'story-photo'; image.alt = 'PRIVATE image description'; panel.append(image);
        image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="500"><rect width="320" height="500" fill="purple"/></svg>');
        await image.decode();
        report = collect(); check(report?.media.subtitle === 'Story' && report.playback.duration === 0 && report.playback.position === 0,
          `Instagram photo story failed: ${JSON.stringify({ report, rect: image.getBoundingClientRect().toJSON(), complete: image.complete, width: image.naturalWidth })}`);
        check(createPresenceIntent(normalizeActivityReport(report, 2, config)).timestamps === null, 'Instagram fabricated photo story progress');
        panel.querySelector('[aria-label]').setAttribute('aria-label', 'Play');
        check(collect()?.playback.state === 'paused', 'Instagram paused photo story failed');
        panel.querySelector('a').setAttribute('href', 'https://www.instagram.com/other.creator/'); check(collect() === null, 'Instagram story borrowed mismatched creator');
        panel.querySelector('a').setAttribute('href', 'https://www.instagram.com/example.creator/');
        image.style.display = 'none'; check(collect() === null, 'Instagram hidden photo story survived'); image.style.display = '';
        panel.querySelector('[aria-label]').parentElement.remove(); check(collect() === null, 'Instagram story preview without active control survived');
      }
      for (const route of ['https://www.instagram.com/direct/inbox/', 'https://www.instagram.com/accounts/edit/', 'https://www.instagram.com/',
        'https://www.instagram.com/example.creator/', 'https://www.instagram.com/explore/', 'https://www.instagram.com/stories/highlights/123/',
        'http://www.instagram.com/reels/', 'https://user:password@www.instagram.com/reels/',
        'https://www.instagram.com:8443/reels/', ...(config.schemaVersion === 1 ? ['https://www.instagram.com.evil.example/reels/'] : [])]) {
        environment.location.href = route; check(collect() === null, `Instagram unrelated/private route survived: ${route}`);
      }
    }, configuration);
  }
  await page.goto(base + '/fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    const { buildHeadlessActivity } = await import('/discord/activity-builder.js');
    document.body.innerHTML = '<div id="main"><div id="result-stats">About 4,820,000,000 results (0.22s)</div><form><input value="PRIVATE DRAFT"><textarea>PRIVATE AI FOLLOWUP</textarea></form><div hidden>PRIVATE TEXT</div></div>';
    const environment = { location: { href: 'https://www.google.com/search?q=test&tracking=PRIVATE' }, getComputedStyle: window.getComputedStyle.bind(window) };
    const state = {};
    const serialized = new Function(`return (${collectActivityV2.toString()})`)();
    const collect = () => serialized(config, document, environment, state);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    let r = collect(); check(r?.media.title === 'test', 'Submitted Google query failed');
    check(r.media.subtitle === 'About 4,820,000,000 results (0.22s)', 'Visible Google result summary failed');
    state.page.startedAt -= 11000;
    let intent = createPresenceIntent(normalizeActivityReport(collect(), 2, config, environment.location.href), 100000);
    check(intent.name === 'Google' && intent.details === 'Searching for : test' && intent.type === 'playing' && intent.timestamps.start === 89, 'Google Search presence failed');
    const stats = document.querySelector('#result-stats');
    for (const css of ['display:none', 'visibility:hidden', 'opacity:0']) {
      stats.style.cssText = css; check(collect().media.subtitle === undefined, 'Hidden Google result stats were read');
      stats.style.cssText = '';
    }
    stats.innerHTML = 'Visible summary <span hidden>PRIVATE HIDDEN VALUE</span>';
    check(collect().media.subtitle === undefined, 'Hidden Google summary descendant was read');
    for (const [suffix, name] of [['&udm=2', 'Google Images'], ['&tbm=isch', 'Google Images'], ['&udm=50', 'Google AI']]) {
      environment.location.href = `https://www.google.com/search?q=hello+%26+%E7%8C%AB${suffix}`;
      r = collect(); check(r?.media.title === 'hello & 猫' && r.playback.position < 1, 'Google route/query transition failed');
      intent = createPresenceIntent(normalizeActivityReport(r, 2, config, environment.location.href));
      check(intent.name === name && intent.state === '' && !intent.state.includes('Live'), 'Google mode/empty state failed');
      check(buildHeadlessActivity(intent, '1549066134706323548').state === undefined, 'Google Images invented a state line');
    }
    for (const suffix of ['&udm=28', '&udm=vids', '&tbm=nws', '&q=other']) {
      environment.location.href = `https://www.google.com/search?q=test${suffix}`;
      check(collect() === null && state.page === undefined, 'Google unrelated route did not clear');
    }
    environment.location.href = 'https://www.google.com/search?q=test';
    document.querySelector('#main').style.display = 'none'; check(collect() === null, 'Hidden Google container survived');
    document.querySelector('#main').style.display = '';
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    check(collect() === null, 'Hidden Google tab survived');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    check(collect()?.playback.position < 1, 'Google visible session did not recover');
  }, googleConfiguration);
  console.log('Google real-DOM fixtures passed: adapter-free serialized page collector, submitted query, visible-only summary, Search/Images/AI names, elapsed timer, omitted state line, draft/hidden-text isolation, route and tab cleanup.');
  await page.goto(base + '/fixture.html');
  await page.evaluate(async (config) => {
    const { collectActivityV2 } = await import('/core/activity-v2-runtime.js');
    const { matchActivityV2Page } = await import('/core/activity-api-v2.js');
    const { normalizeActivityReport } = await import('/core/activity-validator.js');
    const { createPresenceIntent } = await import('/core/presence.js');
    const { buildHeadlessActivity } = await import('/discord/activity-builder.js');
    document.body.innerHTML = '<div id="react-landing-container"><h1>One platform. Millions of games.</h1></div><main class="container-main"><div id="game-carousel-web-app"><h1>Charts</h1></div><form><input value="PRIVATE SEARCH"></form><div id="game-detail-page"><div class="game-title-container"><h1 class="game-name">Brookhaven 🏡RP</h1></div><p>PRIVATE DESCRIPTION</p></div><h1 class="game-name">Wrong recommended game</h1><div>PRIVATE PROFILE, FRIENDS, INBOX, INVENTORY, BALANCE</div></main>';
    const environment = { location: { href: 'https://www.roblox.com/' }, getComputedStyle: window.getComputedStyle.bind(window) };
    const state = {};
    const serialized = new Function(`return (${collectActivityV2.toString()})`)();
    const match = new Function(`return (${matchActivityV2Page.toString()})`)();
    const collect = () => serialized(config, document, environment, state);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    for (const [path, details] of [['/', 'Browsing home'], ['/home', 'Browsing home'], ['/discover', 'Browsing charts'],
      ['/charts', 'Browsing charts'], ['/charts/trending-in-roleplay-and-avatar-sim', 'Browsing charts'],
      ['/catalog?Keyword=PRIVATE', 'Browsing marketplace'], ['/catalog/123/Example-Hat', 'Browsing marketplace'],
      ['/upgrades/robux?ctx=navpopover', 'Browsing Robux'], ['/plus', 'Browsing Roblox Plus'],
      ['/users/profile', 'Browsing profiles'], ['/users/123/profile', 'Browsing profiles'],
      ['/users/friends#!/friend-requests', 'Browsing friends'], ['/my/avatar', 'Browsing avatar'],
      ['/users/123/inventory', 'Browsing inventory'], ['/trades', 'Browsing trades'], ['/communities', 'Browsing communities'],
      ['/my/messages/#!/inbox', 'Browsing messages'], ['/my/account#!/privacy', 'Browsing settings'], ['/giftcards-us', 'Browsing gift cards'],
      ['/games/4924922222/Brookhaven-RP', 'Viewing: Brookhaven 🏡RP']]) {
      environment.location.href = 'https://www.roblox.com' + path;
      const report = collect(); check(report && match(config, environment.location.href)?.id === report.routeId, 'Roblox route/collector parity failed');
      const intent = createPresenceIntent(normalizeActivityReport(report, 2, config, environment.location.href));
      check(intent.name === 'Roblox' && intent.details === details && intent.state === '', 'Roblox presence text failed');
      check(buildHeadlessActivity(intent, '1549066134706323548').state === undefined, 'Roblox invented a second status line');
      check(!JSON.stringify(report).includes('PRIVATE') && !JSON.stringify(report).includes('Wrong recommended'), 'Roblox read unrelated page text');
    }
    const heading = document.querySelector('#game-detail-page h1');
    for (const css of ['display:none', 'visibility:hidden', 'opacity:0']) {
      heading.style.cssText = css; check(collect() === null, 'Hidden Roblox experience heading survived'); heading.style.cssText = '';
    }
    heading.innerHTML = 'Brookhaven <span hidden>PRIVATE HIDDEN TITLE</span>'; check(collect() === null, 'Roblox read a hidden title descendant');
    heading.textContent = 'Brookhaven 🏡RP'; collect(); state.page.startedAt -= 11000;
    environment.location.href += '?tracking=PRIVATE#store'; check(collect().playback.position >= 11, 'Roblox tracking reset session');
    environment.location.href = 'https://www.roblox.com/games/777/Brookhaven-RP'; check(collect().playback.position < 1, 'Roblox experience ID did not reset session');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    check(collect() === null && state.page === undefined, 'Hidden Roblox tab survived');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    check(collect()?.playback.position < 1, 'Roblox visible tab did not recover');
    for (const path of ['/develop', '/create', '/upgrades/paymentmethods', '/games/private', '/games/123/slug/extra']) {
      environment.location.href = 'https://www.roblox.com' + path; check(collect() === null && match(config, environment.location.href) === null, 'Roblox unsupported route survived');
    }
  }, robloxConfiguration);
  console.log('Roblox real-DOM fixtures passed: serialized page collector and route matcher, distinct Home/Charts/Marketplace/Robux/sidebar details, scoped experience title, hidden/private text rejection, elapsed identity, tab/route cleanup and Discord formatting.');
  const navigationPage = await browser.newPage();
  const navigationRequests = [];
  navigationPage.on('console', message => {
    const text = message.text();
    if (text.startsWith('GOOGLE_NAVIGATION_FIXTURE:')) navigationRequests.push(JSON.parse(text.slice('GOOGLE_NAVIGATION_FIXTURE:'.length)));
  });
  await navigationPage.addInitScript(() => {
    window.__fixtureRequests = [];
    window.chrome = { runtime: {
      async sendMessage(message) {
        window.__fixtureRequests.push(message);
        console.log('GOOGLE_NAVIGATION_FIXTURE:' + JSON.stringify(message));
        return { ok: true };
      },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }),
    } };
  });
  const runtime = `(${runActivityV2.toString()})(${JSON.stringify(googleConfiguration)}, {activityId:'google',activityVersion:'1.0.0',capability:'navigation-test'}, ['https://www.google.com/search*'], [], (pattern, href) => href.startsWith('https://www.google.com/search'), ${collectActivityV2.toString()}, ${matchActivityV2Page.toString()});`;
  await navigationPage.route('https://www.google.com/**', async route => {
    const images = new URL(route.request().url()).searchParams.get('udm') === '2';
    const main = '<div id="main"><div id="result-stats">About 100 results</div></div>';
    const delayed = images ? `<script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(main)}), 250)</script>` : main;
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><a href="/search?q=test&udm=2">Images</a><a href="/search?q=test&udm=50">AI Mode</a><a href="/search?q=test&udm=28">Shopping</a>${delayed}<script>${runtime}</script>` });
  });
  await navigationPage.goto('https://www.google.com/search?q=test');
  await navigationPage.waitForFunction(() => window.__fixtureRequests.some(request => request.payload?.report?.routeId === 'search'));
  const navigationStart = Date.now();
  await navigationPage.getByRole('link', { name: 'Images', exact: true }).click();
  await navigationPage.waitForFunction(() => window.__fixtureRequests.some(request => request.payload?.report?.routeId === 'images'), null, { timeout: 1500 });
  assert.ok(Date.now() - navigationStart < 1800, 'Images waited for the two-second heartbeat instead of DOM readiness');
  assert.ok(navigationRequests.some(request => request.operation === 'presence.clear' && request.payload.navigationUrl === 'https://www.google.com/search?q=test&udm=2'), 'Full Google navigation was treated as a real close');
  const clearCount = navigationRequests.filter(request => request.operation === 'presence.clear').length;
  const spaNavigationStart = Date.now();
  await navigationPage.evaluate(() => {
    history.pushState({}, '', '/search?q=test&udm=50');
    const main = document.querySelector('#main'); main.remove();
    setTimeout(() => document.body.append(main), 250);
  });
  await navigationPage.waitForFunction(() => window.__fixtureRequests.some(request => request.payload?.report?.routeId === 'ai'), null, { timeout: 1500 });
  assert.ok(Date.now() - spaNavigationStart < 1500, 'AI Mode waited for the two-second heartbeat instead of navigation readiness');
  assert.equal(navigationRequests.filter(request => request.operation === 'presence.clear').length, clearCount, 'SPA Google mode change cleared its session while the root was rebuilding');
  await navigationPage.getByRole('link', { name: 'Shopping', exact: true }).click();
  assert.ok(navigationRequests.some(request => request.operation === 'presence.clear' && request.payload.closing && !request.payload.navigationUrl), 'Unsupported Google mode incorrectly received navigation grace');
  await navigationPage.close();
  console.log('Google navigation fixtures passed: full-document handoff, delayed root readiness under two seconds, same-document mode changes without clears, and unsupported-mode exit.');
  const robloxNavigationPage = await browser.newPage();
  const robloxStorage = {};
  const robloxPublished = [];
  const robloxDocumentId = 'roblox-navigation-document';
  const robloxApi = {
    runtime: { getManifest: () => ({ version: '2.0.0' }) },
    storage: { local: {
      async get(key) { return structuredClone(key == null ? robloxStorage : { [key]: robloxStorage[key] }); },
      async set(value) { Object.assign(robloxStorage, structuredClone(value)); },
    } },
    permissions: { async contains() { return true; } },
    userScripts: {
      async configureWorld() {}, async register() {}, async update() {}, async getScripts() { return []; },
      async execute(options) {
        assert.deepEqual(options.target, { tabId: 900, documentIds: [robloxDocumentId] });
        assert.equal(options.worldId, 'chudpresence.activity.roblox');
        assert.equal(options.js[0].code, 'globalThis.location.href');
        return [{ documentId: robloxDocumentId, frameId: 0, result: robloxNavigationPage.url() }];
      },
    },
  };
  const robloxManager = new ActivityManager({ api: robloxApi, onReport: ({ track, senderUrl }) => robloxPublished.push({ track, senderUrl }) });
  const robloxPackage = {
    metadata: JSON.parse(await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/roblox/metadata.json'), 'utf8')),
    source: JSON.stringify(robloxConfiguration), sourceType: 'local',
    icon: 'data:image/png;base64,' + (await fs.readFile(path.join(root, 'ChudPresence-Activities-V2/activities/roblox/icon.png'))).toString('base64'),
  };
  robloxPackage.approval = { digest: await activityV2Digest(robloxPackage) };
  await robloxManager.install(robloxPackage);
  const robloxSender = { tab: { id: 900 }, frameId: 0, documentId: robloxDocumentId,
    userScriptWorldId: 'chudpresence.activity.roblox', url: 'https://www.roblox.com/catalog' };
  await robloxNavigationPage.exposeFunction('__robloxWorkerMessage', message => robloxManager.handleUserScriptMessage(message, robloxSender));
  await robloxNavigationPage.addInitScript(() => {
    window.__robloxResponses = [];
    window.chrome = { runtime: {
      async sendMessage(message) {
        const response = await window.__robloxWorkerMessage(message);
        window.__robloxResponses.push({ operation: message.operation, routeId: message.payload?.report?.routeId, response });
        return response;
      },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }),
    } };
  });
  const robloxRuntime = `(${runActivityV2.toString()})(${JSON.stringify(robloxConfiguration)}, ${JSON.stringify({
    activityId: 'roblox', activityVersion: robloxPackage.metadata.version, apiVersion: 2, capability: robloxManager.records.roblox.capability,
  })}, ['https://www.roblox.com/*'], [], (_pattern, href) => href.startsWith('https://www.roblox.com/'), ${collectActivityV2.toString()}, ${matchActivityV2Page.toString()});`;
  const robloxMain = '<div id="fixture-root"><main class="container-main"><div id="game-carousel-web-app"><h1>Charts</h1></div></main></div>';
  await robloxNavigationPage.route('https://www.roblox.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <nav><a href="/home">Home</a><a href="/charts?device=computer&country=us">Charts</a><a href="/catalog">Marketplace</a><a href="/upgrades/robux">Robux</a></nav>
    ${robloxMain}<script>
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]'); if (!link) return;
      event.preventDefault(); history.pushState({}, '', link.href);
      document.querySelector('#fixture-root')?.remove();
      setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(robloxMain)}), 250);
    });
    ${robloxRuntime}</script>` }));
  await robloxNavigationPage.goto('https://www.roblox.com/home');
  await robloxNavigationPage.waitForFunction(() => window.__robloxResponses.some(item => item.routeId === 'home' && item.response.ok));
  for (const [label, routeId, details] of [['Charts', 'charts', 'Browsing charts'], ['Marketplace', 'marketplace', 'Browsing marketplace'],
    ['Robux', 'robux', 'Browsing Robux'], ['Home', 'home', 'Browsing home'], ['Charts', 'charts', 'Browsing charts'], ['Home', 'home', 'Browsing home']]) {
    const previousResponses = await robloxNavigationPage.evaluate(() => window.__robloxResponses.length);
    const started = Date.now();
    await robloxNavigationPage.getByRole('link', { name: label, exact: true }).click();
    await robloxNavigationPage.waitForFunction(([id, offset]) => window.__robloxResponses.slice(offset).some(item => item.routeId === id && item.response.ok),
      [routeId, previousResponses], { timeout: 1500 });
    assert.ok(Date.now() - started < 1800, `${label} waited for the heartbeat instead of navigation readiness`);
    assert.equal(robloxPublished.at(-1).track.display.details, details);
    assert.equal(robloxPublished.at(-1).senderUrl, robloxNavigationPage.url());
  }
  assert.equal((await robloxNavigationPage.evaluate(() => window.__robloxResponses.filter(item => item.operation === 'presence.report' && !item.response.ok))).length, 0);
  await robloxNavigationPage.close();
  console.log('Roblox worker/navigation fixture passed: Home → Charts → Marketplace → Robux → Home → Charts → Home, delayed DOM replacement, frozen sender URL and verified document-bound publication.');
  console.log('Instagram compatibility real-DOM fixtures passed: serialized V2 collector, feed/individual/article reels, adjacent autoplay, creator/caption boundaries, hidden/private text, static logo, clean buttons, video/photo stories, pause, loading/ended/hidden media and route clearing.');
  console.log('Instagram 1.1.0 generic reels passed the same deeply nested card and article fixtures using reusable rules, including paused-card ranking, missing winning metadata, path/text identity, reel/page identity, public links, logo, hidden-text rejection and story exclusion.');
  console.log('TikTok current LIVE fixture passed: room/header boundary, absent title fallback, elapsed session, pause, title/creator checks, chat/recommendation isolation, featured cards, narrow public fade exception and legacy approval boundaries.');
  console.log('TikTok Explore overlay fixture passed: public metadata boundary, current player identity, clean nickname, private-comment isolation, preloads, mismatched creator/hidden-field rejection and close/grid clearing.');
  console.log('TikTok current-player fixture passed: visible SR canvas, narrow opacity exemption, creator paragraph/profile handle, empty formatting nodes, current feed player IDs, timers and hidden-content rejection.');
  console.log('TikTok browser fixture passed: on-screen card selection, creator/description isolation, clean public buttons, logo-only artwork, hidden text rejection, pause, individual video, Following, LIVE session timer and private-route cleanup.');
  console.log('TikTok 1.1.1 generic package passed the same real-DOM feed, SR canvas, Explore overlay, current LIVE and featured-card fixtures using only serialized reusable rules, including distinct display names/handles, formatted captions, links, player identity, visibility boundaries, pause and elapsed timing.');
  console.log('Browser fixture passed: staged approval, cancel, denied/granted permissions, user gesture, narrow dialog, real DOM extraction, sensitive-node and CSS-hidden-descendant rejection, and visible markup recovery.');
  console.log('Prime Video browser fixture passed: real player DOM, aria-hidden video, preview isolation, removed controls, pause, source changes, hidden title/episode rejection, cache invalidation/recovery and player close.');
  console.log('Prime Video details fixture passed: episode names/numbers, matching artwork, formatting, hidden thumbnail fallback and mismatched series rejection.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
