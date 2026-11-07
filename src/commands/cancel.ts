import { Bot } from "grammy";
import { handleCancel } from "../lyricVideo/handler.ts";

export function registerCancelCommand(bot: Bot) {
  bot.command("cancel", async (ctx) => {
    const handled = handleCancel(ctx);
    if (handled) {
      await ctx.reply("❌ عملیات لغو شد.");
    }
  });
}
