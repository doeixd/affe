/**
 * route-pattern.ts — the one path-segment engine (R5.4).
 *
 * `Route` and `ServerRoute` used to carry separate matchers whose grammars
 * drifted (`Route` had `:name?` but no `*`; `ServerRoute` had `*` but no
 * `:name?`; `Route.link` had a third, string-replace parser that emitted
 * malformed URLs for optional segments). This module owns the grammar —
 * `static`, `:param`, `:param?`, `*` — and matching, extraction, and
 * substitution all read the same parse, so the engines cannot disagree about
 * what a pattern means.
 *
 * Semantics, frozen here:
 * - `:param?` may appear anywhere, but a segment may only be *absent* when
 *   every following segment is also optional (in practice: trailing).
 * - `*` consumes the rest of the path and requires **at least one** segment;
 *   its captured value keys as `"*"`, slash-joined.
 * - Non-exact matching is prefix matching: extra path segments are allowed.
 */

export interface PatternSegment {
  readonly kind: "static" | "param" | "splat";
  /** Param name; `"*"` for splat; the raw text for static segments. */
  readonly name: string;
  readonly optional: boolean;
  readonly raw: string;
}

export function parsePattern(pattern: string): ReadonlyArray<PatternSegment> {
  return pattern
    .split("/")
    .filter((part) => part.length > 0)
    .map((raw) => {
      if (raw === "*") {
        return { kind: "splat" as const, name: "*", optional: false, raw };
      }
      if (raw.startsWith(":")) {
        const optional = raw.endsWith("?");
        return {
          kind: "param" as const,
          name: raw.slice(1, optional ? -1 : undefined),
          optional,
          raw,
        };
      }
      return { kind: "static" as const, name: raw, optional: false, raw };
    });
}

function splitPath(pathname: string): ReadonlyArray<string> {
  return pathname.split("/").filter((part) => part.length > 0);
}

function remainingAreOptional(
  segments: ReadonlyArray<PatternSegment>,
  from: number,
): boolean {
  for (let index = from; index < segments.length; index += 1) {
    if (!(segments[index]!.kind === "param" && segments[index]!.optional)) {
      return false;
    }
  }
  return true;
}

export function matchPatternSegments(
  pattern: string,
  pathname: string,
  exact: boolean,
): boolean {
  return extractPatternParams(pattern, pathname, exact) !== null;
}

/**
 * Extract params for a matching pattern, or `null` when it does not match.
 * Matching and extraction are the same walk, so they cannot disagree.
 */
/** `decodeURIComponent` that reports a malformed escape (`%zz`) as `undefined`. */
function safeDecode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

export function extractPatternParams(
  pattern: string,
  pathname: string,
  exact: boolean,
): Record<string, string> | null {
  const segments = parsePattern(pattern);
  const parts = splitPath(pathname);
  const out: Record<string, string> = {};
  let partIndex = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.kind === "splat") {
      const rest = parts.slice(partIndex);
      if (rest.length === 0) return null;
      const decoded = rest.map(safeDecode);
      // A malformed escape is not a match (a 404), never a thrown URIError.
      if (decoded.some((part) => part === undefined)) return null;
      out["*"] = decoded.join("/");
      return out;
    }
    const part = parts[partIndex];
    if (part === undefined) {
      return remainingAreOptional(segments, index) ? out : null;
    }
    if (segment.kind === "param") {
      const decoded = safeDecode(part);
      if (decoded === undefined) return null;
      out[segment.name] = decoded;
      partIndex += 1;
      continue;
    }
    if (segment.raw !== part) return null;
    partIndex += 1;
  }
  if (exact && partIndex !== parts.length) return null;
  return out;
}

/**
 * Build a concrete path from a pattern and encoded param values.
 *
 * An absent optional segment disappears entirely (`DQ-038`: never a stray `?`
 * in an emitted URL). An absent *required* param keeps its raw `:name` text,
 * preserving the historical `Route.link` behaviour for partial substitution.
 */
export function substitutePattern(
  pattern: string,
  params: Readonly<Record<string, unknown>>,
  encode: (value: string) => string = encodeURIComponent,
): string {
  const parts: string[] = [];
  for (const segment of parsePattern(pattern)) {
    if (segment.kind === "static") {
      parts.push(segment.raw);
      continue;
    }
    const value = params[segment.name];
    if (segment.kind === "splat") {
      if (value !== undefined && value !== null && String(value).length > 0) {
        // Encode each segment but keep the separators: a splat spans segments.
        parts.push(String(value).split("/").map(encode).join("/"));
      }
      continue;
    }
    if (value === undefined || value === null) {
      if (!segment.optional) parts.push(segment.raw);
      continue;
    }
    parts.push(encode(String(value)));
  }
  return `/${parts.join("/")}`;
}

// ─── Specificity ranking (R5) ───────────────────────────────────────────────
//
// Sibling patterns can match the same path (`/users/new` and `/users/:id`
// both match `/users/new`). Declaration order must not decide which branch
// wins, so siblings are ranked segment by segment, left to right:
//
//   static  >  :param  >  :param?  >  *  >  (no segment)
//
// This is the React Router / Remix ordering. Equal-rank patterns keep
// declaration order (the sort is stable).

function segmentRank(segment: PatternSegment | undefined): number {
  if (segment === undefined) return 0;
  if (segment.kind === "static") return 4;
  if (segment.kind === "splat") return 1;
  return segment.optional ? 2 : 3;
}

/**
 * Compare two patterns by specificity. Negative when `a` is MORE specific
 * than `b` (so it sorts first), positive when less, `0` for a tie.
 */
export function comparePatternSpecificity(a: string, b: string): number {
  const left = parsePattern(a);
  const right = parsePattern(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = segmentRank(right[index]) - segmentRank(left[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Pick the most specific of several patterns that all match (ties keep the
 * first). Returns `undefined` for an empty list.
 */
export function mostSpecific<T>(
  items: ReadonlyArray<T>,
  patternOf: (item: T) => string,
): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (best === undefined || comparePatternSpecificity(patternOf(item), patternOf(best)) < 0) {
      best = item;
    }
  }
  return best;
}

function segmentKey(pattern: string): ReadonlyArray<string> {
  return parsePattern(pattern).map((segment) => segment.raw);
}

function isStrictSegmentPrefix(
  prefix: ReadonlyArray<string>,
  of: ReadonlyArray<string>,
): boolean {
  if (prefix.length >= of.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== of[index]) return false;
  }
  return true;
}

/**
 * Prune a set of already-matched route items to the single most specific
 * branch, preserving the input order of the survivors.
 *
 * Route trees here nest by pattern: an item's parent is the longest other
 * matched pattern that is a segment-prefix of it, and items with the same
 * segments (a layout and its index route, a pathless layout) share a node.
 * Starting from the roots, each level keeps only its most specific sibling:
 *
 * 1. a sibling whose branch consumes the whole pathname (some pattern in its
 *    subtree matches exactly) beats one that only prefix-matches;
 * 2. otherwise {@link comparePatternSpecificity} decides;
 * 3. ties keep declaration order.
 *
 * So for `/users/new`, `/users/:id` (and everything under it) is dropped when
 * `/users/new` is declared as its sibling, in either order.
 */
export function selectMostSpecificBranch<T>(
  matched: ReadonlyArray<T>,
  patternOf: (item: T) => string,
  pathname: string,
): ReadonlyArray<T> {
  if (matched.length < 2) return matched;
  interface Node {
    readonly key: string;
    readonly pattern: string;
    readonly segments: ReadonlyArray<string>;
    readonly children: Array<Node>;
    parent: Node | undefined;
  }
  const nodes: Array<Node> = [];
  const byKey = new Map<string, Node>();
  for (const item of matched) {
    const pattern = patternOf(item);
    const segments = segmentKey(pattern);
    const key = segments.join("/");
    if (byKey.has(key)) continue;
    const node: Node = { key, pattern, segments, children: [], parent: undefined };
    byKey.set(key, node);
    nodes.push(node);
  }
  if (nodes.length < 2) return matched;
  for (const node of nodes) {
    let parent: Node | undefined;
    for (const candidate of nodes) {
      if (!isStrictSegmentPrefix(candidate.segments, node.segments)) continue;
      if (parent === undefined || candidate.segments.length > parent.segments.length) {
        parent = candidate;
      }
    }
    node.parent = parent;
    parent?.children.push(node);
  }
  const consumes = new Map<Node, boolean>();
  const consumesPath = (node: Node): boolean => {
    const cached = consumes.get(node);
    if (cached !== undefined) return cached;
    const result = extractPatternParams(node.pattern, pathname, true) !== null
      || node.children.some(consumesPath);
    consumes.set(node, result);
    return result;
  };
  const kept = new Set<string>();
  let level = nodes.filter((node) => node.parent === undefined);
  while (level.length > 0) {
    let best: Node | undefined;
    for (const node of level) {
      if (best === undefined) {
        best = node;
        continue;
      }
      const nodeConsumes = consumesPath(node);
      const bestConsumes = consumesPath(best);
      if (nodeConsumes !== bestConsumes) {
        if (nodeConsumes) best = node;
        continue;
      }
      if (comparePatternSpecificity(node.pattern, best.pattern) < 0) best = node;
    }
    kept.add(best!.key);
    level = best!.children;
  }
  return matched.filter((item) => kept.has(segmentKey(patternOf(item)).join("/")));
}
