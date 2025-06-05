// src/index.js

/**
 * Taskifii Bot: Onboarding & Main Menu (unchanged)
 * — Up through “Bot is up and running”
 * — (This part is exactly what you confirmed as perfect already;
 *    we are not touching any of it.)
 */

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");

// Ensure environment variables are set
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

// Connect to MongoDB Atlas
mongoose
  .connect(process.env.MONGODB_URI, {})
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ------------------------------------
//  Mongoose Schema & Model
// ------------------------------------
const Schema = mongoose.Schema;

const userSchema = new Schema({
  telegramId:     { type: Number, unique: true, required: true },
  onboardingStep: { type: String, required: true }, // "language", "fullName", ..., "completed"
  language:       { type: String, enum: ["en", "am", null], default: null },
  fullName:       { type: String, default: null },
  phone:          { type: String, unique: true, sparse: true, default: null },
  email:          { type: String, unique: true, sparse: true, default: null },
  username:       { type: String, unique: true, sparse: true, default: null },
  bankDetails:    [
    {
      bankName:      String,
      accountNumber: String
    }
  ],
  stats: {
    totalEarned:   { type: Number, default: 0 },
    totalSpent:    { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 }
  },
  createdAt:      { type: Date, default: Date.now }
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
    en: "What is your phone number? (digits only, 5–14 digits)",
    am: "የስልክ ቁጥርዎን ያስገቡ። (ቁጥሮች ብቻ፣ 5–14 ቁጥር)"
  },
  phoneErrorFormat: {
    en: "Please enter a valid phone number (5–14 digits)!",
    am: "እባክዎ ትክክለኛ የስልክ ቁጥር ያስገቡ (5–14 ቁጥሮች)!"
  },
  phoneErrorTaken: {
    en: "Sorry, this phone number is already taken! Please enter another phone number!",
    am: "ይቅርታ፣ ይህ ስልክ ቁጥር አስተጋቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ ስልክ ቁጥር ያስገቡ!"
  },
  askEmail: {
    en: "What is your email address?",
    am: "የኢሜይል አድራሻዎን ያስገቡ።"
  },
  emailErrorFormat: {
    en: "Please enter a proper email address!",
    am: "እባክዎ ትክክለኛ የኢሜይል አድራሻ ያስገቡ!"
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
    en: "You have reached 10 bank entries. Moving on to Terms & Conditions...",
    am: "ወደ 10 ባንኮች ደረሱ። ወደ መመሪያና ሁኔታዎች ይቀይራሉ..."
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
(10) በመቀጠል ያላንተ እነዚህን መመሪያዎች አግኝተሃልና ተቀበልናል ትባላላችሁ.`
  },
  agreeBtn: {
    en: "Agree",
    am: "ተፈቅዷል"
  },
  disagreeBtn: {
    en: "Disagree",
    am: "አልተፈቀደም"
  },
  askAge: {
    en: "Are you 18 or older? Click ‘Yes I am’ or ‘No I’m not.’ (Ethiopian law prohibits under-18 employment.)",
    am: "18 ወይም ከዚህ በላይ ነህ? ‘አዎን ነኝ’ ወይም ‘አይደለም ተብሎ አይቻልም’ ይጫኑ። (የኢትዮጵያ ህግ ከ18 በታች ስራ የማድረግ አደንች አይፈቀድም።)"
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
  },


  // --- Main Menu Texts for Reply Keyboard ---
  mainMenuPrompt: {
    en: "Welcome back! Choose an option below:",
    am: "እንኳን ደግሞ በደህና መጡ! ከዚህ በታች አማራጮችን ይምረጡ።"
  },
  postTaskBtn: {
    en: "Post a Task",
    am: "ተግዳሮት ልጥፍ"
  },
  findTaskBtn: {
    en: "Find a Task",
    am: "ተግዳሮት ፈልግ"
  },
  termsBtn: {
    en: "Terms & Conditions",
    am: "መመሪያና ሁኔታዎች"
  },
  editProfileBtn: {
    en: "Edit Profile",
    am: "ፕሮፋይል አርትዕ"
  },
  languageBtn: {
    en: "Language/ቋንቋ",
    am: "ቋንቋ/Language"
  },
  languageOptionEn: {
    en: "English",
    am: "English"
  },
  languageOptionAm: {
    en: "አማርኛ",
    am: "አማርኛ"
  },
};

// ------------------------------------
//  Helper: buildButton
// ------------------------------------
function buildButton(textObj, callbackData, lang, highlighted = false) {
  if (highlighted) {
    return Markup.button.callback(`✔ ${textObj[lang]}`, `_DISABLED_${callbackData}`);
  }
  return Markup.button.callback(textObj[lang], callbackData);
}

// ------------------------------------
//  Helper: Main Menu Reply Keyboard
// ------------------------------------
function getMainMenuKeyboard(lang) {
  return Markup.keyboard([
    [ TEXT.findTaskBtn[lang], TEXT.postTaskBtn[lang] ],
    [ TEXT.termsBtn[lang],   TEXT.editProfileBtn[lang] ],
    [ TEXT.languageBtn[lang] ]
  ])
    .oneTime(false)
    .resize();
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

    // If user exists and has completed onboarding, show main menu
    if (user && user.onboardingStep === "completed") {
      const lang = user.language || "en";
      return ctx.reply(
        lang === "am"
          ? TEXT.mainMenuPrompt.am
          : TEXT.mainMenuPrompt.en,
        getMainMenuKeyboard(lang)
      );
    }

    // Otherwise, reset or create new user and start onboarding
    if (user) {
      // Reset all profile fields for re‐onboarding
      user.language = null;
      user.fullName = null;
      user.phone = null;
      user.email = null;
      user.username = null;
      user.bankDetails = [];
      user.stats = {
        totalEarned: 0,
        totalSpent: 0,
        averageRating: 0,
        ratingCount: 0
      };
      user.onboardingStep = "language";
      user.createdAt = Date.now();
      await user.save();
    } else {
      user = new User({
        telegramId: tgId,
        onboardingStep: "language"
      });
      await user.save();
    }

    // Send language selection with two inline buttons
    return ctx.reply(
      `${TEXT.chooseLanguage.en}\n${TEXT.chooseLanguage.am}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("English", "LANG_EN"),
          Markup.button.callback("አማርኛ", "LANG_AM")
        ]
      ])
    );
  });

  // ─────────── Language Selection ───────────
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “English”; disable “Amharic”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          Markup.button.callback("✔ English", `_DISABLED_LANG_EN`),
          Markup.button.callback("አማርኛ", `_DISABLED_LANG_AM`)
        ]
      ]
    });

    user.language = "en";
    user.onboardingStep = "setupProfile";
    await user.save();

    // Prompt Setup Profile
    return ctx.reply(
      "Language set to English.",
      Markup.inlineKeyboard([[buildButton(TEXT.setupProfileBtn, "DO_SETUP", "en", false)]])
    );
  });

  bot.action("LANG_AM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("አስቸጋሪ ስሕተት። /start ይደግፉ.");

    // Highlight “Amharic”; disable “English”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          Markup.button.callback("English", `_DISABLED_LANG_EN`),
          Markup.button.callback("✔ አማርኛ", `_DISABLED_LANG_AM`)
        ]
      ]
    });

    user.language = "am";
    user.onboardingStep = "setupProfile";
    await user.save();

    // Prompt Setup Profile
    return ctx.reply(
      "ቋንቋው ወደ አማርኛ ተቀይሯል።",
      Markup.inlineKeyboard([[buildButton(TEXT.setupProfileBtn, "DO_SETUP", "am", false)]])
    );
  });

  // ─────────── “Setup Profile” ───────────
  bot.action("DO_SETUP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Setup Profile”; disable it
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[buildButton(TEXT.setupProfileBtn, "DO_SETUP", user.language, true)]]
    });

    user.onboardingStep = "fullName";
    await user.save();
    return ctx.reply(user.language === "am" ? TEXT.askFullName.am : TEXT.askFullName.en);
  });

  // ─────────── Catch Disabled Buttons ───────────
  bot.action(/_DISABLED_.+/, (ctx) => ctx.answerCbQuery());

  // ─────────── Text Handler (Onboarding & Main Menu) ───────────
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    // If user has completed profile, handle main‐menu reply keyboard
    if (user.onboardingStep === "completed") {
      const lang = user.language || "en";

      // 1) “Find a Task”
      if (text === TEXT.findTaskBtn[lang]) {
        // Trigger same inline‐button flow as inline “FIND_TASK”
        return ctx.reply(
          lang === "am"
            ? "ተግዳሮት ፈልግ ተጠቃሚ ተገልጾ።"
            : "Find a Task feature coming soon!"
        );
      }

      // 2) “Post a Task”
      if (text === TEXT.postTaskBtn[lang]) {
        // We’ll add its logic below (just return for now)
        // The actual “Post a Task” flow is appended after this handler
        return; 
      }

      // 3) “Terms & Conditions”
      if (text === TEXT.termsBtn[lang]) {
        // Immediately send T&C text (no inline buttons needed)
        return ctx.reply(
          user.language === "am"
            ? TEXT.askTerms.am
            : TEXT.askTerms.en
        );
      }

      // 4) “Edit Profile”
      if (text === TEXT.editProfileBtn[lang]) {
        // Trigger inline “EDIT_PROFILE” flow
        // For now, placeholder: inform user it’s coming
        return ctx.reply(
          lang === "am"
            ? "ፕሮፋይል አርትዕ ተቀይሯል። (ፈጣን አድርጉ)"
            : "Edit Profile feature coming soon!"
        );
      }

      // 5) “Language/ቋንቋ”
      if (text === TEXT.languageBtn[lang]) {
        // Swap to two‐button keyboard: “Amharic” and “English”
        return ctx.reply(
          lang === "am"
            ? "ቋንቋ ይምረጡ። / Choose your language."
            : "Please choose your language:",
          Markup.keyboard([
            [ TEXT.languageOptionAm[lang], TEXT.languageOptionEn[lang] ]
          ])
            .oneTime(true)
            .resize()
        );
      }

      // 6) Handle “Amharic” or “English” choice after main menu
      if (text === TEXT.languageOptionAm[lang] || text === TEXT.languageOptionAm["en"]) {
        // User selected Amharic
        user.language = "am";
        await user.save();
        return ctx.reply(
          "ቋንቋ ወደ አማርኛ ተቀይሯል።",
          getMainMenuKeyboard("am")
        );
      }
      if (text === TEXT.languageOptionEn[lang] || text === TEXT.languageOptionEn["am"]) {
        // User selected English
        user.language = "en";
        await user.save();
        return ctx.reply(
          "Language set to English.",
          getMainMenuKeyboard("en")
        );
      }

      // If user clicked any other keyboard button by mistake, re‐show main menu
      return ctx.reply(
        lang === "am"
          ? TEXT.mainMenuPrompt.am
          : TEXT.mainMenuPrompt.en,
        getMainMenuKeyboard(lang)
      );
    }

    // ─── FULL NAME STEP ─────────────────────────
    if (user.onboardingStep === "fullName") {
      if (text.length < 3) {
        return ctx.reply(
          user.language === "am" ? TEXT.fullNameError.am : TEXT.fullNameError.en
        );
      }
      const countSame = await User.countDocuments({ fullName: text });
      user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;

      user.onboardingStep = "phone";
      await user.save();
      return ctx.reply(user.language === "am" ? TEXT.askPhone.am : TEXT.askPhone.en);
    }

    // ─── PHONE STEP ────────────────────────────
    if (user.onboardingStep === "phone") {
      const phoneRegex = /^\+?\d{5,14}$/;
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
      return ctx.reply(user.language === "am" ? TEXT.askEmail.am : TEXT.askEmail.en);
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

      // Prompt for Telegram username
      const currentHandle = ctx.from.username || "";
      const promptText = user.language === "am"
        ? TEXT.askUsername.am.replace("%USERNAME%", currentHandle || "<none>")
        : TEXT.askUsername.en.replace("%USERNAME%", currentHandle || "<none>");
      return ctx.reply(
        promptText,
        Markup.inlineKeyboard([[Markup.button.callback(
          user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
          "USERNAME_KEEP"
        )]])
      );
    }

    // ─── USERNAME STEP (typed override) ─────────────────────────
    if (user.onboardingStep === "username") {
      const reply = text;
      const userHandleRegex = /^[A-Za-z0-9_]{5,}$/;
      if (!userHandleRegex.test(reply)) {
        return ctx.reply(
          user.language === "am" ? TEXT.usernameErrorGeneral.am : TEXT.usernameErrorGeneral.en
        );
      }
      const existingUser = await User.findOne({ username: reply });
      if (existingUser) {
        return ctx.reply(
          user.language === "am" ? TEXT.usernameErrorTaken.am : TEXT.usernameErrorTaken.en
        );
      }

      // Disable the “Yes, keep it” button from the previous message
      try {
        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          ctx.message.message_id - 1,
          null,
          {
            inline_keyboard: [[
              Markup.button.callback(
                user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
                `_DISABLED_USERNAME_KEEP`
              )
            ]]
          }
        );
      } catch (err) {
        // Editing might fail if the message is too old; ignore errors
      }

      user.username = reply;
      user.onboardingStep = "bankFirst";
      await user.save();
      return ctx.reply(user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en);
    }

    // ─── FIRST BANK ENTRY ───────────────────────
    if (user.onboardingStep === "bankFirst") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      // If reached 10, auto-proceed to T&C
      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(user.language === "am" ? TEXT.bankReachedTen.am : TEXT.bankReachedTen.en);
        return ctx.reply(
          user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
            [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
          ])
        );
      }

      // Otherwise show “Add / Replace / Done” buttons
      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([[
          Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
          Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
          Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
        ]])
      );
    }

    // ─── MULTI BANK ENTRY (after clicking Add) ─────────────────
    if (user.onboardingStep === "bankAdding") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(user.language === "am" ? TEXT.bankReachedTen.am : TEXT.bankReachedTen.en);
        return ctx.reply(
          user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
            [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
          ])
        );
      }

      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([[
          Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
          Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
          Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
        ]])
      );
    }

    // ─── MULTI BANK ENTRY (after clicking Replace) ─────────────────
    if (user.onboardingStep === "bankReplacing") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      user.bankDetails.pop();
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(user.language === "am" ? TEXT.bankReachedTen.am : TEXT.bankReachedTen.en);
        return ctx.reply(
          user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
            [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
          ])
        );
      }

      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.bankAddedPrompt.am : TEXT.bankAddedPrompt.en,
        Markup.inlineKeyboard([[
          Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "BANK_ADD"),
          Markup.button.callback(user.language === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
          Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "Done", "BANK_DONE")
        ]])
      );
    }

    // ─── TERMS REVIEW (if user clicked “Disagree” and chooses to review) ─────
    if (user.onboardingStep === "termsReview") {
      return ctx.reply(
        user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
        Markup.inlineKeyboard([
          [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
          [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
        ])
      );
    }

    // If none of the above matched, do nothing (fallback)
  });

  // ─── USERNAME “Yes, keep it” Action ─────────────────────────────────
  bot.action("USERNAME_KEEP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Yes, keep it”; disable it
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "✔ አዎን፣ ይቀበሉ" : "✔ Yes, keep it",
          `_DISABLED_USERNAME_KEEP`
        )
      ]]
    });

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
    return ctx.reply(user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en);
  });

  // ─── BANK “Add” Action ───────────────────────────
  bot.action("BANK_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Add”; disable “Replace” & “Done”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "✔ ጨምር" : "✔ Add",
          `_DISABLED_BANK_ADD`
        ),
        Markup.button.callback(
          user.language === "am" ? "ቀይር" : "Replace",
          `_DISABLED_BANK_REPLACE`
        ),
        Markup.button.callback(
          user.language === "am" ? "ተጠናቋል" : "Done",
          `_DISABLED_BANK_DONE`
        )
      ]]
    });

    user.onboardingStep = "bankAdding";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "እባክዎ አሁን በቅጥ `BankName,AccountNumber` መሆኑን ይጻፉ።"
        : "Please type your bank entry now in the format `BankName,AccountNumber`."
    );
  });

  // ─── BANK “Replace” Action ───────────────────────────
  bot.action("BANK_REPLACE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Replace”; disable “Add” & “Done”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "ጨምር" : "Add",
          `_DISABLED_BANK_ADD`
        ),
        Markup.button.callback(
          user.language === "am" ? "✔ ቀይር" : "✔ Replace",
          `_DISABLED_BANK_REPLACE`
        ),
        Markup.button.callback(
          user.language === "am" ? "ተጠናቋል" : "Done",
          `_DISABLED_BANK_DONE`
        )
      ]]
    });

    user.bankDetails.pop();
    user.onboardingStep = "bankReplacing";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "የባንኩ መጨመሪያ መዝገብ ተሰርዟል። እባክዎ አዲስ መጨመሪያ በ `BankName,AccountNumber` ቅጥ ይዘግቡ።"
        : "Your last bank entry was removed. Please type a new entry in `BankName,AccountNumber` format."
    );
  });

  // ─── BANK “Done” Action ───────────────────────────
  bot.action("BANK_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Done”; disable “Add” & “Replace”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "ጨምር" : "Add",
          `_DISABLED_BANK_ADD`
        ),
        Markup.button.callback(
          user.language === "am" ? "ቀይር" : "Replace",
          `_DISABLED_BANK_REPLACE`
        ),
        Markup.button.callback(
          user.language === "am" ? "✔ ተጠናቋል" : "✔ Done",
          `_DISABLED_BANK_DONE`
        )
      ]]
    });

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
        [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
      ])
    );
  });

  // ─── TERMS & CONDITIONS Actions ────────────────────────────────────
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Agree”; disable “Disagree”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(`✔ ${TEXT.agreeBtn[user.language]}`, `_DISABLED_TC_AGREE`)],
        [Markup.button.callback(`${TEXT.disagreeBtn[user.language]}`, `_DISABLED_TC_DISAGREE`)]
      ]
    });

    user.onboardingStep = "age";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.askAge.am : TEXT.askAge.en,
      Markup.inlineKeyboard([[
        buildButton(TEXT.ageYesBtn, "AGE_YES", user.language, false),
        buildButton(TEXT.ageNoBtn, "AGE_NO", user.language, false)
      ]])
    );
  });

  bot.action("TC_DISAGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Disagree”; disable “Agree”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(`${TEXT.agreeBtn[user.language]}`, `_DISABLED_TC_AGREE`)],
        [Markup.button.callback(`✔ ${TEXT.disagreeBtn[user.language]}`, `_DISABLED_TC_DISAGREE`)]
      ]
    });

    user.onboardingStep = "termsReview";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
        [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
      ])
    );
  });

  // ─── AGE VERIFICATION Actions ────────────────────────────────────
  bot.action("AGE_YES", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Highlight “Yes I am”; disable “No I’m not”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${TEXT.ageYesBtn[user.language]}`, `_DISABLED_AGE_YES`),
        Markup.button.callback(`${TEXT.ageNoBtn[user.language]}`, `_DISABLED_AGE_NO`)
      ]]
    });

    user.onboardingStep = "completed";
    await user.save();

    // Build final profile post
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

    // 1) Send profile to user with persistent main‐menu (Reply Keyboard)
    await ctx.reply(
      profileText,
      getMainMenuKeyboard(user.language)
    );

    // 2) Send to Admin Channel
    const ADMIN_CHANNEL = "-1002310380363";
    const placeholderHistory = "(No past tasks or violations yet.)";
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

    // Highlight “No I’m not”; disable “Yes I am”
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`${TEXT.ageYesBtn[user.language]}`, `_DISABLED_AGE_YES`),
        Markup.button.callback(`✔ ${TEXT.ageNoBtn[user.language]}`, `_DISABLED_AGE_NO`)
      ]]
    });

    // Delete user record and inform them
    await User.deleteOne({ telegramId: tgId });
    return ctx.reply(user.language === "am" ? TEXT.ageError.am : TEXT.ageError.en);
  });

  // ─────────── Placeholder Actions ───────────
  bot.action("POST_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("FIND_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("EDIT_PROFILE", (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_BAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_.+/, (ctx) => ctx.answerCbQuery());

  // ─────────── Bot is up and running ───────────
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });

  // ─────────────────────────────────────────────────────────────────
  // ←  The above code is exactly what you already had (unchanged). 
  //   Below, we add only the “Post a Task” flow (step‐by‐step).
  //   Everything else remains untouched.
  // ─────────────────────────────────────────────────────────────────

  // In‐memory session storage for each user’s in‐progress “Post a Task”
  const postSessions = {};

  function initPostSession(tgId) {
    postSessions[tgId] = {
      description: "",
      relatedFileId: null,
      chosenFields: [],
      skillLevel: "",
      paymentFee: null,
      completionHours: null,
      revisionHours: null,
      latePenalty: null,
      expiryHours: null,
      exchangeStrategy: ""
    };
  }

  // 1) Triggered when user sends “Post a Task” from reply keyboard
  bot.hears((text, ctx) => {
    const tgId = ctx.from.id;
    const userLang = postSessions[tgId]?.language || "en"; // fallback
    // If user.onboardingStep === "completed" AND text matches “Post a Task” in their language
    return text === TEXT.postTaskBtn[userLang];
  }, async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "completed") {
      return ctx.reply(
        user?.language === "am"
          ? "እባክዎ በየማክቲቭ ሂደት መመዝገብ ይጀምሩ ( /start )።"
          : "Please complete onboarding first by typing /start."
      );
    }

    // Initialize post session
    initPostSession(tgId);
    postSessions[tgId].language = user.language;
    user.onboardingStep = "postingDescription";
    await user.save();

    // Ask for Task Description (≥20 chars, ≤1250)
    return ctx.reply(
      user.language === "am"
        ? "ወደ ተግዳሮትዎ መግለጫ ያስገቡ። (አንስተው 20 ቁምፊ መሆኑንና 1250 ቁምፊን እስከሚያህል ያስገቡ)።"
        : "Write the task description. (Be very specific; must be 20–1250 characters.)"
    );
  });

  // 2) Collect Task Description
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingDescription") return;

    const text = ctx.message.text.trim();
    if (text.length < 20 || text.length > 1250) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ መግለጫዎ አንስተው 20 ቁምፊ መሆን እና 1250 ቁምፊ እስከ ልዩው መሆን አለበት። ድጋፍ ይሁን."
          : "Please ensure your description is between 20 and 1250 characters."
      );
    }

    postSessions[tgId].description = text;
    user.onboardingStep = "postingFile";
    await user.save();

    // Ask for related file (or Skip)
    return ctx.reply(
      user.language === "am"
        ? "ከተግዳሮት ጋር ያለውን ፋይል (የቲቪ/ቤት/ዶኩመንት፣ ወዘተ) ከፋይል ውስጥ እንዲሁም በፍጥነት ለመላክ ሊረዳዎት ይችላል። የማይወደው ከሆነ “Skip” ይጫኑ።"
        : "If there’s a related file (photo/video/document), send it here. Otherwise, click “Skip.”"
      ,
      Markup.inlineKeyboard([
        [ Markup.button.callback(user.language === "am" ? "ይዞረኝ" : "Skip", "POST_SKIP_FILE") ]
      ])
    );
  });

  // 3) Collect Related File or Skip
  bot.on("document", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFile") return;

    // Save file_id to session
    postSessions[tgId].relatedFileId = ctx.message.document.file_id;
    user.onboardingStep = "postingFields";
    await user.save();

    // Ask to select fields
    return ctx.reply(
      user.language === "am"
        ? "እባክዎ የተግዳሮትዎን መንፈስ ምድቦች ይምረጡ። ቢያንስ አንድ ይምረጡ።"
        : "Now choose at least one field for your task (up to 10)."
    );
  });

  bot.action("POST_SKIP_FILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFile") return;

    user.onboardingStep = "postingFields";
    await user.save();

    // Ask to select fields
    return ctx.reply(
      user.language === "am"
        ? "እባክዎ የተግዳሮትዎን መንፈስ ምድቦች ይምረጡ። ቢያንስ አንድ ይምረጡ።"
        : "Now choose at least one field for your task (up to 10)."
    );
  });

  // (4) Fields Selection – paginated. We’ll use a simple two‐page example here:
  const FIELDS = [
    "Software Development","Data Science","Design","Writing","Marketing",
    "Sales","Customer Support","Virtual Assistant","Accounting","Consulting",
    // … continue up to 80 fields … 
    "Teaching","Legal","Engineering","Healthcare","Photography"
  ];

  function buildFieldsKeyboard(chosen, page, lang) {
    // Show 10 fields per page
    const perPage = 10;
    const start = page * perPage;
    const end = start + perPage;
    const slice = FIELDS.slice(start, end);
    const rows = slice.map((field) => {
      const label = chosen.includes(field)
        ? `✔ ${field}`
        : field;
      const cbData = chosen.includes(field)
        ? `_DISABLED_FIELD`
        : `FIELD_${field}`;
      return [Markup.button.callback(label, cbData)];
    });

    // Add navigation
    const nav = [];
    if (start > 0) {
      nav.push(Markup.button.callback("< Prev", `FIELD_PAGE_${page - 1}`));
    }
    if (end < FIELDS.length) {
      nav.push(Markup.button.callback("Next >", `FIELD_PAGE_${page + 1}`));
    }
    rows.push(nav);

    // Add “Done” and “Skip” if needed
    rows.push([
      Markup.button.callback(lang === "am" ? "ተጠናቋል" : "Done", "FIELDS_DONE"),
      Markup.button.callback(lang === "am" ? "ይዞረኝ" : "Skip", "FIELDS_SKIP")
    ]);

    return Markup.inlineKeyboard(rows);
  }

  bot.action(/FIELD_PAGE_\d+/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    const lang = user.language;
    const page = parseInt(ctx.match[0].split("_")[2]);
    const chosen = postSessions[tgId].chosenFields || [];
    await ctx.editMessageReplyMarkup(buildFieldsKeyboard(chosen, page, lang));
  });

  bot.action(/FIELD_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    const field = ctx.match[0].replace("FIELD_", "");
    const chosen = postSessions[tgId].chosenFields;
    if (!chosen.includes(field)) {
      chosen.push(field);
    }

    // Re- display page 0 for simplicity; you could store page in session too
    await ctx.editMessageReplyMarkup(buildFieldsKeyboard(chosen, 0, user.language));
  });

  bot.action("FIELDS_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    const chosen = postSessions[tgId].chosenFields;
    if (chosen.length === 0) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ ቢያንስ አንድ ምድብ ይምረጡ።"
          : "You must select at least one field before proceeding."
      );
    }

    user.onboardingStep = "postingSkill";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "የተፈላጊ ክህሎት ደረጃ ይምረጡ።\n• Beginner Level Skill\n• Intermediate Level Skill\n• Professional Level Skill"
        : "Choose your required skill level:\n• Beginner Level Skill\n• Intermediate Level Skill\n• Professional Level Skill",
      Markup.inlineKeyboard([
        [Markup.button.callback(user.language === "am" ? "Beginner Level Skill" : "Beginner Level Skill", "SKILL_BEGINNER")],
        [Markup.button.callback(user.language === "am" ? "Intermediate Level Skill" : "Intermediate Level Skill", "SKILL_INTERMEDIATE")],
        [Markup.button.callback(user.language === "am" ? "Professional Level Skill" : "Professional Level Skill", "SKILL_PROFESSIONAL")]
      ])
    );
  });

  bot.action("FIELDS_SKIP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    // If they skip with zero fields, force them to pick at least one
    return ctx.reply(
      user.language === "am"
        ? "እባክዎ ቢያንስ አንድ ምድብ ይምረጡ።"
        : "You must select at least one field before proceeding."
    );
  });

  // 5) Skill Level Selection
  bot.action(/SKILL_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingSkill") return;

    const chosenSkill = ctx.match[0].replace("SKILL_", "");
    postSessions[tgId].skillLevel = chosenSkill; // “BEGINNER”, “INTERMEDIATE”, or “PROFESSIONAL”
    user.onboardingStep = "postingFee";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? "የክፍያው መጠን (በብር) ያስገቡ። (≥ 50)"
        : "How much is the payment fee amount? (in birr, ≥ 50)"
    );
  });

  // 6) Payment Fee
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingFee") return;

    const amtText = ctx.message.text.trim();
    const num = parseInt(amtText, 10);
    if (isNaN(num) || num < 50) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ ቢያንስ 50 ብር የሆነ ቁጥር ያስገቡ!"
          : "Please enter a valid number ≥ 50 birr."
      );
    }

    postSessions[tgId].paymentFee = num;
    user.onboardingStep = "postingCompletionHours";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "በክፍያ ፈጻሜዎ ስራ መከተል ስንት ሰዓት ያስፈልጋል? (1–120)"
        : "How many hours are required to complete the task? (1–120)"
    );
  });

  // 7) Completion Hours
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingCompletionHours") return;

    const hrsText = ctx.message.text.trim();
    const hrs = parseInt(hrsText, 10);
    if (isNaN(hrs) || hrs < 1 || hrs > 120) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ በ1 እስከ 120 መካከል ቁጥር ያስገቡ!"
          : "Please enter a number between 1 and 120."
      );
    }

    postSessions[tgId].completionHours = hrs;
    user.onboardingStep = "postingRevisionHours";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "ተግዳሮት በውስጥ ተጠናቆ በተጨማሪ ስራ ለማግኘት ስንት ሰዓት ተገቢ ነው? (≤ half of completion hours)"
        : "How many hours for you to review (≤ half of completion hours)?"
    );
  });

  // 8) Revision Hours
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingRevisionHours") return;

    const revText = ctx.message.text.trim();
    const rev = parseInt(revText, 10);
    const maxRev = Math.floor(postSessions[tgId].completionHours / 2);
    if (isNaN(rev) || rev < 0 || rev > maxRev) {
      return ctx.reply(
        user.language === "am"
          ? `እባክዎ በትክክል ቁጥር ያስገቡ (0 እስከ ${maxRev})።`
          : `Please enter a number between 0 and ${maxRev}.`
      );
    }

    postSessions[tgId].revisionHours = rev;
    user.onboardingStep = "postingLatePenalty";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? `በተዘጋጅበት ላይ ተጠናቋል ስራ ካልተደረገ ሰዓት በብር ስንት ይታፈሳል? (≤ ${Math.floor(postSessions[tgId].paymentFee * 0.2)})`
        : `How many birr/hour will be deducted if late? (≤ ${Math.floor(postSessions[tgId].paymentFee * 0.2)})`
    );
  });

  // 9) Late-Penalty
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingLatePenalty") return;

    const penText = ctx.message.text.trim();
    const pen = parseInt(penText, 10);
    const maxPen = Math.floor(postSessions[tgId].paymentFee * 0.2);
    if (isNaN(pen) || pen < 0 || pen > maxPen) {
      return ctx.reply(
        user.language === "am"
          ? `እባክዎ በትክክል ቁጥር ያስገቡ (0 እስከ ${maxPen})።`
          : `Please enter a number between 0 and ${maxPen}.`
      );
    }

    postSessions[tgId].latePenalty = pen;
    user.onboardingStep = "postingExpiry";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "በስንት ሰዓት ውስጥ “Apply” ተጫንለት ተግዳሮት ይሽፈራል? (1–24)"
        : "In how many hours should “Apply” expire? (1–24)"
    );
  });

  // 10) Expiry Hours
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    if (user.onboardingStep !== "postingExpiry") return;

    const expText = ctx.message.text.trim();
    const exp = parseInt(expText, 10);
    if (isNaN(exp) || exp < 1 || exp > 24) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ ቁጥር በ1 እስከ 24 መሆኑን ያረጋግጡ!"
          : "Please enter a number between 1 and 24."
      );
    }

    postSessions[tgId].expiryHours = exp;
    user.onboardingStep = "postingExchangeStrategy";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? "የክፍያ–ተግዳሮት መልዕክት ይምረጡ:\n• 100%\n• 30%:40%:30%\n• 50%:50%"
        : "Choose your payment–task exchange strategy:\n• 100%\n• 30%:40%:30%\n• 50%:50%"
    );
  });

  // 11) Exchange Strategy
  bot.action(/^(100%|30%:40%:30%|50%:50%)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingExchangeStrategy") return;

    const strat = ctx.match[0];
    postSessions[tgId].exchangeStrategy = strat;
    user.onboardingStep = "postingConfirm";
    await user.save();

    // Build preview & confirm/cancel buttons
    const s = postSessions[tgId];
    const fieldsHashtags = s.chosenFields.map((f) => `#${f.replace(/ /g, "")}`).join(" ");
    const expiryDate = new Date(Date.now() + s.expiryHours * 3600 * 1000)
      .toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa", hour12: true });

    const previewEn = [
      "🟢 Task is open!",
      `Task Description: ${s.description}`,
      s.relatedFileId ? "Related File: (sent privately)" : "",
      `Fields: ${fieldsHashtags}`,
      `Skill: ${s.skillLevel}`,
      `Payment Fee: ${s.paymentFee} birr`,
      `Completion Time: ${s.completionHours} hour(s)`,
      `Revision Time: ${s.revisionHours} hour(s)`,
      `Late-Penalty: ${s.latePenalty} birr/hour`,
      `Expiry: ${expiryDate}`,
      `Banks: ${user.bankDetails.map((b) => b.bankName).join(", ")}`,
      `Creator Earned: ${user.stats.totalEarned.toFixed(2)} birr | Spent: ${user.stats.totalSpent.toFixed(2)} birr | Rating: ${ user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A" } ★ (${user.stats.ratingCount})`,
      `Exchange Strategy: ${s.exchangeStrategy}`,
      "",
      "✅ Click “Confirm” to post, or “Cancel” to discard."
    ].filter(Boolean).join("\n");

    const previewAm = [
      "🟢 ተግዳሮቱ ተከፈተ!",
      `የተግዳሮት መግለጫ: ${s.description}`,
      s.relatedFileId ? "የሚገባ ፋይል: (በግል ተልኳል)" : "",
      `ምድቦች: ${fieldsHashtags}`,
      `ክህሎት: ${s.skillLevel}`,
      `ክፍያ: ${s.paymentFee} ብር`,
      `የመጨረሻ ጊዜ: ${s.completionHours} ሰዓት(ሽ)`,
      `የቢሳከስ ጊዜ: ${s.revisionHours} ሰዓት(ሽ)`,
      `ለእድማ አጉዝታ: ${s.latePenalty} ብር/ሰዓት`,
      `መጠፋት ቀን: ${expiryDate}`,
      `ባንኮች: ${user.bankDetails.map((b) => b.bankName).join(", ")}`,
      `ተግዳሮት ያገኙ: ${user.stats.totalEarned.toFixed(2)} ብር | ያከፈሉ: ${user.stats.totalSpent.toFixed(2)} ብር | ግምገማ: ${ user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A" } ★ (${user.stats.ratingCount})`,
      `የክፍያ–ተግዳሮት መልዕክት: ${s.exchangeStrategy}`,
      "",
      "✅ “Confirm” ይጫኑ ተግዳሮቱን ይልክ፤ “Cancel” ይጫኑ ይሰርዝ."
    ].filter(Boolean).join("\n");

    return ctx.reply(
      user.language === "am" ? previewAm : previewEn,
      Markup.inlineKeyboard([
        [ Markup.button.callback(user.language === "am" ? "ማረጋገጫ" : "Confirm", "TASK_POST_CONFIRM") ],
        [ Markup.button.callback(user.language === "am" ? "ተሰርዟል" : "Cancel",      "TASK_POST_CANCEL"  ) ]
      ])
    );
  });

  // 12) Confirm or Cancel Task
  bot.action("TASK_POST_CONFIRM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingConfirm") {
      return ctx.reply("No task in progress to confirm.");
    }

    const s = postSessions[tgId];
    // (Here you would insert into your Tasks collection; omitted for brevity)
    delete postSessions[tgId];
    user.onboardingStep = "completed";
    await user.save();

    ctx.reply(
      user.language === "am"
        ? "ስራዎ ተልኳል። ስለጥቅም በቅርቡ ይመልከቱ።"
        : "Your task has been posted! Check the channel for applicants.",
      getMainMenuKeyboard(user.language)
    );
  });

  bot.action("TASK_POST_CANCEL", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingConfirm") {
      return ctx.reply("No task in progress to cancel.");
    }

    delete postSessions[tgId];
    user.onboardingStep = "completed";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? "ተግዳሮትዎ ተሰርዟል።"
        : "Your task has been canceled.",
      getMainMenuKeyboard(user.language)
    );
  });

  // ─────────── End of “Post a Task” flow additions ───────────
} // end of startBot()
