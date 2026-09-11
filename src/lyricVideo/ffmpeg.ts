import path from "path";
import type { VideoResolution } from "../../types/types";

interface FFmpegResult {
  success: boolean;
  stderr: string;
  exitCode: number;
}

async function runFFmpeg(
  args: string[],
  timeoutMs = 900_000
): Promise<FFmpegResult> {
  const proc = Bun.spawn(["ffmpeg", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    console.error("FFmpeg timed out!");
    proc.kill("SIGKILL");
  }, timeoutMs);

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);

  console.log("FFmpeg exit code:", exitCode);

  return {
    success: exitCode === 0,
    stderr,
    exitCode,
  };
}

export async function cropAudio(
  inputPath: string,
  outputPath: string,
  startMs: number,
  endMs: number
): Promise<void> {
  const startSec = startMs / 1000;
  const durationSec = (endMs - startMs) / 1000;

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
    throw new Error(`FFmpeg cropAudio failed: ${result.stderr.slice(-500)}`);
  }
}

export async function generateThumbnail(
  videoPath: string,
  thumbnailPath: string
): Promise<void> {
  const result = await runFFmpeg([
    "-ss",
    "2",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    thumbnailPath,
  ]);

  if (!result.success) {
    throw new Error(result.stderr.slice(-500));
  }
}

export async function buildSlideshow(
  imagePaths: string[],
  outputPath: string,
  durationMs: number,
  jobDir: string,
  resolution: VideoResolution
): Promise<void> {
  const n = imagePaths.length;
  const crossfadeDuration = 0.5;
  const totalDurationSec = durationMs / 1000;
  const clipDurationSec = totalDurationSec / n;
  const clipDurationFrames = Math.ceil(clipDurationSec * 30);
  const totalFrames = Math.ceil(totalDurationSec * 30);

  const width = resolution === "big" ? 1920 : 1080;
  const height = resolution === "big" ? 1080 : 1920;

  const inputs: string[] = [];
  for (const img of imagePaths) {
    inputs.push("-loop", "1", "-t", clipDurationSec.toFixed(3), "-i", img);
  }

  if (n === 1) {
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const result = await runFFmpeg([
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      totalDurationSec.toFixed(3),
      "-i",
      imagePaths[0]!,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outputPath,
    ]);

    if (!result.success) {
      throw new Error(`FFmpeg slideshow failed: ${result.stderr.slice(-500)}`);
    }
    return;
  }

  const slideFilters: string[] = [];
  for (let i = 0; i < n; i++) {
    slideFilters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v${i}]`
    );
  }

  const xfadeTransitions = [
    "fade",
    "fadeblack",
    "fadewhite",
    "slideleft",
    "slideright",
    "smoothleft",
    "smoothright",
    "circlecrop",
  ];

  let currentLabel = "[v0]";
  let accumulatedDuration = clipDurationSec;

  for (let i = 0; i < n - 1; i++) {
    const nextLabel = `[v${i + 1}]`;
    const outputLabel = i === n - 2 ? "[vout]" : `[xf${i}]`;
    const offset = (
      (i + 1) * clipDurationSec -
      (i + 1) * crossfadeDuration
    ).toFixed(3);
    const transition = xfadeTransitions[i % xfadeTransitions.length];

    const xfadeFilter =
      `${currentLabel}${nextLabel}xfade=transition=${transition}:` +
      `duration=${crossfadeDuration}:offset=${offset}${outputLabel}`;

    slideFilters.push(xfadeFilter);
    currentLabel = outputLabel;
    accumulatedDuration =
      accumulatedDuration + clipDurationSec - crossfadeDuration;
  }

  const filterComplex = slideFilters.join(";\n");
  const result = await runFFmpeg([
    ...inputs,
    "-filter_complex",
    filterComplex,
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
    console.log("Exit Code: ", result.exitCode);
    throw new Error(`FFmpeg slideshow failed: ${result.stderr.slice(-500)}`);
  }
}

export async function renderFinal(
  slideshowPath: string,
  audioPath: string,
  outputPath: string,
  assPath?: string | null,
  resolution: VideoResolution = "big"
): Promise<void> {
  const width = resolution === "big" ? 1920 : 1080;
  const height = resolution === "big" ? 1080 : 1920;

  let videoFilters: string[] = [];

  videoFilters.push(`scale=${width}:${height}`);

  if (assPath) {
    videoFilters.push(
      `ass='${assPath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`
    );
  }

  const filter = videoFilters.join(",");

  const args: string[] = ["-i", slideshowPath, "-i", audioPath];

  if (filter) {
    args.push("-vf", filter);
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
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  );

  const result = await runFFmpeg(args, 600_000_0);

  if (!result.success) {
    throw new Error(`FFmpeg renderFinal failed: ${result.stderr.slice(-500)}`);
  }
}
