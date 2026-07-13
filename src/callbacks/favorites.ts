import { Bot } from "grammy";
import { removeFavorite, addFavorite, getFavoriteSongs, getSongById } from "../dbUtils";
import { showSong } from "../../tools/showSong";

export function registerFavoriteCallbacks(bot: Bot) {
  bot.callbackQuery(/^f:remove:(.+)$/, async (ctx) => {
    const songId = ctx.match[1];
    if (!songId) {
      await ctx.answerCallbackQuery("❌ خطا در حذف از علاقه‌مندی‌ها");
      return;
    }
    console.log("Remove from favorites:", songId);
    removeFavorite(ctx.from!.id, songId);
    await ctx.answerCallbackQuery("✅ آهنگ از علاقه‌مندی‌ها حذف شد");
    const buildSongKeyboard = await showSong(ctx, getSongById(songId)!, false);

    await ctx.editMessageReplyMarkup({
      reply_markup: buildSongKeyboard?.reply_markup,
    });
  });

  bot.callbackQuery(/^f:add:(.+)$/, async (ctx) => {
    const songId = ctx.match[1];
    if (!songId) {
      await ctx.answerCallbackQuery("❌ خطا در افزودن به علاقه‌مندی‌ها");
      return;
    }
    console.log("Add to favorites:", songId);
    addFavorite(ctx.from!.id, songId);
    await ctx.answerCallbackQuery("✅ آهنگ به علاقه‌مندی‌ها اضافه شد");
    const buildSongKeyboard = await showSong(ctx, getSongById(songId)!, false);

    await ctx.editMessageReplyMarkup({
      reply_markup: buildSongKeyboard?.reply_markup,
    });
  });

  bot.callbackQuery(/favorites:(\d+)$/, async (ctx) => {
    console.log("Favorites query");
    const page = parseInt(ctx.match[1] || "0");
    const PAGE_SIZE = 20;
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    const songs = getFavoriteSongs(ctx.from.id);

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
        callback_data: `favorites:${page - 1}`,
      });
    }

    const hasNext = end < songs.length;

    if (hasNext) {
      navButtons.push({
        text: "بعدی ➡️",
        callback_data: `favorites:${page + 1}`,
      });
    }

    const extraButtons = [
      {
        text: "🎲 پخش تصادفی",
        callback_data: `frand`,
      },
    ];

    await ctx.editMessageReplyMarkup({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `⭐ تعداد آهنگ ها: ${songs.length}`,
              callback_data: "no_callback",
            },
          ],
          ...buttons,
          navButtons.length ? navButtons : [],
          extraButtons,
          [{ text: "🔙 بازگشت", callback_data: "home" }],
        ],
      },
    });
  });

  bot.callbackQuery("frand", async (ctx) => {
    await ctx.answerCallbackQuery();

    const songs = getFavoriteSongs(ctx.from.id);

    if (songs.length === 0) {
      await ctx.answerCallbackQuery("هیچ آهنگ مورد علاقه‌ای وجود ندارد!");
      return;
    }

    const random = songs[Math.floor(Math.random() * songs.length)];

    if (!random) {
      await ctx.answerCallbackQuery("آهنگی پیدا نشد!");
      return;
    }
    showSong(ctx, random);
  });
}
