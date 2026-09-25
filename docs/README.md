# Documentation

New to Affe? Read the [README](../README.md), run
`npm create @doeixd/affe@latest my-app`, then use the guides below. Everything
under "Design records" is history and reasoning for contributors, not
something you need to use the library.

## Guides

| Guide | What it covers |
| --- | --- |
| [`SLOT_CONTRACT_GOLDEN_PATH.md`](SLOT_CONTRACT_GOLDEN_PATH.md) | The shortest path to an authored component with slots, a style and a behavior. |
| [`component.md`](component.md) | Components: setup as an Effect, bindings, slot contracts, layers, transforms. |
| [`view.md`](view.md) | `View`, `View.Slots`, slot metadata, tree metadata, diagnostics. |
| [`style.md`](style.md) | Styles and themes, attachment tiers, global styles, recipes. |
| [`reactivity.md`](reactivity.md) | Semantic reactivity keys and invalidation. |
| [`router.md`](router.md) | Routes, loaders, preload, lazy components, head metadata, single flight, SSR, cross-site request protection. |
| [`SERVICES_AND_LAYERS.md`](SERVICES_AND_LAYERS.md) | Services and layers: provision tiers and request scoping. |
| [`TESTING.md`](TESTING.md) | DOM-free tests, layer swapping, behavior drivers, stories and scenes. |
| [`RESUMABILITY_GUIDE.md`](RESUMABILITY_GUIDE.md) | Resumability (experimental): markers, manifests, strict and permissive modes. |
| [`AGENT_SURFACE_GUIDE.md`](AGENT_SURFACE_GUIDE.md) | The agent surface (experimental): catalogs, governance, MCP, `ViewSpec`. |
| [`API.md`](API.md) | The API reference across every module, including `A11y`, `Form`, `Devtools`, `Diagnostics`, `Serialization` and `SafeHtml`. |
| [`afui.md`](afui.md) | The long-form narrative: the inside-out model, the runtime, routing. |

Runnable examples live in [`../examples`](../examples); `npm run examples`
serves them all.

## Current golden paths

- State: `Atom.make`, `Atom.derived`, `Atom.runtime(layer).atom(...)` and
  `Atom.runtime(layer).action(...)`.
- Async state: the unified `Result` model (`Loading`, `Refreshing`,
  `Success`, `Failure`, `Stale`, `Defect`), rendered with `Async`,
  `Loading`, `Errored` or `MatchTag`.
- Components: `Component.make(...)` with setup as an `Effect`, plus
  `Component.withSlots(...)` for slot-bearing components.
- Views: `View.Slots.define(...)` plus `View.fromSlots(...)`, with
  `ref={View.Slot.ref(Slots, "name")}` binding each slot to its element.
- Styles: `Style.make(slots, ...)` plus `Style.attachToSlots(...)`.
- Behaviors: `Behavior.forSlots(slots)(...)` plus `Behavior.attachToSlots(...)`.
- Routing: `Route.page(...)`, `Route.layout(...)`, `Route.index(...)`,
  `Route.define(...)`, `Route.loader(...)`, `Route.link(...)` and
  `Route.Link`; `Route.Switch` for component-first pages.
- Services: one composition root shared by `Atom.runtime(...)` and
  `mount(...)`, or a `WithLayer` boundary.
- Events: `Event.channel(...)`, `Event.layer(...)`, `Event.publish(...)` and
  `Event.stream(...)`; use Effect `PubSub` directly for private channels.

## Releasing and scope

- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — how to release, and the gates.
- [`V1_SCOPE.md`](V1_SCOPE.md) — what ships and what is deliberately deferred.
- [`../CHANGELOG.md`](../CHANGELOG.md) — every release, with migration notes.
- [`../SECURITY.md`](../SECURITY.md) — reporting, and what the library protects.

## Design records

For contributors. These explain why things are the way they are; code
snippets in them can be out of date.

- [`CURRENT_STATUS_IN_REDESIGN_PLAN.md`](CURRENT_STATUS_IN_REDESIGN_PLAN.md) — the maintainers' status ledger.
- [`design-questions/`](design-questions) — open and ratified design questions (DQ-###).
- [`adr/`](adr) — architecture decision records.
- Plans and audits: `*_PLAN.md`, `RESUMABILITY_*`, `ROUTER_*`,
  `TEST_SUITE_AUDIT.md`, `KIT_LAYER_SPEC_FINDINGS.md`,
  `EXIT_ANIMATION_OWNERSHIP.md`, `DESIGN_IMPROVEMENT_NOTES.md`,
  `AGENT_NATIVE_NOTES.md`, `ARCHITECTURE_REFERENCE.md`, `RENAME_AFFE.md`.
- [`archive/`](archive) — superseded plans and API sketches.
- `af-ui-json-render/` — renderer and generator notes.

## Checking a change

```sh
npm run build
npm run typecheck:all
npm test
npm run verify:package   # the packed package, as a user installs it
npm run test:browser     # Playwright: every example plus the resumability demos
```
