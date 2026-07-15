import fs from "fs/promises";
import path from "path";
import { db } from "../src/db";
import type { Song } from "../types/types";

type TelegramEntry = {
  file_id: string;
  file_unique_id: string;
};

function getTimestamp() {
  const d = new Date();

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export async function exportSongsToJson(): Promise<string> {
  const songs = db
    .query(`SELECT * FROM songs ORDER BY songIndex ASC`)
    .all() as Song[];

  const tgFiles = db.query(`SELECT * FROM telegram_files`).all() as any[];

  const telegramMap = new Map<string, Map<string, TelegramEntry>>();

  for (const file of tgFiles) {
    if (!telegramMap.has(file.songId)) {
      telegramMap.set(file.songId, new Map());
    }

    const key = file.type === "audio" ? file.quality : file.type;

    telegramMap.get(file.songId)!.set(key, {
      file_id: file.fileId,
      file_unique_id: file.fileUniqueId,
    });
  }

  const output = songs.map((song, i) => {
    const tg = telegramMap.get(song.id);

    return {
      id: song.id,
      slug: song.slug,

      title: song.title,
      titleEn: song.titleEn,

      artist: song.artist,
      artistEn: song.artistEn,
      artists: song.artists
        ? JSON.parse(song.artists as unknown as string)
        : [],

      albumName: song.albumName,

      coverArt: song.coverArt,

      year: song.year,

      duration: song.duration,

      uri: song.uri,
      filename: song.filename,

      index: song.songIndex,

      lyrics: song.lyrics,
      syncedLyrics: song.syncedLyrics,

      playCount: song.playCount,
      downloads: song.downloads,

      isDisabled: Boolean(song.isDisabled),
      disabledDescription: song.disabledDescription,

      isActive: Boolean(song.isActive),
      isFeatured: Boolean(song.isFeatured),

      albumId: song.albumId,
      userId: song.userId,

      lyricsSource: song.lyricsSource,
      lyricsSourceUrl: song.lyricsSourceUrl,

      links: {
        "64": song.link64
          ? {
              url: song.link64,
              bytes: song.bytes64,
            }
          : null,

        "128": song.link128
          ? {
              url: song.link128,
              bytes: song.bytes128,
            }
          : null,

        "320": song.link320
          ? {
              url: song.link320,
              bytes: song.bytes320,
            }
          : null,
      },

      ogg: song.ogg,

      tempFilename: song.tempFilename,

      telegram: {
        coverArt: tg?.get("photo") ?? null,
        "64": tg?.get("64") ?? null,
        "128": tg?.get("128") ?? null,
        "320": tg?.get("320") ?? null,
        ogg: tg?.get("voice") ?? null,
      },

      post: {
        has_posted: song.has_posted === 1 ? true : false,
        message_id: song.message_id,
        ogg_message_id: song.ogg_message_id,
      },
    };
  });

  const filename = `songs-export-${getTimestamp()}.json`;
  const filePath = path.resolve("./data", filename);

  await fs.writeFile(filePath, JSON.stringify(output, null, 2), "utf8");

  return filePath;
}

// Run the export
const savedPath = await exportSongsToJson();

console.log(savedPath);
