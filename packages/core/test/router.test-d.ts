import { type } from "arktype";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import * as v from "valibot";
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  type Ctx,
  type HandlerCtx,
  type InitialState,
  type Middleware,
  type ParamKeys,
  type PathParams,
  type ResponseDescriptor,
  type RouteBuilder,
  Router,
  type TypedCtx,
  type UploadedFile,
} from "../src/index.js";

interface User {
  id: string;
  name: string;
}

declare module "../src/index.js" {
  interface Ctx {
    tenant?: string;
  }
}

describe("PathParams", () => {
  it("infers string params from :name segments", () => {
    expectTypeOf<PathParams<"/orders/:id/lines/:lineId">>().toEqualTypeOf<{
      id: string;
      lineId: string;
    }>();
  });

  it("yields an empty object for paths without params", () => {
    expectTypeOf<PathParams<"/orders">>().toEqualTypeOf<{}>();
    expectTypeOf<PathParams<"/">>().toEqualTypeOf<{}>();
  });

  it("handles wildcards, dotted segments and optional groups", () => {
    expectTypeOf<PathParams<"/files/*path">>().toEqualTypeOf<{ path: string }>();
    expectTypeOf<PathParams<"/files/:name.:ext">>().toEqualTypeOf<{ name: string; ext: string }>();
    expectTypeOf<PathParams<"/users{/:id}">>().toEqualTypeOf<{ id?: string }>();
    expectTypeOf<PathParams<"/a/:x{/:y}/:z">>().toEqualTypeOf<{
      x: string;
      z: string;
      y?: string;
    }>();
  });

  it("falls back to a string record for non-literal paths", () => {
    expectTypeOf<PathParams<string>>().toEqualTypeOf<Record<string, string>>();
  });

  it("exposes param keys", () => {
    expectTypeOf<ParamKeys<"/orders/:id/lines/:lineId">>().toEqualTypeOf<"id" | "lineId">();
    expectTypeOf<ParamKeys<"/orders">>().toEqualTypeOf<never>();
  });
});

describe("Router prefix composition", () => {
  it("combines the router prefix with the route path", () => {
    new Router("/orders").get("/:id").handle((ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
    });
  });

  it("combines group prefixes", () => {
    new Router("/orgs/:orgId").group("/projects", (r) => {
      r.get("/:projectId").handle((ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ orgId: string; projectId: string }>();
      });
    });
  });

  it("gives router-level middleware the prefix params", () => {
    new Router("/orgs/:orgId").use(async (ctx, next) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ orgId: string }>();
      await next();
    });
  });
});

describe("defaults without schemas", () => {
  it("types query, body and headers loosely", () => {
    new Router().post("/x").handle((ctx) => {
      expectTypeOf(ctx.query).toEqualTypeOf<Record<string, string | string[]>>();
      expectTypeOf(ctx.body).toEqualTypeOf<unknown>();
      expectTypeOf(ctx.headers.all()).toEqualTypeOf<
        Record<string, string | string[] | undefined>
      >();
      expectTypeOf(ctx.headers.get("x")).toEqualTypeOf<string | undefined>();
    });
  });

  it("does not expose uploads unless declared", () => {
    new Router().post("/x").handle((ctx) => {
      // @ts-expect-error uploads is only present after .uploads()
      ctx.uploads;
    });
  });
});

describe("Standard Schema inference", () => {
  it("infers query/body/headers output from Zod", () => {
    new Router()
      .post("/x")
      .query(z.object({ page: z.coerce.number().default(1), tags: z.array(z.string()).optional() }))
      .body(z.object({ name: z.string(), qty: z.number().int() }))
      .headers(z.object({ "x-api-key": z.string() }))
      .handle((ctx) => {
        expectTypeOf(ctx.query).toEqualTypeOf<{ page: number; tags?: string[] | undefined }>();
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string; qty: number }>();
        expectTypeOf(ctx.headers.all()).toEqualTypeOf<{ "x-api-key": string }>();
      });
  });

  it("infers from Valibot", () => {
    new Router()
      .put("/x")
      .body(v.object({ name: v.string(), age: v.pipe(v.string(), v.transform(Number)) }))
      .handle((ctx) => {
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string; age: number }>();
      });
  });

  it("infers from ArkType", () => {
    new Router()
      .patch("/x")
      .body(type({ name: "string", "nick?": "string" }))
      .handle((ctx) => {
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string; nick?: string }>();
      });
  });

  it("transforms params through a schema", () => {
    new Router("/orders")
      .get("/:id")
      .params(z.object({ id: z.coerce.number() }))
      .handle((ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: number }>();
      });
  });

  it("accepts Valibot and ArkType params schemas", () => {
    new Router()
      .get("/a/:x/:y")
      .params(v.object({ x: v.string(), y: v.pipe(v.string(), v.transform(Number)) }))
      .handle((ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ x: string; y: number }>();
      });
    new Router()
      .get("/a/:x")
      .params(type({ x: "string" }))
      .handle((ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ x: string }>();
      });
  });

  it("rejects params schemas whose keys differ from the path", () => {
    // @ts-expect-error missing "lineId"
    new Router().get("/orders/:id/lines/:lineId").params(z.object({ id: z.string() }));
    // @ts-expect-error "extra" is not a path param
    new Router().get("/orders/:id").params(z.object({ id: z.string(), extra: z.string() }));
    // @ts-expect-error wrong key name
    new Router().get("/orders/:id").params(z.object({ orderId: z.string() }));
    // @ts-expect-error not an object schema
    new Router().get("/orders/:id").params(z.string());
  });

  it("does not offer body() on GET, DELETE, HEAD or OPTIONS", () => {
    // @ts-expect-error GET has no body
    new Router().get("/x").body(z.object({}));
    // @ts-expect-error DELETE has no body
    new Router().delete("/x").body(z.object({}));
    // @ts-expect-error HEAD has no body
    new Router().head("/x").body(z.object({}));
    // @ts-expect-error OPTIONS has no body
    new Router().options("/x").body(z.object({}));
    new Router().post("/x").body(z.object({}));
    new Router().put("/x").body(z.object({}));
    new Router().patch("/x").body(z.object({}));
  });
});

describe("Middleware<Adds> narrowing", () => {
  const authed: Middleware<{ user: User }> = async (ctx, next) => {
    expectTypeOf(ctx.user).toEqualTypeOf<User | undefined>();
    ctx.user = { id: "u1", name: "Ada" };
    await next();
  };
  const withRole: Middleware<{ role: "admin" | "member" }> = async (ctx, next) => {
    ctx.role = "admin";
    await next();
  };
  const plain: Middleware = async (_ctx, next) => {
    await next();
  };

  it("narrows at router level when chained", () => {
    const router = new Router("/orders").use(authed);
    router.get("/:id").handle((ctx) => {
      expectTypeOf(ctx.user).toEqualTypeOf<User>();
      expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
    });
  });

  it("accumulates across several middleware in one call", () => {
    new Router()
      .use(authed, withRole, plain)
      .get("/x")
      .handle((ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
        expectTypeOf(ctx.role).toEqualTypeOf<"admin" | "member">();
      });
  });

  it("narrows at group level", () => {
    new Router().group("/admin", [authed], (r) => {
      r.get("/x").handle((ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
      });
    });
    new Router().use(authed).group("/admin", [withRole], (r) => {
      r.get("/x").handle((ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
        expectTypeOf(ctx.role).toEqualTypeOf<"admin" | "member">();
      });
    });
  });

  it("narrows at route level", () => {
    new Router()
      .get("/x")
      .use(authed)
      .handle((ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
      });
  });

  it("does not narrow when the returned router is not used", () => {
    const router = new Router();
    router.use(authed);
    router.get("/x").handle((ctx) => {
      // @ts-expect-error user is not known on this chain
      ctx.user;
    });
  });

  it("types inline ctx middleware with the current chain state", () => {
    new Router()
      .post("/:id")
      .body(z.object({ name: z.string() }))
      .use(authed)
      .use(async (ctx, next) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
        await next();
      })
      .handle(() => undefined);
  });

  it("accepts Express middleware: declared, or inline with annotated params", () => {
    const declared: RequestHandler = (_req, _res, next) => next();
    const onError: ErrorRequestHandler = (err, _req, _res, next) => next(err);
    new Router()
      .use(declared, onError)
      .use((req: Request, res: Response, next: NextFunction) => {
        expectTypeOf(req.path).toEqualTypeOf<string>();
        expectTypeOf(res.statusCode).toEqualTypeOf<number>();
        next();
      })
      .get("/x")
      .use(declared)
      .use((req: Request, _res: Response, next: NextFunction) => {
        expectTypeOf(req.path).toEqualTypeOf<string>();
        next();
      })
      .handle(() => "ok");
  });

  it("does not type an unannotated inline Express arrow (TypeScript limitation)", () => {
    // @ts-expect-error req is implicitly any; annotate the params or declare it as RequestHandler
    new Router().use((req, _res, next) => {
      void req;
      next();
    });
  });

  it("accepts a mix of declared Express and ctx middleware", () => {
    const expressMw = (_req: unknown, _res: unknown, next: () => void) => next();
    new Router()
      .use(expressMw, authed)
      .get("/x")
      .handle((ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
      });
  });

  it("keeps a typed ctx assignable to plain Ctx helpers", () => {
    function helper(ctx: Ctx): string {
      return ctx.requestId;
    }
    new Router("/o")
      .get("/:id")
      .params(z.object({ id: z.coerce.number() }))
      .query(z.object({ q: z.string() }))
      .use(authed)
      .handle((ctx) => helper(ctx));
  });
});

describe("global Ctx augmentation", () => {
  it("is visible on every ctx", () => {
    new Router().get("/x").handle((ctx) => {
      expectTypeOf(ctx.tenant).toEqualTypeOf<string | undefined>();
    });
    const mw: Middleware = async (ctx, next) => {
      expectTypeOf(ctx.tenant).toEqualTypeOf<string | undefined>();
      await next();
    };
    void mw;
  });
});

describe("response typing", () => {
  it("leaves the return type open without a response schema", () => {
    new Router().get("/x").handle(() => ({ anything: true }));
    new Router().get("/x").handle(() => "text");
    new Router().get("/x").handle(() => undefined);
    new Router().get("/x").handle(async (ctx) => ctx.json({ ok: 1 }, { status: 202 }));
  });

  it("constrains the return type when a response schema is declared", () => {
    const Order = z.object({ id: z.string(), total: z.number() });
    new Router()
      .get("/x")
      .response(Order)
      .handle(() => ({ id: "o1", total: 10 }));
    new Router()
      .get("/x")
      .response(Order)
      .handle(async () => ({ id: "o1", total: 10 }));
    new Router()
      .get("/x")
      .response(Order)
      .handle((ctx) => ctx.json({ id: "o1", total: 10 }));
    new Router()
      .get("/x")
      .response(Order)
      // @ts-expect-error total is missing
      .handle(() => ({ id: "o1" }));
    new Router()
      .get("/x")
      .response(Order)
      // @ts-expect-error string is not an Order
      .handle(() => "nope");
  });

  it("treats extra status responses as metadata only", () => {
    new Router()
      .get("/x")
      .response(404, z.object({ code: z.string() }))
      .handle(() => "anything");
  });
});

describe("uploads typing", () => {
  it("maps fields to single files, arrays and optionals", () => {
    new Router()
      .post("/x")
      .uploads({
        image: { maxSize: "5mb", types: ["image/jpeg", "image/png"] },
        gallery: { maxSize: "5mb", types: ["image/*"], maxCount: 6, optional: true },
        doc: { optional: true },
      })
      .handle((ctx) => {
        expectTypeOf(ctx.uploads.image).toEqualTypeOf<UploadedFile>();
        expectTypeOf(ctx.uploads.gallery).toEqualTypeOf<UploadedFile[] | undefined>();
        expectTypeOf(ctx.uploads.doc).toEqualTypeOf<UploadedFile | undefined>();
      });
  });
});

describe("exported helper types", () => {
  it("HandlerCtx composes params, body, uploads and adds", () => {
    type S = InitialState<"POST", "/a/:id", { user: User }>;
    expectTypeOf<HandlerCtx<S>["params"]>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<HandlerCtx<S>["user"]>().toEqualTypeOf<User>();
    expectTypeOf<HandlerCtx<S>>().toMatchTypeOf<Ctx>();
  });

  it("TypedCtx is assignable to Ctx", () => {
    expectTypeOf<
      TypedCtx<{ id: number }, { a: 1 }, { q: string[] }, { h: string }>
    >().toMatchTypeOf<Ctx>();
  });

  it("RouteBuilder exposes body only for body methods", () => {
    type Get = RouteBuilder<InitialState<"GET", "/x", {}>>;
    type Post = RouteBuilder<InitialState<"POST", "/x", {}>>;
    expectTypeOf<Get>().not.toHaveProperty("body");
    expectTypeOf<Post>().toHaveProperty("body");
  });

  it("descriptor union is what ctx helpers return", () => {
    new Router().get("/x").handle((ctx) => {
      expectTypeOf(ctx.text("hi")).toMatchTypeOf<ResponseDescriptor>();
      expectTypeOf(ctx.redirect("/")).toMatchTypeOf<ResponseDescriptor>();
      expectTypeOf(ctx.empty()).toMatchTypeOf<ResponseDescriptor>();
    });
  });
});
