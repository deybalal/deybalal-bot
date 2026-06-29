import { Bot } from "grammy";
import "dotenv/config";
import { serve } from "@hono/node-server";

import { Hono } from "hono";

const app = new Hono();

const bot = new Bot(process.env.BOT_TOKEN!);

// /start command
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Hallo!\n\nThis bot is running with Bun + Hono + grammY with polling."
  );
});

app.post("/webhook", async (c) => {
  const update = await c.req.json();

  await bot.handleUpdate(update);
  return c.text("ok");
});

bot.start();

const PORT = parseInt(process.env.PORT!);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

export default bot;
