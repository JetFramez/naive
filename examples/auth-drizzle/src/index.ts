import { randomUUID } from "node:crypto";
import { createApp, Router } from "@jetframez/notio";
import { cookieSession, createAuth } from "@jetframez/notio/auth";
import { z } from "zod";
import { createDrizzleAdapter, type User } from "./adapter.js";
import { createDb } from "./db.js";
import { users } from "./schema.js";

const db = createDb(process.env.DATABASE_PATH ?? "auth-drizzle.sqlite");
const adapter = createDrizzleAdapter(db);

// #region setup
const auth = createAuth<User>({
  adapter,
  strategies: { session: cookieSession({ ttl: "30d" }) },
  default: "session",
});

const router = new Router("/auth");
// #endregion setup

// #region signup
router
  .post("/signup")
  .body(
    z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1) }),
  )
  .handle(async (ctx) => {
    const existing = await adapter.findUserByEmail(ctx.body.email);
    if (existing)
      return ctx.status(409).json({ code: "EMAIL_TAKEN", message: "Email already registered" });

    const passwordHash = await auth.hashPassword(ctx.body.password);
    const user: User = { id: randomUUID(), email: ctx.body.email, name: ctx.body.name };
    db.insert(users)
      .values({ ...user, passwordHash })
      .run();

    await auth.login(ctx, user);
    return ctx.status(201).json(user);
  });
// #endregion signup

// #region login
router
  .post("/login")
  .body(z.object({ email: z.string().email(), password: z.string() }))
  .handle(async (ctx) => {
    const user = await auth.verifyPassword(ctx.body.email, ctx.body.password); // throws Unauthorized on mismatch
    await auth.login(ctx, user);
    return user;
  });
// #endregion login

router.post("/logout").handle(async (ctx) => {
  await auth.logout(ctx);
  return ctx.empty();
});

// #region me
router
  .get("/me")
  .use(auth.require("session"))
  .handle((ctx) => ctx.user);
// #endregion me

const app = createApp({
  logger: { level: "info" },
  cookies: { secret: process.env.COOKIE_SECRET ?? "dev-secret" },
});
app.mount(router);

const port = Number(process.env.PORT ?? 3000);
await app.listen(port, () => {
  console.log(`auth-drizzle example listening on http://localhost:${port}`);
  console.log(`  POST /auth/signup  { "email": "...", "password": "...", "name": "..." }`);
  console.log(`  POST /auth/login   { "email": "...", "password": "..." }`);
  console.log(`  GET  /auth/me      (send the sid cookie signup/login set)`);
  console.log(`  POST /auth/logout`);
});
