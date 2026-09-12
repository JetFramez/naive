import { type DestinationStream, type LoggerOptions, type Logger as Pino, pino } from "pino";
import { setRootFactory, setRootLogger } from "./root.js";
import type { LogFn, Logger, LogLevel } from "./types.js";

export const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/** Keys redacted by default wherever they appear at the top level or one level down. */
export const DEFAULT_REDACT: readonly string[] = [
  "authorization",
  "cookie",
  '["set-cookie"]',
  "password",
  "*.authorization",
  "*.cookie",
  '*["set-cookie"]',
  "*.password",
  "*.token",
];

export interface LoggerOptionsInput {
  /** Defaults to `LOG_LEVEL`, then `"info"`. */
  level?: LogLevel | undefined;
  /** Human-readable output via pino-pretty. Defaults to on outside production when stdout is a TTY. */
  pretty?: boolean | undefined;
  /** Redaction paths; replaces the defaults. */
  redact?: readonly string[] | undefined;
  /** Static fields on every line. */
  base?: Record<string, unknown> | undefined;
  name?: string | undefined;
  /** Where to write. Mostly for tests. Ignored when `pretty` is set. */
  destination?: DestinationStream | undefined;
}

function isLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function resolveLevel(level: LogLevel | undefined): LogLevel {
  const chosen = level ?? process.env.LOG_LEVEL ?? "info";
  if (!isLevel(chosen)) {
    throw new Error(`Invalid log level "${chosen}" (expected one of ${LOG_LEVELS.join(", ")})`);
  }
  return chosen;
}

/** Adapts a pino instance to the {@link Logger} interface. `raw` is the pino logger itself. */
export class PinoLogger implements Logger {
  readonly raw: Pino;
  readonly trace: LogFn;
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
  readonly fatal: LogFn;

  constructor(raw: Pino) {
    this.raw = raw;
    const bind =
      (level: LogLevel): LogFn =>
      (first: unknown, ...rest: unknown[]) => {
        (raw[level] as (...args: unknown[]) => void)(first, ...rest);
      };
    this.trace = bind("trace");
    this.debug = bind("debug");
    this.info = bind("info");
    this.warn = bind("warn");
    this.error = bind("error");
    this.fatal = bind("fatal");
  }

  get level(): LogLevel {
    return this.raw.level as LogLevel;
  }

  set level(level: LogLevel) {
    this.raw.level = level;
  }

  child(fields: Record<string, unknown>): Logger {
    return new PinoLogger(this.raw.child(fields));
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.raw.isLevelEnabled(level);
  }
}

/** Creates a standalone logger. Most code should use `createApp({ logger })` or `configureLogger()`. */
export function createLogger(options: LoggerOptionsInput = {}): Logger {
  const level = resolveLevel(options.level);
  const pretty =
    options.pretty ?? (process.env.NODE_ENV !== "production" && process.stdout.isTTY === true);
  const pinoOptions: LoggerOptions = {
    level,
    redact: { paths: [...(options.redact ?? DEFAULT_REDACT)], censor: "[Redacted]" },
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          },
        }
      : {}),
  };
  const raw =
    pretty || !options.destination ? pino(pinoOptions) : pino(pinoOptions, options.destination);
  return new PinoLogger(raw);
}

/**
 * Builds the root logger for scripts and tests that do not go through
 * `createApp`. Returns the new root.
 */
export function configureLogger(options: LoggerOptionsInput = {}): Logger {
  const logger = createLogger(options);
  setRootLogger(logger);
  return logger;
}

setRootFactory(() => createLogger());
