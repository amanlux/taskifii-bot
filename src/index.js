// src/index.js

/**
 * Main bot entrypoint.
 * - Connects to MongoDB via Mongoose.
 * - Starts a minimal HTTP listener so Render’s Web Service sees a bound port.
 * - Launches the Telegram bot (Telegraf) and implements:
 *     • Multi-step, button-driven language selection.
 *     • Profile onboarding (full name, phone, email, username, banking details, T&C, age check).
 *     • Final profile summary + “Post a Task” / “Find a Task” / “Edit Profile” buttons.
 */

const http    = require("http");
const mongoose = require("mongoose");
const { Telegraf, Markup } = require("telegraf");

// Register Mongoose models (so they’re compiled)
const User = require("../models/User");
const Task = require("../models/Task");

// 1) Validate environment variables
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in environment variables.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set in environment variables.");
  process.exit(1);
}

// 2) Connect to MongoDB Atlas
mongoose
  .connect(process.env.MONGODB_URI, {
    // useNewUrlParser/useUnifiedTopology are no-ops in modern Mongoose but retained here
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

// 3) Main function that initializes and launches the Telegram bot
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  //
  // ─── HELPER: Build "Setup Profile" Button ────────────────────────────────────
  //
  function setupProfileButton(lang) {
    const text = lang === "am"
      ? "ፕሮፋይል ያቀናብሩ"    // “Setup Profile” in Amharic
      : "Setup Profile";
    return Markup.button.callback(text, "SETUP_PROFILE");
  }

  //
  // ─── HELPER: Build final profile-complete buttons (Post/Find/Edit) ───────────
  //
  function profileCompleteButtons(lang) {
    const postLabel = lang === "am" ? "ተግዳሮት ልጥፍ" : "Post a Task";
    const findLabel = lang === "am" ? "ተግዳሮት ፈልግ" : "Find a Task";
    const editLabel = lang === "am" ? "ፕሮፋይል አርትዕ" : "Edit Profile";
    return Markup.inlineKeyboard([
      [Markup.button.callback(postLabel, "POST_TASK")],
      [Markup.button.callback(findLabel, "FIND_TASK")],
      [Markup.button.callback(editLabel, "EDIT_PROFILE")]
    ]);
  }

  //
  // ─── /start HANDLER: Create or fetch User, then prompt based on onboardingStep ─
  //
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const tgUsername = ctx.from.username || "";

    // 1) Look for existing user
    let user = await User.findOne({ telegramId });

    // 2) If none, create a fresh record with only telegramId + username + onboardingStep
    if (!user) {
      user = new User({
        telegramId,
        username: tgUsername,
        onboardingStep: "language",
        // fullName/phone/email/language remain undefined/default until collected
      });
      await user.save();
    }

    // 3) Prompt based on onboardingStep
    switch (user.onboardingStep) {
      case "language":
        return ctx.reply(
          "Choose your language! / ቋንቋ ይምረጡ!",
          Markup.inlineKeyboard([
            [
              Markup.button.callback("English", "LANG_EN"),
              Markup.button.callback("አማርኛ", "LANG_AM")
            ]
          ])
        );

      case "fullName":
        return ctx.reply(
          "What is your full name? (minimum 3 characters)\n(የሙሉ ስምዎን ያስገቡ። (አንስተው 3 ቁምፊ ቢሆን ይጠቅማል))"
        );

      case "phone":
        return ctx.reply(
          "Please enter your phone number (digits only, e.g. 0912345678).\n(እባክዎን የስልክ ቁጥርዎን ያስገቡ (ቁጥሮች ብቻ። ለምሳሌ 0912345678))."
        );

      case "email":
        return ctx.reply(
          "Please enter your email address.\n(እባክዎን የኢሜይል አድራሻዎን ያስገቡ።)"
        );

      case "usernameConfirm":
        const currentUsername = ctx.from.username || "";
        return ctx.reply(
          `Your Telegram username is @${currentUsername}.\nReply "yes" to confirm or send a different username.\n(የተጠቃሚ ስምዎ በቴሌግራም እንዲህ ነው: @${currentUsername}።\n"yes" ብለው ያረጋግጡ ወይም ሌላ ትልቅ የተጠቃሚ ስም ይላኩ።)`
        );

      case "bankEntry":
        return ctx.reply(
          "Give us your online banking details (up to 10) in this format:\n`BankName,AccountNumber`\nYou may also include Telebirr as `Telebirr,YourPhoneNumber`.`\n(የባንክ ዝርዝሮችዎን (እስከ 10ት) በዚህ ቅጥ ያስገቡ:\n`BankName,AccountNumber`\nTelebirr እንደ `Telebirr,YourPhoneNumber` መጨመር ይችላሉ።)\n\nType `done` when finished.\n(ፈጣን ብቻ ሲሞሉ  `done` ይላኩ።)"
        );

      case "ageVerify":
        return ctx.reply(
          "Are you 18 or older? Reply with `yes` or `no`.\n(አንድ እና ስምንት ዓመት ወይም ከዚያ ዕድሜ ከፍ ነህ? `yes` ወይም `no` ብቻ ይላኩ።)"
        );

      // If already completed onboarding:
      default:
        // Build final profile summary + “Post a Task” / “Find a Task” / “Edit Profile” buttons:
        const banks =
          user.bankDetails.length > 0
            ? user.bankDetails.map(b => `${b.bankName} (${b.accountNumber})`).join(", ")
            : "N/A";

        const languageLabel = user.language === "en" ? "English" : "አማርኛ";
        const profileMsg = `
📝 Profile Complete!  
• Full Name: ${user.fullName}  
• Phone: ${user.phone}  
• Email: ${user.email}  
• Username: @${user.username}  
• Banks: ${banks}  
• Language: ${languageLabel}  
• Registered: ${user.createdAt.toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa" })}
`;
        return ctx.reply(profileMsg.trim(), profileCompleteButtons(user.language));
    }
  });

  //
  // ─── ACTION HANDLERS FOR INLINE BUTTONS ─────────────────────────────────────
  //
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery(); // acknowledge
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");
    user.language = "en";
    user.onboardingStep = "fullName";
    await user.save();
    return ctx.reply("Great! Now, please enter your full name (e.g., John Doe).");
  });

  bot.action("LANG_AM", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user) return ctx.reply("ተጨማሪ ስህተት። /start እንደገና ይሞክሩ።");
    user.language = "am";
    user.onboardingStep = "fullName";
    await user.save();
    return ctx.reply("ጥሩ! እባክዎን ሙሉ ስምዎን ያስገቡ (ለምሳሌ ዮሐንስ ደስታ).");
  });

  bot.action("SETUP_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");
    // If profile wasn’t completed yet, simply re-send the correct prompt based on onboardingStep:
    switch (user.onboardingStep) {
      case "language":
        return ctx.reply(
          "Please choose your language! / እባክዎን ቋንቋዎን ይምረጡ:\n1. English (reply with en)\n2. አማርኛ (reply with am)"
        );
      case "fullName":
        return ctx.reply("What is your full name? (minimum 3 characters)");
      case "phone":
        return ctx.reply("Please enter your phone number (digits only).");
      case "email":
        return ctx.reply("Please enter your email address.");
      case "usernameConfirm":
        const currUser = ctx.from.username || "";
        return ctx.reply(`Your Telegram username is @${currUser}. Reply "yes" to confirm or send a different username.`);
      case "bankEntry":
        return ctx.reply(
          "Enter your bank details as `BankName,AccountNumber`. Type `done` when finished."
        );
      case "ageVerify":
        return ctx.reply("Are you 18 or older? Reply with `yes` or `no`.");
      default:
        return ctx.reply("You have already completed onboarding.");
    }
  });

  //
  // ─── TEXT HANDLER: Route all plain‐text replies according to onboardingStep ───
  //
  bot.on("text", async (ctx) => {
    const telegramId = ctx.from.id;
    const text = ctx.message.text.trim();
    let user = await User.findOne({ telegramId });
    if (!user) return; // Shouldn’t happen unless DB was wiped

    switch (user.onboardingStep) {
      // 1. FULL NAME
      case "fullName":
        if (text.length >= 3) {
          user.fullName = text;
          user.onboardingStep = "phone";
          await user.save();
          return ctx.reply("Please enter your phone number (digits only).");
        } else {
          return ctx.reply("Full name must be at least 3 characters. Try again.");
        }

      // 2. PHONE NUMBER
      case "phone":
        if (/^\+?\d{8,14}$/.test(text)) {
          user.phone = text;
          user.onboardingStep = "email";
          await user.save();
          return ctx.reply("Please enter your email address.");
        } else {
          return ctx.reply(
            "Invalid phone format. Must be 8–14 digits (you may include a leading +). Try again."
          );
        }

      // 3. EMAIL
      case "email":
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          user.email = text;
          user.onboardingStep = "usernameConfirm";
          await user.save();
          const currUsername = ctx.from.username || "";
          return ctx.reply(
            `Your Telegram username is @${currUsername}. Reply "yes" to confirm or send a different username.`
          );
        } else {
          return ctx.reply("Invalid email. Please enter a valid address.");
        }

      // 4. USERNAME CONFIRM
      case "usernameConfirm":
        const lower = text.toLowerCase();
        const rawUsername = ctx.from.username || "";
        if (lower === "yes" && rawUsername) {
          user.username = rawUsername;
          user.onboardingStep = "bankEntry";
          await user.save();
          return ctx.reply(
            "Enter your bank details as `BankName,AccountNumber`. Type `done` when finished."
          );
        } else if (/^[A-Za-z0-9_]{5,}$/.test(text)) {
          user.username = text;
          user.onboardingStep = "bankEntry";
          await user.save();
          return ctx.reply(
            "Enter your bank details as `BankName,AccountNumber`. Type `done` when finished."
          );
        } else {
          return ctx.reply(
            'Please reply "yes" to confirm your @username, or send a valid username (letters/numbers/underscores).'
          );
        }

      // 5. BANK ENTRY (loop until "done")
      case "bankEntry":
        if (text.toLowerCase() === "done") {
          if (user.bankDetails.length === 0) {
            return ctx.reply(
              "You must enter at least one bank detail. Format: BankName,AccountNumber"
            );
          }
          // Move on to Terms & Conditions step (next: ageVerify). But first deliver T&C.
          user.onboardingStep = "ageVerify";
          await user.save();

          // SEND TERMS & CONDITIONS message with two buttons: Agree / Disagree
          const tcAm = `
እባክዎት የመለያን መመርቻዎን ከፈቃድዎ በፊት ተገቢውን ሁኔታዎች ያነቡ። ይህ መመሪያ የዚህ መድረክ አገልግሎት የሚከበርበትን መሠረት ያቀርባል። ለተጠቃሚዎች መመቻቸል፣ ለደንበኞች ማስተላለፊያ፣ ወዘተ ስለሚካሄድ በቂ መረጃ ያስገቡ።
- እባኮት ውጤቱን ቦታግብዩ። ማንንም በማንኛውም ወቅት ማቀናበር የለም።
- እባኮት የመድረኩን ህጎች ይቆጣጠሩ።
  `;
          const tcEn = `
Please read and agree to these Terms & Conditions before proceeding.  
This policy sets out the rules for using Taskifii in its MVP stage. By agreeing, you acknowledge:
1. Taskifii is not yet legally registered—this is an MVP with no revenue/commissions.  
2. Your information will be stored securely; we strive to keep it encrypted and private.  
3. There is no escrow—once you pay or are paid, Taskifii is not liable.  
4. Users under 18 are not allowed.  
5. Violating these Terms & Conditions may result in immediate suspension or ban.  
6. We handle all data in accordance with Ethiopian law, but we are not yet a licensed service.  
7. You understand there is no formal dispute-resolution or customer support beyond this MVP.  
If you agree, click “Agree” below; otherwise click “Disagree.”
  `;
          return ctx.reply(
            user.language === "am" ? tcAm : tcEn,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  user.language === "am" ? "ተፈቅዷል" : "Agree",
                  "TC_AGREE"
                ),
                Markup.button.callback(
                  user.language === "am" ? "አልተፈቀደም" : "Disagree",
                  "TC_DISAGREE"
                )
              ]
            ])
          );
        }

        // Expect “BankName,AccountNumber”
        if (/^[^,]+,\d+$/.test(text)) {
          if (user.bankDetails.length >= 10) {
            // Already at 10 banks: force “done”
            user.onboardingStep = "ageVerify";
            await user.save();
            return ctx.reply(
              `You have reached 10 bank entries. Moving on.`
            );
          }
          const [bankName, accountNumber] = text.split(",");
          user.bankDetails.push({ bankName: bankName.trim(), accountNumber: accountNumber.trim() });
          await user.save();
          return ctx.reply(
            "Bank added. Enter another or type `done` if finished."
          );
        } else {
          return ctx.reply(
            "Invalid format. Use `BankName,AccountNumber` (digits only). Try again."
          );
        }


      // 6. AGE VERIFICATION (but only after T&C “Agree”)
      case "ageVerify":
        if (text.toLowerCase() === "yes") {
          // Finalize onboarding → send full profile + buttons
          user.onboardingStep = "completed";
          await user.save();

          // Build final profile
          const banksList =
            user.bankDetails.length > 0
              ? user.bankDetails.map((b) => `${b.bankName} (${b.accountNumber})`).join(", ")
              : "N/A";
          const languageLabel2 = user.language === "en" ? "English" : "አማርኛ";
          const profileMsg2 = `
📝 Profile Complete!  
• Full Name: ${user.fullName}  
• Phone: ${user.phone}  
• Email: ${user.email}  
• Username: @${user.username}  
• Banks: ${banksList}  
• Language: ${languageLabel2}  
• Registered: ${user.createdAt.toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa" })}
`;
          return ctx.reply(profileMsg2.trim(), profileCompleteButtons(user.language));
        } else if (text.toLowerCase() === "no") {
          await User.deleteOne({ telegramId });
          return ctx.reply(
            user.language === "am"
              ? "ይቅርታ፣ ከ18 ዓመት በታች መሆንዎ ምክንያት በቻይ እርዳታ ላይ መጠቀም አይቻልም። መረጃዎችዎን አጥፊው ተለይቷል።"
              : "Sorry, you must be 18 or older to use this service. Your data has been removed."
          );
        } else {
          return ctx.reply(
            user.language === "am"
              ? "18 ዓመት ወይም ከዚያ ከፍ እንደሆኑ “yes” ወይም “no” ብቻ ይላኩ።"
              : "Reply with `yes` if you are 18 or older, otherwise `no`."
          );
        }

      // If onboardingStep is “completed” or anything else:
      default:
        return; // no action
    }
  });

  //
  // ─── ACTION HANDLERS FOR TERMS & CONDITIONS BUTTONS ─────────────────────────
  //
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Move on to ageVerify prompt (it will be handled by text handler)
    user.onboardingStep = "ageVerify";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "አንድ እና ስምንት ዓመት ወይም ከዚያ በላይ ነህ? `yes` ወይም `no` ብቻ ይላኩ።"
        : "Are you 18 or older? Reply with `yes` or `no`."
    );
  });

  bot.action("TC_DISAGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Remain on T&C step; re-prompt with a “Review T&C?” option
    return ctx.reply(
      user.language === "am"
        ? "ህጎቹን ለመታወቅ እና ለመረጋገጥ አሳሳቢ ነው። መመሪያውን መልሰው ማንኛውንም መረጃ ለማየት “yes” ብለው ሊደግፉ ይችላሉ።"
        : "It’s important to read and agree to the Terms & Conditions. If you’d like to review them again, reply “yes”."
    );
  });

  //
  // ─── ACTION HANDLERS FOR FINAL PROFILE BUTTONS ─────────────────────────────
  //
  bot.action("POST_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user || user.onboardingStep !== "completed") {
      return ctx.reply("Please complete your profile first by clicking /start.");
    }
    // TODO: Hand off to “post a task” workflow (next big section)
    return ctx.reply("⭐ Post-a-Task flow is not implemented yet.");
  });

  bot.action("FIND_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user || user.onboardingStep !== "completed") {
      return ctx.reply("Please complete your profile first by clicking /start.");
    }
    // TODO: Hand off to “find a task” workflow (filter & display tasks)
    return ctx.reply("🔍 Find-Task flow is not implemented yet.");
  });

  bot.action("EDIT_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    let user = await User.findOne({ telegramId });
    if (!user || user.onboardingStep !== "completed") {
      return ctx.reply("Please complete your profile first by clicking /start.");
    }
    // TODO: Send the profile post back with “Edit” sub-buttons
    return ctx.reply("✏️ Edit-Profile flow is not implemented yet.");
  });

  //
  // ─── LAUNCH THE BOT ─────────────────────────────────────────────────────────
  //
  bot
    .launch()
    .then(() => {
      console.log("🤖 Bot is up and running");
    })
    .catch((err) => {
      console.error("⚠️ Failed to launch bot:", err);
    });

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

//
// ─── HTTP SERVER ──────────────────────────────────────────────────────────────
// Bind a simple “OK” listener on process.env.PORT so Render’s free Web Service stays alive.
//
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
