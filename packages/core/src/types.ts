/** Flattens intersections into a single object type for readable hovers. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Turns a union into an intersection: `A | B` → `A & B`. */
export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

export type MaybePromise<T> = T | Promise<T>;
