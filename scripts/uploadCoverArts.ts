import { Bot, GrammyError, InputFile } from "grammy";
import "dotenv/config";
import path from "path";
import artists from "../data/artists.json";
import { readFile, writeFile } from "fs/promises";
import type { Artist } from "../types/types";

const bot = new Bot(process.env.BOT_TOKEN!);

const STORAGE_CHAT_ID = Number(process.env.STORAGE_CHAT_ID);

const ROOT = path.resolve("H:\\Temp\\Lori2\\public\\assets\\profile");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendCoverArtWithRetry(
  chatId: number,
  filePath: string,
  maxRetries = 5
) {
  let attempt = 0;

  while (true) {
    try {
      return await bot.api.sendPhoto(chatId, new InputFile(filePath));
    } catch (e) {
      const isFlood =
        e instanceof GrammyError &&
        e.error_code === 429 &&
        e.parameters?.retry_after != null;

      if (!isFlood || attempt >= maxRetries) {
        throw e; // real error (e.g. AUDIO_TITLE_EMPTY-adjacent, invalid file, etc.) — bubble up
      }

      const waitSec = e.parameters!.retry_after! + 2;
      console.log(
        `429 rate limited, waiting ${waitSec}s (attempt ${attempt + 1})`
      );
      await sleep(waitSec * 1000);
      attempt++;
      // loop retries the same fileId
    }
  }
}

const updateArtist = async (
  id: string,
  fileId: string,
  fileUniqueId: string
) => {
  try {
    const raw = await readFile("./data/artists.json", "utf-8");
    const artists = JSON.parse(raw) as Artist[];
    const artist = artists.find((artist) => artist.id === id);
    if (!artist) {
      console.error(`Error! Artist not found! id: `, id);
      return;
    }
    const indx = artists.findIndex((artist) => artist.id === id);
    if (indx % 50 === 0) {
      console.log(`Current Index: `, indx);
    }
    artist.telegram = {
      fileId,
      fileUniqueId,
    };

    await writeFile("./data/artists.json", JSON.stringify(artists, null, 2));
  } catch (error) {
    console.error(
      `Error! CatchBlock! id: `,
      id,
      "ERR: ",
      (error as Error).message
    );
  }
};

for (const artist of artists) {
  if (artist.telegram) {
    continue;
  }
  const sendPhoto = await sendCoverArtWithRetry(
    STORAGE_CHAT_ID,
    path.join(ROOT, path.basename(artist?.image || ""))
  );

  const photo = sendPhoto.photo.at(-1)!;

  const fileId = photo.file_id;
  const fileUniqueId = photo.file_unique_id;
  await updateArtist(artist.id, fileId, fileUniqueId);
  await sleep(1000);
}
