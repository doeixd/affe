# State, Async and Control Flow

Affe has one model for state: an **atom** is a value you can read and
subscribe to. A read inside JSX, a derived atom or a component view is
tracked. When the atom changes, only those readers update. Components do not
re-render.

Async data is an atom too. Its value is a `Result`, a tagged union that says
whether the data is loading, loaded, refreshing, failed or stale. You render
a `Result` with control-flow components or a builder, the same way every
time.

This guide covers:

- local atoms;
- async queries and actions bound to a runtime;
- `Result`;
- the control-flow components that render state.

For invalidating data across the app, see [Reactivity Keys](reactivity.md).
For state that belongs to one component, see [Components](component.md).

## Atoms

```ts
import { Atom } from "@doeixd/affe";

const count = Atom.make(0);                     // writable
const doubled = Atom.map(count, (n) => n * 2);  // derived from one atom
const label = Atom.make((get) => `${get(count)} × 2 = ${get(doubled)}`); // derived from several

count();                     // 0 (read; tracked when called in a reactive scope)
count.set(1);
count.update((n) => n + 1);
doubled();                   // 4
```

`Atom.make(value)` makes a writable atom. `Atom.make((get) => ...)`, and
`Atom.derived` which means the same thing, make a read-only atom that
recomputes when an atom it read with `get` changes.

Read an atom by calling it. In JSX, pass the call, not the value. The compiler
wraps `{count()}` so that text node alone updates:

```tsx
const Counter = () => (
  <button onClick={() => count.update((n) => n + 1)}>
    Clicked {count()} times
  </button>
);
```

### Families

A family is a keyed set of atoms, created on first use:

```ts
interface Todo { readonly id: string; readonly title: string; readonly done: boolean }

const todo = Atom.family((id: string) => Atom.make<Todo | null>(null));

todo("a1").set({ id: "a1", title: "Ship", done: false });
todo("a1")();       // the same atom every time for "a1"
todo.evict("a1");   // drop it when you no longer need it
```

Pass `{ capacity }` as the second argument to evict the oldest members
automatically.

### Where atoms live

An atom made at module level lives as long as the page. That suits app-wide
state such as the signed-in user or a theme choice. State that belongs to one
component instance goes in component setup: `Component.state(initial)` makes
an atom scoped to that instance, and it is released on unmount. See
[Components](component.md#setup-as-effect).

## Async: queries and actions

Async work is an Effect. Bind the services it needs once with a runtime, then
make atoms from effects:

```ts
import { Atom } from "@doeixd/affe";
import { Effect, Layer } from "effect";

const runtime = Atom.runtime(Layer.mergeAll(Api.live));

// A query: an atom whose value is Result<ReadonlyArray<User>, ApiError>.
const users = runtime.atom(Effect.gen(function* () {
  const api = yield* Api;
  return yield* api.listUsers();
}));

// An action: a function that runs an Effect and tracks its progress.
const addUser = runtime.action((name: string) =>
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.addUser(name);
  }),
);

addUser("Ada");            // run it, fire-and-forget
addUser.pending();         // true while it runs (reactive)
addUser.result();          // its last Result (reactive)
addUser.runEffect("Ada");  // the typed Effect, to compose or await
```

The runtime removes the requirement. `runtime.atom(...)` only accepts effects
whose services the layer provides, so a missing service is a compile error.

A query runs when something first reads it. It reruns when:

- an atom it read with `get` changes, in the form `runtime.atom((get) => ...)`;
- a [reactivity key](reactivity.md) it tracked is invalidated;
- you call `Atom.refresh(users)`.

On a rerun it moves to `Refreshing`, so the old data stays on screen.

```ts
const search = Atom.make("");

const results = runtime.atom((get) =>
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.search(get(search));  // reruns when `search` changes
  }),
);
```

Actions capture the runtime and the component that defined them. Calling
`addUser` from an event handler, a timeout or another module still runs with
the same services. A component's actions are interrupted when the component
unmounts.

### Policies

Retry, polling and staleness are pipeable:

```ts
import { Schedule } from "effect";

const fresh = users.pipe(
  Atom.withStaleTime("30 seconds"),
  Atom.withRetry(Schedule.exponential("100 millis")),
  Atom.withPolling(Schedule.spaced("1 minute")),
);
```

### Optimistic updates

`optimistic(source).action(...)` updates a writable atom immediately, runs the
effect, and rolls back if it fails:

```ts
const todos = Atom.make<ReadonlyArray<Todo>>([]);

const toggle = runtime.optimistic(todos).action({
  update: (list, id: string) =>
    list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
  effect: (_next, id) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.toggleTodo(id);
    }),
});
```

## `Result`

Every async value is a `Result<A, E>`:

| Variant | Meaning | Carries |
| --- | --- | --- |
| `Idle` | Not started, and not starting until asked (a manual query) | |
| `Loading` | First load, no data yet | |
| `Refreshing` | Rerunning, with the previous result kept | `previous` |
| `Success` | Loaded | `value` |
| `Failure` | Failed with a typed error | `error` |
| `Stale` | A refresh failed, but earlier data exists | `error`, `data` |
| `Defect` | A bug, an unexpected throw, or an interruption | `cause` |

`Failure` is for errors you expect and handle, such as a missing record. It
carries the typed `E`. `Defect` is for errors you don't expect, and usually
goes to a generic error view. `Stale` lets you keep showing the last good
data after a failed refresh.

Useful helpers:

- `Result.isSuccess(r)` and the other guards narrow a result.
- `Result.getData(r)` returns the data from `Success`, `Refreshing` or `Stale`.
- `Result.all([a, b])` combines results into a result of a tuple.
- `Atom.result(atom)` waits for a query's value as an `Effect`.

## Rendering state

All the control-flow components take plain values or accessors, and they
rebuild a branch only when the *choice* of branch changes. A query that
refreshes does not re-create its `success` view; the `success` view reads the
new data.

### `Async`: one component for a `Result`

```tsx
<Async
  result={users()}
  loading={() => <Spinner />}
  error={(error) => <ErrorView error={error} />}
  success={(list) => <UserList users={list} />}
/>
```

The optional handlers are `refreshing`, `stale` and `defect`. Without
`refreshing`, a refresh keeps showing the previous branch. Without `stale`, a
stale result renders through `error` if you gave one, and otherwise through
`success` with the last good data. `Idle` renders as `loading`.

### `Result.builder`: the same, as an expression

```tsx
{Result.builder(users())
  .onLoading(() => <Spinner />)
  .onSuccess((list) => <UserList users={list} />)
  .onFailure((error) => <ErrorView error={error} />)
  .render()}
```

Every handler is optional. `Refreshing` uses the handler of the result it
wraps. `Stale` and `Defect` fall back to `onFailure`. `onIdle` is available
for a manual query that has not been started.

### Other shapes

```tsx
// Only the loading state, with children kept mounted while refreshing
<Loading when={users()} fallback={() => <Spinner />}>
  <UserTable />
</Loading>

// Only the error, for an error banner
<Errored result={users()}>{(error) => <Banner error={error} />}</Errored>

// Any tagged union: one case per _tag, checked for exhaustiveness
<MatchTag
  value={status()}
  cases={{
    Idle: () => "Idle",
    Saving: () => "Saving…",
    Saved: (s) => `Saved at ${s.at}`,
  }}
/>

// Conditions, lists and nullables
<Show when={user()} fallback={() => <SignIn />}>{(u) => <Hello user={u} />}</Show>
<For each={names()}>{(name) => <li>{name}</li>}</For>
<Optional when={selected()}>{(item) => <Details item={item} />}</Optional>
```

`Switch` and `Match` choose between conditions. `MatchOption` renders an
Effect `Option`, and `TypedBoundary` renders only errors that match a schema
or type guard. The [API reference](API.md#control-flow-components) lists
every prop.

## Choosing an API

| You want | Use |
| --- | --- |
| A value you set | `Atom.make(value)` |
| A value computed from others | `Atom.make((get) => ...)` or `Atom.map` |
| Server data needing services | `runtime.atom(effect)` |
| A write, with pending and result | `runtime.action(fn)` |
| A write that shows immediately | `runtime.optimistic(atom).action(...)` |
| State owned by one component | `Component.state`, `Component.query`, `Component.action` in setup |
| Route data | `Route.loader(...)` (see [Router](router.md)) |

The [API reference](API.md#choosing-the-right-async-api) also covers the
lower-level `Atom.effect`, `Atom.query`, `defineQuery` and `atomEffect`.
