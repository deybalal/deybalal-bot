import { Bot, InlineKeyboard } from "grammy";
import { helpText } from "../../tools/helpText";

export function registerHelpCallback(bot: Bot) {
  bot.callbackQuery("help", async (ctx) => {
    const text = helpText;

    const keyboard = new InlineKeyboard()
      .text("🔍 جستجو", "search_prompt")
      .switchInlineCurrent("🔍 جستجو اینلاین", "")
      .row()
      .text("🎵 موزیک تصادفی", "random")
      .row()
      .text("⭐ علاقه‌مندی‌ها", "favorites:0")
      .text("💿 آلبوم‌ها", "albums:0")
      .row()
      .text("📊 بیشترین بازدید", "top:0")
      .text("🎵 بیشترین دانلود", "mostplayed:0")
      .row()
      .text("🏠 منوی اصلی", "home");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  });
}
