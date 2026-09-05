import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const DEFAULT_DB_PATH = path.join(
  process.cwd(),
  "data",
  "fingerprints.db"
);

export interface IdentifiedSong {
  id: string;
  slug?: string;
  title: string;
  titleEn?: string;
  artist: string;
  artistEn?: string;
  coverArt?: string;
  uri?: string;
  duration?: number;
}

export interface FingerprintCandidate {
  song: IdentifiedSong;
  confidence: number;
  matchedPeaks: number;
  totalMatches: number;
  alignmentRatio: number;
  timeOffset: number;
}

export interface FingerprintResult {
  match: boolean;
  confidence: number;
  song: IdentifiedSong | null;
  stats: {
    matchedPeaks: number;
    totalMatches: number;
    alignmentRatio: number;
  } | null;
  candidates: FingerprintCandidate[];
}

export function getFingerprintsDb(customPath?: string) {
  const dbPath =
    customPath || process.env.FINGERPRINTS_DB_PATH || DEFAULT_DB_PATH;

  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA wal_autocheckpoint = 1000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_key TEXT UNIQUE NOT NULL,
      slug TEXT,
      title TEXT NOT NULL,
      title_en TEXT,
      artist TEXT NOT NULL,
      artist_en TEXT,
      cover_art TEXT,
      uri TEXT,
      file_path TEXT,
      duration INTEGER DEFAULT 0,
      fingerprint_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fingerprints (
      hash INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      offset INTEGER NOT NULL,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fingerprints_hash
      ON fingerprints(hash);

    CREATE INDEX IF NOT EXISTS idx_fingerprints_song
      ON fingerprints(song_id);
  `);

  return db;
}

/**
 * Extract Dejavu fingerprints from an audio file.
 *
 * The Python script should be available at:
 * scripts/dejavu_fingerprint.py
 */
export async function extractFingerprints(
  audioPath: string,
  duration = 15
): Promise<[number, number][]> {
  const pythonScriptPath = path.join(
    process.cwd(),
    "scripts",
    "dejavu_fingerprint.py"
  );

  const pythonCmd = process.env.PYTHON_PATH || "python";

  const { stdout } = await execFileAsync(
    pythonCmd,
    [pythonScriptPath, "--stdin", "--duration", String(duration)],
    {
      maxBuffer: 20 * 1024 * 1024,
    }
  );

  const fingerprints = JSON.parse(stdout);

  if (!Array.isArray(fingerprints)) {
    throw new Error("Invalid fingerprint response from Dejavu");
  }

  return fingerprints;
}

/**
 * Identify a song from Dejavu fingerprints.
 */
export async function identifyAudio(
  audioPath: string
): Promise<FingerprintResult> {
  const sampleFingerprints = await extractFingerprints(audioPath, 15);

  if (!sampleFingerprints || sampleFingerprints.length < 5) {
    return {
      match: false,
      confidence: 0,
      song: null,
      stats: null,
      candidates: [],
    };
  }

  // hash -> sample offsets
  const sampleHashMap = new Map<number, number[]>();

  for (const [hash, offset] of sampleFingerprints) {
    const list = sampleHashMap.get(hash);

    if (list) {
      list.push(offset);
    } else {
      sampleHashMap.set(hash, [offset]);
    }
  }

  const uniqueHashes = Array.from(sampleHashMap.keys());

  const db = getFingerprintsDb();

  // song_id -> offset difference -> count
  const songDiffHistograms = new Map<number, Map<number, number>>();

  const songTotalMatches = new Map<number, number>();

  const BATCH_SIZE = 500;

  for (let i = 0; i < uniqueHashes.length; i += BATCH_SIZE) {
    const batch = uniqueHashes.slice(i, i + BATCH_SIZE);

    const placeholders = batch.map(() => "?").join(",");

    const stmt = db.prepare(`
      SELECT hash, song_id, offset
      FROM fingerprints
      WHERE hash IN (${placeholders})
    `);

    const rows = stmt.all(...batch) as {
      hash: number;
      song_id: number;
      offset: number;
    }[];

    for (const row of rows) {
      const sampleOffsets = sampleHashMap.get(row.hash);

      if (!sampleOffsets) continue;

      let histogram = songDiffHistograms.get(row.song_id);

      if (!histogram) {
        histogram = new Map<number, number>();
        songDiffHistograms.set(row.song_id, histogram);
      }

      songTotalMatches.set(
        row.song_id,
        (songTotalMatches.get(row.song_id) || 0) + 1
      );

      for (const sampleOffset of sampleOffsets) {
        const diff = row.offset - sampleOffset;

        histogram.set(diff, (histogram.get(diff) || 0) + 1);
      }
    }
  }

  if (songDiffHistograms.size === 0) {
    return {
      match: false,
      confidence: 0,
      song: null,
      stats: null,
      candidates: [],
    };
  }

  interface InternalCandidate {
    songId: number;
    peakCount: number;
    totalMatches: number;
    alignmentRatio: number;
    confidence: number;
    timeOffset: number;
  }

  const candidates: InternalCandidate[] = [];

  for (const [songId, histogram] of songDiffHistograms.entries()) {
    let maxPeakCount = 0;
    let dominantDiff = 0;

    for (const [diff, count] of histogram.entries()) {
      if (count > maxPeakCount) {
        maxPeakCount = count;
        dominantDiff = diff;
      }
    }

    const totalMatches = songTotalMatches.get(songId) || maxPeakCount;

    const alignmentRatio = totalMatches > 0 ? maxPeakCount / totalMatches : 0;

    const peakScore = Math.min(maxPeakCount / 10, 1) * 50;

    const ratioScore = Math.min(alignmentRatio / 0.25, 1) * 50;

    const confidence = Math.min(100, Math.round(peakScore + ratioScore));

    candidates.push({
      songId,
      peakCount: maxPeakCount,
      totalMatches,
      alignmentRatio,
      confidence,
      timeOffset: dominantDiff,
    });
  }

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    return b.peakCount - a.peakCount;
  });

  // Get song metadata
  const songStmt = db.prepare(`
    SELECT
      song_key,
      slug,
      title,
      title_en,
      artist,
      artist_en,
      cover_art,
      uri,
      duration
    FROM songs
    WHERE id = ?
  `);

  const finalCandidates: FingerprintCandidate[] = [];

  for (const candidate of candidates) {
    const songRow = songStmt.get(candidate.songId) as {
      song_key: string;
      slug?: string;
      title: string;
      title_en?: string;
      artist: string;
      artist_en?: string;
      cover_art?: string;
      uri?: string;
      duration?: number;
    } | null;

    if (!songRow) continue;

    finalCandidates.push({
      song: {
        id: songRow.song_key,
        slug: songRow.slug,
        title: songRow.title,
        titleEn: songRow.title_en,
        artist: songRow.artist,
        artistEn: songRow.artist_en,
        coverArt: songRow.cover_art,
        uri: songRow.uri,
        duration: songRow.duration,
      },
      confidence: candidate.confidence,
      matchedPeaks: candidate.peakCount,
      totalMatches: candidate.totalMatches,
      alignmentRatio: Math.round(candidate.alignmentRatio * 100) / 100,
      timeOffset: candidate.timeOffset,
    });
  }

  const best = finalCandidates[0];

  if (!best) {
    return {
      match: false,
      confidence: 0,
      song: null,
      stats: null,
      candidates: [],
    };
  }

  // Same matching rule as your Next.js API.
  const isMatch = best.matchedPeaks >= 3 || best.confidence >= 20;

  return {
    match: isMatch,
    confidence: best.confidence,
    song: isMatch ? best.song : null,
    stats: {
      matchedPeaks: best.matchedPeaks,
      totalMatches: best.totalMatches,
      alignmentRatio: best.alignmentRatio,
    },
    candidates: finalCandidates
      .filter((candidate) => candidate.matchedPeaks >= 2)
      .slice(0, 5),
  };
}
