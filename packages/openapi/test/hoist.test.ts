import { describe, expect, it } from "vitest";
import { ComponentRegistry } from "../src/schema/hoist.js";
import type { JsonSchema } from "../src/schema/json-schema.js";

describe("ComponentRegistry", () => {
  it("leaves an untitled schema inline", () => {
    const registry = new ComponentRegistry();
    const schema: JsonSchema = { type: "object", properties: { a: { type: "string" } } };
    expect(registry.register(schema)).toEqual(schema);
    expect(registry.schemas).toEqual({});
  });

  it("hoists a titled schema to a $ref and records it once", () => {
    const registry = new ComponentRegistry();
    const schema: JsonSchema = {
      title: "Order",
      type: "object",
      properties: { id: { type: "string" } },
    };
    const result = registry.register(schema);
    expect(result).toEqual({ $ref: "#/components/schemas/Order" });
    expect(registry.schemas.Order).toEqual(schema);
  });

  it("hoists titled schemas nested in properties, items, and combinators", () => {
    const registry = new ComponentRegistry();
    const Address: JsonSchema = {
      title: "Address",
      type: "object",
      properties: { city: { type: "string" } },
    };
    const schema: JsonSchema = {
      type: "object",
      properties: {
        home: Address,
        stops: { type: "array", items: Address },
        contact: { anyOf: [{ type: "string" }, Address] },
      },
    };
    const result = registry.register(schema);
    const properties = result.properties as Record<string, JsonSchema>;
    expect(properties.home).toEqual({ $ref: "#/components/schemas/Address" });
    expect((properties.stops as JsonSchema).items).toEqual({
      $ref: "#/components/schemas/Address",
    });
    expect((properties.contact as JsonSchema).anyOf).toEqual([
      { type: "string" },
      { $ref: "#/components/schemas/Address" },
    ]);
    expect(registry.schemas.Address).toEqual(Address);
  });

  it("expands Zod-style $defs into components, rewriting every $ref", () => {
    const registry = new ComponentRegistry();
    const raw: JsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "#/$defs/Order",
      $defs: {
        Order: {
          type: "object",
          title: "Order",
          properties: { id: { type: "string" } },
        },
      },
    } as JsonSchema;
    const result = registry.register(raw);
    expect(result).toEqual({ $ref: "#/components/schemas/Order" });
    const hoistedOrder = registry.schemas.Order;
    expect(hoistedOrder).toMatchObject({ type: "object", title: "Order" });
    expect(hoistedOrder?.$ref).toBeUndefined();
  });

  it("handles a self-referential (recursive) named schema without looping forever", () => {
    const registry = new ComponentRegistry();
    const raw: JsonSchema = {
      $ref: "#/$defs/Category",
      $defs: {
        Category: {
          type: "object",
          title: "Category",
          properties: {
            name: { type: "string" },
            children: { type: "array", items: { $ref: "#/$defs/Category" } },
          },
        },
      },
    };
    const result = registry.register(raw);
    expect(result).toEqual({ $ref: "#/components/schemas/Category" });
    const hoisted = registry.schemas.Category;
    const children = hoisted?.properties?.children as JsonSchema | undefined;
    expect(children?.items).toEqual({ $ref: "#/components/schemas/Category" });
  });

  it("names an unnamed $defs entry after its own key when it carries no title", () => {
    const registry = new ComponentRegistry();
    const raw: JsonSchema = {
      $ref: "#/$defs/__schema0",
      $defs: { __schema0: { type: "string" } },
    };
    registry.register(raw);
    expect(registry.schemas.__schema0).toEqual({ type: "string", title: "__schema0" });
  });

  it("reuses the same component for two identical registrations of the same title", () => {
    const registry = new ComponentRegistry();
    const schema: JsonSchema = {
      title: "Order",
      type: "object",
      properties: { id: { type: "string" } },
    };
    registry.register(structuredClone(schema));
    registry.register(structuredClone(schema));
    expect(Object.keys(registry.schemas)).toEqual(["Order"]);
  });

  it("throws when two different schemas share a title", () => {
    const registry = new ComponentRegistry();
    registry.register({ title: "Order", type: "object", properties: { id: { type: "string" } } });
    expect(() =>
      registry.register({
        title: "Order",
        type: "object",
        properties: { total: { type: "number" } },
      }),
    ).toThrow(/two different schemas are both titled "Order"/);
  });
});
