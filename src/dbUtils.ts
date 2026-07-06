import { db } from "./db";
import type { Song, TelegramFile, TelegramSongWithFiles } from "../types/types";
import type { User } from "grammy/types";

export function ensureUser(user: User): boolean {
  const now = Date.now();

  const existing = db
    .query(
      `
        SELECT updated_at
        FROM users
        WHERE telegram_id = ?
    `
    )
    .get(user.id) as { updated_at: number } | undefined;

  if (!existing) {
    db.query(
      `
            INSERT INTO users (
                telegram_id,
                username,
                first_name,
                last_name,
                language_code,
                is_premium,
                is_bot,
                started_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).run(
      user.id,
      user.username ?? null,
      user.first_name,
      user.last_name ?? null,
      user.language_code ?? null,
      user.is_premium ? 1 : 0,
      user.is_bot ? 1 : 0,
      now,
      now
    );

    return true;
  }

  const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;

  if (now - existing.updated_at < FIFTEEN_DAYS) {
    return false;
  }

  db.query(
    `
        UPDATE users
        SET
            username = ?,
            first_name = ?,
            last_name = ?,
            language_code = ?,
            is_premium = ?,
            is_bot = ?,
            updated_at = ?
        WHERE telegram_id = ?
    `
  ).run(
    user.username ?? null,
    user.first_name,
    user.last_name ?? null,
    user.language_code ?? null,
    user.is_premium ? 1 : 0,
    user.is_bot ? 1 : 0,
    now,
    user.id
  );

  return false;
}

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

export function logger(): TelegramFile[] | null {
  return db
    .query(
      `
SELECT *
FROM telegram_files
WHERE songId = 'cmnizfvcz02tnuigphwl1ndyw'
  AND type = 'photo';
`
    )
    .all() as TelegramFile[] | null;
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

export function deleteTelegramFile(
  songId: string,
  type: string,
  quality: string | null
) {
  return db
    .prepare(
      `
      DELETE FROM telegram_files
      WHERE songId = ?
        AND type = ?
        AND quality IS ?;
    `
    )
    .run(songId, type, quality);
}

export function getRandomSong(): TelegramSongWithFiles | null {
  const song = db
    .query(
      `
SELECT *
FROM songs
ORDER BY RANDOM()
LIMIT 1;
`
    )
    .get() as Song | null;

  if (!song) return null;

  return {
    ...song,
    telegram: {
      coverArt: getTelegramFile(song.id, "photo", ""),
      ogg: getTelegramFile(song.id, "voice", ""),
      "64": getTelegramFile(song.id, "audio", "64"),
      "128": getTelegramFile(song.id, "audio", "128"),
      "320": getTelegramFile(song.id, "audio", "320"),
    },
  };
}

export function getStats() {
  const songs = db.query("SELECT COUNT(*) AS count FROM songs").get() as {
    count: number;
  };

  const artists = db
    .query("SELECT COUNT(DISTINCT artistEn) AS count FROM songs")
    .get() as { count: number };

  return {
    songs: songs.count,
    artists: artists.count,
  };
}

export function getSongById(songId: string): TelegramSongWithFiles | null {
  const song = db
    .query(
      `
SELECT *
FROM songs
WHERE id = ?
LIMIT 1
`
    )
    .get(songId) as TelegramSongWithFiles | null;
  if (!song) return null;
  return {
    ...song,
    telegram: {
      coverArt: getTelegramFile(song.id, "photo", ""),
      ogg: getTelegramFile(song.id, "voice", ""),
      "64": getTelegramFile(song.id, "audio", "64"),
      "128": getTelegramFile(song.id, "audio", "128"),
      "320": getTelegramFile(song.id, "audio", "320"),
    },
  };
}

export function getSongsByArtistId(artistId: string): Song[] {
  const stmt = db.query(`
        SELECT *
        FROM songs
        WHERE artists LIKE ?
        ORDER BY title
    `);

  return stmt.all(`%"id":"${artistId}"%`) as Song[];
}

export function getRandomSongByArtistId(
  artistId: string
): TelegramSongWithFiles | null {
  const song = db
    .query(
      `
SELECT *
FROM songs
WHERE artists LIKE ?
ORDER BY RANDOM()
LIMIT 1;
`
    )
    .get(`%"id":"${artistId}"%`) as Song | null;

  if (!song) return null;

  return {
    ...song,
    telegram: {
      coverArt: getTelegramFile(song.id, "photo", ""),
      ogg: getTelegramFile(song.id, "voice", ""),
      "64": getTelegramFile(song.id, "audio", "64"),
      "128": getTelegramFile(song.id, "audio", "128"),
      "320": getTelegramFile(song.id, "audio", "320"),
    },
  };
}

export function incrementSongDownloads(id: string) {
  db.prepare(
    `
    UPDATE songs
    SET downloads = downloads + 1
    WHERE id = ?
  `
  ).run(id);
}

export function incrementViewCount(id: string) {
  db.prepare(
    `
    UPDATE songs
    SET playCount = playCount + 1
    WHERE id = ?
  `
  ).run(id);
}

export function addFavorite(userId: number, songId: string) {
  console.log("userId, ", userId);
  db.prepare(
    `
    INSERT OR IGNORE INTO user_favorites
    (user_id, song_id, created_at)
    VALUES (?, ?, ?)
  `
  ).run(userId, songId, Date.now());
}

export function removeFavorite(userId: number, songId: string) {
  db.prepare(
    `
    DELETE FROM user_favorites
    WHERE user_id = ? AND song_id = ?
  `
  ).run(userId, songId);
}

export function isFavorite(userId: number, songId: string): boolean {
  const row = db
    .prepare(
      `
    SELECT 1
    FROM user_favorites
    WHERE user_id = ? AND song_id = ?
    LIMIT 1
  `
    )
    .get(userId, songId);

  return !!row;
}

export function getFavoriteSongs(userId: number): TelegramSongWithFiles[] {
  const songs = db
    .prepare(
      `
    SELECT s.*
    FROM songs s
    INNER JOIN user_favorites f
      ON s.id = f.song_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `
    )
    .all(userId) as Song[];

  return songs.map((song) => ({
    ...song,
    telegram: {
      coverArt: getTelegramFile(song.id, "photo", ""),
      ogg: getTelegramFile(song.id, "voice", ""),
      "64": getTelegramFile(song.id, "audio", "64"),
      "128": getTelegramFile(song.id, "audio", "128"),
      "320": getTelegramFile(song.id, "audio", "320"),
    },
  }));
}
