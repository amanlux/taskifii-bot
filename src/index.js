// ─── 1. Load & validate env ──────────────────────────────────────────────────
require("dotenv").config();
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

// ─── 2. Imports & bot init ──────────────────────────────────────────────────
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── 3. Mongoose connect ───────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ─── 4. Define your bot handlers at top level ───────────────────────────────
// Language selection
bot.start(async (ctx) => {
  await ctx.reply(
    "Choose your language! / ቋንቋ ይምረጡ!",
    Markup.inlineKeyboard([
      [Markup.button.callback("English", "LANG_EN"), Markup.button.callback("Amharic", "LANG_AM")]
    ])
  );
});

// Example: language callbacks
bot.action("LANG_EN", async (ctx) => {
  await ctx.answerCbQuery();
  // disable buttons by editing the message
  await ctx.editMessageReplyMarkup();
  // store language in DB...
  // then send next prompt...
  await ctx.reply("Please set up your profile to start using Taskifii!");
});
bot.action("LANG_AM", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup();
  await ctx.reply("Taskifii መጠቀም ለመጀመር ፕሮፋይልዎን ያቀናብሩ!");
});

// … all your other bot.action and bot.on("text") handlers here …

// ─── 5. Express & Telegram webhook setup ────────────────────────────────────
const app = express();
app.use(express.json());

// Telegram will POST updates here:
const hookPath = `/telegram/${process.env.BOT_TOKEN}`;
app.post(hookPath, bot.webhookCallback());

// Health check for Render
app.get("/", (_req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Express listening on port ${PORT}`);

  // Remove any old webhook, then set ours:
  const externalBase = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
  const url = `${externalBase}${hookPath}`;
  await bot.telegram.deleteWebhook();
  await bot.telegram.setWebhook(url);
  console.log(`🤖 Webhook set to ${url}`);

  // Debug: show Telegram’s view of our hook
  const info = await bot.telegram.getWebhookInfo();
  console.log("📡 WebhookInfo:", info);
});
