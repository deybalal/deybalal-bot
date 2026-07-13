import { Bot } from "grammy";
import { db } from "../db";

export function registerUsersCommand(bot: Bot) {
  bot.command("users", async (ctx) => {
    if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
      await ctx.reply("You are not authorized to use this command.");
      return;
    }
    const users = db.query("SELECT * FROM users").all();
    await ctx.reply(JSON.stringify(users));
  });
}
