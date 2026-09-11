import type { Simplify } from "../types.js";

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Lower =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
type WordChar = Lower | Uppercase<Lower> | Digit | "_";

/** Reads a parameter name (word characters) off the front of `S`. */
type TakeName<S extends string, Acc extends string = ""> = S extends `${infer C}${infer R}`
  ? C extends WordChar
    ? TakeName<R, `${Acc}${C}`>
    : [Acc, S]
  : [Acc, ""];

/**
 * Walks an Express 5 path character by character, collecting `:name` and
 * `*name` parameters. Parameters inside `{...}` groups are optional.
 */
type Scan<
  S extends string,
  InOptional extends boolean,
  Required extends string,
  Optional extends string,
> = S extends `${infer C}${infer R}`
  ? C extends ":" | "*"
    ? TakeName<R> extends [infer Name extends string, infer Rest extends string]
      ? Name extends ""
        ? Scan<Rest, InOptional, Required, Optional>
        : InOptional extends true
          ? Scan<Rest, InOptional, Required, Optional | Name>
          : Scan<Rest, InOptional, Required | Name, Optional>
      : never
    : C extends "{"
      ? Scan<R, true, Required, Optional>
      : C extends "}"
        ? Scan<R, false, Required, Optional>
        : Scan<R, InOptional, Required, Optional>
  : { required: Required; optional: Optional };

/**
 * Parameters inferred from a path string.
 *
 * `"/orders/:id/lines/:lineId"` → `{ id: string; lineId: string }`
 * `"/files/*path"`              → `{ path: string }`
 * `"/users{/:id}"`              → `{ id?: string }`
 *
 * A non-literal `string` path yields `Record<string, string>`.
 */
export type PathParams<Path extends string> = string extends Path
  ? Record<string, string>
  : Scan<Path, false, never, never> extends {
        required: infer R extends string;
        optional: infer O extends string;
      }
    ? Simplify<{ [K in R]: string } & { [K in O]?: string }>
    : never;

/** Union of parameter names in a path. */
export type ParamKeys<Path extends string> = keyof PathParams<Path> & string;

const PARAM_PATTERN = /[:*]([A-Za-z0-9_]+)/g;

/** Runtime twin of {@link PathParams}: the parameter names in a path, in order. */
export function paramNames(path: string): string[] {
  const names: string[] = [];
  for (const match of path.matchAll(PARAM_PATTERN)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** Joins a prefix and a path, collapsing duplicate slashes and trailing slashes. */
export function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  if (joined.length > 1 && joined.endsWith("/")) return joined.slice(0, -1);
  return joined === "" ? "/" : joined;
}
