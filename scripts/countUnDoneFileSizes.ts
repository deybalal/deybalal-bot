import badfiles from "../data/badFiles1.json";
import { getSongs } from "../src/dbUtils";
import { formatBytes } from "../tools/formatBytes";

console.log(badfiles.length);

// Create a Set of seen songIds and filter the array
let uniqueSongs = badfiles.filter(
  (song, index, self) =>
    index === self.findIndex((s) => s.songId === song.songId)
);

uniqueSongs = uniqueSongs.filter((file) => !file.isDone);

console.log("UUUn len ", uniqueSongs.length);

let fileSizeInBytes = 0;

const songs = getSongs();

// console.log(songs[0]);

for (const file of uniqueSongs) {
  const song = songs.find((s) => s.id === file.songId);
  const selectedQuality =
    file.quality == "320"
      ? song?.bytes320
      : file.quality == "128"
      ? song?.bytes128
      : song?.bytes64;
  if (song) {
    fileSizeInBytes += selectedQuality || 0;
  }
}

console.log(fileSizeInBytes);
console.log(formatBytes(fileSizeInBytes));
