import type { Bot } from "grammy";
import { escapeHtml } from "./escapeHtml";

function sanitizePaths(text: string, username: string): string {
  const pathToReplace = `/home/${username}`;
  return text.replaceAll(pathToReplace, "/home/fakedfakeuser");
}

export async function sendErrorMessages(
  bot: Bot,
  adminId: number,
  error: any
): Promise<void> {
  // Get the actual username from the process (or hardcode a default)
  const username = process.env.USER || "fakeuser";

  const errorData = {
    name: error.name,
    message: error.message,
    method: error.method,
    payload: error.payload,
    error: error.error,
    stack: sanitizePaths(error.stack?.toString() || "", username),
  };

  const fullText = JSON.stringify(errorData, null, 2);
  const sanitizedFullText = sanitizePaths(fullText, username);

  const header = "<b>Bot Error</b>\n\n";
  const maxChunkSize = 4000;
  const chunks: string[] = [];

  // Split the error text into chunks
  let currentChunk = "";
  for (const line of sanitizedFullText.split("\n")) {
    if ((currentChunk + line + "\n").length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  // Send header with first chunk
  await bot.api.sendMessage(
    adminId,
    `${header}<pre>${escapeHtml(chunks[0] as string)}</pre>`,
    {
      parse_mode: "HTML",
    }
  );

  // Send remaining chunks
  for (let i = 1; i < chunks.length; i++) {
    await bot.api.sendMessage(
      adminId,
      `<pre>${escapeHtml(chunks[i] as string)}</pre>`,
      {
        parse_mode: "HTML",
      }
    );
  }
}
