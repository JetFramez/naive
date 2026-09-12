import { createLogger, type Logger, type LogLevel } from "../../src/index.js";

export interface CapturedLine {
  level: number;
  msg?: string;
  [key: string]: unknown;
}

/** A pino logger writing JSON lines into memory instead of stdout. */
export function captureLogger(level: LogLevel = "trace"): {
  logger: Logger;
  lines: CapturedLine[];
} {
  const lines: CapturedLine[] = [];
  const logger = createLogger({
    level,
    pretty: false,
    destination: {
      write(chunk: string) {
        for (const line of chunk.split("\n")) if (line.trim()) lines.push(JSON.parse(line));
      },
    },
  });
  return { logger, lines };
}

export const LEVEL = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
