import { addArtist } from "../src/dbUtils";
import { readFileSync } from "fs";
import { join } from "path";

const artists = JSON.parse(
  readFileSync(join(process.cwd(), "data", "artists.json"), "utf8")
);

console.log(`Importing ${artists.length} artists...`);

for (const artist of artists) {
  addArtist({
    id: artist.id,
    name: artist.name,
    nameEn: artist.nameEn,
    image: artist.image,
    isVerified: artist.isVerified,
    ig: artist.ig,
    description: artist.description,
    followers: Number(artist.followers) || 0,
    telegram: artist.telegram,
  });
}

console.log(`✅ Imported ${artists.length} artists.`);
