import { currentBaseCtx } from "../als.js";
import { getRootLogger } from "./root.js";
import type { LogFn, Logger, LogLevel } from "./types.js";

function target(): Logger {
  return currentBaseCtx()?.log ?? getRootLogger();
}

const level =
  (name: LogLevel): LogFn =>
  (first: unknown, ...rest: unknown[]) => {
    (target()[name] as (...args: unknown[]) => void)(first, ...rest);
  };

/**
 * A logger that resolves at call time: inside a request (or `runWithCtx`) it
 * is `ctx.log`, with the request id and bound fields; elsewhere it is the root
 * logger. One import works in handlers, services and scripts alike.
 */
export const log: Logger = {
  get level(): LogLevel {
    return target().level;
  },
  set level(value: LogLevel) {
    target().level = value;
  },
  trace: level("trace"),
  debug: level("debug"),
  info: level("info"),
  warn: level("warn"),
  error: level("error"),
  fatal: level("fatal"),
  child: (fields) => target().child(fields),
  isLevelEnabled: (lvl) => target().isLevelEnabled(lvl),
};
