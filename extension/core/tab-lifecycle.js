// Loading alone does not prove the reporting document has gone away. Let its
// lifecycle clear it, or let a replacement document retire it on its report.
export function shouldInvalidateActivityTab(changeInfo) {
  return changeInfo?.discarded === true;
}

export function shouldRetireActivityTab(changeInfo) {
  return changeInfo?.discarded === true;
}
