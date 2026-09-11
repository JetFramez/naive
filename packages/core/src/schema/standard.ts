/**
 * The Standard Schema V1 interface (https://standardschema.dev), copied here so
 * notio has no runtime or type dependency on any particular validation library.
 * Zod, Valibot, ArkType and others implement it.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaProps<Input, Output>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
  readonly types?: StandardTypes<Input, Output> | undefined;
}

export type StandardResult<Output> = StandardSuccess<Output> | StandardFailure;

export interface StandardSuccess<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardFailure {
  readonly issues: ReadonlyArray<StandardIssue>;
}

export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined;
}

export interface StandardPathSegment {
  readonly key: PropertyKey;
}

export interface StandardTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

/** The type a schema accepts. */
export type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];

/** The type a schema produces after validation and transforms. */
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];
