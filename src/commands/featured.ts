import { Bot } from "grammy";
import prisma from "../db";

export function registerFeaturedCommands(bot: Bot) {
  bot.command("featured", async (ctx) => {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from!.id) },
    });

    if (!user) {
      await ctx.answerCallbackQuery("❌ کاربر پیدا نشد");
      return;
    }

    const newSendDailyFeaturedValue = true;

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        sendDailyFeatured: newSendDailyFeaturedValue,
      },
    });

    await ctx.reply(
      `همتبار! ارسال روزانه ی آهنگ برای شما فعال شد! هر روز ساعت 13:00 یک آهنگ لری بصورت تصادفی انتخاب میشود و برای شما فرستاده خواهد شد! برای غیرفعال کردن روی /nofeatured کلیک کنید.`
    );
  });

  bot.command("nofeatured", async (ctx) => {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(ctx.from!.id) },
    });

    if (!user) {
      await ctx.answerCallbackQuery("❌ کاربر پیدا نشد");
      return;
    }

    const newSendDailyFeaturedValue = false;

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        sendDailyFeatured: newSendDailyFeaturedValue,
      },
    });

    await ctx.reply(
      `همتبار! ارسال روزانه ی آهنگ برای شما غیرفعال شد! درصورت تمایل به فعال سازی، روی /featured کلیک کنید!`
    );
  });
}
