import { Bot } from "grammy";
import { getSongsByArtistId, getRandomSongByArtistId } from "../dbUtils";
import { getArtistById } from "../../tools/getArtistName";
import { showSong } from "../../tools/showSong";

export function registerArtistCallbacks(bot: Bot) {
  bot.callbackQuery(/^a:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    try {
      const artistId = ctx.match[1];
      const page = parseInt(ctx.match[2] || "0");

      if (!artistId) {
        await ctx.answerCallbackQuery("هنرمند مورد نظر یافت نشد!");
        return;
      }

      const songs = getSongsByArtistId(artistId);

      if (!songs.length) {
        await ctx.answerCallbackQuery("آهنگی برای این هنرمند پیدا نشد!");
        return;
      }

      console.log("songs ", songs.length);
      const artist = await getArtistById(artistId);
      const artistName = artist?.name || "هنرمند";
      const artistNameEn = artist?.nameEn || "artist";

      const PAGE_SIZE = 20;
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE;

      const pageSongs = songs.slice(start, end);

      console.log("pageSongs ", pageSongs.length);
      const buttons = pageSongs.map((song) => [
        {
          text: `🎵 ${song.title}`,
          callback_data: `s:${song.id}`,
        },
      ]);

      const navButtons = [];

      if (page > 0) {
        navButtons.push({
          text: "⬅️ قبلی",
          callback_data: `a:${artistId}:${page - 1}`,
        });
      }

      const hasNext = end < songs.length;

      if (hasNext) {
        navButtons.push({
          text: "بعدی ➡️",
          callback_data: `a:${artistId}:${page + 1}`,
        });
      }

      const extraButtons = [
        {
          text: "🎲 پخش تصادفی",
          callback_data: `arand:${artistId}`,
        },
      ];

      if (artist?.telegram?.fileId) {
        await ctx.replyWithPhoto(artist?.telegram?.fileId || "", {
          caption: `🎤 ${artistName}\n\n`,
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎤 ${artistName}`, callback_data: `a:${artistId}:0` }],
              ...buttons,
              navButtons.length ? navButtons : [],
              extraButtons,
              [{ text: "🔙 بازگشت", callback_data: "home" }],
            ],
          },
        });
      } else {
        await ctx.reply(`🎤 ${artistName}\n\n`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎤 ${artistName}`, callback_data: `a:${artistId}:0` }],
              ...buttons,
              navButtons.length ? navButtons : [],
              extraButtons,
              [{ text: "🔙 بازگشت", callback_data: "home" }],
            ],
          },
        });
      }
    } catch (error) {
      console.error(error);
      await ctx.answerCallbackQuery("خطا در بارگذاری آهنگ‌ها!");
    }
  });

  bot.callbackQuery(/^arand:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const artistId = ctx.match[1];

    if (!artistId) {
      await ctx.answerCallbackQuery("هنرمند مورد نظر یافت نشد!");
      return;
    }

    const random = getRandomSongByArtistId(artistId);

    if (!random) {
      await ctx.answerCallbackQuery("آهنگی پیدا نشد!");
      return;
    }
    showSong(ctx, random);
  });
}
