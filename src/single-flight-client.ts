/**
 * The slice of `Route` that `Atom`'s single-flight client needs, loaded with
 * `import()` there (Route imports Atom, so a static import would be a cycle).
 *
 * Importing `./Route.js` dynamically instead made bundlers materialize the
 * whole Route namespace object — and so keep every Route export — in every
 * app that reached Route at all, which is every app with a component.
 *
 * @internal
 */
export {
  decodeSingleFlightResponse,
  hydrateSingleFlightPayload,
  invokeSingleFlight,
  resolveRouteSource,
} from "./Route.js";
