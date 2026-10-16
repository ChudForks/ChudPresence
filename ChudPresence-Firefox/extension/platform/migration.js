const MIGRATION_KEY = 'firefoxSettingsMigrationVersion';
const DEFAULTS_KEY = 'firefoxLegacyActivityDefaults';
const migrations = new WeakMap();
const providers = [
  ['youtube', 'youtube', 'sourceYouTube'],
  ['youtube-music', 'youtubeMusic', 'sourceYouTubeMusic'],
  ['crunchyroll', 'crunchyroll', 'sourceCrunchyroll'],
  ['67movies', 'movies67', 'sourceMovies67'],
  ['twitch', 'twitch', 'sourceTwitch'],
  ['kick', 'kick', 'sourceKick'],
];
const fields = { ShowPaused: 'showPaused', ShowArtwork: 'showArtwork', ShowTimestamps: 'showTimestamps', ShowButtons: 'showButtons' };
const status = { app: 'app', creator: 'artist', artist: 'artist', streamer: 'artist', series: 'artist', video: 'track', track: 'track', episode: 'track', stream: 'track' };

async function migrate(api) {
  const stored = await api.storage.local.get(null);
  if (stored[MIGRATION_KEY] >= 1) return;
  const defaults = {};
  const records = stored.installedActivities;
  let changedRecords = false;
  for (const [id, prefix, enabledKey] of providers) {
    const preferences = {};
    for (const [suffix, key] of Object.entries(fields)) {
      const value = stored[`${prefix}${suffix}`] ?? stored[key];
      if (typeof value === 'boolean') preferences[key] = value;
    }
    const display = status[stored[`${prefix}StatusDisplay`]];
    if (display) preferences.statusDisplay = display;
    const enabled = stored[enabledKey];
    if (!Object.keys(preferences).length && typeof enabled !== 'boolean') continue;
    // Existing Activities/settings win over obsolete provider preferences.
    if (records?.[id] && typeof records[id] === 'object') {
      const record = records[id];
      record.preferences = { ...preferences, ...record.preferences };
      if (typeof record.enabled !== 'boolean' && typeof enabled === 'boolean') record.enabled = enabled;
      changedRecords = true;
    } else {
      defaults[id] = { preferences, ...(typeof enabled === 'boolean' ? { enabled } : {}) };
    }
  }
  // One atomic storage write before shared onInstalled removes retired keys.
  // Keep original keys not retired by shared code; never read or copy credentials.
  await api.storage.local.set({
    [MIGRATION_KEY]: 1, [DEFAULTS_KEY]: defaults,
    ...(changedRecords ? { installedActivities: records } : {}),
  });
}

export function migratePlatformSettings(api = globalThis.browser || globalThis.chrome) {
  if (!migrations.has(api)) {
    migrations.set(api, migrate(api).catch(error => { migrations.delete(api); throw error; }));
  }
  return migrations.get(api);
}

export async function activityInstallDefaults(id, api = globalThis.browser || globalThis.chrome) {
  await migratePlatformSettings(api);
  const stored = await api.storage.local.get(DEFAULTS_KEY);
  return stored[DEFAULTS_KEY]?.[id] || {};
}

export async function activityInstallCompleted(id, api = globalThis.browser || globalThis.chrome) {
  const stored = await api.storage.local.get(DEFAULTS_KEY);
  const defaults = stored[DEFAULTS_KEY];
  if (!defaults || !Object.hasOwn(defaults, id)) return;
  delete defaults[id];
  await api.storage.local.set({ [DEFAULTS_KEY]: defaults });
}
