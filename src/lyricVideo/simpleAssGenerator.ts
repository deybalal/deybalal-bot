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

/**
 * Builds ASS file content for plain lyrics, evenly distributed across the duration.
 */
function buildSimpleASSContent(
  entries: SimpleLyricEntry[],
  resolution: "big" | "small" = "small"
): string {
  const isPortrait = resolution === "small";
  const playResX = isPortrait ? 1080 : 1920;
  const playResY = isPortrait ? 1920 : 1080;
  const fontSize = isPortrait ? 46 : 52;
  const fontFamily = "Vazirmatn, Tahoma, Arial, DejaVu Sans, sans-serif";

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

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines = entries.map((entry) => {
    const start = msToAssTime(entry.startMs);
    const end = msToAssTime(entry.endMs);
    const text = entry.text.replace(/\n/g, "\\N");
    const pos = isPortrait ? "\\an5\\pos(540,850)" : "\\an5\\pos(1340,540)";
    return `Dialogue: 0,${start},${end},StorySimple,,0,0,0,,{${pos}\\fad(250,250)}${text}`;
  });

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
  resolution: "big" | "small" = "small"
): Promise<string | null> {
  if (!plainLyrics || !plainLyrics.trim()) {
    return null;
  }

  const rawLines = plainLyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return null;
  }

  const clipDurationMs = cropEndMs - cropStartMs;
  if (clipDurationMs <= 0) {
    return null;
  }

  // Chunk lines into groups of 1 to 2 lines per subtitle screen
  const chunks: string[] = [];
  for (let i = 0; i < rawLines.length; i += 2) {
    if (i + 1 < rawLines.length) {
      chunks.push(`${rawLines[i]}\n${rawLines[i + 1]}`);
    } else {
      chunks.push(rawLines[i]!);
    }
  }

  // Minimum duration per chunk is 3 seconds, maximum is 6 seconds
  const idealCount = Math.max(1, Math.round(clipDurationMs / 4000));
  const selectedChunks =
    chunks.length <= idealCount ? chunks : chunks.slice(0, idealCount);

  const chunkDurationMs = clipDurationMs / selectedChunks.length;
  const entries: SimpleLyricEntry[] = selectedChunks.map((text, idx) => ({
    startMs: Math.round(idx * chunkDurationMs),
    endMs: Math.round((idx + 1) * chunkDurationMs),
    text,
  }));

  const assContent = buildSimpleASSContent(entries, resolution);
  const assPath = path.join(jobDir, "lyrics.ass");
  await writeFile(assPath, assContent, "utf-8");

  return assPath;
}
