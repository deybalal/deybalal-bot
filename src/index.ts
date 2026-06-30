import { Bot, InlineKeyboard } from "grammy";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  addFavorite,
  ensureUser,
  getFavoriteSongs,
  getRandomSong,
  getRandomSongByArtistId,
  getSongById,
  getSongsByArtistId,
  getStats,
  incrementSongDownloads,
  incrementViewCount,
  removeFavorite,
} from "./dbUtils";
import { db } from "./db";
import { showSong } from "../tools/showSong";
import { getArtistById } from "../tools/getArtistName";

const app = new Hono();

const bot = new Bot(process.env.BOT_TOKEN!);

// /start command
bot.command("start", async (ctx) => {
  ensureUser(ctx.from!);

  if (ctx.match?.startsWith("s_")) {
    const songId = ctx.match.substring(2);

    const song = getSongById(songId);

    if (!song) {
      await ctx.reply("❌ این آهنگ پیدا نشد.");
      return;
    }

    return await showSong(ctx, song);
  }

  const stats = getStats();

  const inline = new InlineKeyboard()
    .text("🎵 موزیک تصادفی", "random")
    .text("⭐علاقه‌مندی ها", "favorites:0")
    .row()
    .text("درباره", "about")
    .row()
    .text("تنظیمات", "settings");

  let text = `🎵 خش اومیی همتبار!

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

\n✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

  await ctx.reply(text, { reply_markup: inline });
});

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

bot.callbackQuery("no_callback", async (ctx) => {
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("random", async (ctx) => {
  console.log("Random query");
  const randomSong = getRandomSong();
  await ctx.answerCallbackQuery();

  const inline = new InlineKeyboard()
    .text("🎧 نمایش", `s:${randomSong?.id}`)
    .row()
    .text("🎵 موزیک بعدی", "random")
    .row();

  await ctx.replyWithAudio(randomSong?.telegram["320"]?.fileId || "", {
    caption: `${randomSong?.title} از ${randomSong?.artist}`,
    duration: randomSong?.duration,
    performer: randomSong?.artistEn || "None",
    title: `${randomSong?.title} از ${randomSong?.artist}`,
    parse_mode: "HTML",
    reply_markup: inline,
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

bot.callbackQuery(/^s:(.+)$/, async (ctx) => {
  console.log("Song query");
  const songId = ctx.match[1];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await showSong(ctx, song);
  incrementViewCount(songId!);
});
bot.callbackQuery(/^d:(.+):(.+)$/, async (ctx) => {
  console.log("Dowload query");
  const songId = ctx.match[1];
  const quality = ctx.match[2];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  if (!song.telegram[quality as keyof typeof song.telegram]) {
    await ctx.answerCallbackQuery("کیفیت مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await ctx.replyWithAudio(
    song.telegram[quality as keyof typeof song.telegram]?.fileId || ""
  );
  incrementSongDownloads(songId!);
});

bot.callbackQuery(/^p:(.+)$/, async (ctx) => {
  console.log("Preview query");
  const songId = ctx.match[1];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await ctx.replyWithAudio(song.telegram.ogg?.fileId || "");
});

bot.callbackQuery(/^sh:(.+)$/, async (ctx) => {
  const songId = ctx.match[1];
  const botUsername = ctx.me.username;

  const deepLink = `https://t.me/${botUsername}?start=s_${songId}`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}`;

  const inline = new InlineKeyboard().url("📤 اشتراک‌گذاری آهنگ", shareUrl);

  await ctx.answerCallbackQuery();

  await ctx.reply(
    `🔗 لینک اشتراک‌گذاری این آهنگ:\n\n${deepLink}\n\nبرای اشتراک‌گذاری این آهنگ، دکمه زیر را انتخاب کنید:`,
    {
      reply_markup: inline,
    }
  );
});

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
    const artistName = artist?.name || "هنرمند"; // fallback if needed
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

    await ctx.editMessageReplyMarkup({
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

bot.command("users", async (ctx) => {
  if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
    await ctx.reply("You are not authorized to use this command.");
    return;
  }
  const users = db.query("SELECT * FROM users").all();
  await ctx.reply(JSON.stringify(users));
});

app.post("/webhook", async (c) => {
  const update = await c.req.json();

  await bot.handleUpdate(update);
  return c.text("ok");
});

bot.catch((err) => {
  console.error("Bot Error is: ", err);
});

bot.start({ drop_pending_updates: true });

const PORT = parseInt(process.env.PORT!);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

export default bot;
