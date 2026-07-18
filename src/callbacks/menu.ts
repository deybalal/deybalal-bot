import { Bot } from "grammy";
import { getPreferredQuality, setPreferredQuality, getStats } from "../dbUtils";
import { InlineKeyboard } from "grammy";

export function registerMenuCallbacks(bot: Bot) {
  bot.callbackQuery("home", async (ctx) => {
    await ctx.answerCallbackQuery();

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

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

    await ctx.editMessageReplyMarkup({
      reply_markup: inline,
    });
  });

  bot.callbackQuery("about", async (ctx) => {
    const stats = getStats();

    const text = `
🎵 <b>ربات تلگرام دی بلال</b>

🎧 ${stats.songs.toLocaleString()} آهنگ
🎤 ${stats.artists.toLocaleString()} هنرمند


این ربات اپن سورسه (منبع باز) و کدهای بات رو میتونید توی گیتهاب مشاهده کنید و در صورت تمایل توی توسعه پروژه مشارکت داشته باشید!
https://github.com/deybalal/deybalal-bot

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
      link_preview_options: {
        is_disabled: true,
      },
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
}
