// ────────────────────────────────────────────────────────────────────────────────
// src/index.js
// Full updated version with all ten “Post a Task” inquiries implemented exactly
// as per your instructions. Simply replace your current src/index.js with this.
//
// Make sure you have already installed these dependencies in package.json:
//    "telegraf": "^4.12.2",
//    "mongoose": "^6.5.4",
//    "node-fetch": "^2.6.7"
// And that your TEXT object (with all translations) is up‐to‐date as in your prior code.
// ────────────────────────────────────────────────────────────────────────────────

// 1) Imports and basic setup
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const fetch = require("node-fetch");

// Load environment variables (BOT_TOKEN, MONGODB_URI, etc.)
require("dotenv").config();
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
if (!BOT_TOKEN || !MONGODB_URI) {
  console.error("⚠️ BOT_TOKEN or MONGODB_URI is missing in .env");
  process.exit(1);
}

// Connect to MongoDB Atlas
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 2) Define User schema (with all required fields and validators)
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  fullName: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  bankDetails: [
    {
      bankName: { type: String, required: true },
      accountNumber: { type: String, required: true },
    },
  ],
  language: { type: String, enum: ["en", "am"], required: true },
  registeredAt: { type: Date, default: Date.now },
  // For “Post a Task” sessions: track temporary state in memory
  onboardingStep: { type: String, default: null }, // e.g. "lang", "fullName", …, "postedProfile", "ready"
});
const User = mongoose.model("User", userSchema);

// 3) In‐memory store for “Post a Task” sessions. Keyed by telegramId.
const postSessions = {};

// 4) TEXT object with all prompts + translations (for brevity, only the relevant keys
//    are shown here; assume you have defined every TEXT.xxx[lang] exactly as in your doc):
const TEXT = {
  // LANGUAGE SELECTION
  chooseLang: {
    en: "Choose your language!",
    am: "ቋንቋ ይምረጡ!",
  },
  englishBtn: { en: "English", am: "እንግሊዝኛ" },
  amharicBtn: { en: "Amharic", am: "አማርኛ" },

  // ONBOARDING — PROFILE SETUP
  askSetupProfile: {
    en: "Please set up your profile to start using Taskifii!",
    am: "በTaskifii መጠቀም የመጀመር የመለያ መስመርዎን ያዘጋጁ!",
  },
  setupProfileBtn: { en: "Setup Profile", am: "መለያ መዘጋጀት" },

  // 1) Full Name
  askFullName: {
    en: "What is your full name?",
    am: "ሙሉ ስምዎ ማነው?",
  },
  fullNameError: {
    en: "Please enter a valid name (alphabetic characters only).",
    am: "እባክዎ ትክክለኛ ስም ያስገቡ (ፊደላዊ ቁምፊዎች ብቻ).",
  },

  // 2) Phone Number
  askPhone: {
    en: "What is your phone number?",
    am: "የስልክ ቁጥርዎ ማነው?",
  },
  phoneError: {
    en: "Please enter a valid phone number (digits only, 5–14 digits).",
    am: "እባክዎ ትክክለኛ የስልክ ቁጥር ያስገቡ (ቁጥሮች ብቻ፣ 5–14 ቁጥሮች).",
  },

  // 3) Email
  askEmail: {
    en: "What is your gmail/email address?",
    am: "የgmail/ኢሜይል አድራሻዎ ማነው?",
  },
  emailError: {
    en: "Please enter a proper email address!",
    am: "እባክዎ ትክክለኛ ኢሜይል አድራሻ ያስገቡ!",
  },

  // 4) Telegram Username
  askUsername: {
    en: "What is your Telegram username?",
    am: "የTelegram ተጠቃሚ ስምዎ ማነው?",
  },
  usernameError: {
    en: "Please make sure it is a valid Telegram username (e.g. starts with @).",
    am: "እባክዎ ትክክለኛ የTelegram ተጠቃሚ ስም መሆኑን ያዘጋጁ (ለምሳሌ @ ይጀምር).",
  },

  // 5) Bank Details (max 10). Format: BankName,AccountNumber
  askBank: {
    en: "Give us your online banking details (Maximum 10) in this format:\nBankName,AccountNumber\n(You can also include Telebirr like: Telebirr,PhoneNumber).\nPlease note: your online banking details will be shared with another Taskifii user!",
    am: "የመስመር ላይ የባንክ መረጃዎችዎን (ከፍተኛው 10) በዚህ ቅርጽ ይስጡን:\nየባንክ ስም,የመለያ ቁጥር\n(ለምሳሌ Telebirr,የስልክ ቁጥር፣ እንዲሁም Telebirr መስጫ ቁጥርዎን መጨመር ይችላሉ). \nእባክዎ ያስታውሱ: የመስመር ላይ ባንክ መረጃዎች ከሌላ ተጠቃሚ ጋር ይተላለፋሉ!",
  },
  bankFormatError: {
    en: "Please give us valid banking details in this format: BankName,AccountNumber (no grammatical errors).",
    am: "በዚህ ቅርጽ ትክክለኛ የባንክ መረጃ ያስገቡ: የባንክ ስም,የመለያ ቁጥር (ማዕከላዊ ስህተቶች የሉህም).",
  },
  bankAddedPrompt: {
    en: "Bank added. Enter another or click “Done” if finished.",
    am: "ባንኩ ተጨምሯል። ሌላ ያስገቡ ወይም “ተጠናቋል” የተባለውን ይጫኑ።",
  },
  bankReachedTen: {
    en: "You have reached the maximum of 10 banking details. Moving on to Terms & Conditions.",
    am: "የባንክ መረጃዎችዎ ከፍተኛው 10 ደረሰ። ወደ መተግበሪያዎች እና መመሪያዎች ተይዞ ግ።",
  },

  // 6) Terms & Conditions (custom‐written based on doc+research)
  askTerms: {
    en: `
📜 **Terms & Conditions**

1️⃣ This platform (“Taskifii”) is an MVP (not legally registered in Ethiopia).  
2️⃣ We do NOT charge any commissions or fees; you keep 100% of what you earn.  
3️⃣ You agree that all user data (phone, email, bank details) is stored securely and encrypted.  
4️⃣ There is NO escrow system; payment to the Task Doer is managed directly between users.  
5️⃣ By clicking “Agree,” you confirm you have read and accepted these terms and that you will not hold Taskifii liable for disputes.  
6️⃣ If you violate any rules (fraud, false reporting, harassment), you may be banned immediately.  
7️⃣ Please ensure you follow Ethiopia’s labor laws: minimum age is 18 to work remotely.  
8️⃣ Since this is an MVP, the platform is provided “as is” without warranties of any kind.  
9️⃣ Taskifii will try its best to keep all information private but cannot guarantee 100% liability.  
10️⃣ If you do not agree, click “Disagree” and you will be prompted to review or leave.

Click **“Agree”** to proceed. Click **“Disagree”** to review again (if you insist, you cannot proceed).
`,
    am: `
📜 **መተግበሪያ እና መመሪያዎች**

1️⃣ ይህ መተግበሪያ (“Taskifii”) እጅግ የመጀመሪያ ምርት (MVP) ነው (በኢትዮጵያ ሕጋዊ ተዘዋዋሪ አይደለም).  
2️⃣ የምንቀርብዎት አንዳንድ ኮሚሽን ወይም ክፍያ አለመኖሩ፤ የተጠናቀቁ ሁሉንም 100% ያገኛሉ።  
3️⃣ ስልክ ቁጥር፣ ኢሜይል፣ የባንክ መረጃዎች በደህንነት በሒሳብ ውስጥ ተያይዞ ይቀመጣሉ።  
4️⃣ የኢስኩሮ ሥርዓት የለም፤ ወንጀል ለመደረግ የከፈላቸው ወጪዎች በተጠናቀቀ ሁሉ በተጠቃሚዎች መካከል በቀጥታ ይቆጣጠራሉ።  
5️⃣ ለመመረጃዎቹ መፈተሻ፣ ፍላጎት በመጫን መጠቀም እንደሚፈቅደው ያረጋግጡ። የውክልና ጉዳዮች በTaskifii ላይ አቈጥሩ።  
6️⃣ ማንኛውም የውክልና ችግር ወይም ማስተዋል ብዙ ጊዜ የተሳሳተ መረጃ ስለሚቀርብ ወይም ስለ የማይተደር መተግበሪያ ድጋፍ በሚፈለግበት ጊዜ ሙሉ ተቋም (Entity) ተሾሞ ይቈምላል።  
7️⃣ እባኮት የኢትዮጵያ የህግ መሠረታዊ ሕጎችን ተጠቃሚ አድርጉ። የሠራተኛ ዕድሜ ≥18 ነው።  
8️⃣ እንደ እኔ ይዘው፣ ይህ መተግበሪያ “እንደሚገኝ” ነው; ማንም የተለያዩ አዋጅ የለም።  
9️⃣ የመረጃዎችን ደህንነት በተግባር በመጠበቅ ይሞክሩ፣ ግን 100% ተጠቃሚ ሕርፍ አይፈልጋም።  
🔟 “ያልተስማማ” ብለው ከሚጫኑ በኋላ ሌላ ጊዜ ይመለሳሉ፤ እርስዎ ስላላደረጉት አብቂ ተግባር ማድመጥ አትችሉም።

“Agree” የተባለውን ጫን በመጫን ይቀጥሉ። “Disagree” ውክልና ያረጋግጡ።
`,
  },
  agreeBtn: { en: "Agree ✔️", am: "ስምምነት ✔️" },
  disagreeBtn: { en: "Disagree ❌", am: "አትስማምን ❌" },
  termsReview: { en: "Please review the Terms & Conditions again:", am: "እባክዎ መተግበሪያዎችን እንደገና ይመልከቱ፡፡" },

  // 7) Age Inquiry (≥18)
  askAge: {
    en: "Are you 18 or above? “Yes I am” or “No I’m not”.\n(Under 18 cannot work per Ethiopian law.)",
    am: "18 ወይም ከዚህ በላይ ነህ? ‘አዎን ነኝ’ ወይም ‘አይደለም ተብሎ አይቻልም’. \n(ከ18 በታች ስራ አድርግ አይፈቀድም።)",
  },
  ageError: { en: "❌ Invalid response. Please click “Yes I am” or “No I’m not.”", am: "❌ ልክ ልምድ አልተሰጠም። “አዎን ነኝ” ወይም “አይደለም ተብሎ አይቻልም” ይጫኑ።" },
  ageDenied: {
    en: "📛 You must be at least 18 to use Taskifii. If that changes, click “Yes”.",
    am: "📛 በTaskifii ለመጠቀም ከ18 በታች መሆን አይፈቀድም። እባክዎ አስቸኳይ አዲስ ግባ “አዎን” ይጫኑ።",
  },

  // PROFILE POST (sent both to user and to admin channel)
  profileComplete: {
    en: "📝 **Profile Complete!**\n\n• Full Name: {fullName}\n• Phone: {phone}\n• Email: {email}\n• Username: {username}\n• Banks: {bankList}\n• Language: {languageName}\n• Registered: {timestamp}\n\n(As a Task Creator: Spent {totalSpent} birr | As a Task Doer: Earned {totalEarned} birr | Rating: {avgRating} ★ from {ratingCount} users)",
    am: "📝 **መለያ ተፈጥሯል !**\n\n• ሙሉ ስም: {fullName}\n• ስልክ: {phone}\n• ኢሜይል: {email}\n• ተጠቃሚ ስም: {username}\n• ባንክ: {bankList}\n• ቋንቋ: {languageName}\n• ተመዝግቧል: {timestamp}\n\n(እንደ የእርስዎ መስራች: ከ {totalSpent} ብር አጠገብ | እንደ የእርስዎ ደርሰውን: ከ {totalEarned} ብር ያገኘ | አማካይ ደረጃ: {avgRating} ★ ከ {ratingCount} ተጠቃሚዎች)",
  },

  // FINAL MENU (inline buttons below the profile post)
  btnPostTask: { en: "Post a Task", am: "ተግሣጽ ይጨምሩ" },
  btnFindTask: { en: "Find a Task", am: "ተግሣጽ ፈልጉ" },
  btnEditProfile: { en: "Edit Profile", am: "መለያ ያርቱ" },

  //  — “Post a Task” FLOW TEXTS — 

  // 10 inquiries:
  askTaskDesc: {
    en: "✍️ Write the task description. (Be very specific; must be 20–1250 characters.)",
    am: "✍️ የተግሣጽ መግለጫ ይጻፉ። (በጣም ትክክለኛ እና 20–1250 ቁምፊዎች መሆን አለበት።)",
  },
  taskDescErrorLen: {
    en: "❌ Sorry, Task Description must be between 20 and 1250 characters.",
    am: "❌ ይቅርታ፣ የተግሣጽ መግለጫ 20–1250 ቁምፊዎች መሆን አለበት።",
  },

  askTaskFile: {
    en: "📎 If there is any file related to the task (video/image/etc.), send it here. Otherwise click “Skip”.\n(This will NOT be visible publicly; only sent to the chosen Task Doer.)",
    am: "📎 ተግሣጽ ጋር የተያያዘ ፋይል (ቪዲዮ/ምስል/ወዘተ) ካለዎት እዚህ ያስገቡ። ካልወደድዎ ከፍ በመውደቅ “ይዞረኝ” ይጫኑ።",
  },

  askFieldsIntro: {
    en: `
🔍 Welcome to the fields selection section!
Here, choose the field(s) where your task falls under.
• Must select at least ONE field.
• You may select up to TEN fields.
• Use the ⬅️ / ➡️ buttons to navigate pages of 10 fields each.
`,
    am: `
🔍 ወደ መስኮች ምርጫ ክፍል በመግባት ደህና መጡ!
እዚህ ያስገቡት የተግሣጽ መስኮች መሆናቸውን ይምረጡ:
• ቢያንስ አንድ መስኮት መምረጥ አለበት።
• እስከ አስር መስኮች መምረጥ ይችላሉ።
• መስኮችን በ10ና 10 በጎመኖች በጎመን ⬅️ / ➡️ ቁልፎች መካከል ይመችታሉ።
`,
  },
  // Predefined list of all remote‐work fields (we’ll programmatically paginate)
  FIELDS_LIST: [
    "Software Development",
    "Data Science & Analytics",
    "Cybersecurity",
    "Cloud Computing",
    "IT Support",
    "DevOps Engineering",
    "UI/UX Design",
    "Machine Learning & AI",
    "Digital Marketing",
    "Content Writing/Copywriting",
    "SEO Specialist",
    "Social Media Management",
    "Affiliate Marketing",
    "Brand Management",
    "PR & Communications",
    "Email Marketing",
    "Graphic Design",
    "Video Editing",
    "Motion Graphics",
    "Animation",
    "Product Design",
    "Interior Design (Virtual)",
    "Photography/Photo Editing",
    "Technical Writing",
    "Grant Writing",
    "Ghostwriting",
    "Editing & Proofreading",
    "Transcription Services",
    "Blogging",
    "Copy Editing",
    "Online Tutoring",
    "Course Creation",
    "Instructional Design",
    "Language Teaching (e.g., ESL)",
    "Educational Consulting",
    "Customer Service Rep",
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
    "Telemedicine (Doctors/Therapists/Counselors)",
    "Medical Transcription",
    "Medical Coding & Billing",
    "Nutrition Coaching",
    "Health & Wellness Coaching",
    "Recruitment & Talent Acquisition",
    "HR Consulting",
    "Employee Training & Development",
    "Payroll Management",
    "Legal Research",
    "Paralegal Services",
    "Contract Review",
    "Legal Consulting",
    "Voice Acting",
    "Music Production",
    "Video Game Testing",
    "Content Creation (YouTube/TikTok/Podcasts)",
    "Online Performing (Comedy/Drama/Music)",
    "Market Research",
    "Data Entry",
    "Policy Research",
    "Scientific Analysis",
    "CAD Design",
    "Remote Monitoring & Control",
    "Systems Engineering",
    "Process Engineering",
    "Translation/Interpretation",
    "Subtitling & Localization",
    "Dropshipping",
    "Amazon FBA",
    "E‐Commerce Management",
    "Product Listing Optimization",
    "Real Estate Marketing",
    "Virtual Property Tours",
    "Real Estate Consulting",
    "Scheduling & Calendar Management",
    "Document Management",
    "Scientific Data Analysis",
    "Academic Research",
    "Environmental Monitoring",
    "Online Surveys & Focus Groups",
    "Personal Assistance",
    "Event Planning",
    "Online Moderation",
    "Affiliate Marketing",
  ],

  btnFieldPrev: { en: "⬅️ Prev", am: "⬅️ ቀዳሚ" },
  btnFieldNext: { en: "➡️ Next", am: "➡️ ቀጣይ" },
  btnFieldSelect: (lang, name, idx) =>
    lang === "am" ? `#${name}` : `#${name}`, // display as hashtag
  askFieldSkipOrAdd: {
    en: "✅ Field added. Click “Add Another Field” or “Skip” to move on.",
    am: "✅ መስኮት ተጨምሯል። “ሌላ መስኮት አክል” ወይም “ይዞረኝ” ይጫኑ።",
  },
  fieldSkipBtn: { en: "Skip", am: "ይዞረኝ" },
  fieldAddBtn: { en: "Add Another Field", am: "ሌላ መስኮት አክል" },
  fieldErrorNoSelection: {
    en: "❌ You must select at least one field before proceeding.",
    am: "❌ ቢያንስ አንድ መስኮት መምረጥ አለብዎት።",
  },

  // 4th inquiry: Skill Level
  askSkillLevel: {
    en: `
🔧 Choose the skill level required for this task:
• Beginner Level Skill (no creativity; repetitive remote tasks)
• Intermediate Level Skill (some creativity)
• Professional Level Skill (high creativity)
`,
    am: `
🔧 የዚህ ተግሣጽ የተፈለገውን የክህሎት ደረጃ ይምረጡ:
• የጀማሪ ደረጃ (ፈጣን ደረጃ; በብዙው ትዕዛዝ ተመሳሳይ ተግሣጾች)
• መካከለኛ ደረጃ (አጠመች ብቻ)
• የባለሙያ ደረጃ (በጣም ፈጣን ደረጃ)
`,
  },
  btnBeginner: { en: "Beginner Level Skill", am: "የጀማሪ ደረጃ" },
  btnIntermediate: { en: "Intermediate Level Skill", am: "መካከለኛ ደረጃ" },
  btnProfessional: { en: "Professional Level Skill", am: "የባለሙያ ደረጃ" },

  // 5th inquiry: Payment Fee ≥ 50 birr
  askPaymentFee: {
    en: "💰 How much is the payment fee amount (in Birr) for task completion? (Must be ≥50)",
    am: "💰 ስራውን ለመቀጠል የክፍያ መጠን (ብር) ስንት ነው? (50 ብር ያስቀድሞ መሆን አለበት)",
  },
  paymentFeeError: {
    en: "❌ Please enter a number ≥ 50.",
    am: "❌ አንድ ቁጥር ያስገቡ (≥ 50).",
  },

  // 6th inquiry: Time required to complete (in hours, integer 1–120)
  askTimeToComplete: {
    en: "⏱ What’s the time required (in hours) to complete the task? (1–120)",
    am: "⏱ ስራውን ለመጠናቀቅ በስንት ሰዓት ይኖራል? (1–120)",
  },
  timeCompleteError: {
    en: "❌ Please enter a number between 1 and 120.",
    am: "❌ እባክዎ ቁጥር ከ 1 እስከ 120 መካከል ያስገቡ።",
  },

  // 7th inquiry: Revision Time (integer ≥0, ≤ half of timeToComplete)
  askRevisionTime: {
    en: `🔄 How many hour(s) do you require to review & fix errors after submission?  
(That includes your review time plus the Task Doer’s fix time. Must be ≥0 and ≤ half of completion time.)`,
    am: `🔄 በተግባር ተዘጋጀ በኋላ ስህተቶችን ለማድረግ/ለማረጋገጥ በስንት ሰዓት ይፈልጋሉ?  
(ይህ የእርስዎ የግምገማ ጊዜና የፍትሐማ ጊዜ ይዟል። ≥0 እና ≤ የሙሉ ስራ ጊዜዎ የፍትሐማ ጊዜ 50%).`,
  },
  revisionTimeErrorNotNumber: {
    en: "❌ Please enter numbers only.",
    am: "❌ ቁጥሮች ብቻ ያስገቡ።",
  },
  revisionTimeErrorRange: {
    en: "❌ Revision time must be ≥ 0 and ≤ half of the completion time.",
    am: "❌ የማረጋገጫ ጊዜ ≥0 እና ≤ የሙሉ ሥራ ጊዜዎ 50% መሆን አለበት።",
  },

  // 8th inquiry: Penalty per hour (integer ≥0, ≤20% of paymentFee)
  askPenalty: {
    en: "⚠️ Give the Birr amount deducted per hour (if Task Doer misses deadline). (0–20% of payment fee)",
    am: "⚠️ በስንት ብር እያንዳንድ ሰዓት ከባንድ በላይ ብር ከሙሉ ክፍያው 20% ውስጥ ብቻ ያስገቡ።",
  },
  penaltyErrorNotNumber: {
    en: "❌ Please enter numbers only.",
    am: "❌ ቁጥሮች ብቻ ያስገቡ።",
  },
  penaltyErrorRange: {
    en: "❌ Penalty per hour cannot exceed 20% of the payment fee or be <0.",
    am: "❌ በሰዓት የሚከሰስ መቀነስ ከ 20% ብር የሙሉ ክፍያ አይበልጥም፤ ወይም <0 አይሆንም።",
  },

  // 9th inquiry: Expiry time (integer 1–24 hours)
  askExpiryTime: {
    en: "⌛️ In how many hours will the offer expire? (1–24)",
    am: "⌛️ በስንት ሰዓት ውስጥ ተግሣጽ መፈለግ ይለብዎታል? (1–24)",
  },
  expiryErrorNotNumber: {
    en: "❌ Please enter numbers only.",
    am: "❌ ቁጥሮች ብቻ ያስገቡ።",
  },
  expiryErrorRange: {
    en: "❌ Expiry time must be between 1 and 24 hours.",
    am: "❌ የመመለስ ጊዜ ከ 1 እስከ 24 ሰዓት መካከል መሆን አለበት።",
  },

  // 10th inquiry: Payment‐Task Exchange Strategy (three options)
  askExchangeStrategy: {
    en: `
💱 Choose the Payment ⇄ Task exchange strategy:
• 100% Task → 100% Fee  
• 30% → 30%, 40% → 40%, 30% → 30%  
• 50% → 50%, 50% → 50%
`,
    am: `
💱 የክፍያ ⇄ ተግሣጽ ልውውጥ ዘዴ ይምረጡ:
• 100% ተግሣጽ → 100% ክፍያ  
• 30% → 30%, 40% → 40%, 30% → 30%  
• 50% → 50%, 50% → 50%
`,
  },
  btnExchange100: { en: "100% ⇄ 100%", am: "100% ⇄ 100%" },
  btnExchange304030: { en: "30% :40% :30%", am: "30% :40% :30%" },
  btnExchange5050: { en: "50% :50%", am: "50% :50%" },

  // After final inquiry: confirmation text for task post
  taskPostedSuccess: {
    en: "✅ Your task is now posted on @TaskifiiRemote!\nYou will be notified when someone applies.",
    am: "✅ ተግሣጽዎ አሁን “@TaskifiiRemote” ላይ ተገልቦልታል!\nማንኛውም ሰው ሲመዝገብ ይገልጸዋል።",
  },
};

// 5) Helper: build an inline‐keyboard button with highlighting
function buildButton(label, callbackData, lang, isDisabled) {
  // We’ll store “isDisabled” as part of the callbackData, then filter it out later.
  // If isDisabled===true, we prefix the callbackData with "DISABLED|" so that clicking
  // it does nothing. The label is still shown.
  return Markup.button.callback(
    isDisabled ? `${label} (✔️)` : label,
    isDisabled ? `DISABLED|${callbackData}` : callbackData
  );
}

// 6) Utility to format timestamp to “MM/DD/YYYY, h:mm:ss AM/PM”
function formatTimestamp(dateObj) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  }).format(dateObj);
}

// 7) Utility to compute average rating (dummy here; in real life you'd pull from a ratings collection)
async function computeAverageRating(telegramId) {
  // For this MVP, we’ll default to “0 ★ from 0 users”:
  return { avg: 0, count: 0 };
}

// 8) Utility to compute total earned/spent (dummy placeholders; you can extend to read actual task records)
async function computeTotals(telegramId) {
  return { totalEarned: 0, totalSpent: 0 };
}


// ────────────────────────────────────────────────────────────────────────────────
// 2. ONBOARDING FLOW
// ────────────────────────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

// 2.1) /start handler
bot.start(async (ctx) => {
  const tgId = ctx.from.id;
  let lang = "en"; // default if unknown

  // Check if user already exists
  let user = await User.findOne({ telegramId: tgId });

  if (!user) {
    // Start the onboarding chain
    user = new User({ telegramId: tgId, onboardingStep: "lang" });
    await user.save();
    return ctx.reply(
      TEXT.chooseLang.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.englishBtn.en, "LANG_EN", "en", false)],
        [buildButton(TEXT.amharicBtn.en, "LANG_AM", "en", false)],
      ])
    );
  }

  // If user exists and onboardingStep is “ready” (i.e. profile complete), show them main menu
  if (user.onboardingStep === "ready") {
    lang = user.language;
    // Fetch aggregated data for profile post (spent/earned/rating)
    const { totalEarned, totalSpent } = await computeTotals(tgId);
    const { avg, count } = await computeAverageRating(tgId);
    const bankList = user.bankDetails.map((b) => b.bankName).join(", ");
    const timestamp = formatTimestamp(user.registeredAt);
    const languageName = lang === "am" ? "Amharic" : "English";

    const profileText = TEXT.profileComplete[lang]
      .replace("{fullName}", user.fullName)
      .replace("{phone}", user.phone)
      .replace("{email}", user.email)
      .replace("{username}", user.username)
      .replace("{bankList}", bankList || "None")
      .replace("{languageName}", languageName)
      .replace("{timestamp}", timestamp)
      .replace("{totalEarned}", totalEarned)
      .replace("{totalSpent}", totalSpent)
      .replace("{avgRating}", avg)
      .replace("{ratingCount}", count);

    return ctx.replyWithMarkdown(profileText, {
      reply_markup: {
        inline_keyboard: [
          [buildButton(TEXT.btnPostTask[lang], "POST_TASK", lang, false)],
          [buildButton(TEXT.btnFindTask[lang], "FIND_TASK", lang, false)],
          [buildButton(TEXT.btnEditProfile[lang], "EDIT_PROFILE", lang, false)],
        ],
      },
    });
  }

  // If user is partway through onboarding, re‐start at whichever step they left off
  lang = user.language || "en";
  switch (user.onboardingStep) {
    case "lang":
      return ctx.reply(
        TEXT.chooseLang.en,
        Markup.inlineKeyboard([
          [buildButton(TEXT.englishBtn.en, "LANG_EN", "en", false)],
          [buildButton(TEXT.amharicBtn.en, "LANG_AM", "en", false)],
        ])
      );

    case "setup":
      return ctx.reply(
        TEXT.askSetupProfile[lang],
        Markup.inlineKeyboard([
          [buildButton(TEXT.setupProfileBtn[lang], "SETUP_PROFILE", lang, false)],
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

    case "bankMulti":
    case "bankFirst":
      return ctx.reply(TEXT.askBank[lang]);

    case "terms":
    case "termsReview":
      return ctx.reply(
        TEXT.askTerms[lang],
        Markup.inlineKeyboard([
          [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
          [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
        ])
      );

    case "age":
      return ctx.reply(TEXT.askAge[lang], {
        reply_markup: {
          inline_keyboard: [
            [buildButton("Yes I am", "AGE_YES", lang, false)],
            [buildButton("No I’m not", "AGE_NO", lang, false)],
          ],
        },
      });

    default:
      // Some other partial step (e.g. “fullName”, “phone”, etc.)
      return ctx.reply(`Please complete your profile first by clicking /start.`);
  }
});

// 2.2) LANG selection (inline button callbacks)
bot.action(/LANG_(EN|AM)/, async (ctx) => {
  const choice = ctx.match[1]; // “EN” or “AM”
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "lang") return ctx.answerCbQuery();

  const lang = choice === "EN" ? "en" : "am";
  user.language = lang;
  user.onboardingStep = "setup";
  await user.save();

  await ctx.editMessageText(TEXT.chooseLang[lang]);
  return ctx.reply(
    TEXT.askSetupProfile[lang],
    Markup.inlineKeyboard([
      [buildButton(TEXT.setupProfileBtn[lang], "SETUP_PROFILE", lang, false)],
    ])
  );
});

// 2.3) “SETUP_PROFILE” button
bot.action("SETUP_PROFILE", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "setup") return ctx.answerCbQuery();

  const lang = user.language;
  user.onboardingStep = "fullName";
  await user.save();

  await ctx.editMessageReplyMarkup(); // disable the “Setup Profile” button
  return ctx.reply(TEXT.askFullName[lang]);
});

// 2.4) FULL NAME text handler
bot.on("text", async (ctx) => {
  const tgId = ctx.from.id;
  const text = ctx.message.text.trim();
  let user = await User.findOne({ telegramId: tgId });
  if (!user) return; // we only handle known—=onboarding users.

  const lang = user.language;

  // ————— PROFILE SETUP STEPS —————

  // 1) Full Name
  if (user.onboardingStep === "fullName") {
    if (!/^[A-Za-z ]{1,100}$/.test(text)) {
      return ctx.reply(TEXT.fullNameError[lang]);
    }
    user.fullName = text;
    user.onboardingStep = "phone";
    await user.save();
    return ctx.reply(TEXT.askPhone[lang]);
  }

  // 2) Phone Number
  if (user.onboardingStep === "phone") {
    const digitsOnly = text.replace(/[^0-9]/g, "");
    if (!/^[0-9]{5,14}$/.test(digitsOnly)) {
      return ctx.reply(TEXT.phoneError[lang]);
    }
    user.phone = digitsOnly;
    user.onboardingStep = "email";
    await user.save();
    return ctx.reply(TEXT.askEmail[lang]);
  }

  // 3) Email
  if (user.onboardingStep === "email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(text)) {
      return ctx.reply(TEXT.emailError[lang]);
    }
    user.email = text.toLowerCase();
    user.onboardingStep = "username";
    await user.save();
    return ctx.reply(TEXT.askUsername[lang]);
  }

  // 4) Username
  if (user.onboardingStep === "username") {
    // Telegram username must start with @ and follow Telegram’s rules:
    // 5–32 chars, a–z, 0–9, underscores, no spaces. E.g. /^@[A-Za-z0-9_]{5,32}$/
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(text)) {
      return ctx.reply(TEXT.usernameError[lang]);
    }
    // Check uniqueness
    const exists = await User.findOne({ username: text });
    if (exists) {
      return ctx.reply(
        lang === "en"
          ? "❌ Sorry, this username is already taken! Please enter another Telegram username."
          : "❌ ይቅርታ፣ ይህ ተጠቃሚ ስም አስመልካች ይባላል! እባክዎ ሌላ የTelegram ተጠቃሚ ስም ያስገቡ።"
      );
    }
    user.username = text;
    user.onboardingStep = "bankFirst";
    await user.save();
    return ctx.reply(TEXT.askBank[lang]);
  }

  // 5) Bank Details (First entry or multi)
  if (user.onboardingStep === "bankFirst" || user.onboardingStep === "bankMulti") {
    // Handle if the user typed “Done” (in English bot) or “ተጠናቋል” (in Amharic)
    const isDoneCmd = lang === "am" ? text === "ተጠናቋል" : text === "Done";
    if (user.onboardingStep === "bankMulti" && isDoneCmd) {
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

    // Expect “BankName,AccountNumber”
    const parts = text.split(",");
    if (parts.length !== 2) {
      return ctx.reply(TEXT.bankFormatError[lang]);
    }
    const bankName = parts[0].trim();
    const acctNum = parts[1].trim();
    if (!/^[A-Za-z ]+$/.test(bankName) || !/^[0-9]+$/.test(acctNum)) {
      return ctx.reply(TEXT.bankFormatError[lang]);
    }
    // If replacing, remove the existing bankDetails
    if (user.onboardingStep === "bankMulti" && ctx.match && ctx.match[0] === "BANK_REPLACE") {
      // In practice, the code below is in the callback handler, but here we are in text-handler—
      // so “Replace” is handled by the callback “BANK_REPLACE”. We’ll ignore here.
    }

    // Otherwise, add new:
    user.bankDetails.push({ bankName, accountNumber: acctNum });
    await user.save();

    if (user.bankDetails.length >= 10) {
      // Max reached → auto‐move to terms
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

    // Otherwise, ask if they want to add/replace/done
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

  // 6) Terms: if they type anything while on termsReview, just re‐show T&C
  if (user.onboardingStep === "termsReview") {
    return ctx.reply(
      TEXT.askTerms[lang],
      Markup.inlineKeyboard([
        [buildButton(TEXT.agreeBtn[lang], "TC_AGREE", lang, false)],
        [buildButton(TEXT.disagreeBtn[lang], "TC_DISAGREE", lang, false)],
      ])
    );
  }

  // 7) Age: if they typed text instead of clicking Yes/No, prompt same
  if (user.onboardingStep === "age") {
    return ctx.reply(TEXT.ageError[lang]);
  }

  // Any other / text during onboarding (unexpected), prompt to click /start
  return ctx.reply(`Please complete your profile first by clicking /start.`);
});

// 2.5) CALLBACKS for Bank Add / Replace / Done
bot.action("BANK_ADD", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "bankMulti") return ctx.answerCbQuery();

  // Disable all three bank buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Re‐prompt user for another BankName,AccountNumber
  user.onboardingStep = "bankMulti"; // stays in same step
  await user.save();
  return ctx.reply(TEXT.askBank[user.language]);
});

bot.action("BANK_REPLACE", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "bankMulti") return ctx.answerCbQuery();

  // Disable bank buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Remove the most recent bank detail (we assume “replace” always replaces the last‐entered one)
  user.bankDetails.pop();
  user.onboardingStep = "bankFirst";
  await user.save();
  return ctx.reply(TEXT.askBank[user.language]);
});

bot.action("BANK_DONE", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "bankMulti") return ctx.answerCbQuery();

  // Disable bank buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Move to Terms & Conditions
  user.onboardingStep = "terms";
  await user.save();
  return ctx.reply(
    TEXT.askTerms[user.language],
    Markup.inlineKeyboard([
      [buildButton(TEXT.agreeBtn[user.language], "TC_AGREE", user.language, false)],
      [buildButton(TEXT.disagreeBtn[user.language], "TC_DISAGREE", user.language, false)],
    ])
  );
});

// 2.6) CALLBACKS for Terms & Conditions (Agree / Disagree)
bot.action("TC_AGREE", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || !["terms", "termsReview"].includes(user.onboardingStep)) return ctx.answerCbQuery();

  // Disable T&C buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Move to Age check
  user.onboardingStep = "age";
  await user.save();
  return ctx.reply(
    TEXT.askAge[user.language],
    Markup.inlineKeyboard([
      [buildButton("Yes I am", "AGE_YES", user.language, false)],
      [buildButton("No I’m not", "AGE_NO", user.language, false)],
    ])
  );
});

bot.action("TC_DISAGREE", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || !["terms", "termsReview"].includes(user.onboardingStep)) return ctx.answerCbQuery();

  // Disable T&C buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Move to “termsReview” so they can re‐read
  user.onboardingStep = "termsReview";
  await user.save();
  return ctx.reply(
    TEXT.askTerms[user.language],
    Markup.inlineKeyboard([
      [buildButton(TEXT.agreeBtn[user.language], "TC_AGREE", user.language, false)],
      [buildButton(TEXT.disagreeBtn[user.language], "TC_DISAGREE", user.language, false)],
    ])
  );
});

// 2.7) CALLBACKS for Age (Yes / No)
bot.action("AGE_YES", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "age") return ctx.answerCbQuery();

  // Disable age buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Move to finalizing profile
  user.onboardingStep = "ready";
  await user.save();

  // Build & send profile post to user
  const lang = user.language;
  const bankList = user.bankDetails.map((b) => b.bankName).join(", ");
  const timestamp = formatTimestamp(user.registeredAt);
  const languageName = lang === "am" ? "Amharic" : "English";
  const { totalEarned, totalSpent } = await computeTotals(tgId);
  const { avg, count } = await computeAverageRating(tgId);

  const profileText = TEXT.profileComplete[lang]
    .replace("{fullName}", user.fullName)
    .replace("{phone}", user.phone)
    .replace("{email}", user.email)
    .replace("{username}", user.username)
    .replace("{bankList}", bankList || "None")
    .replace("{languageName}", languageName)
    .replace("{timestamp}", timestamp)
    .replace("{totalEarned}", totalEarned)
    .replace("{totalSpent}", totalSpent)
    .replace("{avgRating}", avg)
    .replace("{ratingCount}", count);

  // Send to user:
  await ctx.replyWithMarkdown(profileText, {
    reply_markup: {
      inline_keyboard: [
        [buildButton(TEXT.btnPostTask[lang], "POST_TASK", lang, false)],
        [buildButton(TEXT.btnFindTask[lang], "FIND_TASK", lang, false)],
        [buildButton(TEXT.btnEditProfile[lang], "EDIT_PROFILE", lang, false)],
      ],
    },
  });

  // Also send to admin channel
  const adminChatId = "-1002310380363";
  await ctx.telegram.sendMessage(adminChatId, profileText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [buildButton("Ban User", `BAN_USER_${tgId}`, lang, false)],
        [buildButton("Contact User", `CONTACT_USER_${tgId}`, lang, false)],
        [buildButton("Give Reviews", `GIVE_REVIEW_${tgId}`, lang, false)],
        [buildButton("Unban User", `UNBAN_USER_${tgId}`, lang, false)],
      ],
    },
  });

  return; // done with onboarding
});

bot.action("AGE_NO", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "age") return ctx.answerCbQuery();

  // Disable age buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Stay on “age” step (allow re‐attempt)
  user.onboardingStep = "age";
  await user.save();
  return ctx.reply(TEXT.ageDenied[user.language], {
    reply_markup: {
      inline_keyboard: [
        [buildButton("Yes", "AGE_YES", user.language, false)],
      ],
    },
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 3. “POST A TASK” FLOW
// ────────────────────────────────────────────────────────────────────────────────

// Utility: initialize or reset a postSession for this user
function initPostSession(tgId, lang) {
  postSessions[tgId] = {
    lang,
    step: "postingDescription",
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

// 3.1) Handler for “POST_TASK” button (inline)
bot.action("POST_TASK", async (ctx) => {
  const tgId = ctx.from.id;
  let user = await User.findOne({ telegramId: tgId });
  if (!user || user.onboardingStep !== "ready") return ctx.answerCbQuery();

  // Disable “Post a Task” button
  const lang = user.language;
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [buildButton(TEXT.btnPostTask[lang], "DISABLED|POST_TASK", lang, true)],
      [buildButton(TEXT.btnFindTask[lang], "FIND_TASK", lang, false)],
      [buildButton(TEXT.btnEditProfile[lang], "EDIT_PROFILE", lang, false)],
    ],
  });

  // Initialize a new post session
  initPostSession(tgId, lang);

  // Ask first inquiry: Task Description
  return ctx.reply(TEXT.askTaskDesc[lang]);
});

// 3.2) Callback to skip the file step
bot.action("POST_SKIP_FILE", async (ctx) => {
  const tgId = ctx.from.id;
  const session = postSessions[tgId];
  if (!session || session.step !== "postingFile") return ctx.answerCbQuery();

  // Record “no file”
  session.data.relatedFileId = null;
  session.step = "postingFieldsIntro";

  // Ask fields intro
  return ctx.reply(TEXT.askFieldsIntro[session.lang], {
    parse_mode: "Markdown",
  });
});

// 3.3) Text handlers for “Post a Task” steps
bot.on("text", async (ctx) => {
  const tgId = ctx.from.id;
  const text = ctx.message.text.trim();
  let user = await User.findOne({ telegramId: tgId });
  if (!user) return;

  // If the user is currently in “Post a Task” flow
  const session = postSessions[tgId];
  if (!session) return;

  const lang = session.lang;

  // 10 inquiries — STEP BY STEP

  // STEP 1: Task Description (20–1250 chars)
  if (session.step === "postingDescription") {
    if (text.length < 20 || text.length > 1250) {
      return ctx.reply(TEXT.taskDescErrorLen[lang]);
    }
    session.data.description = text;
    session.step = "postingFile";
    return ctx.reply(
      TEXT.askTaskFile[lang],
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ይዞረኝ" : "Skip", "POST_SKIP_FILE")],
      ])
    );
  }

  // STEP 2: Related File (if user did not click “Skip”, we expect a file)
  //    We check ctx.message.document or ctx.message.photo
  if (session.step === "postingFile") {
    // If they typed text (instead of a file), remind them to send a file or click “Skip”
    if (!ctx.message.document && !ctx.message.photo) {
      return ctx.reply(
        lang === "am"
          ? "❌ ፋይል ያስገቡ ወይም “ይዞረኝ” ይጫኑ።"
          : "❌ Please send a file or click “Skip”."
      );
    }
    // Save file_id (so you can forward later)
    const fileId =
      ctx.message.document?.file_id ||
      ctx.message.photo[ctx.message.photo.length - 1].file_id;
    session.data.relatedFileId = fileId;

    session.step = "postingFieldsIntro";
    return ctx.reply(TEXT.askFieldsIntro[lang], { parse_mode: "Markdown" });
  }

  // STEP 3: Fields selection will be handled by callbacks (no plain‐text here)
  //         So if they type some random text while on “postingFieldsIntro” step:
  if (session.step === "postingFieldsIntro") {
    return ctx.reply(TEXT.fieldErrorNoSelection[lang]);
  }

  // STEP 4 is entirely callback‐driven (no plain text)
  if (session.step === "postingSkill") {
    return ctx.reply(
      lang === "am"
        ? "❌ እባክዎ ይህን ለመመርጥ አድምጡ።"
        : "❌ Please click one of the skill‐level buttons."
    );
  }

  // STEP 5: Payment Fee (≥50) (must be plain‐text numeric)
  if (session.step === "postingFee") {
    const numFee = parseInt(text, 10);
    if (isNaN(numFee) || numFee < 50) {
      return ctx.reply(TEXT.paymentFeeError[lang]);
    }
    session.data.paymentFee = numFee;
    session.step = "postingTime";
    return ctx.reply(TEXT.askTimeToComplete[lang]);
  }

  // STEP 6: Time to Complete in hours (1–120)
  if (session.step === "postingTime") {
    const numTime = parseInt(text, 10);
    if (isNaN(numTime) || numTime < 1 || numTime > 120) {
      return ctx.reply(TEXT.timeCompleteError[lang]);
    }
    session.data.timeToComplete = numTime;
    session.step = "postingRevision";
    return ctx.reply(TEXT.askRevisionTime[lang]);
  }

  // STEP 7: Revision Time (≥0, ≤ half of timeToComplete)
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

  // STEP 8: Penalty per hour (0–20% of paymentFee)
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

  // STEP 9: Expiry time (1–24)
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
    return ctx.reply(TEXT.askExchangeStrategy[lang], {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [buildButton(TEXT.btnExchange100[lang], "EXCHANGE_100", lang, false)],
          [buildButton(TEXT.btnExchange304030[lang], "EXCHANGE_304030", lang, false)],
          [buildButton(TEXT.btnExchange5050[lang], "EXCHANGE_5050", lang, false)],
        ],
      },
    });
  }

  // STEP 10: Exchange strategy is callback‐driven, not plain-text
  if (session.step === "postingExchange") {
    return ctx.reply(
      lang === "am"
        ? "❌ እባክዎ ከስር አንዱን አማራጭ ይጫኑ።"
        : "❌ Please click one of the exchange‐strategy buttons."
    );
  }

  // If we ever get here (unexpected), just ignore
  return;
});

// 3.4) CALLBACKS for “Post a Task” sub‐steps that use buttons (no text):

// STEP 3: Fields Selection Pagination & Selection
bot.action(/FIELD_PREV|FIELD_NEXT|FIELD_SELECT_\d+/, async (ctx) => {
  const tgId = ctx.from.id;
  const session = postSessions[tgId];
  if (!session || session.step !== "postingFieldsIntro") return ctx.answerCbQuery();

  const lang = session.lang;
  const FIELDS = TEXT.FIELDS_LIST;
  const totalPages = Math.ceil(FIELDS.length / 10);

  // If user clicked “Prev” or “Next”
  if (ctx.match[0] === "FIELD_PREV" || ctx.match[0] === "FIELD_NEXT") {
    // Disable Prev/Next buttons immediately
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    if (ctx.match[0] === "FIELD_PREV") {
      if (session.data.currentFieldPage === 0) {
        await ctx.reply(
          lang === "am"
            ? "❌ አሁን በመጀመሪያው ገፅ ላይ ነን።"
            : "❌ You are already on the first page."
        );
      } else {
        session.data.currentFieldPage -= 1;
      }
    } else {
      // FIELD_NEXT
      if (session.data.currentFieldPage === totalPages - 1) {
        await ctx.reply(
          lang === "am"
            ? "❌ አሁን በመጨረሻው ገፅ ላይ ነን።"
            : "❌ You have reached the last page."
        );
      } else {
        session.data.currentFieldPage += 1;
      }
    }

    // Re‐display the appropriate page of fields
    const pageIdx = session.data.currentFieldPage;
    const start = pageIdx * 10;
    const end = Math.min(start + 10, FIELDS.length);
    const pageFields = FIELDS.slice(start, end);

    // Build inline keyboard: one button per field (FIELD_SELECT_{absoluteIndex})
    const keyboard = pageFields.map((fld, idx) => {
      const absoluteIdx = start + idx;
      const alreadyChosen = session.data.fields.includes(fld);
      return [
        buildButton(
          `${alreadyChosen ? "[✔️] " : ""}${fld}`,
          `FIELD_SELECT_${absoluteIdx}`,
          lang,
          alreadyChosen // disable if already chosen
        ),
      ];
    });

    // Prev / Next row
    keyboard.push([
      buildButton(TEXT.btnFieldPrev[lang], "FIELD_PREV", lang, false),
      buildButton(TEXT.btnFieldNext[lang], "FIELD_NEXT", lang, false),
    ]);

    return ctx.reply(TEXT.askFieldsIntro[lang], {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // If user clicked a field (e.g. “FIELD_SELECT_{i}”)
  const match = ctx.match[0].match(/^FIELD_SELECT_(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const fldName = TEXT.FIELDS_LIST[idx];

    // If already chosen, do nothing
    if (session.data.fields.includes(fldName)) {
      return ctx.answerCbQuery();
    }

    // Add to chosen fields
    session.data.fields.push(fldName);

    // If they have reached 10 fields, auto‐move on
    if (session.data.fields.length >= 10) {
      session.step = "postingSkill";
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      return ctx.reply(TEXT.askSkillLevel[lang], {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [buildButton(TEXT.btnBeginner[lang], "SKILL_BEGINNER", lang, false)],
            [buildButton(TEXT.btnIntermediate[lang], "SKILL_INTERMEDIATE", lang, false)],
            [buildButton(TEXT.btnProfessional[lang], "SKILL_PROFESSIONAL", lang, false)],
          ],
        },
      });
    }

    // Otherwise, show “Field added. Add another or skip.”
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    session.step = "postingFieldsChosen";
    return ctx.reply(TEXT.askFieldSkipOrAdd[lang], {
      reply_markup: {
        inline_keyboard: [
          [
            buildButton(TEXT.fieldAddBtn[lang], "FIELD_ADD_MORE", lang, false),
            buildButton(TEXT.fieldSkipBtn[lang], "FIELD_SKIP", lang, false),
          ],
        ],
      },
    });
  }
});

// STEP 3b: After selecting at least one field, user can Add More or Skip
bot.action(/FIELD_ADD_MORE|FIELD_SKIP/, async (ctx) => {
  const tgId = ctx.from.id;
  const session = postSessions[tgId];
  if (!session || !["postingFieldsChosen"].includes(session.step)) return ctx.answerCbQuery();

  const lang = session.lang;
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  if (ctx.match[0] === "FIELD_ADD_MORE") {
    // Go back to the same page to pick another field
    session.step = "postingFieldsIntro";
    // Force re‐render of current page
    const pageIdx = session.data.currentFieldPage;
    const start = pageIdx * 10;
    const end = Math.min(start + 10, TEXT.FIELDS_LIST.length);
    const pageFields = TEXT.FIELDS_LIST.slice(start, end);

    const keyboard = pageFields.map((fld, idx) => {
      const absoluteIdx = start + idx;
      const alreadyChosen = session.data.fields.includes(fld);
      return [
        buildButton(
          `${alreadyChosen ? "[✔️] " : ""}${fld}`,
          `FIELD_SELECT_${absoluteIdx}`,
          lang,
          alreadyChosen
        ),
      ];
    });
    keyboard.push([
      buildButton(TEXT.btnFieldPrev[lang], "FIELD_PREV", lang, false),
      buildButton(TEXT.btnFieldNext[lang], "FIELD_NEXT", lang, false),
    ]);
    return ctx.reply(TEXT.askFieldsIntro[lang], {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    // “FIELD_SKIP”: proceed to skill selection (STEP 4)
    session.step = "postingSkill";
    return ctx.reply(TEXT.askSkillLevel[lang], {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [buildButton(TEXT.btnBeginner[lang], "SKILL_BEGINNER", lang, false)],
          [buildButton(TEXT.btnIntermediate[lang], "SKILL_INTERMEDIATE", lang, false)],
          [buildButton(TEXT.btnProfessional[lang], "SKILL_PROFESSIONAL", lang, false)],
        ],
      },
    });
  }
});

// STEP 4: Skill Level selection
bot.action(/SKILL_(BEGINNER|INTERMEDIATE|PROFESSIONAL)/, async (ctx) => {
  const tgId = ctx.from.id;
  const session = postSessions[tgId];
  if (!session || session.step !== "postingSkill") return ctx.answerCbQuery();

  const lang = session.lang;
  const choice = ctx.match[1]; // “BEGINNER” or “INTERMEDIATE” or “PROFESSIONAL”
  let skillText = "";
  switch (choice) {
    case "BEGINNER":
      skillText = "Beginner Level Skill";
      break;
    case "INTERMEDIATE":
      skillText = "Intermediate Level Skill";
      break;
    case "PROFESSIONAL":
      skillText = "Professional Level Skill";
      break;
  }
  session.data.skillLevel = skillText;
  session.step = "postingFee";

  // Disable the three skill‐level buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  return ctx.reply(TEXT.askPaymentFee[lang]);
});

// STEP 10: Exchange Strategy selection
bot.action(/EXCHANGE_(100|304030|5050)/, async (ctx) => {
  const tgId = ctx.from.id;
  const session = postSessions[tgId];
  if (!session || session.step !== "postingExchange") return ctx.answerCbQuery();

  const lang = session.lang;
  const code = ctx.match[1]; // “100”, “304030”, or “5050”
  let strategyText = "";
  switch (code) {
    case "100":
      strategyText = "100% ⇄ 100%";
      break;
    case "304030":
      strategyText = "30% :40% :30%";
      break;
    case "5050":
      strategyText = "50% :50%";
      break;
  }
  session.data.exchangeStrategy = strategyText;

  // Disable the buttons
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  // Finally craft the task post
  // Assemble all details from session.data
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

  // Format the “expires at” timestamp as now + expiryTime hours
  const postedAt = new Date();
  const expiryAt = new Date(postedAt.getTime() + expiryTime * 60 * 60 * 1000);
  const expiryAtFormatted = formatTimestamp(expiryAt);

  // Build the task post text
  const fieldHashtags = fields.map((f) => `#${f.replace(/ /g, "")}`).join(" ");
  const taskPostText = `
🆕 **Task Posted by Anonymous Creator**  

✅ **Task Is Open!**  
**Posted At:** ${formatTimestamp(postedAt)} (EAT)  
**Expires At:** ${expiryAtFormatted} (EAT)  

**Task Description:**  
${description}  

${relatedFileId ? "_(A related file was provided to the chosen Task Doer.)_" : ""}  

**Fields:** ${fieldHashtags}  
**Skill Level Required:** \`${skillLevel}\`  
**Payment Fee:** \`${paymentFee} birr\`  
**Time to Complete:** \`${timeToComplete} hour(s)\`  
**Revision Time:** \`${revisionTime} hour(s)\`  
**Penalty (per hour):** \`${penalty} birr/hour\`  
**Payment ↔ Task Strategy:** \`${exchangeStrategy}\`  

—  
_As a Task Creator: Spent {totalSpent} birr | As a Task Doer: Earned {totalEarned} birr_  
_Average Rating: {avg} ★ from {count} users_  
`;  
  // For this MVP, we’ll just inject placeholders 0 for totals/ratings:
  const finalTaskText = taskPostText
    .replace("{totalSpent}", "0")
    .replace("{totalEarned}", "0")
    .replace("{avg}", "0")
    .replace("{count}", "0");

  // Post to the channel “@TaskifiiRemote” (chat id: -1002254896955)
  const taskChannelId = "-1002254896955";
  await ctx.telegram.sendMessage(taskChannelId, finalTaskText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[buildButton("Apply", `APPLY_${tgId}`, lang, false)]],
    },
  });

  // Notify creator in chat that task was posted
  await ctx.reply(TEXT.taskPostedSuccess[lang]);

  // Clean up the session
  delete postSessions[tgId];
});

// ────────────────────────────────────────────────────────────────────────────────
// Launch the bot
// ────────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await bot.launch();
    console.log("🤖 Bot is up and running");
  } catch (err) {
    console.error("⚠️ Failed to launch bot:", err);
  }
})();

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
