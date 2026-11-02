import { Bot, InputFile, GrammyError } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import prisma from "../src/db";

// ============================================================================
// Types
// ============================================================================

export type AudioQuality = "64" | "128" | "320";

export interface TelegramAudioMetadata {
  title: string | null;
  performer: string | null;
  duration: number | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

export interface BadFileRecord {
  songId: string;
  slug: string;
  title: string;
  artist: string;
  quality: AudioQuality;
  fileId: string;
  reason:
    | "AUDIO_TITLE_EMPTY"
    | "NO_AUDIO_OBJECT"
    | "TELEGRAM_FILE_INVALID"
    | string;
  telegramAudio?: TelegramAudioMetadata;
  errorDetails?: string;
  checkedAt: string;
}

export interface SongLinks {
  "64"?: { url?: string; size?: string; bytes?: number };
  "128"?: { url?: string; size?: string; bytes?: number };
  "320"?: { url?: string; size?: string; bytes?: number };
  [key: string]: { url?: string; size?: string; bytes?: number } | undefined;
}

export const badFiles64: BadFileRecord[] = [];

export const badFiles128: BadFileRecord[] = [];

export const badFiles320: BadFileRecord[] = [];

// ============================================================================
// Environment & Configuration Loading
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load local .env
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ Fatal: BOT_TOKEN is missing from environment variables.");
  process.exit(1);
}

// Telegram chat target where media files are sent and cached
const STORAGE_CHAT_ID = process.env.STORAGE_TWO_CHAT_ID;

// Media root directory for local disk audio assets
const ROOT =
  process.env.PUBLIC_DIR ||
  process.env.ROOT_DIR ||
  path.resolve("H:\\Temp\\Lori2\\public");

// Telegram Bot API maximum upload limit: 50 MiB = 52,428,800 bytes
const MAX_TELEGRAM_FILE_SIZE = 50 * 1024 * 1024;

// Determine output directory: current working directory
const OUTPUT_DIR = process.cwd();

// ============================================================================
// CLI Arguments Parsing
// ============================================================================

const args = process.argv.slice(2);
function getCliArg(flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${flag}=`))
      return args[i].substring(flag.length + 1);
  }
  return null;
}

const hasCliFlag = (flag: string): boolean => args.includes(flag);

const specificQuality = getCliArg("--quality") || getCliArg("-q");
const limitArg = getCliArg("--limit") || getCliArg("-l");
const maxItemsLimit = limitArg ? parseInt(limitArg, 10) : undefined;
const customDelayArg = getCliArg("--delay") || getCliArg("-d");
const MIN_REQUEST_INTERVAL_MS = customDelayArg
  ? parseInt(customDelayArg, 10)
  : 1200; // 1.2s delay between Telegram API calls
const isDryRun = hasCliFlag("--dry-run");
const isForce = hasCliFlag("--force");

// ============================================================================
// Telegram Bot & Proxy Setup
// ============================================================================

const proxyEnv =
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:2080";

const bot = new Bot(BOT_TOKEN, {
  client: {
    baseFetchConfig: {
      agent: new HttpsProxyAgent(proxyEnv),
      compress: true,
    },
  },
});

// ============================================================================
// Utility Functions
// ============================================================================

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Safely reads and parses a JSON file with fallback to .tmp or .bak
 */
async function loadJsonSafe<T>(filePath: string, defaultValue: T): Promise<T> {
  const candidates = [filePath, `${filePath}.tmp`, `${filePath}.bak`];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = await fs.promises.readFile(candidate, "utf-8");
        if (raw.trim()) {
          return JSON.parse(raw) as T;
        }
      } catch (err) {
        console.warn(
          `⚠️ Warning: Failed to parse ${candidate}: ${(err as Error).message}`
        );
      }
    }
  }
  return defaultValue;
}

/**
 * Atomically writes data to a JSON file (writes to .tmp first, then renames)
 */
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, content, "utf-8");
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    await fs.promises.writeFile(filePath, content, "utf-8");
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {}
  }
}

/**
 * Extracts retry_after value from any error shape (GrammyError, Axios, string, etc.)
 */
function extractRetryAfter(error: unknown): number | null {
  if (error instanceof GrammyError) {
    if (typeof error.parameters?.retry_after === "number") {
      return error.parameters.retry_after;
    }
  }
  const errObj = error as Record<string, unknown> | null;
  if (errObj && typeof errObj === "object") {
    const params = errObj.parameters as { retry_after?: number } | undefined;
    if (typeof params?.retry_after === "number") {
      return params.retry_after;
    }
    if (typeof errObj.retry_after === "number") {
      return errObj.retry_after;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/retry\s+after\s+(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Proactive rate limiter: ensures MIN_REQUEST_INTERVAL_MS has elapsed between requests
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
 * Calls a Telegram API function with complete 429 rate limit backoff and network retries
 */
async function callTelegramWithRetry<T>(
  actionName: string,
  fn: () => Promise<T>,
  maxNetworkRetries = 5
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await waitRateLimit();
      return await fn();
    } catch (err: unknown) {
      const retryAfter = extractRetryAfter(err);
      const is429 =
        Boolean(retryAfter) ||
        (err instanceof GrammyError && err.error_code === 429) ||
        (typeof err === "object" &&
          err !== null &&
          (err as any).error_code === 429) ||
        (err instanceof Error && err.message.includes("429"));

      // 1. Telegram Rate Limit (429) - wait and retry indefinitely until allowed
      if (is429) {
        const waitSeconds = retryAfter ?? 5;
        const waitMs = waitSeconds * 1000 + 1500;
        console.warn(
          `   ⏳ [Rate Limit 429 on ${actionName}] Telegram requires waiting ${waitSeconds}s. Sleeping for ${(
            waitMs / 1000
          ).toFixed(1)}s...`
        );
        await sleep(waitMs);
        lastCallTimestamp = Date.now();
        continue;
      }

      // 2. Transient network/socket glitches - retry with backoff
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNetworkGlitch =
        errMsg.includes("ETIMEDOUT") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("ECONNABORTED") ||
        errMsg.includes("fetch failed") ||
        errMsg.includes("ConnectionRefused") ||
        errMsg.includes("Socket closed");

      if (isNetworkGlitch && attempt <= maxNetworkRetries) {
        const backoffMs = attempt * 2000;
        console.warn(
          `   ⚠️ [Network Glitch on ${actionName}] ${errMsg}. Retrying in ${
            backoffMs / 1000
          }s (attempt ${attempt}/${maxNetworkRetries})...`
        );
        await sleep(backoffMs);
        continue;
      }

      throw err;
    }
  }
}

/**
 * Resolves a relative URL/path from DB against the ROOT media directory safely
 */
function resolveLocalPath(relUrl?: string | null): string | null {
  if (!relUrl) return null;
  const clean = relUrl.replace(/^[\/\\]+/, "");
  return path.join(ROOT, clean);
}

/**
 * Persists the newly uploaded Telegram audio file_id and unique_id to the database.
 */
async function saveTelegramFile(
  songId: string,
  quality: AudioQuality,
  fileId: string,
  uniqueId: string
): Promise<void> {
  const fields: Record<string, string> = {};
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

  await prisma.telegram.upsert({
    where: { songId },
    create: {
      songId,
      ...fields,
    },
    update: fields,
  });
}

// ============================================================================
// Core Upload Logic for Bad Files
// ============================================================================

export interface UploadResult {
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  newFileId?: string;
  newUniqueId?: string;
  uploadMethod?: "URL" | "Local File";
  reason?: string;
}

/**
 * Uploads ONLY the specific audio quality that had a problem for a single song,
 * and saves the new 'file_id' and 'unique_file_id' to the database.
 */
async function uploadSelectedQuality(
  record: BadFileRecord,
  index: number,
  total: number
): Promise<UploadResult> {
  const { songId, quality } = record;
  const logPrefix = `[${quality}kbps] [${index}/${total}] [${songId}]`;

  // 1. Fetch current song & telegram details from database
  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: {
      id: true,
      slug: true,
      title: true,
      titleEn: true,
      artist: true,
      artistEn: true,
      duration: true,
      uri: true,
      links: true,
      telegram: true,
    },
  });

  if (!song) {
    console.error(`   ✗ ${logPrefix} Song not found in database!`);
    return { status: "FAILED", reason: "Song not found in database" };
  }

  // 2. Check if this file has already been replaced in DB (idempotent skip)
  if (!isForce && song.telegram) {
    let currentFileId: string | null = null;
    if (quality === "64") currentFileId = song.telegram.file_id_64;
    else if (quality === "128") currentFileId = song.telegram.file_id_128;
    else if (quality === "320") currentFileId = song.telegram.file_id_320;

    if (
      currentFileId &&
      currentFileId.trim() &&
      currentFileId !== record.fileId
    ) {
      console.log(
        `   ⏩ ${logPrefix} Already fixed in database (current file_id: ${currentFileId.substring(
          0,
          16
        )}...). Skipping.`
      );
      return { status: "SKIPPED", reason: "Already fixed in database" };
    }
  }

  // 3. Resolve audio path for the specific quality
  const links = (song.links as SongLinks) || {};
  const relUrl = links[quality]?.url ?? (quality === "128" ? song.uri : null);

  if (!relUrl) {
    console.error(
      `   ✗ ${logPrefix} No audio URL found in DB for quality ${quality}!`
    );
    return {
      status: "FAILED",
      reason: `No audio URL found for quality ${quality}`,
    };
  }

  const fullPath = resolveLocalPath(relUrl);
  const localExists = fullPath ? fs.existsSync(fullPath) : false;
  const fileSize = localExists
    ? fs.statSync(fullPath!).size
    : links[quality]?.bytes ?? 0;

  if (fileSize > MAX_TELEGRAM_FILE_SIZE) {
    console.warn(
      `   ⚠️ ${logPrefix} Skipping: file size ${(
        fileSize /
        (1024 * 1024)
      ).toFixed(1)}MB exceeds 50MB limit.`
    );
    return { status: "SKIPPED", reason: "File exceeds 50MB limit" };
  }

  const audioTitle = song.title?.trim() || record.title?.trim() || "خواننده";
  const audioPerformer =
    song.artist?.trim() || record.artist?.trim() || "خواننده";
  const audioDuration = song.duration > 0 ? song.duration : undefined;

  if (isDryRun) {
    console.log(
      `   🔍 [DRY-RUN] ${logPrefix} Would upload ${quality}kbps for "${audioTitle}" - "${audioPerformer}"`
    );
    console.log(`      └─ URL: https://dl.deybalal.ir${relUrl}`);
    console.log(
      `      └─ Local: ${fullPath} (Exists: ${localExists}, Size: ${(
        fileSize /
        (1024 * 1024)
      ).toFixed(1)} MB)`
    );
    return { status: "SUCCESS", reason: "Dry run preview" };
  }

  let msg: any = null;
  let uploadMethod: "URL" | "Local File" = "URL";

  // 4. Upload: matching uploadSongs.ts, try URL first, then fallback to local file
  try {
    msg = await callTelegramWithRetry(
      `sendAudio URL (${songId} - ${quality}kbps)`,
      () =>
        bot.api.sendAudio(STORAGE_CHAT_ID, `https://dl.deybalal.ir${relUrl}`, {
          title: audioTitle,
          performer: audioPerformer,
          duration: audioDuration,
        })
    );
  } catch (urlErr) {
    if (localExists && fullPath) {
      uploadMethod = "Local File";
      console.warn(
        `   ⚠️ ${logPrefix} URL upload failed (${
          (urlErr as Error).message
        }). Retrying from local disk (${(fileSize / (1024 * 1024)).toFixed(
          1
        )} MB)...`
      );
      msg = await callTelegramWithRetry(
        `sendAudio Local (${songId} - ${quality}kbps)`,
        () =>
          bot.api.sendAudio(STORAGE_CHAT_ID, new InputFile(fullPath), {
            title: audioTitle,
            performer: audioPerformer,
            duration: audioDuration,
          })
      );
    } else {
      throw urlErr;
    }
  }

  if (!msg?.audio) {
    throw new Error("Telegram API response did not contain an audio object.");
  }

  const newFileId: string = msg.audio.file_id;
  const newUniqueId: string = msg.audio.file_unique_id;

  // 5. Save the new file_id and unique_file_id to Prisma Telegram table
  await saveTelegramFile(song.id, quality, newFileId, newUniqueId);

  console.log(
    `   ✓ ${logPrefix} Successfully uploaded (${uploadMethod})!\n      └─ New file_id: ${newFileId.substring(
      0,
      20
    )}... | unique_id: ${newUniqueId}`
  );

  return {
    status: "SUCCESS",
    newFileId,
    newUniqueId,
    uploadMethod,
  };
}

// ============================================================================
// Single Quality Processor
// ============================================================================

interface ProcessQualityOptions {
  quality: AudioQuality;
  records: BadFileRecord[];
  outputDir: string;
}

async function processQuality({
  quality,
  records,
  outputDir,
}: ProcessQualityOptions): Promise<{
  total: number;
  fixed: number;
  skipped: number;
  failed: number;
}> {
  const doneFilePath = path.join(outputDir, `${quality}_fixed_done.json`);
  const fixedReportPath = path.join(outputDir, `${quality}_fixed_report.json`);

  console.log("\n" + "=".repeat(70));
  console.log(`🎵 UPLOADING BAD FILES FOR QUALITY: ${quality} kbps`);
  console.log(`📁 Done tracking file:   ${doneFilePath}`);
  console.log(`📁 Fixed report file:    ${fixedReportPath}`);
  console.log(`📊 Records to process:   ${records.length}`);
  console.log("=".repeat(70));

  // Load existing progress for resume
  const existingDoneList = await loadJsonSafe<string[]>(doneFilePath, []);
  const doneSet = new Set<string>(existingDoneList);

  const existingReport = await loadJsonSafe<Record<string, unknown>[]>(
    fixedReportPath,
    []
  );
  const reportMap = new Map<string, Record<string, unknown>>();
  for (const item of existingReport) {
    if (typeof item.songId === "string") {
      reportMap.set(item.songId, item);
    }
  }

  const toProcess = isForce
    ? records
    : records.filter((r) => !doneSet.has(r.songId));

  console.log(`🔄 Resume State:`);
  console.log(`   - Already done:        ${doneSet.size}`);
  console.log(`   - Remaining to upload: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log(
      `✅ Quality ${quality} kbps is already 100% completed! Skipping.`
    );
    return {
      total: records.length,
      fixed: reportMap.size,
      skipped: doneSet.size - reportMap.size,
      failed: 0,
    };
  }

  // Slice if user specified --limit
  const recordsToRun = maxItemsLimit
    ? toProcess.slice(0, maxItemsLimit)
    : toProcess;

  let fixedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // Graceful shutdown handling
  let isShuttingDown = false;
  const onSignal = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(
      `\n\n🛑 Received termination signal! Saving current progress...`
    );
    if (!isDryRun) {
      await writeJsonAtomic(doneFilePath, Array.from(doneSet));
      await writeJsonAtomic(fixedReportPath, Array.from(reportMap.values()));
      console.log(`💾 Progress saved safely. Goodbye!`);
    } else {
      console.log(`Dry-run aborted. Goodbye!`);
    }
    process.exit(0);
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const totalCount = recordsToRun.length;

  for (let idx = 0; idx < totalCount; idx++) {
    if (isShuttingDown) break;

    const record = recordsToRun[idx];
    const currentIndex = idx + 1;

    try {
      const result = await uploadSelectedQuality(
        record,
        currentIndex,
        totalCount
      );

      if (result.status === "SUCCESS") {
        fixedCount++;
        if (!isDryRun) {
          doneSet.add(record.songId);
          reportMap.set(record.songId, {
            songId: record.songId,
            slug: record.slug,
            title: record.title,
            artist: record.artist,
            quality,
            oldFileId: record.fileId,
            newFileId: result.newFileId,
            newUniqueId: result.newUniqueId,
            uploadMethod: result.uploadMethod,
            updatedAt: new Date().toISOString(),
          });
        }
      } else if (result.status === "SKIPPED") {
        skippedCount++;
        if (!isDryRun) {
          doneSet.add(record.songId);
        }
      } else {
        failedCount++;
      }
    } catch (err: unknown) {
      failedCount++;
      console.error(
        `   ❌ [${quality}kbps] Failed for song ${record.songId} (${
          record.title
        }): ${(err as Error).message}`
      );
    }

    // Persist progress every 5 items or at the end (unless dry-run)
    if (!isDryRun && (idx % 5 === 0 || idx === totalCount - 1)) {
      await writeJsonAtomic(doneFilePath, Array.from(doneSet));
      await writeJsonAtomic(fixedReportPath, Array.from(reportMap.values()));
    }
  }

  // Final flush (unless dry-run)
  if (!isDryRun) {
    await writeJsonAtomic(doneFilePath, Array.from(doneSet));
    await writeJsonAtomic(fixedReportPath, Array.from(reportMap.values()));
  }

  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

  console.log(`\n🏁 Quality ${quality} kbps Completed!`);
  console.log(`   - Fixed & Uploaded:  ${fixedCount}`);
  console.log(`   - Skipped:           ${skippedCount}`);
  console.log(`   - Failed:            ${failedCount}`);

  return {
    total: totalCount,
    fixed: fixedCount,
    skipped: skippedCount,
    failed: failedCount,
  };
}

// ============================================================================
// Main Entrypoint
// ============================================================================

const BAD_FILES_MAP: Record<AudioQuality, BadFileRecord[]> = {
  "64": badFiles64,
  "128": badFiles128,
  "320": badFiles320,
};

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log("🚀 DeyBalal - Telegram Bad Audio Files Re-Uploader");
  console.log("=".repeat(70));
  console.log(`📅 Started at:       ${new Date().toISOString()}`);
  console.log(`🎯 Storage Chat ID:  ${STORAGE_CHAT_ID}`);
  console.log(`📁 Media root:       ${ROOT}`);
  console.log(`⚡ Delay per call:   ${MIN_REQUEST_INTERVAL_MS}ms`);
  console.log(`🌐 Proxy:            ${proxyEnv}`);
  if (isDryRun)
    console.log("🔍 MODE:             DRY-RUN (No uploads or DB writes)");
  if (isForce)
    console.log("⚡ MODE:             FORCE (Re-uploading already-done items)");

  // 1. Verify Telegram Bot Connection
  try {
    const me = await bot.api.getMe();
    console.log(`✅ Telegram Bot Verified: @${me.username} (${me.first_name})`);
  } catch (err: unknown) {
    console.error(
      `❌ Failed to connect to Telegram: ${
        (err as Error).message
      }. Check BOT_TOKEN and proxy settings.`
    );
    process.exit(1);
  }

  // 2. Determine which qualities to process
  let qualitiesToRun: AudioQuality[] = ["64", "128", "320"];

  if (specificQuality) {
    if (["64", "128", "320"].includes(specificQuality)) {
      qualitiesToRun = [specificQuality as AudioQuality];
      console.log(`🎯 User specified single quality: ${specificQuality} kbps`);
    } else {
      console.error(
        `❌ Invalid quality "${specificQuality}". Allowed values: 64, 128, 320.`
      );
      process.exit(1);
    }
  }

  const summaryResults: Record<
    string,
    { total: number; fixed: number; skipped: number; failed: number }
  > = {};

  for (const quality of qualitiesToRun) {
    const records = BAD_FILES_MAP[quality] || [];
    if (records.length === 0) {
      console.log(
        `\nℹ️ No bad files recorded for quality ${quality} kbps. Skipping.`
      );
      continue;
    }

    const stats = await processQuality({
      quality,
      records,
      outputDir: OUTPUT_DIR,
    });

    summaryResults[quality] = stats;
  }

  // 3. Final summary table
  console.log("\n" + "=".repeat(70));
  console.log("🎉 ALL BAD FILE UPLOADS COMPLETED!");
  console.log("=".repeat(70));
  console.table(summaryResults);
  console.log(
    "Check *_fixed_report.json for details of newly assigned file_id and unique_id."
  );
  console.log("=".repeat(70) + "\n");
}

main()
  .catch((err: unknown) => {
    console.error("❌ Fatal unhandled script exception:", err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
