import type { ActivityV2Configuration, ActivityV2Metadata } from '@chudpresence/activity-sdk-v2/types';

export const metadata: ActivityV2Metadata = {
  id: 'typecheck-sample',
  name: 'Typecheck sample',
  description: 'Checks the generated V2 metadata declarations.',
  version: '1.0.0',
  apiVersion: 2,
  matches: ['https://example.com/*'],
  entry: 'activity.json',
};

export const configuration: ActivityV2Configuration = {
  schemaVersion: 1,
  kind: 'video',
  scope: '#player',
  fields: { title: { source: 'dom.text', selectors: ['.media-title'] } },
  player: { adapter: 'html-media', selectors: ['video'] },
};

export const pageConfiguration: ActivityV2Configuration = {
  schemaVersion: 1, kind: 'generic', scope: '#main',
  fields: { title: { source: 'url.query', parameter: 'q' } },
  page: { elapsed: true, routes: [{ id: 'search', paths: ['/search'],
    query: { udm: [''] }, requiredQuery: ['q'], name: 'Example Search', details: 'Searching for : {title}' }] },
};

export const browsingConfiguration: ActivityV2Configuration = {
  schemaVersion: 1, kind: 'generic', scope: '#main',
  fields: { title: { source: 'dom.text', selectors: ['h1'] } },
  page: { elapsed: true, routes: [
    { id: 'home', paths: ['/'], query: {}, requiredQuery: [], name: 'Example', title: 'Example', scope: '#landing', details: 'Browsing Example' },
    { id: 'item', paths: ['/items/{number}/{segment}'], query: {}, requiredQuery: [], name: 'Example', details: 'Viewing: {title}' },
  ] },
};

export const genericConfiguration: ActivityV2Configuration = {
  schemaVersion: 2, kind: 'episode', scope: '[data-player="main"]',
  fields: {
    title: { source: 'dom.text', selectors: ['[data-title="current"]'], split: { separator: ' • ', index: 1 }, fallback: 'Watching episode' },
    season: { source: 'dom.text', selectors: ['.season'], removePrefix: 'Season ', parse: 'integer' },
    episode: { source: 'constant', value: 3 },
  },
  player: { adapter: 'dom-media', selectors: ['canvas'], elapsed: true,
    state: { selectors: ['[role="button"]'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] } },
  presentation: { details: '{title}', state: 'Season {season}, Episode {episode}',
    buttons: [{ label: 'Visit Example', url: 'https://example.com/' }] },
  lookup: { service: 'movie-title', input: { title: 'title' } },
};

export const multiLayoutConfiguration: ActivityV2Configuration = {
  schemaVersion: 2, kind: 'video', scope: '.card', paths: ['/watch/{number}'],
  fields: {
    title: { source: 'dom.text', selectors: ['.caption'], ignoreEmptyBreaks: true, maxDescendants: 64 },
    creator: { source: 'first', rules: [
      { source: 'dom.text', selectors: ['.handle'], parse: 'handle' },
      { source: 'public-path', selectors: ['.creator a'], paths: ['/{handle}'], segment: 0, pageFallback: true },
    ] },
  }, requiredFields: ['creator'],
  player: { adapter: 'html-media', selectors: ['video'], selection: 'largest-visible', canvasSelector: 'canvas', canvasContainer: '.renderer' },
  links: { media: { paths: ['/watch/{number}'], sources: [{ source: 'page' }] } },
  presentation: { details: '{title}', state: '{creator}', buttons: [{ label: 'View video', link: 'media' }] },
  modes: [{ id: 'live', paths: ['/live/{number}'], kind: 'stream', scope: '.room',
    container: { ancestors: 1, required: ['.header'], exclude: ['#app'] },
    fields: { title: { source: 'dom.text', selectors: ['.title'], opacityAncestor: '.fade', fallback: 'Live' } },
    player: { adapter: 'html-media', selectors: ['video'], live: true, elapsed: true },
    pageIdentity: { paths: ['/live/{number}'], playerId: { selector: '.renderer', split: { separator: '-', index: 2 }, prefixes: ['video-player-'], parts: 3 }, segment: 1 },
    presentation: { details: 'Watching Live', liveInDetails: true } }],
};

export const singlePlayerConfiguration: ActivityV2Configuration = {
  schemaVersion: 2, kind: 'video', scope: 'video', paths: ['/watch/{segment}/'],
  container: { ancestors: 16, singlePlayer: true, required: ['.creator a'], exclude: ['[id^="mount_"]'] },
  fields: { title: { source: 'dom.text', selectors: ['[dir="auto"]'] }, creator: { source: 'public-path', selectors: ['.creator a'], paths: ['/{segment}/'], segment: 0, matchText: true } },
  player: { adapter: 'html-media', selectors: ['video'], selection: 'largest-visible' },
  links: { media: { paths: ['/watch/{segment}/'], sources: [{ source: 'page' }] } },
  pageIdentity: { paths: ['/watch/{segment}/'], links: { media: 1 } },
};

// @ts-expect-error Schema 1 cannot enable schema 2 presentation.
const legacyPresentation: ActivityV2Configuration = { ...configuration, presentation: { details: '{title}' } };
// @ts-expect-error Native playback cannot supply DOM control state.
const nativeDomState: ActivityV2Configuration = { ...genericConfiguration, player: { adapter: 'html-media', selectors: ['video'], state: { selectors: ['.button'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] } } };
// @ts-expect-error Elapsed session timing cannot also declare DOM position.
const mixedTiming: ActivityV2Configuration = { ...genericConfiguration, player: { adapter: 'dom-media', selectors: ['canvas'], elapsed: true, state: { selectors: ['.button'], attribute: 'aria-label', playing: ['Pause'], paused: ['Play'] }, position: { source: 'dom.text', selectors: ['.time'], parse: 'clock' } } };

// @ts-expect-error A page configuration cannot also execute a media adapter.
const mixedConfiguration: ActivityV2Configuration = { ...pageConfiguration, player: { adapter: 'html-media', selectors: ['video'] } };

// V1 packages and executable sources cannot be represented by the V2 types.
// @ts-expect-error V2 metadata requires apiVersion 2.
const executableApi: ActivityV2Metadata['apiVersion'] = 1;
// @ts-expect-error V2 has a fixed JSON entry point.
const executableEntry: ActivityV2Metadata['entry'] = 'activity.js';
// @ts-expect-error Only bundled player adapters are supported.
const customAdapter: NonNullable<ActivityV2Configuration['player']>['adapter'] = 'custom-script';
void [executableApi, executableEntry, customAdapter, mixedConfiguration, legacyPresentation, nativeDomState, mixedTiming];
