import { writeFile } from "fs/promises";
import path from "path";

interface SimpleLyricEntry {
  startMs: number;
  endMs: number;
  text: string;
}

function msToAssTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toFixed(2)
    .padStart(5, "0")}`;
}

export interface SimpleSongMeta {
  title: string;
  artist: string;
  duration?: number;
}

function formatDurationSec(sec = 0): string {
  if (!sec || sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Builds ASS file content for plain lyrics, evenly distributed across the duration.
 */
function buildSimpleASSContent(
  entries: SimpleLyricEntry[],
  resolution: "big" | "small" = "small",
  song?: SimpleSongMeta,
  clipStartSec = 0,
  clipDurationSec = 15
): string {
  const isPortrait = resolution === "small";
  const playResX = isPortrait ? 1080 : 1920;
  const playResY = isPortrait ? 1920 : 1080;
  const fontSize = isPortrait ? 46 : 52;
  const fontFamily = "Vazirmatn, Tahoma, Arial, DejaVu Sans, sans-serif";
  const endTimeStr = msToAssTime((clipDurationSec + 5) * 1000);

  const header = `[Script Info]
Title: Story Lyric Video - Simple Lyrics
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: StorySimple,${fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,3,5,80,80,0,1
Style: CardUi,${fontFamily},32,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1.5,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines: string[] = [];

  // Permanent UI Text Overlays
  if (song && isPortrait) {
    const cleanTitle = (song.title || "آهنگ لری")
      .replace(/\\/g, "")
      .slice(0, 25);
    const cleanArtist = (song.artist || "دی بلال")
      .replace(/\\/g, "")
      .slice(0, 30);
    const startProgressStr = formatDurationSec(clipStartSec);
    const totalDurationStr = formatDurationSec(song.duration || 210);

    // Top Header Badge
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an6\\pos(720,156)\\fs30\\b1}دی بلال`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an4\\pos(410,157)\\fs22\\c&HCCFFFFFF&}deybalal.ir`
    );

    // Mini Song Pill: Title & Artist
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an6\\pos(790,285)\\fs34\\b1}${cleanTitle}`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an6\\pos(790,325)\\fs26\\c&HBFFFFFFF&}${cleanArtist}`
    );

    // Pink quotation mark inside the Lyrics Box
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an6\\pos(960,490)\\fnGeorgia\\fs85\\i1\\c&H5994EC&}“`
    );

    // Timestamps below Progress Bar
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an4\\pos(170,1378)\\fnmonospace\\fs26\\c&HBBFFFFFF&}${startProgressStr}`
    );
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an6\\pos(910,1378)\\fnmonospace\\fs26\\c&HBBFFFFFF&}${totalDurationStr}`
    );

    // Footer Branding
    dialogueLines.push(
      `Dialogue: 0,0:00:00.00,${endTimeStr},CardUi,,0,0,0,,{\\an5\\pos(540,1600)\\fs32\\c&HB0FFFFFF&}@deybalalir`
    );
  }

  for (const entry of entries) {
    const start = msToAssTime(entry.startMs);
    const end = msToAssTime(entry.endMs);
    const text = entry.text.replace(/\n/g, "\\N");
    const pos = isPortrait ? "\\an5\\pos(540,850)" : "\\an5\\pos(1340,540)";
    dialogueLines.push(
      `Dialogue: 1,${start},${end},StorySimple,,0,0,0,,{${pos}\\fad(250,250)}${text}`
    );
  }

  return header + "\n" + dialogueLines.join("\n") + "\n";
}

/**
 * Generates an ASS subtitle file for simple (plain text) lyrics.
 * Distributes lyrics lines evenly across the clipped time window (startMs to endMs).
 */
export async function generateSimpleASSFile(
  plainLyrics: string,
  jobDir: string,
  cropStartMs: number,
  cropEndMs: number,
  resolution: "big" | "small" = "small",
  song?: SimpleSongMeta
): Promise<string | null> {
  const clipDurationMs = cropEndMs - cropStartMs;
  if (clipDurationMs <= 0) {
    return null;
  }

  const rawLines = (plainLyrics || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const chunks: string[] = [];
  if (rawLines.length > 0) {
    for (let i = 0; i < rawLines.length; i += 2) {
      if (i + 1 < rawLines.length) {
        chunks.push(`${rawLines[i]}\n${rawLines[i + 1]}`);
      } else {
        chunks.push(rawLines[i]!);
      }
    }
  }

  const idealCount = Math.max(1, Math.round(clipDurationMs / 4000));
  const selectedChunks =
    chunks.length <= idealCount ? chunks : chunks.slice(0, idealCount);

  const entries: SimpleLyricEntry[] =
    selectedChunks.length > 0
      ? selectedChunks.map((text, idx) => {
          const chunkDurationMs = clipDurationMs / selectedChunks.length;
          return {
            startMs: Math.round(idx * chunkDurationMs),
            endMs: Math.round((idx + 1) * chunkDurationMs),
            text,
          };
        })
      : [];

  const clipStartSec = Math.round(cropStartMs / 1000);
  const clipDurationSec = Math.round(clipDurationMs / 1000);

  const assContent = buildSimpleASSContent(
    entries,
    resolution,
    song,
    clipStartSec,
    clipDurationSec
  );
  const assPath = path.join(jobDir, "lyrics.ass");
  await writeFile(assPath, assContent, "utf-8");

  return assPath;
}
