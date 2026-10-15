export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type PublicAttribute = 'title' | 'alt' | 'aria-label' | 'href' | 'src' | 'poster' | 'content' | 'datetime';
export type PageRead = { selector: string; all?: boolean } & (
  { read: 'text' } | { read: 'attribute'; attribute: PublicAttribute } | { read: 'json'; path: string[] }
);
export interface MediaScope { container: string; ancestors: number; exclude?: string; selectors: Record<string, Exclude<PageRead, { read: 'json' }>> }
export interface PageAccess { selectors?: Record<string, PageRead>; media?: boolean; url?: boolean; queryParameters?: string[]; mediaScopes?: Record<string, MediaScope> }
export interface ActivityV2Metadata {
  id: string; name: string; description: string; version: string; apiVersion: 2;
  matches: string[]; entry: 'activity.js'; pageAccess?: PageAccess;
  excludeMatches?: string[]; frames?: 'top' | 'all'; network?: string[];
  minExtensionVersion?: string; icon?: 'icon.png'; category?: string;
  executionWorld?: 'USER_SCRIPT'; aliases?: string[]; tags?: string[];
  author?: { name: string; url?: string }; contributors?: { name: string; url?: string }[];
  defaultMediaKind?: ActivityReport['kind']; repository?: string; homepage?: string; serviceUrl?: string;
  presence?: { kind?: 'music' | 'video' | 'streaming' | 'generic'; navigationGraceMs?: number };
  settingsUi?: { statusLabels?: { app?: string; artist?: string; track?: string } };
  settings?: (
    { id: string; type: 'boolean'; label: string; default: boolean } |
    { id: string; type: 'select'; label: string; default: string; options: { label: string; value: string }[] } |
    { id: string; type: 'string'; label: string; default: string; maxLength?: number } |
    { id: string; type: 'number' | 'range'; label: string; default: number; min: number; max: number; step?: number }
  )[];
}
export interface MediaSnapshot {
  currentTime: number; duration: number; paused: boolean; ended: boolean;
  playbackRate: number; muted: boolean; visible: boolean; poster?: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Present only with declared mediaScopes. No DOM identity or browser handles. */
  readyState?: number;
  visibleArea?: number;
  scopes?: Readonly<Record<string, { readonly reads: Readonly<Record<string, Json>>; readonly rejected: readonly string[] } | null>>;
}
export interface Snapshot {
  readonly page: { readonly origin?: string; readonly pathname?: string; readonly visibilityState?: 'visible' | 'hidden' | 'prerender'; readonly query?: Readonly<Record<string, string | null>>; readonly queryDuplicates?: readonly string[] };
  readonly reads: Readonly<Record<string, Json>>;
  readonly media: readonly MediaSnapshot[];
}
export interface ActivityReport {
  kind: 'video' | 'movie' | 'episode' | 'song' | 'stream' | 'game' | 'generic';
  media: { title: string; subtitle?: string; artist?: string; album?: string; series?: string;
    season?: number; episode?: number; creator?: string; channel?: string; category?: string; game?: string; playlist?: string };
  playback?: { state?: 'playing' | 'paused' | 'stopped'; position?: number; duration?: number; rate?: number; live?: boolean; elapsed?: boolean };
  display?: { name?: string; details?: string; state?: string; detailsUrl?: string; stateUrl?: string;
    statusDisplay?: 'name' | 'details' | 'state';
    /** Override the saved status-line preference for this report (extension 2.0.3+). */
    statusDisplayOverride?: 'name' | 'details' | 'state';
    /** Omit the second text line and its fallbacks/markers (extension 2.0.3+). */
    hideState?: boolean };
  artwork?: { large?: string; largeUrl?: string; small?: string; largeText?: string; smallText?: string };
  buttons?: { label: string; url: string }[];
  visibility?: 'normal' | 'idle' | 'private' | 'ad';
}
export interface NetworkOptions {
  method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; json?: Json;
  responseType?: 'json' | 'text'; timeoutMs?: number;
}
export interface ActivityV2API {
  readonly apiVersion: 2;
  onUpdate(callback: (snapshot: Snapshot) => void | Promise<void>): () => void;
  readonly page: { read<T extends Json = Json>(name: string): T | undefined; info(): Snapshot['page'] };
  readonly media: { getAll(): readonly MediaSnapshot[] };
  report(report: ActivityReport): Promise<{ accepted: true }>;
  clear(): Promise<{ cleared: boolean; stale: boolean }>;
  readonly settings: { get(id: string): Promise<Json | undefined>; getAll(): Promise<Record<string, Json>> };
  readonly storage: {
    get(key: string): Promise<Json | undefined>; set(key: string, value: Json): Promise<unknown>;
    remove(key: string): Promise<unknown>; clear(): Promise<unknown>;
  };
  readonly net: { fetch(url: string, options?: NetworkOptions): Promise<{ status: number; ok: boolean; contentType: string; data: Json }> };
  readonly log: { [level in 'debug' | 'info' | 'warn' | 'error']: (...args: Json[]) => Promise<unknown> };
}
declare global { const ChudPresence: ActivityV2API; }
