import { db } from "../src/db";
import songs from "../data/songs-source-of-truth.json";
import type { ExportedSong } from "../types/types";

const insertIntoTelegramFiles = db.prepare(`
INSERT INTO telegram_files (
    songId,
    type,
    quality,
    fileId,
    fileUniqueId,
    uploadedAt
)
VALUES (?, ?, ?, ?, ?, unixepoch())

ON CONFLICT(songId, type, quality)
DO UPDATE SET

fileId = excluded.fileId,
fileUniqueId = excluded.fileUniqueId,
uploadedAt = excluded.uploadedAt;
`);

const insert = db.prepare(`
INSERT OR REPLACE INTO songs (
    id,
    slug,
    title,
    titleEn,
    artist,
    artistEn,
    artists,
    albumName,
    coverArt,
    year,
    duration,
    uri,
    filename,
    songIndex,
    lyrics,
    syncedLyrics,
    playCount,
    downloads,
    isDisabled,
    disabledDescription,
    isActive,
    isFeatured,
    albumId,
    userId,
    lyricsSource,
    lyricsSourceUrl,
    ogg,
    tempFilename,
    link64,
    bytes64,
    link128,
    bytes128,
    link320,
    bytes320,
    updatedAt
)
VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()
);
`);

const transaction = db.transaction((items: ExportedSong[]) => {
  for (const song of items) {
    if (!song.uri) {
      console.log(`Skipping song ${song.id} - no URI, `, song);
    }
    insert.run(
      song.id,
      song.slug,

      song.title,
      song.titleEn,

      song.artist,
      song.artistEn,
      JSON.stringify(song.artists || []),

      song.albumName,

      song.coverArt,

      song.year,

      song.duration,

      song.uri,
      song.filename,

      song.index,

      song.lyrics,
      song.syncedLyrics,

      song.playCount,
      song.downloads ?? 0,

      Number(song.isDisabled),
      song.disabledDescription,

      Number(song.isActive),
      Number(song.isFeatured),

      song.albumId,
      song.userId,

      song.lyricsSource,
      song.lyricsSourceUrl,

      song.ogg,

      song.tempFilename,

      song.links!["64"]?.url ?? null,
      song.links!["64"]?.bytes ?? null,

      song.links!["128"]?.url ?? null,
      song.links!["128"]?.bytes ?? null,

      song.links!["320"]?.url ?? null,
      song.links!["320"]?.bytes ?? null
    );

    if (song?.telegram && song?.telegram["320"]) {
      insertIntoTelegramFiles.run(
        song.id,
        "audio",
        "320",
        song.telegram["320"].file_id,
        song.telegram["320"].file_unique_id
      );
    }

    insertIntoTelegramFiles.run(
      song.id,
      "audio",
      "128",
      song.telegram!["128"].file_id,
      song.telegram!["128"].file_unique_id
    );

    insertIntoTelegramFiles.run(
      song.id,
      "audio",
      "64",
      song.telegram!["64"].file_id,
      song.telegram!["64"].file_unique_id
    );

    insertIntoTelegramFiles.run(
      song.id,
      "photo",
      "",
      song.telegram!["coverArt"].file_id,
      song.telegram!["coverArt"].file_unique_id
    );
    insertIntoTelegramFiles.run(
      song.id,
      "voice",
      "",
      song.telegram!["ogg"].file_id,
      song.telegram!["ogg"].file_unique_id
    );
  }
});

console.log("Importing songs...");

transaction(songs as ExportedSong[]);

const count = db.query("SELECT COUNT(*) AS count FROM songs").get() as {
  count: number;
};

console.log(`✅ Imported ${count.count} songs.`);
