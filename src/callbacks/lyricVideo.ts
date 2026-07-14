import { Bot } from "grammy";
import { getState, setState } from "../lyricVideo/state";
import { handleDoneButton } from "../lyricVideo/handler";
import { enqueue, getQueueLength } from "../lyricVideo/queue/videoQueue";
import { getSongById } from "../dbUtils";

export function registerLyricVideoCallbacks(bot: Bot) {
  bot.callbackQuery(/^lv_res_(big|small)$/, async (ctx) => {
    const userId = ctx.from.id;
    const state = getState(userId);

    if (!state || state.step !== "waiting_resolution") {
      return ctx.answerCallbackQuery({
        text: "درخواست منقضی شده است.",
      });
    }

    const resolution = ctx.match[1] as "big" | "small";

    state.resolution = resolution;
    state.step = "rendering";
    setState(userId, state);

    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();

    const song = getSongById(state.songId);
    const position = await enqueue({
      userId,
      chatId: ctx.chat!.id,
      songId: state.songId,
      title: song?.title || "",
      resolve: () => {},
      reject: () => {},
    });

    const resolutionLabel = resolution === "big" ? "🖥 بزرگ (PC)" : "📱 کوچک (Instagram)";

    if (position === 1) {
      const progress = await ctx.reply(
        `🎥 رزولوشن: ${resolutionLabel}\n\n⏳ شروع پردازش...\n📥 درحال دریافت فایل صوتی...`
      );
      state.progressMessageId = progress.message_id;
      setState(userId, state);
    } else {
      const queueLen = getQueueLength();
      const progress = await ctx.reply(
        `🎥 رزولوشن: ${resolutionLabel}\n\n⏳ شما در صف هستید (موقعیت: ${position}/${queueLen})\nلطفاً صبر کنید...`
      );
      state.progressMessageId = progress.message_id;
      setState(userId, state);
    }
  });

  bot.callbackQuery(/^lv:(.+)$/, async (ctx) => {
    const songId = ctx.match[1];
    if (!songId) {
      await ctx.answerCallbackQuery("❌ خطا");
      return;
    }
    const { startLyricVideo } = await import("../lyricVideo/handler");
    await startLyricVideo(ctx, songId);
  });

  bot.callbackQuery(/^lv_done:(.+)$/, async (ctx) => {
    const songId = ctx.match[1];
    if (!songId) {
      await ctx.answerCallbackQuery("❌ خطا");
      return;
    }
    await handleDoneButton(ctx, songId);
  });
}
