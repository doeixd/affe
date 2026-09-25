# Rename: effect-atom-jsx → Affe

Date: 2026-07-29
Status: migrated 2026-09-25 (see "Migration record" below); logo and
domain still open

## Decision

The project is renamed **Affe** (German: monkey/ape — pronounced "AH-fuh"),
with a monkey mascot owned deliberately. Package publishing was planned for
the scoped org **`@affe/*`**; that scope turned out to be taken, so packages
publish under **`@doeixd/affe*`** instead (see "Migration record").

Why the old names failed:

- `effect-atom-jsx` reads as a bindings shim between three other things; it
  undersells a full framework and buries the actual differentiators.
- `AF-UI` sounds like a component catalog, which the project is not.
- `Affect`/`Aff` were considered and rejected: the affect/effect homophone
  makes spoken conversation ambiguous with the library's own dependency, and
  `Aff` collides with PureScript's well-known async effect monad for exactly
  the FP-literate audience this project targets.

Why Affe works:

- **The metaphor is the architecture.** A monkey doesn't climb the whole
  tree — it swings straight to the branch it needs. That is the resumability
  model: no component-tree replay, load only what the interaction touches.
  Tagline: *"Affe doesn't climb the whole tree."* Instant reaction when
  poked = first interaction without hydration.
- **Lineage stays visible.** Affe/Effect share the sound and the `af`
  prefix — and the wire format already says it: `data-af-event-*`,
  `data-af-replay-*`, `af:component:*`/`af:expr:*` markers, `data-af-resume`,
  and the ratified `af:binding:*` reactivity namespace all read as "Affe"
  retroactively. No wire-format rename is needed, ever.
- **Deliberate beats accidental.** As a stumbled-into German word, "Affe"
  would invite giggles; as a mascot-first identity (Go's gopher, Docker's
  whale, PHP's elephant), the joke lands as intended for German-speaking
  users — a significant slice of the Effect community.
- Unique, short, pronounceable (one README cue), and image search becomes
  ours the moment a logo exists. Monkey emoji (🐒, 🙈🙉🙊) are unowned in
  the framework space.

## Names and namespaces

| Thing | Name |
| --- | --- |
| Project/brand | Affe |
| npm packages | `@affe/core` (runtime), `@affe/compiler` (Babel/Vite transform), future splits as needed (`@affe/router`?) — bare `affe` is squatted by a dormant 0.0.4 package; a name dispute can be attempted but is not load-bearing |
| JSX import source | `@affe/core/jsx-runtime` |
| Wire prefixes | unchanged (`af:*`, `data-af-*`) — already correct |
| Vite virtual module | `virtual:af-resume-entries` — unchanged |
| Plugin names | `af-ui-resume-extract` → `affe-resume-extract` (cosmetic, rename during migration) |
| Docs identity | "AF-UI" wording in docs migrates to "Affe"; the AF-UI architecture contract keeps its filename with a rename note |
| Domains | `affe.dev` / `affe.js.org` have DNS records (verify ownership options); `affejs.dev` and `affe.build` appeared unregistered at decision time — `affe.build` preferred |

## Migration record (2026-09-25)

The rename landed as one change-set, following the outline below except where
noted:

- **npm names.** `@affe` was unavailable, so the core is `@doeixd/affe` (was
  `@affe/core`) and the workspace packages are `@doeixd/affe-ui-agent`,
  `@doeixd/affe-css`, and `@doeixd/affe-permissive` (were `@affe/agent`,
  `@affe/css`, `@affe/permissive`). The agent adapter is `affe-ui-agent`
  rather than `affe-agent` so it does not collide with the separate Affe Agent
  sister project. Planned future splits follow the same
  shape (`@doeixd/affe-compiler`, `@doeixd/affe-kit`, `@doeixd/affe-router`).
  The table above keeps the original decision.
- **JSX import source** is `@doeixd/affe` (TypeScript resolves
  `@doeixd/affe/jsx-runtime`).
- **No deprecation alias (owner decision, 2026-09-25).** The published
  `effect-atom-jsx` package stays on npm exactly as it is: no re-exporting
  alias release and no `npm deprecate`. The alias package that briefly
  lived in `deprecated/effect-atom-jsx/` was removed.
- **Internal identifiers** moved to `affe/...` in the same change-set: symbol
  keys, Schema brands, error tags, and service keys; the hydration marker is
  `~affe/DehydratedAtom`, the HMR key `affe:dispose`, and diagnostics are
  prefixed `[affe]`.
- **Plugin** renamed to `affe-resume-extract`. Wire prefixes and
  `virtual:af-resume-entries` are unchanged, as decided.
- **Docs identity.** "AF-UI" wording migrated to "Affe" outside
  `docs/archive/`; `docs/archive/AF_UI_CONTRACT.md` keeps its filename and
  wording with a rename note. File names such as `docs/afui.md` and
  `docs/af-ui-json-render/` are unchanged.
- **CLIs** (0.6.0): `af-ui` / `af-ui-doctor` became `affe` / `affe-doctor`,
  and the `create-af-ui` stub became the `@doeixd/create-affe` package
  (`npm create @doeixd/affe`), which scaffolds a working Vite project.
- **Repository** (step 5): `doeixd/effect-atom-jsx` → `doeixd/affe`; the
  `repository`, `homepage`, and `bugs` URLs in `package.json` point at the new name, and GitHub redirects the old one.
- **Not done yet:** the mascot/logo, the domain, and the npm dispute for bare
  `affe`.

## Migration outline (when scheduled — deliberately not now)

The rename should land as one dedicated change-set, not interleaved with
milestone work:

1. Reserve the npm org and packages (`@affe/core`, `@affe/compiler`) and the
   chosen domain immediately — reservation is cheap and independent of
   migration.
2. Package rename. (The plan here was to keep publishing `effect-atom-jsx`
   as a deprecation alias; the owner later decided against it, see above.)
3. Internal identifiers: symbol keys (`Symbol.for("effect-atom-jsx/...")`)
   and Schema brand strings (`@effect-atom-jsx/...`) are observable
   behavior. Rename them to `affe/...` in the same change-set as the package
   rename — prerelease rules apply, but it must be one atomic break, and
   resume manifests' build-ID gating makes it deploy-safe by construction.
4. Docs/README/examples sweep; add the pronunciation cue and mascot.
5. Repo rename with GitHub redirect.

Explicitly deferred: nothing in the current milestone work (M8a, M9) blocks
on or waits for the rename. Wire formats and the `af` prefix are already
final.

## Open items

- Commission/design the monkey logo (swing/branch motif preferred over a
  face; it should read at 16×16 favicon size).
- Verify `affe.dev` ownership status vs. buying `affe.build`.
- Attempt the npm dispute for bare `affe` (non-blocking).
