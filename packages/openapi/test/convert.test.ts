import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { convertSchema } from "../src/schema/convert.js";
import { fakeSchema } from "./helpers/schema.js";

describe("convertSchema", () => {
  it("converts a Zod schema, hoisting nothing when unnamed", async () => {
    const schema = await convertSchema(z.object({ id: z.string(), qty: z.number() }));
    expect(schema).toMatchObject({
      type: "object",
      properties: { id: { type: "string" }, qty: { type: "number" } },
      required: ["id", "qty"],
    });
    expect(schema.$defs).toBeUndefined();
  });

  it("converts a named Zod schema into a $ref plus $defs", async () => {
    const Order = z.object({ id: z.string() }).meta({ id: "Order", title: "Order" });
    const schema = await convertSchema(Order);
    expect(schema.$ref).toBe("#/$defs/Order");
    expect(schema.$defs).toMatchObject({ Order: { title: "Order", type: "object" } });
  });

  it("converts a Valibot schema", async () => {
    const schema = await convertSchema(v.object({ name: v.string() }));
    expect(schema).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
  });

  it("converts a titled Valibot schema, carrying the title through", async () => {
    const Named = v.pipe(v.object({ name: v.string() }), v.title("Widget"));
    const schema = await convertSchema(Named);
    expect(schema.title).toBe("Widget");
  });

  it("converts an ArkType schema via its native toJsonSchema()", async () => {
    const schema = await convertSchema(type({ name: "string" }));
    expect(schema).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
  });

  it("converts a titled ArkType schema", async () => {
    const Named = type({ name: "string" }).configure({ title: "Widget" });
    const schema = await convertSchema(Named);
    expect(schema.title).toBe("Widget");
  });

  it("throws a clear error for an unrecognised vendor, naming a fix", async () => {
    await expect(convertSchema(fakeSchema("acme-schema"))).rejects.toThrow(
      /no JSON Schema converter for "acme-schema"/,
    );
  });

  it("accepts a custom converter for an unrecognised vendor", async () => {
    const schema = await convertSchema(fakeSchema("acme-schema"), {
      "acme-schema": async () => ({ type: "string", title: "Acme" }),
    });
    expect(schema).toEqual({ type: "string", title: "Acme" });
  });
});
