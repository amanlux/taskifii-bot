// src/index.js
const { Telegraf } = require("telegraf");

if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply("Hello, Taskifii bot here!");
});

bot
  .launch()
  .then(() => {
    console.log("Bot is up");
  })
  .catch((err) => {
    console.error("Failed to launch bot:", err);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
