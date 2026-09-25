// A URL-only tab update can be a History API change in the same document.
// Clear the old presence while loading, but do not assume a new document:
// Hulu also emits loading updates during same-document episode transitions.
export function shouldInvalidateActivityTab(changeInfo) {
  return changeInfo?.discarded === true || changeInfo?.status === 'loading';
}

export function shouldRetireActivityTab(changeInfo) {
  return changeInfo?.discarded === true;
}
