import { Bot } from "grammy";
import { ensureUser, getAllAlbums } from "../dbUtils";

export function registerAlbumsCommand(bot: Bot) {
  bot.command("albums", async (ctx) => {
    ensureUser(ctx.from!);

    const albums = getAllAlbums();

    if (!albums.length) {
      await ctx.reply("آلبومی پیدا نشد!");
      return;
    }

    const page = 0;
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const pageAlbums = albums.slice(start, end);

    const buttons = pageAlbums.map((album) => [
      {
        text: `💿 ${album.albumName} [${album.songCount} آهنگ]`,
        callback_data: `album:${encodeURIComponent(album.albumId || "")}:0`,
      },
    ]);

    const navButtons = [];

    const hasNext = end < albums.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `albums:${page + 1}`,
      });
    }

    await ctx.reply(`💿 آلبوم‌ها`, {
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
