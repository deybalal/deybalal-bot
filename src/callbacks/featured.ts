import { Bot } from "grammy";
import prisma from "../db";

export function registerFeaturedCallbacks(bot: Bot) {
  bot.callbackQuery("featured", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from!.id) },
    });

    if (!user) {
      await ctx.answerCallbackQuery("❌ کاربر پیدا نشد");
      return;
    }

    const newSendDailyFeaturedValue = !user.sendDailyFeatured;

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        sendDailyFeatured: newSendDailyFeaturedValue,
      },
    });

    if (newSendDailyFeaturedValue) {
      await ctx.reply(
        `همتبار! ارسال روزانه ی آهنگ برای شما فعال شد! هر روز ساعت 13:00 یک آهنگ لری بصورت تصادفی انتخاب میشود و برای شما فرستاده خواهد شد! برای غیرفعال کردن روی /nofeatured کلیک کنید.`
      );
    } else {
      await ctx.reply(
        `همتبار! ارسال روزانه ی آهنگ برای شما غیرفعال شد! درصورت تمایل به فعال سازی، روی /featured کلیک کنید!`
      );
    }
  });
}
