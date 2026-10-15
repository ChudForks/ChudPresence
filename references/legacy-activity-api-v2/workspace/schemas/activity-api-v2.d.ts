// Generated from activity-api-v2.json. No executable Activity API is exposed.
export type ActivityV2Metadata = {
  "id": string;
  "name": string;
  "description": string;
  "version": string;
  "apiVersion": 2;
  "minExtensionVersion"?: string;
  "author"?: {
  "name": string;
  "url"?: string;
};
  "contributors"?: Array<{
  "name": string;
  "url"?: string;
}>;
  "category"?: string;
  "defaultMediaKind"?: "video" | "movie" | "episode" | "song" | "stream" | "game" | "generic";
  "aliases"?: Array<string>;
  "tags"?: Array<string>;
  "matches": Array<string>;
  "excludeMatches"?: Array<string>;
  "entry": "activity.json";
  "icon"?: "icon.png";
  "frames"?: "top";
  "settingsUi"?: {
  "statusLabels"?: {
  "app"?: string;
  "artist"?: string;
  "track"?: string;
};
};
  "repository"?: string;
  "homepage"?: string;
  "serviceUrl"?: string;
};
export type ActivityV2Configuration = {
  "schemaVersion": 1;
  "kind": "video" | "movie" | "episode" | "song" | "stream" | "game" | "generic";
  "scope": string;
  "fields": {
  "title": {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "subtitle"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "artist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "album"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "series"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "creator"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "channel"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "category"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "game"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
  "playlist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
} | {
  "source": "url.query";
  "parameter": string;
};
};
  "player"?: {
  "adapter": "html-media" | "prime-video" | "tiktok" | "instagram";
  "metadata"?: "prime-video-details";
  "selectors": Array<string>;
};
  "page"?: {
  "routes": Array<{
  "id": string;
  "paths": Array<string>;
  "query": Record<string, Array<string>>;
  "requiredQuery": Array<string>;
  "name": string;
  "title"?: string;
  "scope"?: string;
  "details": string;
  "state"?: string;
}>;
  "elapsed": boolean;
  "artwork"?: {
  "large": string;
  "largeText"?: string;
  "small"?: string;
  "smallText"?: string;
};
};
} & ({
  "player": {
  "adapter": "html-media" | "prime-video" | "tiktok" | "instagram";
  "metadata"?: "prime-video-details";
  "selectors": Array<string>;
};
  "page"?: never;
} | {
  "page": {
  "routes": Array<{
  "id": string;
  "paths": Array<string>;
  "query": Record<string, Array<string>>;
  "requiredQuery": Array<string>;
  "name": string;
  "title"?: string;
  "scope"?: string;
  "details": string;
  "state"?: string;
}>;
  "elapsed": boolean;
  "artwork"?: {
  "large": string;
  "largeText"?: string;
  "small"?: string;
  "smallText"?: string;
};
};
  "kind": "generic";
  "player"?: never;
}) | {
  "schemaVersion": 2;
  "kind": "video" | "movie" | "episode" | "song" | "stream" | "game" | "generic";
  "scope": string;
  "fields": {
  "title": {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "subtitle"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "artist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "album"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "series"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "creator"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "channel"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "category"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "game"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "playlist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "season"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": number;
};
  "episode"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": number;
};
};
  "player": {
  "adapter": "html-media";
  "selectors": Array<string>;
  "selection"?: "first" | "largest-visible";
  "retainMetadata"?: boolean;
  "elapsed"?: boolean;
  "live"?: boolean;
  "allowAriaHidden"?: boolean;
  "canvasSelector"?: string;
  "canvasContainer"?: string;
} | {
  "adapter": "dom-media";
  "selectors": Array<string>;
  "selection"?: "first" | "largest-visible";
  "retainMetadata"?: boolean;
  "elapsed"?: boolean;
  "live"?: boolean;
  "state": {
  "selectors": Array<string>;
  "attribute": "aria-label";
  "playing": Array<string>;
  "paused": Array<string>;
};
  "position"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
};
  "duration"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
};
} & ({ "elapsed": true; "position"?: never; "duration"?: never; } | { "elapsed"?: false; });
  "presentation"?: {
  "details": string;
  "state"?: string;
  "artwork"?: {
  "large": string;
  "largeText"?: string;
  "small"?: string;
  "smallText"?: string;
};
  "buttons"?: Array<{
  "label": string;
  "url": string;
} | {
  "label": string;
  "link": string;
}>;
  "liveInDetails"?: boolean;
};
  "lookup"?: {
  "service": string;
  "input": Record<string, "title" | "subtitle" | "artist" | "album" | "series" | "creator" | "channel" | "category" | "game" | "playlist" | "season" | "episode">;
};
  "paths"?: Array<string>;
  "container"?: {
  "ancestors": number;
  "required": Array<string>;
  "exclude"?: Array<string>;
  "singlePlayer"?: boolean;
};
  "requiredFields"?: Array<"title" | "subtitle" | "artist" | "album" | "series" | "creator" | "channel" | "category" | "game" | "playlist" | "season" | "episode">;
  "pageIdentity"?: {
  "paths": Array<string>;
  "fields"?: Record<string, number>;
  "playerId"?: {
  "selector": string;
  "split": {
  "separator": string;
  "index": number;
};
  "prefixes"?: Array<string>;
  "parts"?: number;
};
  "segment"?: number;
  "ignoreCase"?: boolean;
  "links"?: Record<string, number>;
};
  "links"?: Record<string, {
  "paths": Array<string>;
  "matchFields"?: Record<string, number>;
  "sources": Array<{
  "source": "page";
} | {
  "source": "dom.link";
  "selectors": Array<string>;
  "opacityAncestor"?: string;
} | {
  "source": "template";
  "path": string;
  "playerId"?: {
  "selector": string;
  "split": {
  "separator": string;
  "index": number;
};
  "prefixes"?: Array<string>;
  "parts"?: number;
};
}>;
}>;
  "modes"?: Array<{
  "kind": "video" | "movie" | "episode" | "song" | "stream" | "game" | "generic";
  "scope": string;
  "fields": {
  "title": {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "subtitle"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "artist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "album"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "series"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "creator"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "channel"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "category"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "game"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "playlist"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "fallback"?: string;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": string;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
} | {
  "source": "first";
  "rules": Array<{
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "parse"?: "handle";
  "maxDescendants"?: number;
} | {
  "source": "public-path";
  "selectors": Array<string>;
  "paths": Array<string>;
  "segment": number;
  "pageFallback"?: boolean;
  "opacityAncestor"?: string;
  "matchText"?: boolean;
}>;
};
  "season"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": number;
};
  "episode"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "integer";
  "fallback"?: number;
  "opacityAncestor"?: string;
  "ignoreEmptyBreaks"?: boolean;
  "candidateIndex"?: number;
  "maxDescendants"?: number;
} | {
  "source": "constant";
  "value": number;
};
};
  "player": {
  "adapter": "html-media";
  "selectors": Array<string>;
  "selection"?: "first" | "largest-visible";
  "retainMetadata"?: boolean;
  "elapsed"?: boolean;
  "live"?: boolean;
  "allowAriaHidden"?: boolean;
  "canvasSelector"?: string;
  "canvasContainer"?: string;
} | {
  "adapter": "dom-media";
  "selectors": Array<string>;
  "selection"?: "first" | "largest-visible";
  "retainMetadata"?: boolean;
  "elapsed"?: boolean;
  "live"?: boolean;
  "state": {
  "selectors": Array<string>;
  "attribute": "aria-label";
  "playing": Array<string>;
  "paused": Array<string>;
};
  "position"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
};
  "duration"?: {
  "source": "dom.text";
  "selectors": Array<string>;
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
} | {
  "source": "dom.attribute";
  "selectors": Array<string>;
  "attribute": "title" | "aria-label" | "alt";
  "removePrefix"?: string;
  "removeSuffix"?: string;
  "split"?: {
  "separator": string;
  "index": number;
};
  "parse": "clock" | "number";
};
} & ({ "elapsed": true; "position"?: never; "duration"?: never; } | { "elapsed"?: false; });
  "presentation"?: {
  "details": string;
  "state"?: string;
  "artwork"?: {
  "large": string;
  "largeText"?: string;
  "small"?: string;
  "smallText"?: string;
};
  "buttons"?: Array<{
  "label": string;
  "url": string;
} | {
  "label": string;
  "link": string;
}>;
  "liveInDetails"?: boolean;
};
  "lookup"?: {
  "service": string;
  "input": Record<string, "title" | "subtitle" | "artist" | "album" | "series" | "creator" | "channel" | "category" | "game" | "playlist" | "season" | "episode">;
};
  "paths": Array<string>;
  "container"?: {
  "ancestors": number;
  "required": Array<string>;
  "exclude"?: Array<string>;
  "singlePlayer"?: boolean;
};
  "requiredFields"?: Array<"title" | "subtitle" | "artist" | "album" | "series" | "creator" | "channel" | "category" | "game" | "playlist" | "season" | "episode">;
  "pageIdentity"?: {
  "paths": Array<string>;
  "fields"?: Record<string, number>;
  "playerId"?: {
  "selector": string;
  "split": {
  "separator": string;
  "index": number;
};
  "prefixes"?: Array<string>;
  "parts"?: number;
};
  "segment"?: number;
  "ignoreCase"?: boolean;
  "links"?: Record<string, number>;
};
  "links"?: Record<string, {
  "paths": Array<string>;
  "matchFields"?: Record<string, number>;
  "sources": Array<{
  "source": "page";
} | {
  "source": "dom.link";
  "selectors": Array<string>;
  "opacityAncestor"?: string;
} | {
  "source": "template";
  "path": string;
  "playerId"?: {
  "selector": string;
  "split": {
  "separator": string;
  "index": number;
};
  "prefixes"?: Array<string>;
  "parts"?: number;
};
}>;
}>;
  "id": string;
}>;
};
