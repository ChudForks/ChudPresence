# Original Chromium baseline

This is the historical pre-port baseline, not the current extension or test count. The lab is now version 1.9.0; see [README.md](README.md) for current setup and [TESTING.md](TESTING.md) for later verification. The retained zip is a local, Git-ignored artifact.

- Starting lab and original checkout commit: `3e3ff9acda7b0377e9e2bbea85c33a30c3be849c`.
- Before porting, `npm run check`, `npm test` (26 tests), and `npm run build` passed in this lab clone.
- The original 1.8.0 build zip is retained locally at `baseline/ChudPresence-Solo-1.8.0-extension.zip`.
- Microsoft Edge 153 loaded the original extension unpacked in a separate clean profile. Its `background.js` service worker appeared in DevTools under the original extension ID `lgnhpmldmgjclkkjajcaehlcggbconka`.
- The original manifest packages both `crunchyroll.js` and the all-frame `crunchyroll-player.js` probe. Live Crunchyroll playback requires a signed-in session and was not observed in the clean profile.
- The original checkout had no working-tree changes at the baseline check.
