import { InlineKeyboard, type Context } from "grammy";
import type { TelegramSongWithFiles } from "../types/types";
import { formatDuration } from "./formatDuration";
import { formatBytes } from "./formatBytes";

export async function showSong(ctx: Context, song: TelegramSongWithFiles) {
  const text = `
🎵 <b>${song.title}</b>

👤 <b>خواننده:</b> ${song.artist}
⏱ <b>مدت:</b> ${formatDuration(song.duration)}
💾 <b>دانلودها:</b> ${(song.downloads ?? 0).toLocaleString()}

🎧 <b>کیفیت‌های موجود</b>

• 64 kbps — ${song.bytes64 ? formatBytes(song.bytes64) : "❌"}
• 128 kbps — ${song.bytes128 ? formatBytes(song.bytes128) : "❌"}
• 320 kbps — ${song.bytes320 ? formatBytes(song.bytes320) : "❌"}

یکی از گزینه‌های زیر را انتخاب کنید.
`;

  const inline = new InlineKeyboard()
    .text("⬇️ 64", `d:${song.id}:64`)
    .text("⬇️ 128", `d:${song.id}:128`)
    .text("⬇️ 320", `d:${song.id}:320`)
    .row()
    .text("🎧 پیش‌نمایش", `p:${song.id}`)
    .row()
    .text("♥ افزودن به علاقه مندی", `f:${song.id}`)
    .row()
    .text("🔎 خواننده", `artist:${song.artistEn}`)
    .text("🔗 اشتراک‌گذاری", `sh:${song.id}`);

  await ctx.replyWithPhoto(song.telegram.coverArt?.fileId || "", {
    caption: text,
    parse_mode: "HTML",
    reply_markup: inline,
  });
}
