import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Bot } from "grammy";

const execAsync = promisify(exec);

export function registerBackupCommand(bot: Bot) {
  bot.command("backup", async (ctx) => {
    if (ctx.from?.id !== Number(process.env.ADMIN_ID)) {
      await ctx.reply("You are not authorized to use this command.");
      return;
    }

    const msg = await ctx.reply("🔄 Generating backup");

    try {
      const cwd = process.cwd();

      const { stdout } = await execAsync(
        "bun run scripts/exportDataToJSON.ts",
        { cwd }
      );

      const filePath = stdout.trim();

      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `✅ Backup generated successfully!\n\n<code>${filePath}</code>`,
        {
          parse_mode: "HTML",
        }
      );
    } catch (err: any) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `❌ Generating Backup failed.\n\n<pre>${
          err.stderr || err.message
        }</pre>`,
        {
          parse_mode: "HTML",
        }
      );
    }
  });
}
