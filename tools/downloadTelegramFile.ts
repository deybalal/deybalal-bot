import type { Api } from "grammy";

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
    throw new Error(
      `Failed to download file: ${response.status} ${response.statusText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await Bun.write(destPath, buffer);
}
