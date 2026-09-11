import { Bot } from "grammy";
import { db } from "../db";

export function registerUsersCommand(bot: Bot) {
  bot.command("users", async (ctx) => {
    if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
      await ctx.reply("You are not authorized to use this command.");
      return;
    }
    const stmt = db.prepare("SELECT COUNT(*) AS cnt FROM users");
    const row = stmt.get() as { cnt: number } | undefined;

    const totalUsers = row?.cnt ?? 0;

    await ctx.reply(`📊 Total Users: ${totalUsers}`);
  });
}
