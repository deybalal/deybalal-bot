import { Bot, InlineKeyboard } from "grammy";
import type { TelegramSongWithFiles } from "../../types/types";
import { getRandomSongWithLyrics } from "../dbUtils";

function highlightBotName(text: string): string {
  return text.normalize("NFKC").replace(/دی\s*بلال/g, () => {
    const url =
      Math.random() < 0.5
        ? "https://t.me/deybalalirbot"
        : "https://t.me/deybalalir";

    return `<a href="${url}"><b>دی بلال</b></a>`;
  });
}

export function registerRandomLyricCallbacks(bot: Bot) {
  bot.callbackQuery("randomlyric", async (ctx) => {
    await ctx.answerCallbackQuery();
    console.log("Random Lyric query");

    const song: TelegramSongWithFiles | null = getRandomSongWithLyrics();

    if (!song || !song.lyrics) {
      await ctx.answerCallbackQuery("❌ متن آهنگی برای این آهنگ پیدا نشد.");
      return;
    }

    const inline = new InlineKeyboard()
      .text("🎧 نمایش", `s:${song.id}`)
      .row()
      .text("🎵 بعدی", "randomlyric")
      .row();

    const lyrics = highlightBotName(song.lyrics || "");
    const MESSAGE_LIMIT = 1020;

    if (lyrics.length <= MESSAGE_LIMIT) {
      await ctx.replyWithPhoto(song.telegram.coverArt?.fileId || "", {
        caption: `🎵 <a href="https://t.me/deybalalirbot?start=s_${song.id}"><b>${song.title}</b></a> از  <a href="https://t.me/deybalalirbot?start=a_${song.artists[0]?.id}"><b>${song.artist}</b></a>\n\n<i>${lyrics}</i>`,
        parse_mode: "HTML",
        reply_markup: inline,
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
          caption: `🎵 <b>${song.title}</b>\n\n ${i + 1}/${
            chunks.length
          }\n\n<i>${chunk}</i>`,
          parse_mode: "HTML",
          reply_markup: isLast ? inline : undefined,
        });
      } else {
        await ctx.reply(`<i>${chunk}</i>\n\n ${i + 1}/${chunks.length}`, {
          parse_mode: "HTML",
          reply_markup: isLast ? inline : undefined,
        });
      }
    }
  });
}
