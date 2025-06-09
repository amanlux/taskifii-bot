require("dotenv").config();

const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const User = require("./User");

// Validate environment variables
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ─── 1. /start → Language Selection ───────────────────────────────
bot.start(async (ctx) => {
  // Upsert user record and reset onboarding
  await User.findOneAndUpdate(
    { telegramId: ctx.from.id },
    { telegramId: ctx.from.id, state: "AWAIT_LANGUAGE" },
    { upsert: true }
  );

  // Send language buttons
  return ctx.reply(
    "Choose your language! / ቋንቋ ይምረጡ!",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("English", "LANG_EN"),
        Markup.button.callback("Amharic", "LANG_AM"),
      ],
    ])
  );
});

// ─── 2. After Language is Chosen → Setup Profile Prompt ───────────
bot.action(["LANG_EN", "LANG_AM"], async (ctx) => {
  await ctx.answerCbQuery();
  const lang = ctx.match[0] === "LANG_EN" ? "EN" : "AM";

  // Update user language & state
  await User.findOneAndUpdate(
    { telegramId: ctx.from.id },
    { language: lang, state: "AWAIT_SETUP" }
  );

  // Highlight the clicked button
  const buttons =
    lang === "EN"
      ? [[Markup.button.callback("✔ English", "LANG_EN"), Markup.button.callback("Amharic", "LANG_AM")]]
      : [[Markup.button.callback("English", "LANG_EN"), Markup.button.callback("✔ አማርኛ", "LANG_AM")]];

  await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(buttons));

  // Send "Setup Profile" prompt
  const text =
    lang === "EN"
      ? "Please set up your profile to start using Taskifii!"
      : "Taskifii መጠቀም ለመጀመር ፕሮፋይልዎን ያቀናብሩ!";
  return ctx.reply(
    text,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          lang === "EN" ? "✔ Setup Profile" : "✔ ፕሮፋይል ያቀናብሩ",
          "SETUP_PROFILE"
        ),
      ],
    ])
  );
});

// ─── 3. “Setup Profile” → Ask Full Name with Validation ──────────
bot.action("SETUP_PROFILE", async (ctx) => {
  await ctx.answerCbQuery();

  // Update state
  await User.findOneAndUpdate(
    { telegramId: ctx.from.id },
    { state: "AWAIT_FULLNAME" }
  );

  // Ask full name in user’s language
  const user = await User.findOne({ telegramId: ctx.from.id });
  const prompt =
    user.language === "EN"
      ? "What is your full name? (minimum 3 characters)"
      : "ሙሉ ስምዎን ያስገቡ። (አንስተው 3 ቁምፊ መሆን አለበት)";
  return ctx.reply(prompt);
});

// ─── Handle Full-Name Replies ────────────────────────────────────
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user || user.state !== "AWAIT_FULLNAME") return;

  // Validate length
  if (text.length < 3) {
    const retry =
      user.language === "EN"
        ? "Full name must be at least 3 characters. Try again."
        : "ሙሉ ስም አንስተው 3 ቁምፊ መሆን አለበት። ድጋፍ ይሁን።";
    return ctx.reply(retry);
  }

  // Check duplicates
  const base = text;
  const regex = new RegExp(`^${base}( \\\([^\\\)]+\\\))?$`, "i");
  const count = await User.countDocuments({ fullName: { $regex: regex } });
  const finalName = count === 0 ? base : `${base} (${count + 1})`;

  // Save fullName and advance state
  await User.findOneAndUpdate(
    { telegramId: ctx.from.id },
    { fullName: finalName, state: "AWAIT_PHONE" }
  );

  // Confirm
  const confirm =
    user.language === "EN"
      ? `Nice to meet you, ${finalName}!`
      : `እንኳን ደህና መጡ, ${finalName}!`;
  return ctx.reply(confirm);
});

// ─── Express & Webhook Setup ────────────────────────────────────
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

  // Remove stale webhook, then set ours
  const externalBase = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");

  const url = `${externalBase}${hookPath}`;
  await bot.telegram.deleteWebhook();
  await bot.telegram.setWebhook(url);
  console.log(`🤖 Webhook set to ${url}`);

  // Debug: show Telegram’s view
  const info = await bot.telegram.getWebhookInfo();
  console.log("📡 WebhookInfo:", info);
});
