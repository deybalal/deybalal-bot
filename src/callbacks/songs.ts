import { Bot, InlineKeyboard } from "grammy";
import { getSongById, incrementViewCount, incrementSongDownloads, searchSongs } from "../dbUtils";
import { showSong } from "../../tools/showSong";

export function registerSongCallbacks(bot: Bot) {
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
    console.log("Download query");
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

  bot.callbackQuery("random", async (ctx) => {
    console.log("Random query");
    const { getRandomSong } = await import("../dbUtils");
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
}
