import { db } from "./db";
import type { Song, TelegramFile } from "../types/types";

export function getSongs(): Song[] {
  return db
    .query(
      `
SELECT *
FROM songs
ORDER BY songIndex ASC;
`
    )
    .all() as Song[];
}

export function getTelegramFile(
  songId: string,
  type: string,
  quality: string | null
): TelegramFile | null {
  return db
    .prepare(
      `
SELECT *
FROM telegram_files
WHERE songId = ?
AND type = ?
AND quality IS ?
LIMIT 1;
  `
    )
    .get(songId, type, quality) as TelegramFile | null;
}

export function saveTelegramFile(
  songId: string,
  type: string,
  quality: string | null,
  fileId: string,
  fileUniqueId: string
) {
  return db
    .prepare(
      `
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
`
    )
    .run(songId, type, quality, fileId, fileUniqueId);
}
