import type { Context } from "grammy";
import os from "os";
import path from "path";
import { identifyAudio } from "../src/fingerprints";
import fs from "fs";
import { downloadTelegramFile } from "./downloadTelegramFile";
import { escapeHtml } from "./escapeHtml";
import { getSongById } from "../src/dbUtils";

export async function handleVoiceIdentification(ctx: Context) {
  const voice = ctx.message?.voice;
  if (!voice) return;

  const tempDir = os.tmpdir();
  const tempFile = path.join(
    tempDir,
    `telegram_voice_${ctx.from!.id}_${
      ctx.message!.message_id
    }_${Date.now()}.ogg`
  );

  try {
    const processingMessage = await ctx.reply("🎵 در حال شناسایی آهنگ...");

    const file = await ctx.getFile();
    if (!file.file_id) {
      throw new Error("Telegram did not return a file ID");
    }

    await downloadTelegramFile(ctx.api, file.file_id, tempFile);
    console.log(`Voice downloaded: ${tempFile} (${voice.duration}s)`);

    const result = await identifyAudio(tempFile);
    console.log("Fingerprint result:", result);

    if (!result.match || !result.song) {
      await ctx.reply(
        "❌ متأسفانه نتونستم آهنگ رو شناسایی کنم.\n\n" +
          "لطفاً یک قسمت واضح‌تر از آهنگ، ترجیحاً با صدای موسیقی بیشتر ارسال کنید."
      );
      return;
    }

    const song = result.song!;

    const confidenceEmoji =
      result.confidence >= 70 ? "🟢" : result.confidence >= 40 ? "🟡" : "🟠";

    let caption =
      `🎵 <b>آهنگ شناسایی شد!</b>\n\n` +
      `🎶 <b>${escapeHtml(song.title)}</b>\n` +
      `🎤 ${escapeHtml(song.artist)}`;

    if (song.titleEn) {
      caption += `\n\n<b>${escapeHtml(song.titleEn)}</b>`;
    }

    if (song.artistEn) {
      caption += `\n${escapeHtml(song.artistEn)}`;
    }

    caption +=
      `\n\n${confidenceEmoji} دقت تشخیص: <b>${result.confidence}%</b>` +
      `\n🔗 تطبیق اثر انگشت: <b>${result.stats?.matchedPeaks ?? 0}</b>`;

    // Build inline keyboard: primary match + other candidates (excluding the match itself)
    const keyboard: { text: string; callback_data: string }[][] = [];

    const alternatives = result.candidates
      .filter((c) => c.song.id !== song.id)
      // dedupe by song id, keeping the highest-confidence occurrence
      .filter(
        (c, i, arr) => arr.findIndex((x) => x.song.id === c.song.id) === i
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    if (alternatives.length) {
      keyboard.push([
        { text: "🔎 تطبیق‌های احتمالی دیگر:", callback_data: "noop" },
      ]);

      for (const alt of alternatives) {
        const altEmoji =
          alt.confidence >= 70 ? "🟢" : alt.confidence >= 40 ? "🟡" : "🟠";

        keyboard.push([
          {
            text: `${altEmoji} ${alt.song.title} - ${alt.song.artist} (${alt.confidence}%)`,
            callback_data: `s:${alt.song.id}`,
          },
        ]);
      }
    }

    keyboard.push([{ text: "🔙 بازگشت", callback_data: "home" }]);

    // Remove the "processing..." placeholder — switching to a photo message
    await ctx.api
      .deleteMessage(ctx.chat!.id, processingMessage.message_id)
      .catch(() => {});

    const getSong = getSongById(song.id);
    if (getSong?.telegram?.coverArt?.fileId) {
      await ctx.replyWithPhoto(getSong.telegram.coverArt.fileId, {
        caption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error) {
    console.error("Voice identification error:", error);
    await ctx.reply(
      "❌ هنگام شناسایی آهنگ مشکلی پیش آمد. لطفاً دوباره تلاش کنید."
    );
  } finally {
    try {
      if (fs.existsSync(tempFile)) {
        await fs.promises.unlink(tempFile);
      }
    } catch (cleanupError) {
      console.error("Failed to remove temporary voice file:", cleanupError);
    }
  }
}
