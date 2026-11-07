import { Bot, GrammyError, InputFile } from "grammy";
import "dotenv/config";
import path from "path";
import prisma from "../src/db.ts";

const bot = new Bot(process.env.BOT_TOKEN!);

const STORAGE_CHAT_ID = Number(process.env.STORAGE_CHAT_ID);

const PROFILE_ROOT = path.resolve("H:\\Temp\\Lori2\\public\\assets\\profile");
const COVER_ROOT = path.resolve("H:\\Temp\\Lori2\\public\\assets\\cover");

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
    const artist = await prisma.artist.findUnique({
      where: {
        id,
      },
    });
    if (!artist) {
      console.error(`Error! Artist not found! id: `, id);
      return;
    }

    await prisma.artist.update({
      where: {
        id,
      },
      data: {
        fileId,
        fileUniqueId,
      },
    });
  } catch (error) {
    console.error(
      `Error! CatchBlock! id: `,
      id,
      "ERR: ",
      (error as Error).message
    );
  }
};
const updateSong = async (id: string, fileId: string, fileUniqueId: string) => {
  try {
    const song = await prisma.song.findUnique({
      where: {
        id,
      },
    });
    if (!song) {
      console.error(`Error! Song not found! id: `, id);
      return;
    }

    if (!fileId || !fileUniqueId) {
      console.log(" No FileId or UniqueFileID!", fileId, fileUniqueId);
      return;
    }

    await prisma.song.update({
      where: {
        id,
      },
      data: {
        telegram: {
          upsert: {
            create: {
              cover_art_file_id: fileId,
              cover_art_file_unique_id: fileUniqueId,
            },
            update: {
              cover_art_file_id: fileId,
              cover_art_file_unique_id: fileUniqueId,
            },
          },
        },
      },
    });
  } catch (error) {
    console.error(
      `Error! CatchBlock! id: `,
      id,
      "ERR: ",
      (error as Error).message
    );
  }
};

const artists = await prisma.artist.findMany({
  where: {
    OR: [
      {
        fileId: null,
      },
      {
        fileUniqueId: null,
      },
    ],
  },
});

console.log("artists length: ", artists.length);

for (const artist of artists) {
  const profilePath = path.join(
    PROFILE_ROOT,
    path.basename(artist?.image || "")
  );
  const sendPhoto = await sendCoverArtWithRetry(STORAGE_CHAT_ID, profilePath);
  const photo = sendPhoto.photo.at(-1)!;
  const fileId = photo.file_id;
  const fileUniqueId = photo.file_unique_id;
  await updateArtist(artist.id, fileId, fileUniqueId);
  await sleep(500);
}

const songs = await prisma.song.findMany({
  where: {
    OR: [
      {
        telegram: null,
      },
      {
        telegram: { cover_art_file_id: null },
      },
      {
        telegram: { cover_art_file_unique_id: null },
      },
    ],
  },
});

console.log("songs length: ", songs.length);
let indx = 1;
for (const song of songs) {
  const coverPath = path.join(COVER_ROOT, path.basename(song?.coverArt || ""));
  const sendPhoto = await sendCoverArtWithRetry(STORAGE_CHAT_ID, coverPath);
  const photo = sendPhoto.photo.at(-1)!;
  const fileId = photo.file_id;
  const fileUniqueId = photo.file_unique_id;
  await updateSong(song.id, fileId, fileUniqueId);
  console.log(`${indx}/${songs.length} - ${songs.length - indx} remained`);
  indx++;
  await sleep(500);
}
