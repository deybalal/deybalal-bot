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
} from "./dbUtils";
import { db } from "./db";
import { showSong } from "../tools/showSong";
import { getArtistById } from "../tools/getArtistName";
import { sendSearchResults } from "../tools/sendSearchResults";
import { readFile, writeFile } from "fs/promises";
import type { Song } from "../types/types";
import path from "path";

const app = new Hono();

const bot = new Bot(process.env.BOT_TOKEN!);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendAudioWithRetry(
  chatId: number,
  fileId: string,
  maxRetries = 5
) {
  let attempt = 0;

  while (true) {
    try {
      return await bot.api.sendAudio(chatId, fileId);
    } catch (e) {
      const isFlood =
        e instanceof GrammyError &&
        e.error_code === 429 &&
        e.parameters?.retry_after != null;

      if (!isFlood || attempt >= maxRetries) {
        throw e; // real error (e.g. AUDIO_TITLE_EMPTY-adjacent, invalid file, etc.) — bubble up
      }

      const waitSec = e.parameters!.retry_after! + 2;
      console.log(
        `429 rate limited, waiting ${waitSec}s (attempt ${attempt + 1})`
      );
      await sleep(waitSec * 1000);
      attempt++;
      // loop retries the same fileId
    }
  }
}

async function findInlineBrokenFiles(allSongs: Song[]) {
  interface BadFile {
    songId: string;
    quality: string;
    fileId: string;
    singer?: string | null;
    dbTitle: string;
    embeddedTitle: string | undefined;
    embeddedPerformer: string | undefined;
  }

  const badFiles: BadFile[] = JSON.parse(
    await readFile("./badFiles.json", "utf-8")
  );

  console.log("allSongs ", allSongs.length);

  let reportedIndx = 0;

  for (const song of allSongs) {
    const qualities = [
      { q: "320", file: getTelegramFile(song.id, "audio", "320") },
      { q: "128", file: getTelegramFile(song.id, "audio", "128") },
      { q: "64", file: getTelegramFile(song.id, "audio", "64") },
    ];

    for (const { q, file } of qualities) {
      if (!file?.fileId) continue;

      if (reportedIndx % 10 === 0) {
        console.log("Reported", reportedIndx, "of", allSongs.length * 3);
      }
      reportedIndx++;

      try {
        // NOTE: no title/performer override here on purpose
        const msg = await sendAudioWithRetry(-1003936127617, file.fileId);
        const embeddedTitle = msg.audio?.title;
        const embeddedPerformer = msg.audio?.performer;

        await bot.api.deleteMessage(-1003936127617, msg.message_id);

        if (!embeddedTitle) {
          console.log("BROKEN FOR INLINE:", song.id, q);
          badFiles.push({
            songId: song.id,
            quality: q,
            fileId: file.fileId,
            dbTitle: song.title,
            singer: song.artistEn,
            embeddedTitle,
            embeddedPerformer,
          });
          await writeFile("./badFiles.json", JSON.stringify(badFiles, null, 2));
        } else {
          // console.log("OK:", song.id, q, "-", embeddedTitle);
        }
      } catch (e) {
        console.log("ERROR sending:", song.id, q, (e as Error).message);
      }

      await new Promise((r) => setTimeout(r, 1200)); // stay under Telegram's per-chat rate limit
    }
  }

  await writeFile("./badFiles.json", JSON.stringify(badFiles, null, 2));
  console.log(`Done. ${badFiles.length} files missing embedded title.`);
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
    .text("درباره", "about")
    .row()
    .text("تنظیمات", "settings");

  let text = `🎵 خش اومیی همتبار!

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

\n✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

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

    const songs = searchSongs(query, 50);

    const validResults: InlineQueryResultCachedAudio[] = [];

    for (const song of songs.slice(0, 50)) {
      const audio320 = getTelegramFile(song.id, "audio", "320");
      const audio128 = getTelegramFile(song.id, "audio", "128");
      const audio64 = getTelegramFile(song.id, "audio", "64");

      const audioFile = audio320 || audio128 || audio64;

      if (!audioFile?.fileId) continue;

      if (!song.title) {
        console.log("song.title is empty", song);
      }

      console.log("song.artists ", song.artists);

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
          .join(", ")}`,
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

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

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
