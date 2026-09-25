# Release Checklist

Status: **prerelease / beta-ready** as of 2026-07-09.
Hard external gate for a true **1.0 stable**: Effect 4 stable (currently
`effect 4.0.0-rc.117`, an exact peer dependency). Until then ship prerelease tags only.

Authority: `docs/V1_SCOPE.md` (ships vs deferred).

## Quality Gates

- [x] `npm run typecheck:all` passes (main + tests + examples)
- [x] `npm test` passes (full suite, including TodoMVC integration)
- [x] `npm run build` passes
- [x] `npm run check` equivalent: typecheck:all + test green
- [x] Package entry smoke: main / jsx-runtime / runtime / testing / CLI

## API and Docs

- [x] Public API exports match intended surface in `src/index.ts` + `package.json` `exports` / `bin`
- [x] `README.md` reflects current API (callable atoms, `defineQuery` /
  `defineMutation`, `Component`, slots golden path, `render` top-level)
- [x] Live docs index and focused guides (`docs/README.md`, `component.md`,
  `view.md`, `style.md`, `router.md`) describe the current API rather than
  historical notes
- [x] Breaking redesign track recorded in `CHANGELOG.md` Unreleased section
- [x] Effect version compatibility documented (beta peer; prerelease class)

## Runtime and Behavior

- [x] `defineQuery` / `defineMutation` / `Atom.action` behavior validated by tests
- [x] Unified `Result` (`Loading` / `Refreshing` / `Success` / `Failure` /
  `Stale` / `Defect`) is the primary async model
- [x] P13 boundary: optional `Atom.action(..., { inputSchema })` validates
  inputs before effect / single-flight transport
- [x] Optimistic + refresh settlement covered by `todomvc.integration.test.ts`
  with poll-until-settled (not fixed-tick only)

## Packaging

- [x] `package.json` version on prerelease line (`0.6.0`)
- [x] `main` / `types` / `exports` / `bin` verified
- [x] Build outputs under `dist/` (clean build)
- [x] Lockfile committed
- [x] `npm pack --dry-run` includes `dist/` + intended docs (not src-only)

## Final Verification

- [x] Changelog / unreleased notes prepared for redesign track
- [x] Example typecheck gate green (`typecheck:examples`)
- [x] Integration suite `src/__tests__/todomvc.integration.test.ts` passing
- [ ] Release started (Actions → Release → Run workflow, or a pushed tag)
- [ ] Wait for Effect 4 stable before cutting `1.0.0` (not `0.x` prerelease)

## Latest Validation Snapshot (2026-07-09)

Re-run and capture under the release evidence scratch before cutting a tag:

| Gate | Expected |
| --- | --- |
| `npm run typecheck:all` | exit 0 |
| `npm test -- --run` (×2) | exit 0 both; TodoMVC not flaky |
| `npm run build` | exit 0; `dist/index.js`, `jsx-runtime.js`, `runtime.js`, `testing.js`, `cli.js` present |
| Import smoke (built main) | non-empty exports incl. `Result` / `Atom` / `render` |
| `node dist/cli.js --help` | doctor usage text |
| `npm pack --dry-run` | tarball includes `dist/` + docs |

### Effect compatibility

- Peer: exactly `effect 4.0.0-rc.117` (also the dev dependency). Effect is a
  peer only, so an app never installs a second copy.
- Release class while Effect remains a prerelease (beta or RC): **0.x prerelease / beta**
- `1.0.0` stable requires Effect 4 stable pin + this checklist re-run

### TypeScript toolchain

- `devDependencies.typescript`: **^7.0.2** (TypeScript 7)
- Gates: `npm run typecheck:all` / `build` use that `tsc`
- TS7 config notes: no `baseUrl` (use relative `paths`); `types: ["node"]`
  for CLI; Route title/meta attach impl avoids deep instantiation

### Intentionally deferred (not release blockers for prerelease)

Shipped in-tree (backlog closed 2026-07-09): P9 `Form`, P11 Devtools/MCP
session MVP, P12 gated streams + `Component.subscription`, D3 `create-affe` (was `create-af-ui`).

Still deferred depth: multi-renderer (TUI/RN), package split execution (P7
stays single package), full browser Devtools panel chrome, WAI-ARIA
certification theater. See `docs/V1_SCOPE.md` Deferred.

## How to release

1. On `main`, with CI green, run `npm run set-version -- <version>` (it sets
   the core and every package that releases with it: `create-affe`,
   `affe-ui-agent`, `affe-css`, `affe-permissive`), then `npm install`, and
   move the `CHANGELOG.md` "Unreleased" entries under the new version heading.
2. Run locally: `npm run build && npm run build:packages &&
   npm run typecheck:all && npm test && npm run verify:package` (and `npm run test:browser` if Chromium is
   available). `verify:package` installs the packed tarball into a throwaway
   project, imports every subpath, and type-checks a golden-path file against
   the shipped types.
3. Merge to `main`, then start the release: **Actions → Release → Run
   workflow** with the version (`0.6.0`), or push the tag yourself
   (`git tag -a v<version> -m "Affe <version>" && git push origin v<version>`).
   `.github/workflows/release.yml` re-runs the gates, publishes
   `@doeixd/affe`, then `@doeixd/create-affe`, `@doeixd/affe-ui-agent`,
   `@doeixd/affe-css` and `@doeixd/affe-permissive` with npm provenance,
   creates the `v<version>` tag when it was started by hand, and creates the
   GitHub release with that version's CHANGELOG section as its notes.
   Versions containing a hyphen (`0.7.0-rc.1`) publish under the `next`
   dist-tag and become a prerelease. A package already on npm at that
   version is skipped, so a run that failed partway can be run again. The
   workflow needs the `NPM_TOKEN` repository secret.
4. Leave the old `effect-atom-jsx` package on npm untouched: do not publish
   to it or deprecate it.
