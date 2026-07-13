import { Bot } from "grammy";
import { getAllAlbums, getSongsByAlbumId } from "../dbUtils";

export function registerAlbumCallbacks(bot: Bot) {
  bot.callbackQuery(/^albums:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const page = parseInt(ctx.match[1] || "0");
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const albums = getAllAlbums();

    if (!albums.length) {
      await ctx.answerCallbackQuery("آلبومی پیدا نشد!");
      return;
    }

    const pageAlbums = albums.slice(start, end);

    const buttons = pageAlbums.map((album) => [
      {
        text: `💿 ${album.albumName} [${album.songCount} آهنگ]`,
        callback_data: `album:${encodeURIComponent(album.albumId || "")}:0`,
      },
    ]);

    const navButtons = [];

    if (page > 0) {
      navButtons.push({
        text: "⬅️ قبلی",
        callback_data: `albums:${page - 1}`,
      });
    }

    const hasNext = end < albums.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `albums:${page + 1}`,
      });
    }

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `💿 آلبوم‌ها [صفحه ${page + 1}]`,
              callback_data: "no_callback",
            },
          ],
          ...buttons,
          navButtons.length ? navButtons : [],
          [{ text: "🔙 بازگشت", callback_data: "home" }],
        ],
      },
    });
  });

  bot.callbackQuery(/^album:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const albumId = decodeURIComponent(ctx.match[1]!);
    const page = parseInt(ctx.match[2] || "0");
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    let songs = getSongsByAlbumId(albumId);

    if (!songs.length) {
      await ctx.answerCallbackQuery("آهنگی پیدا نشد!");
      return;
    }

    const pageSongs = songs.slice(start, end);

    const buttons = pageSongs.map((song) => [
      {
        text: `🎵 ${song.title} — ${song.artist}`,
        callback_data: `s:${song.id}`,
      },
    ]);

    const navButtons = [];

    if (page > 0) {
      navButtons.push({
        text: "⬅️ قبلی",
        callback_data: `album:${encodeURIComponent(albumId)}:${page - 1}`,
      });
    }

    const hasNext = end < songs.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `album:${encodeURIComponent(albumId)}:${page + 1}`,
      });
    }

    const totalAlbums = getAllAlbums();
    const currentAlbumIndex = totalAlbums.findIndex((a) => a.albumId === albumId);

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `💿 ${totalAlbums[currentAlbumIndex]?.albumName} [صفحه ${
                page + 1
              }]`,
              callback_data: "no_callback",
            },
          ],
          ...buttons,
          navButtons.length ? navButtons : [],
          [{ text: "🔙 بازگشت به آلبوم‌ها", callback_data: `albums:0` }],
          [{ text: "🏠 خانه", callback_data: "home" }],
        ],
      },
    });
  });
}
