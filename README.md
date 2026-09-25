# Affe

Effect-native reactive state and inside-out UI. One algebra from a counter
atom to a full-stack, schema-validated, single-flight application.

```sh
npm create @doeixd/affe@latest my-app
cd my-app && npm install && npm run dev
```

> Affe is German for "monkey" (pronounced "AH-fuh"). It was published as
> `effect-atom-jsx` before 0.6.

```ts
import { Atom } from "@doeixd/affe";

const count = Atom.make(0);

count();          // read
count.set(1);     // write
count.update((n) => n + 1);
```

Built on [Effect](https://effect.website): services are layers, errors are
typed, lifecycles are scoped, and everything composes with `.pipe()`.

---

## What's in the box

| Layer | What you get |
|---|---|
| **Atoms** | Callable fine-grained state, derived atoms, families, schema-validated forms |
| **Async** | `Result`-based queries, actions, retry/polling schedules, optimistic updates |
| **Reactivity** | Semantic key-based invalidation as an Effect service |
| **Components** | Components with published slot contracts; styles and behaviors attach from outside |
| **Router** | Schema-first routes, loaders with SWR caching, typed links, head metadata |
| **Single flight** | One round-trip for a mutation *and* all affected loader data |
| **Server** | Typed server routes, document rendering, SSR hydration |
| **Resumability** | Dormant server-rendered pages that load only the code the first interaction needs |
| **Agent surface** | Your actions as typed tools for AI agents, over HTTP and MCP, with approval and audit |

You can stop at any row. The atoms work alone; the UI model works without the
router; the router works without the server runtime.

## Install

The quickest start is `npm create @doeixd/affe@latest my-app` (Vite,
TypeScript, a counter and a slot-contract component). To add Affe to an
existing project:

```sh
npm install @doeixd/affe effect@4.0.0-rc.117
npm install -D vite @babel/core @babel/preset-typescript babel-plugin-jsx-dom-expressions
```

**Effect:** Affe is built on Effect 4, which is still a release candidate,
so it pins the exact version (`effect@4.0.0-rc.117`); install that one. Affe
stays 0.x until Effect 4 is stable.

**TypeScript:** 5.9 or newer. The published types are checked against
TypeScript 5.9 and 7 on every release.

### Packages

| Package | What it is |
|---|---|
| [`@doeixd/affe`](https://www.npmjs.com/package/@doeixd/affe) | The library: atoms, components, styles, router, server, resumability, agent surface. |
| [`@doeixd/create-affe`](packages/create-affe) | `npm create @doeixd/affe` scaffolds a working Vite app. |
| [`@doeixd/affe-permissive`](packages/permissive) | Resumability preset: inferred captures and the seroval codec (Maps, Dates, Promises). Experimental. |
| [`@doeixd/affe-ui-agent`](packages/agent) | MCP server for an agent catalog. Experimental. |
| [`@doeixd/affe-css`](packages/css) | Zero-JavaScript CSS foundation: theme tokens as custom properties and the cascade-layer order. |

All of them release together under one version.

### Setup

JSX compiles to fine-grained DOM operations via
`babel-plugin-jsx-dom-expressions`. With Vite, add the plugin:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import affe from "@doeixd/affe/vite";

export default defineConfig({ plugins: [affe()] });
```

With another bundler, configure Babel yourself and point `moduleName` at the
`@doeixd/affe/runtime` subpath (that is where the compiler-facing helpers
live):

```json
// babel config
{
  "plugins": [
    ["babel-plugin-jsx-dom-expressions", {
      "moduleName": "@doeixd/affe/runtime",
      "generate": "dom",
      "contextToCustomElements": true
    }]
  ]
}
```

For `tsc` to type-check your JSX, set these in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@doeixd/affe",
    "lib": ["ESNext", "DOM"]
  }
}
```

`lib` needs `ESNext` (or at least `ESNext.Disposable`) because Effect's own
types use `Disposable`.

Mount an app with `render` (SSR uses `renderToString` / `hydrateRoot`):

```tsx
import { render } from "@doeixd/affe";

render(() => <App />, document.getElementById("root")!);
```

---

## 1. State: atoms

Atoms are callable, writable, and fine-grained. No registry ceremony, no
provider wrapper.

```ts
import { Atom } from "@doeixd/affe";

const count = Atom.make(0);
const doubled = Atom.map(count, (n) => n * 2);

count.update((n) => n + 1);
doubled(); // 2
```

Families give you keyed state with explicit lifecycle:

```ts
const todo = Atom.family((id: string) => Atom.make<Todo | null>(null));

todo("a1").set({ id: "a1", title: "ship v1" });
todo.evict("a1"); // explicit memory control
```

## 2. Async: queries, actions, and `Result`

Async state is one tagged union, `Result<A, E>`, everywhere — loaders,
queries, actions. Errors are typed; defects are separate; stale data stays
renderable while revalidating.

```ts
import { Atom, Result } from "@doeixd/affe";
import { Layer } from "effect";

// Bind a runtime once; requirements (R) are eliminated at construction.
const runtime = Atom.runtime(Layer.mergeAll(ApiLive, Reactivity.live));

const users = runtime.atom(() => api.listUsers());   // ReadonlyAtom<Result<User[], ApiError>>

const addUser = runtime.action((name: string) => api.addUser(name));

addUser("Ada");        // fire-and-forget
addUser.pending();     // reactive pending state
addUser.runEffect("Ada"); // typed Effect path for composition
```

Render a `Result` exhaustively — no conditional-hook gymnastics:

```ts
Result.builder(users())
  .onLoading(() => <Spinner />)
  .onSuccess((list) => <UserList users={list} />)
  .onStale((error, list) => <UserList users={list} warning={error} />)
  .onFailure((error) => <ErrorView error={error} />)
  .render();
```

Handlers are optional and the return type accumulates, so adding a state later
never breaks an existing call site. `Refreshing` falls back to the handler of the
variant it wraps, and `Stale`/`Defect` fall back to `onFailure`, so the two
handlers above are already total.

Policies are pipeable data, not config soup:

```ts
const usersFresh = users.pipe(
  Atom.withStaleTime("30 seconds"),
  Atom.withRetry(Schedule.exponential("100 millis")),
  Atom.withPolling(Schedule.spaced("1 minute")),
);
```

## 3. Reactivity: invalidate concepts, not references

Instead of "refresh this atom," you invalidate a semantic key. Anything that
tracked that key — atoms, loaders, components — refreshes automatically, with
microtask batching.

```ts
import { Reactivity } from "@doeixd/affe";

// A key witness: the read side and the write side share one literal-typed
// value, so a typo'd key is a compile error instead of a silent non-refresh.
const Users = Reactivity.Key.make("users");

class Api extends Context.Service<Api, {
  readonly listUsers: () => Effect.Effect<User[]>
  readonly addUser: (name: string) => Effect.Effect<User>
}>()("Api") {
  static live = Layer.succeed(Api, {
    // Reads record the key they depend on...
    listUsers: () => Reactivity.tracked(fetchUsers(), { keys: [Users] }),
    // ...and writes invalidate it once they succeed.
    addUser: (name) => Reactivity.invalidating(createUser(name), [Users]),
  });
}
```

Parameterized keys use families (`Reactivity.Key.family("user")`, then
`user(id)`); plain strings remain valid as the dynamic escape hatch.

Swap `Reactivity.live` for `Reactivity.test` in tests and drive invalidation
manually with `flush()` — no component changes.

## 4. UI: the inside-out component model

Most frameworks bake structure, style, and behavior into one file. Affe
components declare a **slot contract** — a typed description of their
attachment points — and styles and behaviors attach from outside, checked
against that contract at compile time.

```ts
import { Behavior, Component, Element, Style, View } from "@doeixd/affe";
import { Effect } from "effect";

// One contract: the view is built from it, styles and behaviors are checked
// against it. Rename a slot and every mismatched attachment fails to compile.
const FieldSlots = View.Slots.define({
  root:  { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

const Field = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  // `ref={View.Slot.ref(FieldSlots, name)}` binds a slot to its element, so
  // what attaches from outside lands on the rendered page.
  (props) =>
    View.fromSlots(FieldSlots, (
      <label ref={View.Slot.ref(FieldSlots, "root")}>
        <span ref={View.Slot.ref(FieldSlots, "label")}>{props.label}</span>
        <input ref={View.Slot.ref(FieldSlots, "input")} />
      </label>
    )),
).pipe(Component.withSlots(FieldSlots));

// Appearance, from outside — token paths are type-checked against the theme.
const FieldStyle = Style.make(FieldSlots, {
  root:  Style.slot({ display: "grid", gap: "sm" }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: "sm" }),
});

// Interaction, from outside — scoped: listeners clean up on unmount.
const FieldBehavior = Behavior.forSlots(FieldSlots)((elements) =>
  Effect.succeed({ focus: () => elements.input.focus() }),
);

export const StyledField = Field.pipe(
  Style.attachToSlots(FieldStyle, FieldSlots),
  Behavior.attachToSlots(FieldBehavior, FieldSlots),
);
```

Why bother?

- **No fork rot.** Customizing a design-system component means attaching to
  its published contract, not copy-pasting its source (the shadcn problem).
- **No magic strings.** Invalid tokens, unknown slots, and events a slot
  doesn't allow are compile errors (the Tailwind problem).
- **No DOM lock-in.** Slots declare abstract capabilities
  (`TextInput → Focusable → Interactive → Base`); views and styles are
  validated against platform vocabularies as data
  (`View.validatePlatform`, `Style.validatePlatform`).

Setup is a scoped Effect from props to bindings, with standard ownership
primitives — `Component.state` (local reactive state), `Component.query`
(async reads), `Component.action` (mutations). Everything acquired in setup
is released on unmount. For larger components a pipeable builder
(`Component.setup<Props>().bind(...)`) is available.

The behavior pack ships composable headless primitives — `disclosure`,
`selection`, `keyboardNav`, `focusTrap`, `searchFilter`, `pagination`, and a
composed `combobox` — all matched by element capability, so a press behavior
attaches to anything `Interactive`. `focusTrap` can cycle Tab/Shift+Tab over a
focusable collection while remaining renderer-neutral.

**Honest scoping:** slot contracts, attachments, tokens, and
capability/platform checks are enforced at compile time today. Authored views
carry tree metadata through `View.fromSlots(...)` / `View.fromJsx(...)`;
compiler extraction of richer JSX tree metadata remains a tooling concern.
Platform-agnosticism means your components are *verified* against declared
platform vocabularies — alternate renderers (TUI, native) are deferred, not
shipped.

**What binds to the page:** a slot reaches an element only through
`ref={View.Slot.ref(Slots, name)}` (or `Element.ref(handle)` for handles
outside a contract). A bound element gets the slot's attached styles as inline
styles (tokens resolved, numeric lengths in `px`), attributes set by
behaviors, real listeners for `on(...)` (`press` = click, plus Enter/Space on
elements without native keyboard activation), `focus()`/`blur()`, and a
`data-af-slot="<name>"` stamp; SSR serializes the same. A slot with no `ref`
stays an in-memory handle (the test kit still drives it). A `Collection` slot
binds one item handle per element its `ref` lands on, in render order.
Resumed components bind when activation re-renders them, not by adopting the
server markup in place. Static CSS from `Style.extractStatic` targets
`[data-af-slot="<slot>"]` by default.

## 5. Routing: schema-first, loader-driven

Routes are components with metadata accumulated through pipes. Params, query,
and hash are Effect Schema-validated; loaders are Effects with declarative
caching bound to reactivity keys.

```ts
const UserRoute = UserPage.pipe(
  Route.path("/users/:userId"),
  Route.paramsSchema(Schema.Struct({ userId: Schema.String })),
  Route.loader((params) => Effect.gen(function*() {
    const api = yield* Api;
    return yield* api.getUser(params.userId);
  }), {
    staleTime: "30 seconds",
    staleWhileRevalidate: true,
    reactivityKeys: [Users],  // invalidate the Users key → this loader re-runs
  }),
  Route.title((params, user) => `User: ${user.name}`),
);
```

Requirements bubble: if a nested loader needs `BillingService`, the top-level
router's `Req` includes it, and forgetting the layer is a compile error.
Links are typed (`Route.link`), head metadata merges down the matched chain,
and `priority: "critical" | "deferred"` splits loaders for streaming.

### Single flight

Navigations run all matched loaders as one batch. Mutations can return the
updated data for every affected loader in the same round-trip:

```ts
const save = Atom.action(saveUser, {
  singleFlight: { mode: "auto" },
});
```

The transport is a service — fetch by default, anything (WebSocket, IPC, test
stub) by layer.

### Optimistic updates

```ts
const countAtom = Atom.make(0).pipe(Atom.withOptimistic());

yield* countAtom.withEffect((prev) => prev + 1, api.incrementCount());
// UI updates instantly; clears on success, rolls back on failure or defect.
```

Richer flows use the builder — `Component.optimistic(source).action({
update, effect, reconcile, reactivityKeys, singleFlight })` — whose handle
exposes `value`, `committed`, `hasOptimistic`, and `rollback()`.

## 6. Server: typed routes, documents, hydration

```ts
const SaveApi = ServerRoute.json().pipe(
  ServerRoute.method("POST"),
  ServerRoute.path("/api/save"),
  ServerRoute.body(MyDataSchema),
  ServerRoute.handle(({ body }) => saveToDb(body)),
);

const Document = ServerRoute.document(appRoutes); // full HTML + loader payload

ServerRoute.dispatch([SaveApi, Document], request, { layer: AppLive });
```

Every request part — params, query, form, body, headers, cookies — decodes
through schemas into one typed handler input. `ServerRoute.redirect` and
`ServerRoute.notFound` are typed control flow.

Hydration is explicit: `dehydrate(registry, entries)` on the server,
`hydrate(registry, payload, resolvers, { strict: true })` on the client
*before* mount — zero-flicker first render, typed `HydrationError` on
client/server mismatch, and you choose exactly which atoms cross the boundary.

## 7. Context is layers

```ts
const dispose = Component.mount(App, {
  props: {},
  target: document.getElementById("app")!,
  layer: Layer.mergeAll(ApiLive, ThemeLive, Reactivity.live),
});
```

- Forget a provider → compile error (`Component.withLayer` subtracts from
  `Req`).
- Services close when their subtree unmounts (scoped finalizers).
- Testing = swap the layer (`Reactivity.test`, mock services).

## 8. Resumability: resume instead of hydrating

A server-rendered page can stay dormant: the first interaction imports only
the code it needs, and component setup never re-runs on the client. Wrap the
code that should resume in a compiler marker; the Vite plugin
(`resumeExtract` from `@doeixd/affe/compiler/resume-extract-vite`) hoists it
into a `Portable.code` definition with a stable id and a lazy loader.

```ts
import { extract } from "@doeixd/affe/portable-extract";

.bind("note", ({ props }) =>
  Component.action(
    extract(
      (captures: { readonly label: string }) =>
        Effect.gen(function* () {
          yield* (yield* NoteService).record(captures.label);
        }),
      { captures: Schema.Struct({ label: Schema.String }), bind: { label: props.label } },
    ),
  ))
```

On the server, `Resume.collect(render, { buildId })` returns the HTML plus a
small JSON manifest. On the client, `Resume.decodeManifest(...)` and
`Resume.installClient({ root, manifest, expectedBuildId, resolverEntries,
runtime })` install one listener per event type; the first click loads that
handler's chunk and runs it. Everything that crosses the wire is
schema-validated and gated by build id, so a stale or tampered page fails
closed. Strict mode is plain JSON;
[`@doeixd/affe-permissive`](packages/permissive) adds seroval for `Map`,
`Date` and friends. See `docs/RESUMABILITY_GUIDE.md` and
`examples/resumable-extract`.

## 9. Agent surface: your actions as tools

An agent is just another caller. Expose `Portable.code` actions in a catalog,
and one dispatch pipeline serves the UI, HTTP single flight and MCP:

```ts
const catalog = Agent.catalog({
  addTodo: Agent.exposeMutation(AddTodo, {
    description: "Add a todo",
    args: Schema.Tuple([Schema.String]),
    success: Schema.Struct({ id: Schema.String, text: Schema.String }),
    reactivityKeys: ["todos"],
    access: { agent: true, http: true },
  }),
});

Agent.dispatch(catalog)({ tool: "addTodo", args: ["milk"], buildId });
```

Dispatch authorizes first, rejects stale builds, decodes arguments before the
handler runs, and asks the `Approval` and `AuditLog` services when the entry
or catalog requires them (refusing if they are missing). `ViewSpec` is a
validated, markup-free view format for UI an agent generates, and
[`@doeixd/affe-ui-agent`](packages/agent) projects the catalog as an MCP
server. See
`docs/AGENT_SURFACE_GUIDE.md`.

## Type architecture

Every async value carries three axes — `A` (value), `E` (typed error), `R`
(requirements) — and they flow: a service used in a loader appears in the
route's `Req`; a query that can fail with `ApiError` renders as
`Result<User[], ApiError>`; providing a layer subtracts from `R`. Extraction
helpers (`Atom.ValueOf`, `Component.Requirements`, `RouteLoaderDataOf`, ...)
recover any of it anywhere.

## Using it inside an existing app

The runtime is self-contained — mount an Affe tree inside a React (or
anything) component the way you'd mount a D3 chart, and adopt incrementally:
atoms first, components where contracts pay off.

## When not to use this

- **Your team isn't investing in Effect.** The type system is the product;
  without fluency in `Effect.gen`, layers, and typed errors you pay the
  learning curve without collecting the payoff.
- **You need a mature component ecosystem today.** The behavior pack covers
  core headless primitives, not a shadcn-sized catalog.
- **It's a small static site or a throwaway prototype.** Contracts and typed
  services earn their cost in long-lived apps with real state, not landing
  pages.

What you don't give up: incremental adoption inside an existing app, and SSR
(hydration, streaming loaders, single flight are first-class).

## Learn more

- [`docs/README.md`](docs/README.md) — docs map and current golden paths
- [`docs/state.md`](docs/state.md) — atoms, queries, actions, `Result`, control flow
- [`docs/SLOT_CONTRACT_GOLDEN_PATH.md`](docs/SLOT_CONTRACT_GOLDEN_PATH.md) — the authored component shape
- [`docs/component.md`](docs/component.md), [`docs/view.md`](docs/view.md),
  [`docs/style.md`](docs/style.md), [`docs/router.md`](docs/router.md) —
  focused guides for the main subsystems
- [`docs/reactivity.md`](docs/reactivity.md) — reactivity keys: refresh reads after writes
- [`docs/SERVICES_AND_LAYERS.md`](docs/SERVICES_AND_LAYERS.md) — dependency injection, provision tiers, request scoping
- [`docs/TESTING.md`](docs/TESTING.md) — DOM-free test harness, layer swapping
- [`docs/API.md`](docs/API.md) — API reference
- [`docs/afui.md`](docs/afui.md) — the full narrative: inside-out model, runtime, routing
- `docs/RESUMABILITY_GUIDE.md` — resumability: markers, manifests, strict vs permissive
- `docs/AGENT_SURFACE_GUIDE.md` — the agent catalog, governance services, MCP, ViewSpec
- `docs/V1_SCOPE.md` — what v1 ships and what is deliberately deferred
- `examples/` — router golden path, single flight (custom + fetch transport),
  styled combobox, optimistic counter, SSR hydration

## Size

Measured with Vite 8, minified and gzipped, **Effect included**
(`npm run size` reproduces these; CI fails if one grows past its budget):

| App | Initial JavaScript |
|---|---|
| Atoms only | ~5 kB |
| `render` + atoms | ~20 kB |
| One component | ~25 kB |
| Component + style + behavior | ~30 kB |
| The `create-affe` template | ~32 kB |
| Routing (`examples/router-basic`) | ~50 kB |

You pay for what you import: every module is tree-shakeable, so an app that
never routes ships no router, and one that never resumes ships no
resumability runtime. Routing costs the most because params and loaders
decode through Effect `Schema`, which a typed app usually carries anyway.

## Status

**0.x prerelease.** Affe peers on Effect 4, which is itself a release
candidate, so 1.0 waits for a stable Effect. Until then a minor version can
change APIs; `CHANGELOG.md` lists every break with a migration note.

| Area | Status |
|---|---|
| Atoms, `Result`, queries and actions | Stable surface |
| Components, slots, styles, behaviors | Stable surface |
| Router, loaders, single flight, server routes, SSR | Stable surface |
| Resumability (`Resume`, `Portable`, the extract compiler) | Experimental |
| Agent surface (`Agent`, `ViewSpec`, `@doeixd/affe-ui-agent`) | Experimental |

"Stable surface" means it is exercised end to end (unit tests plus every
example driven in a real browser) and changes only with a changelog entry.
"Experimental" means it works and is tested, but its API may still move.

Run the examples with `npm run examples`. Security reports go through
[`SECURITY.md`](SECURITY.md); contributions through
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Events

`Event` is a thin typed contract over Effect `PubSub`, not a replacement event
system. Use it when a named in-process fact crosses module boundaries; use
direct `PubSub` for private service-local channels. Provide the channel through
the same application Layer used by components and atoms, publish with
`Event.publish`, and consume with `Event.stream` plus normal Effect `Stream`
operators or `Component.subscription`.
