// Self-contained V2 contract constants. generate-api-v2.mjs checks these against
// the authoritative activity-api-v2.json contract without importing V1 tooling.
export const ACTIVITY_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$';
export const ACTIVITY_SEMVER_PATTERN = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const ACTIVITY_KIND_VALUES = Object.freeze(['video', 'movie', 'episode', 'song', 'stream', 'game', 'generic']);
export const MAX_ACTIVITY_METADATA_BYTES = 65536;
export const MAX_ACTIVITY_TEXT_LENGTH = 256;
export const MAX_ACTIVITY_ICON_BYTES = 262144;
export const ACTIVITY_V2_VERSION = 2;
export const MAX_ACTIVITY_V2_BYTES = 65536;
export const V2_TEXT_FIELDS = Object.freeze(['title', 'subtitle', 'artist', 'album', 'series', 'creator', 'channel', 'category', 'game', 'playlist']);
export const V2_ATTRIBUTES = Object.freeze(['title', 'aria-label', 'alt']);
export const V2_PLAYER_ADAPTERS = Object.freeze(['html-media', 'prime-video', 'tiktok', 'instagram']);
export const V2_GENERIC_FIELDS = Object.freeze([...V2_TEXT_FIELDS, 'season', 'episode']);
export const V2_GENERIC_PLAYER_ADAPTERS = Object.freeze(['html-media', 'dom-media']);
// These are a fixed declaration, not permission for arbitrary attribute reads.
// The bundled collector binds each read to the selected reel or story header.
export const INSTAGRAM_FIELDS = Object.freeze({
  title: { source: 'dom.text', selectors: ['[role="button"] > div > div[dir="auto"]', 'h1'] },
  creator: { source: 'dom.text', selectors: ['a[aria-label$=" reels"]', 'header a[href]', 'a[href]'] },
  channel: { source: 'dom.text', selectors: ['a[aria-label$=" reels"]', 'header a[href]', 'a[href]'] },
});
// Instagram's official Google Play app icon, independent of page media.
export const INSTAGRAM_LOGO_URL = 'https://play-lh.googleusercontent.com/yHi59jmO_lVamcyJ1i3rM1_E8bAiAspShnGjjURq05ipQQSUksO3QVEsXTegRSqul038-4YNA7O644XAcx251Q=s512';
// Fixed public reads only. TikTok's data-e2e selectors are not a general CSS
// escape hatch for declarative packages.
export const TIKTOK_FIELDS = Object.freeze({
  title: { source: 'dom.text', selectors: ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="user-profile-live-title"]', '[class*="DivDetailsLine"], .e1xspjl31'] },
  creator: { source: 'dom.text', selectors: ['[data-e2e="video-author-nickname"]', '[data-e2e="browser-nickname"]', '[data-e2e="user-profile-nickname"]', '[class*="SpanNickName"], [class*="DivCreatorInfoContainer"] a p, [data-e2e="room-header-anchor-name"], .e1xspjl34'] },
  channel: { source: 'dom.text', selectors: ['[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]', '[data-e2e="user-profile-uid"]'] },
});
// Keep approved 1.0.0–1.0.2 bytes valid on extension restore. The added LIVE
// reads require 1.0.3's exact declaration and normal installation review.
export const TIKTOK_LEGACY_FIELDS = Object.freeze({ ...TIKTOK_FIELDS,
  title: { ...TIKTOK_FIELDS.title, selectors: [...TIKTOK_FIELDS.title.selectors.slice(0, 3), '[class*="DivDetailsLine"]'] },
  creator: { ...TIKTOK_FIELDS.creator, selectors: [...TIKTOK_FIELDS.creator.selectors.slice(0, 3), '[class*="SpanNickName"]'] },
});
export const TIKTOK_CARD_FIELDS = Object.freeze({ ...TIKTOK_FIELDS,
  title: TIKTOK_LEGACY_FIELDS.title,
  creator: { ...TIKTOK_FIELDS.creator, selectors: [...TIKTOK_FIELDS.creator.selectors.slice(0, 3), '[class*="SpanNickName"], [class*="DivCreatorInfoContainer"] a p'] },
});
// Static flat square mobile artwork from TikTok's Google Play listing. This
// destination never incorporates extracted page data or a video thumbnail.
export const TIKTOK_LOGO_URL = 'https://play-lh.googleusercontent.com/2o7iuqPe-0msP3DvNhzoOgNo4eZ6GkL_RtGVeKyBn5UBQAW5cw-GW5V3wDOHB1yTQuqWzrFLFOv2u4_5ea1uhg=s512';
export const V2_METADATA_FIELDS = Object.freeze(['id', 'name', 'description', 'version', 'apiVersion', 'minExtensionVersion', 'author', 'contributors', 'category', 'defaultMediaKind', 'aliases', 'tags', 'matches', 'excludeMatches', 'entry', 'icon', 'frames', 'settingsUi', 'repository', 'homepage', 'serviceUrl']);

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a JSON object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contains unsupported field ${key}.`);
  }
}

function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new TypeError(`${label} must be non-empty text up to ${maximum} characters.`);
}

function semver(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value) &&
    !(value.split('+')[0].match(/^\d+\.\d+\.\d+-(.*)$/)?.[1] || '').split('.').some((part) => /^0\d+$/.test(part));
}

function publicHost(host) {
  // Exact public DNS names only. No wildcards, IP literals, ports, local names,
  // or core-owned Discord hosts. DNS resolution is not an egress firewall.
  const normalized = host.toLowerCase();
  try { if (new URL(`https://${host}/`).hostname !== normalized) return false; } catch { return false; }
  return normalized.includes('.') && normalized.length <= 253 &&
    normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^\d+(?:\.\d+)*$/.test(normalized) &&
    !['localhost', 'local', 'localdomain', 'lan', 'home', 'home.arpa', 'intranet', 'corp', 'internal', 'test', 'invalid', 'onion', 'discord.com', 'discordapp.com', 'discordapp.net'].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function validateV2MatchPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 256) return false;
  const match = /^https:\/\/([^/]+)\/(.+)$/.exec(pattern);
  return Boolean(match && publicHost(match[1]) && /^[-a-z0-9_.*%!$&'()+,;=:@/]+$/i.test(match[2]));
}

export function validateV2Selector(selector, { scope = false, extended = false } = {}) {
  if (extended) return validateV2GenericSelector(selector, { scope });
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 256 ||
      (scope && !/[#.]/.test(selector))) throw new TypeError('V2 selectors must be bounded tag, ID, or class selectors; scope needs an ID or class.');
  // Intentionally small CSS subset: no attributes, pseudo selectors, escapes,
  // wildcards, sibling traversal, or comma lists. Fallbacks are explicit arrays.
  const parts = selector.trim().split(/\s*>\s*|\s+/);
  if (parts.length > 8 || parts.some((part) => !part ||
      !/^(?:[a-z][a-z0-9-]*)?(?:[.#][a-z_][a-z0-9_-]*)*$/i.test(part) ||
      /^(?:html|body|head|script|style|link|meta|form|input|textarea|select|option|iframe|object|embed)(?:[.#]|$)/i.test(part))) {
    throw new TypeError('V2 selector uses an unsupported or sensitive selector.');
  }
  return selector.trim();
}

// A CSS grammar, not a list of site exceptions. Attribute literals select
// public UI nodes; they never authorize reading the selected attribute.
export function validateV2GenericSelector(selector, { scope = false } = {}) {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 256) throw new TypeError('V2 selectors must be non-empty strings up to 256 characters.');
  const input = selector.trim();
  let offset = 0; let parts = 0; let narrowed = false;
  while (offset < input.length) {
    const start = offset;
    const tag = /^[a-z][a-z0-9-]*/i.exec(input.slice(offset))?.[0];
    if (tag) {
      if (/^(?:html|body|head|script|style|link|meta|form|input|textarea|select|option|iframe|object|embed)$/i.test(tag)) throw new TypeError('V2 selector uses a sensitive element.');
      offset += tag.length;
    }
    while (offset < input.length) {
      const simple = /^[.#][a-z_][a-z0-9_-]*/i.exec(input.slice(offset))?.[0];
      if (simple) { offset += simple.length; narrowed = true; continue; }
      if (input[offset] !== '[') break;
      const attribute = /^\[(data-[a-z][a-z0-9-]{0,58}|role|aria-label|class|dir|id)([\^$*]?=)(?:"([^"\\\x00-\x1f\x7f]{1,128})"|'([^'\\\x00-\x1f\x7f]{1,128})')\]/.exec(input.slice(offset));
      if (!attribute) throw new TypeError('V2 attribute selectors require a bounded public attribute and quoted literal.');
      offset += attribute[0].length; narrowed = true;
    }
    if (offset === start || ++parts > 8) throw new TypeError('V2 selector uses an unsupported selector or more than eight parts.');
    if (offset === input.length) break;
    const whitespace = /^\s+/.exec(input.slice(offset))?.[0];
    if (whitespace) offset += whitespace.length;
    if (input[offset] === '>') {
      offset += 1;
      offset += /^\s*/.exec(input.slice(offset))[0].length;
    } else if (!whitespace) throw new TypeError('V2 selectors support only descendant and child combinators.');
    if (offset === input.length) throw new TypeError('V2 selectors cannot end in a combinator.');
  }
  if (scope && !narrowed) throw new TypeError('V2 scope must identify a class, ID, or public attribute container.');
  return input;
}

function normalizedLiteral(value, maximum, label) {
  text(value, maximum, label);
  if (value !== value.replace(/\s+/g, ' ').trim() || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`${label} must be normalized literal text.`);
}

function numericLiteral(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new TypeError(`${label} must be an integer between 0 and 10000.`);
}

function genericSelectors(selectors) {
  if (!Array.isArray(selectors) || !selectors.length || selectors.length > 4 || new Set(selectors).size !== selectors.length) throw new TypeError('V2 needs one to four unique fallback selectors.');
  selectors.forEach((selector) => validateV2GenericSelector(selector));
}

function genericPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 32 || new Set(paths).size !== paths.length) throw new TypeError('V2 paths need one to 32 unique public paths.');
  for (const path of paths) {
    if (typeof path !== 'string' || path.length > 256 || !path.startsWith('/') || path.includes('//') || path.split('/').some((part, index) => index && part &&
      !['{number}', '{segment}', '{handle}', '{locale}'].includes(part) && !/^[-a-zA-Z0-9_@.]+$/.test(part) || ['.', '..'].includes(part))) throw new TypeError('V2 paths support literal segments and bounded number, segment, handle or locale tokens.');
  }
}

// Used by the worker as well as the collector's serialized equivalent. Tokens
// never read queries or allow separators, escapes, credentials or destinations.
export function matchV2MediaPath(path, pathname) {
  const expected = path.split('/'), actual = pathname.split('/');
  return expected.length === actual.length && expected.every((part, index) => {
    const value = actual[index];
    if (part === '{number}') return /^[0-9]{1,25}$/.test(value);
    if (part === '{segment}') return /^(?!\.{1,2}$)[-a-zA-Z0-9_.]{1,256}$/.test(value);
    if (part === '{handle}') return /^@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,63}$/.test(value);
    if (part === '{locale}') return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(value);
    return part === value;
  });
}

export function resolveActivityV2Mode(config, modeId, href) {
  const selected = config.modes ? modeId === 'default' ? config : config.modes.find((mode) => mode.id === modeId) : modeId === undefined ? config : null;
  if (!selected) throw new TypeError('V2 report must name an approved media mode.');
  if (href !== undefined) {
    let url;
    try { url = new URL(href); } catch { throw new TypeError('V2 media URL is invalid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || selected.paths && !selected.paths.some((path) => matchV2MediaPath(path, url.pathname))) throw new TypeError('V2 report must match its approved media paths.');
  }
  return selected;
}

export function validV2PublicPath(path, rule, media) {
  return typeof path === 'string' && path.length <= 256 && rule.paths.some((pattern) => matchV2MediaPath(pattern, path)) &&
    Object.entries(rule.matchFields || {}).every(([field, index]) => typeof media[field] === 'string' && path.split('/').slice(1)[index] === media[field]);
}

function validatePlayerId(rule) {
  object(rule, ['selector', 'split', 'prefixes', 'parts'], 'V2 player ID');
  validateV2GenericSelector(rule.selector, { scope: true });
  object(rule.split, ['separator', 'index'], 'V2 player ID split');
  if (typeof rule.split.separator !== 'string' || !rule.split.separator.length || rule.split.separator.length > 64 || /[\x00-\x1f\x7f]/.test(rule.split.separator) || !Number.isInteger(rule.split.index) || rule.split.index < 0 || rule.split.index > 15) throw new TypeError('V2 player ID split must be bounded.');
  if (rule.parts !== undefined && (!Number.isInteger(rule.parts) || rule.parts < 1 || rule.parts > 16)) throw new TypeError('V2 player ID part count must be from one to 16.');
  if (rule.prefixes !== undefined) {
    if (!Array.isArray(rule.prefixes) || !rule.prefixes.length || rule.prefixes.length > 4 || new Set(rule.prefixes).size !== rule.prefixes.length) throw new TypeError('V2 player IDs need one to four unique literal prefixes.');
    rule.prefixes.forEach((value) => normalizedLiteral(value, 64, 'V2 player ID prefix'));
  }
}

function validateBindings(bindings, fields) {
  object(bindings, Object.keys(fields), 'V2 path field bindings');
  for (const [field, index] of Object.entries(bindings)) if (['season', 'episode'].includes(field) || !Number.isInteger(index) || index < 0 || index > 7) throw new TypeError('V2 path bindings require text fields and segment indices from 0 to 7.');
}

function validatePathTemplate(path, fields, playerId) {
  if (typeof path !== 'string' || path.length > 256 || !path.startsWith('/') || path.includes('//')) throw new TypeError('V2 link templates require bounded relative paths.');
  for (const part of path.split('/').slice(1)) {
    const token = /^\{([a-z]+)\}$/.exec(part)?.[1];
    if (token ? !(token === 'id' && playerId || Object.hasOwn(fields, token) && !['season', 'episode'].includes(token)) : part && (!/^[-a-zA-Z0-9_@.]+$/.test(part) || ['.', '..'].includes(part))) throw new TypeError('V2 link templates use literal segments, declared text fields and an explicitly parsed player ID.');
  }
}

function validateGenericRule(rule, field, { timeline = false } = {}) {
  const numeric = ['season', 'episode'].includes(field);
  if (!timeline && !numeric && rule?.source === 'first') {
    object(rule, ['source', 'rules'], 'V2 first-present field');
    if (!Array.isArray(rule.rules) || !rule.rules.length || rule.rules.length > 4 || rule.rules.some((item) => !item || ['first', 'constant'].includes(item.source) || item.fallback !== undefined)) throw new TypeError('V2 first-present fields need one to four non-nested extraction rules.');
    rule.rules.forEach((item) => validateGenericRule(item, field));
    return;
  }
  if (!timeline && !numeric && rule?.source === 'public-path') {
    object(rule, ['source', 'selectors', 'paths', 'segment', 'pageFallback', 'opacityAncestor', 'matchText'], 'V2 public path field');
    genericSelectors(rule.selectors); genericPaths(rule.paths);
    if (!Number.isInteger(rule.segment) || rule.segment < 0 || rule.segment > 7) throw new TypeError('V2 public path segment must be from 0 to 7.');
    if (rule.pageFallback !== undefined && typeof rule.pageFallback !== 'boolean') throw new TypeError('V2 pageFallback must be boolean.');
    if (rule.matchText !== undefined && typeof rule.matchText !== 'boolean') throw new TypeError('V2 matchText must be boolean.');
    if (rule.matchText && rule.pageFallback) throw new TypeError('V2 text-matched paths require visible anchor text, without page fallback.');
    if (rule.opacityAncestor !== undefined) validateV2GenericSelector(rule.opacityAncestor, { scope: true });
    return;
  }
  if (!timeline && rule?.source === 'constant') {
    object(rule, ['source', 'value'], 'V2 constant field');
    if (numeric) numericLiteral(rule.value, 'V2 constant number');
    else normalizedLiteral(rule.value, MAX_ACTIVITY_TEXT_LENGTH, 'V2 constant text');
    return;
  }
  object(rule, ['source', 'selectors', 'attribute', 'removePrefix', 'removeSuffix', 'split', 'parse', ...(!timeline ? ['fallback', 'opacityAncestor', 'ignoreEmptyBreaks', 'candidateIndex', 'maxDescendants'] : [])], 'V2 field rule');
  if (!['dom.text', 'dom.attribute'].includes(rule.source)) throw new TypeError('V2 DOM rules support dom.text and dom.attribute only.');
  genericSelectors(rule.selectors);
  if (rule.opacityAncestor !== undefined) validateV2GenericSelector(rule.opacityAncestor, { scope: true });
  if (rule.ignoreEmptyBreaks !== undefined && typeof rule.ignoreEmptyBreaks !== 'boolean') throw new TypeError('V2 ignoreEmptyBreaks must be boolean.');
  if (rule.candidateIndex !== undefined && (!Number.isInteger(rule.candidateIndex) || rule.candidateIndex < 0 || rule.candidateIndex > 7)) throw new TypeError('V2 candidateIndex must be from 0 to 7.');
  if (rule.maxDescendants !== undefined && (!Number.isInteger(rule.maxDescendants) || rule.maxDescendants < 1 || rule.maxDescendants > 128)) throw new TypeError('V2 maxDescendants must be an integer from 1 to 128; the default is 16.');
  if (rule.source === 'dom.attribute' ? !V2_ATTRIBUTES.includes(rule.attribute) : rule.attribute !== undefined) throw new TypeError('V2 permits only title, aria-label, or alt attribute reads.');
  for (const option of ['removePrefix', 'removeSuffix']) if (rule[option] !== undefined) text(rule[option], 64, `V2 ${option}`);
  if (rule.split !== undefined) {
    object(rule.split, ['separator', 'index'], 'V2 split');
    if (typeof rule.split.separator !== 'string' || !rule.split.separator.length || rule.split.separator.length > 64 || /[\x00-\x1f\x7f]/.test(rule.split.separator) ||
        !Number.isInteger(rule.split.index) || rule.split.index < 0 || rule.split.index > 15) throw new TypeError('V2 split requires a literal separator up to 64 characters and an index from 0 to 15.');
  }
  if (timeline ? !['clock', 'number'].includes(rule.parse) : numeric ? rule.parse !== 'integer' : rule.parse !== undefined && rule.parse !== 'handle') throw new TypeError('V2 field parse mode does not match its declared field.');
  if (rule.fallback !== undefined) {
    if (numeric) numericLiteral(rule.fallback, 'V2 fallback number');
    else normalizedLiteral(rule.fallback, MAX_ACTIVITY_TEXT_LENGTH, 'V2 fallback text');
    if (rule.parse === 'handle' && !/^@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,63}$/.test(rule.fallback)) throw new TypeError('V2 handle fallbacks must be normalized public handles.');
  }
}

export function validateV2Template(value, fields, label = 'V2 template') {
  text(value, MAX_ACTIVITY_TEXT_LENGTH, label);
  const remaining = value.replace(/\{([a-z]+)\}/g, (_match, field) => {
    if (!Object.hasOwn(fields, field)) throw new TypeError('V2 templates may reference only declared fields.');
    return '';
  });
  if (/[{}]/.test(remaining)) throw new TypeError('V2 templates support only literal text and {field} tokens.');
  return value;
}

function staticV2Url(value, label) {
  if (typeof value !== 'string' || value.length > 2048 || /[{}\x00-\x20\x7f]/.test(value)) throw new TypeError(`${label} requires a static public HTTPS URL.`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError(`${label} URL is invalid.`); }
  // Reject syntactically present empty queries/fragments and the default port,
  // which URL normalization would otherwise silently discard.
  const authority = /^https:\/\/([^/]+)/.exec(value)?.[1];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || /[?#]/.test(value) || authority !== parsed.hostname || !publicHost(parsed.hostname)) throw new TypeError(`${label} requires static public HTTPS without credentials, ports, queries or fragments.`);
}

function validateGenericActivity(config, mode = false) {
  object(config, ['kind', 'scope', 'fields', 'player', 'presentation', 'lookup', 'paths', 'container', 'requiredFields', 'pageIdentity', 'links', ...(mode ? ['id'] : ['schemaVersion', 'modes'])], 'V2 Activity');
  if (config.paths !== undefined) genericPaths(config.paths);
  if (mode && (typeof config.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(config.id) || config.id === 'default')) throw new TypeError('V2 media mode ID is invalid.');
  if (!ACTIVITY_KIND_VALUES.includes(config.kind)) throw new TypeError('V2 media kind is invalid.');
  const mediaScope = ['video', 'audio'].includes(config.scope) && config.container?.singlePlayer === true && config.player?.adapter === 'html-media';
  validateV2GenericSelector(config.scope, { scope: !mediaScope });
  object(config.fields, V2_GENERIC_FIELDS, 'V2 fields');
  if (!Object.hasOwn(config.fields, 'title')) throw new TypeError('V2 requires a title extraction field.');
  for (const [field, rule] of Object.entries(config.fields)) validateGenericRule(rule, field);
  if (config.requiredFields !== undefined && (!Array.isArray(config.requiredFields) || config.requiredFields.length > 12 || new Set(config.requiredFields).size !== config.requiredFields.length || config.requiredFields.some((field) => !Object.hasOwn(config.fields, field)))) throw new TypeError('V2 requiredFields must name unique declared fields.');
  if (config.container !== undefined) {
    object(config.container, ['ancestors', 'required', 'exclude', 'singlePlayer'], 'V2 shared media container');
    if (config.container.singlePlayer !== undefined && typeof config.container.singlePlayer !== 'boolean') throw new TypeError('V2 singlePlayer must be boolean.');
    if (!Number.isInteger(config.container.ancestors) || config.container.ancestors < 1 || config.container.ancestors > (config.container.singlePlayer ? 16 : 5)) throw new TypeError('V2 shared container search permits up to five ancestors, or sixteen with singlePlayer.');
    genericSelectors(config.container.required);
    if (config.container.exclude !== undefined) genericSelectors(config.container.exclude);
  }
  if (config.pageIdentity !== undefined) {
    object(config.pageIdentity, ['paths', 'fields', 'links', 'playerId', 'segment', 'ignoreCase'], 'V2 page identity');
    genericPaths(config.pageIdentity.paths);
    if (config.pageIdentity.fields !== undefined) validateBindings(config.pageIdentity.fields, config.fields);
    if (config.pageIdentity.links !== undefined) {
      object(config.pageIdentity.links, Object.keys(config.links || {}), 'V2 page link identity');
      if (Object.values(config.pageIdentity.links).some((index) => !Number.isInteger(index) || index < 0 || index > 7)) throw new TypeError('V2 page link identity needs segment indices from 0 to 7.');
    }
    if (config.pageIdentity.ignoreCase !== undefined && typeof config.pageIdentity.ignoreCase !== 'boolean') throw new TypeError('V2 identity ignoreCase must be boolean.');
    if (config.pageIdentity.playerId !== undefined) {
      validatePlayerId(config.pageIdentity.playerId);
      if (!Number.isInteger(config.pageIdentity.segment) || config.pageIdentity.segment < 0 || config.pageIdentity.segment > 7) throw new TypeError('V2 player identity requires a bounded page segment.');
    } else if (config.pageIdentity.segment !== undefined) throw new TypeError('V2 player identity segment needs a player ID rule.');
  }
  if (config.links !== undefined) {
    object(config.links, Object.keys(config.links || {}), 'V2 public links');
    if (!Object.keys(config.links).length || Object.keys(config.links).length > 2) throw new TypeError('V2 supports one to two named public links.');
    for (const [name, rule] of Object.entries(config.links)) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new TypeError('V2 public link name is invalid.');
      object(rule, ['paths', 'matchFields', 'sources'], 'V2 public link'); genericPaths(rule.paths);
      if (rule.matchFields !== undefined) validateBindings(rule.matchFields, config.fields);
      if (!Array.isArray(rule.sources) || !rule.sources.length || rule.sources.length > 4) throw new TypeError('V2 links need one to four bounded sources.');
      for (const source of rule.sources) {
        if (source?.source === 'page') object(source, ['source'], 'V2 page link');
        else if (source?.source === 'dom.link') { object(source, ['source', 'selectors', 'opacityAncestor'], 'V2 DOM link'); genericSelectors(source.selectors); if (source.opacityAncestor !== undefined) validateV2GenericSelector(source.opacityAncestor, { scope: true }); }
        else if (source?.source === 'template') {
          object(source, ['source', 'path', 'playerId'], 'V2 link template');
          if (source.playerId !== undefined) validatePlayerId(source.playerId);
          validatePathTemplate(source.path, config.fields, source.playerId);
        } else throw new TypeError('V2 public link source is invalid.');
      }
    }
  }
  object(config.player, ['adapter', 'selectors', 'selection', 'retainMetadata', 'allowAriaHidden', 'canvasSelector', 'canvasContainer', 'elapsed', 'live', 'state', 'position', 'duration'], 'V2 player');
  if (!V2_GENERIC_PLAYER_ADAPTERS.includes(config.player.adapter)) throw new TypeError('V2 schemaVersion 2 supports html-media and dom-media players.');
  genericSelectors(config.player.selectors);
  if (config.player.selection !== undefined && !['first', 'largest-visible'].includes(config.player.selection)) throw new TypeError('V2 player selection is invalid.');
  for (const flag of ['retainMetadata', 'allowAriaHidden', 'elapsed', 'live']) if (config.player[flag] !== undefined && typeof config.player[flag] !== 'boolean') throw new TypeError(`V2 ${flag} must be a boolean.`);
  if (config.player.adapter === 'html-media') {
    if (['state', 'position', 'duration'].some((field) => config.player[field] !== undefined)) throw new TypeError('V2 html-media uses only native playback state and timing.');
    if (config.player.canvasSelector !== undefined) validateV2GenericSelector(config.player.canvasSelector);
    if (config.player.canvasContainer !== undefined) {
      validateV2GenericSelector(config.player.canvasContainer, { scope: true });
      if (config.player.canvasSelector === undefined) throw new TypeError('V2 canvasContainer needs a canvas selector.');
    }
  } else {
    if (['allowAriaHidden', 'canvasSelector', 'canvasContainer'].some((field) => config.player[field] !== undefined)) throw new TypeError('V2 accessibility and canvas exceptions apply only to native media.');
    object(config.player.state, ['selectors', 'attribute', 'playing', 'paused'], 'V2 DOM player state');
    genericSelectors(config.player.state.selectors);
    if (config.player.state.attribute !== 'aria-label') throw new TypeError('V2 DOM player state reads only aria-label.');
    const all = [];
    for (const field of ['playing', 'paused']) {
      const values = config.player.state[field];
      if (!Array.isArray(values) || !values.length || values.length > 4 || new Set(values).size !== values.length) throw new TypeError('V2 DOM player states need one to four unique literal values.');
      values.forEach((value) => normalizedLiteral(value, 128, 'V2 DOM player state label'));
      all.push(...values);
    }
    if (new Set(all).size !== all.length) throw new TypeError('V2 playing and paused labels must be disjoint.');
    if (config.player.elapsed && ['position', 'duration'].some((field) => config.player[field] !== undefined)) throw new TypeError('V2 elapsed session timing cannot be combined with DOM media timing rules.');
    for (const field of ['position', 'duration']) if (config.player[field] !== undefined) validateGenericRule(config.player[field], field, { timeline: true });
  }
  if (config.presentation !== undefined) {
    object(config.presentation, ['details', 'state', 'artwork', 'buttons', 'liveInDetails'], 'V2 presentation');
    if (config.presentation.liveInDetails !== undefined && typeof config.presentation.liveInDetails !== 'boolean') throw new TypeError('V2 liveInDetails must be boolean.');
    validateV2Template(config.presentation.details, config.fields, 'V2 details');
    if (config.presentation.state !== undefined) validateV2Template(config.presentation.state, config.fields, 'V2 state');
    if (config.presentation.artwork !== undefined) {
      object(config.presentation.artwork, ['large', 'largeText', 'small', 'smallText'], 'V2 static artwork');
      if (!config.presentation.artwork.large) throw new TypeError('V2 static artwork requires a large image.');
      for (const [field, value] of Object.entries(config.presentation.artwork)) {
        if (field.endsWith('Text')) {
          normalizedLiteral(value, MAX_ACTIVITY_TEXT_LENGTH, 'V2 static artwork text');
          if (/[{}]/.test(value)) throw new TypeError('V2 artwork text must be static.');
        } else staticV2Url(value, 'V2 artwork');
      }
    }
    if (config.presentation.buttons !== undefined) {
      if (!Array.isArray(config.presentation.buttons) || config.presentation.buttons.length > 2) throw new TypeError('V2 presentation supports at most two static buttons.');
      for (const button of config.presentation.buttons) {
        object(button, ['label', 'url', 'link'], 'V2 button');
        normalizedLiteral(button.label, 32, 'V2 button label');
        if (/[{}]/.test(button.label)) throw new TypeError('V2 button labels must be static.');
        if (button.link !== undefined) {
          if (button.url !== undefined || !Object.hasOwn(config.links || {}, button.link)) throw new TypeError('V2 buttons must name one declared public link or a static URL.');
        } else staticV2Url(button.url, 'V2 button');
      }
    }
  }
  if (config.lookup !== undefined) {
    object(config.lookup, ['service', 'input'], 'V2 lookup');
    if (typeof config.lookup.service !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(config.lookup.service)) throw new TypeError('V2 lookup service must be a 2–64 character identifier.');
    object(config.lookup.input, Object.keys(config.lookup.input || {}), 'V2 lookup input');
    const inputs = Object.entries(config.lookup.input);
    if (!inputs.length || inputs.length > 8 || inputs.some(([parameter, field]) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(parameter) || typeof field !== 'string' || !Object.hasOwn(config.fields, field))) throw new TypeError('V2 lookup inputs must map one to eight explicit parameters to declared fields.');
  }
  if (config.modes !== undefined) {
    if (!Array.isArray(config.modes) || !config.modes.length || config.modes.length > 8 || new Set(config.modes.map((item) => item?.id)).size !== config.modes.length) throw new TypeError('V2 media modes require one to eight unique IDs.');
    config.modes.forEach((item) => { validateGenericActivity(item, true); if (!item.paths) throw new TypeError('V2 media modes require approved paths.'); });
  }
  return config;
}

export function validateV2Metadata(metadata) {
  object(metadata, V2_METADATA_FIELDS, 'V2 metadata');
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_ACTIVITY_METADATA_BYTES) throw new TypeError('V2 metadata exceeds 64 KB.');
  if (typeof metadata.id !== 'string' || !new RegExp(ACTIVITY_ID_PATTERN).test(metadata.id)) throw new TypeError('V2 Activity ID is invalid.');
  text(metadata.name, 80, 'V2 name');
  text(metadata.description, 500, 'V2 description');
  if (!semver(metadata.version) || (metadata.minExtensionVersion !== undefined && !semver(metadata.minExtensionVersion))) throw new TypeError('V2 versions must use semantic version format.');
  if (metadata.apiVersion !== 2 || metadata.entry !== 'activity.json') throw new TypeError('V2 requires apiVersion 2 and entry activity.json. Executable packages are not accepted.');
  for (const field of ['matches', 'excludeMatches']) {
    const values = metadata[field] ?? (field === 'excludeMatches' ? [] : null);
    if (!Array.isArray(values) || values.length > 32 || (field === 'matches' && !values.length) ||
        new Set(values).size !== values.length || !values.every(validateV2MatchPattern)) throw new TypeError(`V2 ${field} requires unique exact public HTTPS hosts; wildcards and protected/local hosts are forbidden.`);
  }
  if (metadata.frames !== undefined && metadata.frames !== 'top') throw new TypeError('V2 supports only the top frame.');
  if (metadata.icon !== undefined && metadata.icon !== 'icon.png') throw new TypeError('V2 icon must be icon.png.');
  if (metadata.defaultMediaKind !== undefined && !ACTIVITY_KIND_VALUES.includes(metadata.defaultMediaKind)) throw new TypeError('V2 defaultMediaKind is invalid.');
  if (metadata.category !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(metadata.category)) throw new TypeError('V2 category is invalid.');
  for (const field of ['aliases', 'tags']) {
    if (metadata[field] === undefined) continue;
    const values = metadata[field];
    if (!Array.isArray(values) || values.length > 32 || new Set(values).size !== values.length) throw new TypeError(`V2 ${field} is invalid.`);
    for (const value of values) {
      text(value, field === 'tags' ? 32 : 80, field);
      if (field === 'tags' && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) throw new TypeError('V2 tag is invalid.');
    }
  }
  const url = (value) => {
    if (typeof value !== 'string' || value.length > 2048) throw new TypeError('V2 discovery URL is invalid.');
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !publicHost(parsed.hostname)) throw new TypeError('V2 discovery URLs must use public HTTPS hosts.');
  };
  for (const field of ['repository', 'homepage', 'serviceUrl']) if (metadata[field] !== undefined) url(metadata[field]);
  const person = (value) => { object(value, ['name', 'url'], 'V2 author'); text(value.name, 80, 'V2 author name'); if (value.url !== undefined) url(value.url); };
  if (metadata.author !== undefined) person(metadata.author);
  if (metadata.contributors !== undefined) {
    if (!Array.isArray(metadata.contributors) || metadata.contributors.length > 16) throw new TypeError('V2 contributors is invalid.');
    metadata.contributors.forEach(person);
  }
  if (metadata.settingsUi !== undefined) {
    object(metadata.settingsUi, ['statusLabels'], 'V2 settingsUi');
    if (metadata.settingsUi.statusLabels !== undefined) {
      object(metadata.settingsUi.statusLabels, ['app', 'artist', 'track'], 'V2 statusLabels');
      Object.values(metadata.settingsUi.statusLabels).forEach((value) => text(value, 80, 'V2 status label'));
    }
  }
  return { ...metadata, name: metadata.name.trim(), description: metadata.description.trim(), frames: 'top' };
}

export function validateActivityV2(source) {
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).byteLength > MAX_ACTIVITY_V2_BYTES) throw new TypeError('activity.json must be non-empty JSON up to 64 KB.');
  let config;
  try { config = JSON.parse(source); } catch { throw new TypeError('V2 accepts JSON configuration, never executable JavaScript.'); }
  if (config?.schemaVersion === 2) return validateGenericActivity(config);
  object(config, ['schemaVersion', 'kind', 'scope', 'fields', 'player', 'page'], 'V2 Activity');
  if (config.schemaVersion !== 1 || !ACTIVITY_KIND_VALUES.includes(config.kind)) throw new TypeError('V2 schemaVersion or media kind is invalid.');
  const page = config.page !== undefined;
  if (page) validateV2Page(config);
  const tiktok = config.player?.adapter === 'tiktok';
  const instagram = config.player?.adapter === 'instagram';
  if (instagram && (config.kind !== 'video' || config.scope !== '.x5lhr3w' ||
      canonicalV2Json(config.fields) !== canonicalV2Json(INSTAGRAM_FIELDS) ||
      canonicalV2Json(config.player) !== canonicalV2Json({ adapter: 'instagram', selectors: ['video', 'img'] }))) {
    throw new TypeError('The instagram adapter requires its fixed reel/story container, fields and media selectors.');
  }
  if (tiktok && (config.kind !== 'video' || config.scope !== '#main-content' ||
      ![TIKTOK_FIELDS, TIKTOK_CARD_FIELDS, TIKTOK_LEGACY_FIELDS].some((fields) => canonicalV2Json(config.fields) === canonicalV2Json(fields)) ||
      canonicalV2Json(config.player) !== canonicalV2Json({ adapter: 'tiktok', selectors: ['video'] }))) {
    throw new TypeError('The tiktok adapter requires its fixed public player container, fields and video selector.');
  }
  validateV2Selector(config.scope, { scope: true });
  object(config.fields, V2_TEXT_FIELDS, 'V2 fields');
  if (!Object.hasOwn(config.fields, 'title')) throw new TypeError('V2 requires a title extraction field.');
  for (const rule of Object.values(config.fields)) {
    if (page && rule?.source === 'url.query') {
      object(rule, ['source', 'parameter'], 'V2 query field');
      validateQueryParameter(rule.parameter);
      continue;
    }
    object(rule, ['source', 'selectors', 'attribute', 'removePrefix', 'removeSuffix'], 'V2 field rule');
    if (!['dom.text', 'dom.attribute'].includes(rule.source)) throw new TypeError('V2 supports dom.text and dom.attribute only.');
    if (!Array.isArray(rule.selectors) || rule.selectors.length < 1 || rule.selectors.length > 4 || new Set(rule.selectors).size !== rule.selectors.length) throw new TypeError('V2 needs one to four unique fallback selectors per field.');
    if (!tiktok && !instagram) rule.selectors.forEach((selector) => validateV2Selector(selector));
    if (rule.source === 'dom.attribute' ? !V2_ATTRIBUTES.includes(rule.attribute) : rule.attribute !== undefined) throw new TypeError('V2 permits only title, aria-label, or alt attribute reads.');
    for (const option of ['removePrefix', 'removeSuffix']) if (rule[option] !== undefined) text(rule[option], 64, `V2 ${option}`);
  }
  if (page) return config;
  object(config.player, ['adapter', 'selectors', 'metadata'], 'V2 player');
  if (!V2_PLAYER_ADAPTERS.includes(config.player.adapter) || !Array.isArray(config.player.selectors) ||
      !config.player.selectors.length || config.player.selectors.length > 4 || new Set(config.player.selectors).size !== config.player.selectors.length) throw new TypeError('V2 needs a supported bundled adapter and one to four player selectors.');
  config.player.selectors.forEach((selector) => validateV2Selector(selector));
  if (config.player.metadata !== undefined &&
      (config.player.adapter !== 'prime-video' || config.player.metadata !== 'prime-video-details')) {
    throw new TypeError('V2 player metadata supports only the bundled prime-video-details mode.');
  }
  if (config.player.adapter === 'prime-video') {
    // Retention and the media accessibility exception belong only to this
    // fixed, bundled player integration, never arbitrary package selectors.
    const selectors = { title: '.atvwebplayersdk-title-text', subtitle: '.atvwebplayersdk-episode-info' };
    if (config.kind !== 'video' || config.scope !== '.dv-player-fullscreen' ||
        JSON.stringify(config.player.selectors) !== JSON.stringify(['.atvwebplayersdk-video-surface video']) ||
        Object.entries(config.fields).some(([field, rule]) => !selectors[field] || rule.source !== 'dom.text' ||
          JSON.stringify(rule.selectors) !== JSON.stringify([selectors[field]]) || Object.keys(rule).length !== 2)) {
      throw new TypeError('The prime-video adapter requires its fixed player container, video selector, and title/subtitle text fields.');
    }
  }
  return config;
}

function validateQueryParameter(parameter) {
  if (typeof parameter !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(parameter)) {
    throw new TypeError('V2 query parameters must be explicit names up to 32 characters.');
  }
}

function validateV2Page(config) {
  if (config.kind !== 'generic' || config.player !== undefined) throw new TypeError('V2 page activity requires kind generic and no player.');
  object(config.page, ['routes', 'elapsed', 'artwork'], 'V2 page');
  if (typeof config.page.elapsed !== 'boolean') throw new TypeError('V2 page elapsed must be an explicit boolean.');
  if (!Array.isArray(config.page.routes) || !config.page.routes.length || config.page.routes.length > 32) {
    throw new TypeError('V2 page requires one to thirty-two routes.');
  }
  const ids = new Set();
  for (const route of config.page.routes) {
    object(route, ['id', 'paths', 'query', 'requiredQuery', 'name', 'details', 'state', 'title', 'scope'], 'V2 page route');
    if (typeof route.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(route.id) || ids.has(route.id)) throw new TypeError('V2 page route IDs must be unique short identifiers.');
    ids.add(route.id);
    if (!Array.isArray(route.paths) || !route.paths.length || route.paths.length > 8 || new Set(route.paths).size !== route.paths.length ||
        route.paths.some((path) => typeof path !== 'string' || path.length > 256 || !/^\/(?:[a-zA-Z0-9_-]+|\{number\}|\{segment\})?(?:\/(?:[a-zA-Z0-9_-]+|\{number\}|\{segment\}))*\/?$/.test(path) || path.includes('//'))) {
      throw new TypeError('V2 page routes require bounded paths with only whole {number} or {segment} tokens.');
    }
    object(route.query, Object.keys(route.query || {}), 'V2 route query');
    if (Object.keys(route.query).length > 8) throw new TypeError('V2 routes support at most eight query conditions.');
    for (const [parameter, values] of Object.entries(route.query)) {
      validateQueryParameter(parameter);
      if (!Array.isArray(values) || !values.length || values.length > 8 || new Set(values).size !== values.length ||
          values.some((value) => typeof value !== 'string' || value.length > 64)) throw new TypeError('V2 query conditions require one to eight bounded literal values.');
    }
    if (!Array.isArray(route.requiredQuery) || route.requiredQuery.length > 8 || new Set(route.requiredQuery).size !== route.requiredQuery.length) throw new TypeError('V2 requiredQuery must list up to eight unique parameters.');
    route.requiredQuery.forEach(validateQueryParameter);
    text(route.name, 80, 'V2 page name');
    if (/[{}]/.test(route.name)) throw new TypeError('V2 page names must be static text.');
    if (route.title !== undefined) {
      text(route.title, 256, 'V2 static page title');
      if (/[{}]/.test(route.title) || route.title !== route.title.replace(/\s+/g, ' ').trim()) throw new TypeError('V2 static page titles must be normalized literal text.');
    }
    if (route.scope !== undefined) validateV2Selector(route.scope, { scope: true });
    for (const field of ['details', 'state']) {
      if (field === 'state' && route.state === undefined) continue;
      text(route[field], 256, `V2 page ${field}`);
      const remaining = route[field].replace(/\{([a-z]+)\}/g, (_match, key) => {
        if (!Object.hasOwn(config.fields || {}, key)) throw new TypeError('V2 page templates may reference only declared fields.');
        return '';
      });
      if (/[{}]/.test(remaining)) throw new TypeError('V2 page templates support only literal text and {field} tokens.');
    }
  }
  if (config.page.artwork !== undefined) {
    object(config.page.artwork, ['large', 'largeText', 'small', 'smallText'], 'V2 static page artwork');
    if (!config.page.artwork.large) throw new TypeError('V2 static page artwork requires a large image.');
    for (const [field, value] of Object.entries(config.page.artwork)) {
      if (field.endsWith('Text')) { text(value, 256, 'V2 static artwork text'); continue; }
      if (typeof value !== 'string' || value.length > 2048 || /[{}]/.test(value)) throw new TypeError('V2 page artwork requires static public HTTPS URLs.');
      let url;
      try { url = new URL(value); } catch { throw new TypeError('V2 page artwork URL is invalid.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !publicHost(url.hostname)) {
        throw new TypeError('V2 page artwork requires static public HTTPS URLs without queries or fragments.');
      }
    }
  }
}

// Keep the route predicate in the serialized collector in sync with this one.
export function matchActivityV2Page(config, href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return config.page?.routes.find((route) => route.paths.some((path) => {
    const expected = path.split('/'); const actual = url.pathname.split('/');
    return expected.length === actual.length && expected.every((part, index) => part === '{number}'
      ? /^[0-9]{1,25}$/.test(actual[index])
      : part === '{segment}' ? actual[index].length <= 256 && /^(?:[-a-zA-Z0-9_]|%[0-9a-f]{2})+$/i.test(actual[index]) && !/%(?:2f|5c)/i.test(actual[index])
      : part === actual[index]);
  }) &&
    Object.entries(route.query).every(([key, values]) => url.searchParams.getAll(key).length <= 1 && values.includes(url.searchParams.get(key) || '')) &&
    route.requiredQuery.every((key) => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key)?.trim()))) || null;
}

export function validPrimeVideoArtworkUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'].includes(url.hostname) &&
      /^\/images\/S\/pv-target-images\/[a-f0-9]{64}(?:\.[a-z0-9_,.-]+)?\.(?:jpg|jpeg|png|webp|avif)$/i.test(url.pathname);
  } catch { return false; }
}

export function validateV2Report(report, config, href) {
  if (config.schemaVersion === 2) {
    const packageConfig = config;
    config = resolveActivityV2Mode(config, report?.modeId, href);
    object(report, ['kind', 'media', 'playback', ...(packageConfig.modes ? ['modeId'] : []), ...(config.links ? ['links'] : [])], 'V2 report');
    if (report.kind !== config.kind) throw new TypeError('V2 report kind must match its approved configuration.');
    object(report.media, Object.keys(config.fields), 'V2 report media');
    text(report.media.title, MAX_ACTIVITY_TEXT_LENGTH, 'V2 report title');
    for (const [field, value] of Object.entries(report.media)) {
      if (['season', 'episode'].includes(field)) numericLiteral(value, 'V2 report number');
      else normalizedLiteral(value, MAX_ACTIVITY_TEXT_LENGTH, 'V2 report text');
      const rules = config.fields[field].source === 'first' ? config.fields[field].rules : [config.fields[field]];
      if (rules.every((rule) => rule.parse === 'handle' || rule.source === 'public-path' && rule.paths.every((path) => path.split('/').slice(1)[rule.segment] === '{handle}')) && !/^@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,63}$/.test(value)) throw new TypeError('V2 public handles must be bounded normalized path handles.');
    }
    for (const [field, rule] of Object.entries(config.fields)) {
      if (rule.source === 'constant' && report.media[field] !== rule.value) throw new TypeError('V2 report constants must equal their approved literal values.');
    }
    for (const field of config.requiredFields || []) if (report.media[field] === undefined) throw new TypeError('V2 report is missing a required media field.');
    if (href !== undefined && config.pageIdentity?.paths.some((path) => matchV2MediaPath(path, new URL(href).pathname))) {
      const segments = new URL(href).pathname.split('/').slice(1);
      if (Object.entries(config.pageIdentity.fields || {}).some(([field, index]) => typeof report.media[field] !== 'string' || typeof segments[index] !== 'string' || (config.pageIdentity.ignoreCase
        ? report.media[field].toLowerCase() !== segments[index].toLowerCase() : report.media[field] !== segments[index]))) throw new TypeError('V2 report identity must match the current public page path.');
    }
    if (config.links) {
      object(report.links, Object.keys(config.links), 'V2 public link paths');
      for (const [name, path] of Object.entries(report.links)) if (!validV2PublicPath(path, config.links[name], report.media)) throw new TypeError('V2 links must match their approved public paths and media fields.');
      if (href !== undefined && config.pageIdentity?.paths.some((path) => matchV2MediaPath(path, new URL(href).pathname))) {
        const segments = new URL(href).pathname.split('/').slice(1);
        for (const [name, index] of Object.entries(config.pageIdentity.links || {})) {
          if (report.links[name] !== undefined && report.links[name].split('/').slice(1)[index] !== segments[index]) throw new TypeError('V2 media link identity must match the current public page path.');
        }
      }
    }
    object(report.playback, ['state', 'position', 'duration', 'live', 'rate'], 'V2 playback');
    if (!['playing', 'paused', 'stopped'].includes(report.playback.state)) throw new TypeError('V2 playback state is invalid.');
    for (const field of ['position', 'duration', 'rate']) {
      const value = report.playback[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (field === 'rate' ? 16 : 31536000))) throw new TypeError('V2 playback numbers must be finite and bounded.');
    }
    if (report.playback.live !== undefined && typeof report.playback.live !== 'boolean') throw new TypeError('V2 playback live must be a boolean.');
    if (config.player.live !== undefined && report.playback.live !== config.player.live || (report.playback.live || config.player.elapsed) && report.playback.duration !== 0 || config.player.elapsed && report.playback.rate !== 1) throw new TypeError('V2 report must follow its approved live/session playback rules.');
    return report;
  }
  const enriched = config.player?.adapter === 'prime-video' && config.player.metadata === 'prime-video-details';
  const tiktok = config.player?.adapter === 'tiktok';
  const instagram = config.player?.adapter === 'instagram';
  object(report, ['kind', 'media', 'playback', ...(config.page ? ['routeId'] : []), ...(enriched ? ['artwork'] : []), ...(tiktok || instagram ? ['buttons'] : [])], 'V2 report');
  if (config.page) {
    const route = config.page.routes.find((candidate) => candidate.id === report.routeId);
    if (!route || href !== undefined && matchActivityV2Page(config, href)?.id !== route.id) throw new TypeError('V2 page report must match an approved route.');
    if (route.title !== undefined && report.media?.title !== route.title) throw new TypeError('V2 page report must use its approved static title.');
    if (report.playback?.state !== 'playing' || report.playback.duration !== 0 || report.playback.live !== false || report.playback.rate !== 1 ||
        typeof report.playback.position !== 'number' || !Number.isFinite(report.playback.position) || report.playback.position < 0 || report.playback.position > 31536000 ||
        !config.page.elapsed && report.playback.position !== 0) throw new TypeError('V2 page reports require a bounded elapsed session, never media playback.');
    if (href !== undefined) {
      const url = new URL(href);
      for (const [field, rule] of Object.entries(config.fields)) {
        if (rule.source !== 'url.query' || field === 'title' && route.title !== undefined) continue;
        const raw = url.searchParams.get(rule.parameter);
        const expected = raw && raw.length <= 1024 && url.searchParams.getAll(rule.parameter).length === 1 ? raw.replace(/\s+/g, ' ').trim().slice(0, 256) : undefined;
        if (report.media?.[field] !== (expected || undefined)) throw new TypeError('V2 query report must match its declared URL parameter.');
      }
    }
  }
  if (report.kind !== config.kind && !(enriched && report.kind === 'episode') && !(tiktok && report.kind === 'stream')) throw new TypeError('V2 report kind must match its approved configuration.');
  object(report.media, [...Object.keys(config.fields), ...(enriched ? ['series', 'season', 'episode'] : []), ...(instagram ? ['subtitle'] : [])], 'V2 report media');
  text(report.media.title, MAX_ACTIVITY_TEXT_LENGTH, 'V2 report title');
  for (const [field, value] of Object.entries(report.media)) {
    if (enriched && ['season', 'episode'].includes(field)) {
      if (!Number.isInteger(value) || value < 0 || value > 10000) throw new TypeError('V2 Prime episode numbers must be integers between 0 and 10000.');
    } else text(value, MAX_ACTIVITY_TEXT_LENGTH, 'V2 report field');
  }
  if (enriched && report.kind === 'episode' && (!report.media.series || report.media.season === undefined || report.media.episode === undefined)) {
    throw new TypeError('V2 Prime episodes require a series, season and episode.');
  }
  if (report.artwork !== undefined) {
    object(report.artwork, ['large', 'largeText'], 'V2 Prime artwork');
    if (!validPrimeVideoArtworkUrl(report.artwork.large)) throw new TypeError('V2 Prime artwork must use an approved Amazon title image URL.');
    const expected = report.kind === 'episode' ? `Season ${report.media.season}, Episode ${report.media.episode} • ${report.media.title}` : report.media.title;
    if (report.artwork.largeText !== expected.slice(0, MAX_ACTIVITY_TEXT_LENGTH)) throw new TypeError('V2 Prime artwork text must describe the reported media.');
  }
  object(report.playback, ['state', 'position', 'duration', 'live', 'rate'], 'V2 playback');
  if (instagram) {
    if (!/^@[a-z0-9_][a-z0-9_.]{0,29}$/i.test(report.media.channel || '') ||
        report.media.creator !== report.media.channel.slice(1) || !['Reel', 'Story'].includes(report.media.subtitle) ||
        report.playback.live !== false || report.media.subtitle === 'Story' && report.media.title !== 'Watching Story') {
      throw new TypeError('V2 Instagram requires the matching creator handle, Reel/Story mode and non-live playback.');
    }
    if (!Array.isArray(report.buttons) || report.buttons.length > 2) throw new TypeError('V2 Instagram supports at most two public buttons.');
    const labels = new Set();
    const handle = report.media.channel.slice(1);
    for (const button of report.buttons) {
      object(button, ['label', 'url'], 'V2 Instagram button');
      const reel = typeof button.url === 'string' && /^https:\/\/www\.instagram\.com\/reel\/[a-z0-9_-]{1,64}\/$/i.test(button.url);
      const storyPrefix = `https://www.instagram.com/stories/${handle}/`;
      const story = button.url === storyPrefix || typeof button.url === 'string' && button.url.startsWith(storyPrefix) && /^\d{1,25}\/$/.test(button.url.slice(storyPrefix.length));
      if (labels.has(button.label) || !(button.label === 'View Profile' && button.url === `https://www.instagram.com/${handle}/` ||
          report.media.subtitle === 'Reel' && button.label === 'View Reel' && reel ||
          report.media.subtitle === 'Story' && button.label === 'View Story' && story)) {
        throw new TypeError('V2 Instagram buttons must use clean Instagram reel, matching story or profile URLs.');
      }
      labels.add(button.label);
    }
  }
  if (tiktok) {
    text(report.media.creator, MAX_ACTIVITY_TEXT_LENGTH, 'V2 TikTok creator');
    if (!/^@[a-z0-9_][a-z0-9_.]{0,23}$/i.test(report.media.channel || '')) throw new TypeError('V2 TikTok requires a public creator handle.');
    if (report.playback.live !== (report.kind === 'stream') || report.kind === 'stream' && report.playback.duration !== 0) throw new TypeError('V2 TikTok LIVE must use a session timer.');
    if (!Array.isArray(report.buttons) || report.buttons.length > 2) throw new TypeError('V2 TikTok supports at most two public buttons.');
    const labels = new Set();
    for (const button of report.buttons) {
      object(button, ['label', 'url'], 'V2 TikTok button');
      const profile = `https://www.tiktok.com/${report.media.channel}`;
      const expected = report.kind === 'stream' ? 'Watch Stream' : 'View TikTok';
      if (labels.has(button.label) || !(button.label === 'View Profile' && button.url === profile ||
          button.label === expected && (report.kind === 'stream' ? button.url === `${profile}/live` :
            typeof button.url === 'string' && button.url.startsWith(`${profile}/video/`) && /^\d{1,25}$/.test(button.url.slice(`${profile}/video/`.length))))) {
        throw new TypeError('V2 TikTok buttons must link to the reported public video, stream or profile.');
      }
      labels.add(button.label);
    }
  }
  return report;
}

export function describeActivityV2(metadata, source) {
  const config = validateActivityV2(source);
  if (config.schemaVersion === 2) return [
    `V2 reusable media capabilities on: ${metadata.matches.join(', ')}`,
    `Player container: ${config.scope}. Only the approved top-frame container is read; hidden and sensitive content is excluded.`,
    ...Object.entries(config.fields).map(([field, rule]) => `${field}: ${JSON.stringify(rule)}${rule.fallback !== undefined ? '; fallback applies only to missing nodes, never rejected content' : ''}.`),
    `Player: ${JSON.stringify(config.player)}. Native media supplies native playback; DOM media requires visible canvas/image evidence and approved visible control labels.`,
    ...(config.player.retainMetadata ? ['Retain previously visible metadata only for the same player, route and media source; rejected fields still clear it.'] : []),
    ...(config.player.allowAriaHidden ? ['The native media element alone may be aria-hidden for accessibility; text and ancestor hiding are still rejected.'] : []),
    ...(config.player.canvasSelector ? [`The native media element alone may have zero opacity only with overlapping visible canvas evidence from ${config.player.canvasSelector}; hidden ancestors remain rejected.`] : []),
    ...['paths', 'container', 'requiredFields', 'pageIdentity', 'links'].filter((key) => config[key] !== undefined).map((key) => `${key}: ${JSON.stringify(config[key])}.`),
    ...(config.container?.singlePlayer ? ['Find the nearest shared container without crossing another approved player. A missing selected-player container clears presence instead of choosing a smaller neighbor.'] : []),
    ...(config.presentation ? [`Core presentation: ${JSON.stringify(config.presentation)}. Templates use only the approved declared fields; artwork and literal button destinations are static. Named links are reconstructed from approved same-origin paths without queries or fragments.`] : []),
    ...(config.modes || []).map((mode) => `Media mode ${mode.id}: ${JSON.stringify(mode)}. Each mode has its own approved paths, container, fields, player and presentation; no site adapter runs.`),
    ...(config.lookup ? [`Trusted service lookup: ${config.lookup.service}; declared inputs ${JSON.stringify(config.lookup.input)}. Only the independent trusted service policy can authorize requests and returned presence values. Unknown services fail closed; this package cannot authorize a destination, endpoint, method, credentials or response parser.`] : []),
    'These selected values may be published to Discord when sharing is enabled. Review that selectors identify public media information. Public-path fields read only same-origin anchor paths matching the declared patterns, never queries/fragments; matchText additionally checks the visible anchor text against the extracted segment. pageIdentity.links rejects conflicting public media links on individual media pages. Player ID splits produce only bounded digits for identity/links. opacityAncestor exempts only the declared in-container fade ancestor, never the field, its descendants or other hiding. ignoreEmptyBreaks skips only childless BR formatting nodes. Packages cannot execute JavaScript, inspect arbitrary attributes, access page objects, or provide report URLs.',
  ].join('\n');
  if (config.page) return [
    `V2 page activity on: ${metadata.matches.join(', ')}`,
    `Visible page container: ${config.scope}. Only the visible browser tab reports activity; hidden tabs clear it.`,
    ...Object.entries(config.fields).map(([field, rule]) => rule.source === 'url.query'
      ? `${field}: submitted URL query parameter ${rule.parameter} (up to 256 characters). Search text may be published to Discord. No input, textarea or draft text is read.`
      : `${field}: ${rule.source}${rule.attribute ? ` (${rule.attribute})` : ''} from ${rule.selectors.join(' or ')}; hidden and sensitive content is excluded.`),
    ...config.page.routes.map((route) => `Route ${route.id}: paths ${route.paths.join(', ')}; query ${JSON.stringify(route.query)}; required ${route.requiredQuery.join(', ') || 'none'}; container ${route.scope || config.scope}; ${route.title !== undefined ? `static title ${route.title} (title extraction skipped); ` : ''}name ${route.name}; details ${route.details}; state ${route.state || '(omitted)'}.`),
    'Path tokens match one bounded segment: {number} is 1–25 digits; {segment} is 1–256 URL slug characters. Neither crosses a path separator or reads URL text into presence.',
    `Elapsed session timer: ${config.page.elapsed ? 'enabled, resets on query/mode changes or tab hiding' : 'disabled'}. No media player is required.`,
    ...(config.page.artwork ? [`Static artwork: ${JSON.stringify(config.page.artwork)}. Page text is never placed into an image URL.`] : []),
    'Full URLs and tracking parameters are not reported. No other page text, page scripts or network requests are read. The core renders approved literal templates and static artwork and applies sharing/preferences.',
  ].join('\n');
  return [
    `V2 reads media information on: ${metadata.matches.join(', ')}`,
    `Player container: ${config.scope}`,
    ...Object.entries(config.fields).map(([field, rule]) => `${field}: ${rule.source}${rule.attribute ? ` (${rule.attribute})` : ''} from ${rule.selectors.join(' or ')}`),
    `Player: ${config.player.adapter} from ${config.player.selectors.join(' or ')}`,
    ...(config.player.adapter === 'instagram' ? ['Instagram reads only the active visible reel on /reels/ or /reel/<id>/ and the active story on /stories/<username>/<id>/. The nearest bounded reel card binds its visible creator profile link and caption to one ready video; article layouts read only their header and caption heading. Story reads are limited to the visible Play/Pause control, its matching creator header and the media panel sharing that header. Adjacent reels, story previews, comments, reply text, messages, account pages and unrelated browsing are excluded. It reads public profile/reel/story paths without query strings, and builds View Reel/View Story and View Profile buttons. Videos use native progress; photo stories use playing/paused state with no fabricated progress timer. Missing reel captions use Watching Reel; stories use Watching Story. Presence artwork is always the static Instagram app logo, never a media preview or avatar. No page scripts, account data, media URLs, image descriptions or external network requests are read.'] : []),
    ...(config.player.adapter === 'tiktok' ? ['TikTok reads only the active visible public video card, video detail or LIVE player on tiktok.com. The fixed adapter also supports #main-content-video, TikTok public detail/LIVE containers, and open video overlays from Explore/profile/search. Overlays require a player ID matching the open video URL and the nearest public description, nickname and username container within five ancestor steps; they cannot select app/body roots or read comments. It reads creator names, handles, descriptions/titles, public TikTok links and player IDs; builds View TikTok/Watch Stream and View Profile buttons; and uses video progress or LIVE session elapsed time. Its opacity-zero VIDEO clock is accepted only when a visible sibling tt-vod-sr-wrap canvas renders that same player; hidden ancestors and private text remain excluded. The current creator declaration reads the name paragraph in DivCreatorInfoContainer and its public profile link. Empty formatting leaves in descriptions contain no readable text. Presence artwork is always the static TikTok app logo, never a video preview. Messages, account settings, upload and unrelated browsing routes are excluded.'] : []),
    ...(config.player.adapter === 'tiktok' && canonicalV2Json(config.fields) === canonicalV2Json(TIKTOK_FIELDS) ? ['Current LIVE: read room-header-anchor-name and its public profile link from the header sharing the active live-room-content panel. Use a visible public title, or the static text TikTok LIVE when no title exists. Do not read chat or recommendations. On the active discover-list-live-card, read only the fixed .e1xspjl31 title, .e1xspjl34 creator and public stream link. Its known .ee35qag0 public metadata fade layer may have zero opacity while the video plays; all other CSS hiding, sensitive elements, hidden fields, descendants, players and ancestors remain rejected.'] : []),
    ...(config.player.adapter === 'prime-video' ? ['Prime Video retains previously visible title/subtitle text while controls are removed, only for the same player, media source and route. Its rendered video may be aria-hidden for accessibility.'] : []),
    ...(config.player.metadata === 'prime-video-details' ? ['Prime Video details: parse the player episode line into series, season, episode and episode name. Read only matching public title headings, episode play labels and thumbnail images under #main. Artwork can be published from approved Amazon title-image CDN paths. No package network requests are made.'] : []),
    'These selected values may be published to Discord when sharing is enabled. Review that the selectors identify media information. V2 cannot run package JavaScript or request external network destinations.',
  ].join('\n');
}

export function canonicalV2Json(value) {
  return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map((key) => [key, nested[key]])) : nested);
}

export async function activityV2Digest(activityPackage) {
  const value = canonicalV2Json({
    metadata: validateV2Metadata(activityPackage.metadata),
    metadataSource: activityPackage.metadataSource ?? null,
    source: activityPackage.source,
    icon: activityPackage.icon || '',
    sourceType: activityPackage.sourceType || 'local',
    provenance: activityPackage.provenance || null,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
