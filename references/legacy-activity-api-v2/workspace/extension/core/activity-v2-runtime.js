// Both functions are serialized from bundled extension code into a USER_SCRIPT
// world. Keep them self-contained. Package contents are passed ONLY as JSON data.
import { collectGenericActivityV2 } from './activity-v2-generic.js';

export function collectActivityV2(config, document, window, state = {}, genericCollect) {
  if (config.schemaVersion === 2) return (genericCollect || collectGenericActivityV2)(config, document, window, state);
  const primeVideo = config.player?.adapter === 'prime-video';
  const clear = () => { delete state.primeVideo; delete state.tiktok; delete state.page; return null; };
  const route = window.location?.href || '';
  let pageRoute;
  let pageUrl;
  if (config.page) {
    if (document.visibilityState !== 'visible') return clear();
    try { pageUrl = new URL(route); } catch { return clear(); }
    if (pageUrl.protocol !== 'https:' || pageUrl.username || pageUrl.password || pageUrl.port) return clear();
    // Same bounded path-token/literal-query predicate as matchActivityV2Page.
    pageRoute = config.page.routes.find((candidate) => candidate.paths.some((path) => {
      const expected = path.split('/'); const actual = pageUrl.pathname.split('/');
      return expected.length === actual.length && expected.every((part, index) => part === '{number}'
        ? /^[0-9]{1,25}$/.test(actual[index])
        : part === '{segment}' ? actual[index].length <= 256 && /^(?:[-a-zA-Z0-9_]|%[0-9a-f]{2})+$/i.test(actual[index]) && !/%(?:2f|5c)/i.test(actual[index])
        : part === actual[index]);
    }) &&
      Object.entries(candidate.query).every(([key, values]) => pageUrl.searchParams.getAll(key).length <= 1 && values.includes(pageUrl.searchParams.get(key) || '')) &&
      candidate.requiredQuery.every((key) => pageUrl.searchParams.getAll(key).length === 1 && Boolean(pageUrl.searchParams.get(key)?.trim())));
    if (!pageRoute) return clear();
  }
  if (primeVideo) {
    // This bundled adapter cannot be repurposed for non-Prime/private pages.
    let url;
    try { url = new URL(route); } catch { return clear(); }
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(['primevideo.com', 'www.primevideo.com'].includes(url.hostname) ||
          ['amazon.com', 'www.amazon.com'].includes(url.hostname) && url.pathname.startsWith('/gp/video/'))) return clear();
  }
  // Do not include html/body in ancestor checks: all ordinary elements have
  // those ancestors. Check root identity separately and forbidden descendants.
  const sensitive = 'head, script, style, link, meta, form, input, textarea, select, option, iframe, object, embed, [contenteditable], [hidden], [aria-hidden="true"]';
  const permitted = (element, mediaAccessibility = false, opacityExemption = null) => {
    if (!element || element.nodeType !== 1 || element === document.body || element === document.documentElement) return false;
    // Prime marks the rendered VIDEO itself aria-hidden. Ancestor accessibility
    // hiding, CSS hiding, and every sensitive-element restriction still apply.
    if (mediaAccessibility ? element.closest(sensitive.replace(', [aria-hidden="true"]', '')) ||
        element.parentElement?.closest('[aria-hidden="true"]') : element.closest(sensitive)) return false;
    for (let ancestor = element; ancestor?.nodeType === 1; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden' || Number(style.opacity) === 0 && ancestor !== opacityExemption) return false;
    }
    return element.getClientRects().length > 0;
  };
  if (config.player?.adapter === 'instagram') {
    let url;
    try { url = new URL(route); } catch { return clear(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['instagram.com', 'www.instagram.com'].includes(url.hostname)) return clear();
    const reel = /^\/(?:reel|reels)\/([a-z0-9_-]{1,64})\/?$/i.exec(url.pathname);
    const story = /^\/stories\/([a-z0-9_][a-z0-9_.]{0,29})(?:\/(\d{1,25}))?\/?$/i.exec(url.pathname);
    if (!reel && !story && !/^\/reels\/?$/.test(url.pathname)) return clear();
    const areaOf = (element) => {
      if (!permitted(element)) return 0;
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) *
        Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    };
    const textOf = (element) => {
      if (!permitted(element) || element.querySelector(sensitive)) return '';
      const children = Array.from(element.querySelectorAll('*'));
      if (children.length > 64 || children.some((child) => child.textContent?.trim() && !permitted(child))) return '';
      return typeof element.textContent === 'string' && element.textContent.length <= 4096
        ? element.textContent.replace(/\s+/g, ' ').trim().slice(0, 256) : '';
    };
    const publicUrl = (link) => {
      if (!permitted(link)) return null;
      try {
        const parsed = new URL(link.getAttribute('href'), url.origin);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
          ['instagram.com', 'www.instagram.com'].includes(parsed.hostname) ? parsed : null;
      } catch { return null; }
    };
    const reserved = new Set(['accounts', 'direct', 'explore', 'reel', 'reels', 'stories', 'p', 'about', 'legal', 'developer']);
    const creatorOf = (root, selectors, expected = '') => {
      for (const selector of selectors) {
        for (const link of Array.from(root.querySelectorAll(selector)).slice(0, 16)) {
          const path = publicUrl(link)?.pathname;
          const handle = /^\/([a-z0-9_][a-z0-9_.]{0,29})(?:\/reels)?\/?$/i.exec(path || '')?.[1];
          if (!handle || reserved.has(handle.toLowerCase()) || expected && handle.toLowerCase() !== expected.toLowerCase()) continue;
          // The avatar link can precede the creator text. Require visible
          // username text, excluding commenter names and verification labels.
          const texts = [link, ...Array.from(link.querySelectorAll('span')).slice(0, 16)];
          if (texts.some((node) => textOf(node).replace(/^@/, '').toLowerCase() === handle.toLowerCase())) return handle;
        }
      }
      return '';
    };
    const finite = (value, fallback, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, maximum) : fallback;
    const playbackOf = (video) => ({ state: video.paused ? 'paused' : 'playing',
      position: finite(video.currentTime, 0, 31536000), duration: finite(video.duration, 0, 31536000),
      live: false, rate: finite(video.playbackRate, 1, 16) });
    if (story) {
      const candidates = [];
      // A story header's visible control distinguishes the open story from
      // neighboring clickable previews. Never inspect the reply composer.
      for (const control of Array.from(document.querySelectorAll('[role="button"] [aria-label="Pause"], [role="button"] [aria-label="Play"]')).slice(0, 32)) {
        if (!areaOf(control)) continue;
        let header;
        for (let node = control.parentElement, hops = 0; node && hops < 9; node = node.parentElement, hops++) {
          if (!permitted(node) || ['MAIN', 'BODY', 'HTML'].includes(node.tagName)) break;
          if (!header && creatorOf(node, ['a[href]'], story[1])) header = node;
          if (!header) continue;
          const videos = Array.from(node.querySelectorAll('video')).slice(0, 8);
          const video = videos.find((video) => areaOf(video) && !video.ended && video.readyState >= 1);
          // A loading/ended video cannot become a photo story just because its
          // poster or creator avatar remains. Photo content must be large,
          // loaded, visible and outside all profile/neighbor-preview links.
          const photo = !videos.length && Array.from(node.querySelectorAll('img')).slice(0, 16).find((img) => {
            const rect = img.getBoundingClientRect();
            return !img.closest('a') && img.complete && img.naturalWidth > 0 && rect.right - rect.left >= 200 &&
              rect.bottom - rect.top >= 200 && areaOf(img);
          });
          if (!video && !photo) continue;
          if (node.querySelectorAll('[role="button"] [aria-label="Pause"], [role="button"] [aria-label="Play"]').length !== 1) break;
          const handle = creatorOf(header, ['a[href]'], story[1]);
          if (!handle) break;
          candidates.push({ area: areaOf(video || photo), handle, playback: video ? playbackOf(video) :
            { state: control.getAttribute('aria-label') === 'Play' ? 'paused' : 'playing', position: 0, duration: 0, live: false, rate: 1 } });
          break;
        }
      }
      candidates.sort((a, b) => b.area - a.area);
      const selected = candidates[0];
      if (!selected) return clear();
      const { handle, playback } = selected;
      return { kind: 'video', media: { title: 'Watching Story', subtitle: 'Story', creator: handle, channel: `@${handle}` }, playback,
        buttons: [{ label: 'View Story', url: `https://www.instagram.com/stories/${handle}/${story[2] ? `${story[2]}/` : ''}` },
          { label: 'View Profile', url: `https://www.instagram.com/${handle}/` }] };
    }
    const candidates = [];
    for (const video of Array.from(document.querySelectorAll('video')).slice(0, 64)) {
      const area = areaOf(video);
      if (!area || video.ended || video.readyState < 1) continue;
      let root;
      let handle;
      // Current Reels wraps the player in many layout divs. Stop at the
      // nearest single-video container with the public creator anchor, within
      // sixteen ancestors. Never climb into the app, main page or other cards.
      for (let node = video.parentElement, hops = 0; node && hops < 16; node = node.parentElement, hops++) {
        if (!permitted(node) || ['MAIN', 'BODY', 'HTML'].includes(node.tagName) || node.id?.startsWith('mount_') || node.querySelectorAll('video').length > 1) break;
        const selectors = node.tagName === 'ARTICLE' ? ['header a[href]'] : ['a[aria-label$=" reels"]'];
        handle = creatorOf(node, selectors);
        if (handle) { root = node; break; }
      }
      candidates.push({ video, root, handle, area });
    }
    candidates.sort((a, b) => b.area - a.area || Number(a.video.paused) - Number(b.video.paused));
    const selected = candidates[0];
    if (!selected?.root) return clear();
    const { video, root, handle } = selected;
    let title = '';
    const titleSelectors = root.tagName === 'ARTICLE' ? ['h1'] : config.fields.title.selectors;
    for (const selector of titleSelectors) {
      const nodes = Array.from(root.querySelectorAll(selector)).slice(0, 8);
      if (!nodes.length) continue;
      // A present hidden/rejected caption must not silently become a fallback.
      title = textOf(nodes[0]);
      if (!title) return clear();
      break;
    }
    let id = reel?.[1];
    const links = Array.from(root.querySelectorAll('a[href]')).slice(0, 32);
    const ids = links.map((link) => /^\/(?:reel|reels)\/([a-z0-9_-]{1,64})\/?$/i.exec(publicUrl(link)?.pathname || '')?.[1]).filter(Boolean);
    if (id && ids.some((value) => value !== id)) return clear();
    id ||= ids[0];
    return { kind: 'video', media: { title: title || 'Watching Reel', subtitle: 'Reel', creator: handle, channel: `@${handle}` },
      playback: playbackOf(video), buttons: [
        ...(id ? [{ label: 'View Reel', url: `https://www.instagram.com/reel/${id}/` }] : []),
        { label: 'View Profile', url: `https://www.instagram.com/${handle}/` },
      ] };
  }
  if (config.player?.adapter === 'tiktok') {
    let url;
    try { url = new URL(route); } catch { return clear(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['tiktok.com', 'www.tiktok.com'].includes(url.hostname)) return clear();
    const individual = /^\/@([a-z0-9_][a-z0-9_.]{0,23})\/(?:video\/(\d{1,25})|live)\/?$/i.exec(url.pathname);
    const live = /^(?:\/live\/?|\/@[a-z0-9_][a-z0-9_.]{0,23}\/live\/?)$/i.test(url.pathname);
    if (!individual && !/^\/(?:following\/?|foryou\/?|live\/?|[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(url.pathname)) return clear();
    const textOf = (element, opacityExemption = null) => {
      if (!permitted(element, false, opacityExemption) || !['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'P', 'DIV', 'A', 'STRONG', 'B', 'EM', 'I', 'SMALL'].includes(element.tagName)) return '';
      const children = element.querySelectorAll('*');
      if (element.querySelector(sensitive) || children.length > 16 || Array.from(children).some((child) =>
        // Empty formatting leaves (including BR) contribute no text. Retain
        // fail-closed rejection of every hidden descendant containing text.
        !(child.textContent === '' && child.querySelectorAll('*').length === 0) && !permitted(child, false, opacityExemption))) return '';
      const value = element.textContent;
      return typeof value === 'string' && value.length <= 1024 ? value.replace(/\s+/g, ' ').trim().slice(0, 256) : '';
    };
    const candidates = [];
    const currentLive = config.fields.creator.selectors.includes('[class*="SpanNickName"], [class*="DivCreatorInfoContainer"] a p, [data-e2e="room-header-anchor-name"], .e1xspjl34');
    const canvasPlayer = (video) => {
      // TikTok's SR renderer hides only the source VIDEO and draws a sibling
      // canvas. Never grant this exception without that visible renderer.
      const wrapper = video.closest('.tiktok-web-player');
      const canvas = video.parentElement?.querySelector('tt-vod-sr-wrap > canvas');
      if (!wrapper || canvas?.tagName !== 'CANVAS' || canvas.closest('.tiktok-web-player') !== wrapper ||
          !permitted(canvas) || !permitted(video.parentElement) || video.closest(sensitive) || !video.getClientRects().length) return false;
      const style = window.getComputedStyle(video);
      if (Number(style.opacity) !== 0 || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return false;
      const sourceRect = video.getBoundingClientRect();
      const renderedRect = canvas.getBoundingClientRect();
      return renderedRect.right > sourceRect.left && renderedRect.left < sourceRect.right &&
        renderedRect.bottom > sourceRect.top && renderedRect.top < sourceRect.bottom;
    };
    for (const video of Array.from(document.querySelectorAll('video')).slice(0, 64)) {
      if ((!permitted(video) && !canvasPlayer(video)) || video.ended || video.readyState < 1) continue;
      const rect = video.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      if (!width || !height) continue;
      // Bind metadata to this video's public card. Never sample another card
      // merely because it was the first metadata node in the document.
      const card = video.closest('[data-e2e="recommend-list-item-container"]');
      // Current LIVE has a header sibling of the actual video room. This
      // single shared panel excludes the chat and recommendation containers.
      const liveRoom = live && currentLive && video.closest('[data-e2e="live-room-content"]');
      const livePanel = liveRoom?.parentElement;
      const liveHeader = livePanel?.querySelector('[data-e2e="live-header-container"]');
      if (liveRoom && (livePanel?.id === 'app' || !permitted(livePanel) || !permitted(liveHeader) || liveHeader.parentElement !== livePanel ||
          !liveHeader.querySelector('[data-e2e="room-header-anchor-name"]'))) continue;
      const liveFeed = live && currentLive && video.closest('[data-e2e="discover-list-live-card"]');
      let overlay;
      const browse = !card && !live && individual && video.closest('[data-e2e="browse-video"]');
      if (browse) {
        // Explore/profile/search open a public video overlay outside the page's
        // main container. Its class names are hashed, so find the nearest
        // bounded common ancestor of the fixed public metadata and this player.
        // Require this player's ID to match the open video, excluding preloads.
        const playerId = video.closest('.tiktok-web-player')?.getAttribute('id') || '';
        const id = /^(?:video-player-|xgwrapper-\d+-)(\d{1,25})$/.exec(playerId)?.[1];
        if (id !== individual[2]) continue;
        for (let node = browse.parentElement, hops = 0; node && hops < 5; node = node.parentElement, hops++) {
          if (node.id === 'app' || !permitted(node)) break;
          if (node.querySelector('[data-e2e="browse-video-desc"]') &&
              node.querySelector('[data-e2e="browser-nickname"]') && node.querySelector('[data-e2e="browse-username"]')) {
            overlay = node; break;
          }
        }
        if (!overlay) continue;
      }
      const root = liveRoom ? livePanel : liveFeed || card || overlay || (individual ? video.closest('#main-content-video, #main-content, div[class*="DivVideoDetailContainer"], div[class*="DivLiveContent"]') :
        live ? video.closest('div[class*="DivLivePlayerContainer"], div[class*="DivLiveContent"], div[class*="DivLiveRoom"]') : null);
      if (!permitted(root)) continue;
      candidates.push({ video, root, liveHeader: liveRoom ? liveHeader : null, liveFeed, area: width * height, playing: !video.paused });
    }
    // A neighboring card may continue autoplaying while the current card is
    // paused. Visible area wins so that leftover playback cannot steal it.
    candidates.sort((a, b) => b.area - a.area || Number(b.playing) - Number(a.playing));
    const selected = candidates[0];
    if (!selected) return clear();
    const { video, root, liveHeader, liveFeed } = selected;
    // LIVE feed intentionally fades this one fixed public metadata layer when
    // controls hide. Only its opacity may be zero; fields, descendants, player,
    // card and every other ancestor retain all visibility/sensitive checks.
    const liveFeedOverlay = liveFeed ? root.querySelector('.ee35qag0') : null;
    if (liveFeed && (!liveFeedOverlay || liveFeedOverlay.closest('[data-e2e="discover-list-live-card"]') !== root ||
        !liveFeedOverlay.querySelector('.e1xspjl31') || !liveFeedOverlay.querySelector('.e1xspjl34'))) return clear();
    const read = (field) => {
      for (const selector of config.fields[field].selectors) {
        if (selector === '[class*="DivDetailsLine"]' && !live) continue;
        let nodes = Array.from(root.querySelectorAll(selector)).slice(0, 8);
        if (selector === '[class*="DivDetailsLine"], .e1xspjl31') {
          if (!live) continue;
          nodes = liveFeed ? Array.from(root.querySelectorAll('.e1xspjl31')).slice(0, 8) :
            Array.from(root.querySelectorAll('[class*="DivDetailsLine"]')).slice(1, 2);
        }
        // LIVE cards put their stream title on the second details line.
        if (selector === '[class*="DivDetailsLine"]') nodes = nodes.slice(1, 2);
        if (selector === '[data-e2e="browser-nickname"]') {
          const nested = nodes.flatMap((node) => Array.from(node.querySelectorAll('[class*="SpanNickName"], [class*="SpanEllipsis"]')).slice(0, 8));
          if (nested.length) nodes = nested;
        }
        for (const node of nodes) { const value = textOf(node, liveFeedOverlay); if (value) return value; }
      }
      return '';
    };
    const rawHandle = read('channel').replace(/^@/, '');
    // An individual video's identity already comes from its public URL.
    // Avoid inspecting other links (including commenter links) in overlays.
    const links = individual || liveHeader ? [] : Array.from(root.querySelectorAll('a[href]')).slice(0, 32).filter((link) => permitted(link, false, liveFeedOverlay));
    const publicLinks = links.flatMap((link) => {
      try {
        const parsed = new URL(link.getAttribute('href'), url.origin);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
          ['tiktok.com', 'www.tiktok.com'].includes(parsed.hostname) ? [parsed] : [];
      } catch { return []; }
    });
    // Current cards put the public handle in the creator's profile anchor,
    // rather than a separate username text node. This link is within the
    // declared creator container; never borrow a sidebar/profile suggestion.
    const modernCreator = currentLive || config.fields.creator.selectors.includes('[class*="SpanNickName"], [class*="DivCreatorInfoContainer"] a p');
    const creatorLink = liveHeader ? liveHeader.querySelector('[data-e2e="room-header-anchor-name"]')?.closest('a[href]') :
      modernCreator ? root.querySelector('[class*="DivCreatorInfoContainer"] a[href]') : null;
    let creatorHandle = '';
    if (permitted(creatorLink)) {
      try {
        const link = new URL(creatorLink.getAttribute('href'), url.origin);
        if (link.protocol === 'https:' && !link.username && !link.password && !link.port && ['tiktok.com', 'www.tiktok.com'].includes(link.hostname)) {
          creatorHandle = /^\/@([a-z0-9_][a-z0-9_.]{0,23})\/?$/i.exec(link.pathname)?.[1] || '';
        }
      } catch { /* Invalid public profile links provide no handle. */ }
    }
    if (liveHeader && !creatorHandle) return clear();
    const handle = rawHandle || creatorHandle || individual?.[1] || (live ? publicLinks.map((link) => /^\/@([a-z0-9_][a-z0-9_.]{0,23})(?:\/live)?\/?$/i.exec(link.pathname)?.[1]).find(Boolean) : '');
    if (!/^[a-z0-9_][a-z0-9_.]{0,23}$/i.test(handle || '') || individual && individual[1].toLowerCase() !== handle.toLowerCase()) return clear();
    const creator = read('creator');
    const title = read('title') || (liveHeader && !config.fields.title.selectors.some((selector) => root.querySelectorAll(selector).length) ? 'TikTok LIVE' : '');
    if (!creator || !title) return clear();
    const profile = `https://www.tiktok.com/@${handle}`;
    let videoId = individual?.[2];
    if (!live && !videoId) {
      videoId = publicLinks.map((link) => {
        const match = /^\/@([a-z0-9_][a-z0-9_.]{0,23})\/video\/(\d{1,25})\/?$/i.exec(link.pathname);
        return match && match[1].toLowerCase() === handle.toLowerCase() ? match[2] : '';
      }).find(Boolean);
      if (!videoId) {
        const playerId = video.closest('.tiktok-web-player')?.getAttribute('id') || '';
        videoId = /^(?:video-player-|xgwrapper-\d+-)(\d{1,25})$/.exec(playerId)?.[1];
      }
    }
    const buttons = [
      ...(live ? [{ label: 'Watch Stream', url: `${profile}/live` }] : videoId ? [{ label: 'View TikTok', url: `${profile}/video/${videoId}` }] : []),
      { label: 'View Profile', url: profile },
    ];
    const identity = `${route}|${profile}|${videoId || 'live'}`;
    if (!live) delete state.tiktok;
    else if (state.tiktok?.identity !== identity || state.tiktok.player !== video) state.tiktok = { identity, player: video, startedAt: Date.now() };
    const finite = (value, fallback, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, maximum) : fallback;
    return {
      kind: live ? 'stream' : 'video', media: { title, creator, channel: `@${handle}` }, buttons,
      playback: { state: video.paused ? 'paused' : 'playing',
        position: live ? Math.min(31536000, Math.max(0, (Date.now() - state.tiktok.startedAt) / 1000)) : finite(video.currentTime, 0, 31536000),
        duration: live ? 0 : finite(video.duration, 0, 31536000), live, rate: live ? 1 : finite(video.playbackRate, 1, 16) },
    };
  }
  let root;
  // Inspect a bounded number of candidates, including replacement SPA players.
  for (const candidate of Array.from(document.querySelectorAll(pageRoute?.scope || config.scope)).slice(0, 8)) {
    if (permitted(candidate)) { root = candidate; break; }
  }
  if (!root) return clear();
  let player;
  for (const selector of config.player?.selectors || []) {
    for (const element of Array.from(root.querySelectorAll(selector)).slice(0, 8)) {
      if (['VIDEO', 'AUDIO'].includes(element.tagName) && permitted(element, primeVideo && element.tagName === 'VIDEO') &&
          (!primeVideo || !element.ended && element.readyState >= 1)) { player = element; break; }
    }
    if (player) break;
  }
  if (!config.page && (!player || player.ended || player.readyState < 1)) return clear();
  let media = {};
  for (const [field, rule] of Object.entries(config.fields)) {
    if (field === 'title' && pageRoute?.title !== undefined) {
      media.title = pageRoute.title;
      continue;
    }
    if (config.page && rule.source === 'url.query') {
      const raw = pageUrl.searchParams.get(rule.parameter);
      if (typeof raw === 'string' && raw.length <= 1024 && pageUrl.searchParams.getAll(rule.parameter).length === 1) {
        const value = raw.replace(/\s+/g, ' ').trim().slice(0, 256);
        if (value) media[field] = value;
      }
      continue;
    }
    let value = '';
    for (const selector of rule.selectors) {
      for (const element of Array.from(root.querySelectorAll(selector)).slice(0, 8)) {
        if (!permitted(element) || !['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'P', 'DIV', 'A', 'STRONG', 'B', 'EM', 'I', 'SMALL', 'IMG'].includes(element.tagName)) continue;
        // textContent includes CSS-hidden children. Reject the whole field before
        // reading it unless its bounded subtree also passes visibility checks.
        const descendants = element.querySelectorAll('*');
        if (element.querySelector(sensitive) || descendants.length > 16 ||
            Array.from(descendants).some((descendant) => !permitted(descendant))) continue;
        const raw = rule.source === 'dom.text' ? element.textContent : element.getAttribute(rule.attribute);
        if (typeof raw !== 'string' || raw.length > 1024) continue;
        let cleaned = raw.replace(/\s+/g, ' ').trim();
        if (rule.removePrefix && cleaned.startsWith(rule.removePrefix)) cleaned = cleaned.slice(rule.removePrefix.length).trim();
        if (rule.removeSuffix && cleaned.endsWith(rule.removeSuffix)) cleaned = cleaned.slice(0, -rule.removeSuffix.length).trim();
        value = cleaned.slice(0, 256);
        if (value) break;
      }
      if (value) break;
    }
    if (value) media[field] = value;
  }
  if (config.page) {
    if (!media.title) return clear();
    const key = JSON.stringify([pageUrl.origin, pageRoute.id, pageUrl.pathname, media.title,
      ...Object.entries(config.fields).filter(([field, rule]) => rule.source === 'url.query' && !(field === 'title' && pageRoute.title !== undefined))
        .map(([_field, rule]) => pageUrl.searchParams.get(rule.parameter))]);
    if (state.page?.key !== key) state.page = { key, startedAt: Date.now() };
    return { kind: 'generic', routeId: pageRoute.id, media,
      playback: { state: 'playing', position: config.page.elapsed ? Math.min(31536000, Math.max(0, (Date.now() - state.page.startedAt) / 1000)) : 0,
        duration: 0, live: false, rate: 1 } };
  }
  if (primeVideo) {
    // Source identity is used only locally for invalidation; it is never a
    // report field or network destination. Never retain across SPA navigation,
    // replacement players, duration changes, or rejected/present title nodes.
    const source = player.currentSrc || player.getAttribute('src') || '';
    const cached = state.primeVideo;
    if (!media.title) {
      const controlsPresent = Object.values(config.fields).some((rule) =>
        rule.selectors.some((selector) => root.querySelectorAll(selector).length > 0));
      if (controlsPresent || !source || cached?.root !== root || cached.player !== player ||
          cached.source !== source || cached.route !== route || cached.duration !== player.duration) return clear();
      media = { ...cached.media };
    } else {
      state.primeVideo = { root, player, source, route, duration: player.duration, media: { ...media } };
    }
  }
  if (!media.title) return clear();
  let kind = config.kind;
  let artwork;
  if (primeVideo && config.player.metadata === 'prime-video-details') {
    const series = media.title;
    // Parsing belongs to bundled code; packages cannot supply expressions.
    const episode = /^(?:S(?:eason)?\s*)(\d{1,5})\s*[,.:•-]?\s*E(?:p(?:isode)?)?\s*(\d{1,5})(?:\s*[:•–—-]?\s*(.*))?$/i.exec(media.subtitle || '');
    const numbers = episode && Number(episode[1]) <= 10000 && Number(episode[2]) <= 10000
      ? { season: Number(episode[1]), episode: Number(episode[2]) } : null;
    let episodeName = numbers ? (episode[3] || '').trim() : '';
    const textOf = (element, attribute) => {
      if (!permitted(element)) return '';
      const descendants = element.querySelectorAll('*');
      if (element.querySelector(sensitive) || descendants.length > 16 ||
          Array.from(descendants).some((child) => !permitted(child))) return '';
      const value = attribute ? element.getAttribute(attribute) : element.textContent;
      return typeof value === 'string' && value.length <= 1024 ? value.replace(/\s+/g, ' ').trim().slice(0, 256) : '';
    };
    const imageOf = (element) => {
      if (element?.tagName !== 'IMG' || !permitted(element)) return '';
      const value = element.getAttribute('src');
      if (typeof value !== 'string' || value.length > 2048) return '';
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
            ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'].includes(url.hostname) &&
            /^\/images\/S\/pv-target-images\/[a-f0-9]{64}(?:\.[a-z0-9_,.-]+)?\.(?:jpg|jpeg|png|webp|avif)$/i.test(url.pathname)) return url.href;
      } catch { /* Non-image and arbitrary destinations are not published. */ }
      return '';
    };
    const sameText = (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase();
    const main = document.querySelector?.('#main');
    let detailMatches = false;
    let image = '';
    if (main && permitted(main)) {
      const titles = [...Array.from(main.querySelectorAll('.DVWebNode-detail-atf-wrapper h1 img')).slice(0, 8).map((el) => textOf(el, 'alt')),
        ...Array.from(main.querySelectorAll('.DVWebNode-detail-atf-wrapper h1')).slice(0, 8).map((el) => textOf(el))];
      detailMatches = titles.some((title) => title && sameText(title, series));
      if (detailMatches && numbers) {
        for (const row of Array.from(main.querySelectorAll('#tab-content-episodes [id^="av-ep-episode-"]')).slice(0, 100)) {
          if (!permitted(row)) continue;
          // Read only the fixed public play-link label, never its href or inputs.
          // Decorative hidden icons do not contribute to this attribute value.
          const matchesNumbers = Array.from(row.querySelectorAll('a[data-testid="episodes-playbutton"]')).slice(0, 8).some((link) => {
            if (!permitted(link)) return false;
            const label = link.getAttribute('aria-label');
            if (typeof label !== 'string' || label.length > 1024) return false;
            const match = /\bS\s*(\d{1,5})\s*E\s*(\d{1,5})\b/i.exec(label);
            return match && Number(match[1]) === numbers.season && Number(match[2]) === numbers.episode;
          });
          if (!matchesNumbers) continue;
          const heading = Array.from(row.querySelectorAll('h3')).slice(0, 8).map((el) => textOf(el))
            .map((title) => /^(\d{1,5})[.)]\s*(.+)$/.exec(title)).find((match) => match && Number(match[1]) === numbers.episode &&
              (!episodeName || sameText(match[2], episodeName)));
          if (!heading) continue;
          episodeName ||= heading[2];
          image = Array.from(row.querySelectorAll('[data-testid="episode-image"] img')).slice(0, 8).map(imageOf).find(Boolean) || '';
          break;
        }
      }
      if (detailMatches && !image) {
        image = Array.from(main.querySelectorAll('.DVWebNode-detail-atf-wrapper img')).slice(0, 16)
          .filter((el) => !el.closest('h1') && sameText(textOf(el, 'alt'), series)).map(imageOf).find(Boolean) || '';
      }
    }
    if (numbers && episodeName) {
      kind = 'episode';
      media = { title: episodeName.slice(0, 256), series, ...numbers,
        subtitle: `Season ${numbers.season}, Episode ${numbers.episode}` };
    }
    if (image) artwork = { large: image, largeText: (kind === 'episode'
      ? `${media.subtitle} • ${media.title}` : media.title).slice(0, 256) };
  }
  const finite = (value, fallback, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, maximum) : fallback;
  return {
    kind,
    media,
    ...(artwork ? { artwork } : {}),
    playback: {
      state: player.paused ? 'paused' : 'playing',
      position: finite(player.currentTime, 0, 31536000),
      duration: finite(player.duration, 0, 31536000),
      live: player.duration === Infinity,
      rate: finite(player.playbackRate, 1, 16),
    },
  };
}

export function runActivityV2(config, identity, matches, exclusions, matchUrl, collect, matchPage, genericCollect) {
  if (window !== window.top || !matches.some((pattern) => matchUrl(pattern, location.href)) || exclusions.some((pattern) => matchUrl(pattern, location.href))) return;
  if (globalThis.__chudpresenceActivityGeneration === identity.capability) return;
  globalThis.__chudpresenceActivityGeneration = identity.capability;
  let stopped = false;
  let pending = false;
  let resample = false;
  let active = false;
  let port = null;
  let timer = null;
  let reconnect = null;
  let attempts = 0;
  let pageNavigation = null;
  let pageSampleTimer = null;
  let pageObserver = null;
  let lastReportedUrl = '';
  const collectionState = {};
  const request = (operation, payload = {}) => chrome.runtime.sendMessage({
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', ...identity,
    requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    operation, payload,
  });
  const snapshot = () => {
    if (stopped || !matches.some((pattern) => matchUrl(pattern, location.href)) ||
        exclusions.some((pattern) => matchUrl(pattern, location.href))) return null;
    return { activityId: identity.activityId, capability: identity.capability, href: location.href,
      report: collect(config, document, window, collectionState, genericCollect) };
  };
  if (config.schemaVersion === 2) globalThis.__chudpresenceActivityV2Snapshot = snapshot;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(reconnect);
    clearTimeout(pageSampleTimer);
    pageObserver?.disconnect();
    window.removeEventListener('pagehide', closing);
    window.removeEventListener('beforeunload', closing);
    if (config.page) {
      document.removeEventListener('visibilitychange', visibilityChanged);
      document.removeEventListener('click', pageLinkClicked, true);
      window.removeEventListener('popstate', queuePageSample);
      window.removeEventListener('hashchange', queuePageSample);
      window.navigation?.removeEventListener('navigate', pageNavigating);
      window.navigation?.removeEventListener('currententrychange', queuePageSample);
    }
    if (config.player?.adapter === 'prime-video' || config.schemaVersion === 2) {
      for (const event of ['loadstart', 'emptied', 'ended']) document.removeEventListener(event, mediaReset, true);
    }
    delete collectionState.primeVideo;
    delete collectionState.tiktok;
    delete collectionState.page;
    delete collectionState.generic;
    if (globalThis.__chudpresenceActivityV2Snapshot === snapshot) delete globalThis.__chudpresenceActivityV2Snapshot;
    try { port?.disconnect(); } catch {}
    if (globalThis.__chudpresenceActivityGeneration === identity.capability) delete globalThis.__chudpresenceActivityGeneration;
  };
  const approvedPageUrl = (href) => Boolean(config.page && matchPage?.(config, href) &&
    matches.some((pattern) => matchUrl(pattern, href)) && !exclusions.some((pattern) => matchUrl(pattern, href)));
  const currentNavigation = () => pageNavigation && Date.now() - pageNavigation.startedAt < 5000 ? pageNavigation : null;
  const closing = () => {
    const navigation = currentNavigation();
    void request('presence.clear', { closing: true, ...(navigation ? { navigationUrl: navigation.url } : {}) }).catch(() => {});
    stop();
  };
  const tick = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      const inScope = matches.some((pattern) => matchUrl(pattern, location.href)) && !exclusions.some((pattern) => matchUrl(pattern, location.href));
      if (!inScope) { delete collectionState.primeVideo; delete collectionState.tiktok; delete collectionState.page; delete collectionState.generic; }
      const report = inScope ? collect(config, document, window, collectionState, genericCollect) : null;
      // A same-document mode change can briefly remove the visible root. Keep
      // its last valid report during this bounded, approved navigation only.
      if (!report && active && document.visibilityState === 'visible' && currentNavigation() && approvedPageUrl(location.href)) return;
      if (!report && !active) return;
      const result = await request(report ? 'presence.report' : 'presence.clear', report ? { report } : {});
      if (result === false || result?.error?.code === 'permission_denied') stop();
      else if (result?.ok) {
        active = Boolean(report);
        if (report) {
          lastReportedUrl = location.href;
          if (pageNavigation && location.href !== pageNavigation.fromUrl) pageNavigation = null;
        }
      }
    } catch { /* A sleeping service worker will be retried on the next tick. */ }
    finally {
      pending = false;
      if (resample && !stopped) { resample = false; void tick(); }
    }
  };
  const queuePageSample = () => {
    if (stopped || pageSampleTimer !== null) return;
    pageSampleTimer = setTimeout(() => {
      pageSampleTimer = null;
      if (pending) resample = true;
      else void tick();
    }, 100);
  };
  const preparePageNavigation = (href) => {
    try {
      if (!approvedPageUrl(location.href) || !approvedPageUrl(href) || new URL(href).origin !== new URL(location.href).origin) {
        pageNavigation = null;
        return;
      }
      pageNavigation = { url: href, fromUrl: location.href, startedAt: Date.now() };
      queuePageSample();
    } catch { pageNavigation = null; }
  };
  const pageNavigating = (event) => { preparePageNavigation(event.destination?.url); };
  const pageLinkClicked = (event) => {
    if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    preparePageNavigation(link.href);
  };
  const visibilityChanged = () => {
    if (!config.page) return;
    if (document.visibilityState !== 'visible') { delete collectionState.page; pageNavigation = null; }
    if (pending) resample = true;
    else void tick();
  };
  const mediaReset = (event) => {
    if (event.target === collectionState.primeVideo?.player || event.target === collectionState.generic?.player) {
      delete collectionState.primeVideo;
      delete collectionState.generic;
      if (pending) resample = true;
      else void tick();
    }
  };
  const connect = () => {
    if (stopped) return;
    try {
      port = chrome.runtime.connect({ name: `chudpresence-activity-v2:${identity.activityId}:${identity.activityVersion}:${identity.capability}` });
      attempts = 0;
      port.onMessage.addListener((message) => {
        if (message?.type === 'CHUDPRESENCE_ACTIVITY_ABORT' && message.activityId === identity.activityId && message.activityVersion === identity.activityVersion) stop();
      });
      port.onDisconnect.addListener(() => { if (!stopped) reconnect = setTimeout(connect, 1000); });
      void tick();
    } catch { if (++attempts < 10) reconnect = setTimeout(connect, 1000); else stop(); }
  };
  window.addEventListener('pagehide', closing, { once: true });
  window.addEventListener('beforeunload', closing, { once: true });
  if (config.page) {
    document.addEventListener('visibilitychange', visibilityChanged);
    document.addEventListener('click', pageLinkClicked, true);
    window.addEventListener('popstate', queuePageSample);
    window.addEventListener('hashchange', queuePageSample);
    window.navigation?.addEventListener('navigate', pageNavigating);
    window.navigation?.addEventListener('currententrychange', queuePageSample);
    if (window.MutationObserver) {
      pageObserver = new window.MutationObserver(() => {
        // DOM churn (including streaming AI text) is not an extra heartbeat.
        // Only sample for route changes or while waiting for a ready page.
        if (!active || location.href !== lastReportedUrl) queuePageSample();
      });
      pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  if (config.player?.adapter === 'prime-video' || config.schemaVersion === 2) {
    for (const event of ['loadstart', 'emptied', 'ended']) document.addEventListener(event, mediaReset, true);
  }
  // Keep the two-second heartbeat as a fallback. Page navigation/readiness
  // events additionally coalesce quick samples instead of waiting for it.
  timer = setInterval(tick, 2000);
  connect();
}
