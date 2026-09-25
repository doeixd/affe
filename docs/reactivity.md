# Reactivity Keys

Atoms keep the UI in sync with local state. Reactivity keys keep it in sync
with **data that lives somewhere else**: a server, a database, another tab.
After a write you don't refresh particular queries. You invalidate a named
piece of data, such as "users" or "user 42", and every query, loader or atom
that read it refreshes.

The model has three parts:

- A **key** names a piece of data: `Reactivity.Key.make("users")`.
- A **read** records the keys it depends on: `Reactivity.tracked(effect, { keys })`.
- A **write** invalidates keys once it succeeds: `Reactivity.invalidating(effect, keys)`.

The service layer is the only place that knows both sides. Components, atoms
and route loaders call service methods and never mention keys, but they still
refresh at the right time.

## The canonical pattern

Put the keys in the service. Reads track them, writes invalidate them:

```ts
import { Atom, Reactivity } from "@doeixd/affe";
import { Context, Effect, Layer } from "effect";

// One shared value for both sides. A typo is a compile error, not a
// query that silently never refreshes.
const Users = Reactivity.Key.make("users");

class Api extends Context.Service<Api, {
  readonly listUsers: () => Effect.Effect<ReadonlyArray<User>>;
  readonly addUser: (name: string) => Effect.Effect<User>;
}>()("Api") {
  static live = Layer.succeed(Api, {
    listUsers: () => Reactivity.tracked(fetchUsers(), { keys: [Users] }),
    addUser: (name) => Reactivity.invalidating(createUser(name), [Users]),
  });
}

const runtime = Atom.runtime(Layer.mergeAll(Api.live, Reactivity.live));

// Reads Users (through listUsers), so it tracks the key.
const users = runtime.atom(Effect.gen(function* () {
  const api = yield* Api;
  return yield* api.listUsers();
}));

// Invalidates Users when it succeeds, so `users` refetches.
const addUser = runtime.action((name: string) =>
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.addUser(name);
  }),
);
```

Neither `users` nor `addUser` mentions a key. A route loader or a
`Component.query` that calls `api.listUsers()` refreshes the same way.

`Reactivity.invalidating` fires only when the effect succeeds. A failed write
refreshes nothing. It can also compute the keys from the result:

```ts
const renameUser = (id: string, name: string) =>
  Reactivity.invalidating(updateUser(id, name), (user) => [Users, `user:${user.id}`]);
```

## Keys

```ts
const Users = Reactivity.Key.make("users");   // a key
const user = Reactivity.Key.family("user");   // a parameterized family

user(42);      // the "user:42" key
user.key;      // the "user" parent key
Users.child("admins"); // the "users:admins" key
```

A child key stands for itself **and its ancestors**, for both reads and
writes:

- A read tracking `user(42)` refreshes when `user(42)` or `user.key` is invalidated.
- Invalidating `user(42)` also invalidates `user.key`, so a list that tracks
  the family parent refreshes too.

The cost is occasional over-refreshing. Invalidating `user(1)` reaches every
reader of the `user` parent, which includes readers of `user(2)`. That is
safe; it is just broader than it has to be.

Plain strings work anywhere a key does, and match keys by name (`"users"`
equals `Reactivity.Key.make("users")`). Use them for keys built at runtime.
Keys beginning with `af:` are reserved for the library, and naming one throws.

## Where keys can go

When a read does not go through a tracked service method, attach keys where
the data is consumed instead:

| Where | Tracks (refreshes on) | Invalidates (after success) |
| --- | --- | --- |
| Service methods | `Reactivity.tracked(effect, { keys })` | `Reactivity.invalidating(effect, keys)` |
| Atoms | `atom.pipe(Atom.withReactivity(keys))` | |
| Actions | | `runtime.action(fn, { reactivityKeys })`, `Atom.action(fn, { reactivityKeys })` |
| Component setup | `Component.query(fn, { reactivityKeys })` | `Component.action(fn, { reactivityKeys })` |
| Route loaders | `Route.loader(fn, { reactivityKeys })` | |
| Single flight | | `Route.singleFlight(fn, { reactivityKeys })` |

```ts
const todo = Reactivity.Key.family("todo");

const todos = runtime.atom(fetchTodos()).pipe(Atom.withReactivity([todo.key]));

const toggle = runtime.action(
  (id: number) => toggleTodo(id),
  { reactivityKeys: [todo.key] },
);
```

Tracking in the service is usually better. Tracking in the atom is useful when
the read is not in a service you own, such as a third-party client or a
generated one.

## Batching

Invalidation works without any setup: each invalidation reaches its readers
immediately. Mounting with `Reactivity.live` in the layer batches them
instead. Invalidations are collected and delivered once, on the next
microtask, so five writes in one handler cause one refresh per reader.

```ts
Component.mount(App, {
  props: {},
  target: document.getElementById("app")!,
  layer: Layer.mergeAll(Api.live, Reactivity.live),
});
```

Mounting with `Reactivity.test` holds every invalidation until
`Effect.runSync(Atom.flushReactivity())`, for tests that need to look at the
page between a write and the refresh.

## Testing

Test the behavior, not the keys. Give the runtime a fake service whose read
tracks the key and whose write invalidates it, run the action, then read the
query again:

```ts
import { it, expect } from "vitest";

const FakeApi = () => {
  let names: ReadonlyArray<string> = [];
  return Layer.succeed(Api, {
    listUsers: () => Reactivity.tracked(Effect.sync(() => names), { keys: [Users] }),
    addUser: (name) =>
      Reactivity.invalidating(Effect.sync(() => { names = [...names, name]; return name; }), [Users]),
  });
};

it("adding a user refreshes the list", async () => {
  const runtime = Atom.runtime(FakeApi());
  const users = runtime.atom(Effect.gen(function* () {
    return yield* (yield* Api).listUsers();
  }));
  const addUser = runtime.action((name: string) =>
    Effect.gen(function* () { return yield* (yield* Api).addUser(name); }),
  );

  expect(await Effect.runPromise(Atom.result(users))).toEqual([]);
  await Effect.runPromise(addUser.runEffect("Ada"));
  expect(await Effect.runPromise(Atom.result(users))).toEqual(["Ada"]);
});
```

`Atom.result(atom)` waits for a query's current value as an Effect, so the test
needs no timers.

## Across the network

Keys also decide what a server round trip returns. When a mutation runs
through single flight, the server collects the keys it invalidated, reruns
the matched route loaders that tracked those keys, and sends the fresh loader
data back with the mutation result. The client applies both at once, so there
is no second request. See [Single-Flight Mutations](router.md#single-flight).

A resumable page keeps its queries' keys in the page's resume state, so a
query restored on the client still refreshes when its keys are invalidated.
See the [Resumability Guide](RESUMABILITY_GUIDE.md).

## What keys are not for

Keys are for data that lives outside the page. Atoms already update their
readers: `count.set(1)` needs no key. Use a key when a *write* in one place
must refresh a *read* in another that is coupled only by the data. That is
typically a mutation and the queries or loaders that fetched the same
records.

## API

| API | What it does |
| --- | --- |
| `Reactivity.Key.make(name)` | A key with a literal-typed name. |
| `Reactivity.Key.family(name)` | A function from an id to a child key; `.key` is the parent. |
| `Reactivity.Key.is(value)` | Is this a key (not a plain string)? |
| `Reactivity.tracked(effect, { keys })` | Records the keys when the effect runs inside a reactive read. |
| `Reactivity.invalidating(effect, keys \| (a) => keys)` | Invalidates the keys after the effect succeeds. |
| `Reactivity.live` | Mount with it to batch invalidations to one microtask. |
| `Reactivity.test` | Mount with it to hold invalidations until `Atom.flushReactivity()`. |
| `Reactivity.ReactivityTag` | The service: `invalidate`, `subscribe`, `flush`. |
| `Atom.withReactivity(keys)` | Refreshes an atom when the keys are invalidated. |
| `Atom.reactivityKeys(atom)` | The keys attached by `withReactivity`. |
