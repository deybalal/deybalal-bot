import { Bot } from "grammy";
import { handleCancel } from "../lyricVideo/handler";

export function registerCancelCommand(bot: Bot) {
  bot.command("cancel", async (ctx) => {
    const handled = handleCancel(ctx);
    if (handled) {
      await ctx.reply("❌ عملیات لغو شد.");
    }
  });
}
