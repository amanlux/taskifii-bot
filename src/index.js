// src/index.js

const http = require("http");
const mongoose = require("mongoose");
const { Telegraf } = require("telegraf");

const User = require("../models/User");
const Task = require("../models/Task");

// 1. Validate environment variables
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set in environment variables.");
  process.exit(1);
}

// 2. Connect to MongoDB Atlas
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
    startHttpServer();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 3. Launch the Telegram bot
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Basic /start handler


  bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const tgUsername = ctx.from.username || "";

    // 1) Look for an existing User
    let user = await User.findOne({ telegramId });

    if (!user) {
      // 2) If none, create a new User with default onboardingStep = "language"
      user = new User({
        telegramId,
        username: tgUsername,
        fullName: "",
        phone: "",
        email: "",
        bankDetails: [],
        language: "",
        onboardingStep: "language",
      });
      await user.save();
    }

    // 3) Based on onboardingStep, send the appropriate prompt
    switch (user.onboardingStep) {
      case "language":
        return ctx.reply(
          "Please choose your language / እባክዎን ቋንቋዎን ይምረጡ:\n1. English (reply with en)\n2. አማርኛ (reply with am)"
        );
      case "fullName":
        return ctx.reply("What is your full name? (minimum 3 characters)");
      case "phone":
        return ctx.reply("Please enter your phone number (digits only, e.g. 0912345678).");
      case "email":
        return ctx.reply("Please enter your email address.");
      case "usernameConfirm":
        return ctx.reply(`Your Telegram username is @${tgUsername}. Reply "yes" to confirm or send a different username.`);
      case "bankEntry":
        return ctx.reply("Enter your bank details as `BankName,AccountNumber`. Type `done` when finished.");
      case "ageVerify":
        return ctx.reply("Are you 18 or older? Reply with `yes` or `no`.");
      default:
        // If onboardingStep is "completed", or anything else, show the final profile
        return ctx.reply("You have already completed onboarding.");
    }
  });

  // Launch and log when ready
  bot
    .launch()
    .then(() => {
      console.log("🤖 Bot is up and running");
    })
    .catch((err) => {
      console.error("⚠️ Failed to launch bot:", err);
    });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// 4. Start a minimal HTTP server
function startHttpServer() {
  const port = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    })
    .listen(port, () => {
      console.log(`🌐 HTTP server listening on port ${port}`);
    });
}
