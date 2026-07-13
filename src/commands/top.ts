import { Bot } from "grammy";
import { ensureUser, getTopPlayedSongs } from "../dbUtils";

export function registerTopCommand(bot: Bot) {
  bot.command("top", async (ctx) => {
    ensureUser(ctx.from!);

    const songs = getTopPlayedSongs(50);

    if (!songs.length) {
      await ctx.reply("آهنگی پیدا نشد!");
      return;
    }

    const page = 0;
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const pageSongs = songs.slice(start, end);

    const buttons = pageSongs.map((song) => [
      {
        text: `🎵 ${song.title} — ${
          song.artist
        } [${song.playCount.toLocaleString()} بازدید]`,
        callback_data: `s:${song.id}`,
      },
    ]);

    const navButtons = [];

    const hasNext = end < songs.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `top:${page + 1}`,
      });
    }

    await ctx.reply(`📊 بیشترین بازدید آهنگ‌ها`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `صفحه ${page + 1}`, callback_data: "no_callback" }],
          ...buttons,
          navButtons.length ? navButtons : [],
          [{ text: "🔙 بازگشت", callback_data: "home" }],
        ],
      },
    });
  });
}
