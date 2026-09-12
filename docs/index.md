---
layout: home
hero:
  name: notio
  text: A TypeScript web framework on Express 5
  tagline: A typed, chainable router; a per-request context; unified errors; hooks; logging; config — and optional modules for auth, uploads, rate limiting, and OpenAPI.
  actions:
    - theme: brand
      text: Get started
      link: /guide/router
    - theme: alt
      text: Examples
      link: /examples
features:
  - title: Express is the transport
    details: app.express is always the real Express instance. Any (req, res, next) middleware from the ecosystem works unchanged.
  - title: Typed end to end
    details: Path params inferred from the route string, Standard Schema validation for query/body/headers, Middleware<Adds> narrowing across the chain.
  - title: Nothing implicit at boot
    details: Modules are constructed by you and passed where needed. Missing config or adapter methods fail at startup, listed together.
---
