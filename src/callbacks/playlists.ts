import { Bot } from "grammy";
import { getTopPlayedSongs, getMostDownloadedSongs } from "../dbUtils";

export function registerPlaylistCallbacks(bot: Bot) {
  bot.callbackQuery(/^top:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const page = parseInt(ctx.match[1] || "0");
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const songs = getTopPlayedSongs(50);

    if (!songs.length) {
      await ctx.answerCallbackQuery("آهنگی پیدا نشد!");
      return;
    }

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

    if (page > 0) {
      navButtons.push({
        text: "⬅️ قبلی",
        callback_data: `top:${page - 1}`,
      });
    }

    const hasNext = end < songs.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `top:${page + 1}`,
      });
    }

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `📊 بیشترین بازدید آهنگ‌ها [صفحه ${page + 1}]`,
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

  bot.callbackQuery(/^mostplayed:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const page = parseInt(ctx.match[1] || "0");
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const songs = getMostDownloadedSongs(50);

    if (!songs.length) {
      await ctx.answerCallbackQuery("آهنگی پیدا نشد!");
      return;
    }

    const pageSongs = songs.slice(start, end);

    const buttons = pageSongs.map((song) => [
      {
        text: `🎵 ${song.title} — ${
          song.artist
        } [${song.downloads.toLocaleString()} دانلود]`,
        callback_data: `s:${song.id}`,
      },
    ]);

    const navButtons = [];

    if (page > 0) {
      navButtons.push({
        text: "⬅️ قبلی",
        callback_data: `mostplayed:${page - 1}`,
      });
    }

    const hasNext = end < songs.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `mostplayed:${page + 1}`,
      });
    }

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `🎵 بیشترین دانلود [صفحه ${page + 1}]`,
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
}
