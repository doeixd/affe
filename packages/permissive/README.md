# @doeixd/affe-permissive

> **Experimental**, like Affe's resumability: it works and is tested end to
> end in a browser, but its API can change in a 0.x minor release.

The permissive preset for [Affe](https://github.com/doeixd/affe)
resumability. A resumable page is server-rendered and ships no component
code up front; the first interaction loads only the handler it needs, with
the values that handler captured.

Affe's default (strict) mode only lets handlers capture plain JSON-safe
values that you declare with a schema. This preset trades that strictness
for convenience: captures are inferred automatically, and the
[seroval](https://github.com/lxsmnsyc/seroval) codec lets them be `Map`s,
`Set`s, `Date`s, class instances and `Promise`s. It is a configuration of the
core, not a fork: everything it uses is a public `@doeixd/affe` API.

```sh
npm install @doeixd/affe @doeixd/affe-permissive effect@4.0.0-rc.117
npm install -D vite @babel/core
```

## Usage

The package has two entries. Build and server code import the root; client
bundles import `/client`, which carries only the codec and never the
compiler.

```ts
// vite.config.ts: the compiler plugins that extract handlers
import { defineConfig } from "vite";
import { permissive } from "@doeixd/affe-permissive";

const preset = permissive({ buildId: "my-app-build-1" });

export default defineConfig({ plugins: [...preset.vitePlugins] });
```

```ts
// server: collect the resumable page with the preset's codec
import { Effect } from "effect";
import * as Resume from "@doeixd/affe/Resume";

const page = await Effect.runPromise(
  Resume.collect(render, { buildId: "my-app-build-1" }).pipe(
    Effect.provide(preset.serverLayer),
  ),
);
```

```ts
// client: decode captures with the matching codec
import { permissiveClient } from "@doeixd/affe-permissive/client";

const client = permissiveClient();
// Provide client.layer to the runtime that decodes the manifest and runs
// resumed handlers.
```

The server and client layers carry the same serializer identity, and a
mismatch fails closed rather than mis-decoding. Read the
[resumability guide](https://github.com/doeixd/affe/blob/main/docs/RESUMABILITY_GUIDE.md)
before shipping a resumable page, especially its security checklist:
permissive captures are more powerful, so what they serialize deserves a
look.
