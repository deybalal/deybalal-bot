import type { Context } from "grammy";
import { searchSongs } from "../src/dbUtils";

export async function sendSearchResults(
  ctx: Context,
  query: string,
  page: number,
  allSongs?: any[]
) {
  const PAGE_SIZE = 20;
  const songs = allSongs || searchSongs(query);
  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageSongs = songs.slice(start, end);

  const buttons = pageSongs.map((song: any) => [
    {
      text: `🎵 ${song.title} — ${song.artist}`,
      callback_data: `s:${song.id}`,
    },
  ]);

  const navButtons = [];

  if (page > 0) {
    navButtons.push({
      text: "⬅️ قبلی",
      callback_data: `search:${query}:${page - 1}`,
    });
  }

  const hasNext = end < songs.length;

  if (hasNext) {
    navButtons.push({
      text: "بعدی ➡️",
      callback_data: `search:${query}:${page + 1}`,
    });
  }

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: `🔍 ${songs.length} نتیجه برای "${query}"`,
          callback_data: "no_callback",
        },
      ],
      ...buttons,
      navButtons.length ? navButtons : [],
      [{ text: "🔙 بازگشت", callback_data: "home" }],
    ],
  };

  await ctx.reply("نتایج جستجو:", {
    reply_markup: keyboard,
  });
}
