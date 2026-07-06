import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DB_DIR = path.resolve("./data");
const DB_PATH = path.join(DB_DIR, "music.db");

fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH, {
  create: true,
  strict: true,
});

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -8000;
PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,

    slug TEXT NOT NULL,

    title TEXT NOT NULL,
    titleEn TEXT,

    artist TEXT NOT NULL,
    artistEn TEXT,
    artists TEXT NOT NULL,

    albumName TEXT,

    coverArt TEXT NOT NULL,

    year INTEGER NOT NULL,

    duration INTEGER NOT NULL,

    uri TEXT NOT NULL,
    filename TEXT NOT NULL,

    songIndex INTEGER NOT NULL,

    lyrics TEXT,
    syncedLyrics TEXT,

    playCount INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,

    isDisabled INTEGER NOT NULL DEFAULT 0,
    disabledDescription TEXT,

    isActive INTEGER NOT NULL DEFAULT 1,
    isFeatured INTEGER NOT NULL DEFAULT 0,

    albumId TEXT,
    userId TEXT,

    lyricsSource TEXT,
    lyricsSourceUrl TEXT,

    ogg TEXT NOT NULL,

    tempFilename TEXT,

    link64 TEXT,
    bytes64 INTEGER,

    link128 TEXT,
    bytes128 INTEGER,

    link320 TEXT,
    bytes320 INTEGER,

    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
    updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_artistEn ON songs(artistEn);
CREATE INDEX IF NOT EXISTS idx_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_titleEn ON songs(titleEn);
CREATE INDEX IF NOT EXISTS idx_slug ON songs(slug);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY(user_id)
  REFERENCES users(telegram_id)
  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_files (

    songId TEXT NOT NULL,
    type TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT '',

    fileId TEXT,
    fileUniqueId TEXT,

    uploadedAt INTEGER,

    PRIMARY KEY(songId, type, quality),

    FOREIGN KEY(songId)
        REFERENCES songs(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tg_song
ON telegram_files(songId);

CREATE INDEX IF NOT EXISTS idx_tg_type
ON telegram_files(type);
`);

db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    telegram_id INTEGER NOT NULL UNIQUE,
    username TEXT,

    first_name TEXT NOT NULL,
    last_name TEXT,

    language_code TEXT,
    is_premium INTEGER DEFAULT 0,
    is_bot INTEGER DEFAULT 0,

    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);`);
