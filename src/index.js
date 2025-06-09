// src/index.js

/**
 * Taskifii Bot: Onboarding Flow Implementation
 * 
 * This file implements the onboarding flow exactly as specified:
 * 1. /start → language selection
 * 2. “Setup Profile” → full name → phone → email → Telegram username → banking → T&C → age verification
 * 3. Final profile post with stats + admin channel post
 * 
 * All prompts, button labels, validations, and behaviors match the document precisely.
 */
const express = require("express");

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");

// Load environment variables
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI, {
    // useNewUrlParser/useUnifiedTopology are no-ops in newer drivers
  })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ------------------------------------
//  Mongoose Schemas & Models
// ------------------------------------
const Schema = mongoose.Schema;

const userSchema = new Schema({
  telegramId:         { type: Number, unique: true, required: true },
  onboardingStep:     { type: String, required: true }, // e.g. "language", "setupProfile", "fullName", etc.
  language:           { type: String, enum: ["en", "am"] },
  fullName:           { type: String },
  phone:              { type: String, unique: true, sparse: true },
  email:              { type: String, unique: true, sparse: true },
  username:           { type: String, unique: true, sparse: true },
  bankDetails:        [
    {
      bankName:       String,
      accountNumber:  String
    }
  ],
  stats: {
    totalEarned:   { type: Number, default: 0 },
    totalSpent:    { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 }
  },
  createdAt:          { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// ------------------------------------
//  Localized Text Constants
// ------------------------------------
const TEXT = {
  chooseLanguage: {
    en: "Choose your language!",
    am: "ቋንቋ ይምረጡ!"
  },
  setupProfilePrompt: {
    en: "Please set up your profile to start using Taskifii!",
    am: "Taskifii መጠቀም ለመጀመር ፕሮፋይልዎን ያቀናብሩ!"
  },
  setupProfileBtn: {
    en: "Setup Profile",
    am: "ፕሮፋይል ያቀናብሩ"
  },
  askFullName: {
    en: "What is your full name? (minimum 3 characters)",
    am: "ሙሉ ስምዎን ያስገቡ። (አንስተው 3 ቁምፊ መሆን አለበት)"
  },
  fullNameError: {
    en: "Full name must be at least 3 characters. Try again.",
    am: "ሙሉ ስም አንስተው 3 ቁምፊ መሆን አለበት። ድጋፍ ይሁን።"
  },
  askPhone: {
    en: "What is your phone number? (digits only, max 14)",
    am: "የስልክ ቁጥርዎን ያስገቡ። (ቁጥሮች ብቻ፣ ከፍተኛው 14 ቁጥር)"
  },
  phoneErrorFormat: {
    en: "Please enter a valid phone number!",
    am: "እባክዎ የትክክለኛ የስልክ ቁጥር ያስገቡ!"
  },
  phoneErrorTaken: {
    en: "Sorry, this phone number is already taken! Please enter another phone number!",
    am: "ይቅርታ፣ ይህ ስልክ ቁጥር አስተጋባቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ ስልክ ቁጥር ያስገቡ!"
  },
  askEmail: {
    en: "What is your email address?",
    am: "የኢሜይል አድራሻዎን ያስገቡ።"
  },
  emailErrorFormat: {
    en: "Please enter a proper Gmail/email address!",
    am: "እባክዎ ትክክለኛ የኢሜይል አድራሻ ያገልግሉ!"
  },
  emailErrorTaken: {
    en: "Sorry, this email address is already taken! Please enter another email address!",
    am: "ይቅርታ፣ ይህ ኢሜይል አድራሻ አስተጋቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ ኢሜይል ያስገቡ!"
  },
  askUsername: {
    en: "Your Telegram username is @%USERNAME%. Do you want to keep this? Click ‘Yes, keep it’ or send a new one below.",
    am: "የቲነልግራም የተጠቃሚ ስምዎ @%USERNAME% ነው። ይህን ለመቀበል ይፈቅዱ? ‘አዎን፣ ይቀበሉ’ ይጫኑ ወይም አዲስ ስም በታች ይጻፉ።"
  },
  usernameErrorGeneral: {
    en: "Please make sure it is a valid Telegram username!",
    am: "እባክዎ ትክክለኛ የቲነልግራም የተጠቃሚ ስም መሆን አለበት!"
  },
  usernameErrorTaken: {
    en: "Sorry, that @username is already taken! Please enter a different @username!",
    am: "ይቅርታ፣ ይህ @username አስተጋቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ @username ያስገቡ!"
  },
  askBankDetails: {
    en: "Give us your online banking details (Maximum 10) in this format: `BankName,AccountNumber`. You may also include Telebirr by writing `Telebirr,YourPhoneNumber`.",
    am: "የባንክ ዝርዝሮችዎን (እስከ 10) በዚህ ቅጥ ያስገቡ። `BankName,AccountNumber`. Telebirr እንደ `Telebirr,YourPhoneNumber` መጨመር ይችላሉ።"
  },
  bankAddedPrompt: {
    en: "Bank added. You can click ‘Add’ to add another, ‘Replace’ to change the last one, or ‘Done’ when finished.",
    am: "ባንክ ታክሏል። ሌላ ለመጨመር ‘Add’ ይጫኑ፣ የመጨመሪያውን ለመቀየር ‘Replace’ ይጫኑ፣ ወይም ‘Done’ ከተጠናቋሉ በኋላ ተጠናቀቀ።"
  },
  bankErrorFormat: {
    en: "Please give us valid banking details in `BankName,AccountNumber` format!",
    am: "ትክክለኛ የባንክ ዝርዝር በ `BankName,AccountNumber` ቅጥ ያስገቡ!"
  },
  bankReachedTen: {
    en: "You have reached 10 bank entries. Moving on to Terms & Conditions.",
    am: "ወደ 10 ባንኮች ደረሱ። ወደ መመሪያ እና ሁኔታዎች ይቀይራሉ።"
  },
  askTerms: {
    en: `Please read and agree to these Terms & Conditions before proceeding:
(1) Taskifii is an MVP; it is not legally registered as a business entity.
(2) Taskifii charges zero commission and does not hold escrow; all payments between Task Creators and Task Doers are final.
(3) Taskifii’s Bot stores user data in encrypted form; it does not share personal information with third parties.
(4) Any violation of these Terms & Conditions—including but not limited to harassment, scamming, or sharing false information—will lead to suspension or permanent ban.
(5) By using Taskifii Bot, you acknowledge and agree that Taskifii is not liable for any disputes or losses; Taskifii acts only as an information conduit.
(6) No user under the age of 18 is allowed to register or perform tasks on Taskifii Bot.
(7) Users must comply with all Telegram policies; spamming, phishing, or blocking other users may result in removal.
(8) All payments must be completed outside of the Bot; Taskifii Bot does not handle money or escrow.
(9) Any attempt to manipulate ratings (e.g., uploading fake reviews) is strictly prohibited.
(10) By continuing, you confirm you have read, understood, and agreed to these Terms & Conditions.`,
    am: `እባክዎን በቅድሚያ መመሪያና ሁኔታዎችን ያነቡ።
(1) Taskifii እንደ MVP ስለጀመረ፤ የህጋዊ ድርጅት ምዝገባ አልተደረገም.
(2) Taskifii የኮሚሽን ክፍያ አልተያዘም እና ኢስክሮ ማስያዣ አያደርግም፤ በተግዳሮት የተከፈሉት መብዋሪያዎች ሁሉ የተወሰኑ ናቸው.
(3) Taskifii Bot የተጠቃሚዎችን መረጃ በዲጃታ ቅፅበት ያስቆጣጠር፤ ግል መረጃ ለሶስተኛዎች አይከፍልም.
(4) ከእነዚህ መመሪያዎች ማንኛውም ማሸነፍ—ምንጋጋ፣ ስከት ወይም ውሸት መከፈል—ተግዳሮት እስከጨርስ ወይም መጠፋት ያመጣል.
(5) Taskifii Bot መጠቀም በማድረግ ምንም ጉዳት ወይም ችግር የሚፈጥርበት የለም፤ Taskifii ማመልከቻው መረጃ የማስተላለፊያ ብቻ ነው.
(6) ከ18 ዓመት በታች ተጠቃሚ በTaskifii Bot መመዝገብ ወይም ተግዳሮት ማድረግ አይፈቀድም.
(7) ተጠቃሚዎች ሁሉ Telegram ፖሊሲዎችን መጠቀም አለባቸው፤ ስፓም፣ ፊሽን፣ ሌሎችን ማቆም ወዘተ የተደረገ ተግባር ከሆነ ከሰረዝ.
(8) ሁሉም ክፍያዎች ውጪ ከBot ይፈጸማሉ፤ Taskifii Bot ገንዘብ አልተያዘም አይወሰድም.
(9) የግምገማዎችን መደብደብ መልስ በማድረግ (ለምሳሌ ውሸት ግምገማዎች ማስገባት) በግብይት ተከታትሎ እንቅስቃሴን ማሳያ ነው.
(10) በመቀጠል ያላንተ እነዚህን መመሪያዎች አግኝተሃልና ተቀበልናል ትባላላችሁ.”`
  },
  agreeBtn: {
    en: "Agree",
    am: "ተፈቅዷል"
  },
  disagreeBtn: {
    en: "Disagree",
    am: "አልተፈቀደም"
  },
  reviewPoliciesBtn: {
    en: "Review Bot Policies",
    am: "የቦት ፖሊሲዎች ዳግመኛ ማንበብ"
  },
  termsNeedAgree: {
    en: "It’s important to understand and agree to the Terms & Conditions. If you want to review the Bot’s policies again, click ‘Yes’.",
    am: "ይህን መመሪያና ሁኔታዎች ማሰራመድ አስፈላጊ ነው። የቦት ፖሊሲዎችን ዳግመኛ ለማንበብ ‘Yes’ ይጫኑ።"
  },
  termsYesBtn: {
    en: "Yes",
    am: "አዎን"
  },
  askAge: {
    en: "Are you 18 or older? Click ‘Yes I am’ or ‘No I’m not.’ (Ethiopian law prohibits under-18 employment.)",
    am: "18 ወይም ከዚህ በላይ ነህ? ‘Yes I am’ ወይም ‘No I’m not’ ይጫኑ። (የኢትዮጵያ ህግ ከ18 በታች ስራ የማድረግ አደንች አይፈቀድም።)"
  },
  ageYesBtn: {
    en: "Yes I am",
    am: "አዎን ነኝ"
  },
  ageNoBtn: {
    en: "No I’m not",
    am: "አይደለም ተብሎ አይቻልም"
  },
  ageError: {
    en: "Sorry, you must be 18 or older to use Taskifii. Your data has been removed.",
    am: "ይቅርታ፣ ከ18 ዓመት በታች መሆንዎ ምክንያት ይገባል። መረጃዎት ተሰርዟል።"
  }
};

// ------------------------------------
//  Helper: buildButton
// ------------------------------------
function buildButton(textObj, callbackData, lang, highlighted = false) {
  // If highlighted, prefix with ✔ and use a no-op callbackData
  if (highlighted) {
    return Markup.button.callback(`✔ ${textObj[lang]}`, `_DISABLED_${callbackData}`);
  }
  return Markup.button.callback(textObj[lang], callbackData);
}

// ------------------------------------
//  Main Bot Logic
// ------------------------------------
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // ─────────── /start Handler ───────────
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    if (!user) {
      user = new User({
        telegramId: tgId,
        onboardingStep: "language"
      });
      await user.save();
    }

    // If still in "language" step:
    if (user.onboardingStep === "language") {
      return ctx.reply(
        `${TEXT.chooseLanguage.en}\n${TEXT.chooseLanguage.am}`,
        Markup.inlineKeyboard([
          [
            buildButton({ en: "English", am: "እንግሊዝኛ" }, "LANG_EN", "en", false),
            buildButton({ en: "Amharic", am: "አማርኛ" }, "LANG_AM", "en", false)
          ]
        ])
      );
    }

    // If in "setupProfile" (language chosen, but not started onboarding):
    if (user.onboardingStep === "setupProfile") {
      return ctx.reply(
        `${TEXT.setupProfilePrompt.en}\n${TEXT.setupProfilePrompt.am}`,
        Markup.inlineKeyboard([
          [buildButton(TEXT.setupProfileBtn, "DO_SETUP", user.language, false)]
        ])
      );
    }

    // Otherwise, do nothing here; other handlers will pick it up.
  });

  // ─────────── Language Selection Actions ───────────
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    user.language = "en";
    user.onboardingStep = "setupProfile";
    await user.save();

    return ctx.reply(
      "Language set to English.",
      Markup.inlineKeyboard([
        [buildButton(TEXT.setupProfileBtn, "DO_SETUP", "en", false)]
      ])
    );
  });

  bot.action("LANG_AM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("አስቸጋሪ ስሕተት። /start ይደግፉ.");

    user.language = "am";
    user.onboardingStep = "setupProfile";
    await user.save();

    return ctx.reply(
      "ቋንቋው ወደ አማርኛ ተቀይሯል።",
      Markup.inlineKeyboard([
        [buildButton(TEXT.setupProfileBtn, "DO_SETUP", "am", false)]
      ])
    );
  });

  // ─────────── “Setup Profile” Action ───────────
  bot.action("DO_SETUP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    user.onboardingStep = "fullName";
    await user.save();

    return ctx.reply(
      user.language === "am" ? TEXT.askFullName.am : TEXT.askFullName.en
    );
  });

  // ─────────── Catch Disabled Buttons ───────────
  bot.action(/_DISABLED_.+/, (ctx) => ctx.answerCbQuery());

  // ─────────── Text Handler for Onboarding Steps ───────────
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    // ─── FULL NAME STEP ─────────────────────────
    if (user.onboardingStep === "fullName") {
      if (text.length < 3) {
        return ctx.reply(
          user.language === "am" ? TEXT.fullNameError.am : TEXT.fullNameError.en
        );
      }
      // Count duplicates
      const countSame = await User.countDocuments({ fullName: text });
      user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;

      user.onboardingStep = "phone";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.askPhone.am : TEXT.askPhone.en
      );
    }

    // ─── PHONE STEP ────────────────────────────
    if (user.onboardingStep === "phone") {
      const phoneRegex = /^\+?\d{1,14}$/;
      if (!phoneRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.phoneErrorFormat.am : TEXT.phoneErrorFormat.en
        );
      }
      const existingPhone = await User.findOne({ phone: text });
      if (existingPhone) {
        return ctx.reply(
          user.language === "am" ? TEXT.phoneErrorTaken.am : TEXT.phoneErrorTaken.en
        );
      }
      user.phone = text;
      user.onboardingStep = "email";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.askEmail.am : TEXT.askEmail.en
      );
    }

    // ─── EMAIL STEP ────────────────────────────
    if (user.onboardingStep === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.emailErrorFormat.am : TEXT.emailErrorFormat.en
        );
      }
      const existingEmail = await User.findOne({ email: text });
      if (existingEmail) {
        return ctx.reply(
          user.language === "am" ? TEXT.emailErrorTaken.am : TEXT.emailErrorTaken.en
        );
      }
      user.email = text;
      user.onboardingStep = "username";
      await user.save();

      // Prompt shows current username
      const currentHandle = ctx.from.username || "";
      const promptText = (user.language === "am")
        ? TEXT.askUsername.am.replace("%USERNAME%", currentHandle || "<none>")
        : TEXT.askUsername.en.replace("%USERNAME%", currentHandle || "<none>");
      return ctx.reply(promptText, Markup.inlineKeyboard([
        [Markup.button.callback(
          user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
          "USERNAME_KEEP"
        )]
      ]));
    }

    // ─── USERNAME STEP ─────────────────────────
    if (user.onboardingStep === "username") {
      // If user typed text instead of clicking “Yes, keep it”
      const reply = text;
      // Validate new handle
      const userHandleRegex = /^[A-Za-z0-9_]{5,}$/;
      if (!userHandleRegex.test(reply)) {
        return ctx.reply(
          user.language === "am" ? TEXT.usernameErrorGeneral.am : TEXT.usernameErrorGeneral.en
        );
      }
      // Check taken
      const existingUser = await User.findOne({ username: reply });
      if (existingUser) {
        return ctx.reply(
          user.language === "am" ? TEXT.usernameErrorTaken.am : TEXT.usernameErrorTaken.en
        );
      }
      // Save new handle
      user.username = reply;
      user.onboardingStep = "bankFirst";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en
      );
    }

    // ─── FIRST BANK ENTRY ───────────────────────
    if (user.onboardingStep === "bankFirst") {
      // Expect first entry in format BankName,AccountNumber
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      // Save first entry
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      user.onboardingStep = "bankMulti"; // Now allow buttons
      await user.save();

      // Reply with message + show buttons
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
          ]
        ])
      );
    }

    // ─── MULTI BANK ENTRY (text input after clicking Add/Replace) ─────────────
    if (user.onboardingStep === "bankAdding") {
      // Coming from clicking "Add"
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      // Check if we have reached 10
      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        return ctx.reply(
          user.language === "am" ? TEXT.bankReachedTen.am : TEXT.bankReachedTen.en
        );
      }

      // Otherwise, prompt with buttons again
      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
          ]
        ])
      );
    }

    if (user.onboardingStep === "bankReplacing") {
      // Coming from clicking "Replace"
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      // Delete most recent
      user.bankDetails.pop();
      // Save new
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      // Still fewer than 10? Redisplay buttons
      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
          ]
        ])
      );
    }

    // ─── TERMS & CONDITIONS – TEXT RESPONSE FOR “Yes” AFTER “Disagree” ─────────
    if (user.onboardingStep === "termsReview") {
      // Re-send full T&C
      return ctx.reply(
        user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
        Markup.inlineKeyboard([
          [
            buildButton(TEXT.agreeBtn, "TC_AGREE", user.language),
            buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language),
            buildButton(TEXT.reviewPoliciesBtn, "TC_REVIEW", user.language)
          ]
        ])
      );
    }
  });

  // ─── USERNAME “Yes, keep it” Action ─────────────────────────────────
  bot.action("USERNAME_KEEP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    const handle = ctx.from.username || "";
    if (!handle) {
      return ctx.reply(
        user.language === "am"
          ? "ምንም Telegram የተጠቃሚ ስም የለዎትም። እባክዎ ትክክለኛ ይጻፉ።"
          : "It seems you don’t have a Telegram username. Please type a valid one."
      );
    }

    user.username = handle;
    user.onboardingStep = "bankFirst";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en
    );
  });

  // ─── BANK “Add” / “Replace” / “Done” Actions ─────────────────────────
  bot.action("BANK_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    user.onboardingStep = "bankAdding";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "እባክዎ አሁን በቅጥ `BankName,AccountNumber` መሆኑን ይጻፉ።"
        : "Please type your bank entry now in the format `BankName,AccountNumber`."
    );
  });

  bot.action("BANK_REPLACE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Delete last entry
    user.bankDetails.pop();
    user.onboardingStep = "bankReplacing";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "የባንኩ መጨመሪያ መዝገብ ተሰርዟል። እባክዎ አዲስ መጨመሪያ በ `BankName,AccountNumber` ቅጥ ይዘግቡ።"
        : "Your last bank entry was removed. Please type a new entry in `BankName,AccountNumber` format."
    );
  });

  bot.action("BANK_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    if (user.bankDetails.length === 0) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ ቢያንስ አንድ የባንክ ዝርዝር ያስገቡ። (በ BankName,AccountNumber ቅጥ ተጠቀም)"
          : "You must enter at least one bank detail. (Use the format BankName,AccountNumber)"
      );
    }
    user.onboardingStep = "terms";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
        [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)],
        [buildButton(TEXT.reviewPoliciesBtn, "TC_REVIEW", user.language, false)]
      ])
    );
  });

  // ─── TERMS & CONDITIONS Actions ────────────────────────────────────
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    user.onboardingStep = "age";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.askAge.am : TEXT.askAge.en,
      Markup.inlineKeyboard([
        [
          buildButton(TEXT.ageYesBtn, "AGE_YES", user.language, false),
          buildButton(TEXT.ageNoBtn, "AGE_NO", user.language, false)
        ]
      ])
    );
  });

  bot.action("TC_DISAGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    user.onboardingStep = "termsReview";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.termsNeedAgree.am : TEXT.termsNeedAgree.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.termsYesBtn, "TC_REVIEW", user.language, false)]
      ])
    );
  });

  bot.action("TC_REVIEW", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Re-send full T&C
    return ctx.reply(
      user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
        [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)],
        [buildButton(TEXT.reviewPoliciesBtn, "TC_REVIEW", user.language, false)]
      ])
    );
  });

  // ─── AGE VERIFICATION Actions ────────────────────────────────────
  bot.action("AGE_YES", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Complete onboarding
    user.onboardingStep = "completed";
    await user.save();

    // Build profile post
    const banksList = user.bankDetails
      .map((b) => `${b.bankName} (${b.accountNumber})`)
      .join(", ") || "N/A";
    const langLabel = user.language === "am" ? "አማርኛ" : "English";
    const registeredAt = user.createdAt.toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa" });

    const profileLinesEn = [
      "🎉 Congratulations! Here is your Taskifii profile:",
      `• Full Name: ${user.fullName}`,
      `• Phone: ${user.phone}`,
      `• Email: ${user.email}`,
      `• Username: @${user.username}`,
      `• Banks: ${banksList}`,
      `• Language: ${langLabel}`,
      `• Registered: ${registeredAt}`,
      `🔹 Total earned (as Task-Doer): ${user.stats.totalEarned.toFixed(2)} birr`,
      `🔹 Total spent (as Task-Creator): ${user.stats.totalSpent.toFixed(2)} birr`,
      `🔹 Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★   (${user.stats.ratingCount} ratings)`
    ];

    const profileLinesAm = [
      "🎉 እንኳን ደስ አለዎት! ይህ የዎት Taskifii ፕሮፋይል ነው፦",
      `• ሙሉ ስም: ${user.fullName}`,
      `• ስልክ: ${user.phone}`,
      `• ኢሜይል: ${user.email}`,
      `• ተጠቃሚ ስም: @${user.username}`,
      `• ባንኮች: ${banksList}`,
      `• ቋንቋ: ${langLabel}`,
      `• ተመዝግቦበት ቀን: ${registeredAt}`,
      `🔹 እስካሁን የተቀበሉት (በተግዳሮት ተሳታፊ): ${user.stats.totalEarned.toFixed(2)} ብር`,
      `🔹 እስካሁን ያከፈሉት (እንደ ተግዳሮት ፍጻሜ): ${user.stats.totalSpent.toFixed(2)} ብር`,
      `🔹 ኖቬሌሽን: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★   (${user.stats.ratingCount} ግምገማዎች)`
    ];

    const profileText = user.language === "am" ? profileLinesAm.join("\n") : profileLinesEn.join("\n");

    // 1) Send profile post to user with three buttons
    await ctx.reply(
      profileText,
      Markup.inlineKeyboard([
        [buildButton({ en: "Post a Task", am: "ተግዳሮት ልጥፍ" }, "POST_TASK", user.language)],
        [buildButton({ en: "Find a Task", am: "ተግዳሮት ፈልግ" }, "FIND_TASK", user.language)],
        [buildButton({ en: "Edit Profile", am: "ፕሮፋይል አርትዕ" }, "EDIT_PROFILE", user.language)]
      ])
    );

    // 2) Send same profile + stats to admin channel
    const ADMIN_CHANNEL = "-1002310380363";
    const placeholderHistory = "(No past tasks or violations yet. This section will show full activity in future updates.)";

    const adminLinesEn = [
      "📋 **Profile Post for Approval**",
      `• Full Name: ${user.fullName}`,
      `• Phone: ${user.phone}`,
      `• Email: ${user.email}`,
      `• Username: @${user.username}`,
      `• Banks: ${banksList}`,
      `• Language: ${langLabel}`,
      `• Registered: ${registeredAt}`,
      "",
      "---",
      "**Past Activity / History:**",
      placeholderHistory,
      "",
      "**Admin Actions:**"
    ];

    const adminLinesAm = [
      "📋 **መግለጫ ፕሮፋይል ለአስተዳደር ማረጋገጫ**",
      `• ሙሉ ስም: ${user.fullName}`,
      `• ስልክ: ${user.phone}`,
      `• ኢሜይል: ${user.email}`,
      `• ተጠቃሚ ስም: @${user.username}`,
      `• ባንኮች: ${banksList}`,
      `• ቋንቋ: ${langLabel}`,
      `• ተመዝግቦበት ቀን: ${registeredAt}`,
      "",
      "---",
      "**የታሪክ እና ታሪክ ጥቆማ 👉**",
      placeholderHistory,
      "",
      "**የአስተዳደር እርምጃዎች:**"
    ];

    const adminText = user.language === "am" ? adminLinesAm.join("\n") : adminLinesEn.join("\n");

    const adminButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback("Ban User", `ADMIN_BAN_${user._id}`),
        Markup.button.callback("Unban User", `ADMIN_UNBAN_${user._id}`)
      ],
      [
        Markup.button.callback("Contact User", `ADMIN_CONTACT_${user._id}`),
        Markup.button.callback("Give Reviews", `ADMIN_REVIEW_${user._id}`)
      ]
    ]);

    await ctx.telegram.sendMessage(ADMIN_CHANNEL, adminText, {
      parse_mode: "Markdown",
      ...adminButtons
    });

    return;
  });

  bot.action("AGE_NO", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    await User.deleteOne({ telegramId: tgId });
    return ctx.reply(
      user.language === "am" ? TEXT.ageError.am : TEXT.ageError.en
    );
  });

  // ─────────── POST_TASK, FIND_TASK, EDIT_PROFILE placeholders ───────────
  // (Not implemented here; would be next steps.)
  bot.action("POST_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("FIND_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("EDIT_PROFILE", (ctx) => ctx.answerCbQuery());

  // ─────────── Admin Actions (Ban/Unban/Contact/Review) placeholders ────
  bot.action(/ADMIN_BAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_.+/, (ctx) => ctx.answerCbQuery());

    // ─── Express + Webhook Setup ───
  const app = express();
  app.use(express.json());

  // Let Telegraf handle incoming updates and auto-reply
  app.post(`/telegram/${process.env.BOT_TOKEN}`, bot.webhookCallback());

  // Health check for Render
  app.get("/", (_req, res) => res.send("OK"));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, async () => {
    console.log(`✅ Express listening on port ${PORT}`);

    // Register the webhook URL with Telegram
    const hookPath = `/telegram/${process.env.BOT_TOKEN}`;
    const url = `${process.env.RENDER_EXTERNAL_URL}${hookPath}`;
    await bot.telegram.setWebhook(url);
    console.log(`🤖 Webhook set to ${url}`);
  });
}


