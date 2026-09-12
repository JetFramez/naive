# Responses

The router owns the send step. A handler (or a middleware that chooses to respond instead of calling `next()`) returns a value, and that value decides the response.

## Plain returns

| Handler returns | Response |
|---|---|
| `string` | `text/plain`, 200 |
| object, array, number, boolean, `null` | JSON, 200 (201 for POST) |
| `undefined` | 204, empty body |
| `Buffer` or `Readable` | bytes or a stream, `application/octet-stream` unless a type was set |
| the handler already wrote to `ctx.res` | nothing; a warning is logged if a value was also returned |

`ctx.status(code)` and `ctx.set(name, value)` are chainable mutators that apply to plain returns — call them, then return the plain value:

```ts
router.post("/orders/:id/reprocess").handle((ctx) => {
  ctx.status(202).set("x-queued", "true");
  return { id: ctx.params.id, status: "queued" }; // sent as 202, with the header set above
});
```

## Descriptors

Return one of these when the plain-value conventions are not enough — to set a status other than the default, add headers, stream a file, or send something other than JSON:

```ts
ctx.json(data, { status?, headers? });
ctx.text(body, { status?, headers? });
ctx.redirect(url, status = 302);
ctx.file(path, { type?, status?, headers? });     // res.sendFile
ctx.download(path, filename?);                    // res.download
ctx.stream(readable, { type?, status?, headers? });
ctx.empty(status = 204);
ctx.raw((res) => { /* write to res yourself */ });
```

Descriptors are plain objects tagged with a symbol (`isDescriptor()` checks for it), so middleware can return them too — a middleware that returns a descriptor instead of calling `next()` sends the response and skips the rest of the chain, per the four things a middleware may do in [Middleware](./middleware#the-chain-mechanically).

A descriptor's own status and headers take precedence over `ctx.status()` and `ctx.set()`.

## Streaming and files

`ctx.stream()` pipes a `Readable` to the response with backpressure handled for you; `ctx.file()` and `ctx.download()` wrap Express's own `res.sendFile`/`res.download`, so their path resolution and error behaviour (a `NotFound`-shaped 404 for a missing file) match plain Express.

## `.response(schema)`

Declaring `.response(schema)` on a route constrains what a handler may return — the schema's output type, or any descriptor. It is checked at runtime outside production and is what the [OpenAPI module](/guide/modules/openapi) reads to document the success response. See [Router: Schemas](./router#schemas-query-body-headers-response).
