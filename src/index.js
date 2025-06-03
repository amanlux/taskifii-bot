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
  bot.start((ctx) => {
    ctx.reply("Hello, Taskifii bot here! (DB is connected)");
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
