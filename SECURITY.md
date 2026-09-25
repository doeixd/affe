# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub security advisories](https://github.com/doeixd/affe/security/advisories/new)
rather than a public issue. Include the affected version, a minimal
reproduction, and the impact you expect. You should get a reply within a
week; fixes are released as a patch version with a changelog entry.

## Supported versions

Affe is pre-1.0. Fixes land on the latest `0.x` release only.

## What the library does for you

- **Escaping.** Strings rendered as children or attributes are escaped, on
  the client and during SSR. Markup is only interpreted through the branded
  `SafeHtml.make(...)`.
- **Cross-site request forgery.** `ServerRoute.execute` / `dispatch` refuse
  state-changing requests that a browser marks as coming from another site
  (see "Cross-Site Request Protection" in `docs/router.md`). Hand-routed
  POST endpoints can call `ServerRoute.checkOrigin(request)`.
- **Serialized state.** Loader data and resume payloads embedded in pages
  are escaped for `<script>` contexts.
- **Agent tools.** The MCP adapter (`@doeixd/affe-ui-agent`) refuses tool
  calls without authentication unless you pass `auth: "none"`, and agent
  governance (approval, audit) fails closed.

## What stays your job

- Authentication and authorization. A route guard protects its page and
  loaders, including during server rendering, but your data endpoints
  (`ServerRoute` handlers, single-flight handlers) are separate requests and
  need their own checks.
- Validating input you do not decode through a Schema.
- A Content Security Policy. Streaming SSR and resumability emit inline
  scripts; pass a `nonce` where the API accepts one.
