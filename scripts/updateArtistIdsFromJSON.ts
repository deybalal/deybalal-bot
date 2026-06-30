import { db } from "../src/db";
import songs from "../data/songsId.json";

type Song = (typeof songs)[number];

const update = db.prepare(`
UPDATE songs
SET artists = ?
WHERE id = ?
`);

const transaction = db.transaction((items: Song[]) => {
  for (const song of items) {
    if (!song.uri) {
      console.log(`Skipping song ${song.id} - no URI, `, song);
    }
    update.run(JSON.stringify(song.artists || []), song.id);
  }
});

console.log("Updating artist IDs...");

transaction(songs);

const count = db.query("SELECT COUNT(*) AS count FROM songs").get() as {
  count: number;
};

console.log(`✅ Updated ${count.count} songs.`);
