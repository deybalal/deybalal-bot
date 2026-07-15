import { Bot, InlineKeyboard } from "grammy";
import {
  ensureUser,
  getArtistById,
  getSongById,
  getSongsByArtistId,
  getStats,
  searchSongs,
} from "../dbUtils";
import { sendSearchResults } from "../../tools/sendSearchResults";
import { showSong } from "../../tools/showSong";

export function registerStartCommand(bot: Bot) {
  bot.command("start", async (ctx) => {
    const handleUser = ensureUser(ctx.from!);

    if (handleUser) {
      await bot.api.sendMessage(
        Number(process.env.ADMIN_ID!),
        `User ${ctx.from!.first_name} started the bot!\n\nNumeric ID: ${
          ctx.from!.id
        }\nID: ${ctx.from!.username}\n\nFull name: ${`${ctx.from!.first_name} ${
          ctx.from!.last_name ? ctx.from!.last_name : ""
        }`}`,
        { parse_mode: "HTML" }
      );
    }

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
      const artist = getArtistById(artistId);
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
                [
                  {
                    text: `🎤 ${artistName}`,
                    callback_data: `a:${artistId}:0`,
                  },
                ],
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
 
می‌تونی با عنوان یا اسم خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

کانال تلگرام دی بلال:\n @deybalalir

پلتفرم دی بلال(به زودی):\nhttps://deybalal.ir
 
رادیو آنلاین لری دی بلال(به زودی):\n
 https://deybalal.ir/radio
 
 ✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

    await ctx.reply(text, { reply_markup: inline });
  });
}
