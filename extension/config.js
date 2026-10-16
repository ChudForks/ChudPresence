// Discord application identities are intentionally part of this extension build.
// Application IDs are public identifiers, not client secrets.
export const DISCORD_CLIENT_ID = '1549066134706323548';
// Derive the callback from this unpacked install's extension ID. OAuth
// must remain disabled until this callback is registered with the Discord app.
export function discordRedirectUrl(identity = (globalThis.browser || globalThis.chrome)?.identity) {
  if (typeof identity?.getRedirectURL !== 'function') {
    throw new Error('The browser identity API is unavailable.');
  }
  // Firefox derives a complete identity callback and accepts no path argument.
  return typeof globalThis.browser?.runtime?.getBrowserInfo === 'function'
    ? identity.getRedirectURL() : identity.getRedirectURL('discord');
}
