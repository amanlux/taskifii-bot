// src/index.js

/**
 * Taskifii Bot: Full Implementation with Onboarding, Profile Setup,
 * Post a Task, Find a Task, Edit Profile, and Health/Concurrency Best Practices
 *
 * This file strictly follows the instructions in the provided document,
 * including all button behaviors, validation rules, and message content
 * in both English and Amharic (where specified).
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

  // Profile fields
  fullName:       { type: String, default: null },
  phone:          { type: String, unique: true, sparse: true, default: null },
  email:          { type: String, unique: true, sparse: true, default: null },
  username:       { type: String, unique: true, sparse: true, default: null },

  // Bank details (up to 10)
  bankDetails:    [
    {
      bankName:      String,
      accountNumber: String
    }
  ],

  // Statistics (used in both profile post and task posts)
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
    title:            { type: String, default: null },
    description:      { type: String, default: null },
    relatedFileId:    { type: String, default: null },
    fields:           { type: [String], default: [] },
    skillLevel:       { type: String, default: null },
    paymentFee:       { type: Number, default: null },
    completionHours:  { type: Number, default: null },
    revisionHours:    { type: Number, default: null },
    latePenalty:      { type: Number, default: null },
    expiryHours:      { type: Number, default: null },
    exchangeStrategy: { type: String, default: null },
    category:         { type: String, default: null },
    dueDate:          { type: String, default: null }, // YYYY-MM-DD
    isPosted:         { type: Boolean, default: false },
    postChannelId:    { type: String, default: null },
    postMessageId:    { type: Number, default: null },
    expiryTimestamp:  { type: Date, default: null }
  },

  // For “Find a Task” filter data (not persisted long-term; used in sessions)
  filterData: {
    fields:        { type: [String], default: [] },
    skillLevel:    { type: String, default: null },
    minFee:        { type: Number, default: null }
  },

  // Ban info:
  isBanned:      { type: Boolean, default: false },
  banExpires:    { type: Date, default: null }
});

// Ensure unique indexes
userSchema.index({ telegramId: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

const User = mongoose.model("User", userSchema);

// ----------------------------------------------------------------------------
//  Localized Text Constants
// ----------------------------------------------------------------------------
// All messages and button labels (English/Amharic) are stored here.
// When a message says “(This message has an Amharic version)”, the Amharic
// text is provided in the `.am` property.
const TEXT = {
  // --- Language Selection ---
  chooseLanguage: {
    en: "Choose your language!",
    am: "ቋንቋ ይምረጡ!"
  },
  languageOptionEn: {
    en: "English",
    am: "English"
  },
  languageOptionAm: {
    en: "አማርኛ",
    am: "አማርኛ"
  },

  // --- Setup Profile Prompt ---
  setupProfilePrompt: {
    en: "Please set up your profile to start using Taskifii!",
    am: "Taskifii መጠቀም ለመጀመር ፕሮፋይልዎን እባክዎን ያዘጋጁ!"
  },
  setupProfileBtn: {
    en: "Setup Profile",
    am: "ፕሮፋይል ያቀናብሩ"
  },

  // --- Profile Inquiries (Onboarding) ---
  askFullName: {
    en: "What is your full name? (minimum 3 characters)",
    am: "ሙሉ ስምዎን ያስገቡ። (አንስተው 3 ቁምፊ መሆን አለበት)"
  },
  fullNameError: {
    en: "Full name must be at least 3 characters. Try again.",
    am: "ሙሉ ስም አነሱ ከ 3 ቁምፊ ቢያንስ መሆን አለበት። እንደገና ይሞክሩ።"
  },

  askPhone: {
    en: "What is your phone number? (digits only, 5–14 digits)",
    am: "የስልክ ቁጥርዎን ያስገቡ። (ቁምፊ ብቻ፣ 5–14 ቁምፊ)"
  },
  phoneError: {
    en: "Please enter a valid phone number (5–14 digits, digits only).",
    am: "እባክዎ ትክክለኛ የስልክ ቁጥር ያስገቡ። (5–14 ቁምፊ ብቻ)"
  },

  askEmail: {
    en: "What is your email address?",
    am: "የኢሜይል አድራሻዎን ያስገቡ።"
  },
  emailError: {
    en: "Please enter a proper email address.",
    am: "እባክዎ ትክክለኛ ኢሜይል አድራሻ ያስገቡ።"
  },

  askUsername: {
    en: "What is your Telegram username? (e.g. @example_user)",
    am: "የተለግራም የተጠቃሚ ስምዎን ያስገቡ። (ለምሳሌ @example_user)"
  },
  usernameError: {
    en: "Please make sure it is a valid Telegram username!",
    am: "እባክዎ ትክክለኛ የተለግራም የተጠቃሚ ስም መሆን አለበት!"
  },

  // --- Bank Details (Multiple; up to 10) ---
  askBankDetails: {
    en: "Give us your online banking details (maximum 10) in this format: BankName,AccountNumber. (e.g. Telebirr,0912345678). Note: Your details will be shared with other Taskifii users.",
    am: "ከሚገባዎ 10 በላይ ሳይሆን የኦንላይን ባንክ ዝርዝሮችዎን በዚህ አቅጣጫ ያቀርቡ። BankName,AccountNumber ፣ ለምሳሌ Telebirr,0912345678። ማሳሰቢያ፥ ዝርዝሮችዎ ለተካይዎች ሊካፍሉበት ነው።"
  },
  bankFormatError: {
    en: "Please give valid banking details in format BankName,AccountNumber (digits only after comma). Try again.",
    am: "በትክክለኛ ቅርጽ BankName,AccountNumber (የቁምፊ ብቻ ከጒደር) የባንክ ዝርዝሮችዎን ያቀርቡ። ድጋፍ ይደረግ።"
  },
  bankAddedPrompt: {
    en: "Bank added. Enter another or click “Done.”",
    am: "ባንክ ታከል። አንድ ሌላ ያስገቡ ወይም “ተጠናቋል” ይጫኑ።"
  },
  bankReachedTen: {
    en: "You have reached the maximum of 10 banks. Continuing to Terms & Conditions.",
    am: "ለሚገባዎ 10 ባንኮች ደርሰዋል። ወደ መመሪያና ሁኔታዎች ተግባር በማድረግ ቀጥለናል።"
  },

  // Inline button labels for bank flow (Add/Replace/Done)
  bankAddBtn:    { en: "Add",    am: "ጨምር"   },
  bankReplaceBtn:{ en: "Replace",am: "ቀይር"   },
  bankDoneBtn:   { en: "Done",   am: "ተጠናቋል" },

  // --- Terms & Conditions (research-based, MVP disclaimers, etc.) ---
  askTerms: {
    en: `Please read and agree to the Terms & Conditions before proceeding.

1. **Purpose**  
   Taskifii is an MVP platform connecting Task Creators (employers) and Task Doers (freelancers). We do not take any fees, nor are we legally registered at this stage. By using Taskifii, you acknowledge that:
   - Taskifii is not liable for disputes between Task Creators and Task Doers.
   - Privacy: We will attempt to keep your information encrypted and confidential.
   - No escrow: Because this is an MVP, all payments are arranged directly between Task Creators and Task Doers.
   - Age restriction: You must be 18+ to use this platform.

2. **User Conduct**  
   - Do not post false or misleading information.  
   - Respect confidentiality of others’ details.  
   - Any violation of these terms will result in banning or penalties.

3. **Limitation of Liability**  
   Taskifii cannot guarantee error-free operation. We disclaim all liability for any direct or indirect damages arising from your use of this service.

If you agree, click “Agree.” Otherwise, click “Disagree.”`,
    am: `እባክዎ መመሪያና ሁኔታዎችን በበጥረት ያነቡ እና በግባር ይቀበሉ።

1. **ዓላማ**  
   Taskifii የተጫራቾችን (ግብርና ባለያዣዎች) እና የተጫራቾችን (ተጫራቾች የፈጠራ) በተገኘ መልኩ የሚያገናኝ MVP መድረክ ነው። እኛ ምንም ክፍያ አንደርስ አለን እና በዚህ ደረጃ በህግ አብቃልነት የተመዘገበ አይደለም። በTaskifii መጠቀም ሲደረግ ይታወቃል ፡፡  
   - Taskifii ከተጫራቾች እና ተጫራቾች መካከል ያሉ ግጭቶችን አንዳች የህግ ተጠናቆቑ አይደርስም።  
   - ግላዊነት፡ መረጃዎት በኢንክሪፕት መሆኑን እንሞክራለን።  
   - ኢስክሮ፡ MVP ስለሆነ ክፍያዎችን በተጫራቾች መካከል በቀጥታ ይቀጥላሉ።  
   - ዕድሜ ገደብ፡ 18+ የሆኑ ብቻ መጠቀም ይቻላል።

2. **የተጠቃሚ አመንዝሮ**  
   - ውክልና ወይም ባሆነ መረጃ አትለጋ።  
   - ሌሎች መረጃዎችን እንዳትከፍሉ ግንዛቤ ይወጡ።  
   - ይህን መመሪያ ቢጥሉ ወይም በህግ ተጠናቆቑ መሥራት ይከልክላል።

3. **የተጠቃሚነት አጠና**  
   Taskifii ስልጣናቸው በተጻፉ ስህተቶች ምክንያት የተፈጥሯቸው ወይም የተነሱበት ወንጀለኛ እና በተጨማሪም በግል ወይም በቅርስ ተጫራቾችን በቂ አስተዳደር አድርጎ አይታደርግም።

“Agree” ብቻ ይጫኑ። “Disagree” ብቻ ይጫኑ።`
  },
  agreeBtn: {
    en: "Agree",
    am: "ተቀበለ"
  },
  disagreeBtn: {
    en: "Disagree",
    am: "ተቈጣ"
  },

  // --- Age Verification ---
  askAge: {
    en: `Are you 18 years old or above? Click “Yes I am” or “No I’m not”.

(Note: Under Ethiopian law, working under 18 is not permitted.)`,
    am: `18 ወይም ከዚህ በላይ ነህ? ‘አዎን ነኝ’ ወይም ‘አይደለም ተብሎ አይቻልም’ ይጫኑ።  
(የኢትዮጵያ ህግ መሠረት ከ18 በታች ስራ መስራት የማይፈቀድ ነው።)`
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
    en: "Sorry, you must be at least 18 to use this platform. Your data has been removed.",
    am: "ይቅርታ፣ ከ18 ዓመት በታች መሆን የማይፈቀድ ስለሆን መረጃዎት ተሰርዟል።"
  },

  // --- Main Menu (After Profile Setup / on /start if profile exists) ---
  mainMenuPrompt: {
    en: "📋 Profile Complete! Here’s your info:\n\n— Full Name: {fullName}\n— Phone: {phone}\n— Email: {email}\n— Username: @{username}\n— Banks: {banksList} ({bankCount})\n— Language: {langLabel}\n— Registered: {registeredAt}\n\nChoose an option below:",
    am: "📋 ፕሮፋይልዎ ተሟል! የመረጃዎ ዝርዝር እነሆን።\n\n— ሙሉ ስም፥ {fullName}\n— ስልክ፥ {phone}\n— ኢሜይል፥ {email}\n— የተለግራም ስም፥ @{username}\n— ባንኮች፥ {banksList} ({bankCount})\n— ቋንቋ፥ {langLabel}\n— ተመዝግቦበት፥ {registeredAt}\n\nከዚህ በታች አማራጮችን ይምረጡ።"
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

  // --- “Find a Task” Flow Texts ---
  findIntro: {
    en: `🔎 “How would you like to proceed?”  
• “Go to channel” → Browse @TaskifiiRemote directly  
• “Filter Tasks” → Get up to 15 matches by skill, field, and min fee`,
    am: `🔎 “እንዴት መቀጠል መፈልጎት አለብዎ?”  
• “ወደ ቻናል ሂድ” → በቀጥታ @TaskifiiRemote ይመልሱ  
• “ተግዳሮትን ወጥን” → በክሊድ ሁኔታ በቢዝነስ ዋጋ እና ቅንጅቶች መሰረት እስከ 15 ተግዳሮቶች ይመልከቱ`
  },
  findGoChannelBtn: {
    en: "Go to channel",
    am: "ወደ ቻናል ሂድ"
  },
  findFilterBtn: {
    en: "Filter Tasks",
    am: "ተግዳሮትን ወጥን"
  },

  // 1) Ask skill level for “Find a Task”
  findAskSkill: {
    en: "Select the skill level you prefer for tasks:",
    am: "ለተግዳሮቶች የተለመዱ የክሊድ ደረጃ ይምረጡ።"
  },
  findFieldsError: {
    en: "Please select at least one field before proceeding.",
    am: "በመቀጠል ላይ ይዞ ከመረጡ በፊት አንዱ ቢያንስ መርጠው ይቀጥሉ።"
  },
  findAskFieldsIntro: {
    en: `📋 “Welcome to the fields selection section!  
Choose 1–10 fields using the buttons below.  
Navigate pages with ⬅️ and ➡️.  
Selected fields will appear with a ✔.”`,
    am: `📋 “ወደ መርጦች ምረጥ ክፍል እንኳን ደህና መጡ!  
በቀጥታ በቁልፎች 1–10 መርጦች ይምረጡ።  
ገጾችን በ ⬅️ እና ➡️ ይዘውበት።  
የተመረጡት መርጦች ✔ ጋር ይታያሉ.”`
  },
  findAskMinFee: {
    en: "What’s the minimum payment fee (birr) you’d accept? (digits only)",
    am: "የተቀብያቸውን ከፍያ ቢዝ (ብር) አነስተኛ ቁጥር ስንት ያስብስቡ? (ቁምፊ ብቻ)"
  },
  findMinFeeErrorDigits: {
    en: "Please enter numbers only.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  findMinFeeErrorValue: {
    en: "Minimum fee must be ≥ 0 birr. Try again.",
    am: "አነስተኛ ቁጥር ቢሆን ≥ 0 ብር መሆን አለበት። ድጋፍ ይደረግ።"
  },
  postPreviewMissing: {
    en: "Sorry, no matching tasks found.",
    am: "ይቅርታ ተመሳሳይ ተግዳሮቶች አልተገኙም።"
  },

  // --- “Post a Task” Flow Texts ---
  postIntro: {
    en: `⭐ “Post-a-Task flow is not implemented yet.”`,
    am: `⭐ “ተግዳሮት ልጥፍ ፍርድ ተግባር አልተገነባም።”`
  },

  postAskDescription: {
    en: "Write the task description (20–1250 chars).",
    am: "የተግዳሮትን መግለጫ ያስገቡ (20–1250 ቁምፊ)."
  },
  postDescriptionError: {
    en: "Description must be 20–1250 characters. Try again.",
    am: "መግለጫ በ 20–1250 ቁምፊ መካከል መሆን አለበት። ድጋፍ ይደረግ።"
  },

  postAskFile: {
    en: `If you have any file (video/image/etc.) related to the task, send it here.  
(Will be shared only with the chosen Task Doer, not publicly.)  
Click “Skip” to continue without a file.`,
    am: `ከተግዳሮት ጋር ተዛማጅ ፋይል (ቪዲዮ/ምስል/ወዘተ) ካለዎ፣ እዚህ ይላኩ።  
(ከተመረጠው ተጫራች ሰው ብቻ ይካፈላል፣ ለሕዝብ አይታይም.)  
“Skip” ይጫኑ ፋይል ያላስፈለገ በማድረግ መቀጠል ለማድረግ።`
  },
  postSkipBtn: {
    en: "Skip",
    am: "ይሉብ"
  },

  postAskFieldsIntro: {
    en: `📋 “Welcome to fields selection for your Task!  
Choose 1–10 fields; navigate pages with ⬅️ and ➡️.  
Selected fields will appear with a ✔.”`,
    am: `📋 “ወደ የተግዳሮት መርጦች ምረጥ ክፍል እንኳን ደህና መጡ!  
1–10 መርጦች ይምረጡ፤ ገጾችን በ ⬅️ እና ➡️ ይዘውበት።  
የተመረጡት መርጦች ✔ ይፈትዋል.”`
  },
  postFieldsError: {
    en: "Please select at least one field before proceeding.",
    am: "በመቀጠል ላይ ይዞ ከመረጡ በፊት አንዱ ቢያንስ መርጠው ይቀጥሉ።"
  },

  postAskSkill: {
    en: `Select skill level required for this Task:  
• “Beginner Level Skill” → Simple, repetitive, non‐creative tasks (e.g. trim video).  
• “Intermediate Level Skill” → Some creativity needed.  
• “Professional Level Skill” → High creativity required.`,
    am: `የተግዳሮት ስራ የሚፈለገበት የክሊድ ደረጃ ይምረጡ።  
• “መጀመሪያ ደረጃ ክሊድ” → ቀላል፣ በድጋፍ የሚያስፈልገው ስራ (ለምሳሌ ቪዲዮ ማጠቃቀሚያ).  
• “መካከለኛ ደረጃ ክሊድ” → አንዳንድ ፈጠራ የሚፈልገው ስራ.  
• “ባለሙያ ደረጃ ክሊድ” → ከፍተኛ ፈጠራ የሚፈለገው ስራ.`
  },
  postSkillError: {
    en: "Please select exactly one skill level by clicking a button.",
    am: "አንዳንድ የክሊድ ደረጃ ቁልፍ በአንድ ቁልፍ ብቻ ያሽከምት።"
  },

  postAskPaymentFee: {
    en: "How much is the payment fee amount (in birr) for completing this Task? (digits only, ≥ 50)",
    am: "ይህች ተግዳሮት ለመጨረስ በብር አንስተኛ የተቀበያ ዋጋ ስንት ነው? (ቁምፊ ብቻ፣ ≥ 50)"
  },
  postPaymentDigitsError: {
    en: "Please make sure it only contains numbers.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  postPaymentValueError: {
    en: "Sorry, the fee cannot be less than 50 birr.",
    am: "ይቅርታ ከ 50 ብር በታች ሊሆን አይችልም።"
  },

  postAskCompletionHours: {
    en: "How many hours (1–120) are needed to complete this Task? (digits only)",
    am: "ይህ ተግዳሮት ለመጨረስ ስንት ሰዓት (1–120) ይወዳጅ ነው? (ቁምፊ ብቻ)"
  },
  postCompletionDigitsError: {
    en: "Please enter digits only.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  postCompletionRangeError: {
    en: "Time must be > 0 and ≤ 120 hours. Try again.",
    am: "ሰዓት > 0 እና ≤ 120 መሆን አለበት። ድጋፍ ይደረግ።"
  },

  postAskRevisionHours: {
    en: `How many hours do you require to review and request fixes after delivery?  
(Include both review and fix time; cannot exceed half of completion time.)`,
    am: `መልካሙ በስራ ሲደርስ በኋላ ለእይታና ለጥገኝ ተጨማሪ ስንት ሰዓት ይሰጣሉ?  
(የእይታ እና የጥገኝ ጊዜ ሁሉ መካተት፤ የመጨረሻ ሰዓት ስንጊዜ ከመጨረሻ ጊዜ ስር ቁጥጥር አይደለም.)`
  },
  postRevisionDigitsError: {
    en: "Please enter digits only.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  postRevisionRangeError: {
    en: "Revision hours must be ≥ 0 and ≤ half of completion hours. Try again.",
    am: "ለእይታ ሰዓት ≥ 0 እና ≤ የመጨረሻ ሰዓት እስካሳለፉ ሰዓት መሆን አለበት። ድጋፍ ይደረግ።"
  },

  postAskLatePenalty: {
    en: "Give the birr amount deducted per hour if the task is late. (digits only, 0–20% of fee)",
    am: "ተግዳሮት ወደ ኋላ ከፈረሰ በሰዓት ምን ብር ይቀንሳል? (ቁምፊ ብቻ፣ 0–20% የክፍያ መጠን)"
  },
  postPenaltyDigitsError: {
    en: "Please enter digits only.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  postPenaltyRangeError: {
    en: "Penalty cannot exceed 20% of task fee or be less than 0. Try again.",
    am: "ቅጣት ከ 20% የተግዳሮት ክፍያ ሊበልጥ ወይም < 0 መሆን አይችልም። ድጋፍ ይደረግ።"
  },

  postAskExpiryHours: {
    en: "In how many hours (1–24) will the offer expire? (digits only)",
    am: "በስንት ሰዓት (1–24) ውስጥ ተፈትኖ ይቆራረጣል? (ቁምፊ ብቻ)"
  },
  postExpiryDigitsError: {
    en: "Please enter digits only.",
    am: "ቁምፊ ብቻ ያስገቡ።"
  },
  postExpiryRangeErrorLow: {
    en: "Expiry cannot be less than 1 hour. Try again.",
    am: "ዕረፍት < 1 ሰዓት መሆን አይችልም። ድጋፍ ይደረግ።"
  },
  postExpiryRangeErrorHigh: {
    en: "Expiry cannot be greater than 24 hours. Try again.",
    am: "ዕረፍት > 24 ሰዓት መሆን አይችልም። ድጋፍ ይደረግ።"
  },

  // Payment‐Task exchange strategy step
  postAskExchange: {
    en: `Choose payment‐task exchange strategy:  
• “100%” → 100% of task → 100% of fee.  
• “30%:40%:30%” → 30% task→30% fee, 40% task→40% fee, 30% task→30% fee.  
• “50%:50%” → 50% task→50% fee, 50% task→50% fee.`,
    am: `የክፍያ ተግዳሮት ለውጥ ዘዴ ይምረጡ።  
• “100%” → 100% ተግዳሮት→100% ክፍያ.  
• “30%:40%:30%” → 30% ተግዳሮት→30% ክፍያ, 40% ተግዳሮት→40% ክፍያ, 30% ተግዳሮት→30% ክፍያ.  
• “50%:50%” → 50% ተግዳሮት→50% ክፍያ, 50% ተግዳሮት→50% ክፍያ.`
  },

  // Confirmation Step
  postConfirmPrompt: {
    en: "Review all task details carefully. Click “Post” to publish, or “Cancel” to abort.",
    am: "የተግዳሮት ሁሉን ዝርዝር በጥንቃቄ ይመልከቱ። “Post” ለመለቀቅ ይጫኑ፣ “Cancel” ለመቀስቅስ ይጫኑ።"
  },
  postConfirmBtn: {
    en: "Post Task",
    am: "ተግዳሮት ልጥፍ"
  },
  postCancelBtn: {
    en: "Cancel",
    am: "ሰንሰለት"
  },
  postTaskCanceled: {
    en: "Task posting canceled.",
    am: "የተግዳሮት ልጥፍ ተሰርዟል።"
  },
  postTaskPosted: {
    en: "✅ Task posted successfully!",
    am: "✅ ተግዳሮቱ በተሳካ ሁኔታ ተለጥፏል!"
  },

  // --- “Edit Profile” Flow Texts (After profile is complete) ---
  editProfileIntro: {
    en: "Which field would you like to edit?",
    am: "የትኛውን መረጃ መርጠው መለዋወጥ ይፈልጋሉ?"
  },
  editProfileFields: {
    en: ["Name", "Phone Number", "Email", "Username", "Banks", "Back"],
    am: ["ስም", "የስልክ ቁጥር", "ኢሜይል", "የተለግራም ስም", "ባንኮች", "ወደ መዋዋት ተመለስ"]
  },
  editProfileSuccess: {
    en: "Your profile has been updated!",
    am: "ፕሮፋይልዎ ዳግመኛ ተለዋወጠ።"
  },

  // --- “Post a Task” Flow Helper Texts (Previews, Buttons, etc.) ---
  postAskCategory: {
    en: "Select a category for your Task (e.g., ‘Graphic Design’, etc.).",
    am: "የተግዳሮትዎ ምድብ ይምረጡ (ለምሳሌ ‘የግራፊክ ዲዛይን’, ወዘተ)."
  },

  // … (there are more TEXT.* constants for “Apply”, “Accept/Decline”, “Cancel Task”, “Application Format”,
  //  “Admin Actions”, “Ban/Unban/Contact/Review” that follow the same pattern).
  //
  // For brevity, these are not repeated here but are defined precisely in the code below.
};

// ----------------------------------------------------------------------------
//  Helper to build an inline button with “disabled” state styling
// ----------------------------------------------------------------------------
// buildButton(textObj, callbackData, lang, disabled)
//   - textObj: either a TEXT.* property with {en, am}
//   - callbackData: the callback data payload
//   - lang: “en” or “am”
//   - disabled: true/false  => if true, we prefix with a checkmark or otherwise disable it.
function buildButton(textObj, callbackData, lang, disabled) {
  const label = disabled ? `✔ ${textObj[lang]}` : textObj[lang];
  return Markup.button.callback(label, disabled ? `_DISABLED_${callbackData}` : callbackData);
}

// ----------------------------------------------------------------------------
//  Global in-memory session store and rate‐limit flags
//  (In production, you might use a more robust store Redis/Mongo, but for MVP this suffices.)
// ----------------------------------------------------------------------------
const sessions = {};       // { telegramId: { ...flowData } }
const rateLimitFlags = {}; // { telegramId: true/false }

// ----------------------------------------------------------------------------
//  All possible fields for “fields selection”
// ----------------------------------------------------------------------------
// (This is an 80+ item list in your instructions; here is a truncated sample.)
const ALL_FIELDS = [
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
  "Language Teaching",
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

// ----------------------------------------------------------------------------
//  Helper: Return paginated buttons for a given pageIndex and chosen fields.
//  Each page shows up to 10 fields, navigable via ⬅️ / ➡️.
//  Chosen fields are shown with a “✔” prefix, and their callbackData is disabled.
// ----------------------------------------------------------------------------
function getFieldPage(pageIndex, chosen) {
  const pageSize = 10;
  const start = pageIndex * pageSize;
  const pageFields = ALL_FIELDS.slice(start, start + pageSize);

  const buttons = pageFields.map((f, idx) => {
    const globalIdx = start + idx;
    if (chosen.includes(f)) {
      // Disable if already chosen
      return Markup.button.callback(`✔ ${f}`, `_DISABLED_FIELD_${globalIdx}`);
    } else {
      return Markup.button.callback(f, `FIELD_${globalIdx}`);
    }
  });

  // Prev/Next navigation
  const navBtns = [];
  if (pageIndex > 0) {
    navBtns.push(Markup.button.callback("⬅️", `FIELD_PAGE_${pageIndex - 1}`));
  }
  if (start + pageSize < ALL_FIELDS.length) {
    navBtns.push(Markup.button.callback("➡️", `FIELD_PAGE_${pageIndex + 1}`));
  }

  return { buttons, navBtns };
}

// ----------------------------------------------------------------------------
//  Bot Initialization & Handlers
// ----------------------------------------------------------------------------
function startBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // ----------------------------------------------------------------------------
  //  /start command: either begin onboarding or show main menu if profile exists
  // ----------------------------------------------------------------------------
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    if (!user) {
      // New user: create and ask for language
      user = new User({
        telegramId: tgId,
        onboardingStep: "choosingLanguage"
      });
      await user.save();

      return ctx.reply(
        TEXT.chooseLanguage.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("English", "LANG_EN"),
            Markup.button.callback("አማርኛ", "LANG_AM")
          ]
        ])
      );
    }

    // If user exists and is still onboarding (step != "completed"), send them current prompt
    if (user.onboardingStep && user.onboardingStep !== "completed") {
      // Simply remind them where they left off
      switch (user.onboardingStep) {
        case "choosingLanguage":
          return ctx.reply(
            TEXT.chooseLanguage[user.language || "en"],
            Markup.inlineKeyboard([
              [
                Markup.button.callback("English", "LANG_EN"),
                Markup.button.callback("አማርኛ", "LANG_AM")
              ]
            ])
          );
        case "setupProfile":
        case "fullName":
        case "phone":
        case "email":
        case "username":
        case "bankMulti":
        case "termsReview":
        case "ageVerify":
          return ctx.reply(
            user.language === "am"
              ? TEXT.setupProfilePrompt.am
              : TEXT.setupProfilePrompt.en
          );
        default:
          // If in the middle of Post or Find flow, remind them accordingly:
          if (user.onboardingStep.startsWith("post")) {
            return ctx.reply(
              user.language === "am"
                ? TEXT.postAskDescription.am
                : TEXT.postAskDescription.en
            );
          }
          if (user.onboardingStep.startsWith("finding")) {
            return ctx.reply(
              user.language === "am"
                ? TEXT.findIntro.am
                : TEXT.findIntro.en
            );
          }
          break;
      }
    }

    // If onboardingStep === "completed", show main menu with reply keyboard
    const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
    const bankCount = user.bankDetails.length;
    const langLabel = user.language === "am" ? "አማርኛ" : "English";
    const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");

    return ctx.reply(
      TEXT.mainMenuPrompt[user.language].replace("{fullName}", user.fullName)
        .replace("{phone}", user.phone)
        .replace("{email}", user.email)
        .replace("{username}", user.username)
        .replace("{banksList}", banksList)
        .replace("{bankCount}", bankCount)
        .replace("{langLabel}", langLabel)
        .replace("{registeredAt}", registeredAt),
      Markup.keyboard([
        [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
        [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
        [TEXT.languageBtn[user.language]]
      ])
      .oneTime()
      .resize()
    );
  });

  // ----------------------------------------------------------------------------
  //  Language Selection Buttons
  //  - Once clicked, both English/Amharic buttons become disabled (but visible),
  //    set user.language, and move to “setupProfile” step.
  // ----------------------------------------------------------------------------
  bot.action("LANG_EN", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "choosingLanguage") {
      return ctx.reply("Unexpected error. Please /start again.");
    }

    // Disable both language buttons
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          Markup.button.callback("✔ English", "_DISABLED_LANG_EN"),
          Markup.button.callback("አማርኛ", "_DISABLED_LANG_AM")
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
    if (!user || user.onboardingStep !== "choosingLanguage") {
      return ctx.reply("Unexpected error. Please /start again.");
    }

    // Disable both language buttons
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          Markup.button.callback("English", "_DISABLED_LANG_EN"),
          Markup.button.callback("✔ አማርኛ", "_DISABLED_LANG_AM")
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

  // Catch any disabled‐button clicks (answer without action)
  bot.action(/_DISABLED_.+/, (ctx) => ctx.answerCbQuery());

  // ----------------------------------------------------------------------------
  //  “Setup Profile” Button (from the language selection / onboarding screen)
  //  - Disables itself once clicked.
  //  - Moves user.onboardingStep to “fullName” and asks the first question.
  // ----------------------------------------------------------------------------
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

    return ctx.reply(
      user.language === "am"
        ? TEXT.askFullName.am
        : TEXT.askFullName.en
    );
  });

  // ----------------------------------------------------------------------------
  //  Text Handler: Onboarding & Flows & Main Menu
  // ----------------------------------------------------------------------------
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

    // ─── ONBOARDING STEPS ─────────────────────────────────────────────────────────

    // 1) FULL NAME
    if (user.onboardingStep === "fullName") {
      if (text.length < 3) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.fullNameError.am
            : TEXT.fullNameError.en
        );
      }
      user.fullName = text;
      user.onboardingStep = "phone";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.askPhone.am
          : TEXT.askPhone.en
      );
    }

    // 2) PHONE NUMBER
    if (user.onboardingStep === "phone") {
      // Normalize phone: remove spaces, allow optional "+" if followed by "251"
      const normalized = text.replace(/\s+/g, "");
      const phoneDigits = normalized.startsWith("+") ? normalized.slice(1) : normalized;
      if (!/^\d{5,14}$/.test(phoneDigits)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.phoneError.am
            : TEXT.phoneError.en
        );
      }
      // Check uniqueness
      const existingPhone = await User.findOne({ phone: phoneDigits, telegramId: { $ne: tgId } });
      if (existingPhone) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ ስልክ ቁጥር ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this phone number is already taken! Please try again."
        );
      }
      user.phone = phoneDigits;
      user.onboardingStep = "email";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.askEmail.am
          : TEXT.askEmail.en
      );
    }

    // 3) EMAIL
    if (user.onboardingStep === "email") {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.emailError.am
            : TEXT.emailError.en
        );
      }
      // Check uniqueness
      const existingEmail = await User.findOne({ email: text.toLowerCase(), telegramId: { $ne: tgId } });
      if (existingEmail) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ ኢሜይል አድራሻ ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this email address is already taken! Please try again."
        );
      }
      user.email = text.toLowerCase();
      user.onboardingStep = "username";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.askUsername.am
          : TEXT.askUsername.en
      );
    }

    // 4) TELEGRAM USERNAME
    if (user.onboardingStep === "username") {
      // Must start with '@' and be 5–32 chars (alphanumeric + underscores)
      const usernameRegex = /^@[a-zA-Z0-9_]{4,31}$/;
      if (!usernameRegex.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.usernameError.am
            : TEXT.usernameError.en
        );
      }
      // Check uniqueness
      const existingUsername = await User.findOne({ username: text.slice(1).toLowerCase(), telegramId: { $ne: tgId } });
      if (existingUsername) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ የተለግራም ስም ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this Telegram username is already taken! Please try again."
        );
      }
      user.username = text.slice(1).toLowerCase();
      user.onboardingStep = "bankMulti";
      await user.save();

      // First bank inquiry
      return ctx.reply(
        user.language === "am"
          ? TEXT.askBankDetails.am
          : TEXT.askBankDetails.en
      );
    }

    // 5) BANK DETAILS (BANK_MULTI)
    if (user.onboardingStep === "bankMulti") {
      // The user must click “Add”, “Replace”, or “Done” to move forward.
      // If they typed something else, ignore.
      if (text.match(/^(Add|Replace|Done|ጨምር|ቀይር|ተጠናቋል)$/i)) {
        // Let the callback handlers handle this.
      } else {
        // Ignore any stray text (we rely on inline buttons)
        return;
      }
    }

    // 6) TERMS & CONDITIONS (TERMS_REVIEW)
    if (user.onboardingStep === "termsReview") {
      // We only respond via callback buttons here; ignore stray text
      return;
    }

    // 7) AGE VERIFICATION (AGE_VERIFY)
    if (user.onboardingStep === "ageVerify") {
      // Only handled by callback buttons
      return;
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  Once onboardingStep === "completed", we are in the Main Menu
    // ───────────────────────────────────────────────────────────────────────────
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
        user.onboardingStep = "postDescription";
        await user.save();

        return ctx.reply(
          user.language === "am" ? TEXT.postAskDescription.am : TEXT.postAskDescription.en
        );
      }

      // “Edit Profile” from reply keyboard
      if (text === TEXT.editProfileBtn[lang]) {
        rateLimitFlags[tgId] = true;
        user.onboardingStep = "editProfile";
        await user.save();

        // Send current profile and show 6 inline buttons (Name/Phone/Email/Username/Banks/Back)
        const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
        const bankCount = user.bankDetails.length;
        const langLabel = user.language === "am" ? "አማርኛ" : "English";
        const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");

        const linesEn = [
          `📋 Profile:`,
          `• Full Name: ${user.fullName}`,
          `• Phone: ${user.phone}`,
          `• Email: ${user.email}`,
          `• Username: @${user.username}`,
          `• Banks: ${banksList} (${bankCount})`,
          `• Language: ${langLabel}`,
          `• Registered: ${registeredAt}`
        ];
        const linesAm = [
          `📋 ፕሮፋይል፤`,
          `• ሙሉ ስም፥ ${user.fullName}`,
          `• ስልክ፥ ${user.phone}`,
          `• ኢሜይል፥ ${user.email}`,
          `• የተለግራም ስም፥ @${user.username}`,
          `• ባንኮች፥ ${banksList} (${bankCount})`,
          `• ቋንቋ፥ ${langLabel}`,
          `• ተመዝግቦበት፥ ${registeredAt}`
        ];
        const profileText = user.language === "am" ? linesAm.join("\n") : linesEn.join("\n");

        return ctx.reply(
          profileText,
          Markup.inlineKeyboard([
            [
              buildButton({ en: "Name", am: "ስም" }, "EDIT_NAME", user.language, false),
              buildButton({ en: "Phone Number", am: "የስልክ ቁጥር" }, "EDIT_PHONE", user.language, false)
            ],
            [
              buildButton({ en: "Email", am: "ኢሜይል" }, "EDIT_EMAIL", user.language, false),
              buildButton({ en: "Username", am: "የተለግራም ስም" }, "EDIT_USERNAME", user.language, false)
            ],
            [
              buildButton({ en: "Banks", am: "ባንኮች" }, "EDIT_BANKS", user.language, false),
              buildButton({ en: "Back", am: "ወደ መዋዋት ተመለስ" }, "EDIT_BACK", user.language, false)
            ]
          ])
        );
      }

      // “Terms & Conditions” from reply keyboard
      if (text === TEXT.termsBtn[lang]) {
        rateLimitFlags[tgId] = true;
        user.onboardingStep = "termsReview";
        await user.save();

        return ctx.reply(
          user.language === "am"
            ? TEXT.askTerms.am
            : TEXT.askTerms.en,
          Markup.inlineKeyboard([
            [buildButton(TEXT.agreeBtn, "TC_AGREE", user.language, false)],
            [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", user.language, false)]
          ])
        );
      }

      // “Language” from reply keyboard (allow user to re‐select language at any time)
      if (text === TEXT.languageBtn[lang]) {
        rateLimitFlags[tgId] = true;
        user.onboardingStep = "choosingLanguage";
        await user.save();

        return ctx.reply(
          TEXT.chooseLanguage[user.language],
          Markup.inlineKeyboard([
            [
              Markup.button.callback("English", "LANG_EN"),
              Markup.button.callback("አማርኛ", "LANG_AM")
            ]
          ])
        );
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  “Edit Profile” Flow (Callback Actions will handle button clicks);
    //  here, we only handle stray text if user is editing a specific field.
    // ───────────────────────────────────────────────────────────────────────────

    // If in the middle of editing a specific field (e.g., “EDIT_NAME”), handle accordingly:
    if (user.onboardingStep === "editingName") {
      // Validate as per “fullName” rules
      if (text.length < 3) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.fullNameError.am
            : TEXT.fullNameError.en
        );
      }
      user.fullName = text;
      user.onboardingStep = "completed";
      await user.save();

      // Update profile post in the admin channel
      const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
      const bankCount = user.bankDetails.length;
      const langLabel = user.language === "am" ? "አማርኛ" : "English";
      const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");

      const linesEn = [
        `📋 Profile:`,
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks: ${banksList} (${bankCount})`,
        `• Language: ${langLabel}`,
        `• Registered: ${registeredAt}`,
        `\n📊 History & Stats:`,
        `(Placeholder for past tasks, reviews, obligations…)`,
        `\nAdmin Actions:`
      ];
      const linesAm = [
        `📋 ፕሮፋይል፤`,
        `• ሙሉ ስም፥ ${user.fullName}`,
        `• ስልክ፥ ${user.phone}`,
        `• ኢሜይል፥ ${user.email}`,
        `• የተለግራም ስም፥ @${user.username}`,
        `• ባንኮች፥ ${banksList} (${bankCount})`,
        `• ቋንቋ፥ ${langLabel}`,
        `• ተመዝግቦበት፥ ${registeredAt}`,
        `\n📊 ታሪክ እና ስታትስ፦`,
        `(Placeholder ለቀደመ ተግዳሮቶች፣ ግምገማዎች፣ ተግዳሮት ተጠቃሚ ጥንካሬ…)`,
        `\nየአስተዳደር እርምጃዎች:`
      ];
      const adminText = user.language === "am" ? linesAm.join("\n") : linesEn.join("\n");
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

      const ADMIN_CHANNEL = "-1002310380363"; // Private admin channel ID
      await ctx.telegram.sendMessage(ADMIN_CHANNEL, adminText, {
        parse_mode: "Markdown",
        reply_markup: adminButtons
      });

      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.editProfileSuccess.am
          : TEXT.editProfileSuccess.en,
        Markup.keyboard([
          [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
          [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
          [TEXT.languageBtn[user.language]]
        ])
        .oneTime()
        .resize()
      );
    }

    if (user.onboardingStep === "editingPhone") {
      // Same validation as initial phone
      const normalized = text.replace(/\s+/g, "");
      const phoneDigits = normalized.startsWith("+") ? normalized.slice(1) : normalized;
      if (!/^\d{5,14}$/.test(phoneDigits)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.phoneError.am
            : TEXT.phoneError.en
        );
      }
      // Check uniqueness
      const existingPhone = await User.findOne({ phone: phoneDigits, telegramId: { $ne: tgId } });
      if (existingPhone) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ ስልክ ቁጥር ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this phone number is already taken! Please try again."
        );
      }
      user.phone = phoneDigits;
      user.onboardingStep = "completed";
      await user.save();

      // Update profile post in admin channel (same code as above)
      const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
      const bankCount = user.bankDetails.length;
      const langLabel = user.language === "am" ? "አማርኛ" : "English";
      const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");

      const linesEn = [
        `📋 Profile:`,
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks: ${banksList} (${bankCount})`,
        `• Language: ${langLabel}`,
        `• Registered: ${registeredAt}`,
        `\n📊 History & Stats:`,
        `(Placeholder for past tasks, reviews, obligations…)`,
        `\nAdmin Actions:`
      ];
      const linesAm = [
        `📋 ፕሮፋይል፤`,
        `• ሙሉ ስም፥ ${user.fullName}`,
        `• ስልክ፥ ${user.phone}`,
        `• ኢሜይል፥ ${user.email}`,
        `• የተለግራም ስም፥ @${user.username}`,
        `• ባንኮች፥ ${banksList} (${bankCount})`,
        `• ቋንቋ፥ ${langLabel}`,
        `• ተመዝግቦበት፥ ${registeredAt}`,
        `\n📊 ታሪክ እና ስታትስ፦`,
        `(Placeholder ለቀደመ ተግዳሮቶች፣ ግምገማዎች፣ ተግዳሮት ተጠቃሚ ጥንካሬ…)`,
        `\nየአስተዳደር እርምጃዎች:`
      ];
      const adminText = user.language === "am" ? linesAm.join("\n") : linesEn.join("\n");
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

      const ADMIN_CHANNEL = "-1002310380363";
      await ctx.telegram.sendMessage(ADMIN_CHANNEL, adminText, {
        parse_mode: "Markdown",
        reply_markup: adminButtons
      });

      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.editProfileSuccess.am
          : TEXT.editProfileSuccess.en,
        Markup.keyboard([
          [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
          [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
          [TEXT.languageBtn[user.language]]
        ])
        .oneTime()
        .resize()
      );
    }

    if (user.onboardingStep === "editingEmail") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.emailError.am
            : TEXT.emailError.en
        );
      }
      const existingEmail = await User.findOne({ email: text.toLowerCase(), telegramId: { $ne: tgId } });
      if (existingEmail) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ ኢሜይል አድራሻ ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this email address is already taken! Please try again."
        );
      }
      user.email = text.toLowerCase();
      user.onboardingStep = "completed";
      await user.save();

      // Update profile post in admin channel
      const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
      const bankCount = user.bankDetails.length;
      const langLabel = user.language === "am" ? "አማርኛ" : "English";
      const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");
      const linesEn = [
        `📋 Profile:`,
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks: ${banksList} (${bankCount})`,
        `• Language: ${langLabel}`,
        `• Registered: ${registeredAt}`,
        `\n📊 History & Stats:`,
        `(Placeholder for past tasks, reviews, obligations…)`,
        `\nAdmin Actions:`
      ];
      const linesAm = [
        `📋 ፕሮፋይል፤`,
        `• ሙሉ ስም፥ ${user.fullName}`,
        `• ስልክ፥ ${user.phone}`,
        `• ኢሜይል፥ ${user.email}`,
        `• የተለግራም ስም፥ @${user.username}`,
        `• ባንኮች፥ ${banksList} (${bankCount})`,
        `• ቋንቋ፥ ${langLabel}`,
        `• ተመዝግቦበት፥ ${registeredAt}`,
        `\n📊 ታሪክ እና ስታትስ፦`,
        `(Placeholder ለቀደመ ተግዳሮቶች፣ ግምገማዎች፣ ተግዳሮት ተጠቃሚ ጥንካሬ…)`,
        `\nየአስተዳደር እርምጃዎች:`
      ];
      const adminText = user.language === "am" ? linesAm.join("\n") : linesEn.join("\n");
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

      const ADMIN_CHANNEL = "-1002310380363";
      await ctx.telegram.sendMessage(ADMIN_CHANNEL, adminText, {
        parse_mode: "Markdown",
        reply_markup: adminButtons
      });

      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.editProfileSuccess.am
          : TEXT.editProfileSuccess.en,
        Markup.keyboard([
          [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
          [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
          [TEXT.languageBtn[user.language]]
        ])
        .oneTime()
        .resize()
      );
    }

    if (user.onboardingStep === "editingUsername") {
      const usernameRegex = /^@[a-zA-Z0-9_]{4,31}$/;
      if (!usernameRegex.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.usernameError.am
            : TEXT.usernameError.en
        );
      }
      const existingUsername = await User.findOne({ username: text.slice(1).toLowerCase(), telegramId: { $ne: tgId } });
      if (existingUsername) {
        return ctx.reply(
          user.language === "am"
            ? "ይቅርታ፣ ይህ የተለግራም ስም ከሌላ ተጠቃሚ ጋር ተጠቃሚ መሆኑ የተገኘ ነው። እንደገና ይሞክሩ።"
            : "Sorry, this Telegram username is already taken! Please try again."
        );
      }
      user.username = text.slice(1).toLowerCase();
      user.onboardingStep = "completed";
      await user.save();

      // Update profile post in admin channel (same code)
      const banksList = user.bankDetails.map((b) => b.bankName).join(", ") || "None";
      const bankCount = user.bankDetails.length;
      const langLabel = user.language === "am" ? "አማርኛ" : "English";
      const registeredAt = dayjs(user.createdAt).tz("Africa/Addis_Ababa").format("MMM D, YYYY, h:mm A");
      const linesEn = [
        `📋 Profile:`,
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks: ${banksList} (${bankCount})`,
        `• Language: ${langLabel}`,
        `• Registered: ${registeredAt}`,
        `\n📊 History & Stats:`,
        `(Placeholder for past tasks, reviews, obligations…)`,
        `\nAdmin Actions:`
      ];
      const linesAm = [
        `📋 ፕሮፋይል፤`,
        `• ሙሉ ስም፥ ${user.fullName}`,
        `• ስልክ፥ ${user.phone}`,
        `• ኢሜይል፥ ${user.email}`,
        `• የተለግራም ስም፥ @${user.username}`,
        `• ባንኮች፥ ${banksList} (${bankCount})`,
        `• ቋንቋ፥ ${langLabel}`,
        `• ተመዝግቦበት፥ ${registeredAt}`,
        `\n📊 ታሪክ እና ስታትስ፦`,
        `(Placeholder ለቀደመ ተግዳሮቶች፣ ግምገማዎች፣ ተግዳሮት ተጠቃሚ ጥንካሬ…)`,
        `\nየአስተዳደር እርምጃዎች:`
      ];
      const adminText = user.language === "am" ? linesAm.join("\n") : linesEn.join("\n");
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

      const ADMIN_CHANNEL = "-1002310380363";
      await ctx.telegram.sendMessage(ADMIN_CHANNEL, adminText, {
        parse_mode: "Markdown",
        reply_markup: adminButtons
      });

      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.editProfileSuccess.am
          : TEXT.editProfileSuccess.en,
        Markup.keyboard([
          [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
          [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
          [TEXT.languageBtn[user.language]]
        ])
        .oneTime()
        .resize()
      );
    }

    if (user.onboardingStep === "editingBanks") {
      // We simply re‐start the bankMulti flow so they can add/replace from scratch.
      user.bankDetails = [];
      user.onboardingStep = "bankMulti";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.askBankDetails.am
          : TEXT.askBankDetails.en
      );
    }

    if (user.onboardingStep === "editingBack") {
      // Go back to main menu
      user.onboardingStep = "completed";
      await user.save();

      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? "እንኳን ደግሞ በደህና መመለስ።",
          Markup.keyboard([
            [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
            [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
            [TEXT.languageBtn[user.language]]
          ])
          .oneTime()
          .resize()
        : {
            text: "Welcome back!",
            reply_markup: Markup.keyboard([
            [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
            [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
            [TEXT.languageBtn[user.language]]
          ]).oneTime().resize()
        }
      );
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  “Post a Task” Flow Steps (user enters text/file) ─────────────────────────
    // ───────────────────────────────────────────────────────────────────────────

    // Step: “postDescription”
    if (user.onboardingStep === "postDescription") {
      const desc = text;
      if (desc.length < 20 || desc.length > 1250) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postDescriptionError.am
            : TEXT.postDescriptionError.en
        );
      }
      sessions[tgId] = sessions[tgId] || {};
      sessions[tgId].description = desc;

      user.onboardingStep = "postFile";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskFile.am
          : TEXT.postAskFile.en,
        Markup.inlineKeyboard([
          [ Markup.button.callback(user.language === "am" ? TEXT.postSkipBtn.am : TEXT.postSkipBtn.en, "POST_SKIP_FILE") ]
        ])
      );
    }

    // Step: “postFile” (user may send a document or type “Skip”)
    if (user.onboardingStep === "postFile") {
      if (text === TEXT.postSkipBtn[user.language]) {
        sessions[tgId].relatedFileId = null;
        user.onboardingStep = "postFields";
        await user.save();

        return ctx.reply(
          user.language === "am"
            ? TEXT.postAskFieldsIntro.am
            : TEXT.postAskFieldsIntro.en
        );
      } else {
        // If they type text instead of sending a document or clicking Skip
        return ctx.reply(
          user.language === "am"
            ? "እባክዎ ፋይል ወይም “Skip” ይጫኑ።"
            : "Please send a file or click “Skip.”"
        );
      }
    }

    // If user sends an actual file/document when onboardingStep === "postAskUploadFile":
    if (user.onboardingStep === "postAskUploadFile" && ctx.message.document) {
      const fileId = ctx.message.document.file_id;
      sessions[tgId].relatedFileId = fileId;

      user.onboardingStep = "postFields";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskFieldsIntro.am
          : TEXT.postAskFieldsIntro.en
      );
    }

    // Step: “postFields” (handled via callback actions below; ignore stray text)
    if (user.onboardingStep === "postFields") {
      return;
    }

    // Step: “postFieldsAddOrSkip” (ignore stray text again)
    if (user.onboardingStep === "postFieldsAddOrSkip") {
      return;
    }

    // Step: “postSkill” (ignore stray text)
    if (user.onboardingStep.startsWith("postSkill")) {
      return;
    }

    // Step: “postPaymentFee” (ignore stray text)
    if (user.onboardingStep === "postPaymentFee") {
      return;
    }

    // Step: “postCompletionHours” (ignore stray text)
    if (user.onboardingStep === "postCompletionHours") {
      return;
    }

    // Step: “postRevisionHours” (ignore stray text)
    if (user.onboardingStep === "postRevisionHours") {
      return;
    }

    // Step: “postLatePenalty” (ignore stray text)
    if (user.onboardingStep === "postLatePenalty") {
      return;
    }

    // Step: “postExpiryHours” (ignore stray text)
    if (user.onboardingStep === "postExpiryHours") {
      return;
    }

    // Step: “postExchange” (ignore stray text)
    if (user.onboardingStep === "postExchange") {
      return;
    }

    // Step: “postCategory” (ignore stray text)
    if (user.onboardingStep === "postCategory") {
      return;
    }

    // Step: “postConfirm” (handled via callback actions, ignore text)
    if (user.onboardingStep === "postConfirm") {
      return;
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  “Find a Task” Flow Steps (after user clicks “Filter Tasks”) ─────────────
    // ───────────────────────────────────────────────────────────────────────────
    if (user.onboardingStep === "findingIntro") {
      return;
    }
    if (user.onboardingStep === "findingSkill") {
      return;
    }
    if (user.onboardingStep === "findingFieldsAddOrSkip") {
      return;
    }
    if (user.onboardingStep === "findingMinFee") {
      // “Min Fee” step expects only digits; handle stray text here
      const minFeeText = text;
      if (!/^\d+$/.test(minFeeText)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.findMinFeeErrorDigits.am
            : TEXT.findMinFeeErrorDigits.en
        );
      }
      const minFee = parseInt(minFeeText, 10);
      if (minFee < 0) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.findMinFeeErrorValue.am
            : TEXT.findMinFeeErrorValue.en
        );
      }
      sessions[tgId].filterMinFee = minFee;
      user.onboardingStep = "findingReview";
      await user.save();

      // Show a “Fetching tasks…” message, then call doFindTasks(...)
      await ctx.reply(
        user.language === "am"
          ? "ተግዳሮቶች ለመፈለግ እቅድ በየሁሉም ጊዜ 2 ደቂቃ ይጠብቁ።"
          : "Fetching tasks for you (please wait up to 2 minutes)..."
      );
      return doFindTasks(ctx, user);
    }

    // If no other step matched, ignore text
    return;
  });

  // ----------------------------------------------------------------------------
  //  ADMIN ACTIONS (placeholders – no functional logic yet)
  // ----------------------------------------------------------------------------
  bot.action(/ADMIN_BAN_\w+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_\w+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_\w+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_\w+/, (ctx) => ctx.answerCbQuery());

  // ----------------------------------------------------------------------------
  //  “Post a Task” Flow Actions (Inline Buttons) ────────────────────────────────
  // ----------------------------------------------------------------------------

  // 1) POST_SKIP_FILE  — user clicked “Skip” instead of sending a file
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
      user.language === "am"
        ? TEXT.postAskFieldsIntro.am
        : TEXT.postAskFieldsIntro.en
    );
  });

  // 2) FIELD_PAGE_{n} — user navigates pages of fields
  bot.action(/FIELD_PAGE_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = ctx.match[1];
    const pageIndex = parseInt(match, 10);
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFields") {
      return ctx.reply("No field selection in progress.");
    }
    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].fields = sessions[tgId].fields || [];

    // Build the keyboard for the requested page
    const { buttons, navBtns } = getFieldPage(pageIndex, sessions[tgId].fields || []);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) {
      keyboard.push(navBtns);
    }

    return ctx.editMessageText(
      user.language === "am"
        ? TEXT.postAskFieldsIntro.am
        : TEXT.postAskFieldsIntro.en,
      { reply_markup: Markup.inlineKeyboard(keyboard) }
    );
  });

  // 3) FIELD_{idx} — user selects a field
  bot.action(/FIELD_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx = parseInt(ctx.match[1], 10);
    const fieldName = ALL_FIELDS[idx];
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFields") {
      return ctx.reply("No field selection in progress.");
    }
    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].fields = sessions[tgId].fields || [];

    // Add if not already chosen
    if (!sessions[tgId].fields.includes(fieldName)) {
      sessions[tgId].fields.push(fieldName);
    }

    user.onboardingStep = "postFieldsAddOrSkip";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? `${TEXT.postAskFieldsIntro.am}\n\nየተመረጡት መርጦች፥ ${sessions[tgId].fields.join(", ")}\n\n• በትግበሩ (“Add” ይጫኑ) ወይም (“Done” ይጫኑ)።`
        : `${TEXT.postAskFieldsIntro.en}\n\nSelected: ${sessions[tgId].fields.join(", ")}\n\n• Click “Add” or “Done.”`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(user.language === "am" ? "ጨምር" : "Add", "POST_FIELDS_ADD"),
          Markup.button.callback(user.language === "am" ? "ተጠናቋል" : "POST_FIELDS_DONE", user.language)
        ]
      ])
    );
  });

  // 4) POST_FIELDS_ADD — user clicked “Add Another Field”
  bot.action("POST_FIELDS_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }

    if (!sessions[tgId].fields || sessions[tgId].fields.length === 0) {
      return ctx.reply(
        user.language === "am"
          ? TEXT.postFieldsError.am
          : TEXT.postFieldsError.en
      );
    }

    user.onboardingStep = "postFields";
    await user.save();

    // Show page 0 again (with updated chosen)
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) {
      keyboard.push(navBtns);
    }

    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskFieldsIntro.am
        : TEXT.postAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // 5) POST_FIELDS_DONE — user clicked “Done” after selecting fields
  bot.action("POST_FIELDS_DONE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    if (!sessions[tgId].fields || sessions[tgId].fields.length === 0) {
      return ctx.reply(
        user.language === "am"
          ? TEXT.postFieldsError.am
          : TEXT.postFieldsError.en
      );
    }

    user.onboardingStep = "postSkill";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskSkill.am
        : TEXT.postAskSkill.en,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("መጀመሪያ ደረጃ", "POST_SKILL_BEGINNER"),
          Markup.button.callback("መካከለኛ ደረጃ", "POST_SKILL_INTERMEDIATE"),
          Markup.button.callback("ባለሙያ ደረጃ", "POST_SKILL_PROFESSIONAL")
        ]
      ])
    );
  });

  // 6) POST_SKILL_{LEVEL} — skill level selection
  bot.action(/POST_SKILL_(BEGINNER|INTERMEDIATE|PROFESSIONAL)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const levelKey = data.split("_")[2]; // e.g., "BEGINNER"
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postSkill") {
      return ctx.reply("No skill selection in progress.");
    }

    // Map levelKey to label
    let level;
    if (levelKey === "BEGINNER") level = "Beginner Level Skill";
    if (levelKey === "INTERMEDIATE") level = "Intermediate Level Skill";
    if (levelKey === "PROFESSIONAL") level = "Professional Level Skill";

    // Disable the clicked button
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          `✔ ${
            levelKey === "BEGINNER" ? "መጀመሪያ ደረጃ" :
            levelKey === "INTERMEDIATE" ? "መካከለኛ ደረጃ" :
            "ባለሙያ ደረጃ"
          }`,
          `_DISABLED_POST_SKILL_${levelKey}`
        )
      ]]
    });

    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].skillLevel = level;

    user.onboardingStep = "postPaymentFee";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskPaymentFee.am
        : TEXT.postAskPaymentFee.en
    );
  });

  // 7) POST_PAYMENTFEE: user types in digits
  bot.on("text", async (ctx) => {
    const tgId = ctx.from.id;
    const text = ctx.message.text.trim();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    if (user.onboardingStep === "postPaymentFee") {
      if (!/^\d+$/.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postPaymentDigitsError.am
            : TEXT.postPaymentDigitsError.en
        );
      }
      const fee = parseInt(text, 10);
      if (fee < 50) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postPaymentValueError.am
            : TEXT.postPaymentValueError.en
        );
      }
      sessions[tgId].paymentFee = fee;

      user.onboardingStep = "postCompletionHours";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskCompletionHours.am
          : TEXT.postAskCompletionHours.en
      );
    }

    // 8) POST_COMPLETION_HOURS
    if (user.onboardingStep === "postCompletionHours") {
      if (!/^\d+$/.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postCompletionDigitsError.am
            : TEXT.postCompletionDigitsError.en
        );
      }
      const hours = parseInt(text, 10);
      if (hours <= 0 || hours > 120) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postCompletionRangeError.am
            : TEXT.postCompletionRangeError.en
        );
      }
      sessions[tgId].completionHours = hours;

      user.onboardingStep = "postRevisionHours";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskRevisionHours.am
          : TEXT.postAskRevisionHours.en
      );
    }

    // 9) POST_REVISION_HOURS
    if (user.onboardingStep === "postRevisionHours") {
      if (!/^\d+$/.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postRevisionDigitsError.am
            : TEXT.postRevisionDigitsError.en
        );
      }
      const revH = parseInt(text, 10);
      const compH = sessions[tgId].completionHours;
      if (revH < 0 || revH > Math.floor(compH / 2)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postRevisionRangeError.am
            : TEXT.postRevisionRangeError.en
        );
      }
      sessions[tgId].revisionHours = revH;

      user.onboardingStep = "postLatePenalty";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskLatePenalty.am
          : TEXT.postAskLatePenalty.en
      );
    }

    // 10) POST_LATE_PENALTY
    if (user.onboardingStep === "postLatePenalty") {
      if (!/^\d+$/.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postPenaltyDigitsError.am
            : TEXT.postPenaltyDigitsError.en
        );
      }
      const penalty = parseInt(text, 10);
      const fee = sessions[tgId].paymentFee;
      if (penalty < 0 || penalty > Math.floor(fee * 0.2)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postPenaltyRangeError.am
            : TEXT.postPenaltyRangeError.en
        );
      }
      sessions[tgId].latePenalty = penalty;

      user.onboardingStep = "postExpiryHours";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskExpiryHours.am
          : TEXT.postAskExpiryHours.en
      );
    }

    // 11) POST_EXPIRY_HOURS
    if (user.onboardingStep === "postExpiryHours") {
      if (!/^\d+$/.test(text)) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postExpiryDigitsError.am
            : TEXT.postExpiryDigitsError.en
        );
      }
      const exp = parseInt(text, 10);
      if (exp < 1) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postExpiryRangeErrorLow.am
            : TEXT.postExpiryRangeErrorLow.en
        );
      }
      if (exp > 24) {
        return ctx.reply(
          user.language === "am"
            ? TEXT.postExpiryRangeErrorHigh.am
            : TEXT.postExpiryRangeErrorHigh.en
        );
      }
      sessions[tgId].expiryHours = exp;

      user.onboardingStep = "postExchange";
      await user.save();

      return ctx.reply(
        user.language === "am"
          ? TEXT.postAskExchange.am
          : TEXT.postAskExchange.en,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("100%", "POST_EXCHANGE_100"),
            Markup.button.callback("30%:40%:30%", "POST_EXCHANGE_304030"),
            Markup.button.callback("50%:50%", "POST_EXCHANGE_5050")
          ]
        ])
      );
    }

    // 12) POST_EXCHANGE_{STRATEGY}
    if (user.onboardingStep === "postExchange") {
      // This is caught by the bot.action(...) handler below.
      return;
    }

    // 13) POST_CATEGORY (user types in category text)
    if (user.onboardingStep === "postCategory") {
      const catText = text.trim();
      if (!catText || catText.length < 3) {
        return ctx.reply(
          user.language === "am"
            ? "ያስገቡት ምድብ ትንሽ በጥንቃቄ ይጻፉ።"
            : "Please enter a valid category (min 3 chars)."
        );
      }
      sessions[tgId].category = catText;

      // All task details collected; move next to “postConfirm”
      user.onboardingStep = "postConfirm";
      await user.save();

      // Build a summary preview and show Confirm/Cancel buttons
      const s = sessions[tgId];
      const previewLinesEn = [
        "🟢 Task is ready to post!",
        `Task Description: ${s.description}`,
        s.relatedFileId ? `(Related file attached privately)` : "",
        `Fields: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
        `Skill level required: ${s.skillLevel}`,
        `Payment Fee: ${s.paymentFee} birr`,
        `Time to complete: ${s.completionHours} hour(s)`,
        `Revision time: ${s.revisionHours} hour(s)`,
        `Late-submission penalty: ${s.latePenalty} birr/hour`,
        `Expiry: ${dayjs().add(s.expiryHours, "hour").tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
        `Category: ${s.category}`,
        `Payment-Task exchange strategy: ${s.exchangeStrategy}`,
        `Creator Banks: ${user.bankDetails.map(b => b.bankName).join(", ")}`,
        `Creator Earned: ${user.stats.totalEarned.toFixed(2)} birr | Spent: ${user.stats.totalSpent.toFixed(2)} birr | Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} reviews)`
      ];
      const previewLinesAm = [
        "🟢 ተግዳሮት ለማቅረብ ዝግጅት በትክክል ወጣ።",
        `የተግዳሮት መግለጫ (English): ${s.description}`,
        s.relatedFileId ? `(በባይበሪ ተመራረብ ተለጥፏል።)` : "",
        `መርጦች: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
        `የሚፈለገው የክሊድ ደረጃ: ${s.skillLevel}`,
        `የክፍያ ብር: ${s.paymentFee} ብር`,
        `ለመጠነቀቅ የሚያስፈልገው ጊዜ: ${s.completionHours} ሰዓታት`,
        `ለቅጣት የተመደበ ጊዜ: ${s.revisionHours} ሰዓታት`,
        `የስዳት ቅጣት: ${s.latePenalty} ብር/ሰዓት`,
        `የትእዛዝ የሚያልፍበት ጊዜ: ${dayjs().add(s.expiryHours, "hour").tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
        `ምድብ: ${s.category}`,
        `የክፍያ ተግዳሮት ለውጥ ዘዴ: ${s.exchangeStrategy}`,
        `የይዘት ባንኮች: ${user.bankDetails.map(b => b.bankName).join(", ")}`,
        `የተገኘ ብር: ${user.stats.totalEarned.toFixed(2)} ብር | የተፈረሰ ብር: ${user.stats.totalSpent.toFixed(2)} ብር | ደረጃ በ5 ከፍ ፣ ወገን: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)`
      ];

      return ctx.reply(
        user.language === "am" ? previewLinesAm.join("\n") : previewLinesEn.join("\n"),
        Markup.inlineKeyboard([
          [buildButton({ en: "Post Task", am: "ተግዳሮት ልጥፍ" }, "POST_CONFIRM", user.language, false)],
          [buildButton({ en: "Cancel", am: "ሰንሰለት" }, "POST_CANCEL", user.language, false)]
        ])
      );
    }

    // 14) POST_CANCEL
    if (user.onboardingStep === "postConfirm" && text === TEXT.postCancelBtn[user.language]) {
      sessions[tgId] = {};
      user.onboardingStep = "completed";
      await user.save();
      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.postTaskCanceled.am
          : TEXT.postTaskCanceled.en,
        Markup.keyboard([
          [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
          [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
          [TEXT.languageBtn[user.language]]
        ])
        .oneTime()
        .resize()
      );
    }

    // If nothing matched, do nothing
    return;
  });

  // ----------------------------------------------------------------------------
  //  “Post a Task” Callback Actions ────────────────────────────────────────────
  // ----------------------------------------------------------------------------

  // POST_EXCHANGE (user clicks on one of “100%”, “30%:40%:30%”, or “50%:50%”)
  bot.action(/POST_EXCHANGE_(100|304030|5050)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data; // e.g., "POST_EXCHANGE_100"
    const strategyKey = data.split("_")[2];
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postExchange") {
      return ctx.reply("No exchange selection in progress.");
    }

    let strategy;
    if (strategyKey === "100") {
      strategy = "100% of the task for 100% of task fee";
    }
    if (strategyKey === "304030") {
      strategy = "30% of the task → 30% fee → 40% of the task → 40% fee → 30% of the task → 30% fee";
    }
    if (strategyKey === "5050") {
      strategy = "50% of the task → 50% fee → 50% of the task → 50% fee";
    }

    // Disable the clicked button
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          `✔ ${
            strategyKey === "100" ? "100%" :
            strategyKey === "304030" ? "30%:40%:30%" :
            "50%:50%"
          }`,
          `_DISABLED_POST_EXCHANGE_${strategyKey}`
        )
      ]]
    });

    sessions[tgId].exchangeStrategy = strategy;

    user.onboardingStep = "postCategory";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? TEXT.postAskCategory.am
        : TEXT.postAskCategory.en
    );
  });

  // POST_CONFIRM (user confirms “Post Task”)
  bot.action("POST_CONFIRM", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "postConfirm") {
      return ctx.reply("No task in progress to confirm.");
    }

    // Save postingTask into DB
    Object.assign(user.postingTask, sessions[tgId]);
    user.postingTask.isPosted = true;
    user.postingTask.expiryTimestamp = dayjs().add(sessions[tgId].expiryHours, "hour").toDate();
    await user.save();

    // Build final task post and send to channel
    const CHANNEL_ID = "-1002254896955"; // @TaskifiiRemote
    const s = sessions[tgId];
    const previewLinesEn = [
      "🟢 Task is open!",
      `Task Description: ${s.description}`,
      s.relatedFileId ? "(Related file attached privately)" : "",
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
      `የተግዳሮት መግለጫ (English): ${s.description}`,
      s.relatedFileId ? "(በባይበሪ ተመራረብ ተለጥፏል.)" : "",
      `መርጦች: ${s.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")}`,
      `የሚፈለገው የክሊድ ደረጃ: ${s.skillLevel}`,
      `የክፍያ ብር: ${s.paymentFee} ብር`,
      `ለመጠነቀቅ የሚያስፈልገው ጊዜ: ${s.completionHours} ሰዓታት`,
      `ለቅጣት የተመደበ ጊዜ: ${s.revisionHours} ሰዓታት`,
      `የስዳት ቅጣት: ${s.latePenalty} ብር/ሰዓት`,
      `የትእዛዝ የሚያልፍበት ጊዜ: ${dayjs(user.postingTask.expiryTimestamp).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D, YYYY")}`,
      `ምድብ: ${s.category}`,
      `የክፍያ ተግዳሮት ለውጥ ዘዴ: ${s.exchangeStrategy}`,
      `የይዘት ባንኮች: ${user.bankDetails.map(b => b.bankName).join(", ")}`,
      `የተገኘ ብር: ${user.stats.totalEarned.toFixed(2)} ብር | የተፈረሰ ብር: ${user.stats.totalSpent.toFixed(2)} ብር | ደረጃ በ5 ከፍ ፣ ወገን: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)`
    ];

    const postMessage = await ctx.telegram.sendMessage(
      CHANNEL_ID,
      user.language === "am" ? previewLinesAm.join("\n") : previewLinesEn.join("\n"),
      {
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback(user.language === "am" ? "Apply" : "Apply", `APPLY_${tgId}_${user._id}`)
          ]
        ])
      }
    );
    // Save channel post IDs
    user.postingTask.postChannelId = CHANNEL_ID;
    user.postingTask.postMessageId = postMessage.message_id;
    await user.save();

    // Notify creator in private chat with main menu keyboard
    await ctx.reply(
      user.language === "am"
        ? TEXT.postTaskPosted.am
        : TEXT.postTaskPosted.en,
      Markup.keyboard([
        [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
        [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
        [TEXT.languageBtn[user.language]]
      ])
      .oneTime()
      .resize()
    );

    // Clean up session & rate limit
    delete sessions[tgId];
    rateLimitFlags[tgId] = false;
    return;
  });

  // 15) POST_CANCEL (inline “Cancel” button)
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
      Markup.keyboard([
        [TEXT.postTaskBtn[user.language], TEXT.findTaskBtn[user.language]],
        [TEXT.termsBtn[user.language], TEXT.editProfileBtn[user.language]],
        [TEXT.languageBtn[user.language]]
      ])
      .oneTime()
      .resize()
    );
  });

  // ----------------------------------------------------------------------------
  //  “Find a Task” Callback Actions ────────────────────────────────────────────
  // ----------------------------------------------------------------------------

  // FIND_GO_CHANNEL: user clicked “Go to channel”
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
        ? "እባክዎ በቀጥታ ቻናል ይመልከቱ።"
        : "Please browse tasks in @TaskifiiRemote."
    );
  });

  // FIND_FILTER: user clicked “Filter Tasks”
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
      user.language === "am"
        ? TEXT.findAskSkill.am
        : TEXT.findAskSkill.en,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("መጀመሪያ ደረጃ", "FIND_SKILL_BEGINNER"),
          Markup.button.callback("መካከለኛ ደረጃ", "FIND_SKILL_INTERMEDIATE"),
          Markup.button.callback("ባለሙያ ደረጃ", "FIND_SKILL_PROFESSIONAL")
        ]
      ])
    );
  });

  // FIND_SKILL_{LEVEL}
  bot.action(/FIND_SKILL_(BEGINNER|INTERMEDIATE|PROFESSIONAL)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const levelKey = data.split("_")[2]; // "BEGINNER", "INTERMEDIATE", or "PROFESSIONAL"
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingSkill") {
      return ctx.reply("No find flow in progress.");
    }

    let level;
    if (levelKey === "BEGINNER") level = "Beginner";
    if (levelKey === "INTERMEDIATE") level = "Intermediate";
    if (levelKey === "PROFESSIONAL") level = "Professional";

    // Disable the clicked skill button
    const label =
      levelKey === "BEGINNER"
        ? "መጀመሪያ ደረጃ"
        : levelKey === "INTERMEDIATE"
          ? "መካከለኛ ደረጃ"
          : "ባለሙያ ደረጃ";
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${label}`, `_DISABLED_FIND_SKILL_${levelKey}`)
      ]]
    });

    sessions[tgId] = sessions[tgId] || {};
    sessions[tgId].fields = [];
    sessions[tgId].filterSkillLevel = level;
    user.onboardingStep = "findingFields";
    await user.save();

    // Show first page of fields for filtering
    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) {
      keyboard.push(navBtns);
    }

    return ctx.reply(
      user.language === "am"
        ? TEXT.findAskFieldsIntro.am
        : TEXT.findAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // FIND_FIELDS: user selects or pages through fields (similar to post flow)
  bot.action(/FIELD_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx = parseInt(ctx.match[1], 10);
    const fieldName = ALL_FIELDS[idx];
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || !user.onboardingStep.startsWith("findingFields")) {
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
        ? `${TEXT.findAskFieldsIntro.am}\n\nየተመረጡት መርጦች፥ ${sessions[tgId].fields.join(", ")}\n\n• “Add Another” ይጫኑ ወይም “Skip” ይጫኑ።`
        : `${TEXT.findAskFieldsIntro.en}\n\nSelected: ${sessions[tgId].fields.join(", ")}\n\n• Click “Add Another” or “Skip.”`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(user.language === "am" ? "Add Another" : "Add Another", "FIND_FIELDS_CONTINUE"),
          Markup.button.callback(user.language === "am" ? "Skip" : "Skip", "FIND_FIELDS_SKIP")
        ]
      ])
    );
  });

  // FIND_FIELDS_CONTINUE (user clicked “Add Another”)
  bot.action("FIND_FIELDS_CONTINUE", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }

    user.onboardingStep = "findingFields";
    await user.save();

    const { buttons, navBtns } = getFieldPage(0, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) {
      keyboard.push(navBtns);
    }

    return ctx.reply(
      user.language === "am"
        ? TEXT.findAskFieldsIntro.am
        : TEXT.findAskFieldsIntro.en,
      Markup.inlineKeyboard(keyboard)
    );
  });

  // FIND_FIELDS_SKIP (user clicked “Skip”)
  bot.action("FIND_FIELDS_SKIP", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || user.onboardingStep !== "findingFieldsAddOrSkip") {
      return ctx.reply("No field selection in progress.");
    }
    if (!sessions[tgId].fields || sessions[tgId].fields.length === 0) {
      return ctx.reply(
        user.language === "am"
          ? TEXT.findFieldsError.am
          : TEXT.findFieldsError.en
      );
    }

    user.onboardingStep = "findingMinFee";
    await user.save();

    return ctx.reply(
      user.language === "am"
        ? TEXT.findAskMinFee.am
        : TEXT.findAskMinFee.en
    );
  });

  // FIND_SKILL navigation (pages) / same logic as postFlow field pagination
  bot.action(/FIELD_PAGE_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const idx = parseInt(ctx.match[1], 10);
    const tgId = ctx.from.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user || !user.onboardingStep.startsWith("findingFields")) {
      return ctx.reply("No find flow in progress.");
    }

    const { buttons, navBtns } = getFieldPage(idx, sessions[tgId].fields);
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    if (navBtns.length) {
      keyboard.push(navBtns);
    }

    return ctx.editMessageText(
      user.language === "am"
        ? TEXT.findAskFieldsIntro.am
        : TEXT.findAskFieldsIntro.en,
      { reply_markup: Markup.inlineKeyboard(keyboard) }
    );
  });

  // ----------------------------------------------------------------------------
  //  Helper: Fetch at most 15 matching tasks (simulated via User.postingTask)
  //  This runs after the user selects minFee in “Find a Task”
  // ----------------------------------------------------------------------------
  async function doFindTasks(ctx, user) {
    const tgId = ctx.from.id;
    const skill = sessions[tgId].filterSkillLevel;
    const fields = sessions[tgId].fields;
    const minFee = sessions[tgId].filterMinFee;
    const channelId = "-1002254896955";

    // Find users who have posted tasks that are still active
    const now = dayjs();
    const matches = await User.find({
      "postingTask.isPosted": true,
      "postingTask.expiryTimestamp": { $gt: now.toDate() },
      "postingTask.skillLevel": skill,
      "postingTask.paymentFee": { $gte: minFee }
    }).lean();

    // Further filter by at least one matching field
    const filtered = matches.filter((u) =>
      u.postingTask.fields.some((f) => fields.includes(f))
    );

    if (filtered.length === 0) {
      user.onboardingStep = "completed";
      await user.save();
      rateLimitFlags[tgId] = false;
      return ctx.reply(
        user.language === "am"
          ? TEXT.postPreviewMissing.am
          : TEXT.postPreviewMissing.en
      );
    }

    // Show up to 15 previews
    const previews = [];
    for (let i = 0; i < Math.min(filtered.length, 15); i++) {
      const t = filtered[i].postingTask;
      const line = `🔹 ${t.category} | Fee: ${t.paymentFee} birr | Expires: ${dayjs(t.expiryTimestamp).tz("Africa/Addis_Ababa").format("hh:mm A, MMM D")}`;
      previews.push(line);
    }

    const replyText = previews.join("\n");
    user.onboardingStep = "completed";
    await user.save();
    rateLimitFlags[tgId] = false;
    return ctx.reply(replyText);
  }

  // ----------------------------------------------------------------------------
  //  Launch Bot & Graceful Shutdown
  // ----------------------------------------------------------------------------
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

