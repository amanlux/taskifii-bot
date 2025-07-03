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
   descriptionPrompt: {
    en: "Write the task description (20–1250 chars).",
    am: "የተግባሩን መግለጫ ያስገቡ። (20–1250 ቁምፊ)"
  },
  descriptionError: {
    en: "Sorry, Task Description must be 20–1250 characters. Try again.",
    am: "ይቅርታ፣ የተግባሩ መግለጫ 20–1250 ቁምፊ መሆን አለበት። እንደገና ይሞክሩ።"
  },
  relatedFilePrompt: {
    en: "Send any related file (photo, document, etc.), or click Skip.",
    am: "ማንኛውንም ተያያዥ ፋይል (ፎቶ፣ ሰነድ፣ ቪዲዮ ወዘተ) ይላኩ፣ ወይም “Skip” ይጫኑ።"
  },
  relatedFileError: {
    en: "Send a valid file (photo, document, etc.) or click Skip.",
    am: "ትክክለኛ ፋይል (ፎቶ፣ ሰነድ፣ ቪዲዮ ወዘተ) ይላኩ ወይም “Skip” ይጫኑ።"
  },
   skipBtn: {
    en: "Skip",
    am: "ዝለል"
  },
  fieldsIntro: {
    en: "Select 1–10 fields:",
    am: "1–10 መስኮች ይምረጡ:"
  },
  fieldsSelected: {
    en: "Selected:",
    am: "የተመረጡ:"
  },
  fieldsAddMore: {
    en: "Add More",
    am: "ተጨማሪ ጨምር"
  },
  fieldsDone: {
    en: "Done",
    am: "ተጠናቋል"
  },
   askSkillLevel: {
    en: "Choose skill level:",
    am: "የስልጠና ደረጃ ይምረጡ:"
  },
  skillLevelBeginner: {
    en: "Beginner",
    am: "ጀማሪ"
  },
  skillLevelIntermediate: {
    en: "Intermediate",
    am: "መካከለኛ"
  },
  skillLevelProfessional: {
    en: "Professional",
    am: "ሙያተኛ"
  },
  askPaymentFee: {
    en: "How much is the payment fee amount (in birr)? (must be ≥50)",
    am: "ክፍያው መጠን በብር ያስገቡ (ከ50 ብር አይነስ):"
  },
  paymentFeeErrorDigits: {
    en: "Please enter digits only.",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ።"
  },
  paymentFeeErrorMin: {
    en: "Amount cannot be less than 50 birr.",
    am: "መጠኑ ከ50 ብር መብለጥ አይችልም።"
  },
  askTimeToComplete: {
    en: "What's the time required in hours to complete the task? (1-120)",
    am: "ተግዳሮቱን ለመጨረስ የሚወስደው ጊዜ በሰዓት ያስገቡ (1-120)"
  },
  timeToCompleteError: {
    en: "Hours must be >0 and ≤120.",
    am: "ሰዓቶቹ ከ0 በላይ እና ≤120 መሆን አለበት።"
  },
  
  askRevisionTime: {
  en: "How many hours for revision? (Up to half of total — you can use decimals for minutes, e.g. 0.5 for 30 min)",
  am: "ለማሻሻል ስንት ሰዓት ይፈልጋሉ? (≤ ጠቅላላው ግማሽ — የደቂቃ ጊዜ ለማሳየት ከዳስማስ ቁጥሮች ጥቅም ይችላሉ፣ ለምሳሌ 0.5 ማለት 30 ደቂቃ ነው)"
  },
  revisionTimeError: {
  en: "Please send a number (decimals ok) not exceeding half of total time.",
  am: "እባክዎ ቁጥር (ዳስማስ ቁጥሮች ደግመው ይቻላሉ) ያስገቡ፣ ከጠቅላላው ጊዜ ግማሽ መብለጥ አይችልም።"
  },
  
  askPenaltyPerHour: {
    en: "Give birr amount deducted per hour if late (≤20% of fee).",
    am: "በተዘገየ ሰዓት የሚቀነስ የብር መጠን ያስገቡ (≤20% ከክፍያው)"
  },
  penaltyPerHourError: {
    en: "Cannot exceed 20% of payment fee.",
    am: "ከ20% ከክፍያው መብለጥ አይችልም።"
  },
  
  askExpiryHours: {
    en: "In how many hours does the offer expire? (1–24)",
    am: "እስከ ስንት ሰዓት ውስጥ አቅራቢያው ይቆማል? (1–24)"
  },
  expiryHoursError: {
    en: "Expiry must be between 1 and 24 hours.",
    am: "የማብቂያ ጊዜ በ1 እና 24 ሰዓታት መካከል መሆን አለበት።"
  },
  
  askExchangeStrategy: {
    en: "Choose exchange strategy:",
    am: "የክፍያ-ተግዳሮት ልውውጥ ስልት ይምረጡ:"
  },
  exchangeStrategy100: {
    en: "100%",
    am: "100%"
  },
  exchangeStrategy304030: {
    en: "30:40:30",
    am: "30:40:30"
  },
  exchangeStrategy5050: {
    en: "50:50",
    am: "50:50"
  },
  exchangeStrategyDesc100: {
    en: "100% deliver → 100% pay",
    am: "100% አቅርብ → 100% ክፍል"
  },
  exchangeStrategyDesc304030: {
    en: "30% deliver → 30% pay → 40% deliver → 40% pay → 30% deliver → 30% pay",
    am: "30% አቅርብ → 30% ክፍል → 40% አቅርብ → 40% ክፍል → 30% አቅርብ → 30% ክፍል"
  },
  exchangeStrategyDesc5050: {
    en: "50% deliver → 50% pay → 50% deliver → 50% pay",
    am: "50% አቅርብ → 50% ክፍል → 50% አቅርብ → 50% ክፍል"
  },
  digitsOnlyError: {
    en: "Please enter digits only.",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ።"
  },
  negativeError: {
    en: "Cannot be negative.",
    am: "አሉታዊ መሆን አይችልም።"
  },
  
  digitsOnlyError: {
    en: "Please enter digits only.",
    am: "እባክዎ ቁጥሮች ብቻ ያስገቡ።"  
  },
   editProfilePrompt: {
    en: "📝 Select which profile detail you'd like to edit:",
    am: "📝 ለማስተካከል የሚፈልጉትን የፕሮፋይል ዝርዝር ይምረጡ:"
  },
  editNameBtn: {
    en: "Name",
    am: "ስም"
  },
  editPhoneBtn: {
    en: "Phone",
    am: "ስልክ"
  },
  editEmailBtn: {
    en: "Email",
    am: "ኢሜይል"
  },
  editUsernameBtn: {
    en: "Username",
    am: "የተጠቃሚ ስም"
  },
  editBanksBtn: {
    en: "Bank Details",
    am: "የባንክ ዝርዝሮች"
  },
  backBtn: {
    en: "Back",
    am: "ተመለስ"
  },
  profileUpdated: {
    en: "✅ Profile updated successfully!",
    am: "✅ ፕሮፋይል ተስተካክሏል!"
  },
  editBankPrompt: {
    en: "Which bank entry would you like to edit?",
    am: "የትኛውን የባንክ መግለጫ መስተካከል ይፈልጋሉ?"
  },
  addBankBtn: {
    en: "Add New Bank",
    am: "አዲስ ባንክ ጨምር"
  },
  removeBankBtn: {
    en: "Remove Bank",
    am: "ባንክ አስወግድ"
  },
  bankEditDoneBtn: {
    en: "Done Editing Banks",
    am: "የባንክ ማስተካከል ተጠናቋል"
  },
  fieldsSelected: {
    en: "Selected:",
    am: "የተመረጡ:"
  },
   applyPitchTooShort: {
    en: "Please make sure your message is at least 20 characters!",
    am: "እባክዎን መልእክት 20 ቁምፊ በላይ እንዲሆን ያረጋግጡ።"
  },
  applyPitchTooLong: {
    en: "Please keep your message under 500 characters!",
    am: "እባክዎን መልእክት ከ500 ቁምፊ በታች እንዲሆን ያረጋግጡ።"
  },
  confirmApplyPost: {
    en: "Do you want to send this application to the task creator?",
    am: "ይህን ማመልከቻ ለተግዳሮቱ ፈጣሪ መላክ ይፈልጋሉ?"
  },
  confirmYesBtn: {
    en: "Yes",
    am: "አዎን"
  },
  confirmNoBtn: {
    en: "No",
    am: "አይ"
  },
  applySent: {
    en: "✅ Application sent to the task creator!",
    am: "✅ ማመልከቻው ለተግዳሮቱ ፈጣሪ ተልኳል!"
  },
  applyCancelled: {
    en: "Application cancelled.",
    am: "ማመልከቻው ተሰርዟል።"
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
  const lang = user?.language || "en";
  const lines = [];

  // Description
  lines.push(lang === "am" ? `*መግለጫ:* ${draft.description}` : `*Description:* ${draft.description}`);
  lines.push("");

  // Fields → hashtags
  if (draft.fields.length) {
    const tags = draft.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ");
    lines.push(lang === "am" ? `*ስራ መስኮች:* ${tags}` : `*Fields:* ${tags}`);
    lines.push("");
  }

  // Skill Level
  if (draft.skillLevel) {
    const emoji = draft.skillLevel === "Beginner"
      ? "🟢"
      : draft.skillLevel === "Intermediate"
        ? "🟡"
        : "🔴";
    const levelText = lang === "am" 
      ? draft.skillLevel === "Beginner" ? "ጀማሪ" 
        : draft.skillLevel === "Intermediate" ? "መካከለኛ" 
        : "ሙያተኛ"
      : draft.skillLevel;
    lines.push(lang === "am" 
      ? `*የሚያስፈልገው የስልጠና ደረጃ:* ${emoji} ${levelText}`
      : `*Skill Level Required:* ${emoji} ${levelText}`);
    lines.push("");
  }

  // Payment Fee
  if (draft.paymentFee != null) {
    lines.push(lang === "am" 
      ? `*የክፍያ መጠን:* ${draft.paymentFee} ብር` 
      : `*Payment Fee:* ${draft.paymentFee} birr`);
    lines.push("");
  }

  // Time to Complete
  if (draft.timeToComplete != null) {
    lines.push(lang === "am" 
      ? `*ለመጨረስ የሚፈጅበት ጊዜ:* ${draft.timeToComplete} ሰዓት(ዎች)` 
      : `*Time to Complete:* ${draft.timeToComplete} hour(s)`);
    lines.push("");
  }

  // Revision Time
  if (draft.revisionTime != null) {
    const rev = draft.revisionTime;
    const revText = lang === "am"
      ? Number.isInteger(rev)
        ? `${rev} ሰዓት(ዎች)`
        : `${Math.round(rev * 60)} ደቂቃ(ዎች)`
      : Number.isInteger(rev)
        ? `${rev} hour(s)`
        : `${Math.round(rev * 60)} minute(s)`;
    lines.push(lang === "am" 
      ? `*የማሻሻል ጊዜ:* ${revText}` 
      : `*Revision Time:* ${revText}`);
    lines.push("");
  }

  // Penalty per Hour
  if (draft.penaltyPerHour != null) {
    lines.push(lang === "am" 
      ? `*በተዘገየ ሰዓት የሚቀነስ ቅጣት:* ${draft.penaltyPerHour} ብር` 
      : `*Penalty per Hour (late):* ${draft.penaltyPerHour} birr`);
    lines.push("");
  }

  // Expiry - Show hours remaining in preview
  if (draft.expiryHours != null) {
    lines.push(lang === "am" 
      ? `*የማብቂያ ጊዜ:* ${draft.expiryHours} ሰዓት(ዎች)` 
      : `*Expires In:* ${draft.expiryHours} hour(s)`);
    lines.push("");
  }

  // Exchange Strategy
  if (draft.exchangeStrategy) {
    let desc = "";
    if (draft.exchangeStrategy === "100%") {
      desc = TEXT.exchangeStrategyDesc100[lang];
    } else if (draft.exchangeStrategy === "30:40:30") {
      desc = TEXT.exchangeStrategyDesc304030[lang];
    } else {
      desc = TEXT.exchangeStrategyDesc5050[lang];
    }
    lines.push(lang === "am" 
      ? `*የክፍያ-ተግዳሮት ልውውጥ ስልት:* ${desc}` 
      : `*Exchange Strategy:* ${desc}`);
    lines.push("");
  }

  // Banks Accepted
  if (user.bankDetails && user.bankDetails.length) {
    const names = user.bankDetails.map(b => b.bankName).join(", ");
    lines.push(lang === "am" 
      ? `*ተቀባይነት ያላቸው ባንኮች:* ${names}` 
      : `*Banks Accepted:* ${names}`);
    lines.push("");
  }

  // Creator stats
  const ratingText = user.stats.ratingCount > 0
    ? `${user.stats.averageRating.toFixed(1)} ★ (${user.stats.ratingCount} ${lang === "am" ? "ግምገማዎች" : "ratings"})`
    : `N/A ★ (0 ${lang === "am" ? "ግምገማዎች" : "ratings"})`;
  
  lines.push(lang === "am" 
    ? `*ፈጣሪ አጠቃላይ የተሰራው:* ${user.stats.totalEarned.toFixed(2)} ብር` 
    : `*Creator Total Earned:* ${user.stats.totalEarned.toFixed(2)} birr`);
  lines.push(lang === "am" 
    ? `*ፈጣሪ አጠቃላይ የተከፈለው:* ${user.stats.totalSpent.toFixed(2)} ብር` 
    : `*Creator Total Spent:* ${user.stats.totalSpent.toFixed(2)} birr`);
  lines.push(lang === "am" 
    ? `*ፈጣሪ ደረጃ:* ${ratingText}` 
    : `*Creator Rating:* ${ratingText}`);
  lines.push("");

  return lines.join("\n");
}

function buildChannelPostText(draft, user) {
  const lines = [];

  // Always use English for channel posts
  lines.push(`*Description:* ${draft.description}`);
  lines.push("");

  // Fields → hashtags
  if (draft.fields.length) {
    const tags = draft.fields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ");
    lines.push(`*Fields:* ${tags}`);
    lines.push("");
  }

  // Skill Level
  if (draft.skillLevel) {
    const emoji = draft.skillLevel === "Beginner"
      ? "🟢"
      : draft.skillLevel === "Intermediate"
        ? "🟡"
        : "🔴";
    lines.push(`*Skill Level Required:* ${emoji} ${draft.skillLevel}`);
    lines.push("");
  }

  // Payment Fee
  if (draft.paymentFee != null) {
    lines.push(`*Payment Fee:* ${draft.paymentFee} birr`);
    lines.push("");
  }

  // Time to Complete
  if (draft.timeToComplete != null) {
    lines.push(`*Time to Complete:* ${draft.timeToComplete} hour(s)`);
    lines.push("");
  }

  // Revision Time
  if (draft.revisionTime != null) {
    const rev = draft.revisionTime;
    if (Number.isInteger(rev)) {
      lines.push(`*Revision Time:* ${rev} hour(s)`);
    } else {
      const minutes = Math.round(rev * 60);
      lines.push(`*Revision Time:* ${minutes} minute(s)`);
    }
    lines.push("");
  }

  // Penalty per Hour
  if (draft.penaltyPerHour != null) {
    lines.push(`*Penalty per Hour (late):* ${draft.penaltyPerHour} birr`);
    lines.push("");
  }

  // Expiry - Show absolute time in channel post
  if (draft.expiryHours != null) {
    const expiryTs = new Date(Date.now() + draft.expiryHours * 3600 * 1000);
    const formatted = expiryTs.toLocaleString("en-US", {
      timeZone: "Africa/Addis_Ababa",
      month: "short", 
      day: "numeric", 
      year: "numeric",
      hour: "numeric", 
      minute: "2-digit", 
      hour12: true
    }) + " GMT+3";
    lines.push(`*Expires At:* ${formatted}`);
    lines.push("");
  }

  // Exchange Strategy
  if (draft.exchangeStrategy) {
    let desc = "";
    if (draft.exchangeStrategy === "100%") {
      desc = TEXT.exchangeStrategyDesc100["en"];
    } else if (draft.exchangeStrategy === "30:40:30") {
      desc = TEXT.exchangeStrategyDesc304030["en"];
    } else {
      desc = TEXT.exchangeStrategyDesc5050["en"];
    }
    lines.push(`*Exchange Strategy:* ${desc}`);
    lines.push("");
  }

  // Banks Accepted
  if (user.bankDetails && user.bankDetails.length) {
    const names = user.bankDetails.map(b => b.bankName).join(", ");
    lines.push(`*Banks Accepted:* ${names}`);
    lines.push("");
  }

  // Creator stats
  const ratingText = user.stats.ratingCount > 0
    ? `${user.stats.averageRating.toFixed(1)} ★ (${user.stats.ratingCount} ratings)`
    : `N/A ★ (0 ratings)`;
  
  lines.push(`*Creator Total Earned:* ${user.stats.totalEarned.toFixed(2)} birr`);
  lines.push(`*Creator Total Spent:* ${user.stats.totalSpent.toFixed(2)} birr`);
  lines.push(`*Creator Rating:* ${ratingText}`);
  lines.push("");

  return lines.join("\n");
}


  // Optionally include user stats (earned/spent/avg rating) if desired:
  // lines.push(`*Creator Earned:* ${user.stats.totalEarned} birr`);
 


// ------------------------------------
//  Helper: buildButton
//    - If highlighted=true, prefix with ✔ and set callbackData to a no-op
// ------------------------------------
// Always ensure buttons have text property
function buildButton(textObj, callbackData, lang, highlighted = false) {
  if (!textObj || !textObj[lang]) {
    console.error("Missing text for button:", textObj, "lang:", lang);
    return Markup.button.callback("Error", `_ERROR_${callbackData}`);
  }
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
  mongoose.set('strictQuery', false); // Add this line to suppress Mongoose warning
  const { session } = require('telegraf');
  
  // Add this session initialization middleware
  bot.use(async (ctx, next) => {
    // Initialize session if not exists
    ctx.session = ctx.session || {};
    
    // Get user from DB if not in session
    if (!ctx.session.user && ctx.from) {
      const user = await User.findOne({ telegramId: ctx.from.id });
      if (user) {
        ctx.session.user = user.toObject(); // Store the full user object
      }
    }
    
    return next();
  });
  
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
function askSkillLevel(ctx, lang = null) {
  // Get language from user if not provided
  if (!lang) {
    const user = ctx.session?.user || {};
    lang = user.language || "en";
  }
  
  return ctx.reply(
    TEXT.askSkillLevel[lang],
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.skillLevelBeginner[lang], "TASK_SKILL_Beginner")],
      [Markup.button.callback(TEXT.skillLevelIntermediate[lang], "TASK_SKILL_Intermediate")],
      [Markup.button.callback(TEXT.skillLevelProfessional[lang], "TASK_SKILL_Professional")]
    ])
  );
}
  


  // ─────────── /start Handler ───────────
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload; // This will be "apply_<taskId>" if coming from the deep link
    
    if (startPayload && startPayload.startsWith('apply_')) {
      const taskId = startPayload.split('_')[1];
      // Handle the apply flow directly
      const user = await User.findOne({ telegramId: ctx.from.id });
      const lang = user?.language || "en";
      
      // Save flow state
      ctx.session.applyFlow = { taskId, step: "awaiting_pitch" };

      // Send bilingual prompt
      const prompt = lang === "am"
        ? "እባክዎ ዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
        : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
      return ctx.reply(prompt);
    } else {
      // Original onboarding flow
      const tgId = ctx.from.id;
      let user = await User.findOne({ telegramId: tgId });

      if (user) {
        // Reset all fields
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
    }
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
  // ─────────── Skip if in task flow ───────────
  if (ctx.session?.taskFlow) {
    return next();
  }

  const tgId = ctx.from.id;
  const text = ctx.message.text.trim();
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return;

  // ─────────── Handle profile editing ───────────
  if (ctx.session?.editing?.field) {
    // Handle name editing
    // In the text handler for name editing:
    
    if (ctx.session.editing.field === "fullName") {
      // Validate name (same rules as onboarding)
      if (text.length < 3) {
        return ctx.reply(user.language === "am" ? TEXT.fullNameError.am : TEXT.fullNameError.en);
      }

      // Update name
      const countSame = await User.countDocuments({ fullName: text });
      user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;
      
      // Refresh the user document to ensure we have the latest data
      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });
      
      console.log(`Editing name for user ${updatedUser._id}, adminMessageId: ${updatedUser.adminMessageId}`);

      try {
        // Update admin channel post
        await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId);
      } catch (err) {
        console.error("Failed to update admin profile post:", err);
        // Continue with profile update even if admin channel update fails
      }

      // Send success confirmation
      await ctx.reply(TEXT.profileUpdated[user.language]);

      // Build profile WITHOUT congratulations
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      // Send new profile message WITHOUT congratulations
      await ctx.reply(buildProfileText(user, false), menu);

      // Clear editing session
      delete ctx.session.editing;
      return;
    }
    // Handle phone editing
        // In the text handler for phone editing:
    if (ctx.session.editing.field === "phone") {
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
      
      // Save and refresh user
      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });
      
      try {
        // Update admin channel post
        await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId);
      } catch (err) {
        console.error("Failed to update admin profile post:", err);
      }

      // Send success confirmation
      await ctx.reply(TEXT.profileUpdated[user.language]);

      // Build profile WITHOUT congratulations
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      // Send new profile message WITHOUT congratulations
      await ctx.reply(buildProfileText(user, false), menu);

      // Clear editing session
      delete ctx.session.editing;
      return;
    }
    // Handle email editing
        // In the text handler for email editing:
    if (ctx.session.editing.field === "email") {
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
      
      // Save and refresh user
      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });
      
      try {
        // Update admin channel post
        await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId);
      } catch (err) {
        console.error("Failed to update admin profile post:", err);
      }

      // Send success confirmation
      await ctx.reply(TEXT.profileUpdated[user.language]);

      // Build profile WITHOUT congratulations
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      // Send new profile message WITHOUT congratulations
      await ctx.reply(buildProfileText(user, false), menu);

      // Clear editing session
      delete ctx.session.editing;
      return;
    }

    // Handle username editing (typed override)
        // In the text handler for username editing:
        // In the text handler for username editing:
    if (ctx.session.editing.field === "username") {
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

      // Mark that username was provided to disable "Yes, keep it" button
      ctx.session.usernameProvided = true;

      // Disable the "Yes, keep it" button from the previous message
      try {
        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          ctx.message.message_id - 1,
          null,
          {
            inline_keyboard: [[
              Markup.button.callback(
                user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
                "_DISABLED_USERNAME_KEEP_EDIT"
              )
            ]]
          }
        );
      } catch (err) {
        console.error("Failed to edit message reply markup:", err);
      }

      // Store the new username in session without saving yet
      ctx.session.newUsername = reply;
      
      // Ask for confirmation
      return ctx.reply(
        user.language === "am" 
          ? `ይህን አዲስ የተጠቃሚ ስም ለመቀበል ይፈቅዳሉ? @${reply}`
          : `Do you want to keep this new username? @${reply}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(user.language === "am" ? "አዎን" : "Yes", "CONFIRM_NEW_USERNAME"),
            Markup.button.callback(user.language === "am" ? "አይ" : "No", "CANCEL_NEW_USERNAME")
          ]
        ])
      );
    }

    // Handle bank editing
    if (ctx.session.editing.field === "bankFirst" || 
        ctx.session.editing.field === "bankAdding" || 
        ctx.session.editing.field === "bankReplacing") {
      const bankRegex = /^[A-Za-z ]+,\d+$/;
      if (!bankRegex.test(text)) {
        return ctx.reply(
          user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en
        );
      }
      
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      
      if (ctx.session.editing.field === "bankReplacing" && ctx.session.editing.bankIndex !== undefined) {
        // Replace existing bank entry
        user.bankDetails[ctx.session.editing.bankIndex] = { bankName, accountNumber: acctNum };
      } else {
        // Add new bank entry
        user.bankDetails.push({ bankName, accountNumber: acctNum });
      }
      
      await user.save();
      
      // Send success confirmation
      await ctx.reply(TEXT.profileUpdated[user.language]);
      
      // Update admin channel
      await updateAdminProfilePost(ctx, user, ctx.session.editing.adminMessageId);
      
      // Return to bank edit menu
      const bankButtons = user.bankDetails.map((bank, index) => {
        return [Markup.button.callback(
          `${index + 1}. ${bank.bankName} (${bank.accountNumber})`, 
          `EDIT_BANK_${index}`
        )];
      });

      bankButtons.push([
        Markup.button.callback(TEXT.addBankBtn[user.language], "ADD_BANK"),
        Markup.button.callback(TEXT.removeBankBtn[user.language], "REMOVE_BANK")
      ]);
      bankButtons.push([
        Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "BANK_EDIT_DONE")
      ]);

      return ctx.reply(
        TEXT.editBankPrompt[user.language],
        Markup.inlineKeyboard(bankButtons)
      );
    }
  }

  // ─────────── Original Onboarding Flow ───────────
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

    // Disable the "Yes, keep it" button from the previous message
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

    // Otherwise show "Add / Replace / Done" buttons
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

  // ─── TERMS REVIEW (if user clicked "Disagree" and chooses to review) ─────
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

  // Highlight "Yes I am"; disable "No I'm not"
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [[
      Markup.button.callback(`✔ ${TEXT.ageYesBtn[user.language]}`, `_DISABLED_AGE_YES`),
      Markup.button.callback(`${TEXT.ageNoBtn[user.language]}`, `_DISABLED_AGE_NO`)
    ]]
  });

  user.onboardingStep = "completed";
  
  // Build and send user profile WITH congratulations
  const menu = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
    [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
    [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
  ]);
  
  // Send profile WITH congratulations (showCongrats = true)
  await ctx.reply(buildProfileText(user, true), menu);

  // Send new post to Admin Channel with 4 buttons
  const adminText = buildAdminProfileText(user);
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

  try {
    const ADMIN_CHANNEL = "-1002310380363"; // Make sure this is correct
    const sentMessage = await ctx.telegram.sendMessage(
      ADMIN_CHANNEL,
      adminText,
      { 
        parse_mode: "Markdown", 
        reply_markup: adminButtons.reply_markup 
      }
    );
    
    // Store admin message ID for future edits
    user.adminMessageId = sentMessage.message_id;
    await user.save(); // Make sure to save after setting adminMessageId
    
    console.log(`Saved adminMessageId ${sentMessage.message_id} for user ${user._id}`);
  } catch (err) {
    console.error("Failed to send admin message:", err);
    await ctx.reply("Profile created, but failed to notify admin. Please contact support.");
  }
  });

// In the text handler for name editing:

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
// ─────────── POST_TASK (start draft flow) ───────────
bot.action("POST_TASK", async (ctx) => {
  await ctx.answerCbQuery();
  
  // Initialize session properly
  ctx.session = ctx.session || {};
  ctx.session.user = ctx.session.user || {};
  
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found. Please /start again.");
  
  // Ensure taskFlow exists
  ctx.session.taskFlow = ctx.session.taskFlow || {};
  ctx.session.taskFlow.step = "description";
  
  // Edit the existing message to show disabled buttons - STACKED VERTICALLY
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [Markup.button.callback(`✔ ${TEXT.postTaskBtn[user.language]}`, "_DISABLED_POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn[user.language], "_DISABLED_FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn[user.language], "_DISABLED_EDIT_PROFILE")]
    ]
  });

  // Remove any existing draft and create new one
  await TaskDraft.findOneAndDelete({ creatorTelegramId: ctx.from.id });
  const draft = await TaskDraft.create({ creatorTelegramId: ctx.from.id });

  // Initialize task flow with user data
  ctx.session.taskFlow = {
    step: "description",
    draftId: draft._id.toString()
  };

  const prompt = TEXT.descriptionPrompt[user.language];
  return ctx.reply(prompt);
});
bot.action("APPLY_CONFIRM_YES", async (ctx) => {
  await ctx.answerCbQuery();
  const applyFlow = ctx.session?.applyFlow;
  if (!applyFlow) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found.");

  const lang = user.language || "en";
  const task = await Task.findById(applyFlow.taskId);
  if (!task) {
    delete ctx.session.applyFlow;
    return ctx.reply(lang === "am" 
      ? "❌ ይህ ተግዳሮት ከማግኘት አልቋል።" 
      : "❌ This task is no longer available.");
  }

  // Get the task creator
  const creator = await User.findById(task.creator);
  if (!creator) {
    delete ctx.session.applyFlow;
    return ctx.reply(lang === "am" 
      ? "❌ የተግዳሮቱ ፈጣሪ አልተገኙም።" 
      : "❌ Task creator not found.");
  }

  // Build the application post
  const applicantName = user.fullName || `@${user.username}` || "Anonymous";
  
  // Get top 5 most frequent task fields (or all if less than 5)
  const topFields = user.stats.fieldStats 
    ? Object.entries(user.stats.fieldStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field]) => field)
    : [];
  
  const fieldsText = topFields.length > 0 
    ? topFields.map(f => `#${f.replace(/\s+/g, "")}`).join(" ")
    : lang === "am" ? "ምንም የተመረጡ መስኮች የሉም" : "No selected fields";

  const ratingText = user.stats.ratingCount > 0
    ? `${user.stats.averageRating.toFixed(1)} ★ (${user.stats.ratingCount} ${lang === "am" ? "ግምገማዎች" : "ratings"})`
    : `N/A ★ (0 ${lang === "am" ? "ግምገማዎች" : "ratings"})`;

  const banksText = user.bankDetails && user.bankDetails.length
    ? user.bankDetails.map(b => b.bankName).join(", ")
    : lang === "am" ? "ምንም ባንኮች የሉም" : "No banks";

  const applyText = lang === "am" 
    ? `📩 አዲስ አመልካች ለተግዳሮትዎ!\n\n` +
      `ተግዳሮት: ${task.description.substring(0, 50)}...\n\n` +
      `አመልካች: ${applicantName}\n` +
      `የተሰሩ ተግዳሮቶች: ${user.stats.tasksCompleted || 0}\n` +
      `የተሰሩ መስኮች: ${fieldsText}\n` +
      `ደረጃ: ${ratingText}\n` +
      `ባንኮች: ${banksText}\n` +
      `ጠቅላላ የተሰሩ ብር: ${user.stats.totalEarned.toFixed(2)} ብር\n\n` +
      `መልእክት: ${applyFlow.pitch.substring(0, 200)}...`
    : `📩 New applicant for your task!\n\n` +
      `Task: ${task.description.substring(0, 50)}...\n\n` +
      `Applicant: ${applicantName}\n` +
      `Tasks Completed: ${user.stats.tasksCompleted || 0}\n` +
      `Top Fields: ${fieldsText}\n` +
      `Rating: ${ratingText}\n` +
      `Banks: ${banksText}\n` +
      `Total Earned: ${user.stats.totalEarned.toFixed(2)} birr\n\n` +
      `Message: ${applyFlow.pitch.substring(0, 200)}...`;

  // Send to task creator with Accept/Decline buttons
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        lang === "am" ? "መቀበል" : "Accept", 
        `APPLY_ACCEPT_${task._id}_${user._id}`
      ),
      Markup.button.callback(
        lang === "am" ? "አለመቀበል" : "Decline", 
        `APPLY_DECLINE_${task._id}_${user._id}`
      )
    ]
  ]);

  try {
    // Send to task creator
    await ctx.telegram.sendMessage(
      creator.telegramId,
      applyText,
      { 
        parse_mode: "Markdown",
        reply_markup: buttons.reply_markup 
      }
    );

    // Confirm to applicant
    await ctx.reply(TEXT.applySent[lang]);
  } catch (err) {
    console.error("Failed to send application:", err);
    await ctx.reply(
      lang === "am" 
        ? "❌ ማመልከቻውን ለመላክ አልተቻለም። እባክዎ ቆይተው እንደገና ይሞክሩ።"
        : "❌ Failed to send application. Please wait and try again."
    );
  }

  delete ctx.session.applyFlow;
});

bot.action("APPLY_CONFIRM_NO", async (ctx) => {
  await ctx.answerCbQuery();
  const lang = ctx.session.user?.language || "en";
  delete ctx.session.applyFlow;
  return ctx.reply(TEXT.applyCancelled[lang]);
});
bot.action(/^APPLY_ACCEPT_(.+)_(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const [taskId, applicantId] = ctx.match.slice(1);
  const task = await Task.findById(taskId);
  const applicant = await User.findById(applicantId);
  const creator = await User.findOne({ telegramId: ctx.from.id });

  if (!task || !applicant || !creator) {
    return ctx.reply("Error processing application.");
  }

  const lang = creator.language || "en";

  // Update task status and selected applicant
  task.status = "In Progress";
  task.selectedApplicant = applicantId;
  await task.save();

  // Notify applicant
  const applicantLang = applicant.language || "en";
  const notificationText = applicantLang === "am"
    ? `🎉 ማመልከቻዎ ተቀባይነት አግኝቷል!\n\n` +
      `ተግዳሮት: ${task.description.substring(0, 50)}...\n\n` +
      `አሁን ከተግዳሮቱ ፈጣሪ ጋር በቀጥታ መስራት ይችላሉ።`
    : `🎉 Your application has been accepted!\n\n` +
      `Task: ${task.description.substring(0, 50)}...\n\n` +
      `You can now work directly with the task creator.`;

  try {
    await ctx.telegram.sendMessage(
      applicant.telegramId,
      notificationText,
      { parse_mode: "Markdown" }
    );

    // Edit original message to show accepted
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          lang === "am" ? "✔ ተቀብሏል" : "✔ Accepted",
          "_DISABLED_APPLY_ACCEPTED"
        )
      ]]
    });
  } catch (err) {
    console.error("Failed to notify applicant:", err);
  }
});

bot.action(/^APPLY_DECLINE_(.+)_(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const [taskId, applicantId] = ctx.match.slice(1);
  const task = await Task.findById(taskId);
  const applicant = await User.findById(applicantId);

  if (!task || !applicant) {
    return ctx.reply("Error processing application.");
  }

  const lang = ctx.session.user?.language || "en";

  // Notify applicant
  const applicantLang = applicant.language || "en";
  const notificationText = applicantLang === "am"
    ? `❌ ማመልከቻዎ አልተቀበለም።\n\n` +
      `ተግዳሮት: ${task.description.substring(0, 50)}...\n\n` +
      `ለሌሎች አጋጣሚዎች ዝግጁ ይሁኑ።`
    : `❌ Your application was declined.\n\n` +
      `Task: ${task.description.substring(0, 50)}...\n\n` +
      `Be ready for other opportunities.`;

  try {
    await ctx.telegram.sendMessage(
      applicant.telegramId,
      notificationText,
      { parse_mode: "Markdown" }
    );

    // Edit original message to show declined
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          lang === "am" ? "✔ አልተቀበለም" : "✔ Declined",
          "_DISABLED_APPLY_DECLINED"
        )
      ]]
    });
  } catch (err) {
    console.error("Failed to notify applicant:", err);
  }
});
//  ➤ 1st step: catch Apply button clicks

bot.action(/^APPLY_(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  try {
    await ctx.telegram.sendMessage(
      ctx.from.id,
      lang === "am" 
        ? "ወደ አመልካች ሂደት እየተዛወርክ ነው..." 
        : "Redirecting you to the application process..."
    );
    
    await ctx.telegram.sendMessage(
      ctx.from.id,
      `/start apply_${taskId}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Failed to redirect user:", err);
    const deepLink = `/apply_${taskId}`;
    await ctx.telegram.sendMessage(
      ctx.from.id,
      lang === "am"
        ? `ግባብን ለመጀመር፤ እባክዎ ይጻፉ: ${deepLink}`
        : `To start your application, please send: ${deepLink}`
    );
  }
});
//  ➤ 2nd step: when user sends /apply_<taskId>, ask for their 20–500-char pitch
bot.hears(/^\/apply_(.+)$/, async ctx => {
  const taskId = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("Please complete your profile first with /start");

  const lang = user.language || "en";
  const task = await Task.findById(taskId);
  if (!task) {
    return ctx.reply(lang === "am" 
      ? "❌ ይህ ተግዳሮት ከማግኘት አልቋል።" 
      : "❌ This task is no longer available.");
  }

  // Initialize application flow
  ctx.session.applyFlow = {
    taskId,
    step: "awaiting_pitch",
    taskMessageId: ctx.message?.message_id
  };

  const prompt = lang === "am"
    ? "እባክዎ ለዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
    : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
  
  return ctx.reply(prompt);
});

// ─────────── “Edit Task” Entry Point ───────────
bot.action("TASK_EDIT", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}

  // Fetch the draft
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }

  // Get user's language
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  // Mark that we're in edit-mode
  ctx.session.taskFlow = {
    isEdit: true,
    draftId: draft._id.toString(),
    step: null
  };

  // Present the list of fields that can be edited (in user's language)
  const buttons = [
    [Markup.button.callback(lang === "am" ? "✏️ መግለጫ አርትዕ" : "✏️ Edit Description", "EDIT_description")],
    [Markup.button.callback(lang === "am" ? "📎 ተያያዥ ፋይል አርትዕ" : "📎 Edit Related File", "EDIT_relatedFile")],
    [Markup.button.callback(lang === "am" ? "🏷️ መስኮች አርትዕ" : "🏷️ Edit Fields", "EDIT_fields")],
    [Markup.button.callback(lang === "am" ? "🎯 የስልጠና ደረጃ አርትዕ" : "🎯 Edit Skill Level", "EDIT_skillLevel")],
    [Markup.button.callback(lang === "am" ? "💰 የክፍያ መጠን አርትዕ" : "💰 Edit Payment Fee", "EDIT_paymentFee")],
    [Markup.button.callback(lang === "am" ? "⏳ የማጠናቀቂያ ጊዜ አርትዕ" : "⏳ Edit Time to Complete", "EDIT_timeToComplete")],
    [Markup.button.callback(lang === "am" ? "🔄 የማሻሻል ጊዜ አርትዕ" : "🔄 Edit Revision Time", "EDIT_revisionTime")],
    [Markup.button.callback(lang === "am" ? "⏱️ በሰዓት ቅጣት አርትዕ" : "⏱️ Edit Penalty per Hour", "EDIT_penaltyPerHour")],
    [Markup.button.callback(lang === "am" ? "⌛ የማብቂያ ጊዜ አርትዕ" : "⌛ Edit Expiry Hours", "EDIT_expiryHours")],
    [Markup.button.callback(lang === "am" ? "🔀 የልውውጥ ስልት አርትዕ" : "🔀 Edit Exchange Strat.", "EDIT_exchangeStrategy")]
  ];

  return ctx.reply(
    lang === "am" ? "ለመስተካከል የሚፈልጉትን የተግዳሮቱን ክፍል ይምረጡ:" : "Select which piece of the task you'd like to edit:",
    Markup.inlineKeyboard(buttons)
  );
});


bot.on(['text','photo','document','video','audio'], async (ctx, next) => {
  // Check if this is part of an application flow
  if (ctx.session?.applyFlow?.step === "awaiting_pitch") {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";

    // extract text (message text or caption)
    let text = (ctx.message.text || "").trim();
    if (!text && ctx.message.caption) text = ctx.message.caption.trim();

    // validation
    if (!text || text.length < 20) {
      const err = lang === "am"
        ? TEXT.applyPitchTooShort.am
        : TEXT.applyPitchTooShort.en;
      return ctx.reply(err);
    }
    if (text.length > 500) {
      const err = lang === "am"
        ? TEXT.applyPitchTooLong.am
        : TEXT.applyPitchTooLong.en;
      return ctx.reply(err);
    }

    // Store the pitch and any attachments in session
    ctx.session.applyFlow.pitch = text;
    ctx.session.applyFlow.attachment = ctx.message.photo?.[0]?.file_id || 
                                      ctx.message.document?.file_id ||
                                      ctx.message.video?.file_id ||
                                      ctx.message.audio?.file_id;
    ctx.session.applyFlow.step = "confirm_send";

    // Ask for confirmation to send
    return ctx.reply(
      TEXT.confirmApplyPost[lang],
      Markup.inlineKeyboard([
        [
          Markup.button.callback(TEXT.confirmYesBtn[lang], "APPLY_CONFIRM_YES"),
          Markup.button.callback(TEXT.confirmNoBtn[lang], "APPLY_CONFIRM_NO")
        ]
      ])
    );
  }
  // Original task flow handling
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
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  if (!text || text.length < 20 || text.length > 1250) {
    return ctx.reply(TEXT.descriptionError[lang]);
  }

  draft.description = text;
  await draft.save();

  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ መግለጫው ተዘምኗል" : "✅ Description updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  ctx.session.taskFlow.step = "relatedFile";
  const relPrompt = await ctx.reply(
    TEXT.relatedFilePrompt[lang],
    Markup.inlineKeyboard([[ 
      Markup.button.callback(TEXT.skipBtn[lang], "TASK_SKIP_FILE") 
    ]])
  );
  ctx.session.taskFlow.relatedFilePromptId = relPrompt.message_id;
  return;
}
bot.action("TASK_SKIP_FILE", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }
  
  const promptId = ctx.session.taskFlow.relatedFilePromptId;

  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      promptId,
      undefined,
      {
        inline_keyboard: [[
          Markup.button.callback(`✔ ${TEXT.skipBtn[lang]}`, "_DISABLED_SKIP")
        ]]
      }
    );
  } catch (err) {
    console.error("Failed to edit message reply markup:", err);
  }

  // Clear any related file that might have been set
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (draft) {
    draft.relatedFile = undefined;
    await draft.save();
  }

  // In edit mode, return to preview instead of proceeding to fields
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ ተያያዥ ፋይል ተዘምኗል" : "✅ Related file updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  // Original behavior for non-edit flow
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
});


bot.on("message", async ctx => {
  const flow = ctx.session.applyFlow;
  if (!flow || flow.step !== "awaiting_pitch") return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  // extract text (message text or caption)
  let text = (ctx.message.text || "").trim();
  if (!text && ctx.message.caption) text = ctx.message.caption.trim();

  // validation
  if (!text || text.length < 20) {
    const err = lang === "am"
      ? "እባክዎን መልእክት 20 ቁምፊ በላይ እንዲሆን ያረጋግጡ።"
      : "Please make sure it is greater than 20 characters!";
    return ctx.reply(err);
  }
  if (text.length > 500) {
    const err = lang === "am"
      ? "እባክዎን መልእክት ከ500 ቁምፊ በታች እንዲሆን ያረጋግጡ።"
      : "Please make sure it is less than 500 characters!";
    return ctx.reply(err);
  }

  // Passed validation
  flow.pitch = text;
  // optionally capture file_id if there was media
  if (ctx.message.photo) {
    flow.attachment = ctx.message.photo.slice(-1)[0].file_id;
  } else if (ctx.message.document) {
    flow.attachment = ctx.message.document.file_id;
  }
  // mark complete for now
  delete ctx.session.applyFlow;

  // Acknowledge
  const replyOk = lang === "am"
    ? "✅ መልእክትዎ ተቀበልናል።"
    : "✅ Got it! Your application message has been saved.";
  await ctx.reply(replyOk);

  // Next steps: you can now combine flow.pitch and flow.attachment into your final apply post...
});



async function handleRelatedFile(ctx, draft) {
  // Get user for language
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }
  
  const promptId = ctx.session.taskFlow.relatedFilePromptId;

  // 1) Determine file type and ID
  let fileId, fileType;
  if (ctx.message.photo) {
    const photos = ctx.message.photo;
    fileId = photos[photos.length - 1].file_id;
    fileType = "photo";
  } else if (ctx.message.document) {
    fileId = ctx.message.document.file_id;
    fileType = "document";
  } else if (ctx.message.video) {
    fileId = ctx.message.video.file_id;
    fileType = "video";
  } else if (ctx.message.audio) {
    fileId = ctx.message.audio.file_id;
    fileType = "audio";
  } else {
    return ctx.reply(TEXT.relatedFileError[lang]);
  }

  // 2) Save the related file info to the draft
  draft.relatedFile = { fileId, fileType };
  await draft.save();

  // 3) Update the original "related file" prompt to disable skip button
  // BUT DON'T HIGHLIGHT IT since it wasn't clicked
  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      promptId,
      undefined,
      {
        inline_keyboard: [[
          Markup.button.callback(TEXT.skipBtn[lang], "_DISABLED_SKIP") // No checkmark prefix
        ]]
      }
    );
  } catch (err) {
    console.error("Failed to edit message reply markup:", err);
  }

  // Rest of the function remains the same...
  // If in edit‐mode, show updated preview
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ ተያያዥ ፋይል ተዘምኗል" : "✅ Related file updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  // Move on to next step for non-edit flow
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
}


function askFieldsPage(ctx, page) {
  const user = ctx.session?.user || {};
  const lang = user.language || "en"; // Get language from user session
  const start = page * FIELDS_PER_PAGE;
  const end = Math.min(start + FIELDS_PER_PAGE, ALL_FIELDS.length);
  const keyboard = [];
  
  for (let i = start; i < end; i++) {
    const f = ALL_FIELDS[i];
    keyboard.push([Markup.button.callback(f, `TASK_FIELD_${i}`)]);
  }
  
  const nav = [];
  if (page > 0) {
    nav.push(Markup.button.callback("⬅️ " + (lang === "am" ? "ቀዳሚ" : "Prev"), `TASK_FIELDS_PAGE_${page-1}`));
  }
  if (end < ALL_FIELDS.length) {
    nav.push(Markup.button.callback(lang === "am" ? "ቀጣይ ➡️" : "Next ➡️", `TASK_FIELDS_PAGE_${page+1}`));
  }
  if (nav.length) keyboard.push(nav);
  
  return ctx.reply(
    TEXT.fieldsIntro[lang], // Use the correct language
    Markup.inlineKeyboard(keyboard)
  );
}

bot.action(/TASK_FIELD_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const idx = parseInt(ctx.match[1]);
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "ረቂቁ ጊዜው አልፎታል" : "Draft expired.");
  }
  
  const field = ALL_FIELDS[idx];
  if (!draft.fields.includes(field)) {
    draft.fields.push(field);
    await draft.save();
  }

  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  try { await ctx.deleteMessage(); } catch(_) {}
  
  return ctx.reply(
    `${TEXT.fieldsSelected[lang]} ${draft.fields.join(", ")}`,
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.fieldsAddMore[lang], `TASK_FIELDS_PAGE_0`)],
      [Markup.button.callback(TEXT.fieldsDone[lang], "TASK_FIELDS_DONE")]
    ])
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
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft || !draft.fields.length) {
    return ctx.reply(lang === "am" ? "ቢያንስ አንድ መስክ ይምረጡ" : "Select at least one field before proceeding.");
  }

  // Edit the message to show selections with vertical buttons
  await ctx.editMessageText(
    `${TEXT.fieldsSelected[lang]} ${draft.fields.join(", ")}`,
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.fieldsAddMore[lang], "_DISABLED_ADD_MORE")],
      [Markup.button.callback(`✔ ${TEXT.fieldsDone[lang]}`, "_DISABLED_DONE")]
    ])
  );

  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ መስኮች ተዘምነዋል" : "✅ Fields updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  // Ensure taskFlow exists in session
  ctx.session.taskFlow = ctx.session.taskFlow || {};
  ctx.session.taskFlow.step = "skillLevel";
  
  return askSkillLevel(ctx, lang);
});
bot.action(/TASK_SKILL_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const lvl = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found.");
  
  const lang = user.language || "en";
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply(lang === "am" ? "ረቂቁ ጊዜው አልፎታል" : "Draft expired.");

  // Highlight selected button and disable all
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [
        Markup.button.callback(
          lvl === "Beginner" ? `✔ ${TEXT.skillLevelBeginner[lang]}` : TEXT.skillLevelBeginner[lang],
          "_DISABLED_SKILL_Beginner"
        )
      ],
      [
        Markup.button.callback(
          lvl === "Intermediate" ? `✔ ${TEXT.skillLevelIntermediate[lang]}` : TEXT.skillLevelIntermediate[lang],
          "_DISABLED_SKILL_Intermediate"
        )
      ],
      [
        Markup.button.callback(
          lvl === "Professional" ? `✔ ${TEXT.skillLevelProfessional[lang]}` : TEXT.skillLevelProfessional[lang],
          "_DISABLED_SKILL_Professional"
        )
      ]
    ]
  });

  draft.skillLevel = lvl;
  await draft.save();

  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ የስልጠና ደረጃ ተዘምኗል" : "✅ Skill level updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  // Ensure taskFlow exists in session
  ctx.session.taskFlow = ctx.session.taskFlow || {};
  ctx.session.taskFlow.step = "paymentFee";
  
  return ctx.reply(TEXT.askPaymentFee[lang]);
});


async function handlePaymentFee(ctx, draft) {
  const text = ctx.message.text?.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  if (!/^\d+$/.test(text)) {
    return ctx.reply(TEXT.paymentFeeErrorDigits[lang]);
  }
  const val = parseInt(text,10);
  if (val < 50) {
    return ctx.reply(TEXT.paymentFeeErrorMin[lang]);
  }
  draft.paymentFee = val;
  await draft.save();
  
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ የክፍያ መጠን ተዘምኗል" : "✅ Payment fee updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  
  ctx.session.taskFlow.step = "timeToComplete";
  return ctx.reply(TEXT.askTimeToComplete[lang]);
}

async function handleTimeToComplete(ctx, draft) {
  const text = ctx.message.text?.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en"; 
  
  if (!/^\d+$/.test(text)) {
    return ctx.reply(TEXT.digitsOnlyError[lang]);
  }

  const hrs = parseInt(text,10);
  if (hrs <=0 || hrs>120) {
    return ctx.reply(TEXT.timeToCompleteError[lang]); 
  }
  draft.timeToComplete = hrs;
  await draft.save();
  
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ የስራ ጊዜ ተዘምኗል" : "✅ Time to complete updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  
  ctx.session.taskFlow.step = "revisionTime";
  return ctx.reply(TEXT.askRevisionTime[lang]); 
}

async function handleRevisionTime(ctx, draft) {
  const input = ctx.message.text?.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  // Parse as float
  const revHours = parseFloat(input);
  if (isNaN(revHours) || revHours < 0 || revHours > draft.timeToComplete / 2) {
    return ctx.reply(TEXT.revisionTimeError[lang]);
  }

  draft.revisionTime = revHours;
  await draft.save();

  // If in edit‐mode, show updated preview
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am"
      ? "✅ የማሻሻል ጊዜ ተመዘገበ።"
      : "✅ Revision time updated.");

    const updated = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user    = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updated, user),
      Markup.inlineKeyboard([
        [ Markup.button.callback(lang==="am"?"ተግዳሮት አርትዕ":"Edit Task", "TASK_EDIT") ],
        [ Markup.button.callback(lang==="am"?"ተግዳሮት ልጥፍ":"Post Task", "TASK_POST_CONFIRM") ]
      ], { parse_mode: "Markdown" })
    );

    ctx.session.taskFlow = null;
    return;
  }

  // Move on to next step
  ctx.session.taskFlow.step = "penaltyPerHour";
  return ctx.reply(TEXT.askPenaltyPerHour[lang]);
}

async function handlePenaltyPerHour(ctx, draft) {
  const text = ctx.message.text?.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!/^\d+$/.test(text)) {
  return ctx.reply(TEXT.digitsOnlyError[lang]);
  }
  const pen = parseInt(text,10);
  if (pen < 0) return ctx.reply(TEXT.negativeError[lang]);
  if (draft.paymentFee != null && pen > 0.2 * draft.paymentFee) {
    return ctx.reply(TEXT.penaltyPerHourError[lang]); // Use translation
  }
  draft.penaltyPerHour = pen;
  await draft.save();
  
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ የቅጣት መጠን ተዘምኗል" : "✅ Penalty per hour updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  
  ctx.session.taskFlow.step = "expiryHours";
  return ctx.reply(TEXT.askExpiryHours[lang]); // Use translation
}

async function handleExpiryHours(ctx, draft) {
  const text = ctx.message.text?.trim();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!/^\d+$/.test(text)) {
    return ctx.reply(TEXT.digitsOnlyError[lang]); // Now using translated version
  }
  const hrs = parseInt(text,10);
  if (hrs < 1 || hrs > 24) {
    return ctx.reply(TEXT.expiryHoursError[lang]); // Use translation
  }
  draft.expiryHours = hrs;
  await draft.save();
  
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ የማብቂያ ጊዜ ተዘምኗል" : "✅ Expiry time updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }
  
  ctx.session.taskFlow.step = "exchangeStrategy";
  return ctx.reply(
    TEXT.askExchangeStrategy[lang], // Use translation
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.exchangeStrategy100[lang], "TASK_EX_100%")],
      [Markup.button.callback(TEXT.exchangeStrategy304030[lang], "TASK_EX_30:40:30")],
      [Markup.button.callback(TEXT.exchangeStrategy5050[lang], "TASK_EX_50:50")]
    ])
  );
}


async function updateAdminProfilePost(ctx, user, adminMessageId) {
  const ADMIN_CHANNEL = "-1002310380363"; // Make sure this is correct
  const messageId = adminMessageId || user.adminMessageId;
  
  if (!messageId) {
    console.error("No adminMessageId found for user:", user._id);
    // Fallback: Send a new message and store its ID
    try {
      const adminText = buildAdminProfileText(user);
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

      const sent = await ctx.telegram.sendMessage(
        ADMIN_CHANNEL,
        adminText,
        { parse_mode: "Markdown", reply_markup: adminButtons.reply_markup }
      );
      
      user.adminMessageId = sent.message_id;
      await user.save();
      console.log(`Created new admin message ${sent.message_id} for user ${user._id}`);
      return sent;
    } catch (err) {
      console.error("Failed to create new admin message:", err);
      throw new Error("Failed to create new admin message");
    }
  }

  // Update existing message
  const adminText = buildAdminProfileText(user);
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

  console.log(`Attempting to update admin message ${messageId} for user ${user._id}`);
  
  try {
    const result = await ctx.telegram.editMessageText(
      ADMIN_CHANNEL,
      messageId,
      null,
      adminText,
      { parse_mode: "Markdown", reply_markup: adminButtons.reply_markup }
    );
    console.log("Successfully updated admin message");
    return result;
  } catch (err) {
    console.error("Failed to edit admin message:", err.message);
    
    // If the message is too old to edit, send a new one and delete the old
    if (err.description.includes("message to edit not found") || 
        err.description.includes("message is too old")) {
      console.log("Message too old, sending new one");
      
      // Send new message
      const sent = await ctx.telegram.sendMessage(
        ADMIN_CHANNEL,
        adminText,
        { parse_mode: "Markdown", reply_markup: adminButtons.reply_markup }
      );
      
      // Try to delete the old message if it exists
      if (messageId) {
        try {
          await ctx.telegram.deleteMessage(ADMIN_CHANNEL, messageId);
          console.log("Deleted old admin message");
        } catch (deleteErr) {
          console.error("Failed to delete old admin message:", deleteErr.message);
        }
      }
      
      // Update user with new message ID
      user.adminMessageId = sent.message_id;
      await user.save();
      return sent;
    }
    
    throw err; // Re-throw other errors
  }
}




bot.action(/TASK_EX_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const strat = ctx.match[1];
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) return ctx.reply("Draft expired.");
  draft.exchangeStrategy = strat;
  await draft.save();
  
  // Get user for language
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  // Instead of deleting the message, edit it to show selected strategy
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [
        Markup.button.callback(
          strat === "100%" ? `✔ ${TEXT.exchangeStrategy100[lang]}` : TEXT.exchangeStrategy100[lang],
          "_DISABLED_EX_100%"
        )
      ],
      [
        Markup.button.callback(
          strat === "30:40:30" ? `✔ ${TEXT.exchangeStrategy304030[lang]}` : TEXT.exchangeStrategy304030[lang],
          "_DISABLED_EX_30:40:30"
        )
      ],
      [
        Markup.button.callback(
          strat === "50:50" ? `✔ ${TEXT.exchangeStrategy5050[lang]}` : TEXT.exchangeStrategy5050[lang],
          "_DISABLED_EX_50:50"
        )
      ]
    ]
  });

  // Then show the preview with Edit/Post options
  let preview = buildPreviewText(draft, user);
  // Replace the "*Expires At:* …" line with a relative countdown
  const hours = draft.expiryHours;
  preview = preview
    .split("\n")
    .map(line =>
      line.startsWith("*Expires At:*")
        ? `*Expires In:* ${hours} hour(s)`
        : line
    )
    .join("\n");

  ctx.session.taskFlow = null;
  return ctx.reply(preview,
    Markup.inlineKeyboard([
      [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
      [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
    ], { parse_mode: "Markdown" })
  );

  });


bot.action("EDIT_description", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "description",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.descriptionPrompt[lang]);
});

bot.action("EDIT_relatedFile", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  ctx.session.taskFlow = {
    step: "relatedFile",
    draftId: draft._id.toString(),
    isEdit: true
  };
  
  const relPrompt = await ctx.reply(
    TEXT.relatedFilePrompt[lang],
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.skipBtn[lang], "TASK_SKIP_FILE_EDIT")]
    ])  // Fixed: Added missing closing bracket
  );
  ctx.session.taskFlow.relatedFilePromptId = relPrompt.message_id;
});

bot.action("TASK_SKIP_FILE_EDIT", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }
  
  const promptId = ctx.session.taskFlow.relatedFilePromptId;

  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      promptId,
      undefined,
      {
        inline_keyboard: [[
          Markup.button.callback(`✔ ${TEXT.skipBtn[lang]}`, "_DISABLED_SKIP")
        ]]
      }
    );
  } catch (err) {
    console.error("Failed to edit message reply markup:", err);
  }

  // Clear any related file that might have been set
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (draft) {
    draft.relatedFile = undefined;
    await draft.save();
  }

  // In edit mode, return to preview instead of proceeding to fields
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am" ? "✅ ተያያዥ ፋይል ተዘምኗል" : "✅ Related file updated.");
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const user = await User.findOne({ telegramId: ctx.from.id });
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
      ], { parse_mode: "Markdown" })
    );
    ctx.session.taskFlow = null;
    return;
  }

  // Original behavior for non-edit flow
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
});

bot.action("EDIT_fields", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
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
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "skillLevel",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(
    TEXT.askSkillLevel[lang],
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.skillLevelBeginner[lang], "TASK_SKILL_Beginner")],
      [Markup.button.callback(TEXT.skillLevelIntermediate[lang], "TASK_SKILL_Intermediate")],
      [Markup.button.callback(TEXT.skillLevelProfessional[lang], "TASK_SKILL_Professional")]
    ])
  );
});

bot.action("EDIT_paymentFee", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "paymentFee",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.askPaymentFee[lang]);
});
bot.action("EDIT_timeToComplete", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "timeToComplete",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.askTimeToComplete[lang]);
});
bot.action("EDIT_revisionTime", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "revisionTime",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.askRevisionTime[lang]);
});
bot.action("EDIT_penaltyPerHour", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "penaltyPerHour",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.askPenaltyPerHour[lang]);
});
bot.action("EDIT_expiryHours", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "expiryHours",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(TEXT.askExpiryHours[lang]);
});
bot.action("EDIT_exchangeStrategy", async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (_) {}
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  ctx.session.taskFlow = {
    step: "exchangeStrategy",
    draftId: draft._id.toString(),
    isEdit: true
  };
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  return ctx.reply(
    TEXT.askExchangeStrategy[lang],
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.exchangeStrategy100[lang], "TASK_EX_100%")],
      [Markup.button.callback(TEXT.exchangeStrategy304030[lang], "TASK_EX_30:40:30")],
      [Markup.button.callback(TEXT.exchangeStrategy5050[lang], "TASK_EX_50:50")]
    ])
  );
});

bot.action("TASK_POST_CONFIRM", async (ctx) => {
  await ctx.answerCbQuery();
  
  // Get the draft and user
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (!draft) {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ ተግዳሮት ልጥፍ እንደገና ይጫኑ።" : "❌ Draft expired. Please click Post a Task again.");
  }
  
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found.");

  // Highlight "Post Task" and disable both buttons in the preview message
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(
          user.language === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", 
          "_DISABLED_TASK_EDIT"
        )],
        [Markup.button.callback(
          `✔ ${user.language === "am" ? "ተግዳሮት ልጥፍ" : "Post Task"}`,
          "_DISABLED_TASK_POST_CONFIRM"
        )]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Create the task
  const now = new Date();
  const expiryDate = new Date(now.getTime() + draft.expiryHours * 3600 * 1000);
  
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

  // Post to channel - FIXED VERSION WITH PROPER INLINE KEYBOARD
  const channelId = process.env.CHANNEL_ID || "-1002254896955";
  const preview = buildChannelPostText(draft, user);
  
  
  // Replace the current APPLY button creation with this:
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      user.language === "am" ? "ያመልክቱ / Apply" : "Apply / ያመልክቱ", 
      `https://t.me/${ctx.botInfo.username}?start=apply_${task._id}`
    )]
  ]);

  try {
    // Send to channel with proper keyboard attachment
    const sent = await ctx.telegram.sendMessage(channelId, preview, {
      parse_mode: "Markdown",
      ...keyboard // This spreads the reply_markup correctly
    });

    // Store the channel message ID with the task
    task.channelMessageId = sent.message_id;
    await task.save();
    
    user.adminProfileMsgId = sent.message_id;
    await user.save();
  } catch (err) {
    console.error("Failed to post task to channel:", err);
    const lang = user?.language || "en";
    return ctx.reply(lang === "am" 
      ? "❌ ተግዳሮቱን ለማስቀመጥ አልተቻለም። እባክዎ ቆይተው እንደገና ይሞክሩ።" 
      : "❌ Failed to post task. Please wait and try again."
    );
  }

  // Delete the draft
  await TaskDraft.findByIdAndDelete(draft._id);
  
  // Send confirmation message to user
  const confirmationText = user.language === "am" 
    ? `✅ ተግዳሮቱ በተሳካ ሁኔታ ተለጥፏል!\n\nሌሎች ተጠቃሚዎች አሁን ማመልከት ይችላሉ።` 
    : `✅ Task posted successfully!\n\nOther users can now apply.`;
  
  return ctx.reply(confirmationText);
});

function buildProfileText(user, showCongrats = false) {
  const banksList = user.bankDetails
    .map((b, i) => `${i+1}. ${b.bankName} (${b.accountNumber})`)
    .join("\n") || "N/A";
  
  const profileLines = user.language === "am" 
    ? [
        showCongrats ? "🎉 እንኳን ደስ አለዎት! ይህ የዎት Taskifii ፕሮፋይል ነው፦" : "📋 የእርስዎ Taskifii ፕሮፋይል፦",
        `• ሙሉ ስም: ${user.fullName}`,
        `• ስልክ: ${user.phone}`,
        `• ኢሜይል: ${user.email}`,
        `• ተጠቃሚ ስም: @${user.username}`,
        `• ባንኮች:\n${banksList}`,
        `• ቋንቋ: ${user.language === "am" ? "አማርኛ" : "English"}`,
        `• ተመዝግቦበት ቀን: ${user.createdAt.toLocaleString("en-US", { 
          timeZone: "Africa/Addis_Ababa",
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true
        })} GMT+3`,
        `🔹 እስካሁን የተቀበሉት: ${user.stats.totalEarned.toFixed(2)} ብር`,
        `🔹 እስካሁን ያከፈሉት: ${user.stats.totalSpent.toFixed(2)} ብር`,
        `🔹 ኖቬሌሽን: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)`
      ]
    : [
        showCongrats ? "🎉 Congratulations! Here is your Taskifii profile:" : "📋 Your Taskifii Profile:",
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks:\n${banksList}`,
        `• Language: ${user.language === "am" ? "Amharic" : "English"}`,
        `• Registered: ${user.createdAt.toLocaleString("en-US", { 
          timeZone: "Africa/Addis_Ababa",
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true
        })} GMT+3`,
        `🔹 Total earned: ${user.stats.totalEarned.toFixed(2)} birr`,
        `🔹 Total spent: ${user.stats.totalSpent.toFixed(2)} birr`,
        `🔹 Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ratings)`
      ];

  return profileLines.join("\n");
}
function buildAdminProfileText(user) {
  // Fix the bank account display by using accountNumber instead of bankAccountNumber
  const banksList = user.bankDetails
    .map((b, i) => `${i+1}. ${b.bankName} (${b.accountNumber})`) // Changed from bankAccountNumber to accountNumber
    .join("\n") || "N/A";
  
  // Add user ID to the header
  const lines = user.language === "am" 
    ? [
        `📋 **መግለጫ ፕሮፋይል ለአስተዳደር ማረጋገጫ** (User ID: ${user._id})`, // Added user ID
        `• ሙሉ ስም: ${user.fullName}`,
        `• ስልክ: ${user.phone}`,
        `• ኢሜይል: ${user.email}`,
        `• ተጠቃሚ ስም: @${user.username}`,
        `• ባንኮች:\n${banksList}`,
        `• ቋንቋ: ${user.language === "am" ? "አማርኛ" : "English"}`,
        `• ተመዝግቦበት ቀን: ${user.createdAt.toLocaleString("en-US", { 
          timeZone: "Africa/Addis_Ababa",
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true
        })} GMT+3`,
        `🔹 እስካሁን የተቀበሉት: ${user.stats.totalEarned.toFixed(2)} ብር`,
        `🔹 እስካሁን ያከፈሉት: ${user.stats.totalSpent.toFixed(2)} ብር`,
        `🔹 ኖቬሌሽን: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)`
      ]
    : [
        `📋 **Profile Post for Approval** (User ID: ${user._id})`, // Added user ID
        `• Full Name: ${user.fullName}`,
        `• Phone: ${user.phone}`,
        `• Email: ${user.email}`,
        `• Username: @${user.username}`,
        `• Banks:\n${banksList}`,
        `• Language: ${user.language === "am" ? "Amharic" : "English"}`,
        `• Registered: ${user.createdAt.toLocaleString("en-US", { 
          timeZone: "Africa/Addis_Ababa",
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true
        })} GMT+3`,
        `🔹 Total earned: ${user.stats.totalEarned.toFixed(2)} birr`,
        `🔹 Total spent: ${user.stats.totalSpent.toFixed(2)} birr`,
        `🔹 Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ratings)`
      ];

  return lines.join("\n");
}

bot.action("EDIT_PROFILE", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session properly
  ctx.session = ctx.session || {};
  ctx.session.editing = ctx.session.editing || {};

  // Highlight "Edit Profile" and disable all buttons while maintaining original order
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "_DISABLED_POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "_DISABLED_FIND_TASK")],
        [Markup.button.callback(`✔ ${TEXT.editProfileBtn[user.language]}`, "_DISABLED_EDIT_PROFILE")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Send the profile with edit options (vertically stacked)
  const editButtons = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.editNameBtn[user.language], "EDIT_NAME")],
    [Markup.button.callback(TEXT.editPhoneBtn[user.language], "EDIT_PHONE")],
    [Markup.button.callback(TEXT.editEmailBtn[user.language], "EDIT_EMAIL")],
    [Markup.button.callback(TEXT.editUsernameBtn[user.language], "EDIT_USERNAME")],
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_BANKS")],
    [Markup.button.callback(TEXT.backBtn[user.language], "EDIT_BACK")]
  ]);

  return ctx.reply(
    `${TEXT.editProfilePrompt[user.language]}\n\n${buildProfileText(user)}`,
    editButtons
  );
});


// Update the EDIT_BACK handler
bot.action("EDIT_BACK", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Highlight "Back" and disable all buttons in the edit menu
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(`✔ ${TEXT.backBtn[user.language]}`, "_DISABLED_EDIT_BACK")],
        [Markup.button.callback(TEXT.editNameBtn[user.language], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[user.language], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[user.language], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[user.language], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(TEXT.editBanksBtn[user.language], "_DISABLED_EDIT_BANKS")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Edit the existing message to show profile with working menu buttons
  const menu = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
    [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
    [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
  ]);


  return ctx.editMessageText(
    buildProfileText(user),
    menu
  );
});


// Add handlers for each edit option
bot.action("EDIT_NAME", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session with all needed data
  ctx.session = ctx.session || {};
  ctx.session.editing = { 
    field: "fullName",
    profileMessageId: ctx.callbackQuery.message.message_id,
    adminMessageId: user.adminMessageId // Make sure to include this
  };
  // Highlight "Name" and disable all buttons
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(`✔ ${TEXT.editNameBtn[user.language]}`, "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[user.language], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[user.language], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[user.language], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(TEXT.editBanksBtn[user.language], "_DISABLED_EDIT_BANKS")],
        [Markup.button.callback(TEXT.backBtn[user.language], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  return ctx.reply(user.language === "am" ? TEXT.askFullName.am : TEXT.askFullName.en);
});

bot.action("EDIT_PHONE", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = { field: "phone" };

  try {
    // Highlight "Phone" and disable all buttons
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.editNameBtn[user.language], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(`✔ ${TEXT.editPhoneBtn[user.language]}`, "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[user.language], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[user.language], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(TEXT.editBanksBtn[user.language], "_DISABLED_EDIT_BANKS")],
        [Markup.button.callback(TEXT.backBtn[user.language], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  return ctx.reply(user.language === "am" ? TEXT.askPhone.am : TEXT.askPhone.en);
});

bot.action("EDIT_EMAIL", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = { field: "email" };

  try {
    // Highlight "Email" and disable all buttons
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.editNameBtn[user.language], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[user.language], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(`✔ ${TEXT.editEmailBtn[user.language]}`, "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[user.language], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(TEXT.editBanksBtn[user.language], "_DISABLED_EDIT_BANKS")],
        [Markup.button.callback(TEXT.backBtn[user.language], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  return ctx.reply(user.language === "am" ? TEXT.askEmail.am : TEXT.askEmail.en);
});

bot.action("EDIT_USERNAME", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = {
    field: "username",
    adminMessageId: user.adminMessageId
  };

  try {
    // Highlight "Username" and disable all buttons
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.editNameBtn[user.language], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[user.language], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[user.language], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(`✔ ${TEXT.editUsernameBtn[user.language]}`, "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(TEXT.editBanksBtn[user.language], "_DISABLED_EDIT_BANKS")],
        [Markup.button.callback(TEXT.backBtn[user.language], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Prompt for Telegram username
  const currentHandle = ctx.from.username || "";
  const promptText = user.language === "am"
    ? TEXT.askUsername.am.replace("%USERNAME%", currentHandle || "<none>")
    : TEXT.askUsername.en.replace("%USERNAME%", currentHandle || "<none>");
  
  // Send the prompt with a disabled "Yes, keep it" button if username was already provided
  const buttons = [];
  if (!ctx.session.usernameProvided) {
    buttons.push(Markup.button.callback(
      user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
      "USERNAME_KEEP_EDIT"
    ));
  } else {
    buttons.push(Markup.button.callback(
      user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it",
      "_DISABLED_USERNAME_KEEP_EDIT"
    ));
  }

  return ctx.reply(
    promptText,
    Markup.inlineKeyboard([buttons])
  );
});

// Add handler for keeping username during edit
bot.action("USERNAME_KEEP_EDIT", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // If username was already provided, don't proceed
  if (ctx.session?.usernameProvided) {
    return ctx.answerCbQuery("Please confirm the new username first", { show_alert: true });
  }

  // Highlight "Yes, keep it" and disable it
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "✔ አዎን፣ ይቀበሉ" : "✔ Yes, keep it",
          "_DISABLED_USERNAME_KEEP_EDIT"
        )
      ]]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  const handle = ctx.from.username || "";
  if (!handle) {
    return ctx.reply(
      user.language === "am"
        ? "ምንም Telegram የተጠቃሚ ስም የለዎትም። እባክዎ ትክክለኛ ይጻፉ።"
        : "It seems you don't have a Telegram username. Please type a valid one."
    );
  }

  // Update username
  user.username = handle;
  await user.save();
  
  // Update admin channel
  await updateAdminProfilePost(ctx, user);
  
  // Clear session
  delete ctx.session.editing;
  
  // Send success message and return to profile
  await ctx.reply(TEXT.profileUpdated[user.language]);
  
  // Restore original buttons
  const menu = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
    [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
    [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
  ]);

  return ctx.reply(buildProfileText(user), menu);
});

// Add handler for bank details edit
// In the EDIT_BANKS action handler:
// In the EDIT_BANKS action handler:
bot.action("EDIT_BANKS", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = ctx.session.editing || {};

  try {
    // Highlight "Bank Details" and disable all buttons in a stable layout
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.editNameBtn[user.language], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[user.language], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[user.language], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[user.language], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(`✔ ${TEXT.editBanksBtn[user.language]}`, "_DISABLED_EDIT_BANKS")],
        [Markup.button.callback(TEXT.backBtn[user.language], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Show bank entries with options to edit each
  if (user.bankDetails.length === 0) {
    ctx.session.editing = { field: "bankFirst" };
    return ctx.reply(user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en);
  }

  // Create buttons for each bank entry - each in its own row
  const bankButtons = user.bankDetails.map((bank, index) => {
    return [Markup.button.callback(
      `${index + 1}. ${bank.bankName} (${bank.accountNumber})`, 
      `EDIT_BANK_${index}`
    )];
  });

  // Add additional options
   const actionButtons = [];
  
  // Always show Add button but disable if at limit
  actionButtons.push([
    Markup.button.callback(
      user.bankDetails.length >= 10 ? `❌ ${TEXT.addBankBtn[user.language]}` : TEXT.addBankBtn[user.language],
      user.bankDetails.length >= 10 ? "_DISABLED_ADD_BANK" : "ADD_BANK"
    ),
    Markup.button.callback(
      user.bankDetails.length <= 1 ? `❌ ${TEXT.removeBankBtn[user.language]}` : TEXT.removeBankBtn[user.language],
      user.bankDetails.length <= 1 ? "_DISABLED_REMOVE_BANK" : "REMOVE_BANK"
    )
  ]);
  
  actionButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "BANK_EDIT_DONE")
  ]);

  return ctx.reply(
    TEXT.editBankPrompt[user.language],
    Markup.inlineKeyboard([...bankButtons, ...actionButtons])
  );
});


// Add handler for editing specific bank entry
bot.action(/EDIT_BANK_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const index = parseInt(ctx.match[1]);
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  if (index >= user.bankDetails.length) {
    return ctx.reply("Invalid bank entry. Please try again.");
  }

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = {
    field: "bankReplacing",
    bankIndex: index,
    adminMessageId: user.adminMessageId
  };

  // Create buttons for each bank entry with the selected one highlighted
  const bankButtons = user.bankDetails.map((bank, i) => {
    return [Markup.button.callback(
      i === index ? `✔ ${i + 1}. ${bank.bankName} (${bank.accountNumber})` : `${i + 1}. ${bank.bankName} (${bank.accountNumber})`,
      "_DISABLED_EDIT_BANK"
    )];
  });

  // Add additional options - maintaining consistent layout
  const actionButtons = [];
  
  actionButtons.push([
    Markup.button.callback(
      user.bankDetails.length >= 10 ? `❌ ${TEXT.addBankBtn[user.language]}` : TEXT.addBankBtn[user.language],
      "_DISABLED_ADD_BANK"
    ),
    Markup.button.callback(
      user.bankDetails.length <= 1 ? `❌ ${TEXT.removeBankBtn[user.language]}` : TEXT.removeBankBtn[user.language],
      "_DISABLED_REMOVE_BANK"
    )
  ]);
  
  actionButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "_DISABLED_BANK_EDIT_DONE")
  ]);

  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [...bankButtons, ...actionButtons]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }
  return ctx.reply(
    user.language === "am" 
      ? "እባክዎ አዲሱን የባንክ መግለጫ በ `BankName,AccountNumber` ቅጥ ይጻፉ።" 
      : "Please type the new bank entry in `BankName,AccountNumber` format."
  );
});
// Add handler for adding new bank
bot.action("ADD_BANK", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  if (user.bankDetails.length >= 10) {
    return ctx.reply(
      user.language === "am" 
        ? "ከ10 ባንኮች በላይ ማከል አይችሉም።" 
        : "You cannot add more than 10 banks."
    );
  }

  // Initialize session
  ctx.session = ctx.session || {};
  ctx.session.editing = { field: "bankAdding" };

  // Create buttons for each bank entry
  
  const bankButtons = user.bankDetails.map((bank, index) => {
    return [Markup.button.callback(
      `${index + 1}. ${bank.bankName} (${bank.accountNumber})`,
      "_DISABLED_BANK_ENTRY"
    )];
  });

  // Add additional options
  const actionButtons = [];
  
  actionButtons.push([
    Markup.button.callback(
      `✔ ${TEXT.addBankBtn[user.language]}`,
      "_DISABLED_ADD_BANK"
    ),
    Markup.button.callback(
      user.bankDetails.length <= 1 ? `❌ ${TEXT.removeBankBtn[user.language]}` : TEXT.removeBankBtn[user.language],
      "_DISABLED_REMOVE_BANK"
    )
  ]);
  
  actionButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "_DISABLED_BANK_EDIT_DONE")
  ]);

  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [...bankButtons, ...actionButtons]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  return ctx.reply(
    user.language === "am" ? TEXT.askBankDetails.am : TEXT.askBankDetails.en
  );
});

// Handler for removing bank
// Update the existing bank removal handler
bot.action(/REMOVE_BANK_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const index = parseInt(ctx.match[1]);
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  if (index >= user.bankDetails.length) {
    return ctx.reply("Invalid bank entry. Please try again.");
  }

  // Remove the bank entry
  user.bankDetails.splice(index, 1);
  await user.save();

  // Update admin channel
  await updateAdminProfilePost(ctx, user);

  // Send success message
  await ctx.reply(TEXT.profileUpdated[user.language]);

  // Create buttons for each remaining bank entry - all disabled
  const bankButtons = user.bankDetails.map((bank, i) => {
    return [Markup.button.callback(
      `${i + 1}. ${bank.bankName} (${bank.accountNumber})`, 
      "_DISABLED_BANK_ENTRY"
    )];
  });

  // Add additional options - all disabled
  const actionButtons = [];
  
  actionButtons.push([
    Markup.button.callback(
      user.bankDetails.length >= 10 ? `❌ ${TEXT.addBankBtn[user.language]}` : TEXT.addBankBtn[user.language],
      "_DISABLED_ADD_BANK"
    ),
    Markup.button.callback(
      user.bankDetails.length <= 1 ? `❌ ${TEXT.removeBankBtn[user.language]}` : TEXT.removeBankBtn[user.language],
      "_DISABLED_REMOVE_BANK"
    )
  ]);
  
  actionButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "BANK_EDIT_DONE")
  ]);

  // Edit the original message to show disabled state
  try {
    await ctx.editMessageText(
      TEXT.editBankPrompt[user.language],
      Markup.inlineKeyboard([...bankButtons, ...actionButtons])
    );
  } catch (err) {
    console.error("Error editing message:", err);
  }
});



// Add handler for finishing bank editing
// Update the existing BANK_EDIT_DONE handler
bot.action("BANK_EDIT_DONE", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Highlight "Done Editing Banks" and disable all buttons
  try {
    const currentButtons = ctx.callbackQuery.message.reply_markup.inline_keyboard;
    const newButtons = currentButtons.map(row => {
      return row.map(button => {
        if (button.text === TEXT.bankEditDoneBtn[user.language]) {
          return Markup.button.callback(`✔ ${button.text}`, "_DISABLED_BANK_EDIT_DONE");
        } else {
          return Markup.button.callback(button.text, `_DISABLED_${button.callback_data}`);
        }
      });
    });

    await ctx.editMessageReplyMarkup({
      inline_keyboard: newButtons
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Return to profile edit menu
  const editButtons = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.editNameBtn[user.language], "EDIT_NAME")],
    [Markup.button.callback(TEXT.editPhoneBtn[user.language], "EDIT_PHONE")],
    [Markup.button.callback(TEXT.editEmailBtn[user.language], "EDIT_EMAIL")],
    [Markup.button.callback(TEXT.editUsernameBtn[user.language], "EDIT_USERNAME")],
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_BANKS")],
    [Markup.button.callback(TEXT.backBtn[user.language], "EDIT_BACK")]
  ]);

  return ctx.reply(
    `${TEXT.editProfilePrompt[user.language]}\n\n${buildProfileText(user)}`,
    editButtons
  );
});

// Update the existing text handler to support profile editing




  // ─────────── Placeholder Actions ───────────
  //bot.action("POST_TASK", (ctx) => ctx.answerCbQuery());
  
  //bot.action("EDIT_PROFILE", (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_BAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_CONTACT_.+/, (ctx) => ctx.answerCbQuery());
  bot.action(/ADMIN_REVIEW_.+/, (ctx) => ctx.answerCbQuery());

bot.action("CONFIRM_NEW_USERNAME", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  if (!ctx.session?.newUsername) {
    return ctx.reply("No username to confirm. Please try again.");
  }

  // Highlight "Yes" and disable both buttons
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "✔ አዎን" : "✔ Yes", 
          "_DISABLED_CONFIRM_NEW_USERNAME"
        ),
        Markup.button.callback(
          user.language === "am" ? "አይ" : "No",
          "_DISABLED_CANCEL_NEW_USERNAME"
        )
      ]]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Update username
  user.username = ctx.session.newUsername;
  await user.save();
  
  // Update admin channel
  await updateAdminProfilePost(ctx, user);
  
  // Clear session
  delete ctx.session.editing;
  delete ctx.session.newUsername;
  delete ctx.session.usernameProvided;

  // Send success message and return to profile
  await ctx.reply(TEXT.profileUpdated[user.language]);
  
  // Restore original buttons
  const menu = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
    [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
    [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
  ]);

  return ctx.reply(buildProfileText(user), menu);
});

bot.action("CANCEL_NEW_USERNAME", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Highlight "No" and disable both buttons
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          user.language === "am" ? "አዎን" : "Yes", 
          "_DISABLED_CONFIRM_NEW_USERNAME"
        ),
        Markup.button.callback(
          user.language === "am" ? "✔ አይ" : "✔ No",
          "_DISABLED_CANCEL_NEW_USERNAME"
        )
      ]]
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Clear session
  delete ctx.session.editing;
  delete ctx.session.newUsername;
  delete ctx.session.usernameProvided;

  // Return to profile edit menu
  const editButtons = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.editNameBtn[user.language], "EDIT_NAME")],
    [Markup.button.callback(TEXT.editPhoneBtn[user.language], "EDIT_PHONE")],
    [Markup.button.callback(TEXT.editEmailBtn[user.language], "EDIT_EMAIL")],
    [Markup.button.callback(TEXT.editUsernameBtn[user.language], "EDIT_USERNAME")],
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_BANKS")],
    [Markup.button.callback(TEXT.backBtn[user.language], "EDIT_BACK")]
  ]);

  return ctx.reply(
    `${TEXT.editProfilePrompt[user.language]}\n\n${buildProfileText(user)}`,
    editButtons
  );
});

// Add this action handler for the Remove Bank button
bot.action("REMOVE_BANK", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  if (user.bankDetails.length <= 1) {
    return ctx.reply(
      user.language === "am" 
        ? "ቢያንስ አንድ የባንክ መግለጫ መኖር አለበት።" 
        : "You must have at least one bank detail."
    );
  }

  // Create buttons for each bank entry with remove option
  const removeButtons = user.bankDetails.map((bank, index) => {
    return [Markup.button.callback(
      `${index + 1}. ${bank.bankName} (${bank.accountNumber})`, 
      `REMOVE_BANK_${index}`
    )];
  });

  // Add back button (maintain consistent naming)
  removeButtons.push([
    Markup.button.callback(TEXT.backBtn[user.language], "BANK_REMOVE_BACK")
  ]);

  // Highlight the Remove Bank button in the original message
  try {
    const currentButtons = ctx.callbackQuery.message.reply_markup.inline_keyboard;
    const newButtons = currentButtons.map(row => {
      return row.map(button => {
        if (button.text === TEXT.removeBankBtn[user.language]) {
          return Markup.button.callback(`✔ ${button.text}`, "_DISABLED_REMOVE_BANK");
        } else if (button.text === TEXT.addBankBtn[user.language]) {
          return Markup.button.callback(button.text, "_DISABLED_ADD_BANK");
        } else if (button.text === TEXT.bankEditDoneBtn[user.language]) {
          return Markup.button.callback(button.text, "_DISABLED_BANK_EDIT_DONE");
        }
        return button;
      });
    });

    await ctx.editMessageReplyMarkup({
      inline_keyboard: newButtons
    });
  } catch (err) {
    console.error("Error editing message markup:", err);
  }

  // Show the remove selection interface
  await ctx.reply(
    user.language === "am" 
      ? "ለማስወገድ የሚፈልጉትን የባንክ መግለጫ ይምረጡ:" 
      : "Select which bank entry you'd like to remove:",
    Markup.inlineKeyboard(removeButtons)
  );
});




// Add handler for canceling remove bank operation
bot.action("BANK_REMOVE_CANCEL", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Return to bank edit menu
  const bankButtons = user.bankDetails.map((bank, index) => {
    return [Markup.button.callback(
      `${index + 1}. ${bank.bankName} (${bank.accountNumber})`, 
      `EDIT_BANK_${index}`
    )];
  });

  bankButtons.push([
    Markup.button.callback(TEXT.addBankBtn[user.language], "ADD_BANK"),
    Markup.button.callback(TEXT.removeBankBtn[user.language], "REMOVE_BANK")
  ]);
  bankButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "BANK_EDIT_DONE")
  ]);

  return ctx.reply(
    TEXT.editBankPrompt[user.language],
    Markup.inlineKeyboard(bankButtons)
  );
});

bot.action("BANK_REMOVE_BACK", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Create buttons for each bank entry
  const bankButtons = user.bankDetails.map((bank, index) => {
    return [Markup.button.callback(
      `${index + 1}. ${bank.bankName} (${bank.accountNumber})`, 
      `EDIT_BANK_${index}`
    )];
  });

  // Add additional options - always show both buttons in one row
  const actionButtons = [];
  
  actionButtons.push([
    Markup.button.callback(
      user.bankDetails.length >= 10 ? `❌ ${TEXT.addBankBtn[user.language]}` : TEXT.addBankBtn[user.language],
      user.bankDetails.length >= 10 ? "_DISABLED_ADD_BANK" : "ADD_BANK"
    ),
    Markup.button.callback(
      user.bankDetails.length <= 1 ? `❌ ${TEXT.removeBankBtn[user.language]}` : TEXT.removeBankBtn[user.language],
      user.bankDetails.length <= 1 ? "_DISABLED_REMOVE_BANK" : "REMOVE_BANK"
    )
  ]);
  
  actionButtons.push([
    Markup.button.callback(TEXT.bankEditDoneBtn[user.language], "BANK_EDIT_DONE")
  ]);

  try {
    await ctx.editMessageText(
      TEXT.editBankPrompt[user.language],
      Markup.inlineKeyboard([...bankButtons, ...actionButtons])
    );
  } catch (err) {
    console.error("Error editing message:", err);
  }
});

// ─────────── FIND_TASK Handler ───────────
bot.action("FIND_TASK", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  // Highlight "Find a Task" and disable all buttons
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [Markup.button.callback(TEXT.postTaskBtn[user.language], "_DISABLED_POST_TASK")],
      [Markup.button.callback(`✔ ${TEXT.findTaskBtn[user.language]}`, "_DISABLED_FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn[user.language], "_DISABLED_EDIT_PROFILE")]
    ]
  });

  // Get the channel ID from environment variables or use a default
  const channelId = process.env.CHANNEL_ID || "-1002254896955"; // Replace with your actual channel ID
  const channelUsername = process.env.CHANNEL_USERNAME || "TaskifiiRemote"; // Replace with your channel username if available

  try {
    // Try to generate a proper channel link
    const channelLink = channelUsername 
      ? `https://t.me/${channelUsername}`
      : `https://t.me/c/${channelId.replace('-100', '')}`;
    
    // Send message with the channel link
    return ctx.reply(
      user.language === "am" 
        ? `🔍 ተግዳሮቶችን ለማግኘት ወደ የተግዳሮት ሰርጥ ይሂዱ: ${channelLink}` 
        : `🔍 To find tasks, visit our tasks channel: ${channelLink}`,
      { disable_web_page_preview: true }
    );
  } catch (err) {
    console.error("Error generating channel link:", err);
    // Fallback message if link generation fails
    return ctx.reply(
      user.language === "am" 
        ? "የተግዳሮት ሰርጡን ለማግኘት እባክዎ በቀጥታ ወደ ሰርጣችን ይሂዱ" 
        : "Please visit our channel directly to find tasks"
    );
  }
});


// Error handling middleware
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  // Only send error message if it's not during profile completion
  if (!ctx.session?.onboardingStep === "completed") {
    return ctx.reply("An error occurred. Please try again.");
  }
});


  // ─────────── Launch Bot ───────────
  bot.launch().then(() => {
    console.log("🤖 Bot is up and running");
  });
}
