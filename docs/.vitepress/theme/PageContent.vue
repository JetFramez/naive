<script setup lang="ts">
import Badge from "./Badge.vue";
import FieldTable from "./FieldTable.vue";
import StatCards from "./StatCards.vue";
import WindowCode from "./WindowCode.vue";

const firstRouteStats = [
  { value: "0 KB", caption: "shipped to any browser — notio only ever runs on the server." },
  { value: "11", caption: "core pieces in the base import. No plugin registry, nothing implicit." },
  { value: "1", caption: "shape for a thrown error, a failed validation, or a library exception." },
];

const ctxFields = [
  { name: "ctx.params", desc: "Path params, validated and typed by <code>.params()</code>." },
  { name: "ctx.body", desc: "Request body, validated and typed by <code>.body()</code>." },
  {
    name: "ctx.headers",
    desc: "<code>get(name)</code>, <code>set(name, value)</code> — reads the request, writes the response.",
  },
  { name: "ctx.log", desc: "A child logger carrying the request id and matched route." },
];
</script>

<template>
  <section id="intro" class="section section-intro">
    <p class="version-pill"><span class="version-pill-dot" />v0.1.0 · Express 5</p>
    <h1 class="h1">Express is still there. Everything else is typed.</h1>
    <p class="lede">
      notio keeps Express 5 as the transport — <code>app.express</code> is always the real
      instance — and adds a typed, chainable router, a per-request context, one error shape,
      hooks, logging and config, plus optional modules for auth, uploads, rate limiting and
      OpenAPI.
    </p>
    <p class="sub-lede">
      There are eleven core pieces and four optional modules. This page is all of them, in the
      order you're likely to need them.
    </p>
  </section>

  <section id="install" class="section section-body">
    <h2 class="h2">Install</h2>
    <p class="body-text">
      One package. Optional modules live at their own subpaths and do nothing until you import
      and call them.
    </p>
    <pre class="code is-shell">$ pnpm add @jetframez/notio zod
$ node --version   <span class="tok-c"># 22 or later</span>

<span class="tok-c"># Express ships inside the package — nothing else to install for the core</span></pre>
  </section>

  <section id="first-route" class="section section-body is-tall">
    <h2 class="h2">Your first route</h2>
    <p class="body-text">
      This is not an excerpt. Save it as <code>orders.ts</code> and running it answers
      <code>GET /orders/1</code> with JSON, validates a <code>POST</code> body before your handler
      ever runs, and renders a thrown error in the same shape every error uses.
    </p>
    <WindowCode filename="orders.ts"><span class="tok-k">import</span> { createApp, NotFound, Router } <span class="tok-k">from</span> <span class="tok-s">"@jetframez/notio"</span>;
<span class="tok-k">import</span> { z } <span class="tok-k">from</span> <span class="tok-s">"zod"</span>;

<span class="tok-k">const</span> orders = <span class="tok-k">new</span> <span class="tok-f">Router</span>(<span class="tok-s">"/orders"</span>);

orders.<span class="tok-f">get</span>(<span class="tok-s">"/:id"</span>).<span class="tok-f">handle</span>((ctx) => {
  <span class="tok-k">const</span> order = db.<span class="tok-f">get</span>(ctx.params.id);
  <span class="tok-k">if</span> (!order) <span class="tok-k">throw</span> <span class="tok-k">new</span> <span class="tok-f">NotFound</span>(`Order ${ctx.params.id} does not exist`);
  <span class="tok-k">return</span> order;
});

orders
  .<span class="tok-f">post</span>(<span class="tok-s">"/"</span>)
  .<span class="tok-f">body</span>(z.<span class="tok-f">object</span>({ total: z.<span class="tok-f">number</span>().<span class="tok-f">positive</span>() }))
  .<span class="tok-f">handle</span>((ctx) => db.<span class="tok-f">create</span>(ctx.body));

<span class="tok-k">const</span> app = <span class="tok-f">createApp</span>();
app.<span class="tok-f">mount</span>(orders);
<span class="tok-k">await</span> app.<span class="tok-f">listen</span>(3000);</WindowCode>
    <StatCards :items="firstRouteStats" />
  </section>

  <section id="createapp" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">createApp</h2>
      <Badge type="dark">entry point</Badge>
    </div>
    <p class="body-text">
      Builds a real Express app with notio's pieces registered in a fixed order at
      <code>listen()</code> — context, body parsing, health routes, your routes, then the error
      handler — however you called them.
    </p>
    <p class="body-text">
      Nothing requires it. <code>context()</code>, a bare <code>Router</code>, and
      <code>errorHandler()</code> do the same job by hand on an app you already have.
    </p>
    <pre class="code has-margin"><span class="tok-k">const</span> app = <span class="tok-f">createApp</span>({
  cookies: { secret: process.env.COOKIE_SECRET },
  shutdown: { deadline: <span class="tok-s">"10s"</span> },
});

app.<span class="tok-f">mount</span>(orders);
app.<span class="tok-f">errors</span>({ expose: process.env.NODE_ENV !== <span class="tok-s">"production"</span> });
<span class="tok-k">await</span> app.<span class="tok-f">listen</span>(3000);</pre>
    <p class="note">
      <code>/health</code> and <code>/ready</code> are registered before any of your middleware,
      so auth can never block them.
    </p>
  </section>

  <section id="router" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Router</h2>
      <Badge>class</Badge>
    </div>
    <p class="body-text">
      Declare a path, optional schemas, and middleware, then hand it a handler. The router owns
      the send step — whatever the handler returns becomes the response.
    </p>
    <p class="body-text">
      Path params are inferred from the string itself, including any group or mount prefix above
      the route.
    </p>
    <pre class="code has-margin">router
  .<span class="tok-f">get</span>(<span class="tok-s">"/:id"</span>)
  .<span class="tok-f">params</span>(z.<span class="tok-f">object</span>({ id: z.coerce.<span class="tok-f">number</span>() }))
  .<span class="tok-f">handle</span>((ctx) => ctx.params.id); <span class="tok-c">// number, not string</span></pre>
    <p class="note">
      A params schema must declare exactly the path's parameters, or it's a compile error naming
      the offending keys.
    </p>
  </section>

  <section id="context" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Context</h2>
      <Badge>per request</Badge>
    </div>
    <p class="body-text">
      Every request gets one <code>ctx</code>. Handlers and <code>(ctx, next)</code> middleware
      receive it; Express middleware finds it at <code>res.locals.ctx</code>.
    </p>
    <pre class="code has-margin">router.<span class="tok-f">post</span>(<span class="tok-s">"/notes"</span>).<span class="tok-f">body</span>(NoteSchema).<span class="tok-f">handle</span>((ctx) => {
  ctx.body.text;             <span class="tok-c">// typed from the schema</span>
  ctx.log.<span class="tok-f">info</span>(<span class="tok-s">"note added"</span>);
  <span class="tok-k">return</span> ctx.<span class="tok-f">status</span>(201).<span class="tok-f">json</span>(note);
});</pre>
    <FieldTable :rows="ctxFields" />
  </section>

  <section id="middleware" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Middleware</h2>
      <Badge>(ctx, next)</Badge>
    </div>
    <p class="body-text">
      A <code>Middleware&lt;Adds&gt;</code> declares what it puts on <code>ctx</code>. Everything
      after it in the chain sees those fields as present — not optional.
    </p>
    <p class="body-text">
      Express <code>(req, res, next)</code> handlers are accepted unchanged and mixed freely;
      arity decides which shape a function is.
    </p>
    <pre class="code has-margin"><span class="tok-k">const</span> authed: Middleware&lt;{ user: User }&gt; = <span class="tok-k">async</span> (ctx, next) => {
  ctx.user = <span class="tok-k">await</span> <span class="tok-f">lookup</span>(ctx.<span class="tok-f">bearer</span>());
  <span class="tok-k">await</span> <span class="tok-f">next</span>();
};

router.<span class="tok-f">use</span>(authed).<span class="tok-f">get</span>(<span class="tok-s">"/me"</span>).<span class="tok-f">handle</span>((ctx) => ctx.user.id); <span class="tok-c">// User, not User | undefined</span></pre>
    <p class="note">
      Keep the return value of <code>.use()</code> — discard it and the middleware still runs, but
      later routes lose the narrowing.
    </p>
  </section>

  <section id="responses" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Responses</h2>
      <Badge>return → response</Badge>
    </div>
    <p class="body-text">
      The router owns the send step. A plain object becomes JSON, <code>undefined</code> becomes
      204, and a thrown error renders through the same envelope as a failed validation.
    </p>
    <pre class="code has-margin">ctx.<span class="tok-f">json</span>(data, { status: 201 });
ctx.<span class="tok-f">redirect</span>(<span class="tok-s">"/orders"</span>, 302);
ctx.<span class="tok-f">stream</span>(readable, { type: <span class="tok-s">"text/csv"</span> });</pre>
    <p class="note">
      A descriptor's own status and headers win over <code>ctx.status()</code>/<code>ctx.set()</code>.
    </p>
  </section>

  <section id="errors" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Errors</h2>
      <Badge>throw only</Badge>
    </div>
    <p class="body-text">
      Every error — thrown, a failed schema, a library exception — renders as one shape:
      <code>code</code>, <code>message</code>, an optional <code>details</code>, and a request id.
    </p>
    <pre class="code has-margin"><span class="tok-k">throw</span> <span class="tok-k">new</span> <span class="tok-f">NotFound</span>(`Order ${id} does not exist`, { id });
<span class="tok-c">// { "code": "NOT_FOUND", "message": "Order 42 does not exist", "details": { "id": 42 }, "requestId": "…" }</span></pre>
    <p class="note">
      <code>app.errors({ map })</code> translates a library's own errors — a database constraint,
      a Stripe failure — into your own codes.
    </p>
  </section>

  <section id="hooks" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Hooks</h2>
      <Badge>observers</Badge>
    </div>
    <p class="body-text">
      <code>onRequest</code>, <code>onResponse</code> and <code>onError</code> observe a request
      without being able to change its response — the place for metrics, audit trails, and error
      reporting.
    </p>
    <pre class="code has-margin">router.<span class="tok-f">onError</span>((ctx, err) => reporter.<span class="tok-f">capture</span>(err, { requestId: ctx.requestId }));
app.<span class="tok-f">onResponse</span>((ctx) => metrics.<span class="tok-f">observe</span>(<span class="tok-s">"status"</span>, ctx.res.statusCode));</pre>
    <p class="note">
      Every error is observed exactly once at each level — router hooks run before app hooks.
    </p>
  </section>

  <section id="config" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Config</h2>
      <Badge>boot-time</Badge>
    </div>
    <p class="body-text">
      Resolves once at boot, validates every value, and reports every problem together instead of
      failing on the first bad variable once it's already in production.
    </p>
    <pre class="code has-margin"><span class="tok-k">export const</span> config = <span class="tok-f">defineConfig</span>({
  port: env.<span class="tok-f">port</span>({ default: 3000 }),
  database: { url: env.<span class="tok-f">url</span>() },
});</pre>
    <p class="note">
      Sources, highest first: <code>overrides</code>, <code>process.env</code>,
      <code>.env.&lt;env&gt;.local</code>, <code>.env.local</code>, <code>.env.&lt;env&gt;</code>,
      <code>.env</code>, then the default.
    </p>
  </section>

  <section id="logging" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Logging</h2>
      <Badge>ambient</Badge>
    </div>
    <p class="body-text">
      The exported <code>log</code> is a proxy that resolves at call time — <code>ctx.log</code>
      inside a request, the root logger elsewhere — so one import carries the request id
      everywhere.
    </p>
    <pre class="code has-margin"><span class="tok-k">import</span> { log, currentCtx } <span class="tok-k">from</span> <span class="tok-s">"@jetframez/notio"</span>;

log.<span class="tok-f">info</span>({ orderId }, <span class="tok-s">"order placed"</span>);
<span class="tok-f">currentCtx</span>()?.requestId; <span class="tok-c">// reachable even outside a handler</span></pre>
  </section>

  <section id="events" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Events</h2>
      <Badge>typed bus</Badge>
    </div>
    <p class="body-text">
      An in-process, typed event bus. Listeners run under the emitter's request context, so
      <code>log</code> and <code>currentCtx()</code> inside a listener still refer to the request
      that emitted.
    </p>
    <pre class="code has-margin">events.<span class="tok-f">on</span>(<span class="tok-s">"order.placed"</span>, <span class="tok-k">async</span> (payload) => mailer.<span class="tok-f">confirm</span>(payload.orderId));
<span class="tok-k">await</span> events.<span class="tok-f">emit</span>(<span class="tok-s">"order.placed"</span>, { orderId });</pre>
    <p class="note">
      There is no persistence — an event is lost if the process dies before its listeners run.
    </p>
  </section>

  <section id="cache" class="section section-body is-last">
    <div class="section-header">
      <h2 class="h2-mono">Cache</h2>
      <Badge>Keyv</Badge>
    </div>
    <p class="body-text">
      A small cache API on Keyv — memory by default, Redis through the optional
      <code>@keyv/redis</code> package.
    </p>
    <pre class="code has-margin"><span class="tok-k">const</span> cache = <span class="tok-f">createCache</span>({ prefix: <span class="tok-s">"shop"</span>, ttl: <span class="tok-s">"5m"</span> });
<span class="tok-k">await</span> cache.<span class="tok-f">remember</span>(<span class="tok-s">"products:featured"</span>, <span class="tok-s">"10m"</span>, () => db.<span class="tok-f">featured</span>());</pre>
  </section>

  <section id="auth" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Auth</h2>
      <Badge>sessions · JWT · tokens</Badge>
      <Badge type="green">optional module</Badge>
    </div>
    <p class="body-text">
      Sessions, JWTs, opaque tokens with rotation, and password hashing — deliberately minimal, no
      OAuth or permissions model.
    </p>
    <pre class="code has-margin"><span class="tok-k">const</span> auth = <span class="tok-f">createAuth</span>&lt;User&gt;({ adapter, strategies: { session: <span class="tok-f">cookieSession</span>() }, default: <span class="tok-s">"session"</span> });
router.<span class="tok-f">get</span>(<span class="tok-s">"/me"</span>).<span class="tok-f">use</span>(auth.<span class="tok-f">require</span>()).<span class="tok-f">handle</span>((ctx) => ctx.user);</pre>
    <p class="note">
      <code>createAuth()</code> checks the adapter implements every method the configured
      strategies need, and lists every missing one together.
    </p>
  </section>

  <section id="uploads" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Uploads</h2>
      <Badge>multipart/form-data</Badge>
      <Badge type="green">optional module</Badge>
    </div>
    <p class="body-text">
      Files stream to a temp directory or stay in memory below a threshold. The type is detected
      from content, never trusted from the client.
    </p>
    <pre class="code has-margin">router.<span class="tok-f">post</span>(<span class="tok-s">"/images"</span>).<span class="tok-f">uploads</span>({ cover: { types: [<span class="tok-s">"image/jpeg"</span>, <span class="tok-s">"image/png"</span>] } })
  .<span class="tok-f">handle</span>((ctx) => ctx.uploads.cover.<span class="tok-f">move</span>(<span class="tok-s">"./storage/cover.jpg"</span>));</pre>
  </section>

  <section id="rate-limiting" class="section section-body">
    <div class="section-header">
      <h2 class="h2-mono">Rate limiting</h2>
      <Badge>memory · Redis</Badge>
      <Badge type="green">optional module</Badge>
    </div>
    <p class="body-text">
      Limits by key. In memory for one process; hand it a Redis client and every decision becomes
      one atomic Lua script.
    </p>
    <pre class="code has-margin">router.<span class="tok-f">post</span>(<span class="tok-s">"/login"</span>).<span class="tok-f">use</span>(<span class="tok-f">rateLimit</span>({ limit: 5, window: <span class="tok-s">"15m"</span>, key: (ctx) => ctx.body?.email ?? ctx.ip }));</pre>
  </section>

  <section id="openapi" class="section section-body is-last">
    <div class="section-header">
      <h2 class="h2-mono">OpenAPI</h2>
      <Badge>OpenAPI 3.1</Badge>
      <Badge type="green">optional module</Badge>
    </div>
    <p class="body-text">
      Walks <code>routes()</code> into an OpenAPI 3.1 document and serves it with a Scalar UI. No
      code generation.
    </p>
    <pre class="code has-margin"><span class="tok-k">const</span> spec = <span class="tok-f">openapi</span>({ info: { title: <span class="tok-s">"Shop API"</span>, version: <span class="tok-s">"1.0.0"</span> } }).<span class="tok-f">from</span>(app);
app.<span class="tok-f">use</span>(spec.<span class="tok-f">docs</span>(<span class="tok-s">"/docs"</span>));</pre>
  </section>

  <section id="deploy" class="section section-body">
    <div class="raised-card">
      <h2 class="h2">The same app, in production</h2>
      <p class="body-text">
        There's no separate build output — <code>NODE_ENV</code> changes behavior (response
        validation off, JSON logs, hidden error messages) but it's the same code that ran in
        development. Any host that runs Node 22 will do.
      </p>
      <div class="pill-row">
        <span class="pill-dark">pnpm add @jetframez/notio</span>
        <a href="#intro" class="pill-outline">Back to the top</a>
      </div>
    </div>
  </section>
</template>
