import { Bot } from "grammy";
import { db } from "../db";

export function registerUsersCommand(bot: Bot) {
  bot.command("users", async (ctx) => {
    if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
      await ctx.reply("You are not authorized to use this command.");
      return;
    }

    const totalUsers = await db.user.count();

    await ctx.reply(`📊 Total Users: ${totalUsers}`);
  });
}
