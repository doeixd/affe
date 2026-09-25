# Contributing

Thanks for helping. Affe is a 0.x library on a release-candidate Effect, so
the API still moves; an issue before a large change saves everyone time.

## Setup

Node 22.12 or newer (CI uses 24).

```sh
git clone https://github.com/doeixd/affe.git
cd affe
npm install
npm run build
```

## The checks

Run these before opening a pull request; CI runs the same ones.

| Command | What it checks |
| --- | --- |
| `npm run typecheck:all` | Library, tests, examples and browser specs type-check. |
| `npm test` | Unit and integration tests (Vitest), plus the permissive package. |
| `npm run verify:package` | The packed tarball: every subpath imports, strict consumer types, a `create-affe` app installs and builds within its size budget. |
| `npm run size` | Gzipped bundle size per feature (atoms, component, router…); `-- --check` enforces budgets, `-- --modules <case>` shows what a case keeps. |
| `npm run check:docs` | Every TypeScript block in the README and guides names only API that exists (run after `build`). |
| `npm run test:browser` | Playwright: every example driven in Chromium, plus the resumability demos. |
| `npm run bench` | Benchmarks (tracked, not a gate). |

`npm run examples` serves every example on its own port while you work.

## Where things go

- `src/` — the library. `src/__tests__/` holds tests; `src/type-tests/`
  holds compile-time tests for public type behavior.
- `packages/` — the published add-ons (`create-affe`, `affe-permissive`,
  `affe-ui-agent`, `affe-css`), released in lockstep with the core.
- `examples/` — runnable apps. A new one gets a spec in
  `browser-tests/examples.spec.ts`; the suite fails if one is missing.
- `docs/` — user guides at the top level (indexed in
  [`docs/README.md`](docs/README.md)); plans, audits and research in
  `docs/design/`; open questions in `docs/design-questions/`; superseded
  material in `docs/archive/`.
- `future/` — executable specifications of unbuilt design. Red specs there
  are the backlog, not failures; never wire them into a gate.

## Changes

- **Bug fixes** come with a test that fails without the fix.
- **Public API changes** update `CHANGELOG.md` (with a migration note if
  anything breaks), the relevant guide, and a type test when types change.
  `npm run check:docs` catches a guide that still names the old API.
- **Design you would have to invent** (an API shape, a guarantee the code
  does not give) goes into `docs/design-questions/` with a provisional pick
  rather than straight into code. See the README there.
- Keep a pull request to one concern. Commit messages say what changed and
  why in plain language.

## Reporting bugs

Open an issue with the Affe and Effect versions, a minimal reproduction, and
what you expected. Security issues go through [`SECURITY.md`](SECURITY.md),
not public issues.

## Keeping bundles small

Every module is meant to tree-shake. Two rules keep it that way:

- **No module-level work a bundler must keep.** A top-level `const x = f(...)`
  is kept unless marked pure: write `/*#__PURE__*/ (() => ...)()` for
  anything more than one call (including `class X extends
  /*#__PURE__*/ (() => Schema.TaggedError<X>(...)(...))()`), and never
  register or mutate at module load.
- **No `import()` of a large module.** Bundlers keep every dynamic-import
  target and all it exports. Break cycles with a small module instead.

`npm run size -- --check` fails when a feature grows past its budget.

