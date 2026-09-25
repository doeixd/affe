# Examples

```sh
npm install
npm run build
npm run examples      # serves every app below, each on its own port
```

`npm run examples` prints each example's URL. Every one of them is driven in
Chromium by [`browser-tests/examples.spec.ts`](../browser-tests/examples.spec.ts),
so they stay working.

## State and async

| Example | Shows |
| --- | --- |
| [`counter`](counter) | Callable atoms, derived values, batching, shared state, an async card with `Result`. |
| [`todomvc`](todomvc) | TodoMVC: a service layer, runtime queries and actions, filters, optimistic toggles. |
| [`projection`](projection) | `Atom.projection` and `Atom.projectionAsync`: derived maps rebuilt from a draft. |
| [`ooo-async`](ooo-async) | Out-of-order stream chunks assembled in sequence, with `Loading` and `Errored`. |
| [`schema-form`](schema-form) | `AtomSchema` forms: validation, dirty tracking, reset. |
| [`rpc-httpapi`](rpc-httpapi) | `AtomRpc` and `AtomHttpApi` clients as typed queries and mutations. |

## Components, styles and behaviors

| Example | Shows |
| --- | --- |
| [`styled-card`](styled-card) | A slot contract with a style attached from outside the component. |
| [`styled-combobox`](styled-combobox) | A combobox whose styles and keyboard behavior both attach to its slots. |
| [`auto-counter`](auto-counter) | The `Component.setup(...)` builder with explicit slot witnesses (source only). |

## Routing

| Example | Shows |
| --- | --- |
| [`router-basic`](router-basic) | Pages, params and links. |
| [`router-golden-path`](router-golden-path) | Route nodes, loaders, `Route.Link` with active state, a 404. |
| [`router-typed-links`](router-typed-links) | Typed links with params and query strings. |
| [`router-single-flight`](router-single-flight) | A mutation and the loader data it invalidates in one round trip, custom transport. |
| [`router-single-flight-fetch`](router-single-flight-fetch) | The same over `Route.FetchSingleFlightTransport`. |
| [`router-architecture-sketch`](router-architecture-sketch) | A written walkthrough of a larger app's route, service and runtime layout. |

## Server rendering and resumability

| Example | Shows |
| --- | --- |
| [`ssr`](ssr) | `renderToString`, then hydrating a live component. |
| [`resumable-action`](resumable-action) | A server-rendered page that resumes on first click instead of hydrating. |
| [`resumable-extract`](resumable-extract) | The `extract(...)` compiler marker that splits a handler into its own chunk. |
| [`permissive-demo`](permissive-demo) | `@doeixd/affe-permissive`: resumability with automatic capture. |
| [`resumability-benchmark`](resumability-benchmark) | Pages that measure resume against eager hydration (`npm run bench:resumability`). |

The resumability examples have their own build scripts (`npm run
build:resumable-example` and friends in [`package.json`](../package.json)) and
run in the browser suite (`npm run test:browser`).
