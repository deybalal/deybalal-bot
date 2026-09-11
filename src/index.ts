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
import { timeout } from "hono/timeout";
import { sendErrorMessages } from "../tools/sendErrorMessages";

import fs from "fs";
import os from "os";
import path from "path";
import { identifyAudio, type FingerprintResult } from "./fingerprints.js";
import { downloadTelegramFile } from "../tools/downloadTelegramFile.js";
import { escapeHtml } from "../tools/escapeHtml.js";
import { handleVoiceIdentification } from "../tools/handleVoiceIdentification.js";
import { registerIdentifyCallback } from "./callbacks/identify.js";
import { cors } from "hono/cors";
import { registerStoryVideoCallbacks } from "./callbacks/storyVideo.js";

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
  registerIdentifyCallback(bot);
  registerStoryVideoCallbacks(bot);
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

    const results = searchSongs(query, 50);

    const validResults: InlineQueryResultCachedAudio[] = [];

    for (const result of results.slice(0, 50)) {
      const audioPreferred = getTelegramFile(
        result.song.id,
        "audio",
        preferredQuality
      );
      const audio128 = getTelegramFile(result.song.id, "audio", "128");
      const audio320 = getTelegramFile(result.song.id, "audio", "320");
      const audio64 = getTelegramFile(result.song.id, "audio", "64");

      const audioFile = audioPreferred || audio128 || audio320 || audio64;

      if (!audioFile?.fileId) continue;

      if (!result.song.title) {
        console.log("song.title is empty", result);
      }

      const artists = JSON.parse(result.song.artists as unknown as string);

      validResults.push({
        type: "audio",
        id: result.song.id,
        audio_file_id: audioFile.fileId,
        caption: `${
          result.reason === "title"
            ? "🎵"
            : result.reason === "artist"
            ? "🎤"
            : "📝"
        } ${result.song.title}\n👤 ${artists
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
      cache_time: 20,
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
  console.log("ctx.message", ctx.message);
  if (ctx.message.date + 120 < Math.ceil(Date.now() / 1000)) {
    console.error("Expired Call!");
    return;
  }

  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  const rangeHandled = await handleRangeInput(ctx);
  if (rangeHandled) return;

  ensureUser(ctx.from!);

  const results = searchSongs(text);

  if (results.length === 0) {
    await ctx.reply(`🔍 نتیجه‌ای برای "<b>${text}</b>" پیدا نشد.`, {
      parse_mode: "HTML",
    });
    return;
  }

  await sendSearchResults(ctx, text, 0, results);
});

bot.on("message:voice", async (ctx) => {
  console.log("Voice message received");

  if (ctx.message.date + 120 < Math.ceil(Date.now() / 1000)) {
    console.error("Expired voice message!");
    return;
  }

  ensureUser(ctx.from!);

  handleVoiceIdentification(ctx).catch((err) => {
    console.error("Unhandled voice identification error:", err);
  });
});

app.post(`/firsttempwebhook`, async (c) => {
  try {
    return await webhookCallback(bot, "hono")(c);
  } catch (error) {
    console.error("========== WEBHOOK ERROR ==========");

    console.error("Error:", error);

    const err = error as any;
    // GrammyError-specific fields
    const grammyError = error as any;

    console.error("Error name:", err?.name);
    console.error("Error message:", err?.message);
    console.error("Error cause:", err?.cause);

    // GrammyError properties may be nested/wrapped
    console.error("Method:", err?.method);
    console.error("Payload:", err?.payload);

    if (err?.payload) {
      console.error("PAYLOAD JSON:", JSON.stringify(err.payload, null, 2));
    }

    console.error("===================================");

    try {
      await sendErrorMessages(bot, Number(process.env.ADMIN_ID), grammyError);
    } catch (err) {
      console.error("Failed to send error notification:", err);
    }

    return c.text("Update Received", 200);
  }
});

app.use("/firsttempwebhook", timeout(35000));

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

app.use(
  "/identify",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// API route to identify audio from Next.js or other clients
app.post("/identify", async (c) => {
  const expectedPassword = process.env.IDENTIFY_PASSWORD;

  if (expectedPassword) {
    const authHeader = c.req
      .header("authorization")
      ?.replace(/^Bearer\s+/i, "");

    if (authHeader !== expectedPassword) {
      return c.json(
        {
          success: false,
          error: "Unauthorized",
        },
        401
      );
    }
  }

  let tempFilePath: string | null = null;
  try {
    let audioBuffer: Buffer | null = null;
    let extension = "wav";

    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      let file = formData.get("file") || formData.get("audio");

      const isFileOrBlob = (val: unknown): val is Blob =>
        typeof val === "object" &&
        val !== null &&
        ((val as unknown) instanceof Blob ||
          (typeof File !== "undefined" && (val as unknown) instanceof File));

      if (!file) {
        for (const value of formData.values()) {
          if (isFileOrBlob(value)) {
            file = value;
            break;
          }
        }
      }

      if (isFileOrBlob(file)) {
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuffer);

        const filename = (file as { name?: string }).name || "";
        const detectedExt = path
          .extname(filename)
          .toLowerCase()
          .replace(/^\./, "");

        if (detectedExt) {
          extension = detectedExt;
        } else if (file.type?.includes("mp3") || file.type?.includes("mpeg")) {
          extension = "mp3";
        } else if (file.type?.includes("ogg")) {
          extension = "ogg";
        } else if (file.type?.includes("wav")) {
          extension = "wav";
        } else if (file.type?.includes("m4a") || file.type?.includes("mp4")) {
          extension = "m4a";
        } else if (file.type?.includes("webm")) {
          extension = "webm";
        } else if (file.type?.includes("flac")) {
          extension = "flac";
        }
      }
    } else {
      const arrayBuffer = await c.req.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        audioBuffer = Buffer.from(arrayBuffer);
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return c.json(
        {
          success: false,
          error: "No audio data provided",
        },
        400
      );
    }

    // Save temporary audio file for fingerprint extraction
    const tempDir = os.tmpdir();
    tempFilePath = path.join(
      tempDir,
      `identify_${Date.now()}_${Math.random()
        .toString(36)
        .substring(7)}.${extension}`
    );

    await fs.promises.writeFile(tempFilePath, audioBuffer);

    // Run music identification using the bot's fingerprinting engine
    const result = await identifyAudio(tempFilePath);

    return c.json({
      success: true,
      ...result,
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        message: (err as Error).message,
      },
      500
    );
  } finally {
    if (tempFilePath) {
      try {
        if (fs.existsSync(tempFilePath)) {
          await fs.promises.unlink(tempFilePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
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
