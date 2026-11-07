import type { Api } from "grammy";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  destPath: string,
  botToken?: string
): Promise<void> {
  const file = await api.getFile(fileId);

  const token = botToken || process.env.BOT_TOKEN;

  if (!token) {
    throw new Error("BOT_TOKEN is not configured");
  }

  if (!file.file_path) {
    throw new Error("Telegram file path is missing");
  }

  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to download file: ${response.status} ${response.statusText}`
    );
  }

  // Ensure destination directory exists
  await mkdir(path.dirname(destPath), { recursive: true });

  // Save downloaded file
  const buffer = Buffer.from(await response.arrayBuffer());

  await writeFile(destPath, buffer);
}
