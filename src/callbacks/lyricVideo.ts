import { Bot } from "grammy";
import { getState, setState } from "../lyricVideo/state";
import { executeRendering, handleDoneButton } from "../lyricVideo/handler";

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

    const progress = await ctx.reply(
      `🎥 رزولوشن: ${resolution === "big" ? "🖥 بزرگ (PC)" : "📱 کوچک (Instagram)"}

⏳ شروع پردازش...
📥 درحال دریافت فایل صوتی...`
    );

    state.progressMessageId = progress.message_id;
    setState(userId, state);

    await executeRendering(ctx);
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
