import { db } from "./db";

export const getSongs = db.query(`
SELECT *
FROM songs
ORDER BY songIndex ASC;
`);

export const getTelegramFile = db.prepare(`
SELECT *
FROM telegram_files
WHERE songId = ?
AND type = ?
AND quality IS ?
LIMIT 1;
`);

export const saveTelegramFile = db.prepare(`
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
