// src/index.js

/**
 * Taskifii Bot: Onboarding Flow (All Changes Integrated)
 *
 * - Button highlighting: only the clicked button gets a checkmark; neighbors are disabled but not highlighted.
 * - When a user types a new Telegram username, the “Yes, keep it” button is disabled but still visible.
 * - Phone validation now requires 5–14 digits.
 * - Amharic text for the age inquiry uses correct Amharic button labels.
 * - “Review Bot Policies” button is removed.
 * - After the 10th bank detail, the bot automatically proceeds to Terms & Conditions.
 */
require('dotenv').config();

const { Telegraf, Markup, session } = require("telegraf");
const mongoose = require("mongoose");
const Task = require("./models/Task");
const User = require("./models/User");
// Ensure environment variables are set
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}



// ------------------------------------
//  Mongoose Schema & Model
//    - language: allow null in enum
// ------------------------------------
// ------------------------------------
//  Mongoose Schema & Model
//    - language: allow null in enum
// ------------------------------------
const Schema = mongoose.Schema;

const userSchema = new Schema({
  telegramId:     { type: Number, unique: true, required: true },
  onboardingStep: { type: String, required: true }, // "language", "fullName", etc.
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

// Explicitly add sparse unique indexes for username, email, phone:
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ email:    1 }, { unique: true, sparse: true });
userSchema.index({ phone:    1 }, { unique: true, sparse: true });



const TaskDraft = require("./models/TaskDraft");


// ------------------------------------


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
    am: "ይቅርታ፣ ይህ ስልክ ቁጥር አስተጋባቢ እንደሆነ ተጠቃሚ አገኙት! ሌላ ስልክ ቁጥር ያስገቡ!"
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
    am: "ወደ 10 ባንኮች ደረሱ። ወደ መመሪያ እና ሁኔታዎች ይቀይራሉ..."
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
  postTaskBtn: {
  en: "Post a Task",
  am: "ተግዳሮት ልጥፍ"
  },
  findTaskBtn: {
    en: "Find a Task",
    am: "ተግዳሮት ፈልግ"
  },
  editProfileBtn: {
    en: "Edit Profile",
    am: "ፕሮፋይል አርትዕ"
  },

};


const ALL_FIELDS = [
  "Software Development", "Data Science and Analytics", "Cybersecurity", "Cloud Computing",
  "IT Support", "DevOps Engineering", "UI/UX Design", "Machine Learning and AI Development",
  "Digital Marketing", "Content Writing/Copywriting","SEO Specialist",
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
  "Language Teaching (e.g., ESL)",
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
  "Affiliate Marketing",
 /* … include full list as in edit.docx */ 
];
const FIELDS_PER_PAGE = 10;

function buildPreviewText(draft, user) {
  const lines = [];
  lines.push("*🚀 Task is open!*");
  lines.push("");
  lines.push(`*Description:* ${draft.description}`);
  lines.push("");
  if (draft.fields.length) {
    const hashtags = draft.fields.map(f => `#${f.replace(/\s+/g, '')}`).join(" ");
    lines.push(`*Fields:* ${hashtags}`);
    lines.push("");
  }
  if (draft.skillLevel) {
    let emoji = draft.skillLevel === "Beginner" ? "🟢" 
              : draft.skillLevel === "Intermediate" ? "🟡" 
              : "🔴";
    lines.push(`*Skill Level Required:* ${emoji} ${draft.skillLevel}`);
    lines.push("");
  }
  if (draft.paymentFee != null) {
    lines.push(`*Payment Fee:* ${draft.paymentFee} birr`);
    lines.push("");
  }
  if (draft.timeToComplete != null) {
    lines.push(`*Time to Complete:* ${draft.timeToComplete} hour(s)`);
    lines.push("");
  }
  if (draft.revisionTime != null) {
    lines.push(`*Revision Time:* ${draft.revisionTime} hour(s)`);
    lines.push("");
  }
  if (draft.penaltyPerHour != null) {
    lines.push(`*Penalty per Hour (late):* ${draft.penaltyPerHour} birr`);
    lines.push("");
  }
  if (draft.expiryHours != null) {
    const now = new Date();
    const expiryDate = new Date(now.getTime() + draft.expiryHours * 3600 * 1000);
    const formatted = expiryDate.toLocaleString('en-US', {
      timeZone: 'Africa/Addis_Ababa',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    }) + " EAT";
    lines.push(`*Expiry:* ${formatted}`);
    lines.push("");
  }
  if (draft.exchangeStrategy) {
    // Format human-friendly
    let desc = "";
    if (draft.exchangeStrategy === "100%") {
      desc = "100% deliver → 100% pay";
    } else if (draft.exchangeStrategy === "30:40:30") {
      desc = "30% deliver → 30% pay → 40% deliver → 40% pay → 30% deliver → 30% pay";
    } else if (draft.exchangeStrategy === "50:50") {
      desc = "50% deliver → 50% pay → 50% deliver → 50% pay";
    }
    lines.push(`*Exchange Strategy:* ${desc}`);
    lines.push("");
  }
  // Optionally include user stats (earned/spent/avg rating) if desired:
  // lines.push(`*Creator Earned:* ${user.stats.totalEarned} birr`);
  return lines.join("\n");
}


// ------------------------------------
//  Helper: buildButton
//    - If highlighted=true, prefix with ✔ and set callbackData to a no-op
// ------------------------------------
function buildButton(textObj, callbackData, lang, highlighted = false) {
  if (highlighted) {
    return Markup.button.callback(`✔ ${textObj[lang]}`, `_DISABLED_${callbackData}`);
  }
  return Markup.button.callback(textObj[lang], callbackData);
}
const express = require("express");
const app = express();

// Health check endpoint
app.get("/", (_req, res) => res.send("OK"));

// Listen on Render’s port (or default 3000 locally)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Express server listening on port ${PORT}`);
});

// Then connect to Mongo and launch the bot
mongoose
  .connect(process.env.MONGODB_URI, { autoIndex: true })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });
// ------------------------------------
//  Main Bot Logic
// ------------------------------------
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const { session } = require('telegraf');
  bot.use(session());
  /**
 * Build an inline keyboard with:
 *  – ✅ prefix on the clicked button
 *  – clicked button inert (no callback_data)
 *  – other buttons keep their callback_data
 */
function buildMenu(ctx, buttons, clickedData) {
  const lang = ctx.session.user?.language || "en";
  return Markup.inlineKeyboard(
    buttons.map(row =>
      row.map(({ label, data, labelAm }) => {
        const text = (lang === "am" && labelAm) ? labelAm : label;
        if (data === clickedData) {
          // highlighted & inert
          return Markup.button.callback(`✅ ${text}`, undefined);
        } else {
          // still active
          return Markup.button.callback(text, data);
        }
      })
    )
  );
}

  


  // ─────────── /start Handler ───────────
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    // If user exists, reset all fields
    if (user) {
      
      user.fullName = null;
      user.phone = null;
      user.email = null;
      
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

    // Send language selection with two buttons
    return ctx.reply(
      `${TEXT.chooseLanguage.en}\n${TEXT.chooseLanguage.am}`,
      Markup.inlineKeyboard([
        [
          buildButton({ en: "English", am: "እንግሊዝኛ" }, "LANG_EN", "en", false),
          buildButton({ en: "Amharic", am: "አማርኛ" }, "LANG_AM", "en", false)
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

    // Highlight “English”; disable both
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

    // Highlight “Amharic”; disable both
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

  // ─────────── Text Handler (Full Name, Phone, Email, Username, Banks) ───────────
  bot.on("text", async (ctx, next) => {
    // ─────────── If drafting a task, skip onboarding handler ───────────
    if (ctx.session?.taskFlow) {
      return next();
    }
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
      user.onboardingStep = "usernameConfirm";
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
    if (user.onboardingStep === "usernameConfirm") {
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

      // If reached 10, auto‐proceed to T&C
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

    // 1) Send profile to user with placeholder buttons
    const menu = Markup.inlineKeyboard([
    [ buildButton({ en: "Post a Task", am: "ተግዳሮት ልጥፍ" }, "POST_TASK", user.language) ],[buildButton({ en: "Find a Task", am: "ተግዳሮት ፈልግ" }, "FIND_TASK", user.language)],
        [buildButton({ en: "Edit Profile", am: "ፕሮፋይል አርትዕ" }, "EDIT_PROFILE", user.language)]
      
  
    ]);
    await ctx.reply(profileText, menu);
    

    // 2) Send to Admin Channel
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

    

      
  

  // 2) Then send it up to your admin channel
  await ctx.telegram.sendMessage(
  ADMIN_CHANNEL,
  adminText,
  adminButtons   // ← pass the Markup object itself
);

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

    // Delete user record
    await User.deleteOne({ telegramId: tgId });
    return ctx.reply(user.language === "am" ? TEXT.ageError.am : TEXT.ageError.en);
  });

// ─────────── POST_TASK (start draft flow) ───────────
bot.action("POST_TASK", async (ctx) => {
  // answer the click without removing the message
  console.log("🔥 POST_TASK handler hit for", ctx.callbackQuery.data);
  await ctx.answerCbQuery();
  // highlight “Post a Task” and disable all three menu buttons
  const me   = await User.findOne({ telegramId: ctx.from.id });
  const lang = me?.language || "en";

 
  // send a fresh, disabled menu message with ✔️ on Post a Task
  await ctx.telegram.editMessageReplyMarkup(
  ctx.chat.id,
  ctx.callbackQuery.message.message_id,
  undefined,
  Markup.inlineKeyboard([[
    // ✔️ highlights the “Post a Task” button, all callbacks disabled
    Markup.button.callback(`✔️ ${TEXT.postTaskBtn[lang]}`,    undefined, { disabled: true }),
    Markup.button.callback(       TEXT.findTaskBtn[lang],    undefined, { disabled: true }),
    Markup.button.callback(       TEXT.editProfileBtn[lang], undefined, { disabled: true })
  ]])
);




  // remove any existing draft, then create a new one
  await TaskDraft.findOneAndDelete({ creatorTelegramId: ctx.from.id });
  const draft = await TaskDraft.create({ creatorTelegramId: ctx.from.id });

  // ❗️ Defensive init: if session middleware somehow didn't run,
  // make sure ctx.session is at least an object.
  if (!ctx.session) {
    ctx.session = {};
  }

  // now it’s safe to set taskFlow
  ctx.session.taskFlow = {
    step:    "description",
    draftId: draft._id.toString()
  };

  // ask for the first piece of data
  const prompt = ctx.from.language_code === "am"
    ? "የተግባሩን መግለጫ ያስገቡ። (አንስተው 20 ቁምፊ መሆን አለበት)"
    : "Write the task description (20–1250 chars).";
  return ctx.reply(prompt);
});


// ─────────── “Edit Task” Entry Point ───────────
bot.action("TASK_EDIT", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}

  // Fetch the draft you just created
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }

  // Mark that we’re in edit‐mode
  ctx.session.taskFlow = {
    isEdit: true,
    draftId:  draft._id.toString(),
    step:     null   // we’ll set this in the per‐field handlers
  };

  // Present the list of fields that can be edited
  const buttons = [
    [Markup.button.callback("✏️ Edit Description",   "EDIT_description")],
    [Markup.button.callback("📎 Edit Related File",   "EDIT_relatedFile")],
    [Markup.button.callback("🏷️ Edit Fields",         "EDIT_fields")],
    [Markup.button.callback("🎯 Edit Skill Level",    "EDIT_skillLevel")],
    [Markup.button.callback("💰 Edit Payment Fee",     "EDIT_paymentFee")],
    [Markup.button.callback("⏳ Edit Time to Complete","EDIT_timeToComplete")],
    [Markup.button.callback("🔄 Edit Revision Time",   "EDIT_revisionTime")],
    [Markup.button.callback("⏱️ Edit Penalty per Hour","EDIT_penaltyPerHour")],
    [Markup.button.callback("⌛ Edit Expiry Hours",     "EDIT_expiryHours")],
    [Markup.button.callback("🔀 Edit Exchange Strat.", "EDIT_exchangeStrategy")]
  ];
  return ctx.reply("Select which piece of the task you’d like to edit:", Markup.inlineKeyboard(buttons));
});


bot.on(['text','photo','document','video','audio'], async (ctx, next) => {
  if (!ctx.session.taskFlow) return next();
  const { step, draftId } = ctx.session.taskFlow;
  if (!draftId) {
    delete ctx.session.taskFlow;
    return ctx.reply("Session expired. Please click Post a Task again.");
  }
  const draft = await TaskDraft.findById(draftId);
  if (!draft) {
    delete ctx.session.taskFlow;
    return ctx.reply("Draft expired. Please click Post a Task again.");
  }
  switch(step) {
    case "description":
      return handleDescription(ctx, draft);
    case "relatedFile":
      return handleRelatedFile(ctx, draft);
    case "paymentFee":
      return handlePaymentFee(ctx, draft);
    case "timeToComplete":
      return handleTimeToComplete(ctx, draft);
    case "revisionTime":
      return handleRevisionTime(ctx, draft);
    case "penaltyPerHour":
      return handlePenaltyPerHour(ctx, draft);
    case "expiryHours":
      return handleExpiryHours(ctx, draft);
    // steps driven by callbacks (fields, skill level, exchangeStrategy) are in bot.action
    default:
      delete ctx.session.taskFlow;
      return ctx.reply("Unexpected error. Please start again.");
  }
});

async function handleDescription(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!text || text.length < 20 || text.length > 1250) {
    return ctx.reply("Sorry, Task Description must be 20–1250 characters. Try again.");
  }
  draft.description = text;
  await draft.save();
  // Check if this was triggered by an edit:
  if (ctx.session.taskFlow?.isEdit) {
    // Send confirmation + preview, then clear session
    await ctx.reply("✅ Description updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  // Initial flow: proceed to next step
  ctx.session.taskFlow.step = "relatedFile";
  return ctx.reply(
    "Send any related file (photo, document, etc.), or click Skip.",
    Markup.inlineKeyboard([ Markup.button.callback("Skip", "TASK_SKIP_FILE") ])
  );
}

bot.action("TASK_SKIP_FILE", async (ctx) => {
  await ctx.answerCbQuery();
  //try { await ctx.editMessageReplyMarkup(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
});

async function handleRelatedFile(ctx, draft) {
  let fileId, fileType;
  if (ctx.message.photo) {
    const photos = ctx.message.photo;
    fileId = photos[photos.length-1].file_id; fileType="photo";
  } else if (ctx.message.document) {
    fileId=ctx.message.document.file_id; fileType="document";
  } else if (ctx.message.video) {
    fileId=ctx.message.video.file_id; fileType="video";
  } else {
    return ctx.reply("Send a valid file or click Skip.");
  }
  draft.relatedFile = { fileId, fileType };
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Related file updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  // Initial flow: proceed to fields
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
}

function askFieldsPage(ctx, page) {
  const start = page * FIELDS_PER_PAGE;
  const end = Math.min(start + FIELDS_PER_PAGE, ALL_FIELDS.length);
  const keyboard = [];
  for (let i = start; i < end; i++) {
    const f = ALL_FIELDS[i];
    keyboard.push([ Markup.button.callback(f, `TASK_FIELD_${i}`) ]);
  }
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback("⬅️ Prev", `TASK_FIELDS_PAGE_${page-1}`));
  if (end < ALL_FIELDS.length) nav.push(Markup.button.callback("➡️ Next", `TASK_FIELDS_PAGE_${page+1}`));
  if (nav.length) keyboard.push(nav);
  // If user already has at least one:
  // We’ll check in DB:
  return ctx.reply(
    "Select 1–10 fields:",
    Markup.inlineKeyboard(keyboard)
  );
}

bot.action(/TASK_FIELD_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const idx = parseInt(ctx.match[1]);
  const field = ALL_FIELDS[idx];
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  if (!draft.fields.includes(field)) {
    draft.fields.push(field);
    await draft.save();
  }
  // If reached 10, proceed:
  if (draft.fields.length >= 10) {
    try { await ctx.deleteMessage(); } catch(_) {}
    ctx.session.taskFlow.step = "skillLevel";
    return ctx.reply(
      "Choose skill level:",
      Markup.inlineKeyboard([
        [Markup.button.callback("Beginner", "TASK_SKILL_Beginner")],
        [Markup.button.callback("Intermediate", "TASK_SKILL_Intermediate")],
        [Markup.button.callback("Professional", "TASK_SKILL_Professional")]
      ])
    );
  }
  // Otherwise, ask to add more or done:
  try { await ctx.deleteMessage(); } catch(_) {}
  // Show current selections and prompt:
  const buttons = [
    [Markup.button.callback("Add More", `TASK_FIELDS_PAGE_0`)],
    [Markup.button.callback("Done", "TASK_FIELDS_DONE")]
  ];
  return ctx.reply(
    `Selected: ${draft.fields.join(", ")}`,
    Markup.inlineKeyboard(buttons)
  );
});

bot.action(/TASK_FIELDS_PAGE_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch(_) {}
  const page = parseInt(ctx.match[1]);
  return askFieldsPage(ctx, page);
});

bot.action("TASK_FIELDS_DONE", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch(_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft || !draft.fields.length) {
    return ctx.reply("Select at least one field before proceeding.");
  }
  if (ctx.session.taskFlow?.isEdit) {
    // Confirmation branch for editing fields:
    await ctx.reply("✅ Fields updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  // Initial flow: proceed to skillLevel
  ctx.session.taskFlow.step = "skillLevel";
  return ctx.reply(
    "Choose skill level:",
    Markup.inlineKeyboard([
      [Markup.button.callback("Beginner", "TASK_SKILL_Beginner")],
      [Markup.button.callback("Intermediate", "TASK_SKILL_Intermediate")],
      [Markup.button.callback("Professional", "TASK_SKILL_Professional")]
    ])
  );
});
bot.action(/TASK_SKILL_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const lvl = ctx.match[1];
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  draft.skillLevel = lvl;
  await draft.save();

  if (ctx.session.taskFlow?.isEdit) {
    // Confirmation branch for edit:
    await ctx.reply("✅ Skill level updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  // Initial flow: proceed to paymentFee
  ctx.session.taskFlow.step = "paymentFee";
  return ctx.reply("How much is the payment fee amount (in birr)?");
});


async function handlePaymentFee(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!/^\d+$/.test(text)) {
    return ctx.reply("Please enter digits only.");
  }
  const val = parseInt(text,10);
  if (val < 50) {
    return ctx.reply("Amount cannot be less than 50 birr.");
  }
  draft.paymentFee = val;
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Payment fee updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  ctx.session.taskFlow.step = "timeToComplete";
  return ctx.reply("What’s the time required in hours to complete the task?");
}

async function handleTimeToComplete(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!/^\d+$/.test(text)) return ctx.reply("Digits only.");
  const hrs = parseInt(text,10);
  if (hrs <=0 || hrs>120) {
    return ctx.reply("Hours must be >0 and ≤120.");
  }
  draft.timeToComplete = hrs;
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Time to complete updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  ctx.session.taskFlow.step = "revisionTime";
  return ctx.reply("How many hours for revision (≤ half of total)?");
}

async function handleRevisionTime(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!/^\d+$/.test(text)) return ctx.reply("Digits only.");
  const rev = parseInt(text,10);
  if (rev < 0) return ctx.reply("Cannot be negative.");
  if (draft.timeToComplete != null && rev > draft.timeToComplete/2) {
    return ctx.reply("Revision time cannot exceed half of total time.");
  }
  draft.revisionTime = rev;
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Revision time updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  ctx.session.taskFlow.step = "penaltyPerHour";
  return ctx.reply("Give birr amount deducted per hour if late (≤20% of fee).");
}

async function handlePenaltyPerHour(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!/^\d+$/.test(text)) return ctx.reply("Digits only.");
  const pen = parseInt(text,10);
  if (pen < 0) return ctx.reply("Cannot be negative.");
  if (draft.paymentFee != null && pen > 0.2 * draft.paymentFee) {
    return ctx.reply("Cannot exceed 20% of payment fee.");
  }
  draft.penaltyPerHour = pen;
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Penalty per hour updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  ctx.session.taskFlow.step = "expiryHours";
  return ctx.reply("In how many hours does the offer expire? (1–24)");
}

async function handleExpiryHours(ctx, draft) {
  const text = ctx.message.text?.trim();
  if (!/^\d+$/.test(text)) return ctx.reply("Digits only.");
  const hrs = parseInt(text,10);
  if (hrs < 1 || hrs > 24) {
    return ctx.reply("Expiry must be between 1 and 24 hours.");
  }
  draft.expiryHours = hrs;
  await draft.save();
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply("✅ Expiry time updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback("Edit Task", "TASK_EDIT")],
        [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  ctx.session.taskFlow.step = "exchangeStrategy";
  return ctx.reply(
    "Choose exchange strategy:",
    Markup.inlineKeyboard([
      [Markup.button.callback("100%", "TASK_EX_100%")],
      [Markup.button.callback("30:40:30", "TASK_EX_30:40:30")],
      [Markup.button.callback("50:50", "TASK_EX_50:50")]
    ])
  );
}

bot.action(/TASK_EX_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const strat = ctx.match[1];
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  draft.exchangeStrategy = strat;
  await draft.save();
  // All data collected: send preview
  try { await ctx.deleteMessage(); } catch(_) {}
  // Build preview text
  const preview = buildPreviewText(draft, /* optionally fetch User for stats */ await User.findOne({ telegramId: ctx.from.id }));
  ctx.session.taskFlow = null; // clear flow
  return ctx.reply(preview, Markup.inlineKeyboard([
    [Markup.button.callback("Edit Task", "TASK_EDIT")],
    [Markup.button.callback("Post Task", "TASK_POST_CONFIRM")]
  ], { parse_mode: "Markdown" }));
});
bot.action("TASK_EDIT", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch(_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  // Show buttons for each detail
  const buttons = [
    [Markup.button.callback("Task Description", "EDIT_description")],
    [Markup.button.callback("Related File", "EDIT_relatedFile")],
    [Markup.button.callback("Fields", "EDIT_fields")],
    [Markup.button.callback("Skill Level", "EDIT_skillLevel")],
    [Markup.button.callback("Payment Fee", "EDIT_paymentFee")],
    [Markup.button.callback("Time to Complete", "EDIT_timeToComplete")],
    [Markup.button.callback("Revision Time", "EDIT_revisionTime")],
    [Markup.button.callback("Penalty per Hour", "EDIT_penaltyPerHour")],
    [Markup.button.callback("Expiry Offer Time", "EDIT_expiryHours")],
    [Markup.button.callback("Exchange Strategy", "EDIT_exchangeStrategy")]
  ];
  return ctx.reply("Select detail to edit:", Markup.inlineKeyboard(buttons));
});
bot.action("EDIT_description", async (ctx) => {
  await ctx.answerCbQuery();
  // Remove the “Select detail to edit” message
  try { await ctx.deleteMessage(); } catch (_) {}
  // Fetch draft
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  // Set session to capture the next text reply as description
  ctx.session.taskFlow = {
    step: "description",
    draftId: draft._id.toString(),
    isEdit: true
  };
  // Prompt user
  return ctx.reply("✏️ Write the new task description (20–1250 characters):");
});

bot.action("EDIT_relatedFile", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  // Set session to capture next file or Skip
  ctx.session.taskFlow = {
    step: "relatedFile",
    draftId: draft._id.toString(),
    isEdit: true
  };
  // Prompt with Skip button
  return ctx.reply(
    "📎 Send the new related file (photo, document, video, audio), or click Skip:",
    Markup.inlineKeyboard([
      Markup.button.callback("Skip", "TASK_SKIP_FILE")
    ])
  );
});
bot.action("EDIT_fields", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  // Reset fields or allow modifying; simplest: clear existing selections:
  draft.fields = [];
  await draft.save();
  ctx.session.taskFlow = {
    step: "fields",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return askFieldsPage(ctx, 0);
});

bot.action("EDIT_skillLevel", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  ctx.session.taskFlow = {
    step: "skillLevel",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply(
    "Choose the new skill level:",
    Markup.inlineKeyboard([
      [Markup.button.callback("Beginner", "TASK_SKILL_Beginner")],
      [Markup.button.callback("Intermediate", "TASK_SKILL_Intermediate")],
      [Markup.button.callback("Professional", "TASK_SKILL_Professional")]
    ])
  );
});

bot.action("EDIT_paymentFee", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "paymentFee",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply("Enter the new payment fee amount in birr (must be ≥50):");
});
bot.action("EDIT_timeToComplete", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "timeToComplete",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply("Enter the new time required in hours to complete the task (1–120):");
});
bot.action("EDIT_revisionTime", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "revisionTime",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply("Enter the new revision time in hours (≤ half of total time):");
});
bot.action("EDIT_penaltyPerHour", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "penaltyPerHour",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply("Enter the new birr amount deducted per hour if late (≤20% of payment fee):");
});
bot.action("EDIT_expiryHours", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "expiryHours",
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply("Enter the new expiry time in hours (1–24):");
});
bot.action("EDIT_exchangeStrategy", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    return ctx.reply("❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "exchangeStrategy",  // matches your middleware or pattern
    draftId: draft._id.toString(),
    isEdit: true
  };
  return ctx.reply(
    "Choose the new payment-task exchange strategy:",
    Markup.inlineKeyboard([
      [Markup.button.callback("100%", "TASK_EX_100%")],
      [Markup.button.callback("30:40:30", "TASK_EX_30:40:30")],
      [Markup.button.callback("50:50", "TASK_EX_50:50")]
    ])
  );
});

bot.action("TASK_POST_CONFIRM", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch(_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  // Build Task document
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found.");
  const now = new Date();
  const expiryDate = new Date(now.getTime() + draft.expiryHours*3600*1000);
  // Create Task in DB
  const task = await Task.create({
    creator: user._id,
    description: draft.description,
    relatedFile: draft.relatedFile?.fileId || null,
    fields: draft.fields,
    skillLevel: draft.skillLevel,
    paymentFee: draft.paymentFee,
    timeToComplete: draft.timeToComplete,
    revisionTime: draft.revisionTime,
    latePenalty: draft.penaltyPerHour,
    expiry: expiryDate,
    exchangeStrategy: draft.exchangeStrategy,
    status: "Open",
    applicants: [],
    stages: []
  });
  // Post to channel
  const channelId = process.env.CHANNEL_ID || "-1002254896955";
  const preview = buildPreviewText(draft, user);
  const sent = await ctx.telegram.sendMessage(channelId, preview, {
    parse_mode: "Markdown",
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("Apply", `APPLY_${task._id}`)]
    ])
  });
  // Save channel message id if needed:
  task.channelMessageId = sent.message_id;
  await task.save();

  // Notify creator with Cancel Task button
  await ctx.reply("✅ Your task is live!", Markup.inlineKeyboard([
    [Markup.button.callback("Cancel Task", `CANCEL_${task._id}`)]
  ]));
  // Delete draft
  await TaskDraft.findByIdAndDelete(draft._id);
});


  // ─────────── Placeholder Actions ───────────
  //bot.action("POST_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("FIND_TASK", (ctx) => ctx.answerCbQuery());
  bot.action("EDIT_PROFILE", (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_BAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_.+/, (ctx) => ctx.answerCbQuery());

  // ─────────── Launch Bot ───────────
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });
}
