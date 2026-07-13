import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import type { InlineQueryResultCachedAudio } from "grammy/types";
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
  getSongs,
  getSongsByArtistId,
  getStats,
  getTelegramFile,
  incrementSongDownloads,
  incrementViewCount,
  removeFavorite,
  searchSongs,
  getPreferredQuality,
  setPreferredQuality,
  getTopPlayedSongs,
  getMostDownloadedSongs,
  getAllAlbums,
  getSongsByAlbumId,
} from "./dbUtils";
import { db } from "./db";
import { showSong } from "../tools/showSong";
import { getArtistById } from "../tools/getArtistName";
import { sendSearchResults } from "../tools/sendSearchResults";
import type { Song } from "../types/types";
import path from "path";
import {
  startLyricVideo,
  handlePhoto,
  handleDoneButton,
  handleRangeInput,
  handleCancel,
  executeRendering,
} from "./lyricVideo/handler";
import { getState, setState } from "./lyricVideo/state";
import { findInlineBrokenFiles } from "../scripts/junks/findInlineBrokenFiles";

const app = new Hono();

const bot = new Bot(process.env.BOT_TOKEN!);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// /start command
bot.command("start", async (ctx) => {
  ensureUser(ctx.from!);

  console.log("ctx.match? ", ctx.match);

  if (ctx.match?.startsWith("q_")) {
    const query = Buffer.from(ctx.match.substring(2), "base64url").toString(
      "utf8"
    );

    const songs = searchSongs(query);

    if (songs.length === 0) {
      await ctx.reply(`🔍 نتیجه‌ای برای "<b>${query}</b>" پیدا نشد.`, {
        parse_mode: "HTML",
      });
      return;
    }

    await sendSearchResults(ctx, query, 0, songs);
    return;
  }

  if (ctx.match?.startsWith("a_")) {
    const artistId = ctx.match.substring(2);
    console.log("artID ", artistId);

    const songs = getSongsByArtistId(artistId);

    if (!songs.length) {
      await ctx.reply("آهنگی برای این هنرمند پیدا نشد!");
      return;
    }
    const artist = await getArtistById(artistId);
    const artistName = artist?.name || "هنرمند"; // fallback if needed

    const artistNameEn = artist?.nameEn || "artist";

    let page = 0;

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
        reply_markup: {
          inline_keyboard: [
            [{ text: `🎤 ${artistName}`, callback_data: `a:${artistId}:0` }],
            ...buttons,
            navButtons.length ? navButtons : [],
            extraButtons,
          ],
        },
      });
    } else {
      await ctx.reply(
        `🎤 ${artistName}\n\n${pageSongs
          .map((song) => `🎵 ${song.title}`)
          .join("\n")}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎤 ${artistName}`, callback_data: `a:${artistId}:0` }],
              ...buttons,
              navButtons.length ? navButtons : [],
              extraButtons,
            ],
          },
        }
      );
    }

    return;
  }

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
    .text("🔍 جستجو", "search_prompt")
    .text("🎵 موزیک تصادفی", "random")
    .row()
    .text("⭐علاقه‌مندی ها", "favorites:0")
    .row()
    .text("📊 بیشترین بازدید", "top:0")
    .text("🎵 بیشترین دانلود", "mostplayed:0")
    .row()
    .text("💿 آلبوم‌ها", "albums:0")
    .row()
    .text("ℹ️ درباره", "about")
    .text("⚙️ تنظیمات", "settings");

  let text = `🎵 خش اومیی همتبار!

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

  await ctx.reply(text, { reply_markup: inline });
});

bot.callbackQuery(/^lv_res_(big|small)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = getState(userId);

  if (!state || state.step !== "waiting_resolution") {
    return ctx.answerCallbackQuery({
      text: "درخواست منقضی شده است.",
    });
  }

  const resolution = ctx.match[1] as "big" | "small";

  state.resolution = resolution;
  state.step = "rendering";
  setState(userId, state);

  await ctx.answerCallbackQuery();

  await ctx.deleteMessage();

  const progress = await ctx.reply(
    `🎥 رزولوشن: ${resolution === "big" ? "🖥 بزرگ (PC)" : "📱 کوچک (Instagram)"}

⏳ شروع پردازش...
📥 درحال دریافت فایل صوتی...`
  );

  state.progressMessageId = progress.message_id;
  setState(userId, state);

  await executeRendering(ctx);
});

bot.command("find", async (ctx) => {
  const allSongs = getSongs();
  const filteredSongsStartIndex = allSongs.findIndex(
    (song) => song.id === "cmpkwqnsy004a4ggpweorm3ll"
  );
  const filteredSongs = allSongs.slice(filteredSongsStartIndex);
  await findInlineBrokenFiles(filteredSongs);
  await ctx.reply("✅ جستجوی فایل‌های ناقص انجام شد.");
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

bot.callbackQuery("search_prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "🔍 متن مورد نظر خود را ارسال کنید.\n\nمثال: <b>کوروش اسدپور</b> یا <b>بختیاری</b>",
    { parse_mode: "HTML" }
  );
});

bot.callbackQuery("home", async (ctx) => {
  await ctx.answerCallbackQuery();

  const stats = getStats();

  const inline = new InlineKeyboard()
    .text("🔍 جستجو", "search_prompt")
    .text("🎵 موزیک تصادفی", "random")
    .row()
    .text("⭐علاقه‌مندی ها", "favorites:0")
    .row()
    .text("📊 بیشترین بازدید", "top:0")
    .text("🎵 بیشترین دانلود", "mostplayed:0")
    .row()
    .text("💿 آلبوم‌ها", "albums:0")
    .row()
    .text("ℹ️ درباره", "about")
    .text("⚙️ تنظیمات", "settings");

  let text = `🎵 خش اومیی همتبار!

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

  await ctx.editMessageReplyMarkup({
    reply_markup: inline,
  });
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

bot.callbackQuery(/^lv:(.+)$/, async (ctx) => {
  const songId = ctx.match[1];
  if (!songId) {
    await ctx.answerCallbackQuery("❌ خطا");
    return;
  }
  await startLyricVideo(ctx, songId);
});

bot.callbackQuery(/^lv_done:(.+)$/, async (ctx) => {
  const songId = ctx.match[1];
  if (!songId) {
    await ctx.answerCallbackQuery("❌ خطا");
    return;
  }
  await handleDoneButton(ctx, songId);
});

bot.command("search", async (ctx) => {
  ensureUser(ctx.from!);
  const query = ctx.match?.trim();

  if (!query) {
    await ctx.reply(
      "🔍 لطفاً عبارت جستجو را وارد کنید.\n\nمثال: <code>/search بهرام</code>",
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

bot.callbackQuery(/^search:(.+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const query = ctx.match[1]!;
  const page = parseInt(ctx.match[2] || "0");

  const songs = searchSongs(query);

  if (songs.length === 0) {
    await ctx.answerCallbackQuery("نتیجه‌ای پیدا نشد!");
    return;
  }

  const PAGE_SIZE = 20;
  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageSongs = songs.slice(start, end);

  const buttons = pageSongs.map((song: any) => [
    {
      text: `🎵 ${song.title} — ${song.artist}`,
      callback_data: `s:${song.id}`,
    },
  ]);

  const navButtons = [];

  if (page > 0) {
    navButtons.push({
      text: "⬅️ قبلی",
      callback_data: `search:${query}:${page - 1}`,
    });
  }

  const hasNext = end < songs.length;

  if (hasNext) {
    navButtons.push({
      text: "بعدی ➡️",
      callback_data: `search:${query}:${page + 1}`,
    });
  }

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `🔍 ${songs.length} نتیجه برای "${query}"`,
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

bot.command("users", async (ctx) => {
  if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
    await ctx.reply("You are not authorized to use this command.");
    return;
  }
  const users = db.query("SELECT * FROM users").all();
  await ctx.reply(JSON.stringify(users));
});

bot.on("inline_query", async (ctx) => {
  const badFilesIds = new Map<string, InlineQueryResultCachedAudio[]>();
  try {
    const query = ctx.inlineQuery.query.trim();

    if (!query) {
      await ctx.answerInlineQuery([], {
        cache_time: 300,
        button: {
          text: "🔍 عبارت جستجو را وارد کنید",
          start_parameter: "search",
        },
      });
      return;
    }

    const userId = ctx.from!.id;
    const preferredQuality = getPreferredQuality(userId);

    const songs = searchSongs(query, 50);

    const validResults: InlineQueryResultCachedAudio[] = [];

    for (const song of songs.slice(0, 50)) {
      const audioPreferred = getTelegramFile(
        song.id,
        "audio",
        preferredQuality
      );
      const audio128 = getTelegramFile(song.id, "audio", "128");
      const audio320 = getTelegramFile(song.id, "audio", "320");
      const audio64 = getTelegramFile(song.id, "audio", "64");

      const audioFile = audioPreferred || audio128 || audio320 || audio64;

      if (!audioFile?.fileId) continue;

      if (!song.title) {
        console.log("song.title is empty", song);
      }

      const artists = JSON.parse(song.artists as unknown as string);

      validResults.push({
        type: "audio",
        id: song.id,
        audio_file_id: audioFile.fileId,
        caption: `🎵 ${song.title}\n👤 ${artists
          .map(
            (s: { id: string; name: string }) =>
              `<a href="https://t.me/deybalalirbot?start=a_${s.id}">${s.name}</a>`
          )
          .join(" و ")}`,
        parse_mode: "HTML",
      });

      // validResults.push({
      //   type: "audio",
      //   id: song.id,
      //   audio_file_id: audio128!.fileId,
      //   quality: audio128!.quality,
      //   titleEn: song.titleEn?.trim() || "None",
      //   title: song.title?.trim() || "نامشخص",
      //   performer: song.artist?.trim() || "خواننده ناشناس",
      //   caption: `🎵 ${song.title}\n👤 ${song.artist}`,
      //   parse_mode: "HTML",
      // });

      // validResults.push({
      //   type: "audio",
      //   id: song.id,
      //   audio_file_id: audio64!.fileId,
      //   quality: audio64!.quality,
      //   titleEn: song.titleEn?.trim() || "None",
      //   title: song.title?.trim() || "نامشخص",
      //   performer: song.artist?.trim() || "خواننده ناشناس",
      //   caption: `🎵 ${song.title}\n👤 <a href="https://t.me/deybalalirbot?start=a_${song.id}">${song.artist}</a>`,
      //   parse_mode: "HTML",
      // });
    }

    const encoded = Buffer.from(query, "utf8").toString("base64url");

    await ctx.answerInlineQuery(validResults, {
      cache_time: 300,
      is_personal: true,
      button: {
        text: `${validResults.length} آهنگ پیدا شد`,
        start_parameter: `q_${encoded}`,
      },
    });
    // for (const result of validResults) {
    //   try {
    //     await ctx.answerInlineQuery([result], {
    //       cache_time: 0,
    //     });

    //     console.log("OK:", result.id, result.title, result.titleEn);
    //   } catch (e) {
    //     console.log(
    //       "BAD:",
    //       result.id,
    //       result.title,
    //       result.titleEn,
    //       (e as Error).message
    //     );
    //     if (!badFilesIds.has(result.id)) {
    //       badFilesIds.set(result.id, [result]);
    //     } else {
    //       badFilesIds.get(result.id)?.push(result);
    //     }
    //     // break;
    //   }
    // }
  } catch (error) {
    console.error("Inline query error:", (error as Error).message);
  }

  // await writeFile(
  //   "./badFiles.json",
  //   JSON.stringify(Array.from(badFilesIds.values()), null, 2)
  // );
});

bot.command("cancel", async (ctx) => {
  const handled = handleCancel(ctx);
  if (handled) {
    await ctx.reply("❌ عملیات لغو شد.");
  }
});

bot.callbackQuery("about", async (ctx) => {
  const stats = getStats();

  const text = `ℹ️ <b>درباره ربات</b>

🎵 <b>ربات تلگرام دی بلال</b>

🎧 ${stats.songs.toLocaleString()} آهنگ
🎤 ${stats.artists.toLocaleString()} هنرمند

✨ قابلیت‌ها:
• جستجوی آهنگ با عنوان یا هنرمند
• موزیک تصادفی
• علاقه‌مندی‌ها
• دانلود با کیفیت‌های مختلف (64, 128, 320 kbps)
• پخش پیش‌نمایش
• ساخت ویدیوی متن آهنگ
• بیشترین بازدید و پربازدیدترین آهنگ‌ها
• مرور آلبوم‌ها
• نمایش متن آهنگ

برنامه نویس: @isBuilding`;

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "home" }]],
    },
  });

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "home" }]],
    },
  });
});

bot.callbackQuery("settings", async (ctx) => {
  const userId = ctx.from!.id;
  const quality = getPreferredQuality(userId);

  const qualityLabels: Record<string, string> = {
    "320": "320 kbps ✓",
    "128": "128 kbps ✓",
    "64": "64 kbps ✓",
  };

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `🎧 ${qualityLabels[quality]}`,
            callback_data: "settings_quality",
          },
        ],
        [{ text: "🔙 بازگشت", callback_data: "home" }],
      ],
    },
  });
});

bot.callbackQuery("settings_quality", async (ctx) => {
  const userId = ctx.from!.id;
  const quality = getPreferredQuality(userId);

  const qualityLabels: Record<string, string> = {
    "320": "320 kbps ✓",
    "128": "128 kbps ✓",
    "64": "64 kbps ✓",
  };

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: quality === "320" ? "320 kbps ✓" : "320 kbps",
            callback_data: "quality:320",
          },
        ],
        [
          {
            text: quality === "128" ? "128 kbps ✓" : "128 kbps",
            callback_data: "quality:128",
          },
        ],
        [
          {
            text: quality === "64" ? "64 kbps ✓" : "64 kbps",
            callback_data: "quality:64",
          },
        ],
        [{ text: "🔙 بازگشت", callback_data: "settings" }],
      ],
    },
  });
});

bot.callbackQuery(/^quality:(320|128|64)$/, async (ctx) => {
  const quality = ctx.match[1];
  const userId = ctx.from!.id;

  setPreferredQuality(userId, quality!);

  await ctx.answerCallbackQuery({
    text: `✅ کیفیت پیش‌فرض روی ${
      quality === "320" ? "320" : quality === "128" ? "128" : "64"
    } kbps تنظیم شد.`,
    show_alert: true,
  });

  const newQuality = getPreferredQuality(userId);

  const qualityLabels: Record<string, string> = {
    "320": "320 kbps ✓",
    "128": "128 kbps ✓",
    "64": "64 kbps ✓",
  };

  await ctx.editMessageReplyMarkup({
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: newQuality === "320" ? "320 kbps ✓" : "320 kbps",
            callback_data: "quality:320",
          },
        ],
        [
          {
            text: newQuality === "128" ? "128 kbps ✓" : "128 kbps",
            callback_data: "quality:128",
          },
        ],
        [
          {
            text: newQuality === "64" ? "64 kbps ✓" : "64 kbps",
            callback_data: "quality:64",
          },
        ],
        [{ text: "🔙 بازگشت", callback_data: "settings" }],
      ],
    },
  });
});

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

bot.command("mostplayed", async (ctx) => {
  ensureUser(ctx.from!);

  const songs = getMostDownloadedSongs(50);

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
      } [${song.downloads.toLocaleString()} دانلود]`,
      callback_data: `s:${song.id}`,
    },
  ]);

  const navButtons = [];

  const hasNext = end < songs.length;

  if (hasNext) {
    navButtons.push({
      text: "بعدی ➡️",
      callback_data: `mostplayed:${page + 1}`,
    });
  }

  await ctx.reply(`🎵 بیشترین دانلود`, {
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

bot.callbackQuery(/^lyrics:(.+)$/, async (ctx) => {
  const songId = ctx.match[1];
  const song = getSongById(songId!);

  if (!song || !song.lyrics) {
    await ctx.answerCallbackQuery("❌ متن آهنگی برای این آهنگ پیدا نشد.");
    return;
  }

  await ctx.answerCallbackQuery();

  const lyrics = song.lyrics || "";
  const MESSAGE_LIMIT = 4096;

  if (lyrics.length <= MESSAGE_LIMIT) {
    await ctx.replyWithPhoto(song.telegram.coverArt?.fileId || "", {
      caption: `🎵 <a href="https://t.me/deybalalirbot?start=s_${song.id}"><b>${song.title}</b></a> از  <a href="https://t.me/deybalalirbot?start=a_${song.artists[0]?.id}"><b>${song.artist}</b></a>\n\n<i>${lyrics}</i>`,
      parse_mode: "HTML",
    });
    return;
  }

  const chunks: string[] = [];
  let currentChunk = "";

  for (const line of lyrics.split("\n")) {
    if ((currentChunk + line + "\n").length > MESSAGE_LIMIT) {
      chunks.push(currentChunk);
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const isLast = i === chunks.length - 1;

    if (i === 0) {
      await ctx.replyWithPhoto(song.telegram.coverArt?.fileId || "", {
        caption: `🎵 <b>${song.title}</b>\n\nصفحه ${i + 1}/${
          chunks.length
        }\n\n<i>${chunk}</i>`,
        parse_mode: "HTML",
      });
    } else {
      await ctx.reply(`<i>${chunk}</i>\n\nصفحه ${i + 1}/${chunks.length}`, {
        parse_mode: "HTML",
      });
    }
  }
});

bot.on("message:photo", async (ctx) => {
  handlePhoto(ctx);
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  const rangeHandled = await handleRangeInput(ctx);
  if (rangeHandled) return;

  ensureUser(ctx.from!);

  const songs = searchSongs(text);

  if (songs.length === 0) {
    await ctx.reply(`🔍 نتیجه‌ای برای "<b>${text}</b>" پیدا نشد.`, {
      parse_mode: "HTML",
    });
    return;
  }

  await sendSearchResults(ctx, text, 0, songs);
});

app.post("/webhook", async (c) => {
  const update = await c.req.json();

  await bot.handleUpdate(update);
  return c.text("ok");
});

bot.catch((err) => {
  console.error("Bot Error is: ", err.message);
});

bot.start({ drop_pending_updates: true });

const PORT = parseInt(process.env.PORT!);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

export default bot;
