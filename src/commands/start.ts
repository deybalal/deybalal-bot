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
        }\n${
          ctx.from!.username ? `ID: @${ctx.from!.username}` : ""
        }\n\nFull name: ${`${ctx.from!.first_name} ${
          ctx.from!.last_name ? ctx.from!.last_name : ""
        }`}`,
        { parse_mode: "HTML" }
      );
    }

    console.log("ctx.match? ", ctx.match);

    if (ctx.match?.startsWith("login_") || ctx.match?.startsWith("auth_")) {
      const token = ctx.match.startsWith("login_")
        ? ctx.match.substring(6)
        : ctx.match.substring(5);

      try {
        const apiUrl =
          process.env.API_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          "http://localhost:3000";

        const response = await fetch(`${apiUrl}/api/auth/telegram/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.TELEGRAM_BOT_SECRET
              ? { "x-telegram-bot-secret": process.env.TELEGRAM_BOT_SECRET }
              : {}),
          },
          body: JSON.stringify({
            token,
            telegramUser: {
              id: ctx.from!.id,
              first_name: ctx.from!.first_name,
              last_name: ctx.from!.last_name,
              username: ctx.from!.username,
            },
          }),
        });

        const result = (await response.json()) as {
          success: boolean;
          message?: string;
        };

        if (result.success) {
          await ctx.reply(
            `🎉 <b>ورود با موفقیت تأیید شد!</b>\n\nهمتبار گرامی <b>${
              ctx.from!.first_name
            }</b>، ورود شما به وب‌سایت دی‌بلال با موفقیت انجام شد.\nاکنون می‌توانید به مرورگر خود بازگردید و از تمام امکانات سایت استفاده کنید!`,
            { parse_mode: "HTML" }
          );
        } else {
          await ctx.reply(
            `❌ <b>خطا در تأیید ورود!</b>\n\n${
              result.message ||
              "درخواست ورود نامعتبر است یا مهلت زمانی آن به پایان رسیده است. لطفاً مجدداً از وب‌سایت تلاش کنید."
            }`,
            { parse_mode: "HTML" }
          );
        }
      } catch (err) {
        console.error("Telegram auth error:", err);
        await ctx.reply(
          "❌ خطا در برقراری ارتباط با سرور برای تأیید ورود به سایت. لطفاً بعداً دوباره امتحان کنید."
        );
      }
      return;
    }

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

      if (artist?.telegramFileId) {
        await ctx.replyWithPhoto(artist?.telegramFileId || "", {
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
      .text("🎵 موزیک تصادفی", "random")
      .text("💡 راهنما", "help")
      .row()
      .text("🔍 جستجو", "search_prompt")
      .switchInlineCurrent("🔍 جستجو اینلاین", "")
      .row()
      .text("⭐علاقه‌مندی ها", "favorites:0")
      .text("💿 آلبوم‌ها", "albums:0")
      .row()
      .text("📊 بیشترین بازدید", "top:0")
      .text("🎵 بیشترین دانلود", "mostplayed:0")
      .row()
      .text("📝 متن آهنگ تصادفی", "randomlyric")
      .row()
      .text("ℹ️ درباره", "about")
      .text("⚙️ تنظیمات", "settings");

    let text = `🎵 خش اومیی همتبار!

اسم آهنگ یا خواننده ی مدنظرت رو برام بفرست!

ربات تلگرام دی بلال،
 
 🎧  ${stats.songs.toLocaleString()} آهنگ داره!
 🎤  ${stats.artists.toLocaleString()} خواننده داره!
 
می‌تونی به فارسی یا انگلیسی، اسم آهنگ یا اسم خواننده رو برای جستوجو بفرستی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

کانال تلگرام دی بلال:\n @deybalalir

<a href="https://github.com/deybalal/deybalal-bot"> کد منبع ربات به زبان Node JS</a>

 
 ✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

    // پلتفرم دی بلال(به زودی):\n<a href="https://deybalal.ir">https://deybalal.ir</a>

    // رادیو آنلاین لری دی بلال(به زودی):\n
    // <a href="https://deybalal.ir/radio">https://deybalal.ir/radio</a>

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: inline,
      link_preview_options: { is_disabled: true },
    });
  });
}
