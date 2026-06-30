import { Bot, InputFile } from "grammy";
import "dotenv/config";

import path from "path";

import { db } from "../src/db";
import { getSongs, getTelegramFile, saveTelegramFile } from "../src/dbUtils";

const bot = new Bot(process.env.BOT_TOKEN!);

const STORAGE_CHAT_ID = Number(process.env.STORAGE_CHAT_ID);

const ROOT = path.resolve("H:\\Temp\\Lori2\\public");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const saveTx = db.transaction(
  (
    songId: string,
    type: string,
    quality: string | null,
    fileId: string,
    uniqueId: string
  ) => {
    saveTelegramFile.run(songId, type, quality, fileId, uniqueId);
  }
);

function exists(songId: string, type: string, quality: string | null) {
  return !!getTelegramFile.get(songId, type, quality);
}

const songs = getSongs.all() as any[];

console.log(`Found ${songs.length} songs`);

for (const song of songs) {
  console.log(`\n${song.songIndex + 1}. ${song.artistEn} - ${song.titleEn}`);

  //
  // Cover
  //

  if (!exists(song.id, "photo", null)) {
    const msg = await bot.api.sendPhoto(
      STORAGE_CHAT_ID,
      new InputFile(path.join(ROOT, song.coverArt))
    );

    const photo = msg.photo.at(-1)!;

    saveTx(song.id, "photo", null, photo.file_id, photo.file_unique_id);

    console.log("   ✓ Cover");

    await sleep(1250);
  }

  //
  // Voice
  //

  if (!exists(song.id, "voice", null)) {
    const msg = await bot.api.sendVoice(
      STORAGE_CHAT_ID,
      new InputFile(path.join(ROOT, song.ogg))
    );

    saveTx(song.id, "voice", null, msg.voice.file_id, msg.voice.file_unique_id);

    console.log("   ✓ Voice");

    await sleep(1250);
  }

  //
  // 64 kbps
  //

  if (!exists(song.id, "audio", "64")) {
    const msg = await bot.api.sendAudio(
      STORAGE_CHAT_ID,
      new InputFile(path.join(ROOT, song.link64))
    );

    saveTx(song.id, "audio", "64", msg.audio.file_id, msg.audio.file_unique_id);

    console.log("   ✓ 64");

    await sleep(1250);
  }

  //
  // 128 kbps
  //

  if (!exists(song.id, "audio", "128")) {
    const msg = await bot.api.sendAudio(
      STORAGE_CHAT_ID,
      new InputFile(path.join(ROOT, song.link128))
    );

    saveTx(
      song.id,
      "audio",
      "128",
      msg.audio.file_id,
      msg.audio.file_unique_id
    );

    console.log("   ✓ 128");

    await sleep(1250);
  }

  //
  // 320 kbps
  //

  if (!exists(song.id, "audio", "320")) {
    const msg = await bot.api.sendAudio(
      STORAGE_CHAT_ID,
      new InputFile(path.join(ROOT, song.link320))
    );

    saveTx(
      song.id,
      "audio",
      "320",
      msg.audio.file_id,
      msg.audio.file_unique_id
    );

    console.log("   ✓ 320");

    await sleep(1250);
  }
}

console.log("\nDone.");
