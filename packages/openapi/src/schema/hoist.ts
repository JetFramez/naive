import type { JsonSchema } from "./json-schema.js";

const CHILD_LISTS = ["anyOf", "oneOf", "allOf"] as const;

/**
 * Collects every schema that ends up under `components.schemas`. A schema is
 * hoisted when it has a `title` (Zod's `.meta({ id })`, Valibot's `v.title()`,
 * ArkType's `.configure({ title })`) or when it arrived via Zod's own
 * `$defs` (which Zod only produces for named schemas). Unnamed schemas,
 * however many times they are reused, stay inlined at each use site.
 */
export class ComponentRegistry {
  readonly schemas: Record<string, JsonSchema> = {};

  /** Registers one converted schema, returning what to embed at its use site (a `$ref` if it was named). */
  register(raw: JsonSchema): JsonSchema {
    const { $defs, $schema: _drop, ...rest } = raw as JsonSchema & { $schema?: unknown };
    const withoutDefs = $defs ? this.#expandDefs(rest, $defs, []) : rest;
    return this.#hoistTitled(withoutDefs);
  }

  #expandDefs(
    node: JsonSchema,
    defs: Record<string, JsonSchema>,
    path: readonly string[],
  ): JsonSchema {
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
      const name = node.$ref.slice("#/$defs/".length);
      if (path.includes(name)) return { $ref: `#/components/schemas/${name}` }; // cycle: stop expanding
      const target = defs[name];
      if (!target) return node;
      const expanded = this.#expandDefs(target, defs, [...path, name]);
      this.#add(name, { ...expanded, title: (expanded.title as string | undefined) ?? name });
      return { $ref: `#/components/schemas/${name}` };
    }
    return this.#mapChildren(node, (child) => this.#expandDefs(child, defs, path));
  }

  #hoistTitled(node: JsonSchema): JsonSchema {
    const mapped = this.#mapChildren(node, (child) => this.#hoistTitled(child));
    if (typeof mapped.title === "string" && mapped.title.length > 0) {
      this.#add(mapped.title, mapped);
      return { $ref: `#/components/schemas/${mapped.title}` };
    }
    return mapped;
  }

  #add(name: string, schema: JsonSchema): void {
    const existing = this.schemas[name];
    if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(
        `OpenAPI: two different schemas are both titled "${name}". Give one of them a different title.`,
      );
    }
    this.schemas[name] = schema;
  }

  #mapChildren(node: JsonSchema, fn: (child: JsonSchema) => JsonSchema): JsonSchema {
    const out: JsonSchema = { ...node };
    if (node.properties) {
      out.properties = Object.fromEntries(
        Object.entries(node.properties).map(([key, value]) => [key, fn(value)]),
      );
    }
    if (node.items) out.items = fn(node.items);
    for (const key of CHILD_LISTS) {
      const list = node[key];
      if (Array.isArray(list)) out[key] = list.map((item: JsonSchema) => fn(item));
    }
    return out;
  }
}
