import { Bot } from "grammy";

export function registerIdentifyCallback(bot: Bot) {
  bot.callbackQuery("identify", async (ctx) => {
    await ctx.answerCallbackQuery();

    const text = `برای شناسایی آهنگ، لطفاً بخشی از آهنگ را بصورت وویس (voice) بفرستید. \n\nحداقل 10 ثانیه از آهنگ و ترجیحا از بخشی که صدای خواننده معلوم باشه رو بفرستید.\n\nبه "دقت تشخیص" هم توجه داشته باشید و احتمال خطا داشتن رو هم درنظر بگیرید!\n\n برای تست کردن این قابلیت، میتونید پیش نمایش هایی که توی <a href="https://t.me/deybalalir">کانال دی بلال</a> هست رو فروارد کنید برای ربات.`;

    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });
}
