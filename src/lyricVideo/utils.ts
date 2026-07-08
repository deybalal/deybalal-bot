import { mkdir, rm, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { Api } from "grammy";

const TEMP_ROOT = path.resolve("temp", "lyric-video");

export async function createJobDir(): Promise<string> {
  const jobId = randomUUID();
  const jobDir = path.join(TEMP_ROOT, jobId);

  await mkdir(path.join(jobDir, "images"), { recursive: true });

  return jobDir;
}

export async function cleanupJobDir(jobDir: string): Promise<void> {
  try {
    const exists = await stat(jobDir).then(() => true).catch(() => false);
    if (exists) {
      await rm(jobDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup — never throw
  }
}

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  destPath: string,
  botToken?: string
): Promise<void> {
  const file = await api.getFile(fileId);
  const token = botToken || process.env.BOT_TOKEN!;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await Bun.write(destPath, buffer);
}

export function formatProgressMessage(stage: string): string {
  return `⏳ ${stage}...`;
}
