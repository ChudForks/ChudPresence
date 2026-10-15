import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { describeActivityV2, validateActivityV2, validateV2GenericSelector, validateV2Metadata, validateV2Report, validateV2Selector } from '../schemas/activity-api-v2.js';

const configuration = () => ({ schemaVersion: 2, kind: 'episode', scope: '[data-player="main"]',
  fields: {
    title: { source: 'dom.text', selectors: ['h1[data-title="current"]'], split: { separator: ' • ', index: 1 }, fallback: 'Watching episode' },
    series: { source: 'constant', value: 'Example series' },
    season: { source: 'dom.attribute', selectors: ['.season'], attribute: 'aria-label', removePrefix: 'Season ', parse: 'integer', fallback: 1 },
    episode: { source: 'constant', value: 3 },
  }, player: { adapter: 'html-media', selectors: ['video'], selection: 'largest-visible', retainMetadata: true, allowAriaHidden: true, canvasSelector: 'canvas[data-render="player"]' },
  presentation: { details: '{series}: {title}', state: 'Season {season}, Episode {episode}', artwork: { large: 'https://example.com/logo.png', largeText: 'Example' }, buttons: [{ label: 'Visit Example', url: 'https://example.com/watch/' }] },
  lookup: { service: 'movie-title', input: { title: 'title', series: 'series' } },
});
const validate = (config) => validateActivityV2(JSON.stringify(config));
const report = () => ({ kind: 'episode', media: { title: 'Example episode', series: 'Example series', season: 1, episode: 3 }, playback: { state: 'playing', position: 1, duration: 20, live: false, rate: 1 } });

test('single-player cards, visible path/text checks and public link identity are reusable bounded declarations', async () => {
  const c = validateActivityV2(await fs.readFile(new URL('../activities/instagram/activity.json', import.meta.url), 'utf8'));
  assert.equal(c.schemaVersion, 2); assert.equal(c.scope, 'video'); assert.equal(c.container.singlePlayer, true);
  assert.equal(c.container.ancestors, 16); assert.equal(c.fields.creator.matchText, true);
  assert.deepEqual(c.pageIdentity.links, { media: 1 });
  assert.equal(validateV2GenericSelector('[dir="auto"]'), '[dir="auto"]');
  assert.equal(validateV2GenericSelector('[id^="mount_"]'), '[id^="mount_"]');
  for (const mutate of [
    c => { delete c.container; }, c => { c.container.singlePlayer = false; },
    c => { c.container.singlePlayer = 'yes'; }, c => { c.container.ancestors = 17; },
    c => { c.scope = 'div'; }, c => { c.player.adapter = 'dom-media'; },
    c => { c.fields.creator.matchText = 'yes'; }, c => { c.fields.creator.pageFallback = true; },
    c => { c.pageIdentity.links = { unknown: 1 }; }, c => { c.pageIdentity.links.media = 8; },
    c => { c.pageIdentity.links.media = 1.5; }, c => { c.fields.title.attribute = 'dir'; },
  ]) { const changed = structuredClone(c); mutate(changed); assert.throws(() => validate(changed)); }
  const withoutGrant = structuredClone(c); withoutGrant.scope = '.card'; delete withoutGrant.container.singlePlayer;
  assert.throws(() => validate(withoutGrant)); withoutGrant.container.ancestors = 5; assert.deepEqual(validate(withoutGrant), withoutGrant);
});

test('media mode and public-link declarations remain bounded data with explicit path and visibility grants', () => {
  const c = configuration();
  c.paths = ['/watch/{number}']; c.requiredFields = ['title'];
  c.container = { ancestors: 2, required: ['.header'], exclude: ['#app'] };
  c.links = { media: { paths: ['/watch/{number}'], sources: [{ source: 'page' }] } };
  c.presentation.buttons = [{ label: 'Watch', link: 'media' }];
  c.fields.creator = { source: 'first', rules: [
    { source: 'dom.text', selectors: ['.creator'], parse: 'handle', ignoreEmptyBreaks: true, maxDescendants: 64 },
    { source: 'public-path', selectors: ['.header a'], paths: ['/{handle}'], segment: 0, opacityAncestor: '.fade' },
  ] };
  c.modes = [{ id: 'live', kind: 'stream', paths: ['/live/{number}'], scope: '.room', fields: { title: { source: 'constant', value: 'Live' } }, player: { adapter: 'html-media', selectors: ['video'], elapsed: true, live: true } }];
  assert.deepEqual(validate(c), c);
  for (const mutate of [
    c => { c.modes.push(c.modes[0]); }, c => { c.modes[0].id = 'default'; }, c => { c.modes[0].modes = []; },
    c => { c.modes[0].player.adapter = 'tiktok'; }, c => { c.modes[0].paths = ['/private?secret']; },
    c => { c.paths = ['//outside.example/path']; }, c => { c.paths = ['/watch/../private']; }, c => { c.paths = ['/watch/%2f']; },
    c => { c.container.ancestors = 6; }, c => { c.container.required = ['body']; }, c => { c.requiredFields = ['undeclared']; },
    c => { c.links.media.sources = [{ source: 'fetch', url: 'https://outside.example/' }]; },
    c => { c.links.media.sources = [{ source: 'template', path: 'https://outside.example/{title}' }]; },
    c => { c.links.media.sources = [{ source: 'template', path: '//outside.example/{title}' }]; },
    c => { c.links.media.sources = [{ source: 'template', path: '/{unknown}' }]; },
    c => { c.presentation.buttons[0].url = 'https://example.com/'; }, c => { c.presentation.buttons[0].link = 'undeclared'; },
    c => { c.fields.creator.rules[1].attribute = 'value'; }, c => { c.fields.creator.rules[1].paths = ['/private?secret']; },
    c => { c.fields.creator.rules[0].source = 'first'; }, c => { c.fields.creator.rules[0].fallback = 'Hidden fallback'; },
    c => { c.fields.creator.rules[0].opacityAncestor = 'body'; },
    c => { c.fields.creator.rules[0].maxDescendants = 129; },
    c => { c.fields.creator.rules[0].maxDescendants = 0; },
    c => { c.fields.creator.rules[0].maxDescendants = '64'; },
    c => { c.fields.creator.rules[0].maxDescendants = 1.5; },
    c => { c.pageIdentity = { paths: ['/watch/{number}'], playerId: { selector: '.player', split: { separator: '-', index: 16 } }, segment: 0 }; },
  ]) { const changed = structuredClone(c); mutate(changed); assert.throws(() => validate(changed)); }
});

test('schemaVersion 2 supports reusable DOM fields, native player options, presentation, and named service inputs', () => {
  const config = configuration();
  assert.deepEqual(validate(config), config);
  assert.deepEqual(validateV2Report(report(), config), report());
  const review = describeActivityV2({ matches: ['https://example.com/watch/*'] }, JSON.stringify(config));
  for (const input of ['data-player', 'split', 'fallback', 'retainMetadata', 'allowAriaHidden', 'canvasSelector', 'largest-visible', 'Season {season}', 'logo.png', 'Visit Example', 'movie-title', '"series":"series"']) assert.ok(review.includes(input), input);
  assert.match(review, /independent trusted service policy/);
});

test('generic CSS accepts only bounded public attribute selection and narrow scopes', () => {
  for (const selector of ['[data-e2e="video-title"]', 'section.player > [role="button"]', '.panel [aria-label$=" Pause"]', '[class*="Div Details"] h1', "canvas[data-render^='main']", '#player [data-id="a,b>c"]']) {
    assert.equal(validateV2GenericSelector(selector), selector);
    assert.equal(validateV2Selector(selector, { extended: true }), selector);
  }
  for (const selector of ['[href="secret"]', '[value="draft"]', '[data-token]', '[data-token~="public"]', '[data-id=main]', ':has(video)', '.one, .two', '.one + .two', '.one ~ .two', '.one\\:two', '*', 'form .title', '.player input', '.one >', '.one >> .two', `.player [role="${'a'.repeat(129)}"]`, '.a .b .c .d .e .f .g .h .i']) assert.throws(() => validateV2GenericSelector(selector), undefined, selector);
  assert.throws(() => validateV2GenericSelector('main', { scope: true }), /scope/);
  assert.equal(validateV2GenericSelector('[role="region"]', { scope: true }), '[role="region"]');
  assert.throws(() => validateV2Selector('[role="region"]'), /unsupported/);
});

test('legacy V2 packages do not inherit generic selectors, fields, players or services', () => {
  const legacy = { schemaVersion: 1, kind: 'video', scope: '#player', fields: { title: { source: 'dom.text', selectors: ['h1'] } }, player: { adapter: 'html-media', selectors: ['video'] } };
  assert.deepEqual(validate(legacy), legacy);
  for (const mutate of [
    (c) => { c.lookup = { service: 'movie-title', input: { title: 'title' } }; },
    (c) => { c.presentation = { details: '{title}' }; },
    (c) => { c.fields.title = { source: 'constant', value: 'Title' }; },
    (c) => { c.fields.title.selectors = ['[data-title="current"]']; },
    (c) => { c.fields.episode = { source: 'constant', value: 1 }; },
    (c) => { c.fields.title.fallback = 'Title'; },
    (c) => { c.fields.title.maxDescendants = 64; },
    (c) => { c.player.retainMetadata = true; },
    (c) => { c.player.adapter = 'dom-media'; },
  ]) { const config = structuredClone(legacy); mutate(config); assert.throws(() => validate(config)); }
});

test('generic rules reject executable expressions, arbitrary reads, wrong types and unbounded transforms', () => {
  for (const mutate of [
    (c) => { c.fields.title.source = 'url.query'; },
    (c) => { c.fields.title.attribute = 'href'; },
    (c) => { c.fields.title.source = 'dom.attribute'; c.fields.title.attribute = 'value'; },
    (c) => { c.fields.title.selectors = ['input']; },
    (c) => { c.fields.title.split.index = 16; },
    (c) => { c.fields.title.split.separator = ''; },
    (c) => { c.fields.title.split.expression = 'fetch()'; },
    (c) => { c.fields.title.fallback = '  Title '; },
    (c) => { c.fields.series.value = 'two\nlines'; },
    (c) => { c.fields.series.selectors = ['h1']; },
    (c) => { c.fields.season.parse = 'number'; },
    (c) => { c.fields.episode.value = '3'; },
    (c) => { c.fields.episode.value = 10001; },
    (c) => { c.fields.title.parse = 'integer'; },
    (c) => { c.player.adapter = 'tiktok'; },
    (c) => { c.player.position = { source: 'dom.text', selectors: ['.clock'], parse: 'clock' }; },
  ]) { const config = configuration(); mutate(config); assert.throws(() => validate(config)); }
});

test('DOM media requires declarative visible control state and bounded DOM timing', () => {
  const config = configuration();
  config.player = { adapter: 'dom-media', selectors: ['canvas', 'img'], state: { selectors: ['[role="button"]'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] }, position: { source: 'dom.text', selectors: ['.position'], parse: 'clock' }, duration: { source: 'dom.attribute', selectors: ['.duration'], attribute: 'aria-label', removePrefix: 'Duration ', parse: 'number' } };
  assert.deepEqual(validate(config), config);
  for (const mutate of [
    (c) => { delete c.player.state; },
    (c) => { c.player.state.attribute = 'title'; },
    (c) => { c.player.state.playing = ['Play']; },
    (c) => { c.player.state.playing = ['Pause', 'Pause']; },
    (c) => { c.player.state.playing = []; },
    (c) => { c.player.state.playing = ['  Pause']; },
    (c) => { c.player.allowAriaHidden = true; },
    (c) => { c.player.canvasSelector = 'canvas'; },
    (c) => { c.player.elapsed = true; },
    (c) => { c.player.position.parse = 'integer'; },
    (c) => { c.player.position.source = 'constant'; c.player.position.value = 100; },
    (c) => { c.player.position.fallback = 100; },
  ]) { const invalid = structuredClone(config); mutate(invalid); assert.throws(() => validate(invalid)); }
});

test('static presentation and named lookup declarations cannot introduce network destinations or dynamic URLs', () => {
  for (const mutate of [
    (c) => { c.presentation.details = '{undeclared}'; },
    (c) => { c.presentation.state = '{title.toString()}'; },
    (c) => { c.presentation.artwork.large = 'https://example.com/{title}.png'; },
    (c) => { c.presentation.artwork.large = 'https://example.com/logo.png?title=secret'; },
    (c) => { c.presentation.artwork.large = 'https://example.com/logo.png?'; },
    (c) => { c.presentation.artwork.large = 'https://example.com:443/logo.png'; },
    (c) => { c.presentation.artwork.large = 'https://127.0.0.1/logo.png'; },
    (c) => { c.presentation.buttons[0].url = 'https://example.com/?q={title}'; },
    (c) => { c.presentation.buttons[0].url = 'https://example.com/#'; },
    (c) => { c.presentation.buttons[0].label = '{title}'; },
    (c) => { c.lookup.url = 'https://outside.example/'; },
    (c) => { c.lookup.service = 'https://outside.example/'; },
    (c) => { c.lookup.service = 'a'; },
    (c) => { c.lookup.input.title = 'notDeclared'; },
    (c) => { c.lookup.input = {}; },
    (c) => { c.lookup.input = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['p' + i, 'title'])); },
    (c) => { c.network = ['outside.example']; },
  ]) { const config = configuration(); mutate(config); assert.throws(() => validate(config)); }
  // Unknown service IDs are syntactically valid here. Independent worker policy
  // must decide availability; package contents cannot self-authorize them.
  const config = configuration(); config.lookup.service = 'unknown-service'; assert.equal(validate(config).lookup.service, 'unknown-service');
  config.lookup.service = 'a'.repeat(64); assert.equal(validate(config).lookup.service.length, 64);
  config.lookup.service = 'a'.repeat(65); assert.throws(() => validate(config));
});

test('generic reports expose only declared metadata and bounded playback, and enforce constants', () => {
  const config = configuration();
  for (const mutate of [
    (r) => { r.media.series = 'Different constant'; },
    (r) => { delete r.media.episode; },
    (r) => { r.media.season = '1'; },
    (r) => { r.media.episode = 10001; },
    (r) => { r.media.title = '  Title'; },
    (r) => { r.media.url = 'https://outside.example'; },
    (r) => { r.buttons = []; },
    (r) => { r.artwork = {}; },
    (r) => { r.lookup = {}; },
    (r) => { r.playback.position = Infinity; },
    (r) => { r.playback.duration = -1; },
    (r) => { r.playback.rate = 17; },
    (r) => { r.playback.live = 'true'; },
    (r) => { r.playback.state = 'secret'; },
    (r) => { r.kind = 'video'; },
  ]) { const invalid = report(); mutate(invalid); assert.throws(() => validateV2Report(invalid, config)); }
});

test('generic feed example stays independently loadable without an activity catalog entry', async () => {
  const metadata = validateV2Metadata(JSON.parse(await fs.readFile(new URL('../examples/generic-feed/metadata.json', import.meta.url), 'utf8')));
  const config = validateActivityV2(await fs.readFile(new URL('../examples/generic-feed/activity.json', import.meta.url), 'utf8'));
  assert.equal(metadata.apiVersion, 2);
  assert.equal(metadata.minExtensionVersion, '2.1.0');
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.player.selection, 'largest-visible');
  const catalog = JSON.parse(await fs.readFile(new URL('../catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.activities.some((item) => item.id === metadata.id), false);
});
