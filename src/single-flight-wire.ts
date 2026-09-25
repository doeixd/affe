/**
 * The single-flight wire contract: the envelope schema, its encode/decode, and
 * the client fetch — everything a client needs to run a single-flight action,
 * without the router.
 *
 * `Atom` imports this statically. It used to `import("./Route.js")` for these
 * (Route imports Atom, so a static import was a cycle); bundlers turn every
 * `import()` target into a chunk entry before tree-shaking, which kept the
 * router, loader cache and head store in every app with a component.
 *
 * Hydrating returned loader data needs the router, so `Route` registers the
 * hydrator when it loads ({@link registerSingleFlightHydrator}); an app that
 * never loads `Route` has no loaders to hydrate.
 *
 * `Route` re-exports the public names.
 */
import { Effect, Schema } from "effect";
import * as Serialization from "./Serialization.js";
import type { RouteSource, SingleFlightPayload, SingleFlightRequest } from "./Route.js";

/** The transport failed: network, endpoint, or the action itself. */
export class SingleFlightInvokeError extends /*#__PURE__*/ (() => Schema.TaggedError<SingleFlightInvokeError>(
  "affe/SingleFlightInvokeError",
)("SingleFlightInvokeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}))() {}

/**
 * The transport succeeded but the response failed schema validation.
 *
 * Distinct from {@link SingleFlightInvokeError} because the remedies differ:
 * a malformed payload is deploy skew or tampering, a failed transport is a
 * retry.
 */
export class SingleFlightDecodeError extends /*#__PURE__*/ (() => Schema.TaggedError<SingleFlightDecodeError>(
  "affe/SingleFlightDecodeError",
)("SingleFlightDecodeError", {
  message: Schema.String,
}))() {}

export const SingleFlightWireLoaderEntrySchema = /*#__PURE__*/ (() => Schema.Struct({
  routeId: Schema.String,
  // Suspended: this module is evaluated while `Serialization` may still be
  // initializing (Atom imports this module, and Serialization's imports
  // reach Atom), so the wire schema is read on first use, not at load.
  result: Schema.suspend(() => Serialization.ResultWire),
}))();

export const SingleFlightWirePayloadSchema = /*#__PURE__*/ (() => Schema.Struct({
  // `undefined` mutation values (void actions) are dropped by JSON, so the
  // field is optional on the wire.
  mutation: Schema.optional(Schema.Unknown),
  url: Schema.String,
  loaders: Schema.Array(SingleFlightWireLoaderEntrySchema),
}))();

/**
 * Wire version of the single-flight envelope (`DQ-091`, closed 2026-08-17).
 * Bump on any envelope-shape change. The version rides on the ENVELOPE, not
 * the payload, so a client from build N talking to a server from build N+1
 * fails closed with a decode error instead of misreading the shape — the
 * same rule the loader handoff already follows.
 */
export const singleFlightWireVersion = 1 as const;

export const SingleFlightResponseSchema = /*#__PURE__*/ (() => Schema.Union([
  Schema.Struct({
    version: Schema.Literal(singleFlightWireVersion),
    ok: Schema.Literal(true),
    payload: SingleFlightWirePayloadSchema,
  }),
  Schema.Struct({
    version: Schema.Literal(singleFlightWireVersion),
    ok: Schema.Literal(false),
    error: Schema.Unknown,
  }),
]))();

/** The schema-validated response shape a single-flight handler emits. */
export type SingleFlightWireResponse = typeof SingleFlightResponseSchema.Type;

/** Project one in-memory payload onto the validated wire envelope. */
export function encodeSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
): typeof SingleFlightWirePayloadSchema.Type {
  return {
    mutation: Serialization.encodeWireValue(payload.mutation),
    url: payload.url,
    loaders: payload.loaders.map((entry) => ({
      routeId: entry.routeId,
      result: Serialization.resultToWire(entry.result),
    })),
  };
}

/**
 * Validate one raw single-flight response at the trust boundary and rehydrate
 * its payload.
 *
 * Validation goes through the injected `Serialization` service when present
 * (falling back to the schema codec), so a transport with a richer wire format
 * can swap the decoder without touching call sites. A structurally invalid
 * response is a typed {@link SingleFlightDecodeError} — never a defect — and
 * nothing is hydrated from it.
 */
export function decodeSingleFlightResponse<A>(
  raw: unknown,
): Effect.Effect<
  SingleFlightPayload<A>,
  SingleFlightInvokeError | SingleFlightDecodeError
> {
  return Effect.gen(function* () {
    // DQ-080 decided EXACTLY two arms. An envelope carrying both (`ok: true`
    // plus an `error`, or `ok: false` plus a `payload`) is internally
    // inconsistent — tampering or a broken proxy — and must fail closed
    // rather than having the surplus arm silently stripped by the schema
    // and the remaining one believed.
    if (typeof raw === "object" && raw !== null) {
      const record = raw as { readonly error?: unknown; readonly payload?: unknown };
      if (record.error !== undefined && record.payload !== undefined) {
        return yield* new SingleFlightDecodeError({
          message:
            "Single-flight response carries both envelope arms; the two-arm contract admits exactly one.",
        });
      }
    }
    const serialization = yield* Effect.serviceOption(Serialization.Tag);
    const decoded = yield* (serialization._tag === "Some"
      ? serialization.value.deserialize(
          SingleFlightResponseSchema,
          JSON.stringify(raw),
        )
      : Schema.decodeUnknownEffect(SingleFlightResponseSchema)(raw)
    ).pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(
          new SingleFlightDecodeError({
            message: `Single-flight response failed wire validation: ${String(error)}`,
          }),
        ),
      ),
    );
    if (!decoded.ok) {
      return yield* new SingleFlightInvokeError({
        message: "Single-flight action failed",
        cause: decoded.error,
      });
    }
    return {
      mutation: Serialization.decodeWireValue(decoded.payload.mutation) as A,
      url: decoded.payload.url,
      loaders: decoded.payload.loaders.map((entry) => ({
        routeId: entry.routeId,
        result: Serialization.resultFromWire(entry.result),
      })),
    };
  });
}

type SingleFlightHydrator = (
  payload: SingleFlightPayload<unknown>,
  app: RouteSource | undefined,
) => Effect.Effect<void>;

let hydrator: SingleFlightHydrator | undefined;

/** Called by `Route` when it loads. @internal */
export function registerSingleFlightHydrator(next: SingleFlightHydrator): void {
  hydrator = next;
}

/** Seed returned loader data into the route cache, when the router is loaded. */
export function hydrateSingleFlightResult(
  payload: SingleFlightPayload<unknown>,
  app?: RouteSource,
): Effect.Effect<void> {
  return hydrator === undefined ? Effect.void : hydrator(payload, app);
}

type FetchLike = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string },
) => Promise<{ readonly json: () => Promise<unknown> }>;

/** POST a single-flight request and validate the response. Does not hydrate. */
export function fetchSingleFlight<Args extends ReadonlyArray<unknown>, A>(
  endpoint: string,
  request: SingleFlightRequest<Args>,
  fetchImpl?: FetchLike,
): Effect.Effect<SingleFlightPayload<A>, SingleFlightInvokeError | SingleFlightDecodeError> {
  return Effect.tryPromise({
    try: async () => {
      const run = fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as Promise<{ readonly json: () => Promise<unknown> }>);
      const response = await run(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      return await response.json();
    },
    catch: (cause) =>
      new SingleFlightInvokeError({
        message: "Failed to invoke single-flight endpoint",
        cause,
      }),
  }).pipe(
    // Validation before hydration: a malformed response is a typed decode
    // failure and seeds nothing into the loader cache.
    Effect.flatMap((raw) => decodeSingleFlightResponse<A>(raw)),
  );
}
