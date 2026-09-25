/**
 * Regression coverage for the DOM runtime audit (src/dom.ts): function-child
 * unwrapping, server serialization escaping, single→array reconciliation,
 * entity decoding in parsed templates, SSR property writes, attribute-name
 * validation, server classList, and repeated `render` on one container.
 */
import { transformSync } from "@babel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runtime from "../runtime.js";
import { createSignal, flush } from "../api.js";
import * as Component from "../Component.js";
import * as SafeHtml from "../SafeHtml.js";
import {
  createComponent,
  createServerDocument,
  insert,
  render,
  renderToString,
  spread,
} from "../dom.js";

function compileExecutable<Module>(source: string): Module {
  const result = transformSync(source, {
    filename: "dom-audit.tsx",
    configFile: "./babel.config.json",
  });
  if (result?.code == null) throw new Error("Expected Babel output.");
  const imports: Array<{ readonly imported: string; readonly local: string }> = [];
  const withoutImports = result.code.replace(
    /import\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*"@doeixd\/affe\/runtime";?/g,
    (_statement, imported: string, local: string) => {
      imports.push({ imported, local });
      return "";
    },
  );
  const body = withoutImports.replace(/\bexport\s+default\s+/, "return ");
  const bindings = imports
    .map(({ imported, local }) => `const ${local} = __runtime.${imported};`)
    .join("\n");
  return Function("__runtime", `"use strict";\n${bindings}\n${body}`)(runtime) as Module;
}

type Carrier = Record<string, unknown>;
const carrier = globalThis as unknown as Carrier;

/** Install the server document as a client `document` (no DOM library). */
function installClientDocument(): () => void {
  const hadDocument = "document" in carrier;
  const hadNode = "Node" in carrier;
  const previousDocument = carrier.document;
  const previousNode = carrier.Node;
  const doc = createServerDocument() as { createElement(tag: string): object };
  const element = doc.createElement("div");
  carrier.document = doc;
  carrier.Node = Object.getPrototypeOf(Object.getPrototypeOf(element)).constructor;
  return () => {
    if (hadDocument) carrier.document = previousDocument;
    else delete carrier.document;
    if (hadNode) carrier.Node = previousNode;
    else delete carrier.Node;
  };
}

function html(node: unknown): string {
  return (node as { toHTML(): string }).toHTML();
}

function newElement(tag = "div"): Element {
  return (carrier.document as Document).createElement(tag);
}

const Hi = Component.make(Component.setup(), () => "hi");

describe("server render: function children (bug 1)", () => {
  it("renders a component returned from a conditional expression", () => {
    const view = compileExecutable<(A: unknown, v: () => boolean) => unknown>(
      `export default (A, v) => <div>{v() ? <A/> : "no"}</div>`,
    );
    expect(renderToString(() => view(Hi, () => true))).toBe("<div>hi</div>");
    expect(renderToString(() => view(Hi, () => false))).toBe("<div>no</div>");
  });

  it("renders a component returned directly from the render function", () => {
    expect(renderToString(() => createComponent(Hi as never, {}))).toBe("hi");
  });

  it("renders a view that returns another component", () => {
    const Outer = Component.make(
      Component.setup(),
      () => createComponent(Hi as never, {}),
    );
    const view = compileExecutable<(A: unknown) => unknown>(
      `export default (A) => <section><A/></section>`,
    );
    expect(renderToString(() => view(Outer))).toBe("<section>hi</section>");
  });
});

describe("server render: top-level value serialization (bug 2)", () => {
  it("escapes a top-level string", () => {
    expect(renderToString(() => "<img src=x onerror=alert(1)>")).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
  });

  it("escapes a top-level string returned by a component view", () => {
    const Echo = Component.make(
      Component.props<{ readonly text: string }>(),
      Component.require<never>(),
      Component.setup<{ readonly text: string }>(),
      (props) => props.text,
    );
    expect(
      renderToString(() => createComponent(Echo as never, { text: "<b>x</b>" })),
    ).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  it("unwraps SafeHtml and drops booleans at top level", () => {
    expect(renderToString(() => SafeHtml.make("<b>ok</b>"))).toBe("<b>ok</b>");
    expect(renderToString(() => [false, "a", true, null, 1])).toBe("a1");
  });
});

describe("client runtime", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installClientDocument();
  });
  afterEach(() => restore());

  it("renders a Component.make component through render (bug 1)", () => {
    const target = newElement();
    const dispose = render(() => createComponent(Hi as never, {}), target);
    expect(html(target)).toBe("<div>hi</div>");
    dispose();
  });

  it("re-renders nested accessors reactively (bug 1)", () => {
    const target = newElement();
    const [show, setShow] = createSignal(false);
    const dispose = render(
      () => () => (show() ? () => "yes" : "no"),
      target,
    );
    expect(html(target)).toBe("<div>no</div>");
    setShow(true);
    flush();
    expect(html(target)).toBe("<div>yes</div>");
    dispose();
  });

  it("switches a child from a single value to an array (bug 3)", () => {
    const parent = newElement();
    const [list, setList] = createSignal(false);
    const dispose = render(() => {
      const inner = newElement();
      insert(inner, () => (list() ? ["a", "b"] : "x"));
      return inner;
    }, parent);
    expect(html(parent)).toBe("<div><div>x</div></div>");
    setList(true);
    flush();
    expect(html(parent)).toBe("<div><div>ab</div></div>");
    setList(false);
    flush();
    expect(html(parent)).toBe("<div><div>x</div></div>");
    dispose();
  });

  it("disposing a superseded mount does not wipe the new mount (bug 13)", () => {
    const target = newElement();
    const first = render(() => "first", target);
    const second = render(() => "second", target);
    expect(html(target)).toBe("<div>second</div>");
    first();
    expect(html(target)).toBe("<div>second</div>");
    second();
    expect(html(target)).toBe("<div></div>");
  });

  it("classList can remove a class that came from the template (bug 12)", () => {
    const el = newElement();
    (el as unknown as { className: string }).className = "a b";
    el.classList.toggle("a", false);
    el.classList.add("c");
    expect(el.getAttribute("class")).toBe("b c");
    expect(el.classList.contains("a")).toBe(false);
    (el as unknown as { className: string }).className = "z";
    expect(el.classList.contains("b")).toBe(false);
    expect(el.classList.contains("z")).toBe(true);
  });
});

describe("server template parsing: entities (bug 9)", () => {
  it("decodes entities in text and attribute values exactly once", () => {
    const view = compileExecutable<() => unknown>(
      `export default () => <a title="a &amp; b">x &lt; y</a>`,
    );
    expect(renderToString(() => view())).toBe(
      `<a title="a &amp; b">x &lt; y</a>`,
    );
  });

  it("decodes named and numeric entities", () => {
    const view = compileExecutable<() => unknown>(
      `export default () => <p>&copy; 2026&nbsp;&#65;&#x42;</p>`,
    );
    expect(renderToString(() => view())).toBe("<p>© 2026 AB</p>");
  });
});

describe("server render: compiled property writes (bug 10)", () => {
  it("serializes value, checked, selected, data, textContent, innerHTML", () => {
    const view = compileExecutable<
      (v: () => string, t: () => boolean, s: () => string, h: () => string) => unknown
    >(`export default (v, t, s, h) => (
      <div>
        <input value={v()} checked={t()} />
        <span>{s()} x</span>
        <p textContent={s()} />
        <p innerHTML={h()} />
        <textarea value={v()} />
        <select value={v()}><option value="a">A</option><option value={v()}>B</option></select>
      </div>
    )`);
    const out = renderToString(() =>
      view(() => "q\"v", () => true, () => "<t>", () => "<b>raw</b>")
    );
    expect(out).toContain(`<input value="q&quot;v" checked="">`);
    expect(out).toContain(`<span>&lt;t&gt; x</span>`);
    expect(out).toContain(`<p>&lt;t&gt;</p>`);
    expect(out).toContain(`<p><b>raw</b></p>`);
    expect(out).toContain(`<textarea>q&quot;v</textarea>`);
    expect(out).toContain(`<option value="a">A</option><option value="q&quot;v" selected="">B</option>`);
  });

  it("omits a false checked property", () => {
    const view = compileExecutable<(t: () => boolean) => unknown>(
      `export default (t) => <input checked={t()} />`,
    );
    expect(renderToString(() => view(() => false))).toBe("<input>");
  });
});

describe("server render: attribute names (bug 11)", () => {
  it("rejects an invalid attribute name like the browser's setAttribute", () => {
    renderToString(() => {
      const el = (carrier.document as Document).createElement("div");
      expect(() => el.setAttribute("x onmouseover=alert(1) y", "1")).toThrow(
        /not a valid attribute name/,
      );
      return el;
    });
  });

  it("does not let a spread attribute name inject markup", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = renderToString(() => {
        const el = (carrier.document as Document).createElement("div");
        spread(el, { ok: "2", "x onmouseover=alert(1) y": "1" });
        return el;
      });
      expect(out).toBe(`<div ok="2"></div>`);
      expect(out).not.toContain("onmouseover");
    } finally {
      errors.mockRestore();
    }
  });
});
