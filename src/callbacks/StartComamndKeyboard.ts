import { InlineKeyboard } from "grammy";
import prisma from "../db";

export const startCommandKeyboard = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(userId) },
  });

  const inline = new InlineKeyboard()
    .text("🎵 موزیک تصادفی", "random")
    .text("💡 راهنما", "help")
    .row()
    .text("🔍 جستجو", "search_prompt")
    .switchInlineCurrent("🔍 جستجو اینلاین", "مسعود بختیاری")
    .style("success")
    .row()
    .text("🎯 تشخیص هوشمند آهنگ", "identify")
    .row()
    .text("⭐علاقه‌مندی ها", "favorites:0")
    .text("💿 آلبوم‌ها", "albums:0")
    .row()
    .text("📊 بیشترین بازدید", "top:0")
    .text("🎵 بیشترین دانلود", "mostplayed:0")
    .row()
    .text(
      `${user?.sendDailyFeatured ? "آهنگ روزانه ✅" : "آهنگ روزانه ❌"}`,
      "featured"
    )
    .text("📝 متن آهنگ تصادفی", "randomlyric")
    .row()
    .text("ℹ️ درباره", "about")
    .text("⚙️ تنظیمات", "settings");

  return inline;
};
