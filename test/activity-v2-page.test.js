import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectActivityV2Snapshot,
  validateActivityV2PageAccess,
  validateActivityV2Selector,
} from '../extension/core/activity-v2-page.js';

// Deliberately expose every requested node from querySelectorAll. These fixtures
// test the broker's independent read guards, rather than relying on CSS to hide
// private nodes. Selector grammar is exercised separately below.
function element(name, attributes = {}, children = []) {
  const result = {
    nodeType: 1, tagName: name.toUpperCase(), attributes, childNodes: [], parentElement: null,
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    getBoundingClientRect() { return this.rect || { x: 0, y: 0, width: 100, height: 50 }; },
    append(...nodes) {
      for (let node of nodes) {
        if (typeof node === 'string') node = { nodeType: 3, nodeValue: node };
        node.parentElement = this;
        this.childNodes.push(node);
      }
      return this;
    },
    get textContent() {
      return this.childNodes.map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent).join('');
    },
  };
  return result.append(...children);
}

function documentFixture(matches = {}) {
  return {
    title: 'Not implicitly disclosed',
    location: { href: 'https://viewer:password@example.com/watch/123?token=SECRET#private' },
    defaultView: { getComputedStyle: (node) => node.computedStyle || { display: 'block', visibility: 'visible' } },
    querySelectorAll(selector) { return matches[selector] || []; },
  };
}

function capture(selector, read = 'text', extra = {}) { return { selector, read, ...extra }; }

test('V2 pageAccess validates a small, explicit declaration and defaults to no access', () => {
  assert.deepEqual(validateActivityV2PageAccess(), { selectors: {}, media: false, url: false });
  assert.deepEqual(validateActivityV2PageAccess({ selectors: { title: capture('  main > h1  ') }, url: true }), {
    selectors: { title: { selector: 'main > h1', read: 'text', all: false } }, media: false, url: true,
  });
  for (const invalid of [
    { network: true }, { media: 'true' }, { selectors: [] },
    { selectors: { constructor: capture('main') } },
    { selectors: { title: capture('main', 'html') } },
    { selectors: { title: capture('input', 'attribute', { attribute: 'value' }) } },
    { selectors: { title: capture('main', 'text', { path: ['title'] }) } },
    { selectors: { title: capture('main', 'text', { all: 1 }) } },
    { selectors: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`a${index}`, capture('main')])) },
  ]) assert.throws(() => validateActivityV2PageAccess(invalid), /pageAccess/);
  const accessor = Object.defineProperty({}, 'media', { get() { throw new Error('must not execute'); } });
  assert.throws(() => validateActivityV2PageAccess(accessor), /accessors/);
});

test('selector parser permits complex public DOM and open-shadow traversal', () => {
  for (const selector of [
    'main.player > section + aside ~ article h1.title',
    '[data-testid="watch-player"] :is(.title, [itemprop="name"]):not(.placeholder)',
    'article:has(> .title, + .metadata) > :nth-child(2n + 1 of .episode, .clip)',
    'li:nth-last-child(odd), p:nth-of-type(-n+3), span:only-of-type',
    ':scope > [role="main" i] [aria-label^="Now playing"]',
    'video-player >>> .controls >>> [data-test="title"]',
    '[data-testid="literal >>> value"]',
    '#épisode .タイトル',
  ]) assert.equal(validateActivityV2Selector(selector), selector);
});

test('selector parser rejects secret attribute predicates, state probes, escapes, and malformed nesting', () => {
  for (const selector of [
    '[value]', 'input[value^="A"]', '[data-token]', '[content*="secret"]', '[style]',
    '[href*="token"]', '[src]', '[data-anything]', '[nonce]',
    ':is(.title, :has(input[value^="A"]))', ':nth-child(2n of [data-token])',
    '[va\\6cue]', '\\23 secret', '[VALUE]', 'a:visited', 'input:checked', 'input:autofill',
    ':focus-within', ':target', 'div::before', 'div/*comment*/span', '*|*',
    'main >', 'main,', 'main, )', ':is()', ':has(> > .x)', ':is(.x >>> .y)',
    ':nth-child(2n + nope)', '[role="main" nope]', '[role=]', 'div\nspan',
  ]) assert.throws(() => validateActivityV2Selector(selector), /pageAccess/, selector);
  assert.throws(() => validateActivityV2Selector(':is('.repeat(10) + '.x' + ')'.repeat(10)), /deeply/);
});

test('public text excludes controls, auth containers, hidden descendants, and executable content', () => {
  const article = element('article', {}, [
    'Visible title',
    element('input', { type: 'password' }, ['input secret']),
    element('textarea', {}, ['textarea secret']),
    element('form', {}, [element('label', {}, ['form secret'])]),
    element('div', { hidden: '' }, ['hidden secret']),
    element('div', { 'aria-hidden': 'true' }, ['aria secret']),
    element('div', { class: 'auth-panel' }, ['auth secret']),
    element('div', { id: 'accessToken' }, ['token secret']),
    element('div', { contenteditable: '' }, ['editable secret']),
    element('script', {}, ['script secret']),
    element('style', {}, ['style secret']),
    element('template', {}, ['template secret']),
    Object.assign(element('span', {}, ['display secret']), { computedStyle: { display: 'none' } }),
    element('span', { class: 'author' }, ['Author name']),
  ]);
  const snapshot = collectActivityV2Snapshot({ selectors: { title: capture('article') } }, documentFixture({ article: [article] }));
  assert.deepEqual(snapshot, { page: {}, reads: { title: 'Visible title Author name' }, media: [] });
});

test('direct selectors cannot bypass hidden, form, or auth ancestor guards', () => {
  for (const attributes of [{ hidden: '' }, { class: 'login-modal' }, { contenteditable: 'true' }]) {
    const child = element('span', {}, ['PRIVATE']);
    element('div', attributes, [child]);
    const snapshot = collectActivityV2Snapshot({ selectors: { value: capture('span') } }, documentFixture({ span: [child] }));
    assert.equal(snapshot.reads.value, null);
  }
  const child = element('span', {}, ['PRIVATE']);
  element('form', {}, [child]);
  assert.equal(collectActivityV2Snapshot({ selectors: { value: capture('span') } }, documentFixture({ span: [child] })).reads.value, null);
});

test('attribute reads expose only public metadata and remove URL credentials, query, and fragment', () => {
  const matches = {
    '.public': [element('meta', { property: 'og:title', content: 'A movie' })],
    '.private': [element('meta', { name: 'csrf-token', content: 'SECRET' })],
    '.image': [element('img', { src: 'https://alice:pass@cdn.example.com/poster.jpg?signature=SECRET#token', alt: 'Poster' })],
    '.link': [element('a', { href: '/watch/1?access_token=SECRET#private' })],
    '.badLink': [element('a', { href: 'javascript:alert(1)' })],
    '.notImage': [element('div', { src: 'https://example.com/private' })],
    '.ogImage': [element('meta', { property: 'og:image', content: 'https://cdn.example.com/a.jpg?key=SECRET' })],
  };
  const selectors = {};
  for (const [name, selector, attribute] of [
    ['title', '.public', 'content'], ['private', '.private', 'content'], ['image', '.image', 'src'],
    ['alt', '.image', 'alt'], ['link', '.link', 'href'], ['bad', '.badLink', 'href'],
    ['notImage', '.notImage', 'src'], ['ogImage', '.ogImage', 'content'],
  ]) selectors[name] = capture(selector, 'attribute', { attribute });
  const snapshot = collectActivityV2Snapshot({ selectors, url: true }, documentFixture(matches));
  assert.deepEqual(snapshot.page, { origin: 'https://example.com', pathname: '/watch/123' });
  assert.deepEqual(snapshot.reads, {
    title: 'A movie', private: null, image: 'https://cdn.example.com/poster.jpg', alt: 'Poster',
    link: 'https://example.com/watch/1', bad: null, notImage: null, ogImage: 'https://cdn.example.com/a.jpg',
  });
});

test('query parameters require explicit safe declarations and preserve the default access shape', () => {
  assert.equal(Object.hasOwn(validateActivityV2PageAccess(), 'queryParameters'), false);
  assert.deepEqual(validateActivityV2PageAccess({ queryParameters: ['q', 'v', 'list', 't', 'page', 'search'] }).queryParameters,
    ['q', 'v', 'list', 't', 'page', 'search']);
  for (const queryParameters of [
    null, 'q', ['q', 'q'], new Array(1), ['q'.repeat(65)], ['not safe'], ['__proto__'], ['constructor'],
    ...['token', 'access_token', 'password', 'auth', 'authKey', 'cookie', 'client_secret', 'nonce', 'signature',
      'code', 'state', 'key', 'sid', 'pwd', 'pass', 'ticket', 'assertion', 'SAMLResponse', 'RelayState'].map(name => [name]),
    Array.from({ length: 17 }, (_, index) => `q${index}`),
  ]) assert.throws(() => validateActivityV2PageAccess({ queryParameters }), /queryParameters/);
});

test('query snapshots include only named first values, sanitize credentials, and work without URL access', () => {
  const document = documentFixture();
  document.location.href = 'https://example.com/search?q=public+search&q=second&v=clip123&list=PL123&token=PRIVATE&unrequested=PRIVATE';
  const snapshot = collectActivityV2Snapshot({ queryParameters: ['q', 'v', 'list', 'missing'] }, document);
  assert.deepEqual(snapshot.page, { query: { q: 'public search', v: 'clip123', list: 'PL123', missing: null }, queryDuplicates: ['q'] });
  assert.equal(JSON.stringify(snapshot).includes('second'), false);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);
  assert.equal(Object.hasOwn(snapshot.page.query, 'token'), false);
  assert.equal(Object.hasOwn(snapshot.page.query, 'unrequested'), false);
  assert.equal(Object.hasOwn(snapshot.page, 'origin'), false);
  assert.deepEqual(collectActivityV2Snapshot({ url: true }, document).page, {
    origin: 'https://example.com', pathname: '/search',
  });
  document.location.href = 'https://example.com/search?q=' + encodeURIComponent('Find Bearer PRIVATE password="two words" https://alice:pass@cdn.example.com/image?token=PRIVATE#fragment');
  const sanitized = collectActivityV2Snapshot({ queryParameters: ['q'] }, document).page.query.q;
  assert.match(sanitized, /^Find /);
  assert.match(sanitized, /https:\/\/cdn\.example\.com\/image$/);
  assert.doesNotMatch(sanitized, /PRIVATE|two words|alice|fragment/);
});

test('document visibility is exposed only with URL access', () => {
  const document = documentFixture();
  for (const visibilityState of ['visible', 'hidden', 'prerender']) {
    document.visibilityState = visibilityState;
    assert.equal(collectActivityV2Snapshot({ url: true }, document).page.visibilityState, visibilityState);
    assert.deepEqual(collectActivityV2Snapshot({}, document).page, {});
  }
});

test('JSON requires a specific own-property path and strips credential keys from selected subtrees', () => {
  const script = element('script', { type: 'application/json' }, [JSON.stringify({
    props: { movie: {
      title: 'Film', duration: 120, accessToken: 'SECRET', api_key: 'SECRET',
      nested: { author: 'Director', sessionId: 'SECRET', clientSecret: 'SECRET', privateKey: 'SECRET' },
      credits: ['One', 'Two'],
    } },
    token: 'ROOT SECRET',
  })]);
  script.computedStyle = { display: 'none' };
  const access = { selectors: { movie: capture('#state', 'json', { path: ['props', 'movie'] }) } };
  const snapshot = collectActivityV2Snapshot(access, documentFixture({ '#state': [script] }));
  assert.deepEqual(snapshot.reads.movie, { title: 'Film', duration: 120, nested: { author: 'Director' }, credits: ['One', 'Two'] });
  for (const path of [[], new Array(1), ['token'], ['props', '__proto__'], ['constructor'], ['props', 'api_key'], ['props', 'session']]) {
    assert.throws(() => validateActivityV2PageAccess({ selectors: { data: capture('#state', 'json', { path }) } }), /path/);
  }
  assert.throws(() => validateActivityV2PageAccess({ selectors: { data: capture('#state', 'json') } }), /path/);
  const inherited = collectActivityV2Snapshot({ selectors: { data: capture('#state', 'json', { path: ['toString'] }) } }, documentFixture({ '#state': [script] }));
  assert.equal(inherited.reads.data, null);
  const executable = element('script', {}, ['{"movie":{"title":"PRIVATE"}}']);
  assert.equal(collectActivityV2Snapshot(access, documentFixture({ '#state': [executable] })).reads.movie, null);
});

test('JSON redaction blocks prototype keys, bounds arrays, and never returns raw root state', () => {
  const script = element('script', { type: 'application/ld+json' }, ['{"movie":{"__proto__":{"secret":"PRIVATE"},"constructor":"PRIVATE","title":"Film","items":' + JSON.stringify(Array.from({ length: 100 }, (_, index) => index)) + '}}']);
  const snapshot = collectActivityV2Snapshot({ selectors: { data: capture('#state', 'json', { path: ['movie'] }) } }, documentFixture({ '#state': [script] }));
  assert.deepEqual(Object.keys(snapshot.reads.data), ['title', 'items']);
  assert.equal(snapshot.reads.data.items.length, 32);
  assert.equal(Object.hasOwn(snapshot.reads.data, '__proto__'), false);
});

test('nonrendered HEAD permits only explicitly public metadata and typed JSON reads', () => {
  const meta = element('meta', { property: 'og:title', content: 'Film title' });
  meta.computedStyle = { display: 'none' };
  const script = element('script', { type: 'application/json' }, ['{"movie":{"title":"Film title"}}']);
  script.computedStyle = { display: 'none' };
  const privateText = element('span', {}, ['PRIVATE']);
  const head = element('head', {}, [meta, script, privateText]);
  head.computedStyle = { display: 'none' };
  const document = documentFixture({ meta: [meta], script: [script], span: [privateText] });
  const access = { selectors: {
    title: capture('meta', 'attribute', { attribute: 'content' }),
    movie: capture('script', 'json', { path: ['movie'] }),
    hidden: capture('span'),
  } };
  assert.deepEqual(collectActivityV2Snapshot(access, document).reads, {
    title: 'Film title', movie: { title: 'Film title' }, hidden: null,
  });
  head.attributes['aria-hidden'] = 'TRUE';
  assert.deepEqual(collectActivityV2Snapshot(access, document).reads, { title: null, movie: null, hidden: null });
});

test('all public string reads redact recognizable credentials and sanitize embedded URLs', () => {
  const credentials = 'Bearer abcDEF-123._~+ secret="two words" access_token=PRIVATE ' +
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk1234567890 ' +
    'mfa.abcdefghijklmnopqrstuvwxyz123456 ' +
    'abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwxyz12345';
  const text = element('h1', {}, [`Playing Film ${credentials} https://alice:pass@cdn.example.com/art.jpg?key=PRIVATE#hash`]);
  const label = element('img', { alt: credentials });
  const script = element('script', { type: 'application/json' }, [JSON.stringify({ movie: {
    image: 'https://alice:pass@cdn.example.com/art.jpg?signature=PRIVATE#hash',
    caption: credentials,
    title: 'Film https://example.com/watch?ref=tracking',
    notes: 'password = "two\nwords"',
  } })]);
  const snapshot = collectActivityV2Snapshot({ selectors: {
    text: capture('h1'), alt: capture('img', 'attribute', { attribute: 'alt' }),
    movie: capture('script', 'json', { path: ['movie'] }),
  } }, documentFixture({ h1: [text], img: [label], script: [script] }));
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['PRIVATE', 'two words', 'abcDEF', 'eyJhbGci', 'mfa.abcdef', 'abcdefghijklmnopqrstuvwx', 'two\\nwords']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.match(snapshot.reads.text, /^Playing Film /);
  assert.equal(snapshot.reads.movie.image, 'https://cdn.example.com/art.jpg');
  assert.equal(snapshot.reads.movie.title, 'Film https://example.com/watch');
  assert.equal(snapshot.reads.movie.notes, 'password = "[redacted]"');
});

test('explicit shadow selectors read open roots while enforcing host ancestor guards', () => {
  const title = element('span', {}, ['Episode']);
  const host = element('video-player');
  const root = { host, querySelectorAll: () => [title], getRootNode() { return this; } };
  host.shadowRoot = root;
  title.getRootNode = () => root;
  const document = documentFixture({ 'video-player': [host] });
  const access = { selectors: { title: capture('video-player >>> .title') } };
  assert.equal(collectActivityV2Snapshot(access, document).reads.title, 'Episode');
  host.attributes.class = 'auth-dialog';
  assert.equal(collectActivityV2Snapshot(access, document).reads.title, null);
});

test('shadow traversal fails closed when its candidate budget expires before the final selector', () => {
  const hosts = Array.from({ length: 600 }, () => {
    const host = element('video-player');
    host.shadowRoot = { childNodes: [element('span', {}, ['UNDECLARED'])], querySelectorAll: () => [] };
    return host;
  });
  const snapshot = collectActivityV2Snapshot({ selectors: { title: capture('video-player >>> .missing') } }, documentFixture({ 'video-player': hosts }));
  assert.equal(snapshot.reads.title, null);
});

test('media is opt-in and exposes bounded playback state without signed sources', () => {
  const video = Object.assign(element('video', { src: 'https://cdn.example.com/movie?token=SECRET', poster: 'https://cdn.example.com/poster?signature=SECRET' }), {
    currentTime: 42, duration: Infinity, paused: false, ended: false, playbackRate: 1.5, muted: true,
    currentSrc: 'https://cdn.example.com/movie?token=SECRET',
  });
  const document = documentFixture({ 'video, audio': [video] });
  assert.deepEqual(collectActivityV2Snapshot({}, document).media, []);
  const snapshot = collectActivityV2Snapshot({ media: true }, document);
  assert.deepEqual(snapshot.media, [{
    currentTime: 42, duration: 0, paused: false, ended: false, playbackRate: 1.5, muted: true,
    visible: true, rect: { x: 0, y: 0, width: 100, height: 50 }, poster: 'https://cdn.example.com/poster',
  }]);
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  video.attributes.hidden = '';
  assert.equal(collectActivityV2Snapshot({ media: true }, document).media[0].visible, false);
});

test('media discovery crosses public open shadow roots and rejects sensitive host ancestors', () => {
  function player(attributes = {}) {
    const video = Object.assign(element('video'), { currentTime: 12, duration: 60, paused: false });
    const host = element('site-player', attributes);
    const root = { host, querySelectorAll: (selector) => selector === 'video, audio' ? [video] : [], getRootNode() { return this; } };
    host.shadowRoot = root;
    video.getRootNode = () => root;
    return { host, video };
  }
  const publicPlayer = player();
  const privatePlayer = player();
  element('section', { class: 'login-panel' }, [privatePlayer.host]);
  const document = documentFixture({ '*': [publicPlayer.host, privatePlayer.host] });
  assert.equal(collectActivityV2Snapshot({ media: true }, document).media.length, 1);
  publicPlayer.host.attributes.class = 'auth-popup';
  assert.deepEqual(collectActivityV2Snapshot({ media: true }, document).media, []);
});

test('open-shadow media discovery bounds total inspected host candidates', () => {
  let inspected = 0;
  const hosts = Array.from({ length: 3000 }, () => Object.defineProperty(element('div'), 'shadowRoot', {
    get() { inspected++; return null; },
  }));
  const document = documentFixture({ '*': hosts });
  assert.deepEqual(collectActivityV2Snapshot({ media: true }, document).media, []);
  assert.equal(inspected, 2048);
});

test('capture arrays, text, aggregate output, and JSON input are bounded', () => {
  const matches = Array.from({ length: 100 }, () => element('p', {}, ['x'.repeat(10000)]));
  const selectors = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`text${index}`, capture('p', 'text', { all: true })]));
  const snapshot = collectActivityV2Snapshot({ selectors }, documentFixture({ p: matches }));
  assert.ok(snapshot.reads.text0.length <= 32);
  assert.equal(snapshot.reads.text0[0].length, 4096);
  assert.ok(JSON.stringify(snapshot).length < 70000);
  const script = element('script', { type: 'application/json' }, [JSON.stringify({ movie: 'x'.repeat(262144) })]);
  assert.equal(collectActivityV2Snapshot({ selectors: { data: capture('#state', 'json', { path: ['movie'] }) } }, documentFixture({ '#state': [script] })).reads.data, null);
});
