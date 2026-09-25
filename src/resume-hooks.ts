/**
 * The render-time observation hooks of a resume session, behind a slot.
 *
 * `dom.ts` and `Component.ts` call these on every render, but they only do
 * anything while a server resume session is collecting. The implementation
 * lives in `resume-session.ts` and installs itself here when the first
 * session is made, so an app that never renders a resumable page does not
 * bundle the session collector. Until then each hook is its no-session
 * fallback.
 *
 * @internal
 */
import type * as Session from "./resume-session.js";
import type { ExpressionTargetValue, ResumableExpression } from "./resume-expression.js";
import type { SetupPlan } from "./Component.js";

export interface ResumeSessionHooks {
  readonly observeDirectEventHandler: typeof Session.observeDirectEventHandler;
  readonly observeRenderedExpression: typeof Session.observeRenderedExpression;
  readonly observeRenderedExpressionTarget: typeof Session.observeRenderedExpressionTarget;
  readonly observeServerEventTarget: typeof Session.observeServerEventTarget;
  readonly observeCommittedComponentBindings: typeof Session.observeCommittedComponentBindings;
  readonly observeRenderedComponentBoundary: typeof Session.observeRenderedComponentBoundary;
  readonly withRenderedComponentOwner: typeof Session.withRenderedComponentOwner;
}

let hooks: ResumeSessionHooks | undefined;

/** Called by `resume-session.ts` whenever a session is made. */
export function installResumeSessionHooks(next: ResumeSessionHooks): void {
  hooks = next;
}

const noMarkers: Readonly<Record<string, string>> = Object.freeze({});

export function observeDirectEventHandler(target: object, eventType: string, handler: unknown): void {
  hooks?.observeDirectEventHandler(target, eventType, handler);
}

export function observeRenderedExpression(
  expression: ResumableExpression,
  insertion: object,
  evaluate: () => unknown,
): unknown {
  return hooks === undefined ? evaluate() : hooks.observeRenderedExpression(expression, insertion, evaluate);
}

export function observeRenderedExpressionTarget(
  element: object,
  expression: ResumableExpression,
  registration: object,
  target: ExpressionTargetValue,
  evaluate: () => unknown,
): Session.ObservedExpressionTarget {
  return hooks === undefined
    ? { write: true, value: evaluate() }
    : hooks.observeRenderedExpressionTarget(element, expression, registration, target, evaluate);
}

export function observeServerEventTarget(target: object): Readonly<Record<string, string>> {
  return hooks === undefined ? noMarkers : hooks.observeServerEventTarget(target);
}

export function observeCommittedComponentBindings(
  componentValue: object,
  definitionName: string | undefined,
  plan: SetupPlan,
  props: unknown,
  bindings: unknown,
): void {
  hooks?.observeCommittedComponentBindings(componentValue, definitionName, plan, props, bindings);
}

export function observeRenderedComponentBoundary(result: unknown, bindings: unknown): unknown {
  return hooks === undefined ? result : hooks.observeRenderedComponentBoundary(result, bindings);
}

export function withRenderedComponentOwner<A>(bindings: unknown, evaluate: () => A): A {
  return hooks === undefined ? evaluate() : hooks.withRenderedComponentOwner(bindings, evaluate);
}
