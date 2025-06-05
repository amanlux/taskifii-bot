// src/index.js

/**
 * Taskifii Bot: Full Implementation with Onboarding, Profile Setup,
 * Post a Task, Find a Task, and Health/Concurrency Best Practices
 */

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const localizedFormat = require("dayjs/plugin/localizedFormat");
dayjs.extend(utc);
dayjs.extend(localizedFormat);

// ----------------------------------------------------------------------------
//  Ensure environment variables
// ----------------------------------------------------------------------------
if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set.");
  process.exit(1);
}

// ----------------------------------------------------------------------------
//  Connect to MongoDB Atlas (with strictQuery off for Mongoose 7 prep)
// ----------------------------------------------------------------------------
mongoose.set("strictQuery", true);
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    startBot();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// ----------------------------------------------------------------------------
//  Mongoose Schema & Model
// ----------------------------------------------------------------------------
const Schema = mongoose.Schema;

const userSchema = new Schema({
  telegramId:     { type: Number, unique: true, required: true },
  onboardingStep: { type: String, required: true }, // track onboarding or ongoing flows
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
    ratingSum:     { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 }
  },
  createdAt:      { type: Date, default: Date.now },
  // For “Post a Task” flow:
  postingTask: {
    title:            String,
    description:      String,
    relatedFileId:    String,
    fields:           [String],
    skillLevel:       String,
    paymentFee:       Number,
    completionHours:  Number,
    revisionHours:    Number,
    latePenalty:      Number,
    expiryHours:      Number,
    exchangeStrategy: String,
    category:         String,
    dueDate:          String, // YYYY-MM-DD
    isPosted:         { type: Boolean, default: false },
    postChannelId:    { type: String, default: null },
    postMessageId:    { type: Number, default: null },
    expiryTimestamp:  { type: Date, default: null }
  },
  // For “Find a Task” filter data (not persisted long-term):
  filterData: {
    fields:        [String],
    skillLevel:    String,
    minFee:        Number
  },
  // Ban info:
  isBanned:      { type: Boolean, default: false },
  banExpires:    { type: Date, default: null }
});

userSchema.index({ telegramId: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

const User = mongoose.model("User", userSchema);

// ----------------------------------------------------------------------------
//  Localized Text Constants
// ----------------------------------------------------------------------------
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
    am: "ሙሉ ስም አንስተው 3 ቁምፊ መሆኑ አለበት። ድጋፍ ይሁን።"
  },
  askPhone: {
    en: "What is your phone number? (digits only, 5–14 digits)",
    am: "የስልክ ቁጥርዎን ያስገቡ። (ቁጥሮች ብቻ፣ 5–14 ቁጥር)"
  },
  phoneErrorFormat: {
    en: "Please enter a valid phone number (5–14 digits)!",
    am: "እባክዎ ትክክለኛ የስልክ ቁጥር ያስገቡ። (5–14 ቁጥሮች)!"
  },
  phoneErrorTaken: {
    en: "Sorry, this phone number is already taken! Please enter another phone number!",
    am: "ይቅርታ፣ ይህ ስልክ ቁጥር ተጠቃሚ አስተጋቢ ነው! ሌላ የስልክ ቁጥር ያስገቡ!"
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
    am: "ይቅርታ፣ ይህ ኢሜይል አድራሻ ተጠቃሚ አልተገኘም! ሌላ ኢሜይል ያስገቡ!"
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
    am: "ይቅርታ፣ ይህ @username ተጠቃሚ አስተጋቢ ነው! ሌላ @username ያስገቡ!"
  },
  askBankDetails: {
    en: "Give us your online banking details (Maximum 10) in this format: `BankName,AccountNumber`. You may also include Telebirr by writing `Telebirr,YourPhoneNumber`. (This will be shared with another Taskifii user!)",
    am: "የባንክ ዝርዝሮችዎን (እስከ 10) በዚህ ቅጥ ያስገቡ። `BankName,AccountNumber`. Telebirr እንደ `Telebirr,YourPhoneNumber` መጨመር ይችላሉ። (ይህ ከሌላ ተጠቃሚ ጋር ይካፈላል!)"
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

  // --- “Post a Task” Flow Texts ---
  postAskDescription: {
    en: "Write the task description (20–1250 chars).",
    am: "የተግዳሮትን መግለጫ ያስገቡ (20–1250 ቁምፊ)."
  },
  postDescriptionError: {
    en: "Description must be between 20 and 1250 characters. Try again.",
    am: "መግለጫ በአስከ 20 እና ከ1250 ቁምፊ መካከል መሆን አለበት። ድጋፍ ይሁን።"
  },
  postAskFile: {
    en: "If you have a related file (video/image/etc.), send it now. Otherwise click “Skip.”\n(This file will be sent privately to the winning Task Doer.)",
    am: "ምንም ተግዳሮት ጋር የተያያዙ ፋይል (ቪዲዮ/ምስል/ወዘተ) ካለዎት አሁን ያስገቡ። ካልኖረዎ ደግሞ “Skip” ይጫኑ።\n(ይህ ፋይል በውስጥ ተግዳሮት ተወዳድሮ ይላካል.)"
  },
  postSkipBtn: {
    en: "Skip",
    am: "አልተገባም"
  },
  postAskFieldsIntro: {
    en: "Choose the fields for this task. Select at least one, up to 10, using the buttons below. After selecting, click “Add Another” or “Skip.”",
    am: "የተግዳሮትህን መስኮች ይምረጡ። አንድ ቢያንስ እስከ 10 መምረጥ ይችላሉ። ምርጫዎን ያድርጉ በኋላ “Add Another” ወይም “Skip” ይጫኑ።"
  },
  postFieldsError: {
    en: "Please select at least one field before proceeding.",
    am: "በመቀጠል ቢያንስ አንድ መስኮት ይምረጡ።"
  },
  postAskSkill: {
    en: "Choose your required skill level:\n• Beginner Level Skill\n• Intermediate Level Skill\n• Professional Level Skill",
    am: "የተግዳሮትን የችሎታ ደረጃ ይምረጡ።\n• መጀመሪያ ደረጃ\n• መካከለኛ ደረጃ\n• ባለሙያ ደረጃ"
  },
  postAskFee: {
    en: "How much is the payment fee amount (in birr)? Minimum 50.",
    am: "የክፍያው ዋጋ (ብር) ስንት ነው? አይብሮት ቢያንስ 50."
  },
  postFeeErrorFormat: {
    en: "Please enter a valid number (digits only)!",
    am: "እባክዎ ትክክለኛ ቁጥር ያስገቡ! (ቁጥሮች ብቻ)"
  },
  postFeeErrorMin: {
    en: "Sorry, fee cannot be less than 50 birr!",
    am: "ይቅርታ፣ መብር ቢያንስ 50 ብር መሆን አለበት!"
  },
  postAskCompletion: {
    en: "How many hours are required to complete the task? (1–120)",
    am: "ተግዳሮቱን ለመጨረስ ስንት ሰዓት ያስፈልጋል? (1–120)"
  },
  postCompletionErrorFormat: {
    en: "Please enter digits only!",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ!"
  },
  postCompletionErrorRange: {
    en: "Please enter a number between 1 and 120!",
    am: "እባክዎ ቁጥር በ1 እና በ120 መካከል ያስገቡ!"
  },
  postAskRevision: {
    en: "How many hours for revision (max half of completion hours)?",
    am: "ለእርምጃ ስንት ሰዓት መስጠት ያስፈልጋል? (ስርዓት የጨረሰ ሰዓት እኩል)"
  },
  postRevisionErrorFormat: {
    en: "Please enter digits only!",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ!"
  },
  postRevisionErrorRange: {
    en: "Revision time cannot exceed half of completion hours!",
    am: "የእርምጃ ተወካይ ስብስ እኩል እንዲሆን ይሁን!"
  },
  postAskPenalty: {
    en: "What birr amount per hour is deducted if task is late? (Max 20% of fee)",
    am: "በጊዜ ለመላክ ሲያደርጉት ስንት ብር ይቀናል? (ከብር 20% በላይ አይሆን)"
  },
  postPenaltyErrorFormat: {
    en: "Please enter digits only!",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ!"
  },
  postPenaltyErrorRange: {
    en: "Penalty cannot exceed 20% of the payment fee or be negative!",
    am: "የብር ቅናሽ ከብር 20% በላይ ወይም ከ0 በታች አይሆን!"
  },
  postAskExpiry: {
    en: "In how many hours will the “Apply” offer expire? (1–24)",
    am: "በስንት ሰዓት “Apply” የሚጥሩ ጊዜ ይጨርሳል? (1–24)"
  },
  postExpiryErrorFormat: {
    en: "Please enter digits only!",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ!"
  },
  postExpiryErrorRange: {
    en: "Expiry time must be between 1 and 24 hours!",
    am: "የማብረር ጊዜ በ1 እና በ24 ሰዓት መካከል ያስገቡ!"
  },
  postAskExchange: {
    en: "Choose your payment-task exchange strategy:\n• 100%\n• 30%:40%:30%\n• 50%:50%",
    am: "የክፍያ-ተግዳሮት አስተዋፅዖ ይምረጡ።\n• 100%\n• 30%:40%:30%\n• 50%:50%"
  },
  postAskCategory: {
    en: "Please choose a category: Cleaning, Delivery, Writing, Other.",
    am: "እባክዎ ምድብ ይምረጡ። Cleaning, Delivery, Writing, Other."
  },
  postCategoryError: {
    en: "Please choose a valid category: Cleaning, Delivery, Writing, or Other.",
    am: "እባክዎ ትክክለኛ ምድብ ይምረጡ። Cleaning, Delivery, Writing, Other."
  },
  postPreviewMissing: {
    en: "No tasks matching your criteria were found.",
    am: "ስለመረጡት መስኮች ምንም ተግዳሮቶች አልተገኝም."
  },
  postInvalidExchangeError: {
    en: `Please enter a valid exchange strategy (e.g. "100%" or "30%:40%:30%").`,
    am: `እባክዎ ትክክለኛ አስተዋፅዖ ያስገቡ። (ለምሳሌ "100%" ወይም "30%:40%:30%")`
  },
  postConfirmBtn: {
    en: "Confirm",
    am: "ማረጋገጫ"
  },
  postCancelBtn: {
    en: "Cancel",
    am: "ተሰርዟል"
  },
  postTaskPosted: {
    en: "Your task has been posted! Well done.",
    am: "ተግዳሮትዎ ተልኳል። መልካም ጥሩ ሥራ!"
  },
  postTaskCanceled: {
    en: "Your task has been canceled.",
    am: "ተግዳሮትዎ ተሰርዟል."
  },

  // --- “Find a Task” Flow Texts ---
  findIntro: {
    en: "Would you like to:\n1) Go to the channel to browse manually\n2) Filter tasks",
    am: "እንዲህ ይፈልጋሉ?\n1) በቻናል በተለመድ መመልከት\n2) ተግዳሮቶችን ማጣጣት"
  },
  findGoChannelBtn: {
    en: "Go to Channel",
    am: "ወደ ቻናል ይሂዱ"
  },
  findFilterBtn: {
    en: "Filter Tasks",
    am: "ተግዳሮቶችን ማጣጣት"
  },
  findAskSkill: {
    en: "Which skill level would you like to filter by?\n• Beginner Level Skill\n• Intermediate Level Skill\n• Professional Level Skill",
    am: "ምን የችሎታ ደረጃ ትፈልጋለህ?\n• መጀመሪያ ደረጃ\n• መካከለኛ ደረጃ\n• ባለሙያ ደረጃ"
  },
  findAskFieldsIntro: {
    en: "Select at least one field (up to 10) to filter. After selection, click “Add Another” or “Skip.”",
    am: "ቢያንስ አንድ (እስከ 10) መስኮት ይምረጡ። ምርጫዎን ያድርጉ በኋላ “Add Another” ወይም “Skip” ይጫኑ።"
  },
  findFieldsError: {
    en: "You must select at least one field to proceed.",
    am: "በመቀጠል ቢያንስ አንድ መስኮት መምረጥ አለቦት."
  },
  findAskMinFee: {
    en: "Enter the minimum task fee (in birr) you’re willing to accept (≥ 50).",
    am: "እባክዎ ያስፈልጋቸውን የተግዳሮት ክፍያ ዋጋ (ብር) ያስገቡ (≥ 50)."
  },
  findMinFeeErrorFormat: {
    en: "Please enter digits only!",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ!"
  },
  findMinFeeErrorRange: {
    en: "Minimum fee must be at least 50 birr!",
    am: "የመግቢያ ክፍያ ሊሆን የሚገባው ቢያንስ 50 ብር ነው!"
  },
  findFetching: {
    en: "Fetching tasks matching your criteria… Please wait up to 2 minutes.",
    am: "የመረጡትን መስኮቶች እየፈለጉ ነው… እባክዎን እስከ 2 ደቂቃ ድረስ ይጠብቁ."
  },

  // --- Health & Concurrency/Error Handling Texts ---
  errorGeneric: {
    en: "An unexpected error occurred; please try again later.",
    am: "አስቸጋሪ ስሕተት አጋጥሟል፤ እባክዎ በኋላ ደግመው ይሞክሩ."
  },
};

// ----------------------------------------------------------------------------
//  Helper: build Inline Button (disabled state prefixes with “_DISABLED_”)
// ----------------------------------------------------------------------------
function buildButton(textObj, callbackData, lang, highlighted = false) {
  if (highlighted) {
    return Markup.button.callback(`✔ ${textObj[lang]}`, `_DISABLED_${callbackData}`);
  }
  return Markup.button.callback(textObj[lang], callbackData);
}

// ----------------------------------------------------------------------------
//  Helper: Main Menu Reply Keyboard (5 buttons)
// ----------------------------------------------------------------------------
function getMainMenuKeyboard(lang) {
  return Markup.keyboard([
    [ TEXT.findTaskBtn[lang], TEXT.postTaskBtn[lang] ],
    [ TEXT.termsBtn[lang],   TEXT.editProfileBtn[lang] ],
    [ TEXT.languageBtn[lang] ]
  ])
    .oneTime(false)
    .resize();
}

// ----------------------------------------------------------------------------
//  In-Memory Session Store for “Post a Task” and “Find a Task”
// ----------------------------------------------------------------------------
// Keyed by telegramId; cleared when completed or canceled.
const sessions = {};

// ----------------------------------------------------------------------------
//  Rate-Limit Tracking (simple per-user flag for ongoing flows)
// ----------------------------------------------------------------------------
const rateLimitFlags = {}; // { telegramId: boolean } → true if in-progress

// ----------------------------------------------------------------------------
//  Start Bot Function
// ----------------------------------------------------------------------------
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Graceful error handler for unexpected errors
  bot.catch((err, ctx) => {
    console.error("❌ Unexpected error for ctx:", ctx.update, "\nError:", err);
    ctx.reply(ctx.session?.language === "am" ? TEXT.errorGeneric.am : TEXT.errorGeneric.en).catch(() => {});
  });

  // ───────────── /start Handler ─────────────
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    // Prevent overlapping flows
    if (rateLimitFlags[tgId]) {
      return ctx.reply(
        "Please finish your current process before restarting. If stuck, please /start again."
      );
    }

    let user = await User.findOne({ telegramId: tgId });
    if (user && user.onboardingStep === "completed") {
      const lang = user.language || "en";
      return ctx.reply(
        lang === "am"
          ? TEXT.mainMenuPrompt.am
          : TEXT.mainMenuPrompt.en,
        getMainMenuKeyboard(lang)
      );
    }

    // Reset or initialize user
    if (user) {
      user.language = null;
      user.fullName = null;
      user.phone = null;
      user.email = null;
      user.username = null;
      user.bankDetails = [];
      user.stats = {
        totalEarned: 0,
        totalSpent: 0,
        ratingSum: 0,
        averageRating: 0,
        ratingCount: 0
      };
      user.onboardingStep = "language";
      user.createdAt = Date.now();
      user.postingTask = {}; 
      user.filterData = {};
      user.isBanned = false;
      user.banExpires = null;
      await user.save();
    } else {
      user = new User({
        telegramId: tgId,
        onboardingStep: "language"
      });
      await user.save();
    }

    // Send language selection
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

  // ───────────── Language Selection ─────────────
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Disable buttons
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

    // Disable buttons
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

    return ctx.reply(
      "ቋንቋው ወደ አማርኛ ተቀይሯል።",
      Markup.inlineKeyboard([[buildButton(TEXT.setupProfileBtn, "DO_SETUP", "am", false)]])
    );
  });

  // ───────────── “Setup Profile” ─────────────
  bot.action("DO_SETUP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    // Disable button
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[buildButton(TEXT.setupProfileBtn, "DO_SETUP", user.language, true)]]
    });

    user.onboardingStep = "fullName";
    await user.save();
    return ctx.reply(user.language === "am" ? TEXT.askFullName.am : TEXT.askFullName.en);
  });

  // ───────────── Catch Disabled Buttons ─────────────
  bot.action(/_DISABLED_.+/, (ctx) => ctx.answerCbQuery());

  // ───────────── Text Handler (Onboarding & Main Menu & Flows) ─────────────
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    let user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    // If user is banned and ban not expired, block all commands
    if (user.isBanned && user.banExpires && dayjs().isBefore(dayjs(user.banExpires))) {
      return ctx.reply("🚫 You are currently banned and cannot use Taskifii until your ban expires.");
    }
    if (user.isBanned && user.banExpires && dayjs().isAfter(dayjs(user.banExpires))) {
      // Automatically unban if ban has expired
      user.isBanned = false;
      user.banExpires = null;
      await user.save();
    }

    // ─── If user completed onboarding and not in the middle of a rate-limited flow ───
    if (user.onboardingStep === "completed" && !rateLimitFlags[tgId]) {
      const lang = user.language || "en";

      // “Find a Task” from reply keyboard
      if (text === TEXT.findTaskBtn[lang]) {
        rateLimitFlags[tgId] = true;
        user.onboardingStep = "findingIntro";
        await user.save();
        return ctx.reply(
          user.language === "am" ? TEXT.findIntro.am : TEXT.findIntro.en,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(user.language === "am" ? TEXT.findGoChannelBtn.am : TEXT.findGoChannelBtn.en, "FIND_GO_CHANNEL"),
              Markup.button.callback(user.language === "am" ? TEXT.findFilterBtn.am : TEXT.findFilterBtn.en, "FIND_FILTER")
            ]
          ])
        );
      }

      // “Post a Task” from reply keyboard
      if (text === TEXT.postTaskBtn[lang]) {
        rateLimitFlags[tgId] = true;
        // Initialize session
        sessions[tgId] = {
          description: "",
          relatedFileId: null,
          fields: [],
          skillLevel: "",
          paymentFee: null,
          completionHours: null,
          revisionHours: null,
          latePenalty: null,
          expiryHours: null,
          exchangeStrategy: "",
          category: "",
          dueDate: ""
        };
        user.onboardingStep = "postDescription";
        await user.save();
        return ctx.reply(
          user.language === "am" ? TEXT.postAskDescription.am : TEXT.postAskDescription.en
        );
      }

      // “Terms & Conditions” from reply keyboard
      if (text === TEXT.termsBtn[lang]) {
        return ctx.reply(
          user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en
        );
      }

      // “Edit Profile” from reply keyboard
      if (text === TEXT.editProfileBtn[lang]) {
        // Placeholder—actual edit logic handled elsewhere
        return ctx.reply(
          user.language === "am" ? "ፕሮፋይል አርትዕ ተሞልቷል። (ፈጣን አድርጉ)" : "Edit Profile feature coming soon!"
        );
      }

      // “Language/ቋንቋ” from reply keyboard
      if (text === TEXT.languageBtn[lang]) {
        return ctx.reply(
          user.language === "am" ? "ቋንቋ ይምረጡ።" : "Please choose your language:",
          Markup.keyboard([
            [ TEXT.languageOptionAm[lang], TEXT.languageOptionEn[lang] ]
          ])
            .oneTime(true)
            .resize()
        );
      }

      // Selecting new language from main menu
      if (text === TEXT.languageOptionAm[lang] || text === TEXT.languageOptionAm["en"]) {
        user.language = "am";
        await user.save();
        return ctx.reply(
          "ቋንቋ ወደ አማርኛ ተቀይሯል።",
          getMainMenuKeyboard("am")
        );
      }
      if (text === TEXT.languageOptionEn[lang] || text === TEXT.languageOptionEn["am"]) {
        user.language = "en";
        await user.save();
        return ctx.reply(
          "Language set to English.",
          getMainMenuKeyboard("en")
        );
      }

      // Any other text on main menu just re-show main menu
      return ctx.reply(
        lang === "am"
          ? TEXT.mainMenuPrompt.am
          : TEXT.mainMenuPrompt.en,
        getMainMenuKeyboard(lang)
      );
    }

    // ───────────── Onboarding Steps ─────────────

    // FULL NAME
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

    // PHONE
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

    // EMAIL
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

    // USERNAME (typed override)
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
      } catch {
        // ignore if too old to edit
      }

      user.username = reply;
      user.onboardingStep = "bankFirst";
      await user.save();
      return ctx.reply(user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en);
    }

    // First BANK entry
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

    // Bank Adding
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

    // Bank Replacing
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

    // Bank Done
    if (user.onboardingStep === "bankMulti" && text && !text.match(/^(Add|Replace|Done|ጨምር|ቀይር|ተጠናቋል)$/i)) {
      // If user typed something else instead of clicking a button, ignore
    }
    if (user.onboardingStep === "bankMulti") {
      // No text step here; actions handled by inline buttons
    }

    // TERMS & CONDITIONS REVIEW
    if (user.onboardingStep === "termsReview") {
      return ctx.reply(
        user.language === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
        Markup.inlineKeyboard([
          [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
          [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
        ])
      );
    }

    // AGE VERIFICATION is handled via buttons

    // ───────────── “Post a Task” Flow Steps ─────────────
    if (user.onboardingStep === "postDescription") {
      const desc = text;
      if (desc.length < 20 || desc.length > 1250) {
        return ctx.reply(
          user.language === "am" ? TEXT.postDescriptionError.am : TEXT.postDescriptionError.en
        );
      }
      sessions[tgId].description = desc;
      user.onboardingStep = "postFile";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskFile.am : TEXT.postAskFile.en,
        Markup.inlineKeyboard([
          [ Markup.button.callback(user.language === "am" ? TEXT.postSkipBtn.am : TEXT.postSkipBtn.en, "POST_SKIP_FILE") ]
        ])
      );
    }

    if (user.onboardingStep === "postAskUploadFile" && ctx.message.document) {
      // Save file_id to session
      const fileId = ctx.message.document.file_id;
      sessions[tgId].relatedFileId = fileId;
      user.onboardingStep = "postFields";
      await user.save();

      return ctx.reply(
        user.language === "am" ? TEXT.postAskFieldsIntro.am : TEXT.postAskFieldsIntro.en
      );
    }

    // User sent text instead of file in “postFile”
    if (user.onboardingStep === "postFile" && text !== TEXT.postSkipBtn[user.language]) {
      return ctx.reply(
        user.language === "am"
          ? "እባክዎ ፋይል ወይም “Skip” ይጫኑ።"
          : "Please send a file or click “Skip.”"
      );
    }

    // “Skip” pressed
    if (user.onboardingStep === "postFile" && text === TEXT.postSkipBtn[user.language]) {
      sessions[tgId].relatedFileId = null;
      user.onboardingStep = "postFields";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskFieldsIntro.am : TEXT.postAskFieldsIntro.en
      );
    }

    // Handling Field selections by button; text not used here until summary
    if (user.onboardingStep === "postFields") {
      // Ignore stray text; actual field selection handled in actions
      return;
    }

    // “Add Another Field” or “Skip” pressed after first selection
    if (user.onboardingStep === "postFieldsAddOrSkip") {
      // Ignore stray text
      return;
    }

    // Skill Level
    if (user.onboardingStep === "postSkill" && text && !["Beginner Level Skill", "Intermediate Level Skill", "Professional Level Skill",
        "መጀመሪያ ደረጃ", "መካከለኛ ደረጃ", "ባለሙያ ደረጃ"].includes(text)) {
      // stray text, ignore
    }

    // Payment Fee
    if (user.onboardingStep === "postFee") {
      const num = parseFloat(text);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postFeeErrorFormat.am : TEXT.postFeeErrorFormat.en
        );
      }
      if (num < 50) {
        return ctx.reply(
          user.language === "am" ? TEXT.postFeeErrorMin.am : TEXT.postFeeErrorMin.en
        );
      }
      sessions[tgId].paymentFee = num;
      user.onboardingStep = "postCompletion";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskCompletion.am : TEXT.postAskCompletion.en
      );
    }

    // Completion Hours
    if (user.onboardingStep === "postCompletion") {
      const num = parseInt(text, 10);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postCompletionErrorFormat.am : TEXT.postCompletionErrorFormat.en
        );
      }
      if (num < 1 || num > 120) {
        return ctx.reply(
          user.language === "am" ? TEXT.postCompletionErrorRange.am : TEXT.postCompletionErrorRange.en
        );
      }
      sessions[tgId].completionHours = num;
      user.onboardingStep = "postRevision";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskRevision.am : TEXT.postAskRevision.en
      );
    }

    // Revision Hours
    if (user.onboardingStep === "postRevision") {
      const num = parseInt(text, 10);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postRevisionErrorFormat.am : TEXT.postRevisionErrorFormat.en
        );
      }
      const maxRev = Math.floor(sessions[tgId].completionHours / 2);
      if (num < 0 || num > maxRev) {
        return ctx.reply(
          user.language === "am" ? TEXT.postRevisionErrorRange.am : TEXT.postRevisionErrorRange.en
        );
      }
      sessions[tgId].revisionHours = num;
      user.onboardingStep = "postPenalty";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskPenalty.am : TEXT.postAskPenalty.en
      );
    }

    // Late-Penalty
    if (user.onboardingStep === "postPenalty") {
      const num = parseInt(text, 10);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postPenaltyErrorFormat.am : TEXT.postPenaltyErrorFormat.en
        );
      }
      const maxPen = Math.floor(0.2 * sessions[tgId].paymentFee);
      if (num < 0 || num > maxPen) {
        return ctx.reply(
          user.language === "am" ? TEXT.postPenaltyErrorRange.am : TEXT.postPenaltyErrorRange.en
        );
      }
      sessions[tgId].latePenalty = num;
      user.onboardingStep = "postExpiry";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskExpiry.am : TEXT.postAskExpiry.en
      );
    }

    // Expiry Hours
    if (user.onboardingStep === "postExpiry") {
      const num = parseInt(text, 10);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postExpiryErrorFormat.am : TEXT.postExpiryErrorFormat.en
        );
      }
      if (num < 1 || num > 24) {
        return ctx.reply(
          user.language === "am" ? TEXT.postExpiryErrorRange.am : TEXT.postExpiryErrorRange.en
        );
      }
      sessions[tgId].expiryHours = num;
      user.onboardingStep = "postExchange";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskExchange.am : TEXT.postAskExchange.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("100%", "POST_EXCHANGE_100"),
            Markup.button.callback("30%:40%:30%", "POST_EXCHANGE_30_40_30")
          ],
          [
            Markup.button.callback("50%:50%", "POST_EXCHANGE_50_50")
          ]
        ])
      );
    }

    // Category selection (after exchange strategy)
    if (user.onboardingStep === "postCategory" && text) {
      const allowed = ["Cleaning", "Delivery", "Writing", "Other"];
      const allowedAm = allowed; // no translation here
      if (!allowed.includes(text) && !allowedAm.includes(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.postCategoryError.am : TEXT.postCategoryError.en
        );
      }
      sessions[tgId].category = text;
      user.onboardingStep = "postConfirm";
      await user.save();

      // Build Preview
      const s = sessions[tgId];
      const previewLinesEn = [
        "🟢 Task is open!",
        `Task Description: ${s.description}`,
        s.relatedFileId ? "Related file: (sent privately)" : "",
        `Fields: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
        `Skill level required: ${s.skillLevel}`,
        `Payment Fee: ${s.paymentFee} birr`,
        `Time to complete: ${s.completionHours} hour(s)`,
        `Revision time: ${s.revisionHours} hour(s)`,
        `Late-submission penalty: ${s.latePenalty} birr/hour`,
        `Expiry: ${dayjs().add(s.expiryHours, "hour").tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
        `Category: ${s.category}`,
        `Payment-Task exchange strategy: ${s.exchangeStrategy}`,
        "",
        "✅ Click “Confirm” to post, or “Cancel” to discard."
      ];
      const previewLinesAm = [
        "🟢 ተግዳሮት መክፈት ተዘጋጅቷል!",
        `የተግዳሮት መግለጫ: ${s.description}`,
        s.relatedFileId ? "የተያያዙ ፋይል: (በውስጥ ይልካል)" : "",
        `መስኮች: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
        `የችሎታ ደረጃ የሚፈልጉት: ${s.skillLevel}`,
        `የክፍያ መጠን: ${s.paymentFee} ብር`,
        `ለመጨረስ ያስፈለገው ጊዜ: ${s.completionHours} ሰዓት`,
        `የእርምጃ ጊዜ: ${s.revisionHours} ሰዓት`,
        `በሲር ሰዓት የተቀነሰ ብር: ${s.latePenalty} ብር/ሰዓት`,
        `የመድረሻ ጊዜ: ${dayjs().add(s.expiryHours, "hour").tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
        `ምድብ: ${s.category}`,
        `የክፍያ-ተግዳሮት አስተዋፅዖ: ${s.exchangeStrategy}`,
        "",
        "✅ “Confirm” አጭር ተጫን ተግዳሮት ይልክ፤ “Cancel” አጭር ይጫኑ ተሰርዙ."
      ];

      return ctx.reply(
        user.language === "am" ? previewLinesAm.join("\n") : previewLinesEn.join("\n"),
        Markup.inlineKeyboard([
          [Markup.button.callback(user.language === "am" ? TEXT.postConfirmBtn.am : TEXT.postConfirmBtn.en, "POST_CONFIRM")],
          [Markup.button.callback(user.language === "am" ? TEXT.postCancelBtn.am : TEXT.postCancelBtn.en, "POST_CANCEL")]
        ])
      );
    }

    // ───────────── “Find a Task” Text-Based Steps ─────────────
    if (user.onboardingStep === "findingIntro") {
      // ignore stray text; choices handled by inline buttons
      return;
    }

    if (user.onboardingStep === "findingSkill") {
      // ignore stray text; skill chosen via buttons
      return;
    }

    if (user.onboardingStep === "findingFields") {
      // ignore stray text; fields via pagination buttons
      return;
    }

    if (user.onboardingStep === "findingMinFee") {
      const num = parseInt(text, 10);
      if (isNaN(num)) {
        return ctx.reply(
          user.language === "am" ? TEXT.findMinFeeErrorFormat.am : TEXT.findMinFeeErrorFormat.en
        );
      }
      if (num < 50) {
        return ctx.reply(
          user.language === "am" ? TEXT.findMinFeeErrorRange.am : TEXT.findMinFeeErrorRange.en
        );
      }
      sessions[tgId].filterMinFee = num;
      user.onboardingStep = "findingSearch";
      await user.save();

      // Fetch tasks up to 2 minutes
      return doFindTasks(ctx, user);
    }

    // If none matched, do nothing
  });

  // ───────────── “Yes, keep it” Username Action ─────────────
  bot.action("USERNAME_KEEP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");
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

  // ───────────── Bank “Add” Action ─────────────
  bot.action("BANK_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

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

  // ───────────── Bank “Replace” Action ─────────────
  bot.action("BANK_REPLACE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

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
        ? "የባንኩ መጨመሪያው ተሰርዟል። አዲስ በ `BankName,AccountNumber` ቅጥ ያስገቡ።"
        : "Your last bank entry was removed. Please type a new entry in `BankName,AccountNumber` format."
    );
  });

  // ───────────── Bank “Done” Action ─────────────
  bot.action("BANK_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

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

  // ───────────── Terms & Conditions Actions ─────────────
  bot.action("TC_AGREE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

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

  // ───────────── Age Verification Actions ─────────────
  bot.action("AGE_YES", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${TEXT.ageYesBtn[user.language]}`, `_DISABLED_AGE_YES`),
        Markup.button.callback(`${TEXT.ageNoBtn[user.language]}`, `_DISABLED_AGE_NO`)
      ]]
    });

    // Check uniqueness once more before finalizing
    const phoneConflict = await User.findOne({ phone: user.phone, telegramId: { $ne: tgId } });
    const emailConflict = await User.findOne({ email: user.email, telegramId: { $ne: tgId } });
    const usernameConflict = await User.findOne({ username: user.username, telegramId: { $ne: tgId } });
    let conflictMsg = null;
    if (phoneConflict) conflictMsg = user.language === "am"
      ? TEXT.phoneErrorTaken.am
      : TEXT.phoneErrorTaken.en;
    else if (emailConflict) conflictMsg = user.language === "am"
      ? TEXT.emailErrorTaken.am
      : TEXT.emailErrorTaken.en;
    else if (usernameConflict) conflictMsg = user.language === "am"
      ? TEXT.usernameErrorTaken.am
      : TEXT.usernameErrorTaken.en;

    if (conflictMsg) {
      user.onboardingStep = conflictMsg.includes("phone") ? "phone"
        : conflictMsg.includes("email") ? "email"
        : "username";
      await user.save();
      return ctx.reply(conflictMsg);
    }

    user.onboardingStep = "completed";
    await user.save();

    // Build final profile post to user
    const banksList = user.bankDetails
      .map((b) => `${b.bankName} (${b.accountNumber})`)
      .join(", ") || "N/A";
    const langLabel = user.language === "am" ? "አማርኛ" : "English";
    const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY");

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

    // 1) Send profile to user with main menu
    await ctx.reply(
      user.language === "am" ? profileLinesAm.join("\n") : profileLinesEn.join("\n"),
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

    // Clear rate limit
    rateLimitFlags[tgId] = false;
    return;
  });

  bot.action("AGE_NO", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return ctx.reply("Unexpected error. Please /start again.");

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`${TEXT.ageYesBtn[user.language]}`, `_DISABLED_AGE_YES`),
        Markup.button.callback(`✔ ${TEXT.ageNoBtn[user.language]}`, `_DISABLED_AGE_NO`)
      ]]
    });

    await User.deleteOne({ telegramId: tgId });
    rateLimitFlags[tgId] = false;
    return ctx.reply(user.language === "am" ? TEXT.ageError.am : TEXT.ageError.en);
  });

  // ───────────── Placeholder Admin Actions ─────────────
  bot.action(/ADMIN_BAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_.+/, (ctx) => ctx.answerCbQuery());

  // ───────────── “Post a Task” Flow Actions ─────────────

  // POST_SKIP_FILE
  bot.action("POST_SKIP_FILE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFile") {
      return ctx.reply("No file request in progress.");
    }
    sessions[tgId].relatedFileId = null;
    user.onboardingStep = "postFields";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.postAskFieldsIntro.am : TEXT.postAskFieldsIntro.en
    );
  });

  // Field Pagination & Selection (example with a small subset of 10 fields for brevity)
  const ALL_FIELDS = [
    "Software Development",
    "Data Science",
    "Writing",
    "Graphic Design",
    "Marketing",
    "Translation",
    "Video Editing",
    "Accounting",
    "Customer Support",
    "Virtual Assistance"
    // ... (up to 80 fields in real system)
  ];
  function getFieldPage(pageIndex, chosen) {
    const pageSize = 10;
    const start = pageIndex * pageSize;
    const pageFields = ALL_FIELDS.slice(start, start + pageSize);
    const buttons = pageFields.map((f) => {
      const label = chosen.includes(f) ? `✔ ${f}` : f;
      const data = chosen.includes(f) ? `_DISABLED_FIELD_${start + pageFields.indexOf(f)}` : `FIELD_${start + pageFields.indexOf(f)}`;
      return Markup.button.callback(label, data);
    });
    // Prev/Next
    const navBtns = [];
    if (pageIndex > 0) {
      navBtns.push(Markup.button.callback("⬅️", `FIELD_PAGE_${pageIndex - 1}`));
    }
    if (start + pageSize < ALL_FIELDS.length) {
      navBtns.push(Markup.button.callback("➡️", `FIELD_PAGE_${pageIndex + 1}`));
    }
    return { buttons, navBtns };
  }

  // Show initial field page
  bot.action("POST_FIELDS_START", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFields") {
      return ctx.reply("No field selection in progress.");
    }
    user.onboardingStep = "postFieldPage0";
    await user.save();
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) keyboard.push(navBtns);
    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskFieldsIntro.am
        : TEXT.postAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // Handle Page Navigation
  bot.action(/FIELD_PAGE_\d+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const parts = data.split("_");
    const pageIndex = parseInt(parts[2], 10);
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || !user.onboardingStep.startsWith("postFieldPage")) {
      return ctx.reply("No field selection in progress.");
    }
    user.onboardingStep = `postFieldPage${pageIndex}`;
    await user.save();

    const { buttons, navBtns } = getFieldPage(pageIndex, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) keyboard.push(navBtns);
    return ctx.editMessageReplyMarkup({
      inline_keyboard: keyboard
    });
  });

  // Handle Field Selection
  bot.action(/FIELD_\d+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const idx = parseInt(data.split("_")[1], 10);
    const fieldName = ALL_FIELDS[idx];
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || !user.onboardingStep.startsWith("postFieldPage")) {
      return ctx.reply("No field selection in progress.");
    }
    // Add to chosen fields if not already chosen
    if (!sessions[tgId].fields.includes(fieldName)) {
      sessions[tgId].fields.push(fieldName);
    }
    // If reached 10, proceed
    if (sessions[tgId].fields.length >= 10) {
      user.onboardingStep = "postSkill";
      await user.save();
      return ctx.reply(
        user.language === "am" ? TEXT.postAskSkill.am : TEXT.postAskSkill.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("መጀመሪያ ደረጃ", "POST_SKILL_BEGINNER"),
            Markup.button.callback("መካከለኛ ደረጃ", "POST_SKILL_INTERMEDIATE"),
            Markup.button.callback("ባለሙያ ደረጃ", "POST_SKILL_PROFESSIONAL")
          ]
        ])
      );
    }

    // Otherwise, ask “Add Another Field” or “Skip”
    user.onboardingStep = "postFieldsAddOrSkip";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? `${TEXT.postAskFieldsIntro.am}\n\nየተመረጡት: ${sessions[tgId].fields.join(", ")}\n\n• “Add Another” ይጫኑ ወይም “Skip” ይጫኑ።`
        : `${TEXT.postAskFieldsIntro.en}\n\nSelected: ${sessions[tgId].fields.join(", ")}\n\n• Click “Add Another” or “Skip.”`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(user.language === "am" ? "Add Another" : "Add Another", "POST_FIELDS_CONTINUE"),
          Markup.button.callback(user.language === "am" ? "Skip" : "Skip", "POST_FIELDS_SKIP")
        ]
      ])
    );
  });

  // Continue selecting fields (go back to first page)
  bot.action("POST_FIELDS_CONTINUE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    user.onboardingStep = "postFieldPage0";
    await user.save();
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) keyboard.push(navBtns);
    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskFieldsIntro.am
        : TEXT.postAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // Skip selecting more fields
  bot.action("POST_FIELDS_SKIP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    if (sessions[tgId].fields.length === 0) {
      return ctx.reply(user.language === "am"
        ? TEXT.postFieldsError.am
        : TEXT.postFieldsError.en
      );
    }
    user.onboardingStep = "postSkill";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.postAskSkill.am : TEXT.postAskSkill.en,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("መጀመሪያ ደረጃ", "POST_SKILL_BEGINNER"),
          Markup.button.callback("መካከለኛ ደረጃ", "POST_SKILL_INTERMEDIATE"),
          Markup.button.callback("ባለሙያ ደረጃ", "POST_SKILL_PROFESSIONAL")
        ]
      ])
    );
  });

  // Skill Level Selection
  bot.action(/POST_SKILL_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postSkill") {
      return ctx.reply("No skill selection in progress.");
    }
    let level;
    if (data === "POST_SKILL_BEGINNER") level = "Beginner";
    if (data === "POST_SKILL_INTERMEDIATE") level = "Intermediate";
    if (data === "POST_SKILL_PROFESSIONAL") level = "Professional";

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${level === "Beginner" ? "Beginner Level Skill" : level === "Intermediate" ? "Intermediate Level Skill" : "Professional Level Skill"}`, `_DISABLED_${data}`)
      ]]
    });

    sessions[tgId].skillLevel = level;
    user.onboardingStep = "postFee";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.postAskFee.am : TEXT.postAskFee.en
    );
  });

  // Exchange Strategy Selection
  bot.action(/POST_EXCHANGE_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postExchange") {
      return ctx.reply("No exchange selection in progress.");
    }
    let strat;
    if (data === "POST_EXCHANGE_100") strat = "100%";
    if (data === "POST_EXCHANGE_30_40_30") strat = "30%:40%:30%";
    if (data === "POST_EXCHANGE_50_50") strat = "50%:50%";

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${strat}`, `_DISABLED_${data}`)
      ]]
    });

    sessions[tgId].exchangeStrategy = strat;
    user.onboardingStep = "postCategory";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.postAskCategory.am : TEXT.postAskCategory.en
    );
  });

  // POST_CONFIRM
  bot.action("POST_CONFIRM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postConfirm") {
      return ctx.reply("No task in progress to confirm.");
    }

    // Save postingTask in DB
    Object.assign(user.postingTask, sessions[tgId]);
    user.postingTask.isPosted = true;
    user.postingTask.expiryTimestamp = dayjs().add(sessions[tgId].expiryHours, "hour").toDate();
    await user.save();

    // Post to channel
    const CHANNEL_ID = "-1002254896955";
    const s = sessions[tgId];
    const previewLinesEn = [
      "🟢 Task is open!",
      `Task Description: ${s.description}`,
      s.relatedFileId ? `(Related file attached privately)` : "",
      `Fields: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
      `Skill level required: ${s.skillLevel}`,
      `Payment Fee: ${s.paymentFee} birr`,
      `Time to complete: ${s.completionHours} hour(s)`,
      `Revision time: ${s.revisionHours} hour(s)`,
      `Late-submission penalty: ${s.latePenalty} birr/hour`,
      `Expiry: ${dayjs(user.postingTask.expiryTimestamp).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
      `Category: ${s.category}`,
      `Payment-Task exchange strategy: ${s.exchangeStrategy}`,
      `Creator Banks: ${user.bankDetails.map(b => b.bankName).join(", ")}`,
      `Creator Earned: ${user.stats.totalEarned.toFixed(2)} birr | Spent: ${user.stats.totalSpent.toFixed(2)} birr | Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} reviews)`
    ];
    const previewLinesAm = [
      "🟢 ተግዳሮት መክፈት ተዘጋጅቷል!",
      `የተግዳሮት መግለጫ: ${s.description}`,
      s.relatedFileId ? `(የተያያዙ ፋይል በውስጥ ተልኗል)` : "",
      `መስኮች: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
      `የችሎታ ደረጃ: ${s.skillLevel}`,
      `የክፍያ መጠን: ${s.paymentFee} ብር`,
      `የመጨረሻ ጊዜ: ${s.completionHours} ሰዓት`,
      `የእርምጃ ጊዜ: ${s.revisionHours} ሰዓት`,
      `የውስጥ ብር ቅናሽ: ${s.latePenalty} ብር/ሰዓት`,
      `የብረት መድረሻ: ${dayjs(user.postingTask.expiryTimestamp).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
      `ምድብ: ${s.category}`,
      `የክፍያ-ተግዳሮት አስተዋፅዖ: ${s.exchangeStrategy}`,
      `የፓየር ባንኮች: ${user.bankDetails.map(b => b.bankName).join(", ")}`,
      `የተጠቀመው ጠቅላላ: ${user.stats.totalEarned.toFixed(2)} ብር | የተከፈለው ጠቅላላ: ${user.stats.totalSpent.toFixed(2)} ብር | ደብዳቤ: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)`
    ];

    const postMessageEn = await ctx.telegram.sendMessage(
      CHANNEL_ID,
      previewLinesEn.join("\n"),
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(user.language === "am" ? "Apply" : "Apply", `APPLY_${tgId}_${user._id}`)]
        ])
      }
    );
    // Save channel post IDs
    user.postingTask.postChannelId = CHANNEL_ID;
    user.postingTask.postMessageId = postMessageEn.message_id;
    await user.save();

    // Notify creator in private
    await ctx.reply(
      user.language === "am"
        ? TEXT.postTaskPosted.am
        : TEXT.postTaskPosted.en,
      getMainMenuKeyboard(user.language)
    );

    // Clean up session & rate limit
    delete sessions[tgId];
    rateLimitFlags[tgId] = false;
    return;
  });

  // POST_CANCEL
  bot.action("POST_CANCEL", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postConfirm") {
      return ctx.reply("No task in progress to cancel.");
    }
    delete sessions[tgId];
    user.onboardingStep = "completed";
    await user.save();
    rateLimitFlags[tgId] = false;
    return ctx.reply(
      user.language === "am"
        ? TEXT.postTaskCanceled.am
        : TEXT.postTaskCanceled.en,
      getMainMenuKeyboard(user.language)
    );
  });

  // ───────────── “Find a Task” Actions ─────────────

  // FIND_GO_CHANNEL
  bot.action("FIND_GO_CHANNEL", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingIntro") {
      return ctx.reply("No find flow in progress.");
    }
    user.onboardingStep = "completed";
    await user.save();
    rateLimitFlags[tgId] = false;
    return ctx.reply(
      user.language === "am"
        ? "ወደ ቻናል ተሄድሁ።"
        : "Please browse tasks in @TaskifiiRemote."
    );
  });

  // FIND_FILTER
  bot.action("FIND_FILTER", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingIntro") {
      return ctx.reply("No find flow in progress.");
    }
    user.onboardingStep = "findingSkill";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.findAskSkill.am : TEXT.findAskSkill.en,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("መጀመሪያ ደረጃ", "FIND_SKILL_BEGINNER"),
          Markup.button.callback("መካከለኛ ደረጃ", "FIND_SKILL_INTERMEDIATE"),
          Markup.button.callback("ባለሙያ ደረጃ", "FIND_SKILL_PROFESSIONAL")
        ]
      ])
    );
  });

  bot.action(/FIND_SKILL_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingSkill") {
      return ctx.reply("No find flow in progress.");
    }
    let level;
    if (data === "FIND_SKILL_BEGINNER") level = "Beginner";
    if (data === "FIND_SKILL_INTERMEDIATE") level = "Intermediate";
    if (data === "FIND_SKILL_PROFESSIONAL") level = "Professional";

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${level === "Beginner" ? "መጀመሪያ ደረጃ" : level === "Intermediate" ? "መካከለኛ ደረጃ" : "ባለሙያ ደረጃ"}`, `_DISABLED_${data}`)
      ]]
    });

    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].filterSkillLevel = level;
    user.onboardingStep = "findingFields";
    await user.save();

    // Show first field page for filtering
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields || []);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) keyboard.push(navBtns);
    return ctx.reply(
      user.language === "am" ? TEXT.findAskFieldsIntro.am : TEXT.findAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // Reuse FIELD_PAGE and FIELD_ selection logic; after skip, go to minFee
  bot.action("POST_FIELDS_SKIP", async (ctx) => {
    // Already handled in post flow; ignore here for find
  });

  bot.action("POST_FIELDS_CONTINUE", async (ctx) => {
    // Already handled in post flow; ignore here for find
  });

  bot.action(/FIELD_\d+/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const idx = parseInt(data.split("_")[1], 10);
    const fieldName = ALL_FIELDS[idx];
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || !user.onboardingStep.startsWith("findingFields")) {
      // may also be post flow; ignore if not in find
      return;
    }
    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].fields = sessions[tgId].fields || [];
    if (!sessions[tgId].fields.includes(fieldName)) {
      sessions[tgId].fields.push(fieldName);
    }
    user.onboardingStep = "findingFieldsAddOrSkip";
    await user.save();
    return ctx.reply(
      user.language === "am"
        ? `${TEXT.findAskFieldsIntro.am}\n\nየተመረጡት: ${sessions[tgId].fields.join(", ")}\n\n• “Add Another” ይጫኑ ወይም “Skip” ይጫኑ።`
        : `${TEXT.findAskFieldsIntro.en}\n\nSelected: ${sessions[tgId].fields.join(", ")}\n\n• Click “Add Another” or “Skip.”`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(user.language === "am" ? "Add Another" : "Add Another", "FIND_FIELDS_CONTINUE"),
          Markup.button.callback(user.language === "am" ? "Skip" : "Skip", "FIND_FIELDS_SKIP")
        ]
      ])
    );
  });

  bot.action("FIND_FIELDS_CONTINUE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    user.onboardingStep = "findingFields";
    await user.save();
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields || []);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) keyboard.push(navBtns);
    return ctx.reply(
      user.language === "am" ? TEXT.findAskFieldsIntro.am : TEXT.findAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  bot.action("FIND_FIELDS_SKIP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    if (!sessions[tgId].fields || sessions[tgId].fields.length === 0) {
      return ctx.reply(user.language === "am"
        ? TEXT.findFieldsError.am
        : TEXT.findFieldsError.en
      );
    }
    user.onboardingStep = "findingMinFee";
    await user.save();
    return ctx.reply(
      user.language === "am" ? TEXT.findAskMinFee.am : TEXT.findAskMinFee.en
    );
  });

  // ───────────── Shared Post and Find Helpers ─────────────

  // Helper: Fetch matching tasks up to 2 minutes
  async function doFindTasks(ctx, user) {
    const tgId = ctx.from.id;
    const skill = sessions[tgId].filterSkillLevel;
    const fields = sessions[tgId].fields;
    const minFee = sessions[tgId].filterMinFee;
    const channelId = "-1002254896955";

    // Simulating task storage by searching User.postingTask for isPosted and not expired
    const now = dayjs();
    const matches = await User.find({
      "postingTask.isPosted": true,
      "postingTask.expiryTimestamp": { $gt: now.toDate() },
      "postingTask.skillLevel": skill,
      "postingTask.paymentFee": { $gte: minFee }
    }).lean();

    // Filter by fields intersection
    const filtered = matches.filter((u) => {
      return u.postingTask.fields.some((f) => fields.includes(f));
    });

    const previews = [];
    for (let i = 0; i < Math.min(filtered.length, 15); i++) {
      const t = filtered[i].postingTask;
      const line = `🔹 ${t.title} | Fee: ${t.paymentFee} birr | Expires: ${dayjs(t.expiryTimestamp).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D")}`;
      previews.push(line);
    }

    if (filtered.length === 0) {
      user.onboardingStep = "completed";
      await user.save();
      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am" ? TEXT.postPreviewMissing.am : TEXT.postPreviewMissing.en
      );
    }

    const replyText = previews.join("\n");
    user.onboardingStep = "completed";
    await user.save();
    rateLimitFlags[tgId] = false;
    return ctx.reply(replyText);
  }

  // ───────────── Launch Bot ─────────────
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });

  // Graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
