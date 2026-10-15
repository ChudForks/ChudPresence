// The V2 host owns this broker. Activity code receives only its JSON snapshots,
// never this module, DOM nodes, selectors supplied at runtime, or browser globals.
const MAX_CAPTURES = 32;
const MAX_SELECTOR_LENGTH = 1024;
const MAX_MATCHES = 32;
const MAX_QUERY_CANDIDATES = 512;
const MAX_TEXT_NODES = 2048;
const MAX_TEXT_LENGTH = 4096;
const MAX_JSON_LENGTH = 262144;
const MAX_JSON_NODES = 256;
const MAX_JSON_DEPTH = 6;
const MAX_JSON_ARRAY = 32;
const MAX_MEDIA = 16;
const SELECTOR_ATTRIBUTES = new Set([
  'class', 'id', 'role', 'type', 'name', 'property', 'itemprop', 'slot',
  'title', 'alt', 'aria-label', 'aria-hidden', 'aria-current', 'aria-selected',
  'aria-pressed', 'aria-expanded', 'data-testid', 'data-test', 'data-cy', 'data-qa',
]);
const READ_ATTRIBUTES = new Set(['title', 'alt', 'aria-label', 'href', 'src', 'poster', 'content', 'datetime']);
const META_CONTENT = new Set([
  'description', 'og:title', 'og:description', 'og:site_name', 'og:image',
  'og:image:url', 'og:url', 'twitter:title', 'twitter:description', 'twitter:image',
]);
const STRUCTURAL_PSEUDOS = new Set([
  'root', 'scope', 'empty', 'first-child', 'last-child', 'only-child',
  'first-of-type', 'last-of-type', 'only-of-type',
]);
const SELECTOR_PSEUDOS = new Set(['is', 'where', 'not', 'has']);
const NTH_PSEUDOS = new Set(['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);
const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'FORM', 'IFRAME', 'OBJECT', 'EMBED']);
const SENSITIVE_PART = /(?:^|[\s_:\-.])(?:auth|authentication|authorization|login|signin|sign-in|signup|sign-up|password|passwd|passphrase|credential|credentials|secret|secrets|token|tokens|csrf|xsrf|otp|totp|payment|billing|creditcard|credit-card|checkout|session|sessions|api[\s_-]?key|private[\s_-]?key|bearer|jwt|cookie|nonce)(?:$|[\s_:\-.])/i;

function fail(message) { throw new TypeError(`Activity V2 pageAccess ${message}`); }

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object.`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) fail(`${label} cannot contain accessors.`);
  }
  return value;
}

function allowedFields(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(`${label} has unsupported field ${String(key)}.`);
  }
}

function sensitiveKey(key) {
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['__proto__', 'prototype', 'constructor'].includes(key.toLowerCase()) ||
    /token|password|passwd|passphrase|secret|credential|csrf|xsrf|cookie|authorization|authentication|oauth|session|apikey|accesskey|privatekey|signingkey|bearer|nonce|signature|jwt|creditcard|payment|billing/.test(flat) ||
    /^auth(?:key|data|info|state|code|header|user|id)/.test(flat) ||
    /(?:^|[_\-.])auth(?:$|[_\-.])/i.test(key);
}

/** Parse a deliberately bounded CSS grammar; forbidden attributes cannot hide in nested selectors. */
export function validateActivityV2Selector(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SELECTOR_LENGTH || /[\\\u0000-\u001f\u007f]/.test(value)) {
    fail(`selector must be a CSS selector of at most ${MAX_SELECTOR_LENGTH} characters without escapes or controls.`);
  }
  const source = value.trim();
  let cursor = 0;
  let compounds = 0;
  const identifier = () => {
    const match = /^-?(?:[A-Za-z_\u0080-\uffff])(?:[A-Za-z0-9_\u0080-\uffff-])*/u.exec(source.slice(cursor));
    if (!match) fail('selector contains an invalid identifier.');
    cursor += match[0].length;
    return match[0];
  };
  const whitespace = () => {
    const before = cursor;
    while (source[cursor] === ' ') cursor++;
    return cursor !== before;
  };
  const attribute = () => {
    cursor++;
    whitespace();
    const name = identifier().toLowerCase();
    if (!SELECTOR_ATTRIBUTES.has(name)) fail(`selector cannot inspect attribute ${name}.`);
    whitespace();
    if (source[cursor] === ']') { cursor++; return; }
    const operator = /^(?:[~|^$*]?=)/.exec(source.slice(cursor));
    if (!operator) fail('selector contains an invalid attribute operator.');
    cursor += operator[0].length;
    whitespace();
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      cursor++;
      while (cursor < source.length && source[cursor] !== quote) cursor++;
      if (source[cursor] !== quote) fail('selector contains an unterminated attribute value.');
      cursor++;
    } else {
      identifier();
    }
    const separated = whitespace();
    if (separated && /[is]/i.test(source[cursor] || '') && source[cursor + 1] !== undefined) {
      cursor++;
      whitespace();
    }
    if (source[cursor++] !== ']') fail('selector contains an invalid attribute expression.');
  };
  const list = (depth = 0, relative = false, nested = false) => {
    if (depth > 8) fail('selector is nested too deeply.');
    let needCompound = true;
    let relativeStart = relative;
    while (cursor < source.length) {
      whitespace();
      if (relativeStart && /[>+~]/.test(source[cursor] || '')) {
        if (source.slice(cursor, cursor + 3) === '>>>') fail('shadow combinators must be at the top level.');
        cursor++;
        whitespace();
      }
      relativeStart = false;
      if (++compounds > 128) fail('selector has too many compounds.');
      let count = 0;
      if (source[cursor] === '*') { cursor++; count++; }
      else if (/[-A-Za-z_\u0080-\uffff]/u.test(source[cursor] || '')) { identifier(); count++; }
      while (cursor < source.length) {
        const char = source[cursor];
        if (char === '#' || char === '.') { cursor++; identifier(); count++; }
        else if (char === '[') { attribute(); count++; }
        else if (char === ':') {
          cursor++;
          const pseudo = identifier().toLowerCase();
          if (STRUCTURAL_PSEUDOS.has(pseudo)) {
            if (source[cursor] === '(') fail('selector structural pseudo cannot have arguments.');
          } else if (SELECTOR_PSEUDOS.has(pseudo)) {
            if (source[cursor++] !== '(') fail('selector pseudo requires arguments.');
            list(depth + 1, pseudo === 'has', true);
            if (source[cursor++] !== ')') fail('selector has unbalanced parentheses.');
          } else if (NTH_PSEUDOS.has(pseudo)) {
            if (source[cursor++] !== '(') fail('selector nth pseudo requires arguments.');
            const match = /^\s*(odd|even|[+-]?(?:\d*n(?:\s*[+-]\s*\d+)?|\d+))\s*/i.exec(source.slice(cursor));
            if (!match) fail('selector has an invalid nth expression.');
            cursor += match[0].length;
            if (source.slice(cursor, cursor + 2).toLowerCase() === 'of' && source[cursor + 2] === ' ' && /child$/.test(pseudo)) {
              cursor += 3;
              list(depth + 1, false, true);
            }
            if (source[cursor++] !== ')') fail('selector has an invalid nth expression.');
          } else fail(`selector pseudo ${pseudo} is not a public structural selector.`);
          count++;
        } else break;
      }
      if (!count) fail('selector requires a compound selector.');
      needCompound = false;
      const spaced = whitespace();
      const next = source[cursor];
      if (next === ')' && nested) return;
      if (cursor === source.length) {
        if (nested) fail('selector has unbalanced parentheses.');
        return;
      }
      if (next === ',') { cursor++; needCompound = true; relativeStart = relative; }
      else if (/[>+~]/.test(next || '')) {
        if (source.slice(cursor, cursor + 3) === '>>>') {
          if (nested) fail('shadow combinators must be at the top level.');
          cursor += 3;
        } else cursor++;
        needCompound = true;
      } else if (spaced) needCompound = true;
      else fail('selector contains an unsupported token.');
    }
    if (needCompound) fail('selector cannot end with a combinator.');
  };
  list();
  return source;
}

export function validateActivityV2PageAccess(value = {}) {
  plainObject(value, 'declaration');
  allowedFields(value, ['selectors', 'media', 'url', 'queryParameters'], 'declaration');
  const declarations = value.selectors === undefined ? {} : plainObject(value.selectors, 'selectors');
  const entries = Object.entries(declarations);
  if (entries.length > MAX_CAPTURES) fail(`allows at most ${MAX_CAPTURES} named captures.`);
  const selectors = {};
  for (const [name, declaration] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || ['constructor', 'prototype'].includes(name)) fail('capture names must be safe identifiers.');
    plainObject(declaration, `capture ${name}`);
    allowedFields(declaration, ['selector', 'read', 'attribute', 'path', 'all'], `capture ${name}`);
    const selector = validateActivityV2Selector(declaration.selector);
    const read = declaration.read;
    if (!['text', 'attribute', 'json'].includes(read)) fail(`capture ${name} read must be text, attribute, or json.`);
    const normalized = { selector, read, all: declaration.all === true };
    if (declaration.all !== undefined && typeof declaration.all !== 'boolean') fail(`capture ${name} all must be boolean.`);
    if (read === 'attribute') {
      if (typeof declaration.attribute !== 'string' || !READ_ATTRIBUTES.has(declaration.attribute)) fail(`capture ${name} attribute is not public.`);
      normalized.attribute = declaration.attribute;
    } else if (declaration.attribute !== undefined) fail(`capture ${name} attribute requires an attribute read.`);
    if (read === 'json') {
      if (!Array.isArray(declaration.path) || !declaration.path.length || declaration.path.length > 12) {
        fail(`capture ${name} json requires a nonempty public own-property path of at most 12 safe keys.`);
      }
      normalized.path = [];
      for (let index = 0; index < declaration.path.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(declaration.path, String(index));
        const key = descriptor?.value;
        if (typeof key !== 'string' || key.length > 100 || !/^(?:[A-Za-z_][A-Za-z0-9_-]*|\d+)$/.test(key) || sensitiveKey(key)) {
          fail(`capture ${name} json requires a nonempty public own-property path of at most 12 safe keys.`);
        }
        normalized.path.push(key);
      }
    } else if (declaration.path !== undefined) fail(`capture ${name} path requires a json read.`);
    selectors[name] = normalized;
  }
  for (const field of ['media', 'url']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') fail(`${field} must be boolean.`);
  }
  const normalized = { selectors, media: value.media === true, url: value.url === true };
  if (value.queryParameters !== undefined) {
    if (!Array.isArray(value.queryParameters) || value.queryParameters.length > 16) fail('queryParameters must contain at most 16 unique public parameter names.');
    normalized.queryParameters = [];
    for (let index = 0; index < value.queryParameters.length; index++) {
      const name = Object.getOwnPropertyDescriptor(value.queryParameters, String(index))?.value;
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name) || sensitiveKey(name) ||
          /^(?:code|state|key|sid|pwd|pass|ticket|assertion|samlresponse|samlrequest|samlart|relaystate)$/i.test(name) || normalized.queryParameters.includes(name)) {
        fail('queryParameters must contain at most 16 unique public parameter names without credential names.');
      }
      normalized.queryParameters.push(name);
    }
  }
  return normalized;
}

function tag(element) { return String(element?.tagName || '').toUpperCase(); }
function attr(element, name) { return element?.getAttribute?.(name) ?? null; }
function parent(element) { return element?.parentElement || element?.getRootNode?.()?.host || null; }
function markedSensitive(element) {
  const description = [attr(element, 'id'), attr(element, 'class'), attr(element, 'name'), attr(element, 'autocomplete'), attr(element, 'role')].filter(Boolean).join(' ');
  return SENSITIVE_PART.test(description.replace(/([a-z])([A-Z])/g, '$1 $2')) ||
    attr(element, 'contenteditable') !== null && attr(element, 'contenteditable') !== 'false' ||
    attr(element, 'role') === 'textbox';
}

function hidden(element, document, nonRenderedMetadata = false) {
  if (attr(element, 'hidden') !== null || attr(element, 'inert') !== null || String(attr(element, 'aria-hidden')).trim().toLowerCase() === 'true') return true;
  try {
    const style = document.defaultView?.getComputedStyle?.(element);
    return !nonRenderedMetadata && style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse';
  } catch { return true; }
}

function publicElement(element, document, { json = false, metadata = false, ignoreVisibility = false } = {}) {
  let current = element;
  let depth = 0;
  while (current) {
    if (++depth > 128 || markedSensitive(current)) return false;
    const targetJson = json && current === element && tag(current) === 'SCRIPT';
    if (BLOCKED_TAGS.has(tag(current)) && !targetJson) return false;
    const nonRenderedMetadata = (json || metadata) && (tag(current) === 'HEAD' || metadata && current === element && tag(current) === 'META');
    if (!ignoreVisibility && !targetJson && hidden(current, document, nonRenderedMetadata)) return false;
    current = parent(current);
  }
  return true;
}

function splitShadow(selector) {
  // The validator allows >>> only outside quoted values and pseudo arguments.
  const parts = [];
  let quote = '';
  let bracket = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') bracket++;
    if (char === ']') bracket--;
    if (!bracket && selector.slice(index, index + 3) === '>>>') {
      parts.push(selector.slice(start, index).trim());
      start = index + 3;
      index += 2;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts;
}

function select(document, selector) {
  let roots = [document];
  const parts = splitShadow(selector);
  let candidates = MAX_QUERY_CANDIDATES;
  for (let index = 0; index < parts.length; index++) {
    const next = [];
    for (const root of roots) {
      let matches;
      try { matches = root.querySelectorAll(parts[index]); } catch { continue; }
      for (let match = 0; match < matches.length && candidates > 0 && next.length < MAX_QUERY_CANDIDATES; match++, candidates--) {
        const element = matches[match];
        if (index === parts.length - 1) next.push(element);
        else if (element.shadowRoot && publicElement(element, document)) next.push(element.shadowRoot);
      }
      if (candidates <= 0) break;
    }
    roots = next;
    if (!roots.length) break;
    if (candidates <= 0 && index < parts.length - 1) return [];
  }
  return roots;
}

function readText(element, document) {
  const chunks = [];
  let remaining = MAX_TEXT_LENGTH;
  let visited = 0;
  const stack = [element];
  while (stack.length && remaining > 0 && visited++ < MAX_TEXT_NODES) {
    const current = stack.pop();
    if (current.nodeType === 3) {
      const text = String(current.nodeValue || '').replace(/\s+/g, ' ').slice(0, remaining);
      chunks.push(text);
      remaining -= text.length;
      continue;
    }
    if (!publicElement(current, document)) continue;
    // Child count and stack allocation are bounded even for unusually large DOMs.
    const children = current.childNodes || [];
    const count = Math.min(children.length, MAX_TEXT_NODES - visited, MAX_TEXT_NODES - stack.length);
    for (let index = count - 1; index >= 0; index--) stack.push(children[index]);
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function cleanUrl(value, document) {
  if (typeof value !== 'string' || !value || value.length > 8192) return null;
  try {
    const url = new URL(value, document.location?.href);
    if (url.protocol !== 'https:' || !url.hostname) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href.slice(0, MAX_TEXT_LENGTH);
  } catch { return null; }
}

// This is defense in depth, not a promise to recognize an arbitrary secret that
// a site deliberately renders as ordinary text. Never read credential stores.
function publicString(value, document) {
  const secretName = '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|passphrase|secret|client[_-]?secret|api[_-]?key|access[_-]?key|authorization|cookie|csrf|xsrf|session(?:[_-]?id)?|nonce)';
  return value.slice(0, MAX_TEXT_LENGTH)
    .replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.href;
      } catch { return '[redacted URL]'; }
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
    .replace(/\bmfa\.[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,110}\b/g, '[redacted]')
    .replace(new RegExp(`(\\b${secretName}["']?\\s*[:=]\\s*)(["'])([\\s\\S]*?)\\2`, 'gi'), '$1$2[redacted]$2')
    .replace(new RegExp(`(\\b${secretName}["']?\\s*[:=]\\s*)(?!["'])([^\\s"',;&<>}]+)`, 'gi'), '$1[redacted]');
}

function readAttribute(element, name, document) {
  const elementTag = tag(element);
  if (name === 'content') {
    const property = String(attr(element, 'property') || attr(element, 'name') || '').toLowerCase();
    if (elementTag !== 'META' || !META_CONTENT.has(property)) return null;
    const value = attr(element, name);
    return /(?:image|url)$/.test(property) ? cleanUrl(value, document) : value === null ? null : publicString(value, document);
  }
  if (name === 'src' && !['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK'].includes(elementTag)) return null;
  if (name === 'href' && !['A', 'AREA', 'LINK'].includes(elementTag)) return null;
  if (name === 'poster' && elementTag !== 'VIDEO') return null;
  const value = attr(element, name);
  return ['src', 'href', 'poster'].includes(name) ? cleanUrl(value, document) : value === null ? null : publicString(value, document);
}

function sanitizeJson(value, budget, document, depth = 0) {
  if (budget.nodes-- <= 0 || depth > MAX_JSON_DEPTH) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const result = publicString(value, document).slice(0, budget.characters);
    budget.characters -= result.length;
    return result;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (let index = 0; index < value.length && index < MAX_JSON_ARRAY && budget.nodes > 0 && budget.characters > 0; index++) {
      result.push(sanitizeJson(value[index], budget, document, depth + 1));
    }
    return result;
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (budget.nodes <= 0 || budget.characters <= 0) break;
    if (key.length > 100 || sensitiveKey(key)) continue;
    result[key] = sanitizeJson(value[key], budget, document, depth + 1);
  }
  return result;
}

function readJson(element, path, document, context) {
  if (tag(element) !== 'SCRIPT' || !['application/json', 'application/ld+json'].includes(String(attr(element, 'type') || '').trim().toLowerCase()) || !publicElement(element, document, { json: true })) return null;
  try {
    if (!context.json.has(element)) {
      const source = element.textContent;
      if (typeof source !== 'string' || source.length > MAX_JSON_LENGTH || source.length > context.jsonRemaining) return null;
      context.jsonRemaining -= source.length;
      context.json.set(element, JSON.parse(source));
    }
    let value = context.json.get(element);
    for (const key of path) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
      value = value[key];
    }
    return sanitizeJson(value, { nodes: MAX_JSON_NODES, characters: 16384 }, document);
  } catch { return null; }
}

function finite(value, fallback = 0, min = -1000000, max = 1000000) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function collectMedia(document) {
  const result = [];
  const roots = [document];
  let hostCandidates = 2048;
  let mediaCandidates = MAX_QUERY_CANDIDATES;
  for (let rootIndex = 0; rootIndex < roots.length && rootIndex < 64; rootIndex++) {
    const root = roots[rootIndex];
    let elements;
    try { elements = root.querySelectorAll('video, audio'); } catch { continue; }
    for (let index = 0; index < elements.length && mediaCandidates-- > 0; index++) {
      if (result.length >= MAX_MEDIA) return result;
      const element = elements[index];
      if (!publicElement(element, document, { ignoreVisibility: true })) continue;
      let rect;
      try { rect = element.getBoundingClientRect(); } catch { rect = {}; }
      const media = {
        currentTime: finite(element.currentTime, 0, 0, 315360000),
        duration: finite(element.duration, 0, 0, 315360000),
        paused: element.paused === true, ended: element.ended === true,
        playbackRate: finite(element.playbackRate, 1, 0, 16), muted: element.muted === true,
        visible: publicElement(element, document) && finite(rect.width) > 0 && finite(rect.height) > 0,
        rect: { x: finite(rect.x), y: finite(rect.y), width: finite(rect.width, 0, 0), height: finite(rect.height, 0, 0) },
      };
      const poster = cleanUrl(attr(element, 'poster'), document);
      if (poster) media.poster = poster;
      result.push(media);
    }
    if (result.length >= MAX_MEDIA || mediaCandidates <= 0) break;
    // Native media in custom players often lives inside open shadow roots.
    // Discovery crosses only public hosts, with fixed aggregate scan/root caps.
    if (roots.length >= 64 || hostCandidates <= 0) continue;
    let hosts;
    try { hosts = root.querySelectorAll('*'); } catch { continue; }
    for (let index = 0; index < hosts.length && hostCandidates-- > 0 && roots.length < 64; index++) {
      const host = hosts[index];
      if (host.shadowRoot && publicElement(host, document, { ignoreVisibility: true })) roots.push(host.shadowRoot);
    }
  }
  return result;
}

/** Produce a fresh, bounded, data-only snapshot using the host-approved declaration. */
export function collectActivityV2Snapshot(pageAccess, document = globalThis.document) {
  const access = validateActivityV2PageAccess(pageAccess);
  const snapshot = { page: {}, reads: {}, media: [] };
  const context = { json: new Map(), jsonRemaining: 1048576, outputRemaining: 65536, readsRemaining: 128 };
  if (!document) return snapshot;
  if (access.url) {
    if (['visible', 'hidden', 'prerender'].includes(document.visibilityState)) {
      snapshot.page.visibilityState = document.visibilityState;
    }
    const url = cleanUrl(document.location?.href, document);
    if (url) {
      const parsed = new URL(url);
      snapshot.page.origin = parsed.origin;
      snapshot.page.pathname = parsed.pathname;
    }
  }
  if (access.queryParameters) {
    const query = {};
    const duplicates = [];
    let parameters = null;
    try {
      const url = new URL(document.location?.href);
      if (url.protocol === 'https:') parameters = url.searchParams;
    } catch { /* Missing or inaccessible page URLs expose no parameter values. */ }
    for (const name of access.queryParameters) {
      const value = parameters?.get(name) ?? null;
      query[name] = value === null ? null : publicString(value, document);
      // Expose only declared key names, never additional parameter values.
      if (parameters?.getAll(name).length > 1) duplicates.push(name);
    }
    snapshot.page.query = query;
    if (duplicates.length) snapshot.page.queryDuplicates = duplicates;
  }
  for (const [name, capture] of Object.entries(access.selectors)) {
    const values = [];
    for (const element of select(document, capture.selector)) {
      if (values.length >= (capture.all ? MAX_MATCHES : 1)) break;
      if (context.readsRemaining <= 0 || context.outputRemaining <= 0) break;
      const metadata = capture.read === 'attribute' && capture.attribute === 'content' && tag(element) === 'META' &&
        META_CONTENT.has(String(attr(element, 'property') || attr(element, 'name') || '').toLowerCase());
      if (!publicElement(element, document, { json: capture.read === 'json', metadata })) continue;
      context.readsRemaining--;
      let value = null;
      if (capture.read === 'text') value = publicString(readText(element, document), document);
      else if (capture.read === 'attribute') value = readAttribute(element, capture.attribute, document);
      else value = readJson(element, capture.path, document, context);
      const size = JSON.stringify(value).length;
      if (size > context.outputRemaining) { value = null; context.outputRemaining = 0; }
      else context.outputRemaining -= size;
      values.push(value);
    }
    snapshot.reads[name] = capture.all ? values : values[0] ?? null;
  }
  if (access.media) snapshot.media = collectMedia(document);
  return snapshot;
}
