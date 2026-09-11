import type { Context } from "grammy";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import {
  cropStoryAudio,
  renderStoryVideo,
  buildStorySlideshow,
  renderFinalStory,
  generateStoryThumbnail,
} from "../storyVideo/storyFfmpeg";

import {
  enqueueStory,
  getStoryQueueLength,
  removeFromStoryQueue,
  isStoryQueued,
} from "../storyVideo/storyQueue";
import {
  getStoryState,
  setStoryState,
  clearStoryState,
  isStoryBusy,
  type StoryLyricsType,
  type StoryVideoState,
} from "../storyVideo/storyState";
import {
  createStoryJobDir,
  cleanupStoryJobDir,
  formatMs,
} from "../storyVideo/storyUtils";
import { generateStoryASSFile } from "../storyVideo/storyAssGenerator";
import { generateSimpleASSFile } from "../storyVideo/simpleAssGenerator";
import { createStoryCardInBot } from "../storyVideo/storyCanvasGenerator";
import { getSongById } from "../dbUtils";
import { downloadTelegramFile } from "../../tools/downloadTelegramFile";

async function updateStoryProgress(
  bot: Bot,
  chatId: number,
  messageId: number | undefined,
  text: string
): Promise<void> {
  try {
    if (messageId) {
      await bot.api.editMessageText(chatId, messageId, text);
    }
  } catch (e) {
    // Best-effort update
  }
}

/**
 * Parses deep link payload for story video:
 * Format: clip_<songId>_<startSec>_<endSec>_<lyricsType>
 * or v_<songId>_<startSec>_<endSec>_<lyricsType>
 */
export function parseStoryPayload(payload: string): {
  songId: string;
  startSec: number;
  endSec: number;
  lyricsType: StoryLyricsType;
} | null {
  const trimmed = payload.trim();
  const parts = trimmed.split("_");
  if (parts.length < 4) return null;

  const prefix = parts[0];
  if (prefix !== "clip" && prefix !== "v" && prefix !== "story") return null;

  const rawLyricsType = parts[parts.length - 1];
  const lyricsType: StoryLyricsType =
    rawLyricsType === "synced" ? "synced" : "simple";

  const endSec = parseInt(parts[parts.length - 2] ?? "30", 10);
  const startSec = parseInt(parts[parts.length - 3] ?? "0", 10);

  // songId is everything between prefix and the last 3 tokens
  const songId = parts.slice(1, parts.length - 3).join("_");

  if (!songId) return null;

  return {
    songId,
    startSec: isNaN(startSec) ? 0 : startSec,
    endSec: isNaN(endSec) ? 30 : endSec,
    lyricsType,
  };
}

/**
 * Start handler invoked by /start clip_... command
 */
export async function handleStoryVideoStart(
  ctx: Context,
  payload: string
): Promise<void> {
  const userId = ctx.from!.id;
  const parsed = parseStoryPayload(payload);

  if (!parsed) {
    await ctx.reply(
      "❌ <b>پارامترهای ساخت ویدیو نامعتبر است.</b>\nلطفاً از طریق دکمه «اشتراک در استوری» وب‌سایت مجدداً تلاش کنید.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const { songId, startSec, endSec, lyricsType } = parsed;
  const song = getSongById(songId);

  if (!song) {
    await ctx.reply(
      `❌ <b>آهنگ مورد نظر پیدا نشد.</b> (شناسه: <code>${songId}</code>)`,
      {
        parse_mode: "HTML",
      }
    );
    return;
  }

  if (isStoryBusy(userId)) {
    await ctx.reply(
      "⏳ شما در حال حاضر یک ویدیوی در حال پردازش دارید. لطفاً تا اتمام ساخت آن صبر کنید."
    );
    return;
  }

  // Calculate and clamp boundaries
  const totalSongSec = song.duration > 0 ? song.duration : 600;
  const clampedStartSec = Math.max(0, Math.min(startSec, totalSongSec - 5));
  const clampedEndSec = Math.max(
    clampedStartSec + 5,
    Math.min(endSec, totalSongSec)
  );

  const startMs = clampedStartSec * 1000;
  const endMs = clampedEndSec * 1000;
  const durationSec = clampedEndSec - clampedStartSec;

  const jobDir = await createStoryJobDir();

  const state: StoryVideoState = {
    songId,
    jobDir,
    images: [],
    step: "waiting_source",
    startMs,
    endMs,
    lyricsType,
  };
  setStoryState(userId, state);

  const lyricsLabel =
    lyricsType === "synced"
      ? "🎵 متن همگام‌سازی شده (Synced)"
      : "📝 متن ساده (Simple Lyrics)";

  const keyboard = new InlineKeyboard()
    .text("📱 ساخت استوری سریع (با کاور آهنگ)", "sv_quick:small")
    .row()
    .text("🖥 ویدیوی افقی (با کاور آهنگ)", "sv_quick:big")
    .row()
    .text("📷 ارسال عکس‌های دلخواه", "sv_custom_photos")
    .row()
    .text("❌ انصراف", "sv_cancel");

  const messageText =
    `🎬 <b>درخواست ساخت ویدیوی استوری دی‌بلال</b>\n\n` +
    `🎵 <b>${song.title}</b> — ${song.artist}\n` +
    `⏱ بازه انتخابی: <code>${formatMs(startMs)}</code> تا <code>${formatMs(
      endMs
    )}</code> (${durationSec} ثانیه)\n` +
    `📝 زیرنویس: <b>${lyricsLabel}</b>\n\n` +
    `چگونه مایلید ویدیو ساخته شود؟`;

  const sent = await ctx.reply(messageText, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  state.progressMessageId = sent.message_id;
  setStoryState(userId, state);
}

/**
 * Creates the Canvas Story Card directly inside the Telegram Bot.
 * Replicates the Next.js Story Card styling (ambient blurred background,
 * centered artwork card, badge, progress bar, watermark) completely locally
 * without calling any Next.js API endpoints.
 */
async function prepareSongCoverImage(
  song: any,
  jobDir: string,
  resolution: "big" | "small" = "small",
  bot: Bot,
  clipStartSec = 0,
  clipEndSec = 15
): Promise<string> {
  return await createStoryCardInBot(
    song,
    jobDir,
    resolution,
    bot,
    downloadTelegramFile,
    clipStartSec,
    clipEndSec
  );
}

/**
 * Executes rendering specifically for Story Video clips.
 */
export async function executeStoryRendering(
  chatId: number,
  userId: number,
  bot: Bot
): Promise<void> {
  const state = getStoryState(userId);
  if (!state || state.step !== "rendering") return;

  const jobDir = state.jobDir;
  const audioPath = path.join(jobDir, "cropped.mp3");
  const slideshowPath = path.join(jobDir, "slideshow.mp4");
  const outputPath = path.join(jobDir, "output.mp4");

  try {
    const song = getSongById(state.songId);
    if (!song) throw new Error("آهنگ پیدا نشد.");

    const audioFile =
      song.telegram?.["320"] || song.telegram?.["128"] || song.telegram?.["64"];

    if (!audioFile?.fileId) {
      throw new Error("فایل صوتی آهنگ در تلگرام یافت نشد.");
    }

    const rawAudioPath = path.join(jobDir, "raw_audio.mp3");
    await updateStoryProgress(
      bot,
      chatId,
      state.progressMessageId,
      "📥 درحال دریافت فایل صوتی از سرور تلگرام..."
    );
    await downloadTelegramFile(bot.api, audioFile.fileId, rawAudioPath);

    await updateStoryProgress(
      bot,
      chatId,
      state.progressMessageId,
      "✂️ درحال برش بازه زمانی آهنگ..."
    );
    await cropStoryAudio(rawAudioPath, audioPath, state.startMs, state.endMs);

    const durationSec = Math.max(1, (state.endMs - state.startMs) / 1000);

    // Generate Subtitles (ASS) based on selected lyrics type
    let assPath: string | null = null;
    if (state.lyricsType === "synced" && song.syncedLyrics) {
      await updateStoryProgress(
        bot,
        chatId,
        state.progressMessageId,
        "📝 تولید زیرنویس همگام‌سازی شده پویا..."
      );
      assPath = await generateStoryASSFile(
        song.syncedLyrics,
        jobDir,
        state.startMs,
        state.endMs,
        {
          title: song.title,
          artist: song.artist,
          duration: song.duration,
        }
      );
    } else if (state.lyricsType === "simple" && song.lyrics) {
      await updateStoryProgress(
        bot,
        chatId,
        state.progressMessageId,
        "📝 تولید زیرنویس متن ترانه..."
      );
      assPath = await generateSimpleASSFile(
        song.lyrics,
        jobDir,
        state.startMs,
        state.endMs,
        state.resolution ?? "small",
        {
          title: song.title,
          artist: song.artist,
          duration: song.duration,
        }
      );
    } else {
      // Fallback: Generate card UI overlay so title, artist, timestamps & badge are always present
      assPath = await generateStoryASSFile(
        "",
        jobDir,
        state.startMs,
        state.endMs,
        {
          title: song.title,
          artist: song.artist,
          duration: song.duration,
        }
      );
    }

    // Render Video
    if (state.images.length === 1) {
      // Ultra-fast single-pass render (2-3 seconds)
      await updateStoryProgress(
        bot,
        chatId,
        state.progressMessageId,
        "🎬 درحال ساخت و رندر سریع ویدیوی استوری..."
      );
      await renderStoryVideo(
        state.images[0]!,
        audioPath,
        outputPath,
        assPath,
        durationSec,
        state.resolution ?? "small"
      );
    } else {
      // Multi-image custom photos path
      await updateStoryProgress(
        bot,
        chatId,
        state.progressMessageId,
        "🎞 درحال ساخت اسلایدشو تصاویر..."
      );
      const durationMs = state.endMs - state.startMs;
      await buildStorySlideshow(
        state.images,
        slideshowPath,
        durationMs,
        state.resolution ?? "small"
      );

      await updateStoryProgress(
        bot,
        chatId,
        state.progressMessageId,
        "🎬 درحال رندر و فشرده‌سازی ویدیوی نهایی..."
      );
      await renderFinalStory(
        slideshowPath,
        audioPath,
        outputPath,
        assPath,
        durationSec
      );
    }

    await updateStoryProgress(
      bot,
      chatId,
      state.progressMessageId,
      "📤 درحال ارسال ویدیوی استوری..."
    );

    const thumbPath = path.join(jobDir, "thumb.jpg");
    await generateStoryThumbnail(outputPath, thumbPath);

    const finalDurationSec = Math.round((state.endMs - state.startMs) / 1000);
    const lyricsNote =
      state.lyricsType === "synced" ? "✨ متن همگام‌سازی شده" : "📝 متن ترانه";

    await bot.api.sendVideo(chatId, new InputFile(outputPath), {
      caption:
        `🎬 <b>${song.title}</b> — ${song.artist}\n` +
        `⏱ بازه: <code>${formatMs(state.startMs)}</code> تا <code>${formatMs(
          state.endMs
        )}</code> (${finalDurationSec} ثانیه)\n` +
        `${lyricsNote}\n\n` +
        `🎵 پلتفرم موسیقی لری دی‌بلال\n@deybalalir`,
      parse_mode: "HTML",
      thumbnail: new InputFile(thumbPath),
      supports_streaming: true,
      width: state.resolution === "big" ? 1920 : 1080,
      height: state.resolution === "big" ? 1080 : 1920,
    });

    if (state.progressMessageId) {
      await bot.api
        .editMessageText(
          chatId,
          state.progressMessageId,
          "✅ <b>ویدیوی استوری با موفقیت ساخته و ارسال شد!</b> 🎉",
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }

    await cleanupStoryJobDir(jobDir);
    clearStoryState(userId);
  } catch (err) {
    console.error("Story video rendering error:", err);
    await cleanupStoryJobDir(jobDir);
    clearStoryState(userId);

    const errorMsg = (err as Error).message || "خطای ناشناخته";
    await bot.api.sendMessage(chatId, `❌ خطا در ساخت ویدیو: ${errorMsg}`);
  }
}

/**
 * Registers story video callbacks on the GrammY bot instance
 */
export function registerStoryVideoCallbacks(bot: Bot): void {
  // 1. Quick Story Render (with song cover art)
  bot.callbackQuery(/^sv_quick:(small|big)$/, async (ctx: any) => {
    const userId = ctx.from.id;
    const state = getStoryState(userId);

    if (!state || state.step !== "waiting_source") {
      return ctx.answerCallbackQuery({
        text: "درخواست منقضی شده است یا وجود ندارد.",
      });
    }

    const resolution = ctx.match[1] as "big" | "small";
    await ctx.answerCallbackQuery("⏳ درحال آماده‌سازی کاور و شروع پردازش...");

    try {
      const song = getSongById(state.songId);
      const coverPath = await prepareSongCoverImage(
        song,
        state.jobDir,
        resolution,
        bot,
        Math.round(state.startMs / 1000),
        Math.round(state.endMs / 1000)
      );

      state.images = [coverPath];
      state.resolution = resolution;
      state.step = "rendering";
      setStoryState(userId, state);

      await ctx.deleteMessage().catch(() => {});

      const resLabel =
        resolution === "small"
          ? "📱 عمودی استوری (1080x1920)"
          : "🖥 افقی (1920x1080)";

      const progress = await ctx.reply(
        `🎥 <b>شروع ساخت ویدیو</b>\n` +
          `رزولوشن: ${resLabel}\n` +
          `⏳ درحال پردازش فایل...`,
        { parse_mode: "HTML" }
      );

      state.progressMessageId = progress.message_id;
      setStoryState(userId, state);

      const position = await enqueueStory({
        userId,
        chatId: ctx.chat!.id,
        songId: state.songId,
        title: song?.title || "",
        execute: async () => {
          await executeStoryRendering(ctx.chat!.id, userId, bot);
        },
        resolve: () => {},
        reject: () => {},
      });

      if (position > 1) {
        await ctx.api
          .editMessageText(
            ctx.chat!.id,
            progress.message_id,
            `🎥 <b>شروع ساخت ویدیو</b>\n` +
              `رزولوشن: ${resLabel}\n` +
              `⏳ موقعیت شما در صف: ${position} / ${getStoryQueueLength()}`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    } catch (e) {
      console.error("Quick story initiation error:", e);
      await ctx.reply(`❌ خطا در شروع ساخت ویدیو: ${(e as Error).message}`);
      await cleanupStoryJobDir(state.jobDir);
      clearStoryState(userId);
    }
  });

  // 2. Custom photos choice
  bot.callbackQuery("sv_custom_photos", async (ctx: any) => {
    const userId = ctx.from.id;
    const state = getStoryState(userId);

    if (!state || state.step !== "waiting_source") {
      return ctx.answerCallbackQuery({
        text: "درخواست منقضی شده است.",
      });
    }

    state.step = "waiting_images";
    setStoryState(userId, state);

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `📷 <b>ارسال عکس‌های دلخواه برای استوری</b>\n\n` +
        `لطفاً ۱ الی ۱۰ عکس دلخواه را برای ساخت اسلایدشو ارسال کنید.\n` +
        `پس از ارسال تمام عکس‌ها، دکمه «تأیید و ساخت» را لمس کنید.\n\n` +
        `❌ برای لغو: /cancel`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📱 تأیید و ساخت استوری (عمودی)",
                callback_data: "sv_photos_done:small",
              },
            ],
            [
              {
                text: "🖥 تأیید و ساخت افقی",
                callback_data: "sv_photos_done:big",
              },
            ],
            [
              {
                text: "❌ انصراف",
                callback_data: "sv_cancel",
              },
            ],
          ],
        },
      }
    );
  });

  // 3. Custom photos done button
  bot.callbackQuery(/^sv_photos_done:(small|big)$/, async (ctx: any) => {
    const userId = ctx.from.id;
    const state = getStoryState(userId);

    if (!state || state.step !== "waiting_images") {
      return ctx.answerCallbackQuery({
        text: "وضعیت نامعتبر است.",
      });
    }

    if (state.images.length === 0) {
      return ctx.answerCallbackQuery({
        text: "❌ هنوز تصویری ارسال نکرده‌اید! لطفاً حداقل ۱ تصویر بفرستید.",
        show_alert: true,
      });
    }

    const resolution = ctx.match[1] as "big" | "small";
    state.resolution = resolution;
    state.step = "rendering";
    setStoryState(userId, state);

    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});

    const song = getSongById(state.songId);
    const resLabel =
      resolution === "small"
        ? "📱 عمودی استوری (1080x1920)"
        : "🖥 افقی (1920x1080)";

    const progress = await ctx.reply(
      `🎥 <b>شروع ساخت ویدیو با ${state.images.length} تصویر انتخابی</b>\n` +
        `رزولوشن: ${resLabel}\n` +
        `⏳ درحال پردازش فایل...`,
      { parse_mode: "HTML" }
    );

    state.progressMessageId = progress.message_id;
    setStoryState(userId, state);

    const position = await enqueueStory({
      userId,
      chatId: ctx.chat!.id,
      songId: state.songId,
      title: song?.title || "",
      execute: async () => {
        await executeStoryRendering(ctx.chat!.id, userId, bot);
      },
      resolve: () => {},
      reject: () => {},
    });

    if (position > 1) {
      await ctx.api
        .editMessageText(
          ctx.chat!.id,
          progress.message_id,
          `🎥 <b>شروع ساخت ویدیو با ${state.images.length} تصویر انتخابی</b>\n` +
            `رزولوشن: ${resLabel}\n` +
            `⏳ موقعیت شما در صف: ${position} / ${getStoryQueueLength()}`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }
  });

  // 4. Cancel
  bot.callbackQuery("sv_cancel", async (ctx: any) => {
    const userId = ctx.from.id;
    const state = getStoryState(userId);

    if (state) {
      if (isStoryQueued(userId)) {
        removeFromStoryQueue(userId);
      }
      await cleanupStoryJobDir(state.jobDir);
      clearStoryState(userId);
    }

    await ctx.answerCallbackQuery("ساخت استوری لغو شد.");
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("❌ ساخت ویدیوی استوری لغو شد.");
  });
}
