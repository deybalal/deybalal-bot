import { Bot, InputFile } from "grammy";
import badfiles from "../data/badFiles1.json";
import { deleteTelegramFile, getSongs, saveTelegramFile } from "../src/dbUtils";
import { db } from "../src/db";
import path from "path";
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";

const bot = new Bot(process.env.BOT_TOKEN!);

const STORAGE_CHAT_ID = Number(process.env.STORAGE_CHAT_ID);

const ROOT = path.resolve("H:\\Temp\\Lori2\\public");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const updateArtist = async (id: string) => {
  try {
    const raw = await readFile(
      path.join(__dirname, "..", "data", "badFiles1.json"),
      "utf-8"
    );
    const badFiles = JSON.parse(raw);
    const file = badFiles.find(
      (file: { songId: string }) => file.songId === id
    );
    if (!file) {
      console.error(`Error! bad File not found! id: `, id);
      return;
    }

    file.isDone = true;

    await writeFile(
      path.join(__dirname, "..", "data", "badFiles1.json"),
      JSON.stringify(badFiles, null, 2)
    );
  } catch (error) {
    console.error(
      `Error! CatchBlock! id: `,
      id,
      "ERR: ",
      (error as Error).message
    );
  }
};

const saveTx = db.transaction(
  (
    songId: string,
    type: string,
    quality: string | null,
    fileId: string,
    uniqueId: string
  ) => {
    saveTelegramFile(songId, type, quality, fileId, uniqueId);
  }
);

const filterDone = badfiles.filter((file) => !file.isDone);

// Create a Set of seen songIds and filter the array
const uniqueSongs = filterDone.filter(
  (song, index, self) =>
    index === self.findIndex((s) => s.songId === song.songId)
);

console.log(uniqueSongs[0]);
console.log("UUUn len ", uniqueSongs.length);

const songs = getSongs();

// console.log(songs[0]);

const errored = [];

let indx = 0;
for (const file of uniqueSongs) {
  const song = songs.find((s) => s.id === file.songId);

  indx++;

  if (!song) {
    console.log("Files not found! ID: ", file.songId);
    errored.push(file);
    continue;
  }

  console.log(
    `\n${indx}. ${song.artistEn} - ${song.titleEn}, sId: ${file.songId}`
  );

  if (indx % 20 === 0) {
    console.log(
      "Done: ",
      indx,
      "Out of: ",
      uniqueSongs.length,
      "SongId: ",
      file.songId,
      "Quality: ",
      file.quality
    );
  }

  const selectedQualityPath =
    file.quality == "320"
      ? song.link320!
      : file.quality == "128"
      ? song.link128!
      : song.link64!;

  const selectedQuality: "320" | "128" | "64" =
    file.quality == "320" ? "320" : file.quality == "128" ? "128" : "64";

  if (song) {
    try {
      const msg = await bot.api.sendAudio(
        STORAGE_CHAT_ID,
        new InputFile(path.join(ROOT, selectedQualityPath)),
        {
          title: song.title,
          performer: song.artist,
          duration: song.duration,
        }
      );

      deleteTelegramFile(song.id, "audio", selectedQuality);
      saveTx(
        song.id,
        "audio",
        selectedQuality,
        msg.audio.file_id,
        msg.audio.file_unique_id
      );

      console.log(`   ✓ ${selectedQuality}`);

      await updateArtist(file.songId);

      await sleep(2000);
    } catch (error) {
      console.log("Error! ", (error as Error).message);
      errored.push(file);
    }
  }
}

console.log("Errored: ", errored.length);
await writeFile("./erroredUndone.json", JSON.stringify(errored, null, 2));
