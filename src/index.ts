import { Bot, GrammyError, webhookCallback } from "grammy";
import type { InlineQueryResultCachedAudio } from "grammy/types";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  ensureUser,
  getTelegramFile,
  searchSongs,
  getPreferredQuality,
} from "./dbUtils";
import { sendSearchResults } from "../tools/sendSearchResults";
import { handlePhoto, handleRangeInput } from "./lyricVideo/handler";
import { registerStartCommand } from "./commands/start";
import { registerFindCommand } from "./commands/find";
import { registerSearchCommand } from "./commands/search";
import { registerUsersCommand } from "./commands/users";
import { registerCancelCommand } from "./commands/cancel";
import { registerTopCommand } from "./commands/top";
import { registerMostplayedCommand } from "./commands/mostplayed";
import { registerAlbumsCommand } from "./commands/albums";
import { registerLyricVideoCallbacks } from "./callbacks/lyricVideo";
import { registerSongCallbacks } from "./callbacks/songs";
import { registerFavoriteCallbacks } from "./callbacks/favorites";
import { registerArtistCallbacks } from "./callbacks/artists";
import { registerAlbumCallbacks } from "./callbacks/albums";
import { registerMenuCallbacks } from "./callbacks/menu";
import { registerPlaylistCallbacks } from "./callbacks/playlists";
import { registerUtilityCallbacks } from "./callbacks/utility";
import { registerUpdateCommand } from "./commands/update";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { verifyGithubSignature } from "../tools/verifyGithubSignature";
import { registerBackupCommand } from "./commands/backup";
import { registerHelpCommand } from "./commands/help";
import { registerHelpCallback } from "./callbacks/help";
import { logger } from "hono/logger";
import { registerRandomLyricCallbacks } from "./callbacks/randomLyric";

const app = new Hono();

app.use(logger());

export const bot = new Bot(process.env.BOT_TOKEN!);

const WEBHOOK_URL = process.env.WEBHOOK_PATH!;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function registerCommands(bot: Bot) {
  registerStartCommand(bot);
  registerFindCommand(bot);
  registerSearchCommand(bot);
  registerUsersCommand(bot);
  registerCancelCommand(bot);
  registerTopCommand(bot);
  registerMostplayedCommand(bot);
  registerAlbumsCommand(bot);
  registerUpdateCommand(bot);
  registerBackupCommand(bot);
  registerHelpCommand(bot);
}

registerCommands(bot);

export function registerCallbacks(bot: Bot) {
  registerLyricVideoCallbacks(bot);
  registerSongCallbacks(bot);
  registerFavoriteCallbacks(bot);
  registerArtistCallbacks(bot);
  registerAlbumCallbacks(bot);
  registerMenuCallbacks(bot);
  registerPlaylistCallbacks(bot);
  registerUtilityCallbacks(bot);
  registerHelpCallback(bot);
  registerRandomLyricCallbacks(bot);
}

registerCallbacks(bot);

bot.on("inline_query", async (ctx) => {
  const badFilesIds = new Map<string, InlineQueryResultCachedAudio[]>();
  try {
    const query = ctx.inlineQuery.query.trim();

    if (!query) {
      await ctx.answerInlineQuery([], {
        cache_time: 300,
        button: {
          text: "🔍 عبارت جستجو را وارد کنید",
          start_parameter: "search",
        },
      });
      return;
    }

    const userId = ctx.from!.id;
    const preferredQuality = getPreferredQuality(userId);

    const songs = searchSongs(query, 50);

    const validResults: InlineQueryResultCachedAudio[] = [];

    for (const song of songs.slice(0, 50)) {
      const audioPreferred = getTelegramFile(
        song.id,
        "audio",
        preferredQuality
      );
      const audio128 = getTelegramFile(song.id, "audio", "128");
      const audio320 = getTelegramFile(song.id, "audio", "320");
      const audio64 = getTelegramFile(song.id, "audio", "64");

      const audioFile = audioPreferred || audio128 || audio320 || audio64;

      if (!audioFile?.fileId) continue;

      if (!song.title) {
        console.log("song.title is empty", song);
      }

      const artists = JSON.parse(song.artists as unknown as string);

      validResults.push({
        type: "audio",
        id: song.id,
        audio_file_id: audioFile.fileId,
        caption: `🎵 ${song.title}\n👤 ${artists
          .map(
            (s: { id: string; name: string }) =>
              `<a href="https://t.me/deybalalirbot?start=a_${s.id}">${s.name}</a>`
          )
          .join(" و ")}`,
        parse_mode: "HTML",
      });
    }

    const encoded = Buffer.from(query, "utf8").toString("base64url");

    await ctx.answerInlineQuery(validResults, {
      cache_time: 300,
      is_personal: true,
      button: {
        text: `${validResults.length} آهنگ پیدا شد`,
        start_parameter: `q_${encoded}`,
      },
    });
  } catch (error) {
    console.log("Query: ", ctx.inlineQuery.query.trim());
    if ((error as Error).message.includes("AUDIO_TITLE_EMPTY")) {
      await bot.api.sendMessage(
        parseInt(process.env.LOGS_CHAT_ID!),
        `Error: AUDIO_TITLE_EMPTY\n\n query: ${ctx.inlineQuery.query.trim()}`
      );
    }
    console.error("Inline query error:", (error as Error).message);
  }
});

bot.on("message:photo", async (ctx) => {
  handlePhoto(ctx);
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  const rangeHandled = await handleRangeInput(ctx);
  if (rangeHandled) return;

  ensureUser(ctx.from!);

  const songs = searchSongs(text);

  if (songs.length === 0) {
    await ctx.reply(`🔍 نتیجه‌ای برای "<b>${text}</b>" پیدا نشد.`, {
      parse_mode: "HTML",
    });
    return;
  }

  await sendSearchResults(ctx, text, 0, songs);
});

app.post(`/firsttempwebhook`, async (c) => {
  try {
    return await webhookCallback(bot, "hono")(c);
  } catch (error) {
    console.error("Webhook Error:", (error as Error).message);
    await bot.api.sendMessage(
      Number(process.env.ADMIN_ID),
      `Error in bot: ${(error as Error).message}`,
      {
        parse_mode: "HTML",
      }
    );
  }
});

app.post("/deploy", async (c) => {
  if (!(await verifyGithubSignature(c))) {
    return c.text("Unauthorized", 401);
  }

  const execAsync = promisify(exec);

  const msg = await bot.api.sendMessage(
    Number(process.env.ADMIN_ID),
    "🔄 Updating bot..."
  );

  try {
    const cwd = process.cwd();

    await execAsync("git fetch origin", { cwd });
    await execAsync("git reset --hard origin/main", { cwd });

    // Install new dependencies if package.json changed
    await execAsync("bun install --production", { cwd });

    await bot.api.editMessageText(
      Number(process.env.ADMIN_ID),
      msg.message_id,
      "✅ Bot updated successfully!"
    );

    await sleep(500);

    // Restart the bot
    await execAsync("pm2 restart dey", { cwd });
  } catch (err: any) {
    await bot.api.editMessageText(
      Number(process.env.ADMIN_ID),
      msg.message_id,
      `❌ Update failed.\n\n<pre>${err.stderr || err.message}</pre>`,
      {
        parse_mode: "HTML",
      }
    );
  }

  return c.text("OK");
});

app.post("/bkUp09trxWhy41Not31", async (c) => {
  try {
    const auth = c.req.header("authorization");

    if (auth !== `Bearer ${process.env.BACKUP_SECRET}`) {
      return c.text("Not gonna happen", 403);
    }

    const execAsync = promisify(exec);
    const cwd = process.cwd();

    const { stdout } = await execAsync("bun run scripts/exportDataToJSON.ts", {
      cwd,
    });

    const filePath = stdout.trim();

    return c.json({ success: true, path: filePath });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: err.stderr || err.message,
      },
      500
    );
  }
});

bot.catch((err) => {
  console.error("Bot Error is: ", err.message);
});

app.onError((err, c) => {
  console.error("Hono error:", err);
  return c.text("Internal Error", 500);
});

const PORT = parseInt(process.env.PORT!);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

export default bot;
