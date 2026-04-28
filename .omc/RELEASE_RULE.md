# Release Rules
<!-- last-analyzed: 2026-04-28T00:00:00Z -->

## Version Sources
- `package.json` — `version` field (primary)
- `manifest.json` — synced via `npm version` hook → `scripts/sync-version.js`
- `versions.json` — map of `"<plugin-version>": "<minAppVersion>"`, must be updated manually

## Release Trigger
Tag push (any tag, e.g. `v1.4.33`) triggers `.github/workflows/release.yml`.
Builds, then creates a GitHub Release with `main.js`, `manifest.json`, `styles.css` as assets.

## Test Gate
`npm run test` locally before release. CI does not run tests in the release workflow (build only).

## Registry / Distribution
GitHub Release (not npm/PyPI). Assets: `main.js`, `manifest.json`, `styles.css`.

## Release Notes Strategy
CI auto-generates changelog from `git log <prev-tag>..HEAD`. No CHANGELOG.md convention.
Commit message format: `release: vX.Y.Z — short description`

## CI Workflow Files
- `.github/workflows/release.yml` — tag-triggered build + GitHub Release

## First-Time Setup Gaps
none
