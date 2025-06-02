// src/index.js
const mongoose = require("mongoose");
const { Telegraf } = require("telegraf");

// Ensure BOT_TOKEN is set
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}
// Ensure MONGODB_URI is set
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set in environment variables.");
  process.exit(1);
}

// 1) Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    // 2) Only after a successful DB connection do we launch the bot
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 3) Define a function to initialize and launch the bot
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Basic /start handler
  bot.start((ctx) => {
    ctx.reply("Hello, Taskifii bot here! (DB is connected)");
  });

  // Launch the bot and log when ready
  bot
    .launch()
    .then(() => {
      console.log("🤖 Bot is up and running");
    })
    .catch((err) => {
      console.error("⚠️ Failed to launch bot:", err);
    });

  // Enable graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
