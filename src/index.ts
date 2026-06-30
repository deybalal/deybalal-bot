import { Bot, InlineKeyboard } from "grammy";
import "dotenv/config";
import { serve } from "@hono/node-server";

import { Hono } from "hono";
import { ensureUser, getRandomSong, getSongById, getStats } from "./dbUtils";
import { db } from "./db";
import { formatBytes } from "../tools/formatBytes";
import { formatDuration } from "../tools/formatDuration";
import { showSong } from "../tools/showSong";

const app = new Hono();

const bot = new Bot(process.env.BOT_TOKEN!);

// /start command
bot.command("start", async (ctx) => {
  ensureUser(ctx.from!);

  if (ctx.match?.startsWith("s_")) {
    const songId = ctx.match.substring(2);

    const song = getSongById(songId);

    if (!song) {
      await ctx.reply("❌ این آهنگ پیدا نشد.");
      return;
    }

    return await showSong(ctx, song);
  }

  const stats = getStats();

  const inline = new InlineKeyboard()
    .text("🎵 موزیک تصادفی", "random")
    .text("درباره", "about")
    .row()
    .text("تنظیمات", "settings");

  let text = `🎵 خش اومیی همتبار!

ربات تلگرام دی بلال،

🎧  ${stats.songs.toLocaleString()} آهنگ داره!
🎤  ${stats.artists.toLocaleString()} خواننده داره!

می‌تونی با عنوان یا خواننده جستجو کنی، موزیک تصادفی ببینی و آهنگ‌ هارو با کیفیت‌های مختلف دانلود کنی.

\n✨ از اینکه از دی بلال استفاده میکنی، ممنونیم!`;

  await ctx.reply(text, { reply_markup: inline });
});

bot.callbackQuery("random", async (ctx) => {
  console.log("Random query");
  const randomSong = getRandomSong();
  await ctx.answerCallbackQuery();

  const inline = new InlineKeyboard()
    .text("🎧 نمایش", `s:${randomSong?.id}`)
    .row()
    .text("🎵 موزیک بعدی", "random")
    .row();

  await ctx.replyWithAudio(randomSong?.telegram["320"]?.fileId || "", {
    caption: `${randomSong?.title} از ${randomSong?.artist}`,
    duration: randomSong?.duration,
    performer: randomSong?.artistEn || "None",
    title: `${randomSong?.title} از ${randomSong?.artist}`,
    parse_mode: "HTML",
    reply_markup: inline,
  });
});
bot.callbackQuery(/^s:(.+)$/, async (ctx) => {
  console.log("Song query");
  const songId = ctx.match[1];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await showSong(ctx, song);
});
bot.callbackQuery(/^d:(.+):(.+)$/, async (ctx) => {
  console.log("Dowload query");
  const songId = ctx.match[1];
  const quality = ctx.match[2];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  if (!song.telegram[quality as keyof typeof song.telegram]) {
    await ctx.answerCallbackQuery("کیفیت مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await ctx.replyWithAudio(
    song.telegram[quality as keyof typeof song.telegram]?.fileId || ""
  );
});
bot.callbackQuery(/^p:(.+)$/, async (ctx) => {
  console.log("Preview query");
  const songId = ctx.match[1];
  const song = getSongById(songId!);

  if (!song) {
    await ctx.answerCallbackQuery("آهنگ مورد نظر یافت نشد!");
    return;
  }

  await ctx.answerCallbackQuery();

  await ctx.replyWithAudio(song.telegram.ogg?.fileId || "");
});

bot.callbackQuery(/^sh:(.+)$/, async (ctx) => {
  const songId = ctx.match[1];
  const botUsername = ctx.me.username;

  const deepLink = `https://t.me/${botUsername}?start=s_${songId}`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}`;

  const inline = new InlineKeyboard().url("📤 اشتراک‌گذاری آهنگ", shareUrl);

  await ctx.answerCallbackQuery();

  await ctx.reply(
    `🔗 لینک اشتراک‌گذاری این آهنگ:\n\n${deepLink}\n\nبرای اشتراک‌گذاری این آهنگ، دکمه زیر را انتخاب کنید:`,
    {
      reply_markup: inline,
    }
  );
});

bot.command("users", async (ctx) => {
  if (ctx.from?.id !== parseInt(process.env.ADMIN_ID!)) {
    await ctx.reply("You are not authorized to use this command.");
    return;
  }
  const users = db.query("SELECT * FROM users").all();
  await ctx.reply(JSON.stringify(users));
});

app.post("/webhook", async (c) => {
  const update = await c.req.json();

  await bot.handleUpdate(update);
  return c.text("ok");
});

bot.catch((err) => {
  console.error("Bot Error is: ", err);
});

bot.start({ drop_pending_updates: true });

const PORT = parseInt(process.env.PORT!);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running on http://localhost:${PORT}`);

export default bot;
