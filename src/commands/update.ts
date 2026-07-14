import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Bot } from "grammy";

const execAsync = promisify(exec);

export function registerUpdateCommand(bot: Bot) {
  bot.command("update", async (ctx) => {
    if (ctx.from?.id !== Number(process.env.ADMIN_ID)) {
      await ctx.reply("You are not authorized to use this command.");
      return;
    }

    const msg = await ctx.reply("🔄 Updating bot...");

    try {
      const cwd = process.cwd();

      await execAsync("git fetch origin", { cwd });
      await execAsync("git reset --hard origin/main", { cwd });

      // Install new dependencies if package.json changed
      await execAsync("bun install --production", { cwd });

      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        "✅ Bot updated successfully!"
      );

      // Restart the bot
      await execAsync("pm2 restart dey", { cwd });
    } catch (err: any) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `❌ Update failed.\n\n<pre>${err.stderr || err.message}</pre>`,
        {
          parse_mode: "HTML",
        }
      );
    }
  });
}
