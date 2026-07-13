import { Bot } from "grammy";
import { getSongs } from "../dbUtils";
import { findInlineBrokenFiles } from "../../scripts/junks/findInlineBrokenFiles";

export function registerFindCommand(bot: Bot) {
  bot.command("find", async (ctx) => {
    const allSongs = getSongs();
    const filteredSongsStartIndex = allSongs.findIndex(
      (song) => song.id === "cmpkwqnsy004a4ggpweorm3ll"
    );
    const filteredSongs = allSongs.slice(filteredSongsStartIndex);
    await findInlineBrokenFiles(filteredSongs);
    await ctx.reply("✅ جستجوی فایل‌های ناقص انجام شد.");
  });
}
