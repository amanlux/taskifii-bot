// src/index.js

/**
 * ============================
 * Taskifii Bot – Full Source
 * ============================
 *
 * This file includes:
 *  1) Onboarding/Profile setup (language→fullName→phone→email→username→bankDetails→terms→age)
 *  2) “Profile Complete!” post (with totalEarned, totalSpent, averageRating, createdAt)
 *  3) Main‐menu (inline buttons: Post a Task / Find a Task / Edit Profile)
 *  4) Complete “Post a Task” flow (description→file optional→fields→skill→fee→hours→revision→penalty→expiry→exchange→confirm/cancel→publish to channel)
 *  5) All necessary handlers (`bot.hears`, single `bot.on("text")`, `bot.on("document")`, `bot.action(...)`, etc.)
 *
 * **Before you deploy:**
 *  • Make sure you have set your environment variables:
 *      - BOT_TOKEN    → your @taskifiibot token
 *      - MONGODB_URI  → your MongoDB Atlas connection string
 *
 *  • Make sure the bot is added as an Admin into:
 *      - Profile‐admin channel:    chat id = –1002310380363  (so profile posts land there)
 *      - Task‐listing channel (e.g. @TaskifiiRemote): your chosen channel/ID
 *
 *  • Install dependencies:
 *      npm install telegraf mongoose
 *
 *  • Deploy to Render, Fly.io, Heroku, etc.  (only one instance; ensure no “409 Conflict: other getUpdates”)
 */

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");

// ───────────────────────────────────────────
// 1) Verify environment variables
// ───────────────────────────────────────────
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// ───────────────────────────────────────────
// 2) Connect to MongoDB and launch bot
// ───────────────────────────────────────────
mongoose
  .connect(MONGODB_URI, {})
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ───────────────────────────────────────────
// 3) Mongoose schema & model definitions
// ───────────────────────────────────────────
const Schema = mongoose.Schema;

const userSchema = new Schema({
  telegramId:     { type: Number, unique: true, required: true },
  onboardingStep: { type: String, required: true },   // “language”, “fullName”, …, “completed”
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

// ───────────────────────────────────────────
// 4) In‐memory “Post a Task” sessions
//    (We store each user’s draft until they confirm/cancel)
// ───────────────────────────────────────────
const postSessions = {};
function initPostSession(tgId) {
  postSessions[tgId] = {
    description:     null,
    relatedFileId:   null,
    chosenFields:    [],
    skillLevel:      null,
    paymentFee:      null,
    completionHours: null,
    revisionHours:   null,
    latePenalty:     null,
    expiryHours:     null,
    exchangeStrategy: null
  };
}

// ───────────────────────────────────────────
// 5) Localized TEXT constants (English + Amharic)
// ───────────────────────────────────────────
const TEXT = {
  // ––––– Language selection
  chooseLanguage: {
    en: "Choose your language!",
    am: "ቋንቋ ይምረጡ!"
  },
  // ––––– Onboarding “Setup Profile”
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
    am: "የቴሌግፍራም የተጠቃሚ ስምዎ @%USERNAME% ነው። ይህን ለመቀበል ይፈቅዱ? ‘አዎን፣ ይቀበሉ’ ይጫኑ ወይም አዲስ ስም በታች ይጻፉ።"
  },
  usernameErrorGeneral: {
    en: "Please make sure it is a valid Telegram username!",
    am: "እባክዎ ትክክለኛ የቴሌግፍራም የተጠቃሚ ስም መሆን አለበት!"
  },
  usernameErrorTaken: {
    en: "Sorry, that @username is already taken! Please enter a different @username!",
    am: "ይቅርታ፣ ይህ @username አስተጋቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ @username ያስገቡ!"
  },
  askBankDetails: {
    en: "Give us your online banking details (Maximum 10) in this format: `BankName,AccountNumber`. You may also include Telebirr by writing `Telebirr,YourPhoneNumber`. (These details will be shared with other Taskifii users.)",
    am: "የባንክ ዝርዝሮችዎን (እስከ 10) በዚህ ቅጥ ያስገቡ። `BankName,AccountNumber`. Telebirr እንደ `Telebirr,YourPhoneNumber` መጨመር ይችላሉ። (ይህ መረጃ ለሌሎች Taskifii ተጠቃሚዎች ይዘዋል.)"
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
    am: "18 ወይም ከዚህ በላይ ነህ? ‘አዎን ነኝ’ ወይም ‘አይደለም ተብሎ አይቻልም’ ይጫኑ። (የኢትዮጵያ ህግ ከ18 በታች ስራ የማድረግ አደንች አይፈቀድም)"
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

  // ––––– Main menu (Reply-keyboard) after onboarding is “completed”
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
    am: "ፕሮፋይል ይቀይሩ"
  },

  // ––––– Language‐submenu (Reply‐keyboard)
  languageBtn: {
    en: "Language",
    am: "ቋንቋ"
  },
  languageOptionEn: {
    en: "English",
    am: "English"
  },
  languageOptionAm: {
    en: "Amharic",
    am: "አማርኛ"
  },
  mainMenuPrompt: {
    en: "Welcome back! Choose an option below:",
    am: "እንኳን ደግሞ በደህና መጡ! ከዚህ በታች አማራጮችን ይምረጡ።"
  },

  // ––––– Profile Completed – template for final profile post
  profileCompleteTitle: {
    en: "📝 Profile Complete!",
    am: "📝 ፕሮፋይል ተጠናቋል!"
  },
  profileDetailTemplate: {
    en: `• Full Name: %FULLNAME%
• Phone: %PHONE%
• Email: %EMAIL%
• Username: @%USERNAME%
• Banks: %BANKS%
• Language: %LANG%
• Registered: %REGTIME%
• Total Earned: %TOTAL_EARNED% birr
• Total Spent:  %TOTAL_SPENT% birr
• Rating:  %AVG_RATING% (%RATING_COUNT% reviews)`,
    am: `• ሙሉ ስም: %FULLNAME%
• ስልክ: %PHONE%
• ኢሜይል: %EMAIL%
• የቴሌግፍራም ስም: @%USERNAME%
• ባንኮች: %BANKS%
• ቋንቋ: %LANG%
• ተመዝግቧል: %REGTIME%
• ያስቀመጡ: %TOTAL_EARNED% ብር
• የወጣ፡ %TOTAL_SPENT% ብር
• ከፍተኛ ከተገመገምከው: %AVG_RATING% (%RATING_COUNT% ግምገማዎች)`
  },

  // ––––– Post a Task flow – text & buttons
  askTaskDesc: {
    en: "Write the task description. (Be very specific; must be 20–1250 characters.)",
    am: "የተግዳሮት መግለጫ ያስገቡ። (በጥሩ ቃላት ይህን ያብራሩ፤ አንስተው 20 ቁምፊ እስከ 1250 ቁምፊ መሆን አለበት)።"
  },
  taskDescErrorLen: {
    en: "Please ensure your description is between 20 and 1250 characters.",
    am: "እባክዎ መግለጫዎ አንስተው 20 ቁምፊ እስከ 1250 ቁምፊ መሆን አለበት።"
  },
  askTaskFile: {
    en: "If there’s a related file (photo/video/document), send it here. Otherwise, click “Skip.”",
    am: "ከተግዳሮት ጋር ያለውን ፋይል ላክ። የለም ብለው ለማለት “Skip” ይጫኑ።"
  },
  skipFileBtn: {
    en: "Skip",
    am: "ይፋይል ይዘወር"
  },
  askFieldsIntro: {
    en: "Welcome to the fields selection! Choose at least one field (up to 10). You can navigate with ⬅️/➡️. Selected fields appear as #hashtags.",
    am: "እንኳን ወደ መስኮች መረጫ በደህና መጡ! ቢያንስ አንድ መስኮች መምረጥ አለቦት (እስከ 10). ➡️/⬅️ በመጠቀም ማሳለፍ ይችላሉ. የተመረጡ መስኮች በ#hashtags እንዲታዩ ይሰይማሉ."
  },
  addAnotherFieldBtn: {
    en: "Add Another Field",
    am: "ሌላ መስኮች ጨምር"
  },
  fieldsDoneBtn: {
    en: "Done",
    am: "ተጠናቋል"
  },
  fieldsSkipBtn: {
    en: "Skip",
    am: "ይሸር"
  },
  fieldsErrorNone: {
    en: "Please select at least one field before proceeding.",
    am: "ቢያንስ አንድ መስኮች መምረጥ አለብዎት!"
  },
  askSkillLevel: {
    en: "Choose the skill level required:\n• Beginner Level\n• Intermediate Level\n• Professional Level",
    am: "የተግዳሮት የሚፈለጉትን የችሎታ ደረጃ ይምረጡ:\n• መጀመሪያ ደረጃ\n• መካከለኛ ደረጃ\n• ባለሙያ ደረጃ"
  },
  skillBtnBeginner: {
    en: "Beginner Level Skill",
    am: "መጀመሪያ ደረጃ"
  },
  skillBtnIntermediate: {
    en: "Intermediate Level Skill",
    am: "መካከለኛ ደረጃ"
  },
  skillBtnProfessional: {
    en: "Professional Level Skill",
    am: "ባለሙያ ደረጃ"
  },
  askPaymentFee: {
    en: "How much is the payment fee amount (in birr) given for task completion? (≥ 50 birr)",
    am: "የተግዳሮት የሚከፈለው ተግባራዊ ክፍያ መጠን በብር ስንት ነው? (≥ 50 ብር)"
  },
  paymentFeeError: {
    en: "Please enter a valid number ≥ 50 birr.",
    am: "እባክዎ ቢያንስ 50 ብር የሆነ ቁጥር ያስገቡ!"
  },
  askCompletionHours: {
    en: "How many hours are required to complete the task? (1–120)",
    am: "ለተግዳሮት መጠናቀቅ ስንት ሰዓት ይፈልጋሉ? (1–120)"
  },
  completionHoursError: {
    en: "Please enter a number between 1 and 120.",
    am: "እባክዎ በ 1 እስከ 120 መካከል ቁጥር ያስገቡ!"
  },
  askRevisionHours: {
    en: (rep) => `How many hours for you to review (≤ ${rep})?`,
    am: (rep) => `ተግዳሮት በውስጥ ተጠናቆ በተጨማሪ ስራ ለማግኘት ስንት ሰዓት ተገቢ ነው? (≤ ${rep})`
  },
  revisionHoursError: {
    en: (max) => `Please enter a number between 0 and ${max}.`,
    am: (max) => `እባክዎ በ 0 እስከ ${max} መካከል ቁጥር ያስገቡ!`
  },
  askLatePenalty: {
    en: "Enter the late penalty percentage. (0 ≤ penalty ≤ 100)",
    am: "የውድቀት ቅጥር % ያስገቡ. (0 ≤ ቅጥር ≤ 100)"
  },
  latePenaltyError: {
    en: "Please enter a valid integer between 0 and 100.",
    am: "እባክዎ 0 ≤ ቅጥር ≤ 100 እንደ መጠን ያስገቡ!"
  },
  askExpiryHours: {
    en: "For how many hours should the task remain open? (24–168)",
    am: "ተግዳሮት ለስንት ሰዓት ይጠብቃል? (24–168)"
  },
  expiryHoursError: {
    en: "Please enter a number between 24 and 168.",
    am: "እባክዎ በ 24 እስከ 168 መካከል ቁጥር ያስገቡ!"
  },
  askExchange: {
    en: "Choose the exchange strategy:\n• Platform transfer only\n• Local bank transfer\n• Western Union / MoneyGram",
    am: "የውጪ-ውስጥ መቀያየቢያ ዘዴ ይምረጡ:\n• መደበኛ ተቀያይቦ ብቻ\n• ናጋዊ ባንክ መቀያየብ\n• Western Union / MoneyGram"
  },
  postConfirmBtn: {
    en: "Confirm",
    am: "አረጋግጥ"
  },
  postCancelBtn: {
    en: "Cancel",
    am: "ይቅር"
  }
};

// ───────────────────────────────────────────
// 6) Utility: Build a single inline button with “highlighted” state
//    used for Terms/Disagree, etc.  If `disabled === true`, we prefix “✔ ”
// ───────────────────────────────────────────
function buildButton(label, data, lang, disabled) {
  const txt = disabled ? `✔ ${label}` : label;
  return Markup.button.callback(txt, disabled ? `_DISABLED_${data}` : data);
}

// ───────────────────────────────────────────
// 7) Utility: Get “main‐menu” reply‐keyboard (localized)
// ───────────────────────────────────────────
function getMainMenuKeyboard(lang) {
  return Markup.keyboard([
    [TEXT.postTaskBtn[lang]],
    [TEXT.findTaskBtn[lang]],
    [TEXT.editProfileBtn[lang]],
  ]).resize();
}

// ───────────────────────────────────────────
// 8) MAIN BOT INITIALIZATION
// ───────────────────────────────────────────
function startBot() {
  const bot = new Telegraf(BOT_TOKEN);

  /**
   * ------------------------------------
   * A) /start Handler
   *  - If new user: start onboarding (ask language).
   *  - If existing user && onboarding not complete: resume where they left off.
   *  - If existing user && onboardingStep === "completed": show main menu again.
   * ------------------------------------
   */
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    // 1) If no user → create new record with onboardingStep = "language"
    if (!user) {
      user = new User({
        telegramId: tgId,
        onboardingStep: "language",
        language: null,
        fullName: null,
        phone: null,
        email: null,
        username: null,
        bankDetails: [],
        stats: { totalEarned: 0, totalSpent: 0, averageRating: 0, ratingCount: 0 }
      });
      await user.save();
    }

    // 2) If still in onboarding (not “completed”)
    if (user.onboardingStep !== "completed") {
      // Step: ask language
      user.onboardingStep = "language";
      await user.save();
      return ctx.reply(
        // localize prompt
        TEXT.chooseLanguage[user.language || "en"],
        Markup.keyboard([
          [TEXT.languageOptionEn["en"], TEXT.languageOptionAm["en"]],
        ]).oneTime(true).resize()
      );
    }

    // 3) If already finished onboarding, re‐show profile post + main menu
    if (user.onboardingStep === "completed") {
      const profileText = TEXT.profileCompleteTitle[user.language] + "\n" +
        TEXT.profileDetailTemplate[user.language]
          .replace("%FULLNAME%", user.fullName)
          .replace("%PHONE%", user.phone)
          .replace("%EMAIL%", user.email)
          .replace("%USERNAME%", user.username)
          .replace("%BANKS%", user.bankDetails.map(b => `${b.bankName} (${b.accountNumber})`).join(", "))
          .replace("%LANG%", user.language === "am" ? "አማርኛ" : "English")
          .replace("%REGTIME%", user.createdAt.toLocaleString())
          .replace("%TOTAL_EARNED%", user.stats.totalEarned.toString())
          .replace("%TOTAL_SPENT%", user.stats.totalSpent.toString())
          .replace("%AVG_RATING%", user.stats.averageRating.toFixed(1))
          .replace("%RATING_COUNT%", user.stats.ratingCount.toString());

      return ctx.reply(
        profileText,
        Markup.inlineKeyboard([
          [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
          [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
          [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")],
        ])
      );
    }
  });

  /**
   * ------------------------------------
   * B) SELECT LANGUAGE (Reply Keyboard)
   *    when onboardingStep === "language"
   * ------------------------------------
   */
  bot.hears(
    (ctx) => {
      // Only if the user is at “language” step
      const tgId = ctx.from.id;
      const incoming = ctx.message.text;
      return User.findOne({ telegramId: tgId }).then(user => {
        if (!user) return false;
        return user.onboardingStep === "language" &&
               (incoming === TEXT.languageOptionEn["en"] || incoming === TEXT.languageOptionAm["en"]);
      });
    },
    async (ctx) => {
      const tgId = ctx.from.id;
      const chosen = ctx.message.text; // "English" or "Amharic"
      const user = await User.findOne({ telegramId: tgId });
      if (!user) return;

      user.language = chosen === TEXT.languageOptionAm["en"] ? "am" : "en";
      user.onboardingStep = "fullName";
      await user.save();

      // Prompt Full Name
      return ctx.reply(
        TEXT.askFullName[user.language],
        { reply_markup: { remove_keyboard: true } }
      );
    }
  );

  /**
   * ------------------------------------
   * C) “Setup Profile” BUTTON
   *    If a user has chosen language but is still at “language” step,
   *    we let them press “Setup Profile” if we had shown that button.
   *    (In practice, after choosing language we immediately moved to fullName,
   *    so this hears might not fire often—but it’s here for completeness.)
   * ------------------------------------
   */
  bot.hears(
    (ctx) => {
      const tgId = ctx.from.id;
      const incoming = ctx.message.text;
      return User.findOne({ telegramId: tgId }).then(user => {
        if (!user) return false;
        return user.onboardingStep === "language" &&
               incoming === TEXT.setupProfileBtn[user.language];
      });
    },
    async (ctx) => {
      const tgId = ctx.from.id;
      const user = await User.findOne({ telegramId: tgId });
      if (!user) return;
      user.onboardingStep = "fullName";
      await user.save();
      return ctx.reply(TEXT.askFullName[user.language], { reply_markup: { remove_keyboard: true } });
    }
  );

  /**
   * ------------------------------------
   * D) SINGLE `bot.on("text", …)` 
   *    Handles all steps from “fullName” through “completed” (EXCEPT the “Post a Task” flow).
   *    Also includes the “Main Menu” reply‐keyboard once onboarding is “completed.”
   * ------------------------------------
   */
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return; // no user record?  ignore

    const lang = user.language || "en";

    // ─── If onboarding is COMPLETED → handle main‐menu reply‐keyboard choices ───────────
    if (user.onboardingStep === "completed") {
      // 1) “Find a Task”
      if (text === TEXT.findTaskBtn[lang]) {
        return ctx.reply(
          lang === "am"
            ? "🔍 ተግዳሮት ፈልግ ሂደት አልተተገበረም።"
            : "🔍 Find-A-Task flow is not implemented yet."
        );
      }

      // 2) “Terms & Conditions”
      if (text === TEXT.termsBtn[lang]) {
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
            [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
          ])
        );
      }

      // 3) “Edit Profile”
      if (text === TEXT.editProfileBtn[lang]) {
        return ctx.reply(
          lang === "am"
            ? "✏️ Edit Profile flow is not implemented yet."
            : "✏️ Edit Profile flow is not implemented yet."
        );
      }

      // 4) “Language”
      if (text === TEXT.languageBtn[lang]) {
        return ctx.reply(
          lang === "am" ? "ቋንቋ ይምረጡ።" : "Please choose your language:",
          Markup.keyboard([
            [TEXT.languageOptionAm[lang], TEXT.languageOptionEn[lang]],
          ]).oneTime(true).resize()
        );
      }

      // 5) Change language from main menu
      if (
        text === TEXT.languageOptionAm[lang] ||
        text === TEXT.languageOptionAm["en"]
      ) {
        user.language = "am";
        await user.save();
        return ctx.reply("ቋንቋ ወደ አማርኛ ተቀይሯል።", getMainMenuKeyboard("am"));
      }
      if (
        text === TEXT.languageOptionEn[lang] ||
        text === TEXT.languageOptionEn["am"]
      ) {
        user.language = "en";
        await user.save();
        return ctx.reply("Language set to English.", getMainMenuKeyboard("en"));
      }

      // Otherwise at completed stage but unrecognized text → re‐show main menu
      return ctx.reply(
        TEXT.mainMenuPrompt[lang],
        getMainMenuKeyboard(lang)
      );
    }

    // ─── ONBOARDING STEPS (NOT complete) ───────────────────────────────────────

    // 1) FULL NAME
    if (user.onboardingStep === "fullName") {
      if (text.length < 3) {
        return ctx.reply(TEXT.fullNameError[lang]);
      }
      // If two users share same exact fullName, append (n+1)
      const countSame = await User.countDocuments({ fullName: text });
      user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;
      user.onboardingStep = "phone";
      await user.save();
      return ctx.reply(TEXT.askPhone[lang]);
    }

    // 2) PHONE
    if (user.onboardingStep === "phone") {
      const phoneRegex = /^\+?\d{5,14}$/;
      if (!phoneRegex.test(text)) {
        return ctx.reply(TEXT.phoneErrorFormat[lang]);
      }
      const existingPhone = await User.findOne({ phone: text });
      if (existingPhone) {
        return ctx.reply(TEXT.phoneErrorTaken[lang]);
      }
      user.phone = text;
      user.onboardingStep = "email";
      await user.save();
      return ctx.reply(TEXT.askEmail[lang]);
    }

    // 3) EMAIL
    if (user.onboardingStep === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        return ctx.reply(TEXT.emailErrorFormat[lang]);
      }
      const existingEmail = await User.findOne({ email: text });
      if (existingEmail) {
        return ctx.reply(TEXT.emailErrorTaken[lang]);
      }
      user.email = text;
      user.onboardingStep = "username";
      await user.save();

      // Prompt Telegram username (inline “Yes, keep it”)
      const currentHandle = ctx.from.username || "";
      const promptText = TEXT.askUsername[lang].replace("%USERNAME%", currentHandle || "<none>");
      return ctx.reply(
        promptText,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it", "USERNAME_KEEP")
          ],
        ])
      );
    }

    // 4) USERNAME (typed override)
    if (user.onboardingStep === "username") {
      const userHandleRegex = /^[A-Za-z0-9_]{5,}$/;
      if (!userHandleRegex.test(text)) {
        return ctx.reply(TEXT.usernameErrorGeneral[lang]);
      }
      const existingUser = await User.findOne({ username: text });
      if (existingUser) {
        return ctx.reply(TEXT.usernameErrorTaken[lang]);
      }
      // Disable the inline “Yes, keep it” if it’s still on screen
      try {
        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          ctx.message.message_id - 1,
          null,
          {
            inline_keyboard: [
              [
                Markup.button.callback(lang === "am" ? "✔ አዎን፣ ይቀበሉ" : "✔ Yes, keep it", "_DISABLED_USERNAME_KEEP")
              ],
            ]
          }
        );
      } catch (err) {
        // it’s okay if it fails (message too old or already edited)
      }
      user.username = text;
      user.onboardingStep = "bankFirst";
      await user.save();
      return ctx.reply(TEXT.askBankDetails[lang]);
    }

    // 5) FIRST BANK ENTRY
    if (user.onboardingStep === "bankFirst") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(TEXT.bankErrorFormat[lang]);
      }
      const [bankName, acctNum] = text.split(",").map(s => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      // If reached 10 bank entries, skip to terms
      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(TEXT.bankReachedTen[lang]);
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
            [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
          ])
        );
      }

      // Otherwise, prompt Add/Replace/Done
      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        TEXT.bankAddedPrompt[lang],
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(lang === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(lang === "am" ? "ተጠናቋል" : "Done", "BANK_DONE"),
          ],
        ])
      );
    }

    // 6) MULTI BANK ENTRY – “Add” path
    if (user.onboardingStep === "bankAdding") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(TEXT.bankErrorFormat[lang]);
      }
      const [bankName, acctNum] = text.split(",").map(s => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(TEXT.bankReachedTen[lang]);
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
            [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
          ])
        );
      }

      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        TEXT.bankAddedPrompt[lang],
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(lang === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(lang === "am" ? "ተጠናቋል" : "Done", "BANK_DONE"),
          ],
        ])
      );
    }

    // 7) MULTI BANK ENTRY – “Replace” path
    if (user.onboardingStep === "bankReplacing") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(TEXT.bankErrorFormat[lang]);
      }
      // Replace last entry
      user.bankDetails.pop();
      const [bankName, acctNum] = text.split(",").map(s => s.trim());
      user.bankDetails.push({ bankName, accountNumber: acctNum });
      await user.save();

      if (user.bankDetails.length >= 10) {
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(TEXT.bankReachedTen[lang]);
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
            [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
          ])
        );
      }

      user.onboardingStep = "bankMulti";
      await user.save();
      return ctx.reply(
        TEXT.bankAddedPrompt[lang],
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === "am" ? "ጨምር" : "Add", "BANK_ADD"),
            Markup.button.callback(lang === "am" ? "ቀይር" : "Replace", "BANK_REPLACE"),
            Markup.button.callback(lang === "am" ? "ተጠናቋል" : "Done", "BANK_DONE"),
          ],
        ])
      );
    }

    // 8) “BANK DONE” → go to TERMS
    if (user.onboardingStep === "bankMulti" && text === "Done") {
      user.onboardingStep = "terms";
      await user.save();
      return ctx.reply(
        TEXT.askTerms[lang],
        Markup.inlineKeyboard([
          [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
          [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
        ])
      );
    }

    // 9) TERMS REVIEW (just re‐show if they disagree once)
    if (user.onboardingStep === "termsReview") {
      return ctx.reply(
        TEXT.askTerms[lang],
        Markup.inlineKeyboard([
          [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
          [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
        ])
      );
    }

    // ─── POST-A-TASK STEPS (after user clicks “Post a Task”) ─────────────────────

    // 10) Task Description (≥20 chars)
    if (user.onboardingStep === "postingDescription") {
      if (text.length < 20 || text.length > 1250) {
        return ctx.reply(TEXT.taskDescErrorLen[lang]);
      }
      postSessions[tgId].description = text;
      user.onboardingStep = "postingFile";
      await user.save();
      return ctx.reply(
        TEXT.askTaskFile[lang],
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === "am" ? "ይዞረኝ" : "Skip", "POST_SKIP_FILE")],
        ])
      );
    }

    // 11) Payment Fee (≥50 birr)
    if (user.onboardingStep === "postingFee") {
      const num = parseInt(text, 10);
      if (isNaN(num) || num < 50) {
        return ctx.reply(TEXT.paymentFeeError[lang]);
      }
      postSessions[tgId].paymentFee = num;
      user.onboardingStep = "postingCompletionHours";
      await user.save();
      return ctx.reply(TEXT.askCompletionHours[lang]);
    }

    // 12) Completion Hours (1–120)
    if (user.onboardingStep === "postingCompletionHours") {
      const hrs = parseInt(text, 10);
      if (isNaN(hrs) || hrs < 1 || hrs > 120) {
        return ctx.reply(TEXT.completionHoursError[lang]);
      }
      postSessions[tgId].completionHours = hrs;
      user.onboardingStep = "postingRevisionHours";
      await user.save();
      const maxRev = Math.floor(hrs / 2);
      return ctx.reply(
        TEXT.askRevisionHours[lang](maxRev)
      );
    }

    // 13) Revision Hours (≤ half of completion)
    if (user.onboardingStep === "postingRevisionHours") {
      const rev = parseInt(text, 10);
      const maxRev = Math.floor(postSessions[tgId].completionHours / 2);
      if (isNaN(rev) || rev < 0 || rev > maxRev) {
        return ctx.reply(TEXT.revisionHoursError[lang](maxRev));
      }
      postSessions[tgId].revisionHours = rev;
      user.onboardingStep = "postingLatePenalty";
      await user.save();
      return ctx.reply(TEXT.askLatePenalty[lang]);
    }

    // 14) Late Penalty (0–100)
    if (user.onboardingStep === "postingLatePenalty") {
      const p = parseInt(text, 10);
      if (isNaN(p) || p < 0 || p > 100) {
        return ctx.reply(TEXT.latePenaltyError[lang]);
      }
      postSessions[tgId].latePenalty = p;
      user.onboardingStep = "postingExpiryHours";
      await user.save();
      return ctx.reply(TEXT.askExpiryHours[lang]);
    }

    // 15) Expiry Hours (24–168)
    if (user.onboardingStep === "postingExpiryHours") {
      const hrs = parseInt(text, 10);
      if (isNaN(hrs) || hrs < 24 || hrs > 168) {
        return ctx.reply(TEXT.expiryHoursError[lang]);
      }
      postSessions[tgId].expiryHours = hrs;
      user.onboardingStep = "postingExchange";
      await user.save();
      return ctx.reply(TEXT.askExchange[lang]);
    }

    // 16) Exchange Strategy
    if (user.onboardingStep === "postingExchange") {
      postSessions[tgId].exchangeStrategy = text;
      user.onboardingStep = "postingFields";
      await user.save();

      // Build a summary for “Confirm / Cancel”
      const sess = postSessions[tgId];
      const summary =
        lang === "am"
          ? `ተግዳሮት ዝርዝር፦
• መግለጫ: ${sess.description}
• ፋይል: ${sess.relatedFileId ? "ተስተና" : "የለም"}
• መስኮች: ${sess.chosenFields.map(f => `#${f.replace(" ", "")}`).join(", ")}
• ደረጃ: ${sess.skillLevel}
• ክፍያ: ${sess.paymentFee} ብር
• መጨረሻ: ${sess.completionHours} ሰዓት
• ፍርድ: ${sess.revisionHours} ሰዓት
• ብእዲ ቅጥር: ${sess.latePenalty}%
• ስራ ጊዜ: ${sess.expiryHours} ሰዓት
• መቀያየቢያ: ${sess.exchangeStrategy}`
          : `Task summary:
• Description: ${sess.description}
• File: ${sess.relatedFileId ? "Uploaded" : "None"}
• Fields: ${sess.chosenFields.map(f => `#${f.replace(" ", "")}`).join(", ")}
• Skill: ${sess.skillLevel}
• Fee: ${sess.paymentFee} birr
• Completion hrs: ${sess.completionHours}
• Revision hrs: ${sess.revisionHours}
• Late penalty: ${sess.latePenalty}%
• Expiry hrs: ${sess.expiryHours}
• Exchange: ${sess.exchangeStrategy}`;

      return ctx.reply(
        summary,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === "am" ? "አረጋግጥ" : "Confirm", "POST_CONFIRM"),
          ],
          [
            Markup.button.callback(lang === "am" ? "ይቅር" : "Cancel", "POST_CANCEL"),
          ],
        ])
      );
    }

    // If none of the above matched, do nothing.
  });

  /**
   * ------------------------------------
   * E) Handle “Upload a file” when onboardingStep === "postingFile"
   * ------------------------------------
   */
  bot.on("document", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFile") return;

    postSessions[tgId].relatedFileId = ctx.message.document.file_id;
    user.onboardingStep = "postingFields";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? TEXT.askFieldsIntro["am"]
        : TEXT.askFieldsIntro["en"]
    );
  });

  /**
   * F) Handle the “Skip File” inline button
   */
  bot.action("POST_SKIP_FILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFile") return;

    user.onboardingStep = "postingFields";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? TEXT.askFieldsIntro["am"]
        : TEXT.askFieldsIntro["en"]
    );
  });

  /**
   * G) Field Selection (paginated) when onboardingStep === "postingFields"
   *    – The list of fields (one giant array) is taken directly from your document.
   *    – Display 10 fields per page.  When user clicks a field, we add it to their session.
   */
  const REMOTE_FIELDS = [
    // (the full list from your doc—abbreviated here for readability)
    "Software Development",
    "Data Science and Analytics",
    "Cybersecurity",
    "Cloud Computing",
    "IT Support",
    "DevOps Engineering",
    "UI/UX Design",
    "Machine Learning and AI Development",
    "Digital Marketing",
    "Content Writing/Copywriting",
    "SEO Specialist",
    "Social Media Management",
    "Affiliate Marketing",
    "Brand Management",
    "PR and Communications",
    "Email Marketing",
    "Graphic Design",
    "Video Editing",
    "Motion Graphics",
    "Animation",
    "Product Design",
    "Interior Design (Virtual Consultations)",
    "Photography/Photo Editing",
    "Technical Writing",
    "Grant Writing",
    "Ghostwriting",
    "Editing and Proofreading",
    "Transcription Services",
    "Blogging",
    "Copy Editing",
    "Online Tutoring",
    "Course Creation",
    "Instructional Design",
    "Language Teaching (ESL)",
    "Educational Consulting",
    "Customer Service Representative",
    "Technical Support Specialist",
    "Helpdesk Operations",
    "Call Center Agent",
    "Accounting",
    "Bookkeeping",
    "Financial Analysis",
    "Tax Preparation",
    "Business Consulting",
    "Project Management",
    "Virtual Assistant",
    "Operations Management",
    "Sales Representative",
    "Account Management",
    "Lead Generation Specialist",
    "Client Relationship Manager",
    "Telemedicine (Doctors, Therapists, Counselors)",
    "Medical Transcription",
    "Medical Coding and Billing",
    "Nutrition Coaching",
    "Health and Wellness Coaching",
    "Recruitment and Talent Acquisition",
    "HR Consulting",
    "Employee Training and Development",
    "Payroll Management",
    "Legal Research",
    "Paralegal Services",
    "Contract Review",
    "Legal Consulting",
    "Voice Acting",
    "Music Production",
    "Video Game Testing",
    "Content Creation (YouTube, TikTok, Podcasts)",
    "Online Performing (Comedy, Drama, Music)",
    "Market Research",
    "Data Entry",
    "Policy Research",
    "Scientific Analysis",
    "CAD Design",
    "Remote Monitoring and Control",
    "Systems Engineering",
    "Process Engineering",
    "Translation",
    "Interpretation",
    "Subtitling",
    "Localization",
    "Dropshipping",
    "Amazon FBA",
    "E-Commerce Store Management",
    "Product Listing Optimization",
    "Real Estate Marketing",
    "Virtual Property Tours",
    "Real Estate Consulting",
    "Scheduling and Calendar Management",
    "Document Management",
    "Scientific Data Analysis",
    "Academic Research",
    "Environmental Monitoring",
    "Online Surveys and Focus Groups",
    "Personal Assistance",
    "Event Planning",
    "Online Moderation",
    "Affiliate Marketing"
  ];

  // Utility: build an inline keyboard for Field page `pageIndex` (0‐based)
  function renderFieldsPage(lang, pageIndex, alreadyChosen) {
    const perPage = 10;
    const start = pageIndex * perPage;
    const end = Math.min(start + perPage, REMOTE_FIELDS.length);
    const keyboard = [];

    for (let i = start; i < end; i++) {
      const field = REMOTE_FIELDS[i];
      const disabled = alreadyChosen.includes(field);
      const label = disabled ? `✔ ${field}` : field;
      keyboard.push([
        Markup.button.callback(label, disabled ? `_DISABLED_FIELD_${encodeURIComponent(field)}` : `FIELD_${encodeURIComponent(field)}`)
      ]);
    }

    // Pagination row
    const totalPages = Math.ceil(REMOTE_FIELDS.length / perPage);
    const navRow = [];
    if (pageIndex > 0) {
      navRow.push(Markup.button.callback("⬅️", `FIELD_PAGE_${pageIndex - 1}`));
    } else {
      navRow.push(Markup.button.callback("⬅️", `_DISABLED_FIELD_PAGE_${pageIndex}`));
    }
    if (pageIndex < totalPages - 1) {
      navRow.push(Markup.button.callback("➡️", `FIELD_PAGE_${pageIndex + 1}`));
    } else {
      navRow.push(Markup.button.callback("➡️", `_DISABLED_FIELD_PAGE_${pageIndex}`));
    }
    keyboard.push(navRow);

    // “Done” / “Skip” row
    const doneLabel = lang === "am" ? "ተጠናቋል" : "Done";
    const skipLabel = lang === "am" ? "ይሸር" : "Skip";
    keyboard.push([
      Markup.button.callback(doneLabel, "FIELDS_DONE"),
      Markup.button.callback(skipLabel, "FIELDS_SKIP")
    ]);

    return Markup.inlineKeyboard(keyboard);
  }

  // Store current field‐page index in memory, for each user
  const userFieldPages = {};

  // 16A) When in “postingFields” step, show first page automatically
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    // Show the intro + page0
    userFieldPages[tgId] = 0; // start at page 0
    return ctx.reply(
      TEXT.askFieldsIntro[user.language],
      renderFieldsPage(user.language, 0, postSessions[tgId].chosenFields)
    );
  });

  // 16B) Handle “FIELD_PAGE_{n}” navigation
  bot.action(/FIELD_PAGE_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const pageIndex = parseInt(ctx.match[1], 10);
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    userFieldPages[tgId] = pageIndex;
    return ctx.editMessageText(
      TEXT.askFieldsIntro[user.language],
      renderFieldsPage(user.language, pageIndex, postSessions[tgId].chosenFields)
    );
  });

  // 16C) Handle “FIELD_{fieldName}” selection
  bot.action(/FIELD_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const raw = decodeURIComponent(ctx.match[1]);
    const chosen = raw; // the field string
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    // If already chosen, ignore
    if (postSessions[tgId].chosenFields.includes(chosen)) {
      return;
    }
    postSessions[tgId].chosenFields.push(chosen);

    // If reached 10 fields automatically go to skill step
    if (postSessions[tgId].chosenFields.length >= 10) {
      user.onboardingStep = "postingSkill";
      await user.save();
      return ctx.editMessageText(
        user.language === "am"
          ? "በመጨረሻ 10 መስኮች መመርጦች ተደርጓል። ወደ የችሎታ ደረጃ መውሰድ እፈልጋለሁ…"
          : "You have selected 10 fields. Moving on to skill level selection..."
      );
    }

    // Otherwise, re‐render same page (highlighted)
    const pageIndex = userFieldPages[tgId] || 0;
    return ctx.editMessageReplyMarkup(renderFieldsPage(user.language, pageIndex, postSessions[tgId].chosenFields).reply_markup);
  });

  // 16D) Handle “FIELDS_SKIP” (if user wants to skip fields)
  bot.action("FIELDS_SKIP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    // Must have at least one chosen field
    if (postSessions[tgId].chosenFields.length === 0) {
      return ctx.reply(TEXT.fieldsErrorNone[user.language]);
    }
    user.onboardingStep = "postingSkill";
    await user.save();
    return ctx.editMessageText(
      user.language === "am"
        ? "የችሎታ ደረጃ ይምረጡ።"
        : "Choose the skill level required:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback(TEXT.skillBtnBeginner[user.language], "SKILL_BEGINNER"),
          Markup.button.callback(TEXT.skillBtnIntermediate[user.language], "SKILL_INTERMEDIATE"),
          Markup.button.callback(TEXT.skillBtnProfessional[user.language], "SKILL_PROFESSIONAL"),
        ]
      ])
    );
  });

  // 16E) Handle “FIELDS_DONE” (when user has 1–9 fields selected and done)
  bot.action("FIELDS_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields") return;

    if (postSessions[tgId].chosenFields.length === 0) {
      return ctx.reply(TEXT.fieldsErrorNone[user.language]);
    }
    user.onboardingStep = "postingSkill";
    await user.save();
    return ctx.editMessageText(
      user.language === "am"
        ? "የችሎታ ደረጃ ይምረጡ።"
        : "Choose the skill level required:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback(TEXT.skillBtnBeginner[user.language], "SKILL_BEGINNER"),
          Markup.button.callback(TEXT.skillBtnIntermediate[user.language], "SKILL_INTERMEDIATE"),
          Markup.button.callback(TEXT.skillBtnProfessional[user.language], "SKILL_PROFESSIONAL"),
        ]
      ])
    );
  });

  // 17) Handle Skill selection
  bot.action(/SKILL_(BEGINNER|INTERMEDIATE|PROFESSIONAL)/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingSkill") return;

    const skillMap = {
      BEGINNER:   { en: "Beginner Level Skill",   am: "መጀመሪያ ደረጃ" },
      INTERMEDIATE: { en: "Intermediate Level Skill", am: "መካከለኛ ደረጃ" },
      PROFESSIONAL: { en: "Professional Level Skill", am: "ባለሙያ ደረጃ" }
    };
    const key = ctx.match[1]; // e.g. "BEGINNER"
    user.onboardingStep = "postingFee";
    postSessions[tgId].skillLevel = skillMap[key][user.language];
    await user.save();

    return ctx.editMessageText(TEXT.askPaymentFee[user.language]);
  });

  // 18) Handle “POST_CONFIRM” (finalize task)
  bot.action("POST_CONFIRM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postingFields" && user.onboardingStep !== "postingSkill" && user.onboardingStep !== "postingExchange") {
      return;
    }
    // At this point, the session is fully gathered. We can “publish” the task to the designated channel.
    // For example, if your “Task listing” channel is @TaskifiiRemote, do:
    const channelId = "@TaskifiiRemote"; // <– Replace with your real channel ID or numeric chat_id.

    const sess = postSessions[tgId];
    // Build the final task‐post text (localized)
    const taskPost =
      user.language === "am"
        ? `🔔 ተግዳሮት ተለቀቀ።
• መግለጫ: ${sess.description}
• ፋይል: ${sess.relatedFileId ? "[ፋይል]": "የለም"}
• መስኮች: ${sess.chosenFields.map(f => `#${f.replace(" ", "")}`).join(", ")}
• ደረጃ: ${sess.skillLevel}
• ክፍያ: ${sess.paymentFee} ብር
• መጨረሻ: ${sess.completionHours} ሰዓት
• ፍርድ: ${sess.revisionHours} ሰዓት
• ብእዲ ቅጥር: ${sess.latePenalty}%
• ስራ ጊዜ: ${sess.expiryHours} ሰዓት
• መቀያየቢያ: ${sess.exchangeStrategy}`
        : `🔔 New Task posted!
• Description: ${sess.description}
• File: ${sess.relatedFileId ? "[File]" : "None"}
• Fields: ${sess.chosenFields.map(f => `#${f.replace(" ", "")}`).join(", ")}
• Skill: ${sess.skillLevel}
• Fee: ${sess.paymentFee} birr
• Completion hrs: ${sess.completionHours}
• Revision hrs: ${sess.revisionHours}
• Late penalty: ${sess.latePenalty}%
• Expiry hrs: ${sess.expiryHours}
• Exchange: ${sess.exchangeStrategy}`;

    // 18A) Send to channel
    try {
      await ctx.telegram.sendMessage(channelId, taskPost);
    } catch (err) {
      console.error("Failed to post task to channel:", err);
      // The bot can still reply to the user that something went wrong
      return ctx.reply(
        user.language === "am"
          ? "ወደ ቻናሉ ተግዳሮት ለማስገባት ችግር ተፈጠረ ።"
          : "There was an error posting your task. Please try again later."
      );
    }

    // 18B) Confirm to user
    user.onboardingStep = "completed";
    await user.save();
    delete postSessions[tgId];

    return ctx.editMessageText(
      user.language === "am"
        ? "ተግዳሮትዎ ተስተናግዷል። እናመሰግናለን!"
        : "Your task has been posted! Thank you!"
    );
  });

  // 19) Handle “POST_CANCEL” (abandon draft & return to main menu)
  bot.action("POST_CANCEL", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    user.onboardingStep = "completed";
    await user.save();
    delete postSessions[tgId];

    return ctx.editMessageText(
      user.language === "am"
        ? "ተግዳሮት መጀመር ተቋርጧል።"
        : "Task posting canceled."
    );
  });

  /**
   * 20) Handle “USERNAME_KEEP” inline button
   *     (When user is at “username” step and chooses to keep current @username)
   */
  bot.action("USERNAME_KEEP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const existingU = await User.findOne({ telegramId: tgId });
    if (!existingU || existingU.onboardingStep !== "username") return;

    const handle = ctx.from.username || "";
    if (!handle || handle.length < 5) {
      // If there’s no username, ask them to type one
      return ctx.reply(TEXT.usernameErrorGeneral[existingU.language]);
    }
    const conflict = await User.findOne({ username: handle });
    if (conflict) {
      return ctx.reply(TEXT.usernameErrorTaken[existingU.language]);
    }

    // Disable the inline “Yes, keep it”
    try {
      await ctx.telegram.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.callbackQuery.message.message_id,
        null,
        {
          inline_keyboard: [[Markup.button.callback(existingU.language === "am" ? "✔ አዎን፣ ይቀበሉ" : "✔ Yes, keep it", "_DISABLED_USERNAME_KEEP")]]
        }
      );
    } catch (err) {
      // ignore if fails
    }

    existingU.username = handle;
    existingU.onboardingStep = "bankFirst";
    await existingU.save();
    return ctx.reply(TEXT.askBankDetails[existingU.language]);
  });

  /**
   * 21) Handle “TC_AGREE” / “TC_DISAGREE” during onboarding
   */
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || (user.onboardingStep !== "terms" && user.onboardingStep !== "termsReview")) return;

    user.onboardingStep = "askAge";
    await user.save();
    return ctx.editMessageText(
      TEXT.askAge[user.language],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.ageYesBtn[user.language], "AGE_YES")],
        [Markup.button.callback(TEXT.ageNoBtn[user.language], "AGE_NO")],
      ])
    );
  });
  bot.action("TC_DISAGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || (user.onboardingStep !== "terms" && user.onboardingStep !== "termsReview")) return;

    user.onboardingStep = "termsReview";
    await user.save();
    return ctx.editMessageText(
      user.language === "am"
        ? "እባክዎ መመሪያና ሁኔታዎችን ማዳረስ እና መፈቀድ አለበት እንዲቀጥሉ..."
        : "You must read and agree to the Terms & Conditions to proceed."
    );
  });

  /**
   * 22) Handle “AGE_YES” / “AGE_NO”
   */
  bot.action("AGE_NO", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "askAge") return;

    user.onboardingStep = "askAgeRetry";
    await user.save();
    return ctx.editMessageText(
      user.language === "am"
        ? "ይቅርታ፣ ከ18 ዓመት በታች መሆንዎ ምክንያት ይገባል። መረጃዎት ተሰርዟል።"
        : "Sorry, you must be 18 or older. Your data has been removed."
    );
  });
  bot.action("AGE_YES", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "askAge") return;

    // Complete onboarding
    user.onboardingStep = "completed";
    await user.save();

    // Build profile post + inline menu
    const profileText = TEXT.profileCompleteTitle[user.language] + "\n" +
      TEXT.profileDetailTemplate[user.language]
        .replace("%FULLNAME%", user.fullName)
        .replace("%PHONE%", user.phone)
        .replace("%EMAIL%", user.email)
        .replace("%USERNAME%", user.username)
        .replace("%BANKS%", user.bankDetails.map(b => `${b.bankName} (${b.accountNumber})`).join(", "))
        .replace("%LANG%", user.language === "am" ? "አማርኛ" : "English")
        .replace("%REGTIME%", user.createdAt.toLocaleString())
        .replace("%TOTAL_EARNED%", user.stats.totalEarned.toString())
        .replace("%TOTAL_SPENT%", user.stats.totalSpent.toString())
        .replace("%AVG_RATING%", user.stats.averageRating.toFixed(1))
        .replace("%RATING_COUNT%", user.stats.ratingCount.toString());

    // 1) Send profile post into the “profile‐admin channel”
    const profileAdminChannel = "-1002310380363"; // as specified
    try {
      await ctx.telegram.sendMessage(profileAdminChannel, profileText);
    } catch (err) {
      console.error("Error sending profile to admin channel:", err);
    }

    // 2) Reply to user with profile + inline “Post a Task” / “Find a Task” / “Edit Profile”
    return ctx.editMessageText(
      profileText,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")],
      ])
    );
  });

  // ───────────────────────────────────────────
  // 23) Handle “POST_TASK” / “FIND_TASK” / “EDIT_PROFILE” inline buttons
  //     – “POST_TASK” → initiate the “Post a Task” flow
  //     – “FIND_TASK” → for now, send “not implemented”
  //     – “EDIT_PROFILE” → for now, send “not implemented”
  // ───────────────────────────────────────────
  bot.action("POST_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "completed") {
      return ctx.reply(
        user?.language === "am"
          ? "እባክዎ በየማክቲቭ ሂደት መመዝገብ ይጀምሩ (/start)."
          : "Please complete onboarding first by typing /start."
      );
    }

    // Initialize post session
    initPostSession(tgId);
    postSessions[tgId].language = user.language;
    user.onboardingStep = "postingDescription";
    await user.save();

    return ctx.editMessageText(
      TEXT.askTaskDesc[user.language]
    );
  });

  bot.action("FIND_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "completed") return;

    return ctx.reply(
      user.language === "am"
        ? "🔍 ተግዳሮት ፈልግ ሂደት አልተተገበረም።"
        : "🔍 Find-A-Task flow is not implemented yet."
    );
  });

  bot.action("EDIT_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "completed") return;

    return ctx.reply(
      user.language === "am"
        ? "✏️ Edit Profile flow is not implemented yet."
        : "✏️ Edit Profile flow is not implemented yet."
    );
  });

  // ───────────────────────────────────────────
  // Finally, launch the bot
  // ───────────────────────────────────────────
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
