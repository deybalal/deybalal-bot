import { InlineKeyboard, type Context } from "grammy";
import type { TelegramSongWithFiles } from "../types/types";
import { formatDuration } from "./formatDuration";
import { formatBytes } from "./formatBytes";
import { getArtistById } from "./getArtistName";

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

  console.log("song.artists ", song.artists);

  const parsedArtists = JSON.parse(song.artists as unknown as string);
  console.log("parsedArtists ", parsedArtists);

  const kb = new InlineKeyboard();
  kb.text("⬇️ 64", `d:${song.id}:64`);
  kb.text("⬇️ 128", `d:${song.id}:128`);
  kb.text("⬇️ 320", `d:${song.id}:320`).row();
  kb.text("🎧 پیش‌نمایش", `p:${song.id}`).row();
  kb.text("♥ افزودن به علاقه مندی", `f:${song.id}`).row();
  if (parsedArtists.length <= 1) {
    kb.text(`🎤 ${song.artist}`, `a:${parsedArtists[0]?.id}:0`).row();
  } else if (parsedArtists.length > 1) {
    for (const item of parsedArtists) {
      const artist = await getArtistById(item.id);
      kb.text(`🎤 ${artist?.name || "خواننده"}`, `a:${item.id}:0`).row();
    }
  }
  kb.text("🔗 اشتراک‌گذاری", `sh:${song.id}`);

  await ctx.replyWithPhoto(song.telegram.coverArt?.fileId || "", {
    caption: text,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
