import "dotenv/config";
import { readFile, writeFile } from "fs/promises";
import prisma from "../src/db.ts";
import { Bot } from "grammy";

const exportedJSON = await readFile("./data/exportedEverything.json", "utf-8");
const rawFavs = await readFile("./data/favs.json", "utf-8");

try {
  const favs = JSON.parse(rawFavs as string);

  const findInFavs = (songId: string) => {
    if (favs.some((f: { id: string }) => f.id === songId)) return true;

    return false;
  };

  const updateFavs = async (songIdArr: { id: string; posted: boolean }[]) => {
    await writeFile("./data/favs.json", JSON.stringify(songIdArr, null, 2));
  };

  const exported = JSON.parse(exportedJSON as string);

  console.log("Exported.le ", exported.length);

  const songIdArr: { id: string; posted: boolean }[] = [];

  for (const item of favs) {
    songIdArr.unshift({ id: item.id, posted: item.posted });
  }

  console.log(
    "exported.data.playlistSongs . ",
    exported.data.playlistSongs.length
  );

  for (const item of exported.data.playlistSongs) {
    if (item.playlistId === "cmniz53ca0000qzgpt0c7i725") {
      if (!findInFavs(item.songId)) {
        songIdArr.unshift({ id: item.songId, posted: false });
      }
    }
  }

  await writeFile("./data/favs.json", JSON.stringify(songIdArr, null, 2));
  const fileIdArr: { fileId: string; songId: string }[] = [];

  for (const item of songIdArr) {
    if (item.posted) continue;
    const song = await prisma.song.findUnique({
      where: { id: item.id },
      include: { telegram: true },
    });
    if (song?.telegram?.file_id_320) {
      fileIdArr.push({ fileId: song.telegram.file_id_320, songId: item.id });
    } else {
      console.log("The song is not uploaded! ID: ", item.id);
    }
  }

  console.log("fileIdArr 1 ", fileIdArr[0]);
  console.log("fileIdArr ", fileIdArr.length);
  const bot = new Bot(process.env.BOT_TOKEN!);

  const chatId = -1004295760674;
  const groupSize = 10;

  for (let i = 0; i < fileIdArr.length; i += groupSize) {
    const batch = fileIdArr.slice(i, i + groupSize);

    // Telegram requires at least 2 items in a media group.
    if (batch.length === 1) {
      await bot.api.sendAudio(chatId, batch[0]?.fileId!);
      continue;
    }

    try {
      await bot.api.sendMediaGroup(
        chatId,
        batch.map((fileId) => ({
          type: "audio" as const,
          media: fileId.fileId,
        }))
      );

      const batchSongIds = new Set(batch.map(({ songId }) => songId));

      let updated = false;

      for (const song of songIdArr) {
        if (batchSongIds.has(song.id) && !song.posted) {
          song.posted = true;
          updated = true;
        }
      }

      if (updated) {
        await updateFavs(songIdArr);
      }
    } catch (error) {
      console.log("Error in Uploading to Telegram: ", (error as Error).message);
    }

    console.log(`Sent audio group ${Math.floor(i / groupSize) + 1}`);
  }
} catch (error) {
  console.log(error);
}
