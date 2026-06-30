import "dotenv/config";
import { db } from "../src/db";
import { saveTelegramFile } from "../src/dbUtils";

const saveTx = db.transaction(
  (
    songId: string,
    type: string,
    quality: string | null,
    fileId: string,
    uniqueId: string
  ) => {
    saveTelegramFile(songId, type, quality, fileId, uniqueId);
  }
);

saveTx(
  "cmpkvfuq800314ggpuara2tdu",
  "audio",
  "320",
  "CQACAgQAAyEFAAMBArgkbAACIUdqQ5jxjZkW3bidKkssOYUqiugUjgACYCIAAry2IVI4e6Xp1L-_9TwE",
  "AgADYCIAAry2IVI"
);

console.log("\nDone.");
