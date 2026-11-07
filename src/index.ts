import { Bot, GrammyError, InlineKeyboard, webhookCallback } from "grammy";
import type { InlineQueryResultCachedAudio } from "grammy/types";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  ensureUser,
  getTelegramFile,
  searchSongs,
  getPreferredQuality,
  saveTelegramFile,
} from "./dbUtils.ts";
import { sendSearchResults } from "../tools/sendSearchResults.ts";
import { handlePhoto, handleRangeInput } from "./lyricVideo/handler.ts";
import { registerStartCommand } from "./commands/start.ts";
import { registerFindCommand } from "./commands/find.ts";
import { registerSearchCommand } from "./commands/search.ts";
import { registerUsersCommand } from "./commands/users.ts";
import { registerCancelCommand } from "./commands/cancel.ts";
import { registerTopCommand } from "./commands/top.ts";
import { registerMostplayedCommand } from "./commands/mostplayed.ts";
import { registerAlbumsCommand } from "./commands/albums.ts";
import { registerLyricVideoCallbacks } from "./callbacks/lyricVideo.ts";
import { registerSongCallbacks } from "./callbacks/songs.ts";
import { registerFavoriteCallbacks } from "./callbacks/favorites.ts";
import { registerArtistCallbacks } from "./callbacks/artists.ts";
import { registerAlbumCallbacks } from "./callbacks/albums.ts";
import { registerMenuCallbacks } from "./callbacks/menu.ts";
import { registerPlaylistCallbacks } from "./callbacks/playlists.ts";
import { registerUtilityCallbacks } from "./callbacks/utility.ts";
import { registerUpdateCommand } from "./commands/update.ts";
import { exec, execFile } from "child_process";
import { promisify } from "node:util";
import { verifyGithubSignature } from "../tools/verifyGithubSignature.ts";
import { registerBackupCommand } from "./commands/backup.ts";
import { registerHelpCommand } from "./commands/help.ts";
import { registerHelpCallback } from "./callbacks/help.ts";
import { logger } from "hono/logger";
import { registerRandomLyricCallbacks } from "./callbacks/randomLyric.ts";
import { timeout } from "hono/timeout";
import { sendErrorMessages } from "../tools/sendErrorMessages.ts";

import fs from "fs";
import os from "os";
import path from "path";
import { identifyAudio, type FingerprintResult } from "./fingerprints.ts";
import { handleVoiceIdentification } from "../tools/handleVoiceIdentification.ts";
import { registerIdentifyCallback } from "./callbacks/identify.ts";
import { cors } from "hono/cors";
import { registerStoryVideoCallbacks } from "./callbacks/storyVideo.ts";
import type { Artist } from "../types/types.ts";
import { registerFeaturedCallbacks } from "./callbacks/featured.ts";
import { registerFeaturedCommands } from "./commands/featured.ts";
import prisma from "./db.ts";

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
  registerFeaturedCommands(bot);
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
  registerFeaturedCallbacks(bot);
}

registerCallbacks(bot);

bot.on("inline_query", async (ctx) => {
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
    const preferredQuality = await getPreferredQuality(userId);

    const results = await searchSongs(query, 50);

    const validResults: InlineQueryResultCachedAudio[] = [];

    for (const result of results.slice(0, 50)) {
      const audioPreferred = await getTelegramFile(
        result.song.id,
        "audio",
        preferredQuality
      );
      const audio128 = await getTelegramFile(result.song.id, "audio", "128");
      const audio320 = await getTelegramFile(result.song.id, "audio", "320");
      const audio64 = await getTelegramFile(result.song.id, "audio", "64");

      const audioFile = audioPreferred || audio128 || audio320 || audio64;

      if (!audioFile?.fileId) continue;

      if (!result.song.title) {
        console.log("song.title is empty", result);
      }

      const selectedDownloadPath =
        result.song?.links?.[preferredQuality as "64" | "128" | "320"]?.url;

      const artists = result.song.artists as Artist[];

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
              `<a href="https://t.me/deybalalirbot?start=a_${s.id}">${s.name}</a>\n\nلینک دانلود:\n${process.env.DOWNLOAD_URL}${selectedDownloadPath}`
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

bot.on("my_chat_member", async (ctx) => {
  const chatMember = ctx.myChatMember;

  // Make sure this is a private chat (a direct message with a user)
  if (chatMember.chat.type === "private") {
    // Check if the user blocked the bot
    if (chatMember.new_chat_member.status === "kicked") {
      const telegramId = chatMember.chat.id;
      console.log(`User ${telegramId} just blocked the bot!`);

      await prisma.user.update({
        where: { telegramId: BigInt(telegramId) },
        data: { hasBlockedBot: true },
      });
    }
    // Check if the user unblocked the bot
    else if (chatMember.new_chat_member.status === "member") {
      console.log(`User ${chatMember.chat.id} unblocked the bot!`);
    }
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

  await ensureUser(ctx.from!);

  const results = await searchSongs(text);

  if (results.length === 0) {
    await ctx.reply(`🔍 نتیجه‌ای برای "<b>${text}</b>" پیدا نشد.`, {
      parse_mode: "HTML",
    });
    return;
  }

  await sendSearchResults(ctx, text, 0, results);
  console.log("Below send Search", Math.floor(new Date().getTime() / 1000));
});

bot.on("message:voice", async (ctx) => {
  console.log("Voice message received");

  if (ctx.message.date + 120 < Math.ceil(Date.now() / 1000)) {
    console.error("Expired voice message!");
    return;
  }

  await ensureUser(ctx.from!);

  handleVoiceIdentification(ctx).catch((err) => {
    console.error("Unhandled voice identification error:", err);
  });
});

// bot.on("message:audio", async (ctx) => {
//   const doc = ctx.message.audio;

//   if (ctx.message.from?.id != Number(process.env.ADMIN_ID)) {
//     return;
//   }

//   if (
//     doc.mime_type === "audio/mpeg" ||
//     doc.file_name?.toLowerCase().endsWith(".mp3")
//   ) {
//     console.log("========== MP3 RECEIVED ==========");

//     console.log(doc);

//     console.log("==================================");

//     try {
//       const fileName = (doc.file_name || "").trim();
//       if (!fileName) {
//         console.warn("⚠️ Audio file received without file_name.");
//         return;
//       }

//       // Extract quality (64, 128, 320) and base slug from file_name
//       // e.g. "Mahmood-Dorzadeh-Mosafere-Kovietam-320.mp3" -> slug: "Mahmood-Dorzadeh-Mosafere-Kovietam", quality: "320"
//       const match = fileName.match(/^(.*?)(?:[-_\s](64|128|320))?\.mp3$/i);
//       const baseSlug =
//         match && match[1]
//           ? match[1].trim()
//           : fileName.replace(/\.mp3$/i, "").trim();
//       const quality =
//         (match && match[2]) ||
//         (doc.file_size && doc.file_size > 50 * 1024 * 1024 ? "320" : "128");

//       const possibleSlugs = Array.from(
//         new Set([
//           baseSlug,
//           baseSlug.toLowerCase(),
//           baseSlug.replace(/_/g, "-"),
//           baseSlug.replace(/-/g, "_"),
//           baseSlug.replace(/\s+/g, "-"),
//         ])
//       );

//       // Search database for the song
//       let song: any = await prisma.song.findFirst({
//         where: {
//           OR: [
//             { slug: { in: possibleSlugs } },
//             { slug: { equals: baseSlug, mode: "insensitive" as const } },
//             { filename: fileName },
//             { uri: { endsWith: fileName } },
//             { uri: { endsWith: `/${fileName}` } },
//           ],
//         },
//         include: {
//           telegram: true,
//         },
//       });

//       // Fallback search if not matched directly
//       if (!song) {
//         song = await prisma.song.findFirst({
//           where: {
//             OR: [
//               { slug: { contains: baseSlug, mode: "insensitive" as const } },
//               ...(doc.title
//                 ? [
//                     {
//                       title: {
//                         equals: doc.title,
//                         mode: "insensitive" as const,
//                       },
//                     },
//                     {
//                       titleEn: {
//                         equals: doc.title,
//                         mode: "insensitive" as const,
//                       },
//                     },
//                   ]
//                 : []),
//             ],
//           },
//           include: {
//             telegram: true,
//           },
//         });
//       }

//       if (!song) {
//         console.warn(
//           `❌ Song not found in database for file: ${fileName} (slug: ${baseSlug})`
//         );
//         try {
//           await ctx.reply(
//             `❌ آهنگ پیدا نشد:\n<code>${fileName}</code>\n(اسلاگ: <code>${baseSlug}</code>)`,
//             {
//               parse_mode: "HTML",
//               reply_parameters: { message_id: ctx.message.message_id },
//             }
//           );
//         } catch {}
//         return;
//       }

//       // Map fields to Prisma Telegram schema just like saveTx in uploadSongs.ts
//       const fields: Record<string, string> = {};
//       if (quality === "64") {
//         fields.file_id_64 = doc.file_id;
//         fields.file_unique_id_64 = doc.file_unique_id;
//       } else if (quality === "128") {
//         fields.file_id_128 = doc.file_id;
//         fields.file_unique_id_128 = doc.file_unique_id;
//       } else if (quality === "320") {
//         fields.file_id_320 = doc.file_id;
//         fields.file_unique_id_320 = doc.file_unique_id;
//       }

//       if (Object.keys(fields).length > 0) {
//         await prisma.telegram.upsert({
//           where: { songId: song.id },
//           create: {
//             songId: song.id,
//             ...fields,
//           },
//           update: fields,
//         });

//         // Also call saveTelegramFile from dbUtils if dynamically available
//         try {
//           await saveTelegramFile(
//             song.id,
//             "audio",
//             quality,
//             doc.file_id,
//             doc.file_unique_id
//           );
//         } catch {}

//         console.log(
//           `✅ Saved ${quality}kbps for "${song.artist}" - "${song.title}" (${song.slug})\n   file_id: ${doc.file_id}\n   file_unique_id: ${doc.file_unique_id}`
//         );

//         try {
//           await ctx.reply(
//             `✅ ذخیره شد (${quality}kbps)\n🎵 <b>${song.title}</b> - ${song.artist}\n🔑 <code>${song.slug}</code>`,
//             {
//               parse_mode: "HTML",
//               reply_parameters: { message_id: ctx.message.message_id },
//             }
//           );
//         } catch {}
//       }
//     } catch (err: unknown) {
//       console.error("❌ Error processing audio file:", err);
//       try {
//         await ctx.reply(
//           `❌ خطا در پردازش و ذخیره فایل:\n<code>${
//             err instanceof Error ? err.message : String(err)
//           }</code>`,
//           {
//             parse_mode: "HTML",
//             reply_parameters: { message_id: ctx.message.message_id },
//           }
//         );
//       } catch {}
//     }
//   }
// });

app.post(`/firsttempwebhook`, async (c) => {
  try {
    return await webhookCallback(bot, "hono", {
      timeoutMilliseconds: 40_000,
    })(c);
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

    if (!err?.message.includes("Request timed out after")) {
      try {
        await sendErrorMessages(bot, Number(process.env.ADMIN_ID), grammyError);
      } catch (err) {
        console.error("Failed to send error notification:", err);
      }
    }

    return c.text("Update Received", 200);
  }
});

app.use("/firsttempwebhook", timeout(35000));

app.post("/deploy", async (c) => {
  if (!(await verifyGithubSignature(c))) {
    return c.text("Unauthorized", 401);
  }

  const execFileAsync = promisify(execFile);

  const adminId = Number(process.env.ADMIN_ID);

  const msg = await bot.api.sendMessage(adminId, "🔄 Updating bot...");

  try {
    const cwd = process.cwd();

    const run = async (command: string, args: string[]) => {
      return execFileAsync(command, args, {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 120_000,
      });
    };

    // Update source code
    await run("git", ["fetch", "origin"]);
    await run("git", ["reset", "--hard", "origin/main"]);

    // Install production dependencies
    await run("npm", ["install", "--omit=dev"]);

    // Generate Prisma Client
    await run("npx", ["prisma", "generate"]);

    // Apply database schema changes
    await run("npx", ["prisma", "db", "push"]);

    await bot.api.editMessageText(
      adminId,
      msg.message_id,
      "✅ Bot updated successfully!"
    );

    await sleep(500);

    // Restart the bot
    await run("pm2", ["restart", "dey"]);
  } catch (err: any) {
    console.error("Deployment failed:", err);

    const errorOutput =
      err.stderr?.toString() ||
      err.stdout?.toString() ||
      err.message ||
      "Unknown error";

    await bot.api.editMessageText(
      adminId,
      msg.message_id,
      `❌ Update failed.\n\n<pre>${errorOutput.slice(-3000)}</pre>`,
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

    const { stdout } = await execAsync("node run scripts/exportEverything.ts", {
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
