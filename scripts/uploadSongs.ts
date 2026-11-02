import { Bot, InputFile } from "grammy";
import { getTelegramFile, saveTelegramFile } from "../src/dbUtils.ts";
import prisma from "../src/db.ts";
import type { Prisma, Song, Telegram } from "@prisma/client";
import path from "path";
import fs from "fs";
import { writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { ProxyAgent } from "undici";
dotenv.config();
import { HttpsProxyAgent } from "https-proxy-agent";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ Error: BOT_TOKEN is missing from environment variables.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN, {
  client: {
    baseFetchConfig: {
      agent: new HttpsProxyAgent("http://127.0.0.1:2080"),
      compress: true,
    },
  },
});
// ----------------------------------------------------
// Type Definitions (Strict Typing - No 'any')
// ----------------------------------------------------

export interface AudioQualityInfo {
  url?: string;
  size?: string;
  bytes?: number;
}

export interface SongLinks {
  "64"?: AudioQualityInfo;
  "128"?: AudioQualityInfo;
  "320"?: AudioQualityInfo;
  [key: string]: AudioQualityInfo | undefined;
}

export type SongWithTelegram = Song & {
  telegram: Telegram | null;
};

export type SongForScan = Pick<
  Song,
  | "id"
  | "slug"
  | "title"
  | "titleEn"
  | "artist"
  | "artistEn"
  | "duration"
  | "coverArt"
  | "ogg"
  | "uri"
  | "links"
>;

export interface OversizedFileReport {
  type: "photo" | "voice" | "audio";
  quality: string | null;
  url?: string | null;
  sizeBytes: number;
  sizeMB: string;
  source: "disk" | "metadata";
}

export interface OversizedSongReport {
  id: string;
  slug: string;
  title: string;
  titleEn: string | null;
  artist: string;
  duration: number;
  oversizedFiles: OversizedFileReport[];
}

export interface SongUploadError {
  id: string;
  slug: string;
  title: string;
  artist: string;
  errors: string[];
}

export interface TelegramApiError {
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
  retry_after?: number;
  code?: string;
  message?: string;
}

function isTelegramApiError(error: unknown): error is TelegramApiError {
  return typeof error === "object" && error !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseSongLinks(links: Prisma.JsonValue | null | undefined): SongLinks {
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    return {};
  }
  return links as unknown as SongLinks;
}

// ----------------------------------------------------
// Environment & Bot Initialization
// ----------------------------------------------------

const STORAGE_CHAT_ID = Number(process.env.STORAGE_CHAT_ID);
if (!STORAGE_CHAT_ID || isNaN(STORAGE_CHAT_ID)) {
  console.error(
    "❌ Error: STORAGE_CHAT_ID is missing or not a valid number in environment variables."
  );
  process.exit(1);
}

// Media root directory (defaults to H:\Temp\Lori2\public or can be configured via env)
const ROOT =
  process.env.PUBLIC_DIR ||
  process.env.ROOT_DIR ||
  path.resolve("H:\\Temp\\Lori2\\public");

// Telegram Bot API maximum upload limit: 50 MiB = 52,428,800 bytes
const MAX_TELEGRAM_FILE_SIZE = 50 * 1024 * 1024;

// Minimum interval between Telegram API calls to respect rate limits (1 msg/sec for single chat)
const MIN_REQUEST_INTERVAL_MS = 1000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves a relative URL/path from DB against the ROOT media directory safely
 */
function resolveLocalPath(relUrl?: string | null): string | null {
  if (!relUrl) return null;
  const clean = relUrl.replace(/^[\/\\]+/, "");
  return path.join(ROOT, clean);
}

/**
 * Determines file size in bytes using local disk stat with metadata fallback
 */
function getFileSize(
  relUrl?: string | null,
  metadataBytes?: number | null
): number {
  if (relUrl) {
    const fullPath = resolveLocalPath(relUrl);
    if (fullPath && fs.existsSync(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        return stat.size;
      } catch {
        // Fallback to metadata
      }
    }
  }
  if (typeof metadataBytes === "number" && metadataBytes > 0) {
    return metadataBytes;
  }
  return 0;
}

/**
 * Formats file size in bytes to MB and GB representation (e.g. "69000 MB(69GB)")
 */
function formatSizeMBAndGB(bytes: number): string {
  if (bytes <= 0) return "0 MB(0GB)";

  const totalMBVal = bytes / (1024 * 1024);
  const totalGBVal = bytes / (1024 * 1024 * 1024);

  const totalMB =
    totalMBVal > 0 && totalMBVal < 1
      ? Number(totalMBVal.toFixed(2)).toString()
      : Math.round(totalMBVal).toString();

  let totalGB: string;
  if (totalGBVal >= 0.01) {
    totalGB = Number(totalGBVal.toFixed(2)).toString();
  } else if (totalGBVal > 0) {
    totalGB = Number(totalGBVal.toFixed(3)).toString();
  } else {
    totalGB = "0";
  }

  return `${totalMB} MB(${totalGB}GB)`;
}

/**
 * Adaptive rate-limiter: Only sleeps if less than MIN_REQUEST_INTERVAL_MS has elapsed
 * since the last API call. Because multi-megabyte uploads take 0.5s - 2s over the wire,
 * this avoids idle waiting while preventing 429 Too Many Requests.
 */
let lastCallTimestamp = 0;
async function waitRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTimestamp;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastCallTimestamp = Date.now();
}

/**
 * Calls a Telegram API function with automatic 429 rate limit backoff and network retry
 */
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitRateLimit();
      return await fn();
    } catch (err: unknown) {
      if (isTelegramApiError(err)) {
        const retryAfter = err.parameters?.retry_after ?? err.retry_after;
        if (retryAfter || err.error_code === 429) {
          const waitMs = (retryAfter ? Number(retryAfter) : 2) * 1000 + 500;
          console.warn(
            `   ⏳ Telegram Rate Limit (429). Waiting ${
              waitMs / 1000
            }s before retry...`
          );
          await sleep(waitMs);
          lastCallTimestamp = Date.now();
          continue;
        }

        // Retry on transient socket/network errors
        if (
          attempt < maxRetries &&
          (err.code === "ETIMEDOUT" ||
            err.code === "ECONNRESET" ||
            err.code === "ECONNABORTED")
        ) {
          console.warn(
            `   ⏳ Network glitch (${err.code}). Retrying in 2s (attempt ${attempt}/${maxRetries})...`
          );
          await sleep(2000);
          continue;
        }
        if (err.error_code === 400) {
          // console.log("Yeah, it was Error 400");
          await sleep(1000);
          // continue;
        }
      }

      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error("Exceeded max retries");
}

/**
 * Checks whether a song file has already been uploaded (checks in-memory relation and dbUtils)
 */
async function exists(
  song: SongWithTelegram,
  type: "photo" | "voice" | "audio",
  quality: string | null
): Promise<boolean> {
  const tg = song.telegram;
  if (tg) {
    if (type === "photo" && tg.cover_art_file_id) return true;
    if (type === "voice" && tg.file_id_ogg) return true;
    if (type === "audio") {
      if (quality === "64" && tg.file_id_64) return true;
      if (quality === "128" && tg.file_id_128) return true;
      if (quality === "320" && tg.file_id_320) return true;
    }
  }

  // Check getTelegramFile from dbUtils if available
  if (typeof getTelegramFile === "function") {
    try {
      const res = await Promise.resolve(
        getTelegramFile(song.id, type, quality)
      );
      if (res && (res.file_id || res.fileId)) return true;
    } catch {
      // ignore lookup error
    }
  }

  return false;
}

/**
 * Persists uploaded file identifiers to both dbUtils and Prisma Telegram table
 */
async function saveTx(
  song: SongWithTelegram,
  type: "photo" | "voice" | "audio",
  quality: string | null,
  fileId: string,
  uniqueId: string
): Promise<void> {
  // 1. Call saveTelegramFile from dbUtils (supporting sync and async)
  if (typeof saveTelegramFile === "function") {
    try {
      await Promise.resolve(
        saveTelegramFile(song.id, type, quality, fileId, uniqueId)
      );
    } catch (err: unknown) {
      console.warn(
        `   [dbUtils] saveTelegramFile warning for song ${song.id}:`,
        getErrorMessage(err)
      );
    }
  }

  // 2. Map fields to Prisma Telegram schema and upsert
  const fields: Record<string, string> = {};
  if (type === "photo") {
    fields.cover_art_file_id = fileId;
    fields.cover_art_file_unique_id = uniqueId;
  } else if (type === "voice") {
    fields.file_id_ogg = fileId;
    fields.file_unique_id_ogg = uniqueId;
  } else if (type === "audio") {
    if (quality === "64") {
      fields.file_id_64 = fileId;
      fields.file_unique_id_64 = uniqueId;
    } else if (quality === "128") {
      fields.file_id_128 = fileId;
      fields.file_unique_id_128 = uniqueId;
    } else if (quality === "320") {
      fields.file_id_320 = fileId;
      fields.file_unique_id_320 = uniqueId;
    }
  }

  if (Object.keys(fields).length > 0) {
    try {
      const createData: Prisma.TelegramUncheckedCreateInput = {
        songId: song.id,
        ...fields,
      };
      const updateData: Prisma.TelegramUncheckedUpdateInput = {
        ...fields,
      };
      const updated = await prisma.telegram.upsert({
        where: { songId: song.id },
        create: createData,
        update: updateData,
      });
      // Keep in-memory song.telegram updated for subsequent checks
      song.telegram = updated;
    } catch (err: unknown) {
      console.error(
        `   [prisma] Error updating Telegram table for song ${song.id}:`,
        getErrorMessage(err)
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("==================================================");
  console.log("🔍 Phase 1: Pre-Scan - Checking Songs for Files > 50MB");
  console.log(`📁 Media root: ${ROOT}`);
  console.log("==================================================");

  // Retrieve all songs from database
  const allSongs: SongForScan[] = await prisma.song.findMany({
    where: {
      OR: [
        { telegram: null },
        { telegram: { file_id_64: null } },
        { telegram: { file_id_128: null } },
        { telegram: { file_id_320: null } },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      titleEn: true,
      artist: true,
      artistEn: true,
      duration: true,
      coverArt: true,
      ogg: true,
      uri: true,
      links: true,
    },
  });

  const songsAbove50M: OversizedSongReport[] = [];
  // Quick set for skipping oversized files during upload phase
  const oversizedFilesSet = new Set<string>();

  for (const song of allSongs) {
    const links = parseSongLinks(song.links);
    const oversizedFiles: OversizedFileReport[] = [];

    const checkFile = (
      type: "photo" | "voice" | "audio",
      quality: string | null,
      relUrl?: string | null,
      dbBytes?: number | null
    ): void => {
      if (!relUrl && !dbBytes) return;
      const size = getFileSize(relUrl, dbBytes);
      if (size > MAX_TELEGRAM_FILE_SIZE) {
        oversizedFilesSet.add(`${song.id}_${type}_${quality ?? "default"}`);
        oversizedFiles.push({
          type,
          quality,
          url: relUrl,
          sizeBytes: size,
          sizeMB: `${(size / (1024 * 1024)).toFixed(2)} MB`,
          source:
            relUrl && fs.existsSync(resolveLocalPath(relUrl) || "")
              ? "disk"
              : "metadata",
        });
      }
    };

    // Check coverArt
    if (song.coverArt) checkFile("photo", "coverArt", song.coverArt, null);
    // Check ogg voice preview
    if (song.ogg) checkFile("voice", "ogg", song.ogg, null);
    // Check MP3 files (64, 128, 320)
    for (const q of ["64", "128", "320"]) {
      const item = links[q];
      if (item) {
        checkFile("audio", q, item.url, item.bytes);
      }
    }
    // Check uri fallback if 128 not in links
    if (!links["128"] && song.uri) {
      checkFile("audio", "128", song.uri, null);
    }

    if (oversizedFiles.length > 0) {
      songsAbove50M.push({
        id: song.id,
        slug: song.slug,
        title: song.title,
        titleEn: song.titleEn,
        artist: song.artist,
        duration: song.duration,
        oversizedFiles,
      });
    }
  }

  // Save above50m.json in current working directory
  const above50mPath = path.join(process.cwd(), "above50m.json");
  await writeFile(
    above50mPath,
    JSON.stringify(songsAbove50M, null, 2),
    "utf-8"
  );

  console.log(`📊 Scanned ${allSongs.length} songs in database.`);
  console.log(
    `⚠️  Found ${songsAbove50M.length} songs with at least one file > 50MB.`
  );
  console.log(`📄 Saved oversized report to: ${above50mPath}`);
  console.log("==================================================\n");

  console.log("🚀 Phase 2: Starting Telegram Uploads...");

  // Query songs that have missing telegram file_ids
  const songsToUpload: SongWithTelegram[] = await prisma.song.findMany({
    where: {
      OR: [
        { telegram: null },
        { telegram: { file_id_64: null } },
        { telegram: { file_id_128: null } },
        { telegram: { file_id_320: null } },
        { telegram: { file_id_ogg: null } },
        { telegram: { cover_art_file_id: null } },
      ],
    },
    include: {
      telegram: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const songsToUploadCount: number = await prisma.song.count({
    where: {
      OR: [
        { telegram: null },
        { telegram: { file_id_64: null } },
        { telegram: { file_id_128: null } },
        { telegram: { file_id_320: null } },
        // { telegram: { file_id_ogg: null } },
        // { telegram: { cover_art_file_id: null } },
      ],
    },
  });

  console.log(`📋 Found ${songsToUploadCount} songs needing file uploads.\n`);

  console.log("⏳ Calculating total size of files to upload (< 50MB)...");
  let totalUploadSizeBytes = 0;
  let totalFilesToUpload = 0;

  for (const song of songsToUpload) {
    if (!song) continue;

    // 1. Cover Art (Photo)
    if (song.coverArt) {
      const hasPhoto = await exists(song, "photo", null);
      if (!hasPhoto) {
        const fullPath = resolveLocalPath(song.coverArt);
        if (fullPath && fs.existsSync(fullPath)) {
          try {
            const fileSize = fs.statSync(fullPath).size;
            if (
              !oversizedFilesSet.has(`${song.id}_photo_coverArt`) &&
              fileSize <= MAX_TELEGRAM_FILE_SIZE
            ) {
              totalUploadSizeBytes += fileSize;
              totalFilesToUpload++;
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    }

    // 2. Voice (OGG 30s preview)
    if (song.ogg) {
      const hasVoice = await exists(song, "voice", null);
      if (!hasVoice) {
        const fullPath = resolveLocalPath(song.ogg);
        if (fullPath && fs.existsSync(fullPath)) {
          try {
            const fileSize = fs.statSync(fullPath).size;
            if (
              !oversizedFilesSet.has(`${song.id}_voice_ogg`) &&
              fileSize <= MAX_TELEGRAM_FILE_SIZE
            ) {
              totalUploadSizeBytes += fileSize;
              totalFilesToUpload++;
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    }

    // 3. Audio MP3s (64kbps, 128kbps, 320kbps)
    const links = parseSongLinks(song.links);
    for (const quality of ["64", "128", "320"]) {
      const hasAudio = await exists(song, "audio", quality);
      if (hasAudio) continue;

      const relUrl =
        links[quality]?.url ?? (quality === "128" ? song.uri : null);
      if (!relUrl) continue;

      const fullPath = resolveLocalPath(relUrl);
      if (!fullPath || !fs.existsSync(fullPath)) {
        continue;
      }

      try {
        const fileSize = fs.statSync(fullPath).size;
        if (
          !oversizedFilesSet.has(`${song.id}_audio_${quality}`) &&
          fileSize <= MAX_TELEGRAM_FILE_SIZE
        ) {
          totalUploadSizeBytes += fileSize;
          totalFilesToUpload++;
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  const formattedUploadSize = formatSizeMBAndGB(totalUploadSizeBytes);
  console.log(
    `📦 Total size of files to upload (< 50MB): ${formattedUploadSize}`
  );
  console.log(`📁 Total files to upload: ${totalFilesToUpload}\n`);

  const errored: SongUploadError[] = [];
  let processedCount = 0;
  let successCount = 0;

  for (let i = 0; i < songsToUpload.length; i++) {
    const song = songsToUpload[i];

    if (!song) {
      console.log("Song not found!");
      continue;
    }

    if (
      song.telegram?.cover_art_file_id &&
      song.telegram?.file_id_ogg &&
      song.telegram?.file_id_64 &&
      song.telegram?.file_id_128 &&
      song.telegram?.file_id_320
    ) {
      continue;
    }

    processedCount++;

    const songErrors: string[] = [];
    const logPrefix = `[${i + 1}/${songsToUpload.length}] (${
      song.title || song.titleEn || song.id
    })`;

    if (processedCount % 10 === 0 || i === 0) {
      console.log(
        `\n⏳ Progress: ${processedCount}/${songsToUpload.length} (${(
          (processedCount / songsToUpload.length) *
          100
        ).toFixed(1)}%). Current: ${song.titleEn || song.title}`
      );
    }

    // ----------------------------------------------------
    // 1. Cover Art (Photo)
    // ----------------------------------------------------
    if (song.coverArt) {
      const hasPhoto = await exists(song, "photo", null);
      if (!hasPhoto) {
        const fullPath = resolveLocalPath(song.coverArt);
        if (!fullPath || !fs.existsSync(fullPath)) {
          // File missing on disk, skip silently
        } else if (
          oversizedFilesSet.has(`${song.id}_photo_coverArt`) ||
          fs.statSync(fullPath).size > MAX_TELEGRAM_FILE_SIZE
        ) {
          console.warn(`   ⚠️ ${logPrefix} Skipping Cover Art: exceeds 50MB`);
        } else {
          try {
            const msg = await callWithRetry(() =>
              bot.api.sendPhoto(STORAGE_CHAT_ID, new InputFile(fullPath))
            );
            const photo = msg.photo?.at(-1);
            if (photo) {
              await saveTx(
                song,
                "photo",
                null,
                photo.file_id,
                photo.file_unique_id
              );
              console.log(`   ✓ Cover uploaded for "${song.title}"`);
            }
          } catch (err: unknown) {
            const message = getErrorMessage(err);
            console.error(`   ✗ ${logPrefix} Cover upload failed: ${message}`);
            songErrors.push(`Cover: ${message}`);
          }
        }
      }
    }

    // ----------------------------------------------------
    // 2. Voice (OGG 30s preview)
    // ----------------------------------------------------
    if (song.ogg) {
      const hasVoice = await exists(song, "voice", null);
      if (!hasVoice) {
        const fullPath = resolveLocalPath(song.ogg);
        if (!fullPath || !fs.existsSync(fullPath)) {
          // File missing on disk, skip silently
        } else if (
          oversizedFilesSet.has(`${song.id}_voice_ogg`) ||
          fs.statSync(fullPath).size > MAX_TELEGRAM_FILE_SIZE
        ) {
          console.warn(`   ⚠️ ${logPrefix} Skipping Voice (OGG): exceeds 50MB`);
        } else {
          try {
            const msg = await callWithRetry(() =>
              bot.api.sendVoice(STORAGE_CHAT_ID, new InputFile(fullPath))
            );
            if (msg.voice) {
              await saveTx(
                song,
                "voice",
                null,
                msg.voice.file_id,
                msg.voice.file_unique_id
              );
              console.log(`   ✓ Voice uploaded for "${song.title}"`);
            }
          } catch (err: unknown) {
            const message = getErrorMessage(err);
            console.error(`   ✗ ${logPrefix} Voice upload failed: ${message}`);
            songErrors.push(`Voice: ${message}`);
          }
        }
      }
    }

    // ----------------------------------------------------
    // 3. Audio MP3s (64kbps, 128kbps, 320kbps)
    // ----------------------------------------------------
    const links = parseSongLinks(song.links);
    for (const quality of ["64", "128", "320"]) {
      const hasAudio = await exists(song, "audio", quality);
      if (hasAudio) continue;

      const relUrl =
        links[quality]?.url ?? (quality === "128" ? song.uri : null);
      if (!relUrl) continue;

      const fullPath = resolveLocalPath(relUrl);
      if (!fullPath || !fs.existsSync(fullPath)) {
        continue;
      }

      const fileSize = fs.statSync(fullPath).size;
      if (
        oversizedFilesSet.has(`${song.id}_audio_${quality}`) ||
        fileSize > MAX_TELEGRAM_FILE_SIZE
      ) {
        console.warn(
          `   ⚠️ ${logPrefix} Skipping ${quality}kbps (${(
            fileSize /
            (1024 * 1024)
          ).toFixed(1)} MB): exceeds 50MB`
        );
        continue;
      }

      try {
        // Upload from Link

        let msg;

        try {
          msg = await callWithRetry(() =>
            bot.api.sendAudio(
              STORAGE_CHAT_ID,
              `https://dl.deybalal.ir${relUrl}`,
              {
                title: song.title || "خواننده",
                performer: song.artist || "خواننده",
                duration: song.duration > 0 ? song.duration : undefined,
              }
            )
          );
        } catch (error) {
          console.log(
            "Upload from URL failed!",
            (fileSize / (1024 * 1024)).toFixed(1),
            " MB"
          );
          // Upload from Local File
          msg = await callWithRetry(() =>
            bot.api.sendAudio(STORAGE_CHAT_ID, new InputFile(fullPath), {
              title: song.title || "خواننده",
              performer: song.artist || "خواننده",
              duration: song.duration > 0 ? song.duration : undefined,
            })
          );
        }

        if (msg.audio) {
          await saveTx(
            song,
            "audio",
            quality,
            msg.audio.file_id,
            msg.audio.file_unique_id
          );
          console.log(
            `   ✓ Audio ${quality}kbps uploaded for "${song.artistEn}" "${song.titleEn}"`
          );
        }
        await sleep(500);
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error(
          `   ✗ ${logPrefix} Audio ${quality}kbps upload failed: ${message}`
        );
        songErrors.push(`Audio ${quality}kbps: ${message}`);
      }
    }

    if (songErrors.length > 0) {
      errored.push({
        id: song.id,
        slug: song.slug,
        title: song.title,
        artist: song.artist,
        errors: songErrors,
      });
    } else {
      successCount++;
    }
  }

  console.log("\n==================================================");
  console.log("🏁 Finished Processing Song Uploads!");
  console.log(`Total songs processed:       ${processedCount}`);
  console.log(`Completed without error:     ${successCount}`);
  console.log(`Songs with upload errors:    ${errored.length}`);
  console.log("==================================================");

  if (errored.length > 0) {
    const erroredPath = path.join(process.cwd(), "erroredUndone.json");
    await writeFile(erroredPath, JSON.stringify(errored, null, 2), "utf-8");
    console.log(`📄 Saved failed items to: ${erroredPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(
    "❌ Fatal error during script execution:",
    getErrorMessage(err)
  );
  process.exit(1);
});
