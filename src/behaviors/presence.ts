/**
 * Presence — exit animations keep content mounted until they finish
 * (`DQ-071`, ratified packaging of the presence machine).
 *
 * `close()` parks the machine in `Exiting` with content still present; the
 * root's `animationend` completes the unmount. Under reduced motion (read
 * from the `ReducedMotion` service AT TRANSITION TIME, never sniffed from a
 * global media query) close unmounts immediately, skipping `Exiting`.
 * Reopening mid-exit cancels the exit, and a stale `animationend` from the
 * cancelled exit does not tear down freshly reopened content.
 *
 * @see docs/design/kit-research/behaviors/presence.md
 */
import { Effect, Schema, Scope } from "effect";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";
import * as Machine from "../Machine.js";
import { ReducedMotion } from "./reduced-motion.js";

export const PresenceOptions = Schema.Struct({
  /** Start mounted (true) or unmounted (false). Default true. */
  initiallyPresent: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
});

export type PresenceOptions = typeof PresenceOptions.Type;

/** Caller-facing config: every Schema knob optional (defaults decode in). */
export type PresenceConfig = typeof PresenceOptions.Encoded;

export type PresencePhase = "mounted" | "exiting" | "unmounted";

export type PresenceBindings = {
  /** Is the content in the tree at all (mounted OR exiting)? */
  readonly isPresent: () => boolean;
  /**
   * The current phase — a derived reader over the machine's reactive state
   * (tracks in reactive contexts). The machine handle stays internal.
   */
  readonly phase: () => PresencePhase;
  readonly open: () => void;
  readonly close: () => void;
};

class Mounted extends Schema.TaggedClass<Mounted>()("PresenceMounted", {}) {}
class Exiting extends Schema.TaggedClass<Exiting>()("PresenceExiting", {}) {}
class Unmounted
  extends Schema.TaggedClass<Unmounted>()("PresenceUnmounted", {})
{}
class OpenEvent extends Schema.TaggedClass<OpenEvent>()("PresenceOpen", {}) {}
class CloseEvent extends Schema.TaggedClass<CloseEvent>()("PresenceClose", {}) {}
class AnimationEndEvent
  extends Schema.TaggedClass<AnimationEndEvent>()("PresenceAnimationEnd", {})
{}

/**
 * Attach presence to the animated root element.
 *
 * The behavior listens for `animationend` on `root` and publishes
 * `isPresent`/`phase` plus `open`/`close` controls. Reduced motion resolves
 * from the `ReducedMotion` service when provided; absent a provision it
 * defaults to full motion (the service's static default).
 *
 * Options decode against `PresenceOptions` at attach time: defaults come
 * from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const presence = (config: PresenceConfig = {}) =>
  Behavior.make<
    { readonly root: Element.Container },
    PresenceBindings,
    Scope.Scope,
    Behavior.BehaviorOptionsError
  >((elements) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "presence",
        PresenceOptions,
        config,
      );
      const maybeReducedMotion = yield* Effect.serviceOption(ReducedMotion);
      const prefersReducedMotion = maybeReducedMotion._tag === "Some"
        ? maybeReducedMotion.value.prefersReducedMotion
        : () => false;

      const Root = Machine.state({
        states: { Mounted, Exiting, Unmounted },
      });
      const targets = Machine.targets(Root);
      const definition = Machine.make({
        id: "af-presence",
        root: Root,
        events: Machine.eventsFromSchemas(OpenEvent, CloseEvent, AnimationEndEvent),
        branches: {
          close: {
            exit: { target: targets.root.Exiting, title: "Animate out" },
            unmount: { target: targets.root.Unmounted, title: "Reduced motion" },
          },
        },
      }).handle({
        initial: {
          target: options.initiallyPresent ? targets.root.Mounted : targets.root.Unmounted,
        },
        states: {
          Mounted: {
            on: {
              // The whole decision in one branch: with motion, close parks in
              // Exiting and waits; under reduced motion it unmounts NOW.
              PresenceClose: {
                branches: "close",
                resolve: ({ select }: any) =>
                  prefersReducedMotion() ? select.unmount() : select.exit(),
              },
            },
          },
          Exiting: {
            on: {
              PresenceAnimationEnd: { target: targets.root.Unmounted },
              // Reopening mid-exit cancels the exit; a stale animationend then
              // arrives in Mounted, which has no handler for it — ignored.
              PresenceOpen: { target: targets.root.Mounted },
            },
          },
          Unmounted: {
            on: { PresenceOpen: { target: targets.root.Mounted } },
          },
        },
      });

      // An authored definition failing to spawn is a defect, not a typed error.
      const machine = yield* Machine.spawn(definition).pipe(Effect.orDie);

      const phaseOf = (): PresencePhase =>
        machine.matches("Mounted")
          ? "mounted"
          : machine.matches("Exiting")
            ? "exiting"
            : "unmounted";
      // `machine.state` is reactive Component.state, so reading `matches`
      // inside a reactive computation tracks transitions — `phase` is a
      // derived reader, not a copy.
      const phase = phaseOf;

      yield* elements.root.on("animationend", () => {
        machine.send(new AnimationEndEvent());
      });

      return {
        isPresent: () => phase() !== "unmounted",
        phase,
        open: () => machine.send(new OpenEvent()),
        close: () => machine.send(new CloseEvent()),
      } satisfies PresenceBindings;
    })
  ).pipe(
    Behavior.provides({
      phase: Behavior.binding<"phase", () => PresencePhase>("phase"),
      isPresent: Behavior.binding<"isPresent", () => boolean>("isPresent"),
    }),
  );
