import type { Context } from "grammy";
import { InputFile } from "grammy";
import path from "path";
import { mkdir } from "fs/promises";
import { getState, setState, clearState } from "./state";
import { parseTimeRange, formatMs } from "./timeParser";
import { createJobDir, cleanupJobDir, downloadTelegramFile } from "./utils";
import {
  cropAudio,
  buildSlideshow,
  renderFinal,
  generateThumbnail,
} from "./ffmpeg";
import { generateASSFile } from "./assGenerator";
import { getSongById } from "../dbUtils";
import type { LyricVideoState } from "../../types/types";
import { removeFromQueue, isQueued } from "./queue/videoQueue";
import bot from "..";

const mediaGroupBuffers = new Map<
  string,
  {
    photos: { fileId: string; width: number }[];
    timer: ReturnType<typeof setTimeout>;
  }
>();

const MEDIA_GROUP_DEBOUNCE_MS = 2000;

async function updateProgress(
  chatId: number,
  messageId: number | undefined,
  text: string
): Promise<void> {
  if (!messageId) return;
  try {
    await bot.api.editMessageText(chatId, messageId, text);
  } catch (e) {
    // Message may have been deleted or is unchanged
    console.log("Error inn update Progerss: ", (e as Error).message);
  }
}

export async function startLyricVideo(
  ctx: Context,
  songId: string
): Promise<void> {
  const userId = ctx.from!.id;
  const song = getSongById(songId);

  if (!song) {
    await ctx.answerCallbackQuery("❌ آهنگ پیدا نشد.");
    return;
  }

  const existing = getState(userId);
  if (existing?.step === "rendering") {
    await ctx.answerCallbackQuery("⏳ در حال پردازش ویدیوی قبلی...");
    return;
  }

  const jobDir = await createJobDir();

  const state: LyricVideoState = {
    songId,
    images: [],
    jobDir,
    step: "waiting_images",
  };
  setState(userId, state);

  await ctx.answerCallbackQuery();

  const progressMsg = await ctx.reply(
    `🎬 <b>ساخت ویدیوی متن آهنگ</b>\n\n` +
      `🎵 <b>${song.title}</b> — ${song.artist}\n\n` +
      `📷 لطفاً تصاویر مورد نظر خود را به صورت آلبوم (گروه رسانه) ارسال کنید.\n\n` +
      `💡 حداقل ۱ تصویر و حداکثر ۱۰ تصویر.\n` +
      `❌ برای لغو، /cancel را ارسال کنید.`,
    { parse_mode: "HTML" }
  );

  state.progressMessageId = progressMsg.message_id;
  setState(userId, state);
}

export function handlePhoto(ctx: Context): void {
  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_images") return;

  const message = ctx.message;
  if (!message?.photo) return;

  const largestPhoto = message.photo[message.photo.length - 1];
  if (!largestPhoto) return;

  const mediaGroupId = message.media_group_id;

  if (mediaGroupId) {
    const existing = mediaGroupBuffers.get(mediaGroupId);

    if (existing) {
      existing.photos.push({
        fileId: largestPhoto.file_id,
        width: largestPhoto.width,
      });
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        processMediaGroup(ctx, mediaGroupId);
      }, MEDIA_GROUP_DEBOUNCE_MS);
    } else {
      const photos = [
        { fileId: largestPhoto.file_id, width: largestPhoto.width },
      ];
      const timer = setTimeout(() => {
        processMediaGroup(ctx, mediaGroupId);
      }, MEDIA_GROUP_DEBOUNCE_MS);
      mediaGroupBuffers.set(mediaGroupId, { photos, timer });
    }
  } else {
    handleSinglePhoto(ctx, largestPhoto.file_id);
  }
}

async function processMediaGroup(
  ctx: Context,
  mediaGroupId: string
): Promise<void> {
  const buffered = mediaGroupBuffers.get(mediaGroupId);
  mediaGroupBuffers.delete(mediaGroupId);

  if (!buffered) return;

  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_images") return;

  const imagesDir = path.join(state.jobDir, "images");
  await mkdir(imagesDir, { recursive: true });

  const downloadedPaths: string[] = [];

  for (let i = 0; i < buffered.photos.length; i++) {
    const photo = buffered.photos[i]!;
    const filePath = path.join(imagesDir, `image_${i}.jpg`);

    try {
      await downloadTelegramFile(ctx.api, photo.fileId, filePath);
      downloadedPaths.push(filePath);
    } catch (err) {
      console.error(`Failed to download image ${i}:`, err);
    }
  }

  if (downloadedPaths.length === 0) {
    await ctx.reply("❌ هیچ تصویری دانلود نشد. لطفاً دوباره تلاش کنید.");
    clearState(userId);
    await cleanupJobDir(state.jobDir);
    return;
  }

  state.images = downloadedPaths;
  state.step = "waiting_range";
  setState(userId, state);

  const song = getSongById(state.songId);
  const durationStr = song ? formatMs(song.duration * 1000) : "نامشخص";

  await ctx.reply(
    `✅ <b>${downloadedPaths.length} تصویر دریافت شد.</b>\n\n` +
      `⏱ مدت آهنگ: ${durationStr}\n\n` +
      `🔢 لطفاً بازه زمانی مورد نظر را وارد کنید:\n\n` +
      `<b>فرمت‌های مجاز:</b>\n` +
      `• <code>00:12-01:08</code>\n` +
      `• <code>12-68</code>\n` +
      `• <code>00:12-01:08</code>\n` +
      `• <code>01:02:15-01:04:30</code>\n\n` +
      `❌ برای لغو، /cancel را ارسال کنید.`,
    { parse_mode: "HTML" }
  );
}

async function handleSinglePhoto(ctx: Context, fileId: string): Promise<void> {
  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_images") return;

  const imagesDir = path.join(state.jobDir, "images");
  await mkdir(imagesDir, { recursive: true });

  const idx = state.images.length;
  const filePath = path.join(imagesDir, `image_${idx}.jpg`);

  try {
    await downloadTelegramFile(ctx.api, fileId, filePath);
    state.images.push(filePath);
    setState(userId, state);

    await ctx.reply(
      `📷 تصویر ${state.images.length} دریافت شد.\n` +
        `تصاویر بیشتری ارسال کنید یا دکمه مرحله بعد را بزنید.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ مرحله بعد",
                callback_data: `lv_done:${state.songId}`,
              },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error("Failed to download single photo:", err);
    await ctx.reply("❌ خطا در دانلود تصویر. لطفاً دوباره تلاش کنید.");
  }
}

export async function handleDoneButton(
  ctx: Context,
  songId: string
): Promise<void> {
  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_images") {
    await ctx.answerCallbackQuery("❌ وضعیت نامعتبر.");
    return;
  }

  if (state.images.length === 0) {
    await ctx.answerCallbackQuery("❌ حداقل یک تصویر ارسال کنید.");
    return;
  }

  await ctx.answerCallbackQuery("✅ دریافت تصاویر تأیید شد.");

  const song = getSongById(state.songId);
  const durationStr = song ? formatMs(song.duration * 1000) : "نامشخص";

  state.step = "waiting_range";
  setState(userId, state);

  await ctx.reply(
    `✅ <b>${state.images.length} تصویر دریافت شد.</b>\n\n` +
      `⏱ مدت آهنگ: ${durationStr}\n\n` +
      `🔢 لطفاً بازه زمانی مورد نظر را وارد کنید:\n\n` +
      `<b>فرمت‌های مجاز:</b>\n` +
      `• <code>00:12-01:08</code>\n` +
      `• <code>12-68</code>\n` +
      `• <code>00:12-01:08</code>\n` +
      `• <code>01:02:15-01:04:30</code>\n\n` +
      `❌ برای لغو، /cancel را ارسال کنید.`,
    { parse_mode: "HTML" }
  );
}

export async function handleRangeInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_range") return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  if (text === "/cancel") {
    clearState(userId);
    await cleanupJobDir(state.jobDir);
    await ctx.reply("❌ ساخت ویدیو لغو شد.");
    return true;
  }

  try {
    const { startMs, endMs } = parseTimeRange(text);

    const song = getSongById(state.songId);
    if (song) {
      const maxMs = song.duration * 1000;
      if (endMs > maxMs) {
        await ctx.reply(
          `❌ زمان پایان (${formatMs(endMs)}) از مدت آهنگ (${formatMs(
            maxMs
          )}) بیشتر است.`
        );
        return true;
      }
    }

    state.startMs = startMs;
    state.endMs = endMs;
    state.step = "waiting_resolution";
    setState(userId, state);

    await ctx.reply(
      `⏱ بازه زمانی: ${formatMs(startMs)} تا ${formatMs(endMs)}

🎥 رزولوشن ویدیو را انتخاب کنید:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🖥 بزرگ (PC / YouTube)",
                callback_data: "lv_res_big",
              },
            ],
            [
              {
                text: "📱 کوچک (Instagram)",
                callback_data: "lv_res_small",
              },
            ],
          ],
        },
      }
    );

    return true;
  } catch (err) {
    await ctx.reply(
      `❌ ${(err as Error).message}\n\n` +
        `💡 نمونه صحیح: <code>00:12-01:08</code>`,
      { parse_mode: "HTML" }
    );
    return true;
  }
}

export async function executeRendering(
  chatId: number,
  userId: number
): Promise<void> {
  const state = getState(userId);

  if (!state || state.step !== "rendering") return;

  const jobDir = state.jobDir;
  const audioPath = path.join(jobDir, "cropped.mp3");
  const slideshowPath = path.join(jobDir, "slideshow.mp4");
  const outputPath = path.join(jobDir, "output.mp4");

  try {
    const song = getSongById(state.songId);
    if (!song) {
      throw new Error("آهنگ پیدا نشد.");
    }

    const audioFile =
      song.telegram["320"] || song.telegram["128"] || song.telegram["64"];
    if (!audioFile?.fileId) {
      throw new Error("فایل صوتی یافت نشد.");
    }

    const rawAudioPath = path.join(jobDir, "raw_audio.mp3");
    await downloadTelegramFile(bot.api, audioFile.fileId, rawAudioPath);

    await updateProgress(
      chatId,
      state.progressMessageId,
      "✂️ درحال برش فایل صوتی..."
    );
    await cropAudio(rawAudioPath, audioPath, state.startMs!, state.endMs!);

    await updateProgress(
      chatId,
      state.progressMessageId,
      "🎞 درحال ساخت اسلایدشو..."
    );
    const durationMs = state.endMs! - state.startMs!;
    await buildSlideshow(
      state.images,
      slideshowPath,
      durationMs,
      jobDir,
      state.resolution!
    );

    let assPath: string | null = null;
    if (song.syncedLyrics) {
      await updateProgress(
        chatId,
        state.progressMessageId,
        "📝 تولید زیرنویس..."
      );
      assPath = await generateASSFile(
        song.syncedLyrics,
        jobDir,
        state.startMs!,
        state.endMs!
      );
    }

    await updateProgress(chatId, state.progressMessageId, "🎬 تولید ویدیو...");
    await renderFinal(
      slideshowPath,
      audioPath,
      outputPath,
      assPath,
      state.resolution!
    );

    await updateProgress(chatId, state.progressMessageId, "📤 ارسال ویدیو...");

    const thumbPath = path.join(jobDir, "thumb.jpg");

    await generateThumbnail(outputPath, thumbPath);

    await bot.api.sendVideo(chatId, new InputFile(outputPath), {
      caption: `🎬 ${song.title} — ${song.artist}\n⏱ ${formatMs(
        state.startMs!
      )} - ${formatMs(state.endMs!)}`,
      parse_mode: "HTML",
      thumbnail: new InputFile(thumbPath),
      supports_streaming: true,
    });

    await cleanupJobDir(jobDir);
    clearState(userId);

    if (state.progressMessageId) {
      await bot.api
        .editMessageText(
          chatId,
          state.progressMessageId,
          "✅ ویدیو با موفقیت ساخته و ارسال شد!"
        )
        .catch(() => {});
    }
  } catch (err) {
    console.error("Lyric video rendering error:", err);

    clearState(userId);
    await cleanupJobDir(jobDir);

    const errorMsg = (err as Error).message || "خطای ناشناخته";
    await bot.api.sendMessage(chatId, `❌ خطا در ساخت ویدیو: ${errorMsg}`);

    if (state.progressMessageId) {
      await bot.api
        .editMessageText(
          chatId,
          state.progressMessageId,
          `❌ خطا در ساخت ویدیو: ${errorMsg}`
        )
        .catch(() => {});
    }
  }
}

export function handleCancel(ctx: Context): boolean {
  const userId = ctx.from!.id;
  const state = getState(userId);

  if (!state) return false;

  if (isQueued(userId)) {
    removeFromQueue(userId);
  }

  clearState(userId);
  cleanupJobDir(state.jobDir);
  return true;
}
