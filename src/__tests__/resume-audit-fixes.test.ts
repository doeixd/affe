/**
 * Regression coverage for the resumability audit fixes: compiler write
 * detection and declarator splitting, own-property manifest lookups, the
 * streaming root claim and stranded-queue diagnostics, fragment scope
 * minting, post-dispose fragment mounts, and `installFragment` activation
 * exact-once / dispose-during-activation.
 */
import * as babel from "@babel/core";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Schema,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import resumeExtractPlugin from "../compiler/resume-extract-plugin.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { addEventListener, renderToString, template } from "../dom.js";
import {
  asDocument,
  elementWith,
  fakeDocument,
  type FakeMarkup,
} from "./streaming-fake-dom.js";

const DRIVE = process.platform === "win32" ? "C:" : "";

function transform(source: string): string {
  const result = babel.transformSync(source, {
    filename: `${DRIVE}/app/src/todo.ts`,
    babelrc: false,
    configFile: false,
    plugins: [[resumeExtractPlugin, { buildId: "build-1", root: `${DRIVE}/app` }]],
  });
  if (result?.code == null) throw new Error("Babel produced no output.");
  return result.code;
}

async function evaluateTransformed(
  source: string,
): Promise<Record<string, unknown>> {
  const esm = transform(source);
  const cjs = babel.transformSync(esm, {
    filename: `${DRIVE}/app/src/todo.ts`,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  })?.code;
  if (cjs == null) throw new Error("Babel produced no CommonJS output.");
  const PortableModule = await import("../Portable.js");
  const effect = await import("effect");
  const moduleExports: Record<string, unknown> = {};
  const requireModule = (id: string): unknown => {
    if (id === "effect") return effect;
    if (id === "@doeixd/affe/Portable") return PortableModule;
    if (id === "@doeixd/affe/portable-extract") return {};
    throw new Error(`Unexpected import of "${id}" in generated module.`);
  };
  new Function("require", "exports", "module", cjs)(
    requireModule,
    moduleExports,
    { exports: moduleExports },
  );
  return moduleExports;
}

describe("resume-extract audit fixes", () => {
  const header = `import { extract } from "@doeixd/affe/portable-extract";
import { Effect, Schema } from "effect";
`;

  it("bug 1: rejects an explicit extract that assigns an enclosing-function variable", () => {
    expect(() =>
      transform(`${header}export function make(){ let count = 0; return extract((captures) => Effect.sync(() => { count = captures.n; }),
 { captures: Schema.Struct({ n: Schema.Number }), bind: { n: 1 } }); }`)
    ).toThrow(/assigns to "count"/);
  });

  it("bug 1: rejects update expressions and for-of targets on outer variables", () => {
    expect(() =>
      transform(`${header}export function make(){ let count = 0; return extract(() => Effect.sync(() => { count++; }),
 { captures: Schema.Struct({}), bind: {} }); }`)
    ).toThrow(/assigns to "count"/);
    expect(() =>
      transform(`${header}export function make(){ let item; return extract(() => Effect.sync(() => { for (item of [1]) {} }),
 { captures: Schema.Struct({}), bind: {} }); }`)
    ).toThrow(/assigns to "item"/);
  });

  it("bug 1: rejects outer-scope writes in auto mode instead of capturing them", () => {
    expect(() =>
      transform(`${header}export function make(){ let count = 0; return extract.auto(() => Effect.sync(() => { count += 1; })); }`)
    ).toThrow(/assigns to "count"/);
  });

  it("bug 1: still allows writes to locals and module-scope variables", () => {
    expect(() =>
      transform(`${header}let total = 0;
export function make(){ return extract(() => Effect.sync(() => { let local = 0; local++; total = local; for (const x of [1]) { local = x; } }),
 { captures: Schema.Struct({}), bind: {} }); }`)
    ).not.toThrow();
  });

  it("bug 2: splits at the enclosing declarator when the marker is nested in its init", async () => {
    const mod = await evaluateTransformed(`${header}export const LabelSchema = Schema.Struct({ label: Schema.String }), handlers = { save: extract((c) => Effect.succeed(c.label), { captures: LabelSchema, bind: { label: "hi" } }) };
`);
    expect(mod.handlers).toBeDefined();
    const save = (mod.handlers as { save: Portable.AnyBoundCode }).save;
    expect(Portable.isBoundCode(save)).toBe(true);
    expect(await Effect.runPromise(
      Portable.execute(save) as Effect.Effect<unknown>,
    )).toBe("hi");
  });
});

// ── Client runtime fixtures ────────────────────────────────────────────────

const B = "audit-fixes-build";

interface RecorderService {
  readonly record: (label: string) => Effect.Effect<void>;
}
const Recorder = Context.Service<RecorderService>("affe/test/AuditRecorder");

function makeSink() {
  const calls: string[] = [];
  const layer = Layer.succeed(Recorder, {
    record: (label) =>
      Effect.sync(() => {
        calls.push(label);
      }),
  });
  return { calls, layer };
}

const recordingCode = (id: string) =>
  Portable.code<
    { readonly label: string },
    { readonly label: string },
    readonly [],
    void,
    never,
    RecorderService
  >({
    id,
    buildId: B,
    captures: Schema.Struct({ label: Schema.String }),
    run: (captures) =>
      Effect.gen(function* () {
        const recorder = yield* Recorder;
        yield* recorder.record(captures.label);
      }),
  });
type RecordingCode = ReturnType<typeof recordingCode>;

function collectButton(code: RecordingCode, label: string, installationId?: string) {
  const action = Effect.runSync(
    Component.action(Portable.bind(code, { label })).pipe(
      Effect.provideService(Recorder, {
        record: () => Effect.die("server must not run actions"),
      }),
    ),
  );
  return Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() => {
          const button = template(`<button>${label}`)();
          addEventListener(button, "click", Resume.event(action), true);
          return button;
        }),
      { buildId: B, ...(installationId === undefined ? {} : { installationId }) },
    ).pipe(Effect.provide(Serialization.layer)),
  );
}

function hostPage(installationId: string, extra: ReadonlyArray<FakeMarkup> = []) {
  return fakeDocument([
    {
      kind: "element",
      tag: "button",
      attributes: { "data-af-event-click": `${installationId}:e0`, id: "page" },
    },
    ...extra,
    { kind: "region", id: "slot", edge: "start" },
    { kind: "region", id: "slot", edge: "end" },
  ]);
}

function installPage(
  doc: ReturnType<typeof hostPage>,
  installationId: string,
  pageCode: RecordingCode,
  codes: ReadonlyArray<RecordingCode>,
  runtime: ManagedRuntime.ManagedRuntime<RecorderService, never>,
  onDiagnostic?: (diagnostic: Resume.ClientDiagnostic) => void,
) {
  const resolverEntries: Record<string, RecordingCode> = {};
  for (const code of codes) resolverEntries[code.id] = code;
  const collected = collectButton(pageCode, "page", installationId);
  return Resume.installClient({
    root: asDocument(doc),
    manifest: collected.manifest,
    expectedBuildId: B,
    resolverEntries,
    runtime,
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
  }).pipe(Effect.provide(Serialization.layer));
}

function regionRecord(regionId: string, code: RecordingCode, label: string) {
  return {
    version: 5,
    buildId: B,
    region: regionId,
    events: {
      e0: {
        type: "click",
        invocation: "deferred-no-args",
        code: {
          version: 1,
          kind: "portable.code",
          id: code.id,
          buildId: B,
          captures: { label },
        },
      },
    },
  };
}
const terminalRecord = (...regionIds: ReadonlyArray<string>) => ({
  version: 5,
  buildId: B,
  complete: true,
  regionIds,
});
const regionMarkup = (scope: string, eventId = "e0"): FakeMarkup[] => [
  { kind: "region", id: scope, edge: "start" },
  {
    kind: "element",
    tag: "button",
    attributes: { "data-af-event-click": `${scope}:${eventId}` },
  },
  { kind: "region", id: scope, edge: "end" },
];

describe("resume client audit fixes", () => {
  it("bug 3: validateMarkers rejects a prototype-key marker with a typed error", async () => {
    const pageCode = recordingCode("audit.proto.validate");
    const doc = hostPage("page0", [
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "page0:constructor" },
      },
    ]);
    const runtime = ManagedRuntime.make(makeSink().layer);
    const failure = await Effect.runPromise(
      Effect.flip(installPage(doc, "page0", pageCode, [pageCode], runtime)),
    );
    expect(failure._tag).toBe("ResumeUnknownEventMarkerError");
    await runtime.dispose();
  });

  it("bug 3: the dispatch listener treats a prototype-key marker as unknown", async () => {
    const pageCode = recordingCode("audit.proto.dispatch");
    const doc = hostPage("page0");
    const runtime = ManagedRuntime.make(makeSink().layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const installation = await Effect.runPromise(
      installPage(doc, "page0", pageCode, [pageCode], runtime, (d) => diagnostics.push(d)),
    );
    const button = elementWith(doc, "data-af-event-click");
    button.setAttribute("data-af-event-click", "page0:constructor");
    doc.dispatch("click", button);
    expect(diagnostics.map((d) => d.code)).toEqual(["unknown-event-marker"]);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("bug 3: the streaming listener treats a prototype-key marker as unknown", async () => {
    const code = recordingCode("audit.proto.stream");
    const doc = fakeDocument(regionMarkup("r0", "constructor"));
    const runtime = ManagedRuntime.make(makeSink().layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: B,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (d) => diagnostics.push(d),
      }),
    );
    await Effect.runPromise(installation.ingest(regionRecord("r0", code, "x")));
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    expect(diagnostics.map((d) => d.code)).toEqual(["unknown-event-marker"]);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("bug 4: a second streaming install on one root is rejected until the first is disposed", async () => {
    const code = recordingCode("audit.stream.claim");
    const doc = fakeDocument(regionMarkup("r0"));
    const sink = makeSink();
    const runtime = ManagedRuntime.make(sink.layer);
    const options = {
      root: asDocument(doc),
      expectedBuildId: B,
      resolverEntries: { [code.id]: code },
      runtime,
    };
    const first = await Effect.runPromise(Resume.installClientStreaming(options));
    const second = await Effect.runPromise(
      Effect.flip(Resume.installClientStreaming(options)),
    );
    expect(second._tag).toBe("ResumeDuplicateClientInstallationError");

    await Effect.runPromise(first.ingest(regionRecord("r0", code, "once")));
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await vi.waitFor(() => expect(sink.calls).toEqual(["once"]));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(sink.calls).toEqual(["once"]);

    await Effect.runPromise(first.dispose);
    const third = await Effect.runPromise(Resume.installClientStreaming(options));
    await Effect.runPromise(third.dispose);
    await runtime.dispose();
  });

  it("bug 5: endOfStream reports interactions queued against a region that never arrived", async () => {
    const code = recordingCode("audit.stream.stranded");
    const doc = fakeDocument([...regionMarkup("r0"), ...regionMarkup("r9")]);
    const runtime = ManagedRuntime.make(makeSink().layer);
    const diagnostics: Resume.ClientDiagnostic[] = [];
    const installation = await Effect.runPromise(
      Resume.installClientStreaming({
        root: asDocument(doc),
        expectedBuildId: B,
        resolverEntries: { [code.id]: code },
        runtime,
        onDiagnostic: (d) => diagnostics.push(d),
      }),
    );
    const stranded = doc
      .querySelectorAll("[data-af-event-click]")
      .find((node) => node.getAttribute("data-af-event-click") === "r9:e0")!;
    doc.dispatch("click", stranded);
    expect(installation.inspect().queuedInteractions).toBe(1);
    await Effect.runPromise(installation.ingest(regionRecord("r0", code, "r0")));
    await Effect.runPromise(installation.ingest(terminalRecord("r0")));
    await Effect.runPromise(installation.endOfStream());
    expect(installation.inspect().queuedInteractions).toBe(0);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "unknown-event-marker", eventId: "r9:e0" }),
    ]);
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("bug 6: a fragment scope never aliases the page installation id", async () => {
    const sink = makeSink();
    const pageCode = recordingCode("audit.scope.page");
    const fragmentCode = recordingCode("audit.scope.fragment");
    const doc = hostPage("f1");
    const runtime = ManagedRuntime.make(sink.layer);
    const installation = await Effect.runPromise(
      installPage(doc, "f1", pageCode, [pageCode, fragmentCode], runtime),
    );
    const collected = collectButton(fragmentCode, "fragment");
    const fragment = await Effect.runPromise(
      Resume.mountFragment(installation, "slot", {
        html: collected.html,
        manifest: collected.manifest,
      }),
    );
    expect(fragment.inspect().scope).not.toBe("f1");
    const mounted = doc
      .querySelectorAll("[data-af-event-click]")
      .find((element) => element.getAttribute("id") === null)!;
    doc.dispatch("click", mounted);
    await vi.waitFor(() => expect(sink.calls).toEqual(["fragment"]));
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });

  it("bug 7: mounting a fragment into a disposed installation fails and adds no listener", async () => {
    const pageCode = recordingCode("audit.disposed.page");
    const fragmentCode = recordingCode("audit.disposed.fragment");
    const doc = hostPage("page0");
    const runtime = ManagedRuntime.make(makeSink().layer);
    const installation = await Effect.runPromise(
      installPage(doc, "page0", pageCode, [pageCode, fragmentCode], runtime),
    );
    await Effect.runPromise(installation.dispose);
    expect(doc.listenerCount("click")).toBe(0);
    const collected = collectButton(fragmentCode, "fragment");
    const failure = await Effect.runPromise(
      Effect.flip(
        Resume.mountFragment(installation, "slot", {
          html: collected.html,
          manifest: collected.manifest,
        }),
      ),
    );
    expect(failure._tag).toBe("ResumeConfigurationError");
    expect(doc.listenerCount("click")).toBe(0);
    await runtime.dispose();
  });
});

// ── installFragment activation ──────────────────────────────────────────────

function fragmentFixture(id: string, options: {
  readonly resolveDelay: string;
  readonly runDelay?: string;
}) {
  const counts = { setups: 0, disposals: 0 };
  const activation = Portable.code<
    {},
    {},
    readonly [unknown],
    any,
    never,
    never
  >({
    id,
    buildId: B,
    captures: Schema.Struct({}),
    run: () =>
      Effect.sleep((options.runDelay ?? "0 millis") as "0 millis").pipe(
        Effect.andThen(Effect.sync(() => {
          counts.setups++;
          return {
            dispose: Effect.sync(() => {
              counts.disposals++;
            }),
          };
        })),
      ),
  });
  const manifest = {
    version: 2,
    buildId: B,
    installationId: "p0",
    events: {},
    components: {
      c0: {
        region: { kind: "comment-pair" },
        activation: {
          version: 1,
          kind: "portable.code",
          id: activation.id,
          buildId: B,
          captures: {},
        },
        bindings: {},
      },
    },
  };
  const install = Effect.gen(function* () {
    const resolver = yield* Portable.makeResolver({
      [activation.id]: () =>
        Effect.sleep(options.resolveDelay as "10 millis").pipe(
          Effect.as(activation),
        ),
    });
    return yield* Resume.installFragment("", manifest).pipe(
      Effect.provideService(Portable.Resolver, resolver),
    );
  });
  return { counts, install };
}

describe("Resume.installFragment audit fixes", () => {
  it("bug 8: overlapping activate() calls run setup exactly once", async () => {
    const { counts, install } = fragmentFixture("audit.if.act", {
      resolveDelay: "10 millis",
    });
    const handle = await Effect.runPromise(install);
    await Effect.runPromise(
      Effect.all([handle.activate(), handle.activate()], {
        concurrency: "unbounded",
      }),
    );
    expect(counts.setups).toBe(1);
    expect(await Effect.runPromise(handle.isActive())).toBe(true);
    await Effect.runPromise(handle.activate());
    expect(counts.setups).toBe(1);
    await Effect.runPromise(handle.dispose());
    expect(counts.disposals).toBe(1);
  });

  it("bug 9: dispose() during resolution stops the activation", async () => {
    const { counts, install } = fragmentFixture("audit.if.dispose.resolve", {
      resolveDelay: "20 millis",
    });
    const handle = await Effect.runPromise(install);
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(handle.activate());
        yield* Effect.sleep("5 millis");
        yield* handle.dispose();
        return yield* Fiber.await(fiber);
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("ResumeComponentActivationDisposedError");
    expect(counts.setups).toBe(0);
    expect(await Effect.runPromise(handle.isActive())).toBe(false);
  });

  it("bug 9: activate() after dispose() fails typed rather than dying", async () => {
    const { counts, install } = fragmentFixture("audit.if.after", {
      resolveDelay: "0 millis",
    });
    const handle = await Effect.runPromise(install);
    await Effect.runPromise(handle.dispose());
    const failure = await Effect.runPromise(Effect.flip(handle.activate()));
    expect(failure._tag).toBe("ResumeComponentActivationDisposedError");
    expect(counts.setups).toBe(0);
  });

  it("bug 9: dispose() during setup disposes the late mount", async () => {
    const { counts, install } = fragmentFixture("audit.if.dispose.run", {
      resolveDelay: "0 millis",
      runDelay: "20 millis",
    });
    const handle = await Effect.runPromise(install);
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(handle.activate());
        yield* Effect.sleep("5 millis");
        yield* handle.dispose();
        return yield* Fiber.await(fiber);
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(counts.setups).toBe(1);
    expect(counts.disposals).toBe(1);
    expect(await Effect.runPromise(handle.isActive())).toBe(false);
  });
});
