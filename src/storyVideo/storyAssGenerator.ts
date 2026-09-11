import { writeFile } from "fs/promises";
import path from "path";

export interface StoryLyricLine {
  startMs: number;
  endMs: number;
  text: string;
}

export interface StorySongMeta {
  title: string;
  artist: string;
  duration?: number;
}

function parseLRC(syncedLyrics: string): StoryLyricLine[] {
  const entries: { ms: number; text: string }[] = [];

  for (const rawLine of syncedLyrics.split("\n")) {
    const match = rawLine.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/);
    if (!match) continue;

    const minutes = parseInt(match[1] ?? "0", 10);
    const seconds = parseInt(match[2] ?? "0", 10);
    const millis = match[3]
      ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10)
      : 0;
    const text = (match[4] ?? "").trim();

    if (!text) continue;

    entries.push({
      ms: minutes * 60_000 + seconds * 1_000 + millis,
      text,
    });
  }

  const lines: StoryLyricLine[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const startMs = entry.ms;
    const nextEntry = entries[i + 1];
    const endMs = nextEntry ? nextEntry.ms : startMs + 4_000;
    lines.push({ startMs, endMs, text: entry.text });
  }

  return lines;
}

function msToAssTime(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toFixed(2)
    .padStart(5, "0")}`;
}

function formatDurationSec(sec = 0): string {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function wrapLine(text: string, maxWords = 6): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    lines.push(words.slice(i, i + maxWords).join(" "));
  }
  return lines.join("\\N");
}

/**
 * Builds the complete ASS subtitle content for 9:16 portrait story videos.
 * Features:
 * - PlayResX: 1080, PlayResY: 1920 (Matching Next.js Canvas 1:1)
 * - Typography with Vazirmatn / Tahoma / Arial fallback for Persian RTL
 * - Dynamic Synced Lyrics inside the Lyrics Box (active line at 810, upcoming at 930)
 * - Permanent card overlays for Title, Artist, Branding, Timestamps
 */
export function buildStoryASSContent(
  lines: StoryLyricLine[],
  song: StorySongMeta,
  clipStartSec: number,
  clipDurationSec: number,
  totalSongSec: number,
  includeCardText = true
): string {
  const fontName = "DejaVu Sans";
  const endTimeStr = msToAssTime((clipDurationSec + 5) * 1000);

  const header = `[Script Info]
Title: Deybalal Story Lyrics
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: StoryActive,${fontName},52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,3,5,80,80,0,1
Style: StoryUpcoming,${fontName},40,&H66FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,2,5,80,80,0,1
Style: CardTitle,${fontName},34,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1.5,1.5,6,40,40,0,1
Style: CardArtist,${fontName},26,&H40FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1.5,6,40,40,0,1
Style: CardBadge,${fontName},30,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1.5,1.5,6,40,40,0,1
Style: CardUrl,${fontName},22,&H33FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.2,1.2,4,40,40,0,1
Style: CardQuote,${fontName},80,&H5994EC,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0,0,6,40,40,0,1
Style: CardTimeLeft,${fontName},26,&H40FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.2,1.2,4,40,40,0,1
Style: CardTimeRight,${fontName},26,&H40FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.2,1.2,6,40,40,0,1
Style: CardWatermark,${fontName},32,&H40FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1.5,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines: string[] = [];

  // Permanent UI Text Overlays
  if (includeCardText) {
    const cleanTitle = (song.title || "آهنگ لری")
      .replace(/\\/g, "")
      .slice(0, 32);
    const cleanArtist = (song.artist || "دی بلال")
      .replace(/\\/g, "")
      .slice(0, 32);
    const startProgressStr = formatDurationSec(clipStartSec);
    const totalDurationStr = formatDurationSec(totalSongSec);

    // Top Header Badge ("دی بلال" & "deybalal.ir")
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardBadge,,0,0,0,,{\\pos(720,156)}دی بلال`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUrl,,0,0,0,,{\\pos(410,157)}deybalal.ir`
    );

    // Mini Song Pill: Title & Artist
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardTitle,,0,0,0,,{\\pos(790,285)}${cleanTitle}`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardArtist,,0,0,0,,{\\pos(790,325)}${cleanArtist}`
    );

    // Pink quotation mark inside the Lyrics Box
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardQuote,,0,0,0,,{\\pos(960,490)}“`
    );

    // Timestamps below Progress Bar
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardTimeLeft,,0,0,0,,{\\pos(170,1378)}${startProgressStr}`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardTimeRight,,0,0,0,,{\\pos(910,1378)}${totalDurationStr}`
    );

    // Footer Branding
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardWatermark,,0,0,0,,{\\pos(540,1600)}@deybalalir`
    );
  }

  // Dynamic Synced Lyrics
  if (lines.length === 0) {
    dialogueLines.push(
      `Dialogue: 1,0:00:00.00,${endTimeStr},StoryActive,,0,0,0,,{\\pos(540,820)}🎵`
    );
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const start = msToAssTime(line.startMs);
      const end = msToAssTime(line.endMs);
      const activeText = wrapLine(line.text);

      // Active line: upper-center of Lyrics Box
      dialogueLines.push(
        `Dialogue: 2,${start},${end},StoryActive,,0,0,0,,{\\pos(540,780)\\fad(220,220)}${activeText}`
      );

      // Upcoming line: below active line
      if (lines[i + 1]) {
        const nextText = wrapLine(lines[i + 1]!.text);
        dialogueLines.push(
          `Dialogue: 1,${start},${end},StoryUpcoming,,0,0,0,,{\\pos(540,900)\\fad(220,220)}${nextText}`
        );
      }
    }
  }

  return header + "\n" + dialogueLines.join("\n") + "\n";
}

/**
 * Generates the ASS file for Story Videos with dynamic synced lyrics.
 */
export async function generateStoryASSFile(
  syncedLyrics: string,
  jobDir: string,
  cropStartMs: number,
  cropEndMs: number,
  song: StorySongMeta
): Promise<string | null> {
  const parsed = parseLRC(syncedLyrics);

  const lines = parsed
    .filter((line) => line.endMs > cropStartMs && line.startMs < cropEndMs)
    .map((line) => ({
      startMs: Math.max(0, line.startMs - cropStartMs),
      endMs: Math.min(cropEndMs - cropStartMs, line.endMs - cropStartMs),
      text: line.text,
    }))
    .filter((line) => line.endMs > line.startMs);

  const clipStartSec = Math.round(cropStartMs / 1000);
  const clipDurationSec = Math.round((cropEndMs - cropStartMs) / 1000);
  const totalSongSec = song.duration && song.duration > 0 ? song.duration : 210;

  const assContent = buildStoryASSContent(
    lines,
    song,
    clipStartSec,
    clipDurationSec,
    totalSongSec,
    true
  );

  const assPath = path.join(jobDir, "lyrics.ass");
  await writeFile(assPath, assContent, "utf-8");

  return assPath;
}
