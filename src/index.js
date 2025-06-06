// src/index.js

/**
 * ============================
 * Taskifii Bot – Full Source
 * ============================
 *
 * 1) Onboarding/Profile setup (language → fullName → phone → email → username → bankDetails → terms → age)
 * 2) “Profile Complete!” post (with totalEarned, totalSpent, averageRating, createdAt)
 * 3) Main‐menu (inline buttons: Post a Task / Find a Task / Edit Profile)
 * 4) Complete “Post a Task” flow (description → file optional → fields selection (paginated) → skill level → paymentFee → timeToComplete → revisionTime → penalty → expiryTime → exchange strategy → final confirmation/cancel → publish to channel)
 * 5) All necessary handlers (`bot.hears`, single `bot.on("text")`, `bot.on("document")`, `bot.on("photo")`, `bot.action(...)`, etc.)
 *
 * **Before you deploy:**
 *  • Make sure you have set your environment variables in a `.env` file at the project root:
 *      BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ
 *      MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/taskifiiDB?retryWrites=true&w=majority
 *  • Make sure your `package.json` includes:
 *      "telegraf": "^4.12.2",
 *      "mongoose": "^6.5.4",
 *      "node-fetch": "^2.6.7"
 *  • Ensure your `TEXT` object (translations) and `fieldsList` array appear exactly as below.
 */

const { Telegraf, Markup } = require("telegraf");
const mongoose        = require("mongoose");
const fetch           = require("node-fetch");
require("dotenv").config();

// ────────────────────────────────────────────────────────────────────────────────
// 0) Environment‐variable checks
// ────────────────────────────────────────────────────────────────────────────────

if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

const BOT_TOKEN     = process.env.BOT_TOKEN;
const MONGODB_URI   = process.env.MONGODB_URI;

// ────────────────────────────────────────────────────────────────────────────────
// 1) “TEXT” object: All user‐facing strings (English & Amharic)
//    (Please verify that these keys match exactly your document.)
// ────────────────────────────────────────────────────────────────────────────────

const TEXT = {
  // --- Onboarding steps ---
  chooseLang: {
    en: "🌐 Please choose your language / ቋንቋዎን ይምረጡ:",
    am: "🌐 ቋንቋዎን ይምረጡ / Please choose your language:",
  },
  englishBtn: { en: "English",    am: "English"   },
  amharicBtn: { en: "Amharic/አማርኛ", am: "አማርኛ/Amharic" },

  askSetupProfile: {
    en: "📝 Please click the button below to set up your profile.",
    am: "📝 በታች ያለውን አዝራር ይጫኑ ለመመዝገብ መረጃዎትን ለማግኘት።",
  },
  setupProfileBtn: { en: "Setup Profile", am: "መገለፅ ለመሙላት" },

  askFullName: {
    en: "👤 Please enter your full name (first & last).",
    am: "👤 ሙሉ ስምዎን ያስገቡ (የመጀመሪያ ስም እና የአያት ስም).",
  },
  fullNameError: {
    en: "❌ Invalid name. It must be at least 3 characters. Try again.",
    am: "❌ አልተሟላም። ቢዝ 3 ፊደላት መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askPhone: {
    en: "📱 Please enter your phone number (digits only, at least 5 digits).",
    am: "📱 የስልክ ቁጥርዎን ያስገቡ (ፊጥፈት ብቻ, 5 ፊደላት ቢዝ መሆን አለበት).",
  },
  phoneError: {
    en: "❌ Invalid phone. Use only digits and at least 5 digits. Try again.",
    am: "❌ ትክክለኛ ቁጥር አይደለም። ፊጥፈት ብቻ እና 5 ፊደላት ቢዝ መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askEmail: {
    en: "📧 Please enter your email address.",
    am: "📧 የኢሜል አድራሻዎን ያስገቡ።",
  },
  emailError: {
    en: "❌ Invalid email. Make sure it has an “@” and a domain. Try again.",
    am: "❌ ትክክለኛ ኢሜል አይደለም። “@” እና የድርጅት አድራሻ መኖሩን ያረጋግጡ። እንደገና ይሞክሩ።",
  },

  askUsername: {
    en: "🔍 Please send your Telegram @username (5–30 characters).",
    am: "🔍 የTelegram @username ያስገቡ (5–30 ፊደላት).",
  },
  usernameError: {
    en: "❌ Invalid username. Must start with a letter, 5–30 chars, letters/numbers/_ only. Try again.",
    am: "❌ የተሳሳተ ተጠቃሚ ስም። በፊደል መጀመር፤ 5–30 ፊደላት፤ ፊደሎች/ቁጥሮች/_ ብቻ መያዝ አለበት። እንደገና ይሞክሩ።",
  },
  usernameConflict: {
    en: "❌ This username is already taken. Try a different one.",
    am: "❌ ይህ ተጠቃሚ ስም አስቀድሞ የተውሷል። ሌላ ይሞክሩ።",
  },

  askBank: {
    en: "🏦 Enter your bank details as `BankName,AccountNumber` (digits only). Type “done” if you have no more banks.",
    am: "🏦 የባንክ ዝርዝሮችዎን እንደ `BankName,AccountNumber` (ፊጥፈት ብቻ) ያስገቡ። ሌላ ባንክ የለዎትም ቢሆን “done” ይጻፉ።",
  },
  bankErrorFormat: {
    en: "❌ Invalid format. Use `BankName,AccountNumber` (digits only). Try again.",
    am: "❌ ትክክለኛ ቅርጽ አይደለም። `BankName,AccountNumber` (ፊጥፈት ብቻ) ይጠቀሙ። እንደገና ይሞክሩ።",
  },
  bankReachedTen: {
    en: "✅ You have added 10 banks. Moving to Terms & Conditions.",
    am: "✅ 10 ባንኮችን ጨምራሃል። ወደ መመሪያና ሁኔታዎች እየተኮረን ነው።",
  },

  askTerms: {
    en: `Please read and agree to these Terms & Conditions before proceeding:
(1) Taskifii is an MVP; it is not legally registered as a business entity.
(2) Taskifii charges zero commission and does not hold escrow; all payments between Task Creators and Task Doers are final.
(3) Taskifii’s Bot stores user data in encrypted form; it does not share personal information with third parties.
(4) Any violation of these Terms & Conditions—including but not limited to falsifying personal or task information—will lead to suspension or permanent ban.
(5) By using Taskifii Bot, you acknowledge and agree that Taskifii is not responsible for any disputes or losses; Taskifii acts only as an information conduit.
(6) No user under the age of 18 is allowed to register or perform tasks on Taskifii Bot.
(7) Users must comply with all Telegram policies; spamming, phishing, or harassing other users may result in removal.
(8) All payments must be completed outside of the Bot; Taskifii Bot does not handle money or escrow.
(9) Any attempt to manipulate ratings (e.g., uploading fake reviews) is strictly prohibited.
(10) By continuing, you confirm you have read, understood, and agreed to these Terms & Conditions.`,
    am: `እባክዎን በቅድሚያ መመሪያና ሁኔታዎችን ያነቡ።
(1) Taskifii እንደ MVP ስለጀመረ፤ የህጋዊ ድርጅት ምዝገባ አልተደረገም።
(2) Taskifii የኮሚሽን ክፍያ አልተያዘም እና ኢስክሮ ማጣበቂያ አያደርግም፤ በTask Creator እና Task Doer መካከል የተከፈለው ዋጋ በተወሰነ መሆኑን ያረጋግጡ።
(3) Taskifii Bot የተጠቃሚዎችን መረጃ በዲጂታል ቅፅበት ይጠብቃል፤ ግል መረጃ ለሶስተኛዎች አያደርግም።
(4) ከእነዚህ መመሪያዎች ማንኛውም ማሸነፍ—ምንግጋ፣ ስውስ መፍጠር ወወደእንደ—የተደረገ እረፍት ወደታች ወይም ለዘለዓለም ተግዳሮት ማቋረጥ ያመጣል።
(5) Taskifii Bot መጠቀሙ ማንኛውንም ጉዳት ወወደእንደቤት ያብራራል አይደለም፤ የTaskifii ስራ በመረጃ መተላለፊያ ብቻ ነው።
(6) ከ18 ዓመት በታች ተጠቃሚ በTaskifii Bot መመዝገብ ወወደጀም አልተፈቀደም።
(7) ተጠቃሚዎች ሁሉ Telegram ፖሊሲዎችን መጠቀም አለባቸው፤ ስፓም፣ ፊሽን፣ ሌሎችን ማቆም ወደታች ወወደእንደተተደረገ መረጃ መተላለፊያ ማድረግ ይመለከታል።
(8) ሁሉም ክፍያዎች ከBot ውጭ ማፈጸም አለባቸው፤ Taskifii Bot ገንዘብ አያያዝ።
(9) የግምገማዎችን መረጃ በማስገባት(ለምሳሌ፣ ውሸት ግምገማዎች) ተግዳሮትን ማቀባበሪያ ነው።
(10) በመቀጠል ስለዚህ መመሪያዎች ተረዳሁና ተቀበልን ትላላችሁ።`,
  },
  agreeBtn:     { en: "Agree",           am: "ተፈቅዷል" },
  disagreeBtn:  { en: "Disagree",        am: "አልተፈቀደም" },

  askAge: {
    en: "🔞 Are you 18 or older? Click “Yes I am” or “No I’m not”.",
    am: "🔞 18 ወይም ከዚህ በላይ ነህ? ‘አዎን ነኝ’ ወወደ ‘አይደለም ተብሎ አይቻልም’ ይጫኑ። (የኢትዮጵያ ህግ ከ18 በታች ሥራ የማድረግ አደንች አይፈቀድም።)",
  },
  ageYes:       { en: "Yes I am",        am: "አዎን ነኝ" },
  ageNo:        { en: "No I’m not",      am: "አይደለም ተብሎ አይቻልም" },

  // --- Profile Complete & main menu buttons ---
  profileComplete: {
    en: `📝 *Profile Complete!*
• Full Name: %NAME%
• Phone: %PHONE%
• Email: %EMAIL%
• Username: %HANDLE%
• Banks: %BANKS%
• Language: %LANG%
• Registered: %REGTIME%
• Total Earned: $%TOTAL_EARNED%
• Total Spent: $%TOTAL_SPENT%
• Rating: ★ %AVG_RATING% (%RATING_COUNT% reviews)`,
    am: `📝 *መረጃዎ ተጠናቋል!*
• ሙሉ ስም: %NAME%
• ስልክ: %PHONE%
• ኢሜል: %EMAIL%
• ተጠቃሚ ስም: %HANDLE%
• ባንኮች: %BANKS%
• ቋንቋ: %LANG%
• የተመዘገበበት: %REGTIME%
• ያገኙት ጠቅላላ: $%TOTAL_EARNED%
• ያገዛችሁት ጠቅላላ: $%TOTAL_SPENT%
• ከፍተኛ ደረጃ: ★ %AVG_RATING% (%RATING_COUNT% ግምገማዎች)`,
  },
  postTaskBtn:  { en: "Post a Task",   am: "ተግዳሮት ለመለጠፍ" },
  findTaskBtn:  { en: "Find a Task",   am: "ተግዳሮት ፈልግ" },
  editProfileBtn: { en: "Edit Profile", am: "መገለፅ አርትዕ" },

  // --- Post a Task flow ‒ prompts & errors (all ten) ---
  askTaskDesc: {
    en: "✍️ Write the task description. (Be very specific; must be 20–1250 characters.)",
    am: "✍️ የተግዳሮት መግለጫዎን ይጻፉ። (በጥልቅ ዝርዝር፣ 20–1250 ፊደላት መሆን አለበት።)",
  },
  taskDescErrorLen: {
    en: "❌ Description must be 20–1250 chars. Try again.",
    am: "❌ መግለጫ 20–1250 ፊደላት መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askTaskFile: {
    en: "📁 Send any related file (e.g., PNG, PDF) or click “Skip” to continue without a file.",
    am: "📁 ለተግዳሮት ያገለገለ ፋይል ይላኩ (e.g. PNG, PDF) ወይም “Skip” ይጫኑ ዳግመኛ በፋይል ውስጥ አትልክ።",
  },
  skipBtn:      { en: "Skip",            am: "ይዞረኝ" },

  askFieldsIntro: {
    en: "🔢 Which fields are relevant to your task? Select up to 5. (Navigate with “Prev”/“Next”; Click to select.)",
    am: "🔢 ተግዳሮትዎ የተዛማጅ ርዕሶች ምንን ናቸው? እስከ 5 ድረስ ይምረጡ። (Prev/Next በመጫን ይመዘግቡ፤ በመጫን ይምረጡ።)",
  },
  fieldErrorNoSelection: {
    en: "❌ Please use the “Prev”/“Next” buttons below to navigate fields, then click the field name to select it.",
    am: "❌ በታች ያሉት “Prev”/“Next” አዝራሮችን በመጠቀም ርዕሶችን ይመዘግቡ፤ ከዚያ በኋላ የርዕስ ስምን በመጫን ይምረጡ።",
  },

  askSkillLevel: {
    en: "⚙️ What skill level is required? Click one:",
    am: "⚙️ ምን የተሞከራ ደረጃ ይወስናል? የታች አዝራር ይጫኑ።",
  },
  skillBeginner:   { en: "Beginner",    am: "መጀመሪያ" },
  skillIntermediate: { en: "Intermediate", am: "መካከለኛ" },
  skillExpert:     { en: "Expert",      am: "አስተዋዮ" },

  askPaymentFee: {
    en: "💲 What’s your budget (minimum $50)? Enter a number (e.g., 100).",
    am: "💲 የበጀትዎ መጠን (ቢዝ $50)? ቁጥር ያስገቡ (ለምሳሌ 100).",
  },
  paymentFeeError: {
    en: "❌ Invalid fee. It must be a number ≥ 50. Try again.",
    am: "❌ ትክክለኛ መጠን አይደለም። ቢዝ 50 መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askTimeToComplete: {
    en: "⏰ How many hours to complete? (1–120). Enter a whole number.",
    am: "⏰ በምን ሰዓት ይተካል? (1–120). ቁጥር ያስገቡ።",
  },
  timeCompleteError: {
    en: "❌ Invalid hours. Must be 1–120. Try again.",
    am: "❌ ትክክለኛ ሰዓት አይደለም። 1–120 መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askRevisionTime: {
    en: "🔁 How many hours for revisions? (0–half of total time).",
    am: "🔁 ለድጋፍ በምን ሰዓት ይመከራሉ? (0–ሁለት ሰዓት ግማሽ).",
  },
  revisionTimeErrorNotNumber: {
    en: "❌ Invalid input. Enter a number (0–half of total).",
    am: "❌ ትክክለኛ ውጤት አይደለም። ቁጥር ያስገቡ (0–ግማሽ).",
  },
  revisionTimeErrorRange: {
    en: "❌ Out of range. Must be between 0 and half of your completion time. Try again.",
    am: "❌ ከውስጥ ውጭ ወይም ከግማሽ ሰዓት በላይ ነው። እንደገና ይሞክሩ።",
  },

  askPenalty: {
    en: "⚠️ What is the hourly penalty (0–20% of budget)? Enter a numeric percentage.",
    am: "⚠️ የሰዓት ክፍያ ግዴታ (0–20% የበጀት)? ቁጥር መደብ (%) ያስገቡ።",
  },
  penaltyErrorNotNumber: {
    en: "❌ Invalid input. Enter a numeric penalty percentage.",
    am: "❌ ትክክለኛ ውጤት አይደለም። ቁጥር መደብ (%) ያስገቡ።",
  },
  penaltyErrorRange: {
    en: "❌ Out of range. Must be 0–20% of your budget. Try again.",
    am: "❌ ከውስጥ ውጭ ወወደእንደዋጋ 20% ግዴታ መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askExpiryTime: {
    en: "⌛ After how many hours should this task expire? (1–24).",
    am: "⌛ ከምን ሰዓት በኋላ ይወድቃል? (1–24).",
  },
  expiryErrorNotNumber: {
    en: "❌ Invalid input. Enter a number 1–24.",
    am: "❌ ትክክለኛ ውጤት አይደለም። ቁጥር 1–24 ያስገቡ።",
  },
  expiryErrorRange: {
    en: "❌ Out of range. Must be 1–24. Try again.",
    am: "❌ ከውስጥ ውጭ ወወወወዴት ማድረግ? 1–24 መሆን አለበት። እንደገና ይሞክሩ።",
  },

  askExchangeStrategy: {
    en: "💱 How would you like to split funds? Click one option:",
    am: "💱 ገንዘብ እንዴት መካፈል ይፈልጋሉ? አንዱን አዝራር ይጫኑ:",
  },
  btnExchange100:   { en: "100% in‐app",       am: "100% በውስጥ" },
  btnExchange304030: { en: "30%/40%/30%",      am: "30%/40%/30%" },
  btnExchange5050:   { en: "50%/50%",          am: "50%/50%" },

  // Final confirmation/cancel (after all 10 steps)
  confirmTask: {
    en: "✅ Your task is ready to post! Click “Confirm” or “Cancel” below.",
    am: "✅ ተግዳሮትዎ ለማስተዋል ዝግጅት ላይ ነው! “Confirm” ወወወ “Cancel” ይጫኑ።",
  },
  confirmBtn:     { en: "Confirm",         am: "አረጋግጥ" },
  cancelBtn:      { en: "Cancel",          am: "ሰርዝ" },

  taskPosted: {
    en: "🎉 Your task has been posted on @TaskifiiRemote! Thank you.",
    am: "🎉 ተግዳሮትዎን በ @TaskifiiRemote ላይ ተልኳል! አመሰግናለሁ።",
  },

  // “Find a Task” placeholder
  findTaskNotImpl: {
    en: "🔍 Find‐A‐Task flow is not implemented yet.",
    am: "🔍 ተግዳሮት ፈልግ ሂደት አልተገባም እስካሁን።",
  },

  // “Edit Profile” placeholder
  editProfileNotImpl: {
    en: "✏️ Edit Profile flow is not implemented yet.",
    am: "✏️ መገለፅ አርትዕ ሂደት አልተገባም እስካሁን።",
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// 2) “fieldsList” array (exactly as in your instructions document). For brevity, I’ll show a few items.  
//    Please replace with your full list of 100+ fields (in both EN/AM if you need).  
// ────────────────────────────────────────────────────────────────────────────────

const fieldsList = [
  "Web Development",
  "Graphic Design",
  "Mobile App Development",
  "Content Writing",
  "Translation",
  "Video Editing",
  "Digital Marketing",
  "Data Entry",
  "Customer Support",
  "Virtual Assistance",
  // … (add the remaining fields exactly as in your document) …
];

// ────────────────────────────────────────────────────────────────────────────────
// 3) Create a Mongoose schema & model for users
// ────────────────────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  telegramId:     { type: Number, unique: true, required: true },
  fullName:       { type: String, required: true },
  phone:          { type: String, required: true, unique: true },
  email:          { type: String, required: true, unique: true },
  username:       { type: String, required: true, unique: true },
  bankDetails:    [
    {
      bankName:      String,
      accountNumber: String,
    },
  ],
  language:       { type: String, enum: ["en", "am"], required: true },
  onboardingStep: { type: String, default: "lang" },
  registeredAt:   { type: Date, default: Date.now },
  stats: {
    totalEarned:     { type: Number, default: 0 },
    totalSpent:      { type: Number, default: 0 },
    averageRating:   { type: Number, default: 0 },
    ratingCount:     { type: Number, default: 0 },
  },
});
const User = mongoose.model("User", userSchema);

// ────────────────────────────────────────────────────────────────────────────────
// 4) In‐memory “Post a Task” sessions (logged by Telegram ID)
// ────────────────────────────────────────────────────────────────────────────────

const postSessions = {};
function initPostSession(tgId, lang) {
  postSessions[tgId] = {
    lang,
    step: "postingDescription", // first step
    data: {
      description: "",
      relatedFileId: null,
      fields: [],
      currentFieldPage: 0,
      skillLevel: "",
      paymentFee: 0,
      timeToComplete: 0,
      revisionTime: 0,
      penalty: 0,
      expiryTime: 0,
      exchangeStrategy: "",
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// 5) Helper to build an inline keyboard button that can be “disabled” once clicked
// ────────────────────────────────────────────────────────────────────────────────

function buildButton(label, action, lang, disabled) {
  return Markup.button.callback(
    disabled ? `⏸ ${label}` : label,
    disabled ? `DISABLED|${action}` : action
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// 6) MAIN: Connect to MongoDB, then start the bot
// ────────────────────────────────────────────────────────────────────────────────

async function main() {
  try {
    // 6A) Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }

  // 6B) Instantiate the Telegraf bot
  const bot = new Telegraf(BOT_TOKEN);

  // ────────────────────────────────────────────────────────────────────────────────
  // 7) /start handler: New user or resume onboarding
  // ────────────────────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    // If new user → create with onboardingStep="lang"
    if (!user) {
      user = new User({
        telegramId: tgId,
        onboardingStep: "lang",
        language: "en",
      });
      await user.save();
      return ctx.reply(
        TEXT.chooseLang.en,
        Markup.inlineKeyboard([
          [Markup.button.callback(TEXT.englishBtn.en, "LANG_EN")],
          [Markup.button.callback(TEXT.amharicBtn.en, "LANG_AM")],
        ])
      );
    }

    const lang = user.language || "en";

    // If already fully onboarded (onboardingStep === "ready"), send final profile + inline menu
    if (user.onboardingStep === "ready") {
      // Compute totals & rating from user.stats
      const bankList = user.bankDetails
        .map((b) => `${b.bankName} (${b.accountNumber.slice(-2)})`)
        .join(", ") || "None";
      const timestamp = user.registeredAt.toLocaleString();
      const profileText = TEXT.profileComplete[lang]
        .replace("%NAME%", user.fullName)
        .replace("%PHONE%", user.phone)
        .replace("%EMAIL%", user.email)
        .replace("%HANDLE%", user.username)
        .replace("%BANKS%", bankList)
        .replace("%LANG%", lang === "am" ? "አማርኛ" : "English")
        .replace("%REGTIME%", timestamp)
        .replace("%TOTAL_EARNED%", user.stats.totalEarned.toString())
        .replace("%TOTAL_SPENT%", user.stats.totalSpent.toString())
        .replace("%AVG_RATING%", user.stats.averageRating.toFixed(1))
        .replace("%RATING_COUNT%", user.stats.ratingCount.toString());

      // 1) Send the profile to the user with inline keyboard
      await ctx.reply(
        profileText,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [buildButton(TEXT.postTaskBtn[lang],   "POST_TASK",    lang, false)],
            [buildButton(TEXT.findTaskBtn[lang],   "FIND_TASK",    lang, false)],
            [buildButton(TEXT.editProfileBtn[lang],"EDIT_PROFILE", lang, false)],
          ]),
        }
      );

      // 2) Send the same profile to the admin channel with admin controls
      const adminChatId = "-1002310380363"; // replace with your actual Admin channel ID
      await ctx.telegram.sendMessage(
        adminChatId,
        profileText,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("Ban User",    `BAN_USER_${tgId}`)],
            [Markup.button.callback("Contact User",`CONTACT_USER_${tgId}`)],
            [Markup.button.callback("Give Review", `GIVE_REVIEW_${tgId}`)],
            [Markup.button.callback("Unban User",  `UNBAN_USER_${tgId}`)],
          ]),
        }
      );

      return;
    }

    // 7A) If user is partway through onboarding, re-prompt the last step:
    switch (user.onboardingStep) {
      case "lang":
        return ctx.reply(
          TEXT.chooseLang.en,
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.englishBtn.en, "LANG_EN")],
            [Markup.button.callback(TEXT.amharicBtn.en, "LANG_AM")],
          ])
        );
      case "setup":
        return ctx.reply(
          TEXT.askSetupProfile[lang],
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.setupProfileBtn[lang], "SETUP_PROFILE")],
          ])
        );
      case "fullName":
        return ctx.reply(TEXT.askFullName[lang]);
      case "phone":
        return ctx.reply(TEXT.askPhone[lang]);
      case "email":
        return ctx.reply(TEXT.askEmail[lang]);
      case "username":
        return ctx.reply(TEXT.askUsername[lang]);
      case "bankFirst":
      case "bankMulti":
        return ctx.reply(TEXT.askBank[lang]);
      case "terms":
      case "termsReview":
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.agreeBtn[lang],    "TC_AGREE")],
            [Markup.button.callback(TEXT.disagreeBtn[lang], "TC_DISAGREE")],
          ])
        );
      case "age":
        return ctx.reply(
          TEXT.askAge[lang],
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.ageYes[lang], "AGE_YES")],
            [Markup.button.callback(TEXT.ageNo[lang],  "AGE_NO")],
          ])
        );
      default:
        return ctx.reply(`Please complete your profile first by clicking /start.`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 8) Inline callback handlers for onboarding steps
  // ────────────────────────────────────────────────────────────────────────────────

  // 8A) Choose Language
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    await User.updateOne(
      { telegramId: tgId },
      { language: "en", onboardingStep: "setup" }
    );
    return ctx.editMessageText(
      TEXT.askSetupProfile.en,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.setupProfileBtn.en, "SETUP_PROFILE")],
      ])
    );
  });

  bot.action("LANG_AM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    await User.updateOne(
      { telegramId: tgId },
      { language: "am", onboardingStep: "setup" }
    );
    return ctx.editMessageText(
      TEXT.askSetupProfile.am,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.setupProfileBtn.am, "SETUP_PROFILE")],
      ])
    );
  });

  // 8B) Setup Profile button clicked
  bot.action("SETUP_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "setup") return;
    user.onboardingStep = "fullName";
    await user.save();
    return ctx.reply(TEXT.askFullName[user.language]);
  });

  // 8C) Enter full name
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    const lang = user.language;

    // Full Name step
    if (user.onboardingStep === "fullName") {
      if (text.length < 3) {
        return ctx.reply(TEXT.fullNameError[lang]);
      }
      user.fullName = text;
      user.onboardingStep = "phone";
      await user.save();
      return ctx.reply(TEXT.askPhone[lang]);
    }

    // Phone step
    if (user.onboardingStep === "phone") {
      if (!/^\d{5,}$/.test(text)) {
        return ctx.reply(TEXT.phoneError[lang]);
      }
      // Check uniqueness
      const conflict = await User.findOne({ phone: text });
      if (conflict && conflict.telegramId !== tgId) {
        return ctx.reply(
          lang === "am"
            ? "❌ ይህ ስልክ ቁጥር ቀድሞ ተመዝግቦታል። ሌላ ይሞክሩ።"
            : "❌ This phone number is already registered. Try another."
        );
      }
      user.phone = text;
      user.onboardingStep = "email";
      await user.save();
      return ctx.reply(TEXT.askEmail[lang]);
    }

    // Email step
    if (user.onboardingStep === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return ctx.reply(TEXT.emailError[lang]);
      }
      const conflict = await User.findOne({ email: text });
      if (conflict && conflict.telegramId !== tgId) {
        return ctx.reply(
          lang === "am"
            ? "❌ ይህ ኢሜል ቀድሞ ተመዝግቦታል። ሌላ ይሞክሩ።"
            : "❌ This email is already registered. Try another."
        );
      }
      user.email = text;
      user.onboardingStep = "username";
      await user.save();
      return ctx.reply(TEXT.askUsername[lang]);
    }

    // Username step (typing a new username manually)
    if (user.onboardingStep === "username" && !ctx.callbackQuery) {
      const handle = text.replace(/^@/, ""); // remove @ if they typed it
      if (!/^[A-Za-z][A-Za-z0-9_]{4,29}$/.test(handle)) {
        return ctx.reply(TEXT.usernameError[lang]);
      }
      const conflict = await User.findOne({ username: `@${handle}` });
      if (conflict && conflict.telegramId !== tgId) {
        return ctx.reply(TEXT.usernameConflict[lang]);
      }
      user.username = `@${handle}`;
      user.onboardingStep = "bankFirst";
      await user.save();
      return ctx.reply(TEXT.askBank[lang]);
    }

    // Bank detail step (enter "BankName,AccountNumber" or type "done")
    if (user.onboardingStep === "bankFirst" || user.onboardingStep === "bankMulti") {
      if (text.toLowerCase() === "done") {
        // Move to terms
        user.onboardingStep = "terms";
        await user.save();
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.agreeBtn[lang],    "TC_AGREE")],
            [Markup.button.callback(TEXT.disagreeBtn[lang], "TC_DISAGREE")],
          ])
        );
      }
      // Expect “BankName,AccountNumber” (digits only in account)
      const parts = text.split(",");
      if (
        parts.length !== 2 ||
        parts[0].trim().length < 2 ||
        !/^\d+$/.test(parts[1].trim())
      ) {
        return ctx.reply(TEXT.bankErrorFormat[lang]);
      }
      const bankName     = parts[0].trim();
      const accountNumber = parts[1].trim();
      // Add to user.bankDetails
      user.bankDetails.push({ bankName, accountNumber });
      await user.save();
      if (user.bankDetails.length >= 10) {
        // If reached 10, auto‐move to terms
        user.onboardingStep = "terms";
        await user.save();
        await ctx.reply(TEXT.bankReachedTen[lang]);
        return ctx.reply(
          TEXT.askTerms[lang],
          Markup.inlineKeyboard([
            [Markup.button.callback(TEXT.agreeBtn[lang],    "TC_AGREE")],
            [Markup.button.callback(TEXT.disagreeBtn[lang], "TC_DISAGREE")],
          ])
        );
      } else {
        user.onboardingStep = "bankMulti";
        await user.save();
        return ctx.reply(
          lang === "am"
            ? `✅ ባንክ ተጨምሩ። ሌላ ይደግፉ ወወወ ወወ “done” ያስገቡ።`
            : `✅ Bank added. Enter another or type “done” if finished.`
        );
      }
    }

    // Terms & Conditions step (only triggered if they typed text but expected a button)
    if (user.onboardingStep === "terms" || user.onboardingStep === "termsReview") {
      return ctx.reply(
        lang === "am"
          ? "❌ እባክዎን ከስር ያሉትን አዝራሮች በመጫን ይወስኑ።"
          : "❌ Please click one of the buttons below to agree or disagree."
      );
    }

    // Age step (text typed but we expect a button)
    if (user.onboardingStep === "age") {
      return ctx.reply(
        lang === "am"
          ? "❌ “አዎን ነኝ” ወወደ “አይደለም” አዝራሮች ይጫኑ።"
          : "❌ Please click “Yes I am” or “No I’m not”."
      );
    }

    // If user is fully onboarded but typed random text, do nothing
    if (user.onboardingStep === "ready") {
      return;
    }

    // Fallback for any other unmatched text
    return ctx.reply(`Please complete your profile first by clicking /start.`);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 8D) Inline callback: “USERNAME_KEEP” (when they choose to keep their Telegram handle)
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("USERNAME_KEEP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const existingU = await User.findOne({ telegramId: tgId });
    if (!existingU || existingU.onboardingStep !== "username") return;

    const handle = ctx.from.username || "";
    if (!handle || handle.length < 5) {
      // If they have no username in Telegram, ask them to type one
      return ctx.reply(TEXT.usernameError[existingU.language]);
    }
    const conflict = await User.findOne({ username: `@${handle}` });
    if (conflict) {
      return ctx.reply(TEXT.usernameConflict[existingU.language]);
    }
    existingU.username = `@${handle}`;
    existingU.onboardingStep = "bankFirst";
    await existingU.save();
    return ctx.reply(TEXT.askBank[existingU.language]);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 8E) Inline callback: “TC_AGREE” or “TC_DISAGREE”
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || (user.onboardingStep !== "terms" && user.onboardingStep !== "termsReview")) return;

    user.onboardingStep = "age";
    await user.save();
    return ctx.editMessageText(
      TEXT.askAge[user.language],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.ageYes[user.language], "AGE_YES")],
        [Markup.button.callback(TEXT.ageNo[user.language],  "AGE_NO")],
      ])
    );
  });

  bot.action("TC_DISAGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || (user.onboardingStep !== "terms" && user.onboardingStep !== "termsReview")) return;

    // If they disagree, we simply re-prompt the Terms & Conditions
    user.onboardingStep = "termsReview";
    await user.save();
    return ctx.reply(
      TEXT.askTerms[user.language],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.agreeBtn[user.language],    "TC_AGREE")],
        [Markup.button.callback(TEXT.disagreeBtn[user.language], "TC_DISAGREE")],
      ])
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 8F) Inline callback: “AGE_YES” or “AGE_NO”
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("AGE_YES", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "age") return;

    // Mark them as fully onboarded
    user.onboardingStep = "ready";
    await user.save();

    // Now send the final profile + inline menu
    const lang = user.language;
    const bankList = user.bankDetails
      .map((b) => `${b.bankName} (${b.accountNumber.slice(-2)})`)
      .join(", ") || "None";
    const timestamp = user.registeredAt.toLocaleString();
    const profileText = TEXT.profileComplete[lang]
      .replace("%NAME%", user.fullName)
      .replace("%PHONE%", user.phone)
      .replace("%EMAIL%", user.email)
      .replace("%HANDLE%", user.username)
      .replace("%BANKS%", bankList)
      .replace("%LANG%", lang === "am" ? "አማርኛ" : "English")
      .replace("%REGTIME%", timestamp)
      .replace("%TOTAL_EARNED%", user.stats.totalEarned.toString())
      .replace("%TOTAL_SPENT%", user.stats.totalSpent.toString())
      .replace("%AVG_RATING%", user.stats.averageRating.toFixed(1))
      .replace("%RATING_COUNT%", user.stats.ratingCount.toString());

    // 1) To user
    await ctx.editMessageText(
      profileText,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [buildButton(TEXT.postTaskBtn[lang],   "POST_TASK",    lang, false)],
          [buildButton(TEXT.findTaskBtn[lang],   "FIND_TASK",    lang, false)],
          [buildButton(TEXT.editProfileBtn[lang],"EDIT_PROFILE", lang, false)],
        ]),
      }
    );

    // 2) To admin channel
    const adminChatId = "-1002310380363";
    await ctx.telegram.sendMessage(
      adminChatId,
      profileText,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Ban User",    `BAN_USER_${tgId}`)],
          [Markup.button.callback("Contact User",`CONTACT_USER_${tgId}`)],
          [Markup.button.callback("Give Review", `GIVE_REVIEW_${tgId}`)],
          [Markup.button.callback("Unban User",  `UNBAN_USER_${tgId}`)],
        ]),
      }
    );
  });

  bot.action("AGE_NO", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "age") return;

    // If user is under 18, we cannot onboard them.  
    await ctx.editMessageText(
      user.language === "am"
        ? "❌ እንደ የኢትዮጵያ ህግ በ18 ዓመት በታች ሥራ አይፈቀደም ። የሚፈልጉትን ተግዳሮት ማድረግ አይችሉም።"
        : "❌ According to local law, users under 18 cannot register or perform tasks. Sorry."
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 9) *** MISSING PIECE EARLIER: “Reply‐keyboard” handlers for main menu (once onboardingStep === “ready”)  
  //     These three catches plain‐text “Post a Task”, “Find a Task”, “Edit Profile” so the flow actually starts  
  //     when the user taps those reply buttons instead of inline callbacks.  
  // ────────────────────────────────────────────────────────────────────────────────

  // 9A) “Post a Task” (reply‐keyboard)
  bot.hears(
    async (ctx) => {
      const tgId = ctx.from.id;
      const text = ctx.message.text;
      const user = await User.findOne({ telegramId: tgId });
      if (!user || user.onboardingStep !== "ready") return false;
      return text === TEXT.postTaskBtn[user.language];
    },
    async (ctx) => {
      const tgId = ctx.from.id;
      const user = await User.findOne({ telegramId: tgId });
      if (!user) return;

      // 1) Remove the reply keyboard (so they can’t tap it again)
      await ctx.reply("⏳ Preparing to post your task…", { reply_markup: { remove_keyboard: true } });

      // 2) Initialize a post session & change onboardingStep
      initPostSession(tgId, user.language);
      user.onboardingStep = "postingDescription";
      await user.save();

      // 3) Ask the first question
      return ctx.reply(TEXT.askTaskDesc[user.language]);
    }
  );

  // 9B) “Find a Task” (reply‐keyboard)
  bot.hears(
    async (ctx) => {
      const tgId = ctx.from.id;
      const text = ctx.message.text;
      const user = await User.findOne({ telegramId: tgId });
      if (!user || user.onboardingStep !== "ready") return false;
      return text === TEXT.findTaskBtn[user.language];
    },
    async (ctx) => {
      const user = await User.findOne({ telegramId: ctx.from.id });
      if (!user) return;
      return ctx.reply(TEXT.findTaskNotImpl[user.language]);
    }
  );

  // 9C) “Edit Profile” (reply‐keyboard)
  bot.hears(
    async (ctx) => {
      const tgId = ctx.from.id;
      const text = ctx.message.text;
      const user = await User.findOne({ telegramId: tgId });
      if (!user || user.onboardingStep !== "ready") return false;
      return text === TEXT.editProfileBtn[user.language];
    },
    async (ctx) => {
      const user = await User.findOne({ telegramId: ctx.from.id });
      if (!user) return;
      return ctx.reply(TEXT.editProfileNotImpl[user.language]);
    }
  );

  // ────────────────────────────────────────────────────────────────────────────────
  // 10) Inline callback: “POST_TASK” (exactly the same as above, but triggered by the inline menu)
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("POST_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "ready") return;

    const lang = user.language;
    // Disable the inline “Post a Task” button so they can’t re-click
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [buildButton(TEXT.postTaskBtn[lang],   "DISABLED|POST_TASK",   lang, true)],
        [buildButton(TEXT.findTaskBtn[lang],   "FIND_TASK",    lang, false)],
        [buildButton(TEXT.editProfileBtn[lang],"EDIT_PROFILE", lang, false)],
      ],
    });

    // Initialize post session
    initPostSession(tgId, lang);
    user.onboardingStep = "postingDescription";
    await user.save();

    // Ask the first task prompt
    return ctx.reply(TEXT.askTaskDesc[lang]);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11) “Post a Task” flow: single bot.on("text"), plus bot.on("document"), plus bot.action(…) for each sub‐step  
  //     We handle each of the ten steps in sequence based on session.step.  
  // ────────────────────────────────────────────────────────────────────────────────

  // 11A) Handle plain‐text replies (Description, Fee, Time, Revision, Penalty, Expiry)
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;
    const session = postSessions[tgId];
    if (!session) {
      // If they haven’t clicked “Post a Task” yet
      if (user.onboardingStep !== "ready") {
        return ctx.reply(`Please complete your profile first by clicking /start.`);
      }
      return;
    }

    const lang = session.lang;

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 1: Task Description
    if (session.step === "postingDescription") {
      if (text.length < 20 || text.length > 1250) {
        return ctx.reply(TEXT.taskDescErrorLen[lang]);
      }
      session.data.description = text;
      session.step = "postingFile";
      return ctx.reply(
        TEXT.askTaskFile[lang],
        Markup.inlineKeyboard([
          [Markup.button.callback(session.lang === "am" ? "ይዞረኝ" : "Skip", "POST_SKIP_FILE")],
        ])
      );
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 5: Payment Fee (must be ≥ 50)
    if (session.step === "postingFee") {
      const numFee = parseInt(text, 10);
      if (isNaN(numFee) || numFee < 50) {
        return ctx.reply(TEXT.paymentFeeError[lang]);
      }
      session.data.paymentFee = numFee;
      session.step = "postingTime";
      return ctx.reply(TEXT.askTimeToComplete[lang]);
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 6: Time to Complete (1–120)
    if (session.step === "postingTime") {
      const numTime = parseInt(text, 10);
      if (isNaN(numTime) || numTime < 1 || numTime > 120) {
        return ctx.reply(TEXT.timeCompleteError[lang]);
      }
      session.data.timeToComplete = numTime;
      session.step = "postingRevision";
      return ctx.reply(TEXT.askRevisionTime[lang]);
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 7: Revision Time (0–half of timeToComplete)
    if (session.step === "postingRevision") {
      const numRev = parseInt(text, 10);
      if (isNaN(numRev)) {
        return ctx.reply(TEXT.revisionTimeErrorNotNumber[lang]);
      }
      if (numRev < 0 || numRev > session.data.timeToComplete / 2) {
        return ctx.reply(TEXT.revisionTimeErrorRange[lang]);
      }
      session.data.revisionTime = numRev;
      session.step = "postingPenalty";
      return ctx.reply(TEXT.askPenalty[lang]);
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 8: Penalty (0–20% of paymentFee)
    if (session.step === "postingPenalty") {
      const numPen = parseInt(text, 10);
      if (isNaN(numPen)) {
        return ctx.reply(TEXT.penaltyErrorNotNumber[lang]);
      }
      if (numPen < 0 || numPen > session.data.paymentFee * 0.2) {
        return ctx.reply(TEXT.penaltyErrorRange[lang]);
      }
      session.data.penalty = numPen;
      session.step = "postingExpiry";
      return ctx.reply(TEXT.askExpiryTime[lang]);
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 9: Expiry Time (1–24)
    if (session.step === "postingExpiry") {
      const numExp = parseInt(text, 10);
      if (isNaN(numExp)) {
        return ctx.reply(TEXT.expiryErrorNotNumber[lang]);
      }
      if (numExp < 1 || numExp > 24) {
        return ctx.reply(TEXT.expiryErrorRange[lang]);
      }
      session.data.expiryTime = numExp;
      session.step = "postingExchange";
      return ctx.reply(
        TEXT.askExchangeStrategy[lang],
        Markup.inlineKeyboard([
          [buildButton(TEXT.btnExchange100[lang],    "EXCHANGE_100",    lang, false)],
          [buildButton(TEXT.btnExchange304030[lang], "EXCHANGE_304030", lang, false)],
          [buildButton(TEXT.btnExchange5050[lang],   "EXCHANGE_5050",   lang, false)],
        ])
      );
    }

    // ────────────────────────────────────────────────────────────────────────────────
    // Step 10: Exchange Strategy is solely inline buttons; if typed text, prompt them to click
    if (session.step === "postingExchange") {
      return ctx.reply(
        lang === "am"
          ? "❌ እባክዎን ከስር አንዱን አዝራር ይጫኑ።"
          : "❌ Please click one of the exchange strategy buttons."
      );
    }

    // If we reach here but session.step doesn’t match (should not happen), do nothing
    return;
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11B) Handle “Skip file” via inline callback
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("POST_SKIP_FILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    const user = await User.findOne({ telegramId: tgId });
    if (!session || !user || user.onboardingStep !== "postingDescription") return;

    // They skipped file → move to fields selection
    session.step = "postingFields";
    return ctx.reply(TEXT.askFieldsIntro[session.lang], { parse_mode: "Markdown" });
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11C) Handle incoming documents/photos (if they attach a file for step 2)
  // ────────────────────────────────────────────────────────────────────────────────
  bot.on("document", async (ctx) => {
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    const user = await User.findOne({ telegramId: tgId });
    if (!session || !user || user.onboardingStep !== "postingDescription") return;

    const fileId = ctx.message.document.file_id;
    session.data.relatedFileId = fileId;
    session.step = "postingFields";
    return ctx.reply(TEXT.askFieldsIntro[session.lang], { parse_mode: "Markdown" });
  });
  bot.on("photo", async (ctx) => {
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    const user = await User.findOne({ telegramId: tgId });
    if (!session || !user || user.onboardingStep !== "postingDescription") return;

    const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    session.data.relatedFileId = largestPhoto;
    session.step = "postingFields";
    return ctx.reply(TEXT.askFieldsIntro[session.lang], { parse_mode: "Markdown" });
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11D) Field selection (paginated) via callback queries:
  //      ACTIONS: "FIELD_PREV", "FIELD_NEXT", "FIELD_SELECT_{index}"
  // ────────────────────────────────────────────────────────────────────────────────
  function getFieldKeyboard(page, lang) {
    const pageSize = 10;
    const startIndex = page * pageSize;
    const endIndex   = Math.min(startIndex + pageSize, fieldsList.length);
    const buttons = [];

    for (let i = startIndex; i < endIndex; i++) {
      buttons.push(
        Markup.button.callback(
          fieldsList[i],
          `FIELD_SELECT_${i}_${lang}`
        )
      );
    }
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback("← Prev", `FIELD_PREV_${page - 1}_${lang}`));
    }
    if (endIndex < fieldsList.length) {
      navButtons.push(Markup.button.callback("Next →", `FIELD_NEXT_${page + 1}_${lang}`));
    }
    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }
    return Markup.inlineKeyboard(buttons, { columns: 1 });
  }

  bot.action(/^FIELD_PREV_(\d+)_(en|am)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const [, newPage, lang] = ctx.match;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingFields") return;
    session.currentFieldPage = parseInt(newPage, 10);
    return ctx.editMessageText(
      TEXT.askFieldsIntro[lang],
      getFieldKeyboard(session.currentFieldPage, lang)
    );
  });

  bot.action(/^FIELD_NEXT_(\d+)_(en|am)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const [, newPage, lang] = ctx.match;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingFields") return;
    session.currentFieldPage = parseInt(newPage, 10);
    return ctx.editMessageText(
      TEXT.askFieldsIntro[lang],
      getFieldKeyboard(session.currentFieldPage, lang)
    );
  });

  bot.action(/^FIELD_SELECT_(\d+)_(en|am)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const [, indexStr, lang] = ctx.match;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingFields") return;
    const idx = parseInt(indexStr, 10);
    // Add the selected field if not already in list (max 5)
    if (!session.data.fields.includes(fieldsList[idx])) {
      if (session.data.fields.length >= 5) {
        return ctx.reply(
          lang === "am"
            ? "❌ ከ3 ሦስት ብቻ ይምረጡ።"
            : "❌ You may select up to 5 fields only."
        );
      }
      session.data.fields.push(fieldsList[idx]);
    }
    // After selecting up to 5 or they click “Done selecting fields”
    if (session.data.fields.length >= 1) {
      session.step = "postingSkill";
      return ctx.reply(
        TEXT.askSkillLevel[lang],
        Markup.inlineKeyboard([
          [Markup.button.callback(TEXT.skillBeginner[lang],     "SKILL_BEGINNER_" + lang)],
          [Markup.button.callback(TEXT.skillIntermediate[lang], "SKILL_INTERMEDIATE_" + lang)],
          [Markup.button.callback(TEXT.skillExpert[lang],       "SKILL_EXPERT_" + lang)],
        ])
      );
    }
    // If they haven't selected a field, re-render keyboard for current page
    return ctx.editMessageText(
      TEXT.askFieldsIntro[lang],
      getFieldKeyboard(session.currentFieldPage, lang)
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11E) Skill‐level selection
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action(/^SKILL_(BEGINNER|INTERMEDIATE|EXPERT)_(en|am)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const [, level, lang] = ctx.match;
    const session = postSessions[tgId];
    const user = await User.findOne({ telegramId: tgId });
    if (!session || !user || session.step !== "postingSkill") return;
    session.data.skillLevel = level.toLowerCase(); // "beginner" / "intermediate" / "expert"
    session.step = "postingFee";
    return ctx.reply(TEXT.askPaymentFee[lang]);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11F) Exchange strategy selection
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("EXCHANGE_100", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingExchange") return;
    session.data.exchangeStrategy = "100";
    session.step = "postingConfirm";
    return ctx.reply(
      TEXT.confirmTask[session.lang],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.confirmBtn[session.lang], "TASK_CONFIRM")],
        [Markup.button.callback(TEXT.cancelBtn[session.lang],  "TASK_CANCEL")],
      ])
    );
  });

  bot.action("EXCHANGE_304030", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingExchange") return;
    session.data.exchangeStrategy = "30/40/30";
    session.step = "postingConfirm";
    return ctx.reply(
      TEXT.confirmTask[session.lang],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.confirmBtn[session.lang], "TASK_CONFIRM")],
        [Markup.button.callback(TEXT.cancelBtn[session.lang],  "TASK_CANCEL")],
      ])
    );
  });

  bot.action("EXCHANGE_5050", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    if (!session || session.step !== "postingExchange") return;
    session.data.exchangeStrategy = "50/50";
    session.step = "postingConfirm";
    return ctx.reply(
      TEXT.confirmTask[session.lang],
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.confirmBtn[session.lang], "TASK_CONFIRM")],
        [Markup.button.callback(TEXT.cancelBtn[session.lang],  "TASK_CANCEL")],
      ])
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 11G) Final confirmation or cancel
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("TASK_CONFIRM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    const user    = await User.findOne({ telegramId: tgId });
    if (!session || !user || session.step !== "postingConfirm") return;

    // Build the final task message to post in the public “Tasks” channel
    const lang = session.lang;
    const {
      description,
      relatedFileId,
      fields,
      skillLevel,
      paymentFee,
      timeToComplete,
      revisionTime,
      penalty,
      expiryTime,
      exchangeStrategy,
    } = session.data;

    // Compose the task‐card text
    let taskText = `📌 *New Task Posted!*\n\n`;
    taskText += `*Description*: ${description}\n`;
    if (relatedFileId) {
      taskText += `*File*: [attached]\n`;
    }
    taskText += `*Fields*: ${fields.join(", ")}\n`;
    taskText += `*Skill Level*: ${skillLevel.charAt(0).toUpperCase() + skillLevel.slice(1)}\n`;
    taskText += `*Budget*: $${paymentFee}\n`;
    taskText += `*Time to Complete*: ${timeToComplete} hrs\n`;
    taskText += `*Revision Time*: ${revisionTime} hrs\n`;
    taskText += `*Penalty*: $${penalty}/hr\n`;
    taskText += `*Expiry*: ${expiryTime} hrs\n`;
    taskText += `*Exchange*: ${exchangeStrategy}\n\n`;
    taskText += `_Posted by ${user.fullName} (${user.username})_`;

    // Post it to the “Tasks” channel
    const tasksChannelId = "-1008888888888"; // ← Replace with your actual channel ID for tasks
    if (relatedFileId) {
      await ctx.telegram.sendDocument(tasksChannelId, { source: relatedFileId }, {
        caption: taskText,
        parse_mode: "Markdown",
      });
    } else {
      await ctx.telegram.sendMessage(tasksChannelId, taskText, { parse_mode: "Markdown" });
    }

    // Acknowledge to the user
    await ctx.reply(TEXT.taskPosted[lang]);

    // Clean up session & reset user.onboardingStep to “ready”
    delete postSessions[tgId];
    user.onboardingStep = "ready";
    await user.save();
  });

  bot.action("TASK_CANCEL", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const session = postSessions[tgId];
    const user    = await User.findOne({ telegramId: tgId });
    if (!session || !user || session.step !== "postingConfirm") return;

    // Cancel the session
    delete postSessions[tgId];
    user.onboardingStep = "ready";
    await user.save();

    return ctx.reply(
      session.lang === "am"
        ? "❌ Your task posting has been cancelled."
        : "❌ Your task posting has been cancelled."
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 12) Inline “Find a Task” & “Edit Profile” placeholders (inline as well)
  // ────────────────────────────────────────────────────────────────────────────────
  bot.action("FIND_TASK", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "ready") return;
    return ctx.reply(TEXT.findTaskNotImpl[user.language]);
  });

  bot.action("EDIT_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "ready") return;
    return ctx.reply(TEXT.editProfileNotImpl[user.language]);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 13) Any other fallback for unknown callback queries
  // ────────────────────────────────────────────────────────────────────────────────
  bot.on("callback_query", async (ctx) => {
    // If a “DISABLED|...” callback is triggered, just answer it and do nothing
    if (ctx.callbackQuery.data.startsWith("DISABLED|")) {
      return ctx.answerCbQuery(); // no action
    }
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 14) Start polling
  // ────────────────────────────────────────────────────────────────────────────────
  await bot.launch();
  console.log("🤖 Bot is up and running");

  // Graceful stop
  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// Invoke main()
main();
