import type { RequestContext } from "../ctx/create.js";
import { Internal, Unprocessable } from "../errors/http-error.js";
import type { StandardIssue, StandardSchemaV1 } from "../schema/standard.js";
import type { RouteSchemas } from "./types.js";

export type ValidationSection = "params" | "query" | "headers" | "body" | "uploads" | "response";

export interface ValidationIssue {
  /** Dotted path such as `"items.0.qty"`; empty string for the root. */
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly meta?: unknown;
}

export interface ValidationDetails {
  readonly in: ValidationSection;
  readonly issues: readonly ValidationIssue[];
}

export function toIssues(issues: readonly StandardIssue[]): ValidationIssue[] {
  return issues.map((issue) => {
    const raw = issue as StandardIssue & { code?: unknown; type?: unknown; expected?: unknown };
    const code =
      typeof raw.code === "string" ? raw.code : typeof raw.type === "string" ? raw.type : "invalid";
    const path = (issue.path ?? [])
      .map((seg) => String(typeof seg === "object" && seg !== null ? seg.key : seg))
      .join(".");
    return raw.expected === undefined
      ? { path, code, message: issue.message }
      : { path, code, message: issue.message, meta: { expected: raw.expected } };
  });
}

export type SchemaOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: ValidationIssue[] };

export async function runSchema(schema: StandardSchemaV1, value: unknown): Promise<SchemaOutcome> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) return { ok: false, issues: toIssues(result.issues) };
  return { ok: true, value: result.value };
}

export function validationError(section: ValidationSection, issues: readonly ValidationIssue[]) {
  const details: ValidationDetails = { in: section, issues };
  return new Unprocessable(`Invalid ${section}`, details);
}

/** Wraps single string values in arrays for the top-level keys that failed. */
function arrayifyFailing(
  value: Record<string, unknown>,
  issues: readonly ValidationIssue[],
): Record<string, unknown> | undefined {
  let changed = false;
  const next = { ...value };
  for (const issue of issues) {
    const key = issue.path;
    if (key && !key.includes(".") && typeof next[key] === "string") {
      next[key] = [next[key]];
      changed = true;
    }
  }
  return changed ? next : undefined;
}

/**
 * Validates params, query, headers and body in that order, installing the
 * transformed values on the context. Stops at the first failing section.
 */
export async function validateRequest(ctx: RequestContext, schemas: RouteSchemas): Promise<void> {
  if (schemas.params) {
    const out = await runSchema(schemas.params, ctx.params);
    if (!out.ok) throw validationError("params", out.issues);
    ctx.params = out.value as Record<string, unknown>;
  }
  if (schemas.query) {
    let out = await runSchema(schemas.query, ctx.query);
    if (!out.ok) {
      const retry = arrayifyFailing(ctx.query, out.issues);
      if (retry) {
        const second = await runSchema(schemas.query, retry);
        if (second.ok) out = second;
      }
    }
    if (!out.ok) throw validationError("query", out.issues);
    ctx.query = out.value as Record<string, unknown>;
  }
  if (schemas.headers) {
    const out = await runSchema(schemas.headers, ctx.req.headers);
    if (!out.ok) throw validationError("headers", out.issues);
    ctx.headers.validated = out.value as Record<string, unknown>;
  }
  if (schemas.body) {
    const out = await runSchema(schemas.body, ctx.body);
    if (!out.ok) throw validationError("body", out.issues);
    ctx.body = out.value;
  }
}

/** Validates a handler's return value against `.response(schema)`; throws `Internal` on mismatch. */
export async function validateResponse(schema: StandardSchemaV1, value: unknown): Promise<void> {
  const out = await runSchema(schema, value);
  if (!out.ok) {
    const details: ValidationDetails = { in: "response", issues: out.issues };
    throw new Internal("Response does not match the declared response schema", details);
  }
}
