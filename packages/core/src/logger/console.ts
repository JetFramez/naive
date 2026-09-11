import type { LogFn, Logger, LogLevel } from "./types.js";

const ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * A minimal console-backed {@link Logger}, used until a root logger is
 * configured (pino arrives with the logging milestone).
 */
export function createConsoleLogger(
  level: LogLevel = "info",
  fields: Record<string, unknown> = {},
): Logger {
  const make =
    (lvl: LogLevel): LogFn =>
    (first: unknown, ...rest: unknown[]) => {
      if (ORDER[lvl] < ORDER[logger.level]) return;
      const sink =
        ORDER[lvl] >= ORDER.error
          ? console.error
          : ORDER[lvl] >= ORDER.warn
            ? console.warn
            : console.log;
      if (typeof first === "string") sink(`[${lvl}]`, first, ...rest, fields);
      else sink(`[${lvl}]`, ...rest, { ...fields, ...(first as object) });
    };
  const logger: Logger = {
    level,
    trace: make("trace"),
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    fatal: make("fatal"),
    child: (more) => createConsoleLogger(logger.level, { ...fields, ...more }),
    isLevelEnabled: (lvl) => ORDER[lvl] >= ORDER[logger.level],
  };
  return logger;
}

let root: Logger | undefined;

/** The process-wide root logger. Lazily a console logger until configured. */
export function getRootLogger(): Logger {
  root ??= createConsoleLogger();
  return root;
}

/** @internal */
export function setRootLogger(logger: Logger): void {
  root = logger;
}
