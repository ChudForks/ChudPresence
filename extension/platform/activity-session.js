// Chromium keeps its existing worker restoration behavior. Firefox overlays this
// module to retain transient report ownership across event-page suspension.
export async function restoreActivitySession() {}
export async function saveActivitySession() {}
