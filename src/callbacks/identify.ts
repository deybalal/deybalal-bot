import { Bot } from "grammy";

export function registerIdentifyCallback(bot: Bot) {
  bot.callbackQuery("identify", async (ctx) => {
    const text = `برای شناسایی آهنگ، لطفاً بخشی از آهنگ را بصورت وویس (voice) بفرستید. \n\n حداقل 10 ثانیه از آهنگ و ترجیحا از بخشی که صدای خواننده معلوم باشه رو بفرستید.\n\n به "دقت تشخیص" هم توجه داشته باشید و احتمال خطا داشتن رو هم درنظر بگیرید!"!`;

    await ctx.reply(text, { parse_mode: "HTML" });
  });
}
