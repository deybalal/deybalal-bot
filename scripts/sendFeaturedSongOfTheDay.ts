import cron from "node-cron";
import { Bot, InlineKeyboard } from "grammy";
import "dotenv/config";
import prisma from "../src/db";

const bot = new Bot(process.env.BOT_TOKEN!);

async function sendFeaturedSong() {
  console.log("Starting sendFeaturedSong job...");
  try {
    // 1. Get SongOfTheDay (most recent one)
    const featured = await prisma.songOfTheDay.findFirst({
      orderBy: { createdAt: "desc" },
      include: {
        song: {
          include: {
            telegram: true,
          },
        },
      },
    });

    if (!featured || !featured.song || !featured.song.telegram) {
      console.log("No featured song found or missing telegram data.");
      return;
    }

    const { song } = featured;

    // 2. Get users who opted in
    const users = await prisma.user.findMany({
      where: {
        sendDailyFeatured: true,
        telegramId: { not: null },
      },
    });

    if (!users.length) {
      console.log("No users to send to.");
      return;
    }

    console.log(`Found ${users.length} users to send today's featured song.`);

    const inline = new InlineKeyboard()
      .text("🎧 نمایش", `s:${song.id}`)
      .row()
      .text("🎵 موزیک بعدی", "random")
      .row()
      .text("غیرفعال کردن", "featured");

    // Use 320 quality if available, fallback to 128 or 64
    const fileId =
      song.telegram?.file_id_128 ||
      song.telegram?.file_id_320 ||
      song.telegram?.file_id_64 ||
      "";

    if (!fileId) {
      console.log("No audio file ID for featured song.");
      return;
    }

    // 3. Broadcast to users
    for (const user of users) {
      if (!user.telegramId) continue;

      try {
        await bot.api.sendAudio(user.telegramId.toString(), fileId, {
          caption: `🔥 آهنگ ویژه امروز!\n\n${song.title} از ${song.artist}`,
          duration: song.duration,
          performer: song.artist || "None",
          title: `${song.title} از ${song.artist}`,
          parse_mode: "HTML",
          reply_markup: inline,
        });
        console.log(`Successfully sent to Telegram ID: ${user.telegramId}`);
      } catch (err) {
        console.error(`Failed to send to Telegram ID: ${user.telegramId}`, err);
      }

      // Small delay to avoid hitting Telegram API rate limits
      await new Promise((res) => setTimeout(res, 50));
    }
  } catch (error) {
    console.error("Error sending featured song:", error);
  }
}

// Schedule it to run every day at 13:00 Tehran time
cron.schedule(
  "0 13 * * *",
  async () => {
    await sendFeaturedSong();
  },
  {
    timezone: "Asia/Tehran",
  }
);

console.log("sendFeaturedSongOfTheDay job scheduled for 13:00 Tehran time.");
