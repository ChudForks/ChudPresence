// User-approved server locations are installation data, never downloaded package
// metadata. Browser host permissions ignore ports; every runtime entry point also
// checks the exact origin and base path below.
export function hasConfiguredSiteAccess(metadata) {
  return metadata?.apiVersion === 1 && metadata.siteAccess === 'user-configured';
}

export function normalizeActivitySite(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new TypeError('Enter a server URL up to 256 characters.');
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw new TypeError('Enter a complete HTTP or HTTPS server URL.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || !host || host.includes('*') || url.username || url.password ||
      ['discord.com', 'discordapp.com', 'discordapp.net'].some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw new TypeError('Use an HTTP or HTTPS server URL without credentials. Discord sites are reserved.');
  }
  if (url.search || url.hash || /[*\\]|%(?:2f|5c|2e)/i.test(url.pathname) ||
      !/^[-a-z0-9_ .%!$&'()+,;=:@/]*$/i.test(decodeURI(url.pathname))) {
    throw new TypeError('Enter the server base URL without query parameters, fragments, or wildcards.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  if (url.href.length > 256) throw new TypeError('The normalized server URL must fit within 256 characters.');
  return url.href;
}

export function activitySiteFromPage(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  const web = url.pathname.match(/^(.*?)\/web(?:\/|$)/i);
  if (web) url.pathname = web[1] + '/';
  else if (/\/index\.html$/i.test(url.pathname)) url.pathname = url.pathname.replace(/index\.html$/i, '');
  else if (url.pathname !== '/') throw new TypeError('Open Jellyfin Web, or add its server base URL in Activity Library.');
  return normalizeActivitySite(url.href);
}

export function normalizeActivitySites(values) {
  if (!Array.isArray(values) || values.length > 16) throw new TypeError('An Activity can use up to 16 server addresses.');
  return [...new Set(values.map(normalizeActivitySite))];
}

export function configuredActivitySites(record) {
  if (!hasConfiguredSiteAccess(record?.metadata)) return [];
  try { return normalizeActivitySites(record.sites || []); } catch { return []; }
}

export function activitySitePattern(site) {
  const url = new URL(normalizeActivitySite(site));
  return `${url.protocol}//${url.hostname}${url.pathname}*`;
}

// Keep this self-contained: it is also embedded in the V1 user script.
export function activitySiteMatches(site, value) {
  try {
    const base = new URL(site);
    const url = new URL(value);
    if (url.username || url.password || url.origin !== base.origin || /%(?:2f|5c|2e)/i.test(url.pathname)) return false;
    return url.pathname.startsWith(base.pathname) || url.pathname === base.pathname.slice(0, -1);
  } catch { return false; }
}

export function activityMatchPatterns(record) {
  return hasConfiguredSiteAccess(record?.metadata)
    ? [...new Set(configuredActivitySites(record).map(activitySitePattern))]
    : [...(Array.isArray(record?.metadata?.matches) ? record.metadata.matches : [])];
}

export function activityPermissionPatterns(record) {
  return [...activityMatchPatterns(record), ...(Array.isArray(record?.metadata?.network) ? record.metadata.network : [])];
}
