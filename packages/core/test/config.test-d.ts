import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  defineConfig,
  env,
  type InferConfig,
  type InferConfigInput,
  resolveConfig,
} from "../src/index.js";

describe("config types", () => {
  const shape = {
    port: env.port({ default: 3000 }),
    name: env.string({ optional: true }),
    mode: env.enum(["dev", "prod"]),
    database: { url: env.url(), poolSize: env.integer({ default: 5 }) },
    ttl: env.duration({ default: "1h" }),
    size: env.bytes(),
    origins: env.list({ default: [] }),
    zodLeaf: z.coerce.number(),
  };

  it("infers the resolved config", () => {
    const config = defineConfig(shape, { files: false, processEnv: {} });
    expectTypeOf(config.port).toEqualTypeOf<number>();
    expectTypeOf(config.name).toEqualTypeOf<string | undefined>();
    expectTypeOf(config.mode).toEqualTypeOf<"dev" | "prod">();
    expectTypeOf(config.database.url).toEqualTypeOf<string>();
    expectTypeOf(config.ttl).toEqualTypeOf<number>();
    expectTypeOf(config.size).toEqualTypeOf<number>();
    expectTypeOf(config.origins).toEqualTypeOf<string[]>();
    expectTypeOf(config.zodLeaf).toEqualTypeOf<number>();
    expectTypeOf(config.$print).toEqualTypeOf<() => unknown>();
    // @ts-expect-error frozen: readonly
    config.port = 1;
  });

  it("types inputs loosely: raw strings or typed values, everything optional", () => {
    type Input = InferConfigInput<typeof shape>;
    expectTypeOf<Input["port"]>().toEqualTypeOf<string | number | undefined>();
    expectTypeOf<Input["ttl"]>().toEqualTypeOf<string | number | undefined>();
    expectTypeOf<NonNullable<Input["database"]>["url"]>().toEqualTypeOf<string | undefined>();
    defineConfig(shape, { files: false, overrides: { port: "80", database: { poolSize: 2 } } });
    // @ts-expect-error unknown key
    defineConfig(shape, { files: false, overrides: { nope: 1 } });
  });

  it("types module fragments", () => {
    const fragment = {
      maxFileSize: env.bytes({ default: "10mb" }),
      tempDir: env.string({ optional: true }),
    };
    type Resolved = InferConfig<typeof fragment>;
    expectTypeOf<Resolved>().toEqualTypeOf<{
      readonly maxFileSize: number;
      readonly tempDir: string | undefined;
    }>();
    const resolved = resolveConfig(fragment, { maxFileSize: "50mb" });
    expectTypeOf(resolved.maxFileSize).toEqualTypeOf<number>();
  });
});
