import cron from "node-cron";
import "dotenv/config";
import prisma from "../src/db";

async function setFeaturedSong() {
  console.log("Starting setFeaturedSong job...");
  try {
    const songCount = await prisma.song.count();

    if (songCount === 0) {
      console.log("No songs found");
      return;
    }

    const skip = Math.floor(Math.random() * songCount);

    const randomSong = await prisma.song.findFirst({
      skip: skip,
    });

    if (!randomSong) {
      console.log("Song not found");
      return;
    }

    await prisma.songOfTheDay.deleteMany();

    const songOfTheDay = await prisma.songOfTheDay.create({
      data: {
        songId: randomSong.id,
        ts: Math.floor(Date.now() / 1000),
      },
    });

    console.log("Featured song set:", songOfTheDay);
  } catch (error) {
    console.error("Error setting featured song:", error);
  }
}

// Schedule it to run every day at 1:00 AM Tehran time
cron.schedule(
  "0 1 * * *",
  async () => {
    await setFeaturedSong();
  },
  {
    timezone: "Asia/Tehran",
  }
);
