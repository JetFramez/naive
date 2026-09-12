import { randomUUID } from "node:crypto";
import { currentBaseCtx, runInCtx } from "../als.js";
import { Internal } from "../errors/http-error.js";
import { log } from "../logger/proxy.js";
import { toIssues } from "../router/validate.js";
import type { InferOutput, StandardSchemaV1 } from "../schema/standard.js";
import type { MaybePromise } from "../types.js";

/** Event names mapped to payload types, or to schemas for dev-time payload validation. */
export type EventMap = Record<string, unknown>;

export type PayloadOf<E extends EventMap, K extends keyof E> = E[K] extends StandardSchemaV1
  ? InferOutput<E[K]>
  : E[K];

/** Names matched by a pattern such as `"stock.*"`. */
export type MatchingNames<E extends EventMap, P extends string> = P extends `${infer Prefix}*`
  ? Extract<keyof E, `${Prefix}${string}`>
  : Extract<keyof E, P>;

export interface EventMeta {
  readonly name: string;
  readonly id: string;
  readonly emittedAt: Date;
}

export type Listener<P> = (payload: P, meta: EventMeta) => MaybePromise<void>;

export interface ListenerError extends EventMeta {
  readonly error: unknown;
  readonly listener: Listener<never>;
}

export type ErrorListener = (failure: ListenerError) => MaybePromise<void>;

export interface Events<E extends EventMap> {
  /** Runs listeners in the background; resolves once they are scheduled. Errors go to `onError` and the log. */
  emit<K extends keyof E & string>(name: K, payload: PayloadOf<E, K>): Promise<void>;
  /** Runs every listener and waits; rejects if any threw (an `AggregateError` when several did). */
  emitAndWait<K extends keyof E & string>(name: K, payload: PayloadOf<E, K>): Promise<void>;
  /** Subscribes to a name or a pattern with `*`. Returns an unsubscribe function. */
  on<P extends (keyof E & string) | `${string}*`>(
    pattern: P,
    listener: Listener<PayloadOf<E, MatchingNames<E, P>>>,
  ): () => void;
  once<P extends (keyof E & string) | `${string}*`>(
    pattern: P,
    listener: Listener<PayloadOf<E, MatchingNames<E, P>>>,
  ): () => void;
  off(pattern: string, listener: Listener<never>): void;
  /** Observes listener failures from `emit`. */
  onError(listener: ErrorListener): () => void;
}

export type EventSchemas<E extends EventMap> = { readonly [K in keyof E]?: StandardSchemaV1 };

export interface EventsOptions<E extends EventMap> {
  /** Payload schemas by event name. Validated on emit outside production. */
  schemas?: EventSchemas<E> | undefined;
  /** Force payload validation on or off. Defaults to on outside production. */
  validate?: boolean | undefined;
}

interface Subscription {
  readonly pattern: string;
  readonly test: (name: string) => boolean;
  readonly listener: Listener<never>;
  /** The listener as registered, for `off()` on `once` wrappers. */
  readonly original: Listener<never>;
}

function matcher(pattern: string): (name: string) => boolean {
  if (!pattern.includes("*")) return (name) => name === pattern;
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}$`);
  return (name) => regex.test(name);
}

function schemasOf<E extends EventMap>(input: unknown): EventSchemas<E> {
  if (typeof input !== "object" || input === null) return {};
  const out: Record<string, StandardSchemaV1> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "object" && value !== null && "~standard" in value)
      out[key] = value as StandardSchemaV1;
  }
  return out as EventSchemas<E>;
}

/**
 * Creates a typed, in-process event bus.
 *
 * @example
 * type Events = { "order.placed": { orderId: string } };
 * export const events = createEvents<Events>();
 *
 * // or with schemas, validated on emit outside production:
 * export const events = createEvents({ "order.placed": OrderPlaced });
 */
export function createEvents<E extends EventMap = Record<string, unknown>>(
  schemasOrOptions?: E extends Record<string, StandardSchemaV1> ? E : EventsOptions<E>,
): Events<E>;
export function createEvents<const S extends Record<string, StandardSchemaV1>>(
  schemas: S,
): Events<S>;
export function createEvents(input: unknown = {}): Events<EventMap> {
  const isOptions =
    typeof input === "object" && input !== null && ("schemas" in input || "validate" in input);
  const options: EventsOptions<EventMap> = isOptions
    ? (input as EventsOptions<EventMap>)
    : { schemas: schemasOf(input) };
  const schemas = options.schemas ?? {};
  const validate = options.validate ?? process.env.NODE_ENV !== "production";

  const subscriptions: Subscription[] = [];
  const errorListeners: ErrorListener[] = [];

  const checkPayload = async (name: string, payload: unknown): Promise<unknown> => {
    const schema = schemas[name];
    if (!validate || !schema) return payload;
    const result = await schema["~standard"].validate(payload);
    if (result.issues) {
      throw new Internal(`Invalid payload for event "${name}"`, {
        event: name,
        issues: toIssues(result.issues),
      });
    }
    return result.value;
  };

  const report = async (failure: ListenerError): Promise<void> => {
    log.error(
      { err: failure.error, event: failure.name, eventId: failure.id },
      "event listener threw",
    );
    for (const listener of errorListeners) {
      try {
        await listener(failure);
      } catch (error) {
        log.error({ err: error, event: failure.name }, "event error listener threw");
      }
    }
  };

  const run = (subs: Subscription[], name: string, payload: unknown): Array<Promise<void>> => {
    const meta: EventMeta = { name, id: randomUUID(), emittedAt: new Date() };
    const ctx = currentBaseCtx();
    return subs.map((sub) => {
      const invoke = () => Promise.resolve().then(() => sub.listener(payload as never, meta));
      const promise = ctx ? runInCtx(ctx, invoke) : invoke();
      return promise.catch((error: unknown) => {
        throw Object.assign(new ListenerFailure(error), { meta, listener: sub.original });
      });
    });
  };

  const subscribe = (
    pattern: string,
    listener: Listener<never>,
    original: Listener<never>,
  ): (() => void) => {
    const sub: Subscription = { pattern, test: matcher(pattern), listener, original };
    subscriptions.push(sub);
    return () => {
      const index = subscriptions.indexOf(sub);
      if (index >= 0) subscriptions.splice(index, 1);
    };
  };

  const events: Events<EventMap> = {
    async emit(name, payload) {
      const value = await checkPayload(name, payload);
      const subs = subscriptions.filter((s) => s.test(name));
      for (const promise of run(subs, name, value)) {
        promise.catch((failure: ListenerFailure) => {
          void report({ ...failure.meta, error: failure.error, listener: failure.listener });
        });
      }
    },

    async emitAndWait(name, payload) {
      const value = await checkPayload(name, payload);
      const subs = subscriptions.filter((s) => s.test(name));
      const settled = await Promise.allSettled(run(subs, name, value));
      const errors = settled
        .filter((s): s is PromiseRejectedResult => s.status === "rejected")
        .map((s) => (s.reason as ListenerFailure).error);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, `${errors.length} listeners for "${name}" threw`);
    },

    on(pattern, listener) {
      return subscribe(pattern, listener as Listener<never>, listener as Listener<never>);
    },

    once(pattern, listener) {
      const wrapper: Listener<never> = (payload, meta) => {
        off();
        return (listener as Listener<never>)(payload, meta);
      };
      const off = subscribe(pattern, wrapper, listener as Listener<never>);
      return off;
    },

    off(pattern, listener) {
      for (let i = subscriptions.length - 1; i >= 0; i--) {
        const sub = subscriptions[i];
        if (sub && sub.pattern === pattern && sub.original === listener) subscriptions.splice(i, 1);
      }
    },

    onError(listener) {
      errorListeners.push(listener);
      return () => {
        const index = errorListeners.indexOf(listener);
        if (index >= 0) errorListeners.splice(index, 1);
      };
    },
  };
  return events;
}

class ListenerFailure {
  declare meta: EventMeta;
  declare listener: Listener<never>;
  constructor(readonly error: unknown) {}
}
