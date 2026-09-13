import { createRequire } from "node:module";
import express from "express";
import { apiReference } from "@scalar/express-api-reference";
//#region ../openapi/dist/index.js
/**
* Serves the spec at `${path}/openapi.json` and a Scalar UI reading from it
* at `path`. Mount with `app.use(spec.docs("/docs"))`.
*/
function createDocsRouter(path, document) {
	const router = express.Router();
	const jsonPath = `${path}/openapi.json`;
	router.get(jsonPath, (_req, res) => {
		res.json(document);
	});
	router.use(path, apiReference({ url: jsonPath }));
	return router;
}
const ERROR_SCHEMA = {
	title: "Error",
	type: "object",
	properties: {
		code: { type: "string" },
		message: { type: "string" },
		details: {},
		requestId: { type: "string" }
	},
	required: [
		"code",
		"message",
		"requestId"
	]
};
/** The unified error body, hoisted once as `components.schemas.Error`. Every error response references it. */
function errorSchemaRef(registry) {
	return registry.register(structuredClone(ERROR_SCHEMA));
}
/** Reads `status`/`code` off an `HttpError` subclass by constructing one transiently. */
function errorStatusAndCode(errorClass) {
	const instance = new errorClass();
	return {
		status: instance.status,
		code: instance.code
	};
}
/**
* Express 5 path syntax to OpenAPI's `{name}` template. `:name` and `*name`
* both become `{name}`. OpenAPI has no concept of an optional path segment,
* so `{...}` groups are documented as always present — the braces around
* them are simply dropped, keeping only the parameter inside.
*/
function toOpenApiPath(path) {
	return path.replace(/[{}]/g, "").replace(/[:*]([A-Za-z0-9_]+)/g, "{$1}");
}
const require = createRequire(import.meta.url);
let zodModule;
let valibotConverter;
function loadZod() {
	if (zodModule) return zodModule;
	try {
		zodModule = require("zod");
	} catch {
		throw new Error("OpenAPI: converting a Zod schema needs \"zod\" installed: pnpm add zod");
	}
	return zodModule;
}
function loadValibotConverter() {
	if (valibotConverter) return valibotConverter;
	try {
		valibotConverter = require("@valibot/to-json-schema");
	} catch {
		throw new Error("OpenAPI: converting a Valibot schema needs \"@valibot/to-json-schema\" installed: pnpm add @valibot/to-json-schema");
	}
	return valibotConverter;
}
function zod(schema) {
	const mod = loadZod();
	if (typeof mod.toJSONSchema !== "function") throw new Error("OpenAPI: converting a Zod schema needs Zod 4 or later (z.toJSONSchema is missing)");
	return mod.toJSONSchema(schema, { target: "draft-2020-12" });
}
function valibot(schema) {
	return loadValibotConverter().toJsonSchema(schema);
}
function arktype(schema) {
	const withMethod = schema;
	if (typeof withMethod.toJsonSchema !== "function") throw new Error("OpenAPI: this ArkType version has no toJsonSchema() method; upgrade arktype");
	return withMethod.toJsonSchema();
}
const CONVERTERS = {
	zod,
	valibot,
	arktype
};
/**
* Converts a Standard Schema to JSON Schema, dispatching on `~standard.vendor`.
* Zod, Valibot and ArkType are built in; register more via `openapi({ schemaConverters })`.
*/
function convertSchema(schema, extra = {}) {
	const vendor = schema["~standard"].vendor;
	const converter = extra[vendor] ?? CONVERTERS[vendor];
	if (!converter) throw new Error(`OpenAPI: no JSON Schema converter for "${vendor}" schemas. Built in: zod, valibot, arktype. Register your own with openapi({ schemaConverters: { ${vendor}: (schema) => ({...}) } }).`);
	return converter(schema);
}
const CHILD_LISTS = [
	"anyOf",
	"oneOf",
	"allOf"
];
/**
* Collects every schema that ends up under `components.schemas`. A schema is
* hoisted when it has a `title` (Zod's `.meta({ id })`, Valibot's `v.title()`,
* ArkType's `.configure({ title })`) or when it arrived via Zod's own
* `$defs` (which Zod only produces for named schemas). Unnamed schemas,
* however many times they are reused, stay inlined at each use site.
*/
var ComponentRegistry = class {
	schemas = {};
	/** Registers one converted schema, returning what to embed at its use site (a `$ref` if it was named). */
	register(raw) {
		const { $defs, $schema: _drop, ...rest } = raw;
		const withoutDefs = $defs ? this.#expandDefs(rest, $defs, []) : rest;
		return this.#hoistTitled(withoutDefs);
	}
	#expandDefs(node, defs, path) {
		if (typeof node.$ref === "string" && node.$ref.startsWith("#/$defs/")) {
			const name = node.$ref.slice(8);
			if (path.includes(name)) return { $ref: `#/components/schemas/${name}` };
			const target = defs[name];
			if (!target) return node;
			const expanded = this.#expandDefs(target, defs, [...path, name]);
			this.#add(name, {
				...expanded,
				title: expanded.title ?? name
			});
			return { $ref: `#/components/schemas/${name}` };
		}
		return this.#mapChildren(node, (child) => this.#expandDefs(child, defs, path));
	}
	#hoistTitled(node) {
		const mapped = this.#mapChildren(node, (child) => this.#hoistTitled(child));
		if (typeof mapped.title === "string" && mapped.title.length > 0) {
			this.#add(mapped.title, mapped);
			return { $ref: `#/components/schemas/${mapped.title}` };
		}
		return mapped;
	}
	#add(name, schema) {
		const existing = this.schemas[name];
		if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) throw new Error(`OpenAPI: two different schemas are both titled "${name}". Give one of them a different title.`);
		this.schemas[name] = schema;
	}
	#mapChildren(node, fn) {
		const out = { ...node };
		if (node.properties) out.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, fn(value)]));
		if (node.items) out.items = fn(node.items);
		for (const key of CHILD_LISTS) {
			const list = node[key];
			if (Array.isArray(list)) out[key] = list.map((item) => fn(item));
		}
		return out;
	}
};
/**
* The same well-known symbol `@notio-internal/auth`'s `auth.require()` tags
* its middleware with. Recreated here via `Symbol.for` (the global symbol
* registry) rather than importing the auth package, so the OpenAPI module
* has no dependency on it: a route secured by any middleware that happens to
* carry this symbol is documented; anything else, including a hand-rolled
* auth check, is invisible, exactly as if it were unmarked.
*/
const AUTH_REQUIREMENT = Symbol.for("notio.auth.requirement");
function getAuthRequirement(middleware) {
	if (typeof middleware !== "function") return void 0;
	const marked = middleware[AUTH_REQUIREMENT];
	return marked && Array.isArray(marked.strategies) ? marked : void 0;
}
/**
* Builds the `multipart/form-data` request schema for a route's `.uploads()`
* spec, merged with its `.body()` schema's properties (the multipart form's
* text fields validate through `.body()`; see the upload module's guide).
* File fields become `{ type: "string", format: "binary" }`, or an array of
* those when `maxCount` is set, with constraints noted in `description`.
*/
function uploadsRequestSchema(spec, bodySchema) {
	const properties = { ...bodySchema?.properties };
	const required = new Set(bodySchema?.required ?? []);
	for (const [name, field] of Object.entries(spec)) {
		const constraints = [];
		if (field.maxSize !== void 0) constraints.push(`Max size: ${field.maxSize}.`);
		if (field.types?.length) constraints.push(`Allowed types: ${field.types.join(", ")}.`);
		if (field.maxCount !== void 0) constraints.push(`Up to ${field.maxCount} file(s).`);
		const description = constraints.length > 0 ? constraints.join(" ") : void 0;
		const file = {
			type: "string",
			format: "binary"
		};
		if (description) file.description = description;
		properties[name] = field.maxCount !== void 0 ? {
			type: "array",
			items: file
		} : file;
		if (!field.optional) required.add(name);
	}
	const schema = {
		type: "object",
		properties
	};
	if (required.size > 0) schema.required = [...required];
	return schema;
}
function operationId(method, path) {
	const parts = path.split("/").filter(Boolean).map((seg) => seg.replace(/[{}*:]/g, "").replace(/^[a-z]/, (c) => c.toUpperCase()));
	return method.toLowerCase() + parts.join("");
}
function paramsFor(names, location, schema) {
	if (names.length === 0) return [];
	const properties = schema?.properties ?? {};
	const required = new Set(schema?.required ?? (location === "path" ? names : []));
	return names.map((name) => ({
		name,
		in: location,
		required: location === "path" ? true : required.has(name),
		schema: properties[name] ?? { type: "string" }
	}));
}
function buildResponses(route, registry, options, secured) {
	const responses = {};
	for (const entry of route.responses) {
		const converted = registry.register(convertSchema(entry.schema, options.schemaConverters));
		const schema = options.wrapResponse ? options.wrapResponse(converted) : converted;
		responses[String(entry.status)] = {
			description: schema.title ?? "Success",
			content: { "application/json": { schema } }
		};
	}
	for (const errorClass of route.errors) {
		const { status, code } = errorStatusAndCode(errorClass);
		responses[String(status)] ??= {
			description: code,
			content: { "application/json": { schema: errorSchemaRef(registry) } }
		};
	}
	if (Boolean(route.schemas.params || route.schemas.query || route.schemas.headers || route.schemas.body || route.uploads)) responses["422"] ??= {
		description: "Validation failed",
		content: { "application/json": { schema: errorSchemaRef(registry) } }
	};
	if (secured) {
		responses["401"] ??= {
			description: "Unauthorized",
			content: { "application/json": { schema: errorSchemaRef(registry) } }
		};
		responses["403"] ??= {
			description: "Forbidden",
			content: { "application/json": { schema: errorSchemaRef(registry) } }
		};
	}
	if (Object.keys(responses).length === 0) responses["200"] = { description: "Success" };
	return responses;
}
function buildRequestBody(route, registry, options) {
	if (route.uploads) {
		const bodySchema = route.schemas.body ? registry.register(convertSchema(route.schemas.body, options.schemaConverters)) : void 0;
		return {
			required: true,
			content: { "multipart/form-data": { schema: uploadsRequestSchema(route.uploads, bodySchema) } }
		};
	}
	if (route.schemas.body) return {
		required: true,
		content: { "application/json": { schema: registry.register(convertSchema(route.schemas.body, options.schemaConverters)) } }
	};
}
/** Walks `routes` into an OpenAPI 3.1 document. Routes marked `.hidden()` are skipped. */
function buildDocument(routes, options) {
	const registry = new ComponentRegistry();
	const paths = {};
	for (const route of routes) {
		if (route.hidden) continue;
		const openApiPath = toOpenApiPath(route.path);
		const paramsSchema = route.schemas.params ? registry.register(convertSchema(route.schemas.params, options.schemaConverters)) : void 0;
		const querySchema = route.schemas.query ? registry.register(convertSchema(route.schemas.query, options.schemaConverters)) : void 0;
		const headersSchema = route.schemas.headers ? registry.register(convertSchema(route.schemas.headers, options.schemaConverters)) : void 0;
		const parameters = [
			...paramsFor(route.params, "path", paramsSchema),
			...paramsFor(querySchema ? Object.keys(querySchema.properties ?? {}) : [], "query", querySchema),
			...paramsFor(headersSchema ? Object.keys(headersSchema.properties ?? {}) : [], "header", headersSchema)
		];
		const requirement = route.middleware.map(getAuthRequirement).find((r) => r !== void 0);
		const secured = requirement !== void 0;
		const securityEntries = requirement ? requirement.strategies.filter((name) => options.security?.[name]).map((name) => ({ [name]: [] })) : [];
		const operation = {
			operationId: operationId(route.method, openApiPath),
			...route.summary ? { summary: route.summary } : {},
			...route.tags.length > 0 ? { tags: route.tags } : {},
			...route.deprecated ? { deprecated: true } : {},
			...parameters.length > 0 ? { parameters } : {},
			...securityEntries.length > 0 ? { security: securityEntries } : {},
			responses: buildResponses(route, registry, options, secured)
		};
		const requestBody = buildRequestBody(route, registry, options);
		if (requestBody) operation.requestBody = requestBody;
		paths[openApiPath] ??= {};
		paths[openApiPath][route.method.toLowerCase()] = operation;
	}
	return {
		openapi: "3.1.0",
		info: options.info,
		...options.servers ? { servers: options.servers } : {},
		paths,
		components: {
			schemas: registry.schemas,
			...options.security ? { securitySchemes: options.security } : {}
		}
	};
}
/** Builds an OpenAPI 3.1 document from notio's route metadata. No code generation. */
function openapi(options) {
	return { from(...sources) {
		const document = buildDocument(sources.flatMap((source) => source.routes()), options);
		return {
			document,
			docs: (path) => createDocsRouter(path, document)
		};
	} };
}
//#endregion
export { ComponentRegistry, buildDocument, convertSchema, createDocsRouter, errorSchemaRef, errorStatusAndCode, getAuthRequirement, openapi, toOpenApiPath, uploadsRequestSchema };
