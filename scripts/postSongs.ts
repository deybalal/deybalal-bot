import cron from "node-cron";
import { Bot } from "grammy";
import { sendSongToChannel } from "./sendSongToChannel";
import { getUnpostedSongs, updateSongWithPostDetails } from "../src/dbUtils";
import "dotenv/config";

const bot = new Bot(process.env.BOT_TOKEN!);

const CHANNEL_ID = parseInt(process.env.CHANNEL_CHAT_ID!);

type PostTime = {
  hour: number;
  minute: number;
};

function generatePostTimes(): PostTime[] {
  const start = 9 * 60 + 20; // 09:20
  const end = 23 * 60 + 30; // 23:30

  const times = new Set<number>();

  while (times.size < 3) {
    const random = Math.floor(Math.random() * (end - start + 1)) + start;

    times.add(random);
  }

  return [...times]
    .sort((a, b) => a - b)
    .map((minutes) => ({
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
    }));
}

let todayPosts: PostTime[] = generatePostTimes();

async function postRandomSong() {
  const songs = getUnpostedSongs();

  if (!songs.length) {
    console.log("No songs available");
    return;
  }

  const song = songs[Math.floor(Math.random() * songs.length)];

  if (!song) {
    console.log("No Random Song selected for schulde posting");
    return;
  }

  try {
    console.log("Posting:", song.title);

    // console.log("SONG < ", song);

    // Send cover/message
    const coverMessage = await sendSongToChannel(bot, CHANNEL_ID, song);

    // Send OGG immediately after
    const oggMessage = await bot.api.sendAudio(
      CHANNEL_ID,
      song.telegram.ogg?.fileId!,
      {
        caption: `🎧 ${song.title} - ${song.artist}\n@deybalalir`,
      }
    );

    const mp3Message = await bot.api.sendAudio(
      CHANNEL_ID,
      song.telegram[128]?.fileId!,
      {
        caption: `🎧 ${song.title} - ${song.artist}\n\n کیفیت 128 \n\nدانلود با کیفیت عالی:\nhttps://t.me/deybalalirbot?start=s_${song.id}`,
      }
    );

    updateSongWithPostDetails(
      song.id,
      coverMessage.message_id,
      oggMessage.message_id,
      mp3Message.message_id
    );

    console.log(
      "Posted successfully:",
      coverMessage.message_id,
      oggMessage.message_id
    );
  } catch (err) {
    console.error("Post failed:", err);
  }
}

function setupDailyPosts() {
  todayPosts = generatePostTimes();

  console.log("Today's posting times:", todayPosts);

  for (const time of todayPosts) {
    cron.schedule(
      `${time.minute} ${time.hour} * * *`,
      async () => {
        await postRandomSong();
      },
      {
        timezone: "Asia/Tehran",
      }
    );
  }
}

setupDailyPosts();

// regenerate every midnight
cron.schedule(
  "0 0 * * *",
  () => {
    setupDailyPosts();
  },
  {
    timezone: "Asia/Tehran",
  }
);

// postRandomSong();
