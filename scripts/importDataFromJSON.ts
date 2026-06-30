import { db } from "../src/db";
import songs from "../data/songs.json";

type Song = (typeof songs)[number];

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
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()
);
`);

const transaction = db.transaction((items: Song[]) => {
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

      song.links["64"]?.url ?? null,
      song.links["64"]?.bytes ?? null,

      song.links["128"]?.url ?? null,
      song.links["128"]?.bytes ?? null,

      song.links["320"]?.url ?? null,
      song.links["320"]?.bytes ?? null
    );
  }
});

console.log("Importing songs...");

transaction(songs);

const count = db.query("SELECT COUNT(*) AS count FROM songs").get() as {
  count: number;
};

console.log(`✅ Imported ${count.count} songs.`);
