import path from "path";
import { mkdir, writeFile, copyFile, stat } from "fs/promises";

interface SongData {
  id: string;
  title: string;
  artist: string;
  coverArt?: string | null;
  telegramCoverId?: string;
  telegramFileId?: string;
  coverTelegramId?: string;
}

/**
 * Runs FFmpeg safely in either Bun or Node.js environment
 */
export async function runFFmpegCmd(args: string[]): Promise<boolean> {
  try {
    if (typeof (globalThis as any).Bun !== "undefined") {
      const proc = (globalThis as any).Bun.spawn(["ffmpeg", "-y", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } else {
      const { spawn } = await import("child_process");
      return new Promise<boolean>((resolve) => {
        const proc = spawn("ffmpeg", ["-y", ...args]);
        proc.on("close", (code) => resolve(code === 0));
        proc.on("error", () => resolve(false));
      });
    }
  } catch (err) {
    console.error("FFmpeg execution error in storyCanvasGenerator:", err);
    return false;
  }
}

/**
 * Attempts to retrieve or download the raw cover image for the song.
 */
async function obtainRawCover(
  song: SongData,
  tempCoverPath: string,
  botInstance?: any,
  downloadTelegramFile?: (
    api: any,
    fileId: string,
    dest: string
  ) => Promise<any>
): Promise<boolean> {
  // 1. Try Telegram file ID
  const telegramId =
    song.telegramCoverId || song.telegramFileId || song.coverTelegramId;
  if (telegramId && botInstance && downloadTelegramFile) {
    try {
      await downloadTelegramFile(botInstance.api, telegramId, tempCoverPath);
      const s = await stat(tempCoverPath);
      if (s.isFile() && s.size > 0) return true;
    } catch (e) {
      console.warn("Could not download telegram cover:", e);
    }
  }

  // 2. Try web URL
  if (
    typeof song.coverArt === "string" &&
    (song.coverArt.startsWith("http://") ||
      song.coverArt.startsWith("https://"))
  ) {
    try {
      const resp = await fetch(song.coverArt);
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        await writeFile(tempCoverPath, Buffer.from(buffer));
        const s = await stat(tempCoverPath);
        if (s.isFile() && s.size > 0) return true;
      }
    } catch (e) {
      console.warn("Could not fetch web cover art:", e);
    }
  }

  // 3. Try local file paths on disk
  if (typeof song.coverArt === "string") {
    const candidatePaths = [
      song.coverArt,
      path.join(process.cwd(), song.coverArt),
      path.join(process.cwd(), "public", song.coverArt),
      path.join(process.cwd(), "public", "assets", "cover", song.coverArt),
      path.join(process.cwd(), "public", "uploads", song.coverArt),
      path.join(process.cwd(), "..", "public", song.coverArt),
    ];
    for (const cand of candidatePaths) {
      try {
        const s = await stat(cand);
        if (s.isFile() && s.size > 0) {
          await copyFile(cand, tempCoverPath);
          return true;
        }
      } catch {}
    }
  }

  // 4. Try default cover image
  const defaultCandidates = [
    path.join(process.cwd(), "public", "assets", "default-cover.jpg"),
    path.join(process.cwd(), "..", "public", "assets", "default-cover.jpg"),
  ];
  for (const cand of defaultCandidates) {
    try {
      const s = await stat(cand);
      if (s.isFile() && s.size > 0) {
        await copyFile(cand, tempCoverPath);
        return true;
      }
    } catch {}
  }

  return false;
}

/**
 * Generates the Canvas Card directly inside the Telegram Bot!
 * Replicates the Next.js Story Card styling:
 * - Ambient blurred cover background with dark overlay scrim
 * - Centered cover artwork card with rounded border
 * - Top soundwave badge
 * - Progress bar track
 * - Persian title and artist text
 * - Watermark branding (@deybalalir)
 */
function formatDurationSec(seconds = 0): string {
  if (!seconds || seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function drawRoundedRectPath(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }
  ctx.closePath();
}

/**
 * Generates the Canvas Card directly inside the Telegram Bot!
 * Replicates the Next.js Story Card styling (from lib/storyCanvas.ts):
 * - Ambient blurred cover background with dark overlay scrim
 * - Top header frosted pill badge with equalizer soundwave bars and Deybalal branding
 * - Mini Album & Song Pill (cover thumbnail, Persian song title & artist)
 * - Prominent Lyrics Box container with frosted border and quotation mark
 * - Full simulated music player controls (progress bar, timestamps, play/prev/next/heart buttons)
 * - Bottom @deybalalir watermark
 */
export async function createStoryCardInBot(
  song: SongData,
  jobDir: string,
  resolution: "big" | "small" = "small",
  botInstance?: any,
  downloadTelegramFile?: (
    api: any,
    fileId: string,
    dest: string
  ) => Promise<any>,
  clipStartSec = 0,
  clipEndSec = 15
): Promise<string> {
  const imagesDir = path.join(jobDir, "images");
  await mkdir(imagesDir, { recursive: true });
  const outputImagePath = path.join(imagesDir, "image_0.jpg");

  const isPortrait = resolution === "small";
  const width = isPortrait ? 1080 : 1920;
  const height = isPortrait ? 1920 : 1080;

  // Retrieve raw cover image if available
  const rawCoverPath = path.join(imagesDir, "raw_cover.jpg");
  const hasCover = await obtainRawCover(
    song,
    rawCoverPath,
    botInstance,
    downloadTelegramFile
  );

  const totalDuration =
    (song as any).duration && (song as any).duration > 0
      ? (song as any).duration
      : 210;
  const currentProgress = Math.max(0, Math.min(clipStartSec, totalDuration));
  const progressRatio =
    totalDuration > 0
      ? Math.max(0.04, Math.min(0.96, currentProgress / totalDuration))
      : 0.38;

  // 1. Check if Node Canvas / @napi-rs/canvas is installed in the bot project
  try {
    let canvasPkg: any = null;
    try {
      canvasPkg = require("@napi-rs/canvas");
    } catch {
      try {
        canvasPkg = require("canvas");
      } catch {}
    }

    if (canvasPkg?.createCanvas) {
      const canvas = canvasPkg.createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Load cover image into canvas if available
      let coverImage: any = null;
      if (hasCover && canvasPkg.loadImage) {
        try {
          coverImage = await canvasPkg.loadImage(rawCoverPath);
        } catch {}
      }

      // --- 1. Ambient Background ---
      ctx.save();
      if (coverImage) {
        try {
          if (ctx.filter !== undefined) {
            ctx.filter = "blur(75px) brightness(0.65) saturate(1.4)";
          }
          ctx.drawImage(coverImage, -150, -150, width + 300, height + 300);
          if (ctx.filter !== undefined) ctx.filter = "none";
        } catch {
          ctx.drawImage(coverImage, 0, 0, width, height);
        }
      } else {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, "#1e1b4b");
        bgGrad.addColorStop(0.5, "#0f172a");
        bgGrad.addColorStop(1, "#020617");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Gradient scrim overlay
      const overlayGrad = ctx.createLinearGradient(0, 0, 0, height);
      overlayGrad.addColorStop(0, "rgba(8, 10, 15, 0.85)");
      overlayGrad.addColorStop(0.4, "rgba(8, 10, 15, 0.70)");
      overlayGrad.addColorStop(0.7, "rgba(8, 10, 15, 0.85)");
      overlayGrad.addColorStop(1, "rgba(5, 6, 10, 0.98)");
      ctx.fillStyle = overlayGrad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // --- 2. Header: Deybalal Top Badge ---
      ctx.save();
      const badgeW = 440;
      const badgeH = 72;
      const badgeX = (width - badgeW) / 2;
      const headerY = isPortrait ? 120 : 60;

      drawRoundedRectPath(ctx, badgeX, headerY, badgeW, badgeH, 36);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 6 pink soundwave equalizer bars
      const waveStartX = badgeX + 36;
      const waveCenterY = headerY + 36;
      ctx.fillStyle = "#ec4899";
      const waveHeights = [16, 28, 38, 22, 32, 18];
      waveHeights.forEach((h, i) => {
        drawRoundedRectPath(
          ctx,
          waveStartX + i * 9,
          waveCenterY - h / 2,
          5,
          h,
          2.5
        );
        ctx.fill();
      });

      // Badge Text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px Vazirmatn, Tahoma, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("دی بلال", badgeX + badgeW - 36, headerY + 36);

      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.font = "normal 22px Vazirmatn, Tahoma, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("deybalal.ir", waveStartX + 66, headerY + 37);
      ctx.restore();

      if (isPortrait) {
        // --- 3. Mini Album & Song Pill ---
        ctx.save();
        const miniY = 240;
        const miniW = 740;
        const miniH = 110;
        const miniX = (width - miniW) / 2;

        drawRoundedRectPath(ctx, miniX, miniY, miniW, miniH, 28);
        ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Mini cover thumbnail
        const thumbSize = 86;
        const thumbX = miniX + miniW - thumbSize - 12;
        const thumbY = miniY + 12;
        if (coverImage) {
          ctx.save();
          drawRoundedRectPath(ctx, thumbX, thumbY, thumbSize, thumbSize, 18);
          ctx.clip();
          ctx.drawImage(coverImage, thumbX, thumbY, thumbSize, thumbSize);
          ctx.restore();
        } else {
          drawRoundedRectPath(ctx, thumbX, thumbY, thumbSize, thumbSize, 18);
          ctx.fillStyle = "#ec4899";
          ctx.fill();
        }

        // Mini title & artist
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 34px Vazirmatn, Tahoma, Arial, sans-serif";
        const cleanTitle = (song.title || "آهنگ لری").slice(0, 25);
        ctx.fillText(cleanTitle, thumbX - 20, miniY + 44);

        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.font = "normal 26px Vazirmatn, Tahoma, Arial, sans-serif";
        const cleanArtist = (song.artist || "دی بلال").slice(0, 30);
        ctx.fillText(cleanArtist, thumbX - 20, miniY + 82);
        ctx.restore();

        // --- 4. Prominent Lyrics Box (dynamic lyrics render here via ASS) ---
        ctx.save();
        const lyricsBoxY = 400;
        const lyricsBoxW = 920;
        const lyricsBoxH = 900;
        const lyricsBoxX = (width - lyricsBoxW) / 2;

        drawRoundedRectPath(
          ctx,
          lyricsBoxX,
          lyricsBoxY,
          lyricsBoxW,
          lyricsBoxH,
          36
        );
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pink quotation mark at top-right of the box
        ctx.font = "italic 85px Georgia, serif";
        ctx.fillStyle = "rgba(236, 72, 153, 0.35)";
        ctx.textAlign = "right";
        ctx.fillText("“", lyricsBoxX + lyricsBoxW - 40, lyricsBoxY + 90);
        ctx.restore();

        // --- 5. Player Controls & Progress Bar ---
        ctx.save();
        const barWidth = 740;
        const barHeight = 8;
        const barX = (width - barWidth) / 2;
        const barY = 1340;

        // Track background
        drawRoundedRectPath(ctx, barX, barY, barWidth, barHeight, 4);
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fill();

        // Active progress fill
        const progressWidth = Math.round(barWidth * progressRatio);
        const progGrad = ctx.createLinearGradient(
          barX,
          barY,
          barX + progressWidth,
          barY
        );
        progGrad.addColorStop(0, "#ec4899");
        progGrad.addColorStop(1, "#a855f7");
        drawRoundedRectPath(ctx, barX, barY, progressWidth, barHeight, 4);
        ctx.fillStyle = progGrad;
        ctx.fill();

        // Thumb handle circle
        ctx.beginPath();
        ctx.arc(barX + progressWidth, barY + barHeight / 2, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Timestamps
        ctx.font = "bold 26px monospace, sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.textAlign = "left";
        ctx.fillText(formatDurationSec(currentProgress), barX, barY + 38);

        ctx.textAlign = "right";
        ctx.fillText(
          formatDurationSec(totalDuration),
          barX + barWidth,
          barY + 38
        );

        // Player Buttons (Prev, Play Circle, Next, Heart)
        const btnY = barY + 95;
        const centerX = width / 2;

        // Big Play Circle Button
        ctx.beginPath();
        ctx.arc(centerX, btnY, 44, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Play triangle icon
        ctx.beginPath();
        ctx.moveTo(centerX - 8, btnY - 16);
        ctx.lineTo(centerX + 16, btnY);
        ctx.lineTo(centerX - 8, btnY + 16);
        ctx.closePath();
        ctx.fillStyle = "#0c0d12";
        ctx.fill();

        // Next Button (Right)
        const nextX = centerX + 110;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(nextX - 10, btnY - 14);
        ctx.lineTo(nextX + 6, btnY);
        ctx.lineTo(nextX - 10, btnY + 14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nextX + 10, btnY - 14);
        ctx.lineTo(nextX + 10, btnY + 14);
        ctx.stroke();

        // Prev Button (Left)
        const prevX = centerX - 110;
        ctx.beginPath();
        ctx.moveTo(prevX + 10, btnY - 14);
        ctx.lineTo(prevX - 6, btnY);
        ctx.lineTo(prevX + 10, btnY + 14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(prevX - 10, btnY - 14);
        ctx.lineTo(prevX - 10, btnY + 14);
        ctx.stroke();

        // Heart Icon on far right
        const heartX = barX + barWidth - 10;
        ctx.fillStyle = "#ec4899";
        ctx.beginPath();
        ctx.arc(heartX - 6, btnY - 6, 7, Math.PI, 0, false);
        ctx.arc(heartX + 6, btnY - 6, 7, Math.PI, 0, false);
        ctx.lineTo(heartX, btnY + 12);
        ctx.closePath();
        ctx.fill();

        // Footer Branding
        ctx.font = "normal 32px Vazirmatn, Tahoma, Arial, sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.textAlign = "center";
        ctx.fillText("@deybalalir", width / 2, 1600);
        ctx.restore();
      }

      const buffer = canvas.toBuffer
        ? canvas.toBuffer("image/jpeg")
        : await canvas.encode("jpeg");
      await writeFile(outputImagePath, buffer);
      return outputImagePath;
    }
  } catch (err) {
    console.warn(
      "Canvas 2D rendering skipped, falling back to FFmpeg compositor:",
      err
    );
  }

  // --- 2. FFmpeg Filter Compositor Fallback ---
  // If @napi-rs/canvas is not installed, compose the exact visual layout with FFmpeg filters
  const barWidth = isPortrait ? 740 : 840;
  const progressWidth = Math.round(barWidth * progressRatio);

  let filterComplex = "";
  const inputArgs: string[] = [];

  if (hasCover) {
    inputArgs.push("-i", rawCoverPath);
    if (isPortrait) {
      filterComplex =
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=50:5,eq=brightness=-0.35:saturation=1.35[bg];` +
        `[0:v]scale=86:86:force_original_aspect_ratio=increase,crop=86:86[thumb];` +
        `[bg]drawbox=x=320:y=120:w=440:h=72:color=white@0.12:t=fill,` +
        `drawbox=x=170:y=240:w=740:h=110:color=white@0.09:t=fill,` +
        `drawbox=x=80:y=400:w=920:h=900:color=white@0.06:t=fill,` +
        `drawbox=x=80:y=400:w=920:h=900:color=white@0.16:t=2,` +
        `drawbox=x=170:y=1340:w=740:h=8:color=white@0.22:t=fill,` +
        `drawbox=x=170:y=1340:w=${progressWidth}:h=8:color=0xec4899@0.9:t=fill[base];` +
        `[base][thumb]overlay=812:252[out]`;
    } else {
      filterComplex =
        `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=50:5,eq=brightness=-0.35:saturation=1.35[bg];` +
        `[0:v]scale=680:680:force_original_aspect_ratio=increase,crop=680:680,pad=700:700:(ow-iw)/2:(oh-ih)/2:color=white@0.25[card];` +
        `[bg][card]overlay=150:(H-h)/2[base];` +
        `[base]drawbox=x=920:y=600:w=840:h=8:color=white@0.22:t=fill,` +
        `drawbox=x=920:y=600:w=${progressWidth}:h=8:color=0xec4899@0.9:t=fill[out]`;
    }
  } else {
    inputArgs.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0f172a:s=${width}x${height}:d=1`
    );
    filterComplex =
      `[0:v]drawbox=x=320:y=120:w=440:h=72:color=white@0.12:t=fill,` +
      `drawbox=x=170:y=240:w=740:h=110:color=white@0.09:t=fill,` +
      `drawbox=x=80:y=400:w=920:h=900:color=white@0.06:t=fill,` +
      `drawbox=x=80:y=400:w=920:h=900:color=white@0.16:t=2,` +
      `drawbox=x=170:y=1340:w=740:h=8:color=white@0.22:t=fill,` +
      `drawbox=x=170:y=1340:w=${progressWidth}:h=8:color=0xec4899@0.9:t=fill[out]`;
  }

  const success = await runFFmpegCmd([
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    outputImagePath,
  ]);

  if (success) {
    try {
      const s = await stat(outputImagePath);
      if (s.isFile() && s.size > 0) return outputImagePath;
    } catch {}
  }

  // Final fallback
  const minimalJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64"
  );
  await writeFile(outputImagePath, minimalJpeg);
  return outputImagePath;
}
