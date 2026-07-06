import { db } from "../src/db";
import songs from "../data/songsId.json";
import artists from "../data/artists.json";

// Create a lookup map for quick access by artist ID
const artistMap = new Map(artists.map((artist) => [artist.id, artist]));

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
      continue;
    }

    // Transform the artists array to include name and nameEn
    const artistsWithNames = song.artists.map(
      (artist: string | { id: string }) => {
        // Handle both cases: artist might be a string ID or an object with an id
        const artistId = typeof artist === "string" ? artist : artist.id;
        const artistData = artistMap.get(artistId);
        if (!artistData) {
          console.warn(`Artist not found for ID: ${artistId}`);
          return {
            id: artistId,
            name: null,
            nameEn: null,
            fileId: null,
            fileUniqueId: null,
          };
        }
        return {
          id: artistData.id,
          name: artistData.name,
          nameEn: artistData.nameEn,
          fileId: artistData.telegram?.fileId || null,
          fileUniqueId: artistData.telegram?.fileUniqueId || null,
        };
      }
    );

    update.run(JSON.stringify(artistsWithNames), song.id);
  }
});

console.log("Updating artist IDs with names...");

transaction(songs);

const count = db.query("SELECT COUNT(*) AS count FROM songs").get() as {
  count: number;
};

console.log(`✅ Updated ${count.count} songs.`);
