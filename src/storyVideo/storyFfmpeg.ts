import path from "path";
import { stat } from "fs/promises";

export interface FFmpegRunResult {
  success: boolean;
  stderr: string;
  exitCode: number;
}

/**
 * Executes an FFmpeg command supporting both Bun and Node.js runtimes.
 */
export async function runFFmpeg(
  args: string[],
  timeoutMs = 120_000
): Promise<FFmpegRunResult> {
  const fullArgs = ["-y", ...args];

  try {
    if (typeof (globalThis as any).Bun !== "undefined") {
      const proc = (globalThis as any).Bun.spawn(["ffmpeg", ...fullArgs], {
        stdout: "pipe",
        stderr: "pipe",
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeoutMs);

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      clearTimeout(timer);

      if (timedOut) {
        return { success: false, stderr: "FFmpeg process timed out", exitCode: -1 };
      }

      return {
        success: exitCode === 0,
        stderr,
        exitCode,
      };
    } else {
      const { spawn } = await import("child_process");
      return new Promise<FFmpegRunResult>((resolve) => {
        const proc = spawn("ffmpeg", fullArgs);
        let stderr = "";

        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve({ success: false, stderr: "FFmpeg timed out", exitCode: -1 });
        }, timeoutMs);

        proc.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            success: code === 0,
            stderr,
            exitCode: code ?? 1,
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            stderr: err.message,
            exitCode: 1,
          });
        });
      });
    }
  } catch (err) {
    return {
      success: false,
      stderr: (err as Error).message || "Unknown error",
      exitCode: 1,
    };
  }
}

/**
 * Accurately crops an audio file with fast-seeking and forces presentation timestamp (PTS)
 * to 0.000s, preventing audio offset/silence issues in Telegram.
 */
export async function cropStoryAudio(
  inputPath: string,
  outputPath: string,
  startMs: number,
  endMs: number
): Promise<void> {
  const startSec = Math.max(0, startMs / 1000);
  const durationSec = Math.max(1, (endMs - startMs) / 1000);

  const result = await runFFmpeg([
    "-ss",
    startSec.toFixed(3),
    "-t",
    durationSec.toFixed(3),
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-af",
    "aresample=async=1:first_pts=0",
    outputPath,
  ]);

  if (!result.success) {
    throw new Error(`FFmpeg cropStoryAudio failed: ${result.stderr.slice(-400)}`);
  }
}

/**
 * Renders the final 1080x1920 Story Video in a single ultra-fast pass (~2-3 seconds).
 * Uses -movflags +faststart and -af aresample for instant Telegram playback from 0:00.
 */
export async function renderStoryVideo(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  assPath: string | null,
  durationSec: number,
  resolution: "big" | "small" = "small"
): Promise<void> {
  const width = resolution === "big" ? 1920 : 1080;
  const height = resolution === "big" ? 1080 : 1920;

  const filters: string[] = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
  ];

  if (assPath) {
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    filters.push(`ass='${escapedAss}'`);
  }

  const filterStr = filters.join(",");

  const args: string[] = [
    "-loop",
    "1",
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-vf",
    filterStr,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-af",
    "aresample=async=1:first_pts=0",
    "-t",
    durationSec.toFixed(3),
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const result = await runFFmpeg(args, 180_000);

  if (!result.success) {
    throw new Error(`FFmpeg renderStoryVideo failed: ${result.stderr.slice(-500)}`);
  }
}

/**
 * Extracts a thumbnail image from the rendered story video.
 */
export async function generateStoryThumbnail(
  videoPath: string,
  thumbnailPath: string
): Promise<void> {
  const result = await runFFmpeg([
    "-ss",
    "0.5",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    thumbnailPath,
  ]);

  if (!result.success) {
    console.warn("Could not generate story thumbnail:", result.stderr);
  }
}

/**
 * Builds a fast slideshow for multiple custom photos (without the heavy zoompan filter).
 */
export async function buildStorySlideshow(
  imagePaths: string[],
  outputPath: string,
  durationMs: number,
  resolution: "big" | "small" = "small"
): Promise<void> {
  const n = imagePaths.length;
  const totalDurationSec = durationMs / 1000;
  const clipDurationSec = totalDurationSec / n;
  const width = resolution === "big" ? 1920 : 1080;
  const height = resolution === "big" ? 1080 : 1920;

  if (n === 1) {
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const result = await runFFmpeg([
      "-loop",
      "1",
      "-t",
      totalDurationSec.toFixed(3),
      "-i",
      imagePaths[0]!,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outputPath,
    ]);
    if (!result.success) {
      throw new Error(`FFmpeg buildStorySlideshow failed: ${result.stderr.slice(-400)}`);
    }
    return;
  }

  // Multi-image xfade
  const inputs: string[] = [];
  for (const img of imagePaths) {
    inputs.push("-loop", "1", "-t", clipDurationSec.toFixed(3), "-i", img);
  }

  const slideFilters: string[] = [];
  for (let i = 0; i < n; i++) {
    slideFilters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v${i}]`
    );
  }

  const crossfadeDuration = Math.min(0.5, clipDurationSec / 2);
  let currentLabel = "[v0]";
  for (let i = 0; i < n - 1; i++) {
    const nextLabel = `[v${i + 1}]`;
    const outputLabel = i === n - 2 ? "[vout]" : `[xf${i}]`;
    const offset = Math.max(0, (i + 1) * clipDurationSec - (i + 1) * crossfadeDuration).toFixed(3);
    slideFilters.push(
      `${currentLabel}${nextLabel}xfade=transition=fade:duration=${crossfadeDuration}:offset=${offset}${outputLabel}`
    );
    currentLabel = outputLabel;
  }

  const result = await runFFmpeg([
    ...inputs,
    "-filter_complex",
    slideFilters.join(";\n"),
    "-map",
    "[vout]",
    "-t",
    totalDurationSec.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath,
  ]);

  if (!result.success) {
    throw new Error(`FFmpeg buildStorySlideshow failed: ${result.stderr.slice(-400)}`);
  }
}

/**
 * Combines slideshow video + cropped audio + subtitles into final MP4 for multi-image stories.
 */
export async function renderFinalStory(
  slideshowPath: string,
  audioPath: string,
  outputPath: string,
  assPath: string | null,
  durationSec: number
): Promise<void> {
  const videoFilters: string[] = [];
  if (assPath) {
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    videoFilters.push(`ass='${escapedAss}'`);
  }

  const args: string[] = ["-i", slideshowPath, "-i", audioPath];
  if (videoFilters.length > 0) {
    args.push("-vf", videoFilters.join(","));
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-af",
    "aresample=async=1:first_pts=0",
    "-t",
    durationSec.toFixed(3),
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  );

  const result = await runFFmpeg(args, 180_000);
  if (!result.success) {
    throw new Error(`FFmpeg renderFinalStory failed: ${result.stderr.slice(-500)}`);
  }
}
