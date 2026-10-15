# Historical Activity API V2

The retired declarative implementation is kept locally at
`legacy-activity-api-v2/`, ignored by Git and excluded from extension builds.
It contains the five original packages, runtime, fixtures, and migration notes.
Roblox and TikTok still have no programmable V2 replacements in this workspace.

All 163 snapshot files are preserved in this repository's `v2.0.4` tag. To restore
the local snapshot in a fresh checkout, run from the repository root:

```sh
git archive v2.0.4 references/legacy-activity-api-v2 | tar -x
```

For example, inspect the old TikTok guide without restoring any files:

```sh
git show v2.0.4:references/legacy-activity-api-v2/activity-repository/activities/tiktok/README.md
```

The snapshot describes historical behavior. Use the current extension and
Activity repository API guides for development.
