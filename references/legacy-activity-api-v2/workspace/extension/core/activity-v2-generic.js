// Serialized into the Activity USER_SCRIPT world. Keep this function entirely
// self-contained: approved package configuration is data, never executable code.
export function collectGenericActivityV2(config, document, window, state = {}) {
  const clear = () => { delete state.generic; return null; };
  const route = window.location?.href || '';
  let pageUrl;
  try { if (typeof URL !== 'undefined') pageUrl = new URL(route); } catch { /* New path capabilities fail closed below. */ }
  const matchPath = (path, pathname) => {
    const expected = path.split('/'), actual = pathname.split('/');
    return expected.length === actual.length && expected.every((part, index) => {
      const value = actual[index];
      if (part === '{number}') return /^[0-9]{1,25}$/.test(value);
      if (part === '{segment}') return /^(?!\.{1,2}$)[-a-zA-Z0-9_.]{1,256}$/.test(value);
      if (part === '{handle}') return /^@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,63}$/.test(value);
      if (part === '{locale}') return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(value);
      return part === value;
    });
  };
  const pathsMatch = (paths) => Boolean(pageUrl && pageUrl.protocol === 'https:' && !pageUrl.username && !pageUrl.password && !pageUrl.port && paths.some((path) => matchPath(path, pageUrl.pathname)));
  const sensitive = 'head, script, style, link, meta, form, input, textarea, select, option, iframe, object, embed, [contenteditable], [hidden], [aria-hidden="true"]';
  const permitted = (element, ownAriaHidden = false, ownOpacity = false, opacityAncestor = null) => {
    if (!element || element.nodeType !== 1 || element === document.body || element === document.documentElement) return false;
    if (ownAriaHidden ? element.closest(sensitive.replace(', [aria-hidden="true"]', '')) ||
      element.parentElement?.closest('[aria-hidden="true"]') : element.closest(sensitive)) return false;
    for (let ancestor = element; ancestor?.nodeType === 1; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) ||
        style.contentVisibility === 'hidden' || Number(style.opacity) === 0 && !(ownOpacity && ancestor === element) && ancestor !== opacityAncestor) return false;
    }
    return element.getClientRects().length > 0;
  };
  const areaOf = (element) => {
    const rect = element.getBoundingClientRect();
    return Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  };
  const finite = (value, fallback, maximum = 31536000) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum) : fallback;
  const fadeFor = (element, rule, root) => {
    const ancestor = rule.opacityAncestor && element.parentElement?.closest(rule.opacityAncestor);
    return ancestor && ancestor !== root && root.contains(ancestor) ? ancestor : null;
  };
  const publicPath = (raw) => {
    if (!pageUrl || typeof raw !== 'string' || !raw || raw.length > 2048 || /[\\\x00-\x20\x7f]/.test(raw) || raw.startsWith('//')) return undefined;
    if (!raw.startsWith('/') && !raw.startsWith(pageUrl.origin + '/')) return undefined;
    try {
      const parsed = new URL(raw, pageUrl.origin);
      return parsed.origin === pageUrl.origin && !parsed.username && !parsed.password && !parsed.port ? parsed.pathname : undefined;
    } catch { return undefined; }
  };
  const safeValue = (element, rule, root) => {
    const fade = fadeFor(element, rule, root);
    if (!permitted(element, false, false, fade) || !['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'P', 'DIV', 'A', 'STRONG', 'B', 'EM', 'I', 'SMALL', 'IMG'].includes(element.tagName)) return undefined;
    const descendants = element.querySelectorAll('*');
    // Check every descendant before touching textContent: even an empty hidden
    // formatting leaf must not cause a hidden subtree read.
    if (element.querySelector(sensitive) || descendants.length > (rule.maxDescendants ?? 16) || Array.from(descendants).some((child) =>
      !(rule.ignoreEmptyBreaks && child.tagName === 'BR' && child.childNodes.length === 0) && !permitted(child, false, false, fade))) return undefined;
    const raw = rule.source === 'dom.text' ? element.textContent : element.getAttribute(rule.attribute);
    if (typeof raw !== 'string' || raw.length > 1024) return undefined;
    let value = raw.replace(/\s+/g, ' ').trim();
    if (rule.removePrefix && value.startsWith(rule.removePrefix)) value = value.slice(rule.removePrefix.length).trim();
    if (rule.removeSuffix && value.endsWith(rule.removeSuffix)) value = value.slice(0, -rule.removeSuffix.length).trim();
    if (rule.split) value = value.split(rule.split.separator)[rule.split.index]?.trim() || '';
    if (!value) return undefined;
    if (rule.parse === 'handle') {
      value = '@' + value.replace(/^@/, '');
      return /^@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,63}$/.test(value) ? value : undefined;
    }
    if (rule.parse === 'integer') {
      if (!/^\d{1,5}$/.test(value) || Number(value) > 10000) return undefined;
      return Number(value);
    }
    if (rule.parse === 'number') {
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return undefined;
      const number = Number(value);
      return Number.isFinite(number) && number <= 31536000 ? number : undefined;
    }
    if (rule.parse === 'clock') {
      if (!/^\d{1,8}(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value)) return undefined;
      const parts = value.split(':').map(Number);
      if (parts.slice(1).some((part) => part >= 60)) return undefined;
      const number = parts.reduce((total, part) => total * 60 + part, 0);
      return Number.isFinite(number) && number <= 31536000 ? number : undefined;
    }
    return value.slice(0, 256);
  };
  const read = (root, rule) => {
    if (rule.source === 'constant') return { value: rule.value, absent: false };
    if (rule.source === 'first') {
      for (const choice of rule.rules) { const result = read(root, choice); if (!result.absent || result.value !== undefined) return result; }
      return { value: undefined, absent: true };
    }
    let present = false;
    for (const selector of rule.selectors) {
      let elements = Array.from(root.querySelectorAll(selector)).slice(0, 8);
      if (elements.length) present = true;
      if (rule.candidateIndex !== undefined) elements = elements.slice(rule.candidateIndex, rule.candidateIndex + 1);
      for (const element of elements) {
        let value;
        if (rule.source === 'public-path') {
          if (element.tagName !== 'A' || !permitted(element, false, false, fadeFor(element, rule, root)) || element.querySelector(sensitive)) continue;
          const path = publicPath(element.getAttribute('href'));
          if (path && rule.paths.some((pattern) => matchPath(pattern, path))) {
            value = path.split('/').slice(1)[rule.segment];
            if (rule.matchText) {
              const text = safeValue(element, { source: 'dom.text' }, root);
              if (!text || text.replace(/^@/, '').toLowerCase() !== value?.replace(/^@/, '').toLowerCase()) value = undefined;
            }
          }
        } else value = safeValue(element, rule, root);
        if (value !== undefined && value !== '') return { value, absent: false };
      }
    }
    if (!present && rule.source === 'public-path' && rule.pageFallback && pathsMatch(rule.paths)) return { value: pageUrl.pathname.split('/').slice(1)[rule.segment], absent: false };
    return { value: !present ? rule.fallback : undefined, absent: !present };
  };
  const canvasVisible = (player, root, config) => {
    if (!config.player.canvasSelector || !permitted(player, Boolean(config.player.allowAriaHidden), true)) return false;
    const playerRect = player.getBoundingClientRect();
    if (config.player.canvasContainer) {
      const container = player.closest(config.player.canvasContainer);
      if (!container || !root.contains(container)) return false;
      root = container;
    }
    return Array.from(root.querySelectorAll(config.player.canvasSelector)).slice(0, 8).some((canvas) => {
      if (canvas.tagName !== 'CANVAS' || !permitted(canvas) || !areaOf(canvas) || !(canvas.width > 0) || !(canvas.height > 0)) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.right > playerRect.left && rect.left < playerRect.right &&
        rect.bottom > playerRect.top && rect.top < playerRect.bottom;
    });
  };
  const controlState = (root, config) => {
    const rule = config.player.state;
    for (const selector of rule.selectors) {
      for (const control of Array.from(root.querySelectorAll(selector)).slice(0, 8)) {
        if (!permitted(control)) continue;
        // This label is only compared to approved literals, never published.
        const value = control.getAttribute(rule.attribute);
        if (rule.playing.includes(value)) return 'playing';
        if (rule.paused.includes(value)) return 'paused';
      }
    }
    return null;
  };
  const playerId = (player, rule, root) => {
    const element = player.closest(rule.selector);
    if (!element || !root.contains(element) || !permitted(element)) return undefined;
    const raw = element.getAttribute('id');
    if (typeof raw !== 'string' || raw.length > 256) return undefined;
    if (rule.prefixes && !rule.prefixes.some((prefix) => raw.startsWith(prefix))) return undefined;
    const parts = raw.split(rule.split.separator);
    if (rule.parts !== undefined && parts.length !== rule.parts) return undefined;
    const value = parts[rule.split.index];
    return /^[0-9]{1,25}$/.test(value || '') ? value : undefined;
  };
  const candidates = [];
  const packageConfig = config;
  const modes = [...(config.modes || []), { ...config, id: 'default' }];
  for (const mode of modes) {
    if (mode.paths && !pathsMatch(mode.paths)) continue;
    const native = mode.player.adapter === 'html-media';
    const mediaScope = ['video', 'audio'].includes(mode.scope);
    for (const scope of Array.from(document.querySelectorAll(mode.scope)).slice(0, 32)) {
      let root = scope;
      if (mode.container) {
        root = null;
        for (let node = scope.parentElement, hops = 0; node && hops < mode.container.ancestors; node = node.parentElement, hops++) {
          if (!permitted(node) || ['MAIN', 'BODY', 'HTML'].includes(node.tagName) || mode.container.exclude?.some((selector) => node.matches(selector))) break;
          if (mode.container.singlePlayer && node.querySelectorAll(mode.player.selectors.join(', ')).length > 1) break;
          if (mode.container.required.every((selector) => node.querySelector(selector))) { root = node; break; }
        }
      }
      // Keep an unbound native player in the ranking: a winning card without
      // metadata must clear rather than publish a smaller neighbor's activity.
      if (!permitted(root) && !mediaScope) continue;
      for (const selector of mode.player.selectors) {
        const players = mediaScope && scope.matches(selector) ? [scope] : Array.from(scope.querySelectorAll(selector)).slice(0, 8);
        for (const player of players) {
          let playbackState;
          if (native) {
            if (!['VIDEO', 'AUDIO'].includes(player.tagName) || player.ended || player.readyState < 1 ||
              !(permitted(player, Boolean(mode.player.allowAriaHidden)) || canvasVisible(player, scope, mode))) continue;
            playbackState = player.paused ? 'paused' : 'playing';
          } else {
            if (!['CANVAS', 'IMG'].includes(player.tagName) || !permitted(player) ||
              player.tagName === 'IMG' && (!player.complete || !(player.naturalWidth > 0)) ||
              player.tagName === 'CANVAS' && (!(player.width > 0) || !(player.height > 0))) continue;
            playbackState = controlState(root, mode);
            if (!playbackState) continue;
          }
          const area = areaOf(player);
          if (mode.player.selection === 'largest-visible' && !area) continue;
          if (root && mode.pageIdentity?.playerId && pathsMatch(mode.pageIdentity.paths) && playerId(player, mode.pageIdentity.playerId, root) !== pageUrl.pathname.split('/').slice(1)[mode.pageIdentity.segment]) continue;
          candidates.push({ root, player, playbackState, area, config: mode });
        }
      }
    }
  }
  if (packageConfig.player.selection === 'largest-visible') candidates.sort((a, b) => b.area - a.area ||
    Number(b.playbackState === 'playing') - Number(a.playbackState === 'playing') ||
    (a.player === b.player ? Number(Boolean(b.root)) - Number(Boolean(a.root)) : 0) ||
    (a.root !== b.root && a.root?.contains?.(b.root) ? 1 : a.root !== b.root && b.root?.contains?.(a.root) ? -1 : 0));
  const selected = candidates[0];
  if (!selected?.root) return clear();
  const { root, player, playbackState } = selected;
  config = selected.config;
  const native = config.player.adapter === 'html-media';
  // Resource identity is local invalidation evidence only. It never enters a
  // report, presentation value, network parameter, or destination.
  const source = typeof player.currentSrc === 'string' ? player.currentSrc : '';
  const duration = native ? player.duration : undefined;
  let cached = state.generic;
  if (!cached || cached.root !== root || cached.player !== player || cached.source !== source ||
    cached.route !== route || cached.duration !== duration || cached.modeId !== config.id) cached = null;
  const media = {};
  for (const [field, rule] of Object.entries(config.fields)) {
    const result = read(root, rule);
    let value = result.value;
    if (result.absent && config.player.retainMetadata && cached && Object.hasOwn(cached.media, field)) value = cached.media[field];
    if (value !== undefined) media[field] = value;
  }
  if (!media.title || (config.requiredFields || []).some((field) => media[field] === undefined)) return clear();
  if (config.pageIdentity?.fields && pathsMatch(config.pageIdentity.paths) && Object.entries(config.pageIdentity.fields).some(([field, index]) => {
    const expected = pageUrl.pathname.split('/').slice(1)[index];
    return typeof media[field] !== 'string' || typeof expected !== 'string' || (config.pageIdentity.ignoreCase ? media[field].toLowerCase() !== expected.toLowerCase() : media[field] !== expected);
  })) return clear();
  // Changing a reused live player to another creator starts a new session.
  if (cached && (config.requiredFields || []).some((field) => cached.media[field] !== media[field])) cached = null;
  const links = {};
  for (const [name, rule] of Object.entries(config.links || {})) {
    const accept = (path) => path && path.length <= 256 && rule.paths.some((pattern) => matchPath(pattern, path)) &&
      Object.entries(rule.matchFields || {}).every(([field, index]) => typeof media[field] === 'string' && path.split('/').slice(1)[index] === media[field]);
    for (const source of rule.sources) {
      const paths = [];
      if (source.source === 'page') paths.push(pageUrl?.pathname);
      if (source.source === 'dom.link') {
        for (const selector of source.selectors) for (const link of Array.from(root.querySelectorAll(selector)).slice(0, 8)) {
          if (link.tagName === 'A' && permitted(link, false, false, fadeFor(link, source, root)) && !link.querySelector(sensitive)) paths.push(publicPath(link.getAttribute('href')));
        }
      }
      if (source.source === 'template') {
        const values = { ...media, ...(source.playerId ? { id: playerId(player, source.playerId, root) } : {}) };
        let valid = true;
        const path = source.path.replace(/\{([a-z]+)\}/g, (_match, field) => {
          const value = values[field];
          if (typeof value !== 'string' || !/^(?!\.{1,2}$)[-a-zA-Z0-9_@.]{1,256}$/.test(value)) valid = false;
          return value || '';
        });
        if (valid) paths.push(path);
      }
      const identityIndex = config.pageIdentity?.links?.[name];
      if (identityIndex !== undefined && pathsMatch(config.pageIdentity.paths) && paths.filter(accept).some((path) =>
        path.split('/').slice(1)[identityIndex] !== pageUrl.pathname.split('/').slice(1)[identityIndex])) return clear();
      const path = paths.find(accept);
      if (path) { links[name] = path; break; }
    }
  }
  const startedAt = cached?.startedAt ?? Date.now();
  const live = config.player.live ?? (native && player.duration === Infinity);
  let position = native ? finite(player.currentTime, 0) : config.player.position ? read(root, config.player.position).value ?? 0 : 0;
  let playbackDuration = native ? finite(player.duration, 0) : config.player.duration ? read(root, config.player.duration).value ?? 0 : 0;
  if (config.player.elapsed) {
    position = Math.min(31536000, Math.max(0, (Date.now() - startedAt) / 1000));
    playbackDuration = 0;
  }
  if (live) playbackDuration = 0;
  state.generic = { root, player, source, route, duration, modeId: config.id, media: { ...media }, startedAt };
  return { ...(packageConfig.modes ? { modeId: config.id } : {}), ...(config.links ? { links } : {}), kind: config.kind, media, playback: { state: playbackState, position, duration: playbackDuration,
    live: Boolean(live), rate: native && !config.player.elapsed ? finite(player.playbackRate, 1, 16) : 1 } };
}
