# @doeixd/affe-ui-agent

> **Experimental**, like Affe's agent surface: it works and is tested, but
> its API can change in a 0.x minor release.

An MCP server for an [Affe](https://github.com/doeixd/affe) agent catalog.
The catalog is the list of actions your app already exposes; this package
turns the entries marked `access: { agent: true }` into MCP tools and runs
every tool call through the **same** dispatch pipeline your UI and HTTP
callers use: schema-checked arguments, approval and audit services, build
drift checks, typed errors.

It is transport-neutral: `listTools` and `callTool` are plain functions you
bind to stdio, HTTP, or whatever your MCP host speaks. There is no MCP SDK
dependency.

```sh
npm install @doeixd/affe @doeixd/affe-ui-agent effect@4.0.0-rc.117
```

## Usage

```ts
import { Effect, Schema } from "effect";
import * as Agent from "@doeixd/affe/Agent";
import * as Portable from "@doeixd/affe/Portable";
import { mcpAuthLayer, mcpServer } from "@doeixd/affe-ui-agent";

const addTodo = Portable.code({
  id: "todo.add",
  buildId: "my-app-build-1",
  captures: Schema.Struct({}),
  run: (_captures, title: string) => Effect.succeed({ title }),
});

const catalog = Agent.catalog({
  addTodo: Agent.expose(addTodo, {
    args: Schema.Tuple([Schema.String]),
    success: Schema.Struct({ title: Schema.String }),
    description: "Add a todo item",
    access: { agent: true },
  }),
});

const server = await Effect.runPromise(mcpServer(catalog));

// Authentication is required by default. Provide an authenticator per call;
// the identity it returns is what the audit trail records.
const auth = mcpAuthLayer({
  authenticate: () =>
    Effect.succeed({ caller: "mcp", user: "user-42", lineage: undefined }),
});

const tools = await Effect.runPromise(server.listTools());
const result = await Effect.runPromise(
  server
    .callTool({ name: "addTodo", arguments: { title: "Ship it" } })
    .pipe(Effect.provide(auth)),
);
```

- A call without an authenticator is refused with
  `McpAuthenticationRequiredError`. For a trusted local transport, opt out
  explicitly with `mcpServer(catalog, { auth: "none" })`.
- A tool that exists but is not exposed to agents is refused with
  `McpToolNotExposedError`, distinct from `McpUnknownToolError`.
- Errors are typed values in `structuredContent`, never stringified.

See the [agent surface guide](https://github.com/doeixd/affe/blob/main/docs/AGENT_SURFACE_GUIDE.md)
for catalogs, governance services and generative UI.
