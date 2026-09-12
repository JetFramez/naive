import type { Logger } from "./types.js";

let root: Logger | undefined;
let factory: (() => Logger) | undefined;

/** @internal Registers how the lazy root logger is built. */
export function setRootFactory(fn: () => Logger): void {
  factory = fn;
}

/** The process-wide root logger, created lazily with defaults on first use. */
export function getRootLogger(): Logger {
  if (!root) {
    if (!factory) throw new Error("notio: no logger factory registered");
    root = factory();
  }
  return root;
}

/** @internal Replaces the root logger (used by `configureLogger` and `createApp`). */
export function setRootLogger(logger: Logger): void {
  root = logger;
}
