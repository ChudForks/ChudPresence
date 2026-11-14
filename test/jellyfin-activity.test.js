import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { normalizeActivityReport } from '../extension/core/activity-validator.js';
import { createPresenceIntent } from '../extension/core/presence.js';

let source;
try { source = await readFile(new URL('../ChudPresence-Activities/activities/jellyfin/activity.js', import.meta.url), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function fixture(t, { type = 'Movie', player = true, sourceId = true, settings = {}, product = 'Jellyfin Server', sessions = [], storageBlocked = false, pageApi,
  itemFields = {}, album = null, series = null, musicBrainz = {}, tmdb = {}, pageFetch, base = 'http://localhost:8096/jellyfin/' } = {}) {
  if (!source) { t.skip('The optional V1 Activities checkout is unavailable.'); return null; }
  const requests = [];
  const reports = [];
  const logs = [];
  let clears = 0;
  let time = 100000;
  let interval;
  let settingsChanged;
  let navigationChanged;
  let mediaChanged;
  const signal = { aborted: false };
  const storage = new Map([
    ['jellyfin_credentials', JSON.stringify({ Servers: [{ Id: 'server001', UserId: 'user001', AccessToken: 'private-token' }] })],
    ['_deviceId2', 'device001'],
  ]);
  const item = { Id: 'item001', Name: 'Example title', Type: type, ProductionYear: 2026, Genres: ['Drama'],
    CommunityRating: 8.2, RunTimeTicks: 1200000000, SeriesName: 'Example series', ParentIndexNumber: 0,
    IndexNumber: 2, SeriesId: 'series001', Artists: ['Example artist'], Album: 'Example album', AlbumId: 'album001',
    Overview: 'A plot summary.', ProviderIds: { Imdb: 'tt12345' }, ...itemFields };
  let element = player ? { currentSrc: sourceId ? `${base}${type === 'Audio' ? 'Audio' : 'Videos'}/item001/stream?api_key=private-token` : 'blob:local-player' } : null;
  const snapshot = { playing: true, paused: false, ended: false, currentTime: 30, duration: 120, playbackRate: 1 };
  const pageContext = vm.createContext({ window: { ApiClient: pageApi },
    localStorage: { getItem: key => storage.get(key) || null } });
  const context = vm.createContext({ URL, URLSearchParams, location: new URL(base + 'web/#/video'), window: {},
    AbortController, setTimeout, clearTimeout,
    ...(pageFetch ? { fetch: pageFetch, FormData, Blob } : {}),
    localStorage: { getItem: key => { if (storageBlocked) throw new Error('Website storage is unavailable in this world'); return storage.get(key) || null; } },
    Date: class extends Date { static now() { return time; } },
    ChudPresence: {
      runtime: { siteUrl: base }, lifecycle: { signal, interval: callback => { interval = callback; },
        timeout() {}, onCleanup() {} },
      navigation: { onChange: callback => { navigationChanged = callback; } },
      media: { find: () => element, snapshot: () => ({ ...snapshot }), onChange: callback => { mediaChanged = callback; } },
      page: { execute: async (callback, args = []) => vm.runInContext(`(${callback.toString()})(...${JSON.stringify(args)})`, pageContext) },
      log: { debug: async (...args) => { logs.push(structuredClone(args)); } },
      settings: { getAll: async () => settings, onChange: callback => { settingsChanged = callback; } },
      async report(report) { const value = structuredClone(report); normalizeActivityReport(value, 1); reports.push(value); },
      async clear() { clears += 1; },
      net: { async fetch(value, options) {
        const url = new URL(value);
        requests.push({ url: url.href, options: structuredClone(options) });
        if (url.pathname.endsWith('/System/Info/Public')) return { ok: true, data: { Id: 'server001', ProductName: product } };
        if (url.pathname.endsWith('/Sessions')) return { ok: true, data: sessions };
        if (url.pathname.endsWith('/Items/item001')) return { ok: true, data: item };
        if (album && url.pathname.endsWith('/Items/album001')) return { ok: true, data: album };
        if (series && url.pathname.endsWith('/Items/series001')) return { ok: true, data: series };
        if (url.hostname === 'api.themoviedb.org') {
          const key = url.pathname.replace(/^\/3\//, '');
          return key in tmdb ? { ok: true, data: tmdb[key] } : { ok: false, data: null };
        }
        if (url.hostname === 'musicbrainz.org') {
          const id = url.pathname.split('/').at(-1);
          return id in musicBrainz ? { ok: true, data: { id, 'cover-art-archive': { front: musicBrainz[id] } } } : { ok: false, data: null };
        }
        return { ok: false, data: null };
      } },
    },
  });
  const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  vm.runInContext(source, context);
  await flush();
  return { base, context, reports, requests, logs, item, snapshot, storage, signal, get clears() { return clears; },
    async settle() { for (let i = 0; i < 6; i += 1) await flush(); },
    async tick() { time += 2000; await interval(); await flush(); },
    async changeSettings(values) { settingsChanged({ settings: { ...settings, ...values } }); await flush(); },
    async mediaEvent(type) { mediaChanged({ type }); await flush(); },
    async navigate(hash) { context.location.hash = hash; navigationChanged(); await flush(); },
    removePlayer() { element = null; },
  };
}

test('Jellyfin movie reports preserve progress, presentation, and public links without exposing credentials', async t => {
  const h = await fixture(t); if (!h) return;
  const report = h.reports.at(-1);
  assert.equal(report.kind, 'movie');
  assert.equal(report.media.title, 'Example title');
  assert.equal(report.display.state, '2026 • Drama • ★ 8.2');
  assert.equal(report.playback.position, 30);
  assert.equal(report.playback.duration, 120);
  assert.equal(report.buttons[0].url, 'https://www.imdb.com/title/tt12345/');
  assert.equal(createPresenceIntent({ ...normalizeActivityReport(report), activityId: 'jellyfin', activityName: 'Jellyfin' }).type, 'watching');
  assert.equal(JSON.stringify(h.reports).includes('private-token'), false);
  assert.equal(h.requests.some(request => request.url.includes('private-token')), false);
  assert.match(h.requests.find(request => request.options.headers.Authorization)?.options.headers.Authorization, /Token="private-token"/);
});

test('Jellyfin episode specials and music use their own structured fields and activity types', async t => {
  const episode = await fixture(t, { type: 'Episode' }); if (!episode) return;
  assert.equal(episode.reports.at(-1).media.season, 0);
  assert.equal(episode.reports.at(-1).media.episode, 2);
  assert.equal(episode.reports.at(-1).display.details, 'Example series');
  assert.match(episode.reports.at(-1).display.state, /^S00E02/);
  const song = await fixture(t, { type: 'Audio' });
  const report = song.reports.at(-1);
  assert.equal(report.media.artist, 'Example artist');
  assert.equal(report.media.album, 'Example album');
  assert.equal(report.display.state, 'Example artist');
  const intent = createPresenceIntent({ ...normalizeActivityReport(report), activityId: 'jellyfin', activityName: 'Jellyfin' });
  assert.equal(intent.type, 'listening');
  assert.equal(intent.state, 'Example artist');
  assert.equal(intent.assets.largeText, 'Example album');
});

test('Jellyfin live TV, pause, seek, and privacy settings update the current report', async t => {
  const h = await fixture(t, { type: 'TvChannel' }); if (!h) return;
  assert.equal(h.reports.at(-1).playback.live, true);
  assert.equal(h.reports.at(-1).playback.duration, undefined);
  h.snapshot.playing = false;
  h.snapshot.paused = true;
  await h.mediaEvent('pause');
  assert.equal(h.reports.at(-1).playback.state, 'paused');
  h.snapshot.currentTime = 75;
  await h.mediaEvent('seeked');
  assert.equal(h.reports.at(-1).playback.position, 75);
  await h.changeSettings({ privacyMode: true });
  assert.equal(h.reports.at(-1).media.title, 'Watching live TV');
  assert.equal(h.reports.at(-1).playback.position, undefined);
  assert.equal(h.reports.at(-1).buttons, undefined);
});

test('Jellyfin ignores timeupdate storms and clears immediately when a media category is hidden', async t => {
  const h = await fixture(t); if (!h) return;
  const before = h.reports.length;
  for (let i = 0; i < 40; i += 1) await h.mediaEvent('timeupdate');
  for (let i = 0; i < 40; i += 1) await h.mediaEvent('media-elements-changed');
  assert.equal(h.reports.length, before);
  await h.changeSettings({ showMovies: false });
  assert.ok(h.clears > 0);
});

test('Jellyfin requires positive server identity before making authenticated metadata requests', async t => {
  const h = await fixture(t, { product: 'Another media server' }); if (!h) return;
  assert.equal(h.reports.length, 0);
  assert.ok(h.clears > 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.headers.Authorization, undefined);
  await h.tick();
  assert.equal(h.requests.length, 1, 'negative identification is cached rather than continuously probed');
});

test('Jellyfin picks only the current device and user session when media URLs use blobs', async t => {
  const sessions = [
    { DeviceId: 'other-device', UserId: 'user001', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'wrong001' } },
    { DeviceId: 'device001', UserId: 'other-user', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'wrong002' } },
    { DeviceId: 'device001', UserId: 'user001', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'item001' } },
  ];
  const h = await fixture(t, { sourceId: false, sessions }); if (!h) return;
  assert.equal(h.reports.at(-1).media.title, 'Example title');
  assert.equal(h.requests.some(request => /wrong00/.test(request.url)), false);
  const remote = await fixture(t, { sourceId: false, sessions: sessions.slice(0, 2) });
  assert.equal(remote.reports.length, 0);
  assert.ok(remote.clears > 0);
});

test('Jellyfin reads the approved server login through the page bridge when isolated storage is unavailable', async t => {
  const sessions = [{ DeviceId: 'device001', UserId: 'user001', Client: 'Jellyfin Web', NowPlayingItem: { Id: 'item001' } }];
  const h = await fixture(t, { storageBlocked: true, sourceId: false, type: 'Episode', sessions }); if (!h) return;
  assert.equal(h.reports.at(-1)?.kind, 'episode');
  assert.equal(h.reports.at(-1)?.media.series, 'Example series');
  assert.ok(h.requests.some(request => new URL(request.url).pathname.endsWith('/Sessions')));
  h.storage.set('jellyfin_credentials', JSON.stringify({ Servers: [{ Id: 'different-server', UserId: 'user001', AccessToken: 'wrong-token' }] }));
  await h.tick();
  assert.ok(h.clears > 0);
  assert.equal(JSON.stringify(h.requests).includes('wrong-token'), false);
  assert.equal(JSON.stringify(h.logs).includes('private-token'), false);
});

test('Jellyfin reports a missing client identity once rather than clearing silently', async t => {
  const h = await fixture(t); if (!h) return;
  h.storage.delete('_deviceId2');
  await h.tick();
  assert.equal(h.logs.at(-1)?.[1].reason, 'client_identity_unavailable');
  const count = h.logs.length;
  await h.tick();
  assert.equal(h.logs.length, count);
});

test('Jellyfin accepts a current page client with a string app name and checks its server address', async t => {
  const pageApi = { appName: 'Jellyfin%20Web', serverAddress: () => 'http://localhost:8096/jellyfin',
    accessToken: () => 'page-login-token', getCurrentUserId: () => 'user001', deviceId: () => 'device001' };
  const h = await fixture(t, { pageApi }); if (!h) return;
  h.storage.delete('jellyfin_credentials');
  await h.tick();
  assert.match(h.requests.findLast(request => request.url.startsWith(h.base)).options.headers.Authorization, /Token="page-login-token"/);
  pageApi.serverAddress = () => 'http://another-server:8096';
  await h.tick();
  assert.ok(h.clears > 0);
});

test('Jellyfin browsing uses foreground presence and never starts remote playback detection', async t => {
  const h = await fixture(t, { player: false }); if (!h) return;
  await h.navigate('#/home');
  assert.equal(h.reports.at(-1).kind, 'generic');
  assert.equal(h.reports.at(-1).focusPolicy, 'foreground');
  assert.equal(h.reports.at(-1).media.title, 'Home');
  await h.navigate('#/music?topParentId=music-library');
  assert.equal(h.reports.at(-1).media.title, 'Music');
  assert.equal(h.requests.some(request => request.url.includes('/Sessions')), false);
  await h.changeSettings({ showBrowsing: false });
  assert.ok(h.clears > 0);
});

test('Jellyfin does not reuse another server’s credentials or continue requests after teardown', async t => {
  const h = await fixture(t); if (!h) return;
  h.storage.set('jellyfin_credentials', JSON.stringify({ Servers: [{ Id: 'different-server', AccessToken: 'wrong-token', UserId: 'user001' }] }));
  await h.tick();
  assert.ok(h.clears > 0);
  assert.equal(h.requests.some(request => JSON.stringify(request).includes('wrong-token')), false);
  h.signal.aborted = true;
  const before = h.requests.length;
  await h.tick();
  assert.equal(h.requests.length, before);
});

const RELEASE = '76df3287-6cda-33eb-8e9a-044b5e15ffdd';
const LOGO = 'https://raw.githubusercontent.com/jellyfin/jellyfin-ux/master/branding/web/icon-transparent.png';

function uploadStub(response = 'https://litter.catbox.moe/abc123.jpg') {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('http://localhost:8096/')) {
      return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x80])]), { headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response(response, { status: 200 });
  };
  return { calls, fetch };
}

test('Jellyfin music uses the album’s Cover Art Archive front cover without uploading', async t => {
  const album = { Id: 'album001', Name: 'Example album', Type: 'MusicAlbum', ProviderIds: { MusicBrainzAlbum: RELEASE.toUpperCase() } };
  const stub = uploadStub();
  const h = await fixture(t, { type: 'Audio', album, musicBrainz: { [RELEASE]: true }, pageFetch: stub.fetch }); if (!h) return;
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, `https://coverartarchive.org/release/${RELEASE}/front-500`);
  const lookup = h.requests.find(request => request.url.startsWith('https://musicbrainz.org/'));
  assert.equal(lookup.url, `https://musicbrainz.org/ws/2/release/${RELEASE}?fmt=json`);
  assert.equal(lookup.options.headers, undefined, 'MusicBrainz never receives the Jellyfin login');
  assert.equal(stub.calls.length, 0, 'upload is off by default');
  const lookups = h.requests.length;
  await h.tick();
  assert.equal(h.requests.length, lookups, 'cover lookups are cached');
});

test('Jellyfin keeps the logo when MusicBrainz has no front cover and upload is off', async t => {
  const h = await fixture(t, { type: 'Audio', itemFields: { ProviderIds: { MusicBrainzAlbum: RELEASE } }, musicBrainz: { [RELEASE]: false } }); if (!h) return;
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, LOGO);
  const movie = await fixture(t, { itemFields: { ImageTags: { Primary: 'tag001' } } });
  await movie.settle();
  assert.equal(movie.reports.at(-1).artwork.large, LOGO);
  assert.equal(movie.requests.some(request => request.url.includes('musicbrainz')), false);
});

test('Jellyfin opt-in upload sends only the token-free server image and reuses the link', async t => {
  const stub = uploadStub();
  const h = await fixture(t, { type: 'Audio', settings: { uploadServerArtwork: true }, pageFetch: stub.fetch,
    itemFields: { AlbumPrimaryImageTag: 'albumtag01' } }); if (!h) return;
  assert.equal(h.reports[0].artwork.large, LOGO, 'presence is published before the upload finishes');
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, 'https://litter.catbox.moe/abc123.jpg');
  assert.equal(stub.calls.length, 2);
  const image = new URL(stub.calls[0].url);
  assert.equal(image.pathname, '/jellyfin/Items/album001/Images/Primary');
  assert.equal(image.searchParams.get('tag'), 'albumtag01');
  assert.equal(JSON.stringify(stub.calls).includes('private-token'), false);
  assert.equal(stub.calls[0].options.headers, undefined);
  const upload = stub.calls[1];
  assert.equal(upload.url, 'https://litterbox.catbox.moe/resources/internals/api.php');
  assert.equal(upload.options.method, 'POST');
  assert.equal(upload.options.credentials, 'omit');
  assert.equal(upload.options.body.get('time'), '24h');
  assert.equal(upload.options.body.get('reqtype'), 'fileupload');
  assert.deepEqual([...upload.options.body.keys()].sort(), ['fileToUpload', 'reqtype', 'time']);
  await h.tick();
  await h.settle();
  assert.equal(stub.calls.length, 2, 'the uploaded link is reused');
  await h.changeSettings({ privacyMode: true });
  assert.equal(h.reports.at(-1).artwork.large, LOGO);
});

test('Jellyfin rejects unexpected upload responses and never uploads while browsing', async t => {
  const stub = uploadStub('https://evil.example/abc.jpg');
  const h = await fixture(t, { settings: { uploadServerArtwork: true }, pageFetch: stub.fetch,
    itemFields: { ImageTags: { Primary: 'movietag1' } } }); if (!h) return;
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, LOGO);
  const browsing = uploadStub();
  const b = await fixture(t, { player: false, settings: { uploadServerArtwork: true }, pageFetch: browsing.fetch,
    itemFields: { ImageTags: { Primary: 'movietag1' } } });
  await b.navigate('#/details?id=item001');
  await b.settle();
  assert.equal(b.reports.at(-1).media.title, 'Example title');
  assert.equal(b.reports.at(-1).artwork.large, LOGO);
  assert.equal(browsing.calls.length, 0);
});

test('Jellyfin links posters directly first on HTTPS servers with a public domain or public IP', async t => {
  const poster = { ImageTags: { Primary: 'movietag1' } };
  const h = await fixture(t, { base: 'https://media.example.org/jellyfin/', itemFields: poster }); if (!h) return;
  assert.equal(h.reports.at(-1).artwork.large,
    'https://media.example.org/jellyfin/Items/item001/Images/Primary?tag=movietag1&maxWidth=512&maxHeight=512&quality=90');
  assert.equal(h.reports.at(-1).artwork.large.includes('private-token'), false);
  const cases = {
    'https://93.184.216.34:8920/': true, 'https://[2606:4700::1111]:8920/': true,
    'http://media.example.org/': false, 'https://192.168.1.153:8920/': false, 'https://10.0.0.2/': false,
    'https://100.100.1.1/': false, 'https://172.20.0.5/': false, 'https://127.0.0.1/': false, 'https://[fd00::1]/': false,
    'https://jellyfin.home.arpa/': false, 'https://jellyfin.lan/': false, 'https://box.tail1234.ts.net/': false, 'https://jellyfin/': false,
  };
  for (const [base, direct] of Object.entries(cases)) {
    const server = await fixture(t, { base, itemFields: poster });
    assert.equal(server.reports.at(-1).artwork.large.startsWith(`${base}Items/`), direct, base);
  }
});

test('Jellyfin falls back from a public server without a poster to MusicBrainz, and honors the logo-only toggle', async t => {
  const base = 'https://media.example.org/';
  const fields = { ProviderIds: { MusicBrainzAlbum: RELEASE } };
  const h = await fixture(t, { base, type: 'Audio', itemFields: fields, musicBrainz: { [RELEASE]: true } }); if (!h) return;
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, `https://coverartarchive.org/release/${RELEASE}/front-500`);
  await h.changeSettings({ jellyfinLogoOnly: true });
  assert.equal(h.reports.at(-1).artwork.large, LOGO);
  const off = await fixture(t, { base, settings: { shareServerArtwork: false }, itemFields: { ImageTags: { Primary: 'movietag1' } } });
  assert.equal(off.reports.at(-1).artwork.large, LOGO);
  const stub = uploadStub();
  const logoOnly = await fixture(t, { type: 'Audio', settings: { jellyfinLogoOnly: true, uploadServerArtwork: true }, pageFetch: stub.fetch,
    itemFields: { ...fields, AlbumPrimaryImageTag: 'albumtag01' }, musicBrainz: { [RELEASE]: true } });
  await logoOnly.settle();
  assert.equal(logoOnly.reports.at(-1).artwork.large, LOGO);
  assert.equal(stub.calls.length, 0);
  assert.equal(logoOnly.requests.some(request => request.url.includes('musicbrainz')), false);
});

const TMDB_KEY = 'a46c50a0ccb1bafe2b15665df7fad7e1';
const tmdbRequests = h => h.requests.filter(request => request.url.startsWith('https://api.themoviedb.org/'));

test('Jellyfin movies use the TMDB poster from the stored TMDB ID without uploading', async t => {
  const stub = uploadStub();
  const h = await fixture(t, { itemFields: { ProviderIds: { Tmdb: '603', Imdb: 'tt0133093' } }, pageFetch: stub.fetch,
    tmdb: { 'movie/603': { id: 603, poster_path: '/poster603.jpg', backdrop_path: '/backdrop603.jpg' } } }); if (!h) return;
  assert.equal(h.reports[0].artwork.large, LOGO, 'presence is published before the lookup finishes');
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/poster603.jpg');
  const [lookup, ...rest] = tmdbRequests(h);
  const url = new URL(lookup.url);
  assert.equal(url.pathname, '/3/movie/603');
  assert.equal(url.searchParams.get('api_key'), TMDB_KEY);
  assert.equal(url.searchParams.get('language'), 'en-US');
  assert.equal(lookup.options.headers, undefined, 'TMDB never receives the Jellyfin login');
  assert.equal(lookup.url.includes('private-token'), false);
  assert.equal(rest.length, 0, 'a stored TMDB ID needs no find lookup');
  assert.equal(stub.calls.length, 0);
  await h.tick();
  assert.equal(tmdbRequests(h).length, 1, 'poster lookups are cached');
  await h.changeSettings({ privacyMode: true });
  assert.equal(h.reports.at(-1).artwork.large, LOGO);
});

test('Jellyfin episodes and seasons use their series TMDB poster, never the episode’s own ID', async t => {
  const series = { Id: 'series001', Name: 'Example series', Type: 'Series', ProviderIds: { Tmdb: '1399', Tvdb: '121361' } };
  const tmdb = { 'tv/1399': { id: 1399, poster_path: '/series1399.jpg' } };
  const h = await fixture(t, { type: 'Episode', series, tmdb, itemFields: { ProviderIds: { Tmdb: '63056' } } }); if (!h) return;
  await h.settle();
  assert.equal(h.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/series1399.jpg');
  assert.deepEqual(tmdbRequests(h).map(request => new URL(request.url).pathname), ['/3/tv/1399']);
  const season = await fixture(t, { type: 'Season', player: false, series, tmdb });
  await season.navigate('#/details?id=item001');
  await season.settle();
  assert.equal(season.reports.at(-1).kind, 'generic');
  assert.equal(season.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/series1399.jpg', 'browsing may use TMDB posters');
});

test('Jellyfin converts stored IMDb or TVDB IDs through TMDB find and rejects mismatched or unsafe results', async t => {
  const movie = await fixture(t, { tmdb: { 'find/tt12345': { movie_results: [{ id: 11, poster_path: '/found11.jpg' }], tv_results: [{ id: 12, poster_path: '/wrong.jpg' }] } } }); if (!movie) return;
  await movie.settle();
  assert.equal(movie.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/found11.jpg');
  assert.equal(new URL(tmdbRequests(movie)[0].url).searchParams.get('external_source'), 'imdb_id');
  const series = { Id: 'series001', Name: 'Example series', Type: 'Series', ProviderIds: { Tvdb: '81189', Imdb: 'tt0903747' } };
  const episode = await fixture(t, { type: 'Episode', series,
    tmdb: { 'find/81189': { movie_results: [{ id: 21, poster_path: '/wrong.jpg' }], tv_results: [{ id: 22, poster_path: '/found22.jpg' }] } } });
  await episode.settle();
  assert.equal(episode.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/found22.jpg');
  assert.equal(new URL(tmdbRequests(episode)[0].url).searchParams.get('external_source'), 'tvdb_id');
  const mismatched = await fixture(t, { itemFields: { ProviderIds: { Tmdb: '603' } }, tmdb: { 'movie/603': { id: 604, poster_path: '/other.jpg' } } });
  await mismatched.settle();
  assert.equal(mismatched.reports.at(-1).artwork.large, LOGO);
  const unsafe = await fixture(t, { itemFields: { ProviderIds: { Tmdb: '603' } },
    tmdb: { 'movie/603': { id: 603, poster_path: 'https://evil.example/x.jpg', backdrop_path: '/../x.jpg' } } });
  await unsafe.settle();
  assert.equal(unsafe.reports.at(-1).artwork.large, LOGO);
  const invalid = await fixture(t, { itemFields: { ProviderIds: { Tmdb: '603/../1', Imdb: 'not-an-id' } } });
  await invalid.settle();
  assert.equal(tmdbRequests(invalid).length, 0);
  const live = await fixture(t, { type: 'TvChannel', itemFields: { ProviderIds: { Tmdb: '603' } } });
  await live.settle();
  assert.equal(tmdbRequests(live).length, 0, 'only movies and shows use TMDB');
});

test('Jellyfin prefers public server posters over TMDB, and TMDB over the opt-in upload', async t => {
  const tmdb = { 'movie/603': { id: 603, poster_path: '/poster603.jpg' } };
  const ids = { ProviderIds: { Tmdb: '603' } };
  const h = await fixture(t, { base: 'https://media.example.org/', itemFields: { ...ids, ImageTags: { Primary: 'movietag1' } }, tmdb }); if (!h) return;
  await h.settle();
  assert.match(h.reports.at(-1).artwork.large, /^https:\/\/media\.example\.org\/Items\/item001\/Images\/Primary/);
  assert.equal(tmdbRequests(h).length, 0);
  const noPoster = await fixture(t, { base: 'https://media.example.org/', itemFields: ids, tmdb });
  await noPoster.settle();
  assert.equal(noPoster.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/poster603.jpg');
  const stub = uploadStub();
  const upload = await fixture(t, { settings: { uploadServerArtwork: true }, pageFetch: stub.fetch,
    itemFields: { ...ids, ImageTags: { Primary: 'movietag1' } }, tmdb });
  await upload.settle();
  assert.equal(upload.reports.at(-1).artwork.large, 'https://image.tmdb.org/t/p/w500/poster603.jpg');
  assert.equal(stub.calls.length, 0, 'a TMDB poster makes the upload unnecessary');
  const logoOnly = await fixture(t, { settings: { jellyfinLogoOnly: true }, itemFields: ids, tmdb });
  await logoOnly.settle();
  assert.equal(logoOnly.reports.at(-1).artwork.large, LOGO);
  assert.equal(tmdbRequests(logoOnly).length, 0);
});
