import { EXTENSION_NAME } from './branding.js';

const MAX_TEXT_LENGTH = 128;
const APP_SESSION_STORAGE_KEY = 'presenceAppSession';

const LEGACY_SOURCE_LAYOUTS = Object.freeze({
  youtubeMusic: {
    name: 'YouTube Music',
    statusFields: { app: 'name', artist: 'state', track: 'details' },
  },
  crunchyroll: {
    name: 'Crunchyroll',
    statusFields: { app: 'name', series: 'details', episode: 'state' },
  },
  movies67: {
    name: '67Movies',
    statusFields: { app: 'name', series: 'details', episode: 'state' },
  },
});

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

function isNormalizedActivityReport(track) {
  return Boolean(track?.media && track?.playback && track?.display && track?.artwork);
}

function legacyButtons(track) {
  if (Array.isArray(track.buttons)) return track.buttons;
  const url = safeUrl(track.url);
  if (!url) return [];

  if (track.source === 'movies67') {
    return [
      { label: track.kind === 'movie' ? 'Watch movie' : 'Watch on 67Movies', url },
      { label: 'Open 67Movies', url: `${new URL(url).origin}/` },
    ];
  }

  return [{ label: 'Open', url }];
}

function reportForTrack(track) {
  if (isNormalizedActivityReport(track)) return track;
  const kind = track.kind === 'short' ? 'video' : track.kind === 'live' ? 'stream' : track.kind || 'generic';
  const legacyLayout = LEGACY_SOURCE_LAYOUTS[track.source];
  const media = {
    title: track.title,
    artist: track.artist,
    album: track.album,
    series: track.series || (kind === 'episode' ? track.artist : undefined),
    subtitle: track.subtitle,
    creator: track.creator,
    channel: track.channel,
    game: track.game,
    category: track.category,
  };
  const displayDefaults = (() => {
    if (track.source === 'youtubeMusic') return { details: media.title, state: media.artist || '' };
    if (track.source === 'crunchyroll' || track.source === 'movies67') {
      const movie = track.kind === 'movie';
      return {
        details: movie ? media.title : media.series || media.artist || media.title,
        state: movie ? legacyLayout.name : media.album || media.title,
      };
    }
    if (kind === 'song') return { details: media.title, state: media.artist || '' };
    if (kind === 'episode') return { details: media.series || media.title, state: media.title };
    if (kind === 'stream') return { details: media.title, state: media.creator || media.channel || media.artist || '' };
    if (kind === 'movie') return { details: media.title, state: '' };
    if (kind === 'game') return { details: media.game || media.title, state: media.category || '' };
    return { details: track.details || media.title, state: track.state || media.artist || media.album || '' };
  })();
  const legacyArtwork = typeof track.artwork === 'string'
    ? { large: track.artwork, largeText: track.display?.largeText || media.album || media.title }
    : track.artwork || {};
  return {
    ...track,
    kind,
    media,
    playback: {
      state: track.playing === false ? 'paused' : 'playing',
      position: Number(track.position) || 0,
      duration: Number(track.duration) || 0,
      live: Boolean(track.live || track.kind === 'live'),
      rate: 1,
    },
    display: {
      ...displayDefaults,
      ...(legacyLayout ? { statusFields: legacyLayout.statusFields } : {}),
      ...(track.display || {}),
    },
    ...(!track.activityName && legacyLayout ? { activityName: legacyLayout.name } : {}),
    artwork: legacyArtwork,
    buttons: legacyButtons(track),
    visibility: track.ad ? 'ad' : track.idle ? 'idle' : 'normal',
  };
}

function activityType(report) {
  if (!report.activityId && LEGACY_SOURCE_LAYOUTS[report.source]) {
    return report.source === 'youtubeMusic' ? 'listening' : 'watching';
  }
  const declared = report.presenceKind;
  const type = declared === 'music'
    ? 'listening'
    : declared === 'video'
      ? 'watching'
      : declared === 'streaming'
        ? 'streaming'
        : declared === 'generic'
          ? 'playing'
          : report.kind === 'song'
            ? 'listening'
            : report.kind === 'stream'
              ? 'watching'
              : report.kind === 'game' || report.kind === 'generic'
                ? 'playing'
                : 'watching';
  if (type !== 'streaming') return type;
  const hasSafeUrl = safeUrl(report.url) || safeUrl(report.buttons?.[0]?.url);
  return hasSafeUrl ? type : 'watching';
}

function timestamps(playback, nowMs) {
  if (playback.state !== 'playing') return null;
  const position = Math.max(0, Number(playback.position) || 0);
  const now = Math.floor(nowMs / 1000);
  // Browsing elapsed timers already measure wall time. Media clocks measure
  // content time, so convert them to the real time Discord's timer advances.
  if (playback.elapsed) return { start: now - Math.floor(position) };
  const rate = Number(playback.rate ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const start = now - Math.floor(position / rate);
  if (!Number.isSafeInteger(start * 1000)) return null;
  if (playback.live) return { start };
  const duration = Math.max(0, Number(playback.duration) || 0);
  if (!duration || position >= duration) return null;
  const end = now + Math.ceil((duration - position) / rate);
  return Number.isSafeInteger(end * 1000) ? { start, end } : null;
}

function statusDisplayType(report, settings) {
  if (report.display.statusDisplayOverride) return report.display.statusDisplayOverride;
  const selected = report.display.statusFields?.[settings.statusDisplay];
  if (selected) return selected;
  if (settings.statusDisplay === 'app') return 'name';
  if (settings.statusDisplay === 'artist' || settings.statusDisplay === 'creator') return 'state';
  if (settings.statusDisplay === 'track' || settings.statusDisplay === 'video') return 'details';
  return report.display.statusDisplay || 'name';
}

/** Convert generic media data to a transport-neutral presence intent. */
export function createPresenceIntent(track, nowMs = Date.now(), settings = {}, appStartedAt = Math.floor(nowMs / 1000)) {
  if (!track) return null;
  const report = reportForTrack(track);
  if (report.visibility !== 'normal' || !report.media?.title) return null;

  const name = cleanText(report.display.name || report.activityName || EXTENSION_NAME, 128);
  const details = cleanText(report.display.details || report.media.title);
  if (!details) return null;
  const paused = report.playback.state === 'paused';
  const markers = [report.playback.live && 'Live', paused && 'Paused'].filter(Boolean);
  const state = cleanText(report.playback.elapsed
    ? report.display.state ?? ''
    : report.display.state || report.media.artist || report.media.creator || name);
  const type = activityType(report);
  const streamUrl = safeUrl(report.url) || safeUrl(report.buttons?.[0]?.url);
  const art = settings.showArtwork === false ? null : report.artwork;
  const largeImage = safeUrl(art?.large);
  const largeUrl = safeUrl(art?.largeUrl);
  const smallImage = safeUrl(art?.small);
  const detailsUrl = safeUrl(report.display.detailsUrl);
  const stateUrl = safeUrl(report.display.stateUrl);
  const hideState = report.display.hideState === true;
  const buttons = settings.showButtons === false
    ? []
    : (report.buttons || []).map((button) => {
        const url = safeUrl(button?.url);
        const label = cleanText(button?.label, 32);
        return url && label ? { label, url } : null;
      }).filter(Boolean).slice(0, 2);

  return {
    name,
    type,
    ...(type === 'streaming' && streamUrl ? { streamUrl } : {}),
    details,
    ...(detailsUrl ? { detailsUrl } : {}),
    state: hideState ? '' : markers.length ? `${cleanText(state, MAX_TEXT_LENGTH - markers.join(' • ').length - 3)} • ${markers.join(' • ')}` : state,
    ...(!hideState && stateUrl ? { stateUrl } : {}),
    statusDisplayType: statusDisplayType(report, settings),
    timestamps: settings.showTimestamps === false ? { start: appStartedAt } : timestamps(report.playback, nowMs),
    assets: largeImage ? {
      largeImage,
      largeText: cleanText(art.largeText ?? (report.media.album || report.media.title)),
      ...(largeUrl ? { largeUrl } : {}),
      ...(smallImage ? { smallImage, smallText: cleanText(art.smallText || name) } : {}),
    } : null,
    buttons,
    source: report.activityId || report.source || 'unknown',
  };
}

/** Keep app elapsed time independent of content, playback state, and worker wakes. */
export function createPresenceSession({ storage, now = Date.now } = {}) {
  let session = null;
  let initialization = null;
  let writes = Promise.resolve();
  function save() {
    if (!storage) return;
    const snapshot = session && { ...session };
    writes = writes.catch(() => {}).then(() => storage.set({ [APP_SESSION_STORAGE_KEY]: snapshot }));
    void writes.catch(() => {});
  }
  return {
    initialize() {
      if (!initialization) {
        initialization = (async () => {
          const saved = (await storage?.get(APP_SESSION_STORAGE_KEY))?.[APP_SESSION_STORAGE_KEY];
          if (typeof saved?.source === 'string' && saved.source &&
              Number.isSafeInteger(saved.start) && saved.start >= 0 && Number.isSafeInteger(saved.start * 1000)) {
            session = { source: saved.source, start: Math.min(saved.start, Math.floor(now() / 1000)) };
          }
        })().catch(error => { initialization = null; throw error; });
      }
      return initialization;
    },
    createIntent(track, nowMs = now(), settings = {}) {
      const source = track?.activityId || track?.source || 'unknown';
      const current = Math.floor(nowMs / 1000);
      const start = session?.source === source ? Math.min(session.start, current) : current;
      const intent = createPresenceIntent(track, nowMs, settings, start);
      if (intent && (session?.source !== source || session.start !== start)) {
        session = { source, start };
        save();
      }
      return intent;
    },
    clear() {
      if (!session) return;
      session = null;
      save();
    },
  };
}
