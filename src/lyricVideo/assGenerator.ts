import { writeFile } from "fs/promises";
import path from "path";

interface LyricLine {
  startMs: number;
  endMs: number;
  text: string;
}

function parseLRC(syncedLyrics: string): LyricLine[] {
  const lines: LyricLine[] = [];
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
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toFixed(2)
    .padStart(5, "0")}`;
}

function wrapTextForStory(text: string, maxWordsPerLine = 6): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWordsPerLine) return text;
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine).join(" "));
  }
  return lines.join("\\N");
}

function buildASSContent(
  lines: LyricLine[],
  resolution: "big" | "small" = "small"
): string {
  const isPortrait = resolution === "small";
  const resX = isPortrait ? 1080 : 1920;
  const resY = isPortrait ? 1920 : 1080;

  const fontFamily = "Vazirmatn, Tahoma, Arial, DejaVu Sans, sans-serif";

  const header = `[Script Info]
Title: Deybalal Story Lyrics
ScriptType: v4.00+
PlayResX: ${resX}
PlayResY: ${resY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: StoryActive,${fontFamily},${
    isPortrait ? 50 : 54
  },&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,3,5,80,80,0,1
Style: StoryUpcoming,${fontFamily},${
    isPortrait ? 38 : 40
  },&H66FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,2,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = msToAssTime(line.startMs);
    const end = msToAssTime(line.endMs);
    const activeText = wrapTextForStory(line.text);

    if (isPortrait) {
      // Active line placed in upper-middle of Lyrics Box (center: X=540, Y=810)
      dialogueLines.push(
        `Dialogue: 1,${start},${end},StoryActive,,0,0,0,,{\\an5\\pos(540,810)\\fad(220,220)}${activeText}`
      );

      // Upcoming next line placed below active line (center: X=540, Y=930)
      if (lines[i + 1]) {
        const nextText = wrapTextForStory(lines[i + 1]!.text);
        dialogueLines.push(
          `Dialogue: 0,${start},${end},StoryUpcoming,,0,0,0,,{\\an5\\pos(540,930)\\fad(220,220)}${nextText}`
        );
      }
    } else {
      // Landscape lyrics placement
      dialogueLines.push(
        `Dialogue: 1,${start},${end},StoryActive,,0,0,0,,{\\an5\\pos(1340,510)\\fad(220,220)}${activeText}`
      );
      if (lines[i + 1]) {
        const nextText = wrapTextForStory(lines[i + 1]!.text);
        dialogueLines.push(
          `Dialogue: 0,${start},${end},StoryUpcoming,,0,0,0,,{\\an5\\pos(1340,620)\\fad(220,220)}${nextText}`
        );
      }
    }
  }

  return header + "\n" + dialogueLines.join("\n") + "\n";
}

export async function generateASSFile(
  syncedLyrics: string,
  jobDir: string,
  cropStartMs = 0,
  cropEndMs?: number,
  resolution: "big" | "small" = "small"
): Promise<string | null> {
  const parsed = parseLRC(syncedLyrics);

  const lines = parsed
    .filter((line) => {
      if (cropEndMs == null) {
        return line.endMs > cropStartMs;
      }

      return line.endMs > cropStartMs && line.startMs < cropEndMs;
    })
    .map((line) => ({
      startMs: Math.max(0, line.startMs - cropStartMs),
      endMs:
        cropEndMs != null
          ? Math.min(cropEndMs - cropStartMs, line.endMs - cropStartMs)
          : line.endMs - cropStartMs,
      text: line.text,
    }))
    .filter((line) => line.endMs > line.startMs);

  if (lines.length === 0) {
    return null;
  }

  const assContent = buildASSContent(lines, resolution);
  const assPath = path.join(jobDir, "lyrics.ass");
  await writeFile(assPath, assContent, "utf-8");

  return assPath;
}
