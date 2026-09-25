# @doeixd/affe-css

The zero-JavaScript styling floor for [Affe](https://github.com/doeixd/affe).
It renders your theme tokens as CSS custom properties, plus the cascade-layer
order that Affe's style recipes merge into, so server-rendered markup is
styled before any script runs.

The custom-property names are the same token namespace Affe's `Theme` and
recipes resolve against (`color.text.primary` is
`--af-color-text-primary`), so hand-written CSS, recipes and components all
agree.

```sh
npm install @doeixd/affe @doeixd/affe-css effect@4.0.0-rc.117
```

## Usage

```ts
import { foundationStylesheet, tokenVariableName } from "@doeixd/affe-css";

// At build time or on the server: emit once into a <style> or a .css file.
const css = foundationStylesheet();
// @layer defaults, components, variants, utilities, app;
// @layer defaults { :root { color-scheme: light dark; --af-color-...: ...; } }

tokenVariableName("space.md"); // "--af-space-md"
```

- `foundationStylesheet({ tokens, selector })` takes your own token schema
  (defaults to the core default theme) and the selector to scope it to
  (defaults to `:root`).
- Declaring the layer order first is what makes Affe's precedence
  (`defaults` → `components` → `variants` → `utilities` → `app`) hold no
  matter which stylesheet loads first. `cssLayerOrder` is re-exported so
  you never restate it.
- `color-scheme: light dark` lets `Theme.lightDark(...)` token values follow
  the operating system with no JavaScript.
