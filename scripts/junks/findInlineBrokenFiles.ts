import { GrammyError } from "grammy";
import bot from "../../src";
import { getTelegramFile } from "../../src/dbUtils";
import type { Song } from "../../types/types";
import { readFile, writeFile } from "fs/promises";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendAudioWithRetry(
  chatId: number,
  fileId: string,
  maxRetries = 5
) {
  let attempt = 0;

  while (true) {
    try {
      return await bot.api.sendAudio(chatId, fileId);
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

export async function findInlineBrokenFiles(allSongs: Song[]) {
  interface BadFile {
    songId: string;
    quality: string;
    fileId: string;
    singer?: string | null;
    dbTitle: string;
    embeddedTitle: string | undefined;
    embeddedPerformer: string | undefined;
  }

  const badFiles: BadFile[] = JSON.parse(
    await readFile("./badFiles.json", "utf-8")
  );

  console.log("allSongs ", allSongs.length);

  let reportedIndx = 0;

  for (const song of allSongs) {
    const qualities = [
      { q: "320", file: getTelegramFile(song.id, "audio", "320") },
      { q: "128", file: getTelegramFile(song.id, "audio", "128") },
      { q: "64", file: getTelegramFile(song.id, "audio", "64") },
    ];

    for (const { q, file } of qualities) {
      if (!file?.fileId) continue;

      if (reportedIndx % 10 === 0) {
        console.log("Reported", reportedIndx, "of", allSongs.length * 3);
      }
      reportedIndx++;

      try {
        // NOTE: no title/performer override here on purpose
        const msg = await sendAudioWithRetry(-1003936127617, file.fileId);
        const embeddedTitle = msg.audio?.title;
        const embeddedPerformer = msg.audio?.performer;

        await bot.api.deleteMessage(-1003936127617, msg.message_id);

        if (!embeddedTitle) {
          console.log("BROKEN FOR INLINE:", song.id, q);
          badFiles.push({
            songId: song.id,
            quality: q,
            fileId: file.fileId,
            dbTitle: song.title,
            singer: song.artistEn,
            embeddedTitle,
            embeddedPerformer,
          });
          await writeFile("./badFiles.json", JSON.stringify(badFiles, null, 2));
        } else {
          // console.log("OK:", song.id, q, "-", embeddedTitle);
        }
      } catch (e) {
        console.log("ERROR sending:", song.id, q, (e as Error).message);
      }

      await new Promise((r) => setTimeout(r, 1200)); // stay under Telegram's per-chat rate limit
    }
  }

  await writeFile("./badFiles.json", JSON.stringify(badFiles, null, 2));
  console.log(`Done. ${badFiles.length} files missing embedded title.`);
}
