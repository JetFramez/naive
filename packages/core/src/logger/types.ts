export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogFn {
  (message: string, ...args: unknown[]): void;
  (fields: object, message?: string, ...args: unknown[]): void;
}

/** The logging surface naive exposes. pino sits underneath. */
export interface Logger {
  level: LogLevel;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(fields: Record<string, unknown>): Logger;
  isLevelEnabled(level: LogLevel): boolean;
}
