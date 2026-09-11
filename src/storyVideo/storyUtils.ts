import { mkdir, rm, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const TEMP_ROOT = path.resolve("temp", "story-video");

/**
 * Creates an isolated temp directory for a story video job.
 */
export async function createStoryJobDir(): Promise<string> {
  const jobId = randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);
  await mkdir(path.join(jobDir, "images"), { recursive: true });
  return jobDir;
}

/**
 * Safely removes a job's temp directory after rendering completes.
 */
export async function cleanupStoryJobDir(jobDir: string): Promise<void> {
  try {
    const exists = await stat(jobDir)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      await rm(jobDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup — never throw
  }
}

/**
 * Formats milliseconds into mm:ss format.
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Formats seconds into mm:ss format.
 */
export function formatSec(sec: number): string {
  return formatMs(sec * 1000);
}
