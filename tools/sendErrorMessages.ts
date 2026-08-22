import type { Bot } from "grammy";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendErrorMessages(
  bot: Bot,
  adminId: number,
  error: any
): Promise<void> {
  const errorData = {
    name: error.name,
    message: error.message,
    method: error.method,
    payload: error.payload,
    error: error.error,
    stack: error.stack,
  };

  const fullText = JSON.stringify(errorData, null, 2);
  const header = "<b>Bot Error</b>\n\n";
  const maxChunkSize = 4000;
  const chunks: string[] = [];

  // Split the error text into chunks
  let currentChunk = "";
  for (const line of fullText.split("\n")) {
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
