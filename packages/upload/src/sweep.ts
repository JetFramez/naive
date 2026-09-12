import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@notio-internal/core";

/** Removes subdirectories of `tempDir` whose modification time is older than `maxAgeMs`. Best-effort. */
export async function sweepTempDir(
  tempDir: string,
  maxAgeMs: number,
  logger: Logger,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    logger.warn({ err: error, tempDir }, "upload temp dir sweep failed to read directory");
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(tempDir, entry);
      try {
        const info = await stat(full);
        if (info.isDirectory() && info.mtimeMs < cutoff) {
          await rm(full, { recursive: true, force: true });
        }
      } catch (error) {
        logger.warn({ err: error, path: full }, "upload temp dir sweep failed for entry");
      }
    }),
  );
}
