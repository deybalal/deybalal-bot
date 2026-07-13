import { Bot } from "grammy";

export function registerUtilityCallbacks(bot: Bot) {
  bot.callbackQuery("no_callback", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("search_prompt", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🔍 متن مورد نظر خود را ارسال کنید.\n\nمثال: <b>کوروش اسدپور</b> یا <b>بختیاری</b>",
      { parse_mode: "HTML" }
    );
  });
}
