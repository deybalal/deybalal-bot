import { mkdir, rm, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const TEMP_ROOT = path.resolve("temp", "lyric-video");

export async function createJobDir(): Promise<string> {
  const jobId = randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);

  await mkdir(path.join(jobDir, "images"), { recursive: true });

  return jobDir;
}

export async function cleanupJobDir(jobDir: string): Promise<void> {
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

export function formatProgressMessage(stage: string): string {
  return `⏳ ${stage}...`;
}
