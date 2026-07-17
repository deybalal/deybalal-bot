import { Bot } from "grammy";
import { ensureUser, searchSongs } from "../dbUtils";
import { sendSearchResults } from "../../tools/sendSearchResults";

export function registerSearchCommand(bot: Bot) {
  bot.command("search", async (ctx) => {
    ensureUser(ctx.from!);
    const query = ctx.match?.trim();

    if (!query) {
      await ctx.reply(
        "🔍 لطفاً عبارت جستجو را وارد کنید.\n\nمثال: <code>/search رزمجو</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const songs = searchSongs(query);

    if (songs.length === 0) {
      await ctx.reply(`🔍 نتیجه‌ای برای "<b>${query}</b>" پیدا نشد.`, {
        parse_mode: "HTML",
      });
      return;
    }

    await sendSearchResults(ctx, query, 0, songs);
  });
}
