import { Bot, GrammyError } from "grammy";
// import { HttpsProxyAgent } from "https-proxy-agent";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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
  reason: "AUDIO_TITLE_EMPTY" | "NO_AUDIO_OBJECT" | "TELEGRAM_FILE_INVALID";
  telegramAudio?: TelegramAudioMetadata;
  errorDetails?: string;
  checkedAt: string;
}

export interface SongToCheck {
  id: string;
  slug: string;
  title: string;
  titleEn: string | null;
  artist: string;
  artistEn: string | null;
  duration: number;
  telegram: {
    file_id_64: string | null;
    file_id_128: string | null;
    file_id_320: string | null;
  } | null;
}

// ============================================================================
// Environment & Configuration Loading
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load local .env
dotenv.config();

// 2. Fallback .env search: check parent or deybalal-bot directory if needed
// const candidateEnvPaths = [
//   path.join(process.cwd(), ".env"),
//   path.join(__dirname, "../.env"),
//   path.join(__dirname, ".env"),
//   "G:/Projects/deybalal-bot/.env",
//   "../deybalal-bot/.env",
// ];

// for (const envPath of candidateEnvPaths) {
//   if (fs.existsSync(envPath)) {
//     try {
//       const parsed = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
//       for (const [k, v] of Object.entries(parsed)) {
//         if (!process.env[k]) {
//           process.env[k] = v;
//         }
//       }
//     } catch {}
//   }
// }

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ Fatal: BOT_TOKEN is missing from environment variables.");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "❌ Fatal: DATABASE_URL is missing from environment variables."
  );
  process.exit(1);
}

// Target chat for sending diagnostic test audio.
// Prioritize LOGS_CHAT_ID (as used in bot_files/index.ts), then STORAGE_CHAT_ID, then ADMIN_ID.
const TARGET_CHAT_ID = process.env.STORAGE_TWO_CHAT_ID;

if (!TARGET_CHAT_ID) {
  console.error(
    "❌ Fatal: Target chat ID missing. Please set LOGS_CHAT_ID, STORAGE_CHAT_ID, or ADMIN_ID."
  );
  process.exit(1);
}

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

const specificQuality = getCliArg("--quality") || getCliArg("-q");
const limitArg = getCliArg("--limit");
const maxItemsLimit = limitArg ? parseInt(limitArg, 10) : undefined;
const customDelayArg = getCliArg("--delay");
const MIN_REQUEST_INTERVAL_MS = customDelayArg
  ? parseInt(customDelayArg, 10)
  : 1200; // 1.2s delay between Telegram API calls

// Determine output directory: current working directory or dirname
const OUTPUT_DIR = process.cwd();

// ============================================================================
// Proxy & Telegram Bot Setup
// ============================================================================

// const proxyEnv = "http://127.0.0.1:2080";

// const useProxy = Boolean(proxyEnv);

const botConfig: { client: { baseFetchConfig: Record<string, unknown> } } = {
  client: {
    baseFetchConfig: {},
  },
};

// if (useProxy) {
//   // Bun native fetch supports `proxy: string`, Node fetch supports agent
//   botConfig.client.baseFetchConfig = {
//     // @ts-ignore
//     proxy: proxyEnv,
//     // agent: new HttpsProxyAgent(proxyEnv),
//     compress: true,
//   };
// }

export const bot = new Bot(BOT_TOKEN, botConfig);

// ============================================================================
// Prisma Client Singleton
// ============================================================================

const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
 * Guarantees zero data corruption even if interrupted mid-write.
 */
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, content, "utf-8");
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    // Fallback on Windows if rename encounters lock/permission glitch
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
        const waitMs = waitSeconds * 1000 + 1500; // wait seconds + 1.5s safety margin
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

      // 3. Other errors (e.g. 400 Bad Request) must be propagated to caller
      throw err;
    }
  }
}

// ============================================================================
// Core Audio Diagnostic Logic
// ============================================================================

export type DiagnosticResult =
  | { status: "VALID"; title: string; performer: string | null }
  | {
      status: "BAD";
      reason: "AUDIO_TITLE_EMPTY" | "NO_AUDIO_OBJECT" | "TELEGRAM_FILE_INVALID";
      telegramAudio?: TelegramAudioMetadata;
      errorDetails?: string;
    };

/**
 * Checks a single Telegram cached audio file by temporarily sending it to TARGET_CHAT_ID
 * and checking if `audio.title` is empty or missing.
 * Immediately deletes the sent message.
 */
async function diagnoseAudioFile(fileId: string): Promise<DiagnosticResult> {
  let messageId: number | null = null;
  let chatId: number | string | null = null;

  try {
    const message = await callTelegramWithRetry(
      `sendAudio(${fileId.substring(0, 12)}...)`,
      () => bot.api.sendAudio(TARGET_CHAT_ID, fileId)
    );

    messageId = message.message_id;
    chatId = message.chat.id;

    const audio = message.audio;

    // Check 1: Audio object existence
    if (!audio) {
      return {
        status: "BAD",
        reason: "NO_AUDIO_OBJECT",
        errorDetails: "Sent message did not contain an audio object.",
      };
    }

    const title = audio.title?.trim() ?? "";

    const metadata: TelegramAudioMetadata = {
      title: audio.title ?? null,
      performer: audio.performer ?? null,
      duration: audio.duration ?? null,
      fileName: audio.file_name ?? null,
      mimeType: audio.mime_type ?? null,
      fileSize: audio.file_size ?? null,
    };

    // Check 2: Audio title emptiness (root cause of AUDIO_TITLE_EMPTY on answerInlineQuery)
    if (!title) {
      return {
        status: "BAD",
        reason: "AUDIO_TITLE_EMPTY",
        telegramAudio: metadata,
        errorDetails:
          "Audio title is null or empty whitespace on Telegram servers.",
      };
    }

    return {
      status: "VALID",
      title,
      performer: audio.performer ?? null,
    };
  } catch (error: unknown) {
    const errObj = error as any;
    const isBadFileTelegramError =
      (error instanceof GrammyError && error.error_code === 400) ||
      errObj?.error_code === 400 ||
      (error instanceof Error && error.message.includes("400: Bad Request"));

    if (isBadFileTelegramError) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: "BAD",
        reason: "TELEGRAM_FILE_INVALID",
        errorDetails: msg,
      };
    }

    throw error;
  } finally {
    // Delete diagnostic message immediately to avoid chat clutter
    if (messageId && chatId) {
      try {
        await callTelegramWithRetry("deleteMessage", () =>
          bot.api.deleteMessage(chatId!, messageId!)
        );
      } catch (delErr) {
        // Silently catch delete errors (e.g. message was already deleted)
      }
    }
  }
}

// ============================================================================
// Single Quality Scanner
// ============================================================================

interface ScanQualityOptions {
  quality: AudioQuality;
  songs: SongToCheck[];
  outputDir: string;
}

async function scanQuality({
  quality,
  songs,
  outputDir,
}: ScanQualityOptions): Promise<{
  totalProcessed: number;
  totalValid: number;
  totalBad: number;
  totalSkipped: number;
}> {
  const doneFilePath = path.join(outputDir, `${quality}done.json`);
  const badFilesPath = path.join(outputDir, `${quality}badfiles.json`);

  console.log("\n" + "=".repeat(70));
  console.log(`🎵 SCANNING QUALITY: ${quality} kbps`);
  console.log(`📁 Done tracking file: ${doneFilePath}`);
  console.log(`📁 Bad files report:   ${badFilesPath}`);
  console.log("=".repeat(70));

  // 1. Load existing progress for resume
  const existingDoneList = await loadJsonSafe<string[]>(doneFilePath, []);
  const doneSet = new Set<string>(existingDoneList);

  const existingBadList = await loadJsonSafe<BadFileRecord[]>(badFilesPath, []);
  const badFilesMap = new Map<string, BadFileRecord>();
  for (const item of existingBadList) {
    badFilesMap.set(item.songId, item);
  }

  console.log(`🔄 Resume State:`);
  console.log(`   - Already done:      ${doneSet.size} songs`);
  console.log(`   - Known bad files:   ${badFilesMap.size} songs`);

  // Target songs not done yet
  const songsToProcess = songs.filter((s) => !doneSet.has(s.id));
  console.log(`   - Remaining to scan: ${songsToProcess.length} songs\n`);

  if (songsToProcess.length === 0) {
    console.log(
      `✅ Quality ${quality} is already 100% completed! Skipping to next.`
    );
    return {
      totalProcessed: songs.length,
      totalValid: songs.length - badFilesMap.size,
      totalBad: badFilesMap.size,
      totalSkipped: 0,
    };
  }

  let totalValid = 0;
  let totalBad = 0;
  let totalSkipped = 0;

  // Graceful shutdown handling
  let isShuttingDown = false;
  const onSignal = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(
      `\n\n🛑 Received termination signal! Saving current state before exit...`
    );
    await writeJsonAtomic(doneFilePath, Array.from(doneSet));
    await writeJsonAtomic(badFilesPath, Array.from(badFilesMap.values()));
    console.log(
      `💾 Progress saved safely to ${doneFilePath} and ${badFilesPath}. Bye!`
    );
    process.exit(0);
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const totalSongsCount = songs.length;

  for (let idx = 0; idx < songsToProcess.length; idx++) {
    if (isShuttingDown) break;

    const song = songsToProcess[idx];
    const overallIndex = doneSet.size + 1;
    const progressPercent = ((overallIndex / totalSongsCount) * 100).toFixed(1);

    // Resolve file_id for the given quality
    let fileId: string | null = null;
    if (quality === "64") fileId = song.telegram?.file_id_64 ?? null;
    else if (quality === "128") fileId = song.telegram?.file_id_128 ?? null;
    else if (quality === "320") fileId = song.telegram?.file_id_320 ?? null;

    const songDisplayName = `"${song.title || song.titleEn || "Unknown"}" - "${
      song.artist || song.artistEn || "Unknown"
    }"`;

    // If song has no file uploaded for this quality, mark done and skip
    if (!fileId || !fileId.trim()) {
      doneSet.add(song.id);
      totalSkipped++;
      // Save every 20 skipped items or at the end
      if (doneSet.size % 20 === 0 || idx === songsToProcess.length - 1) {
        await writeJsonAtomic(doneFilePath, Array.from(doneSet));
      }
      continue;
    }

    const logPrefix = `[${quality}kbps] [${overallIndex}/${totalSongsCount}] (${progressPercent}%) [${song.id}]`;

    try {
      const result = await diagnoseAudioFile(fileId);

      if (result.status === "VALID") {
        totalValid++;
        // console.log(
        //   `   ✓ ${logPrefix} ${songDisplayName}\n      └─ VALID (Title: "${
        //     result.title
        //   }", Performer: "${result.performer ?? ""}")`
        // );
        console.log(`[${overallIndex}/${totalSongsCount}]`);
      } else {
        totalBad++;
        const badRecord: BadFileRecord = {
          songId: song.id,
          slug: song.slug,
          title: song.title,
          artist: song.artist,
          quality,
          fileId,
          reason: result.reason,
          telegramAudio: result.telegramAudio,
          errorDetails: result.errorDetails,
          checkedAt: new Date().toISOString(),
        };

        badFilesMap.set(song.id, badRecord);

        console.error(
          `   ❌ ${logPrefix} ${songDisplayName}\n      └─ ⚠️ BAD FILE FOUND! Reason: ${
            result.reason
          } (fileId: ${fileId.substring(0, 16)}...)`
        );

        // Immediately persist bad file record
        await writeJsonAtomic(badFilesPath, Array.from(badFilesMap.values()));
      }
    } catch (err: unknown) {
      // Unhandled fatal error for a single song
      console.error(
        `   ❌ ${logPrefix} ${songDisplayName} Unexpected error: ${
          (err as Error).message
        }`
      );
    }

    // Always record song.id as done and persist atomically
    doneSet.add(song.id);
    await writeJsonAtomic(doneFilePath, Array.from(doneSet));

    // Also persist bad files periodically or when updated
    if (totalBad > 0 && totalBad % 5 === 0) {
      await writeJsonAtomic(badFilesPath, Array.from(badFilesMap.values()));
    }
  }

  // Final flush for this quality
  await writeJsonAtomic(doneFilePath, Array.from(doneSet));
  await writeJsonAtomic(badFilesPath, Array.from(badFilesMap.values()));

  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

  console.log(`\n🏁 Quality ${quality} kbps Completed!`);
  console.log(`   - Total in DB:       ${totalSongsCount}`);
  console.log(`   - Verified Valid:    ${totalValid}`);
  console.log(`   - Bad Files Found:   ${badFilesMap.size}`);
  console.log(`   - No File in DB:     ${totalSkipped}`);

  return {
    totalProcessed: doneSet.size,
    totalValid,
    totalBad: badFilesMap.size,
    totalSkipped,
  };
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function main(): Promise<void> {
  console.log(
    "======================================================================"
  );
  console.log("🔍 DeyBalal - Telegram Audio 'AUDIO_TITLE_EMPTY' Detector");
  console.log(
    "======================================================================"
  );
  console.log(`📅 Started at:       ${new Date().toISOString()}`);
  console.log(`🤖 Bot Username:     (verifying...)`);
  console.log(`🎯 Diagnostic Chat:  ${TARGET_CHAT_ID}`);
  console.log(`📁 Output Directory: ${OUTPUT_DIR}`);
  console.log(`⚡ Delay per request: ${MIN_REQUEST_INTERVAL_MS}ms`);
  // if (useProxy) {
  //   console.log(`🌐 Proxy:            ${proxyEnv}`);
  // }

  // 1. Verify Telegram Connection
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

  // 2. Query all songs from database
  console.log("\n📦 Fetching songs from database...");
  const songs: SongToCheck[] = await prisma.song.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      titleEn: true,
      artist: true,
      artistEn: true,
      duration: true,
      telegram: {
        select: {
          file_id_64: true,
          file_id_128: true,
          file_id_320: true,
        },
      },
    },
    orderBy: {
      id: "asc",
    },
    ...(maxItemsLimit ? { take: maxItemsLimit } : {}),
  });

  console.log(`📊 Loaded ${songs.length} songs from database.`);

  // 3. Determine Qualities to Scan
  // By default: first 64, then 128, then 320
  let qualitiesToScan: AudioQuality[] = ["64", "128", "320"];

  if (specificQuality) {
    if (["64", "128", "320"].includes(specificQuality)) {
      qualitiesToScan = [specificQuality as AudioQuality];
      console.log(
        `🎯 User specified single quality scan: ${specificQuality} kbps`
      );
    } else {
      console.error(
        `❌ Invalid quality "${specificQuality}". Allowed values: 64, 128, 320.`
      );
      process.exit(1);
    }
  }

  const summaryResults: Record<
    string,
    { total: number; bad: number; file: string }
  > = {};

  for (const quality of qualitiesToScan) {
    const stats = await scanQuality({
      quality,
      songs,
      outputDir: OUTPUT_DIR,
    });

    summaryResults[quality] = {
      total: stats.totalProcessed,
      bad: stats.totalBad,
      file: `${quality}badfiles.json`,
    };
  }

  // 4. Overall Final Summary Report
  console.log("\n" + "=".repeat(70));
  console.log("🎉 ALL SCANNING PHASES COMPLETED!");
  console.log("=".repeat(70));
  console.table(summaryResults);
  console.log("Done tracking files: 64done.json, 128done.json, 320done.json");
  console.log(
    "Bad files reports:   64badfiles.json, 128badfiles.json, 320badfiles.json"
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
    try {
      await pool.end();
    } catch {}
  });
