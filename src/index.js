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
// --- Telegram currency minimums (rounded up a bit to be safe) ---
const TG_MIN_BY_CURRENCY = {
  ETB: 135,  // Telegram shows ~132.53 ETB min; we enforce 135 to avoid edge fails
};
const USE_CHAPA_HOSTED_FOR_ESCROW = process.env.USE_CHAPA_HOSTED_FOR_ESCROW === "true";


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
  lastReminderInterval: { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now }
});

// Explicitly add sparse unique indexes for username, email, phone:
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ email:    1 }, { unique: true, sparse: true });
userSchema.index({ phone:    1 }, { unique: true, sparse: true });



const TaskDraft = require("./models/TaskDraft");
const PaymentIntent = require("./models/PaymentIntent");  // NEW

// ------------------------------------
//  Engagement Lock Model & Utilities
// ------------------------------------
const EngagementLockSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  task:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
  role:   { type: String, enum: ['creator','doer'], required: true },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  releasedAt: Date
}, { versionKey: false });

EngagementLockSchema.index({ user: 1, task: 1 }, { unique: true });

const EngagementLock = mongoose.models.EngagementLock
  || mongoose.model('EngagementLock', EngagementLockSchema);

// ------------------------------------
//  Escalation & Banlist (no schema churn to Task/User)
// ------------------------------------
const EscalationSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', unique: true, required: true },
  by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['creator','doer'], required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const Escalation = mongoose.models.Escalation
  || mongoose.model('Escalation', EscalationSchema);

const BanlistSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  telegramId: { type: Number, index: true },
  reason:     { type: String, default: 'reported before mission accomplished' },
  bannedAt:   { type: Date, default: Date.now }
}, { versionKey: false });

BanlistSchema.index({ user: 1 }, { unique: true, sparse: true });
BanlistSchema.index({ telegramId: 1 }, { unique: true, sparse: true });

const Banlist = mongoose.models.Banlist
  || mongoose.model('Banlist', BanlistSchema);


// ---------------------------
// Ratings / Finalization / Credits
// ---------------------------
const RATING_CHANNEL_ID = "-1002289847417";
// ---- Refund audit channel (private) ----
const REFUND_AUDIT_CHANNEL_ID = "-1002616271109";
// ---- Dispute channel for escalations ----
const DISPUTE_CHANNEL_ID = "-1002432632907";



// Format the expiry exactly like the task channel message (Africa/Addis_Ababa, GMT+3)
function formatExpiresAtForAudit(date) {
  try {
    // Match the style you show in channel posts (local ET time)
    const opts = { timeZone: "Africa/Addis_Ababa", year: "numeric", month: "short", day: "2-digit",
                   hour: "2-digit", minute: "2-digit", hour12: false };
    // Example: Oct 17, 2025, 14:30 (GMT+3)
    const s = new Intl.DateTimeFormat("en-GB", opts).format(date);
    return `${s} (GMT+3)`;
  } catch {
    return date.toISOString();
  }
}

// Compose and send the giant audit message to the private channel
async function sendRefundAudit(bot, {
  tag, // "#refundfailed" or "#refundsuccessful"
  task, creator, intent,
  extra = {} // { reason, chapaReference, refundId }
}) {
  const creatorName = creator?.fullName || creator?.username || String(creator?.telegramId || "");
  const creatorUserId = creator?._id ? String(creator._id) : "-";
  const creatorTelegramId = creator?.telegramId ?? "-";

  const messageLines = [
    `#taskRefund ${tag}`,
    `Task Description: ${task?.description || "-"}`,
    `Expiry (as shown): ${formatExpiresAtForAudit(task?.expiry)}`,
    `Fee (ETB): ${task?.paymentFee ?? intent?.amount ?? "-"}`,
    `Creator User ID: ${creatorUserId}`,
    `Creator Telegram ID: ${creatorTelegramId}`,
    `Creator Name: ${creatorName}`,
  ];

  if (extra.reason)        messageLines.push(`Reason: ${extra.reason}`);
  if (extra.chapaReference) messageLines.push(`Chapa Reference: ${extra.chapaReference}`);
  if (extra.refundId)      messageLines.push(`Refund ID: ${extra.refundId}`);

  const text = messageLines.join("\n");
  try {
    await bot.telegram.sendMessage(REFUND_AUDIT_CHANNEL_ID, text, { disable_web_page_preview: true });
  } catch (e) {
    console.error("Failed to send refund audit message:", e);
  }
}

const FinalizationSchema = new mongoose.Schema({
  task: { type: Schema.Types.ObjectId, ref: 'Task', unique: true, required: true },
  creatorMissionAt: Date,
  doerMissionAt: Date,
  creatorReportedAt: Date,
  doerReportedAt: Date,
  concludedAt: Date,            // when we sent “giant message + rating prompts”
  ratingPromptsSentAt: Date,
  creatorRatedAt: Date,
  doerRatedAt: Date
}, { versionKey: false });
const FinalizationState = mongoose.models.FinalizationState
  || mongoose.model('FinalizationState', FinalizationSchema);

const RatingSchema = new mongoose.Schema({
  task: { type: Schema.Types.ObjectId, ref: 'Task', index: true, required: true },
  from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  to:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['creatorRatesDoer','doerRatesCreator'], required: true },
  score:{ type: Number, min: 1, max: 5, required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
RatingSchema.index({ task:1, from:1, role:1 }, { unique: true });
const Rating = mongoose.models.Rating || mongoose.model('Rating', RatingSchema);

const CreditLogSchema = new mongoose.Schema({
  task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['doerEarned','creatorSpent'], required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
CreditLogSchema.index({ task:1, type:1 }, { unique: true });
const CreditLog = mongoose.models.CreditLog || mongoose.model('CreditLog', CreditLogSchema);
// ---------------------------
// Doer Work / Submissions
// ---------------------------
const DoerWorkSchema = new mongoose.Schema({
  task:       { type: mongoose.Schema.Types.ObjectId, ref: 'Task', index: true, required: true, unique: true },
  doer:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doerTelegramId: { type: Number, required: true, index: true },

  // Robust timer: DB-stored start/deadline so restarts don't matter
  startedAt:  { type: Date, required: true },
  deadlineAt: { type: Date, required: true },
  completedAt:{ type: Date },                   // set when doer taps "Completed task sent"
  status:     { type: String, enum: ['active','completed'], default: 'active', index: true },

  // We'll store the doer-facing message that contains the "Completed task sent" button,
  // so we can flip it to a checked/inert state.
  doerControlMessageId: { type: Number },

  // Exact original Telegram messages from the doer so we can copy them to the creator
  // preserving captions and types.
  messages: [{
    messageId: Number,
    date: Date,

    // NEW (backward-compatible):
    type: { type: String },                 // 'text','photo','document','video','audio','voice','sticker','video_note'
    mediaGroupId: { type: String },
    text: { type: String },
    caption: { type: String },
    fileIds: [String],                      // e.g. photo sizes (we'll pick the largest), or single file_id for doc/video/etc.
    // for stickers/voices:
    stickerFileId: { type: String },
    voiceFileId: { type: String },
    audioFileId: { type: String },
    videoFileId: { type: String },
    documentFileId: { type: String },
    photoBestFileId: { type: String },
    // add to base = { ... } initializer
    // ✅ correct schema fields
    isForwarded: { type: Boolean, default: false },
    animationFileId: { type: String },
    
    // convenience for single-photo cases
    videoNoteFileId: { type: String }
  }],

    

  // NEW: Fields for revision requests from the task creator
  fixRequests: [{
    messageId: Number,
    date: Date,
    type: { type: String },                  // e.g. 'text','photo','document', etc.
    mediaGroupId: String,
    text: String,
    caption: String,
    fileIds: [String],
    stickerFileId: String,
    voiceFileId: String,
    audioFileId: String,
    videoFileId: String,
    documentFileId: String,
    photoBestFileId: String,
    animationFileId: String,
    videoNoteFileId: String,
    isForwarded: { type: Boolean, default: false }
  }],
  fixNoticeSentAt: { type: Date },
  
  
  // NEW: Revision tracking
  revisionStartedAt: { type: Date },
  revisionDeadlineAt: { type: Date },
  revisionCount: { type: Number, default: 0 },
  currentRevisionStatus: { 
    type: String, 
    enum: ['none', 'awaiting_fix', 'fix_received', 'accepted'], 
    default: 'none' 
  },
    // NEW: Doer’s corrected submissions collected after a Fix Notice,
  // before they press "Send corrected version"
  correctedBuffer: [{
    messageId: Number,
    date: Date,
    type: { type: String },         // 'text','photo','document','video','audio','voice','sticker','video_note'
    mediaGroupId: String,
    text: String,
    caption: String,
    fileIds: [String],
    stickerFileId: String,
    voiceFileId: String,
    audioFileId: String,
    videoFileId: String,
    documentFileId: String,
    photoBestFileId: String,
    animationFileId: String,
    videoNoteFileId: String,
    isForwarded: { type: Boolean, default: false }
  }],


}, { versionKey: false, timestamps: true });

const DoerWork = mongoose.models.DoerWork
  || mongoose.model('DoerWork', DoerWorkSchema);


// --- Helper: top frequent fields for a doer based on rated tasks ---
// --- Helper: top frequent fields for a doer based on finished/rated work ---
async function getFrequentFieldsForDoer(userId) {
  // 1) Finished tasks inferred by doer->creator rating
  const ratedTaskIds = await Rating.find({
    from: userId,
    role: 'doerRatesCreator'
  }).distinct('task');

  // 2) Finished tasks inferred by credits (you award these when the doer rates)
  const creditedTaskIds = await CreditLog.find({
    user: userId,
    type: 'doerEarned'
  }).distinct('task');

  // 3) Legacy: applicants.status === "Completed"
  const completedTaskIds = await Task.find({
    "applicants.user": userId,
    "applicants.status": "Completed"
  }).distinct('_id');

  // Unique ObjectIds
  const taskIds = Array.from(new Set([
    ...ratedTaskIds.map(String),
    ...creditedTaskIds.map(String),
    ...completedTaskIds.map(String),
  ])).map(id => new mongoose.Types.ObjectId(id));

  if (taskIds.length === 0) return [];

  // Aggregate top fields (max 5)
  const agg = await Task.aggregate([
    { $match: { _id: { $in: taskIds } } },
    { $project: { fields: { $ifNull: ["$fields", []] } } },
    { $unwind: "$fields" },
    { $group: { _id: "$fields", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 5 }
  ]);

  if (agg.length > 0) return agg.map(f => f._id);

  // Fallback: if the doer has finished tasks but the aggregate found none
  // (e.g., some tasks missing 'fields'), return fields from the latest one.
  const latest = await Task.findOne({
    _id: { $in: taskIds },
    fields: { $exists: true, $ne: [] }
  }).sort({ postedAt: -1, _id: -1 }).select('fields').lean();

  return Array.isArray(latest?.fields) ? latest.fields.slice(0, 5) : [];
}






// Create/ensure locks for both participants of a task
async function lockBothForTask(taskDoc, doerUserId, creatorUserId) {
  const ops = [
    {
      updateOne: {
        filter: { user: doerUserId, task: taskDoc._id },
        update: { $setOnInsert: { role: 'doer', active: true, createdAt: new Date() }, $unset: { releasedAt: "" } },
        upsert: true
      }
    },
    {
      updateOne: {
        filter: { user: creatorUserId, task: taskDoc._id },
        update: { $setOnInsert: { role: 'creator', active: true, createdAt: new Date() }, $unset: { releasedAt: "" } },
        upsert: true
      }
    }
  ];
  await EngagementLock.bulkWrite(ops, { ordered: false });
}

// Check if a telegram user is engagement-locked
async function isEngagementLocked(telegramId) {
  const u = await User.findOne({ telegramId });
  if (!u) return false;
  return !!(await EngagementLock.findOne({ user: u._id, active: true }).lean());
}

// Optional: when you decide the task is "sorted out", call this.
async function releaseLocksForTask(taskId) {
  await EngagementLock.updateMany(
    { task: taskId, active: true },
    { $set: { active: false, releasedAt: new Date() } }
  );
}

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
    en: "Select 1–7 fields:",
    am: "1–7 መስኮች ይምረጡ:"
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
    acceptBtn: {
    en: "Accept",
    am: "ተቀበል"
  },
  declineBtn: {
    en: "Decline",
    am: "አትቀበል"
  },
   applicationDeclined: {
    en: "The task creator has declined your application. Please apply to other tasks in the channel.",
    am: "የተግዳሮቱ ፈጣሪ ማመልከቻዎን እምቢ ብሏል። እባክዎ በሌሎች ተግዳሮቶች ላይ ይመዝገቡ።"
  },
  applicationAccepted: {
    en: "🎉 You've been selected for the task!\n\nIf you want to do this task, click 'Do the task' below quickly before others do.\n\nIf no one else is competing, you have until [expiry time] to confirm or you'll miss your chance.\n\nIf you don't want to do it, click 'Cancel'.",
    am: "🎉 ለተግዳሮቱ ተመርጠዋል!\n\nይህን ተግዳሮት ለመስራት ከፈለጉ፣ ሌሎች ከመምጣታቸው በፊት 'ተግዳሮቱን ስራ' የሚለውን በታች ይጫኑ።\n\nሌላ ተወዳዳሪ ከሌለ፣ እስከ [የማብቂያ ጊዜ] ድረስ ለማረጋገጥ ጊዜ አለዎት፣ አለበለዚያ እድሉን ያመልጣሉ።\n\nከመስራት ከፈለጉ ካንስል ይጫኑ።"
  },
  creatorNotification: {
    en: "✅ You've selected [applicant] for your task. They've been notified and will confirm if they still want to do it. Please wait for their confirmation.",
    am: "✅ [applicant] ለተግዳሮትዎ መረጥዎታል። አሁንም ለመስራት ከፈለጉ እንደሚያረጋግጡ ተነግረዋል። እባክዎ ለማረጋገጫቸው ይጠብቁ።"
  },
  doTaskBtn: {
    en: "Do the task",
    am: "ተግዳሮቱን ስራ"
  },
  cancelBtn: {
    en: "Cancel",
    am: "አቋርጥ"
  },
  cancelConfirmed: {
  en: "You have successfully canceled this task.",
  am: "ተግዳሮቱን በተሳካ ሁኔታ ሰርዘዋል።"
  },
  creatorCancelNotification: {
    en: "[applicant] has canceled doing the task.",
    am: "[applicant] ተግዳሮቱን ለመስራት እንዳልተስማማ አሳውቋል።"
  },
  noConfirmationNotification: {
    en: "Sadly, none of the accepted task doers confirmed to still wanting to do the task. You can repost the task if you want. Taskifii is sorry for this.",
    am: "ይቅርታ፣ ምንም ከተቀባዮቹ ተግዳሮት አድራጊዎች ስራውን ለመስራት እንደሚፈልጉ አላረጋገጡም። ከፈለጉ ተግዳሮቱን እንደገና ልጥፉት ይችላሉ። Taskifii ይቅርታ ይጠይቃል።"
  },
  doerTimeUpNotification: {
    en: "Your time to confirm and start doing the task is up.",
    am: "ተግዳሮቱን ለመስራት የማረጋገጫ ጊዜዎ አልቋል።"
  },
  reminderNotification: {
    en: "⏰ Reminder: You have [hours] hour(s) and [minutes] minute(s) left to confirm this task by clicking 'Do the task' or 'Cancel'.",
    am: "⏰ ማስታወሻ: ይህን ተግዳሮት ለማረጋገጥ '[hours] ሰዓት(ዎች) እና [minutes] ደቂቃ(ዎች)' ቀርተዋል። 'ተግዳሮቱን ስራ' ወይም 'አቋርጥ' የሚለውን ቁልፍ ይጫኑ።"
  },
  taskNoLongerAvailable: {
    en: "This task is no longer available.",
    am: "ይህ ተግዳሮት ከማግኘት አልቋል።"
  },
  repostTaskBtn: {
    en: "Repost Task",
    am: "ተግዳሮቱን እንደገና ልጥፍ"
  },
  notSelectedNotification: {
    en: "Unfortunately, [creator] didn't choose you to do this task. Better luck next time!",
    am: "ይቅርታ፣ [creator] ይህን ተግዳሮት ለመስራት አልመረጡዎትም። በሚቀጥለው ጊዜ የተሻለ እድል ይኑርዎት!"
  },
  creatorCancelNotification: {
  en: "[applicant] has canceled doing the task.",
  am: "[applicant] ተግዳሮቱን ለመስራት እንዳልተስማማ አሳውቋል።"
  },
  taskExpired: {
  en: "Sorry, this task has expired and is no longer available for application.",
  am: "ይቅርታ፣ ይህ ተግዳሮት ጊዜው አልፎበታል እና ከእንግዲህ ለማመልከቻ አይገኝም።"
  },
  creatorSelfApplyError: {
  en: "You can't apply to tasks you created yourself.",
  am: "የራስዎን ተግዳሮት መመዝገብ አይችሉም።"
  },
  cancelConfirmed: {
  en: "You have successfully canceled this task.",
  am: "ተግዳሮቱን በተሳካ ሁኔታ ሰርዘዋል።"
  },
  languageBtn: {
  en: "Language",
  am: "ቋንቋ"
  },
  termsBtn: {
  en: "Terms & Conditions",
  am: "የታስኪፋይ ህግጋቶች"
  },
  taskAlreadyTaken: {
  en: "This task has already been taken.",
  am: "ይህ ተግዳሮት ቀድሞ ተወስዷል።"
  },
  missionAccomplishedBtn: {
    en: "Mission accomplished",
    am: "ሚሽኑ ተጠናቋል"
  },
  reportBtn: {
    en: "Report",
    am: "ሪፖርት"
  },
    ratingStarsRowHint: {
    en: "Tap a star (1–5).",
    am: "ከኮከቦች አንዱን ይጫኑ (1–5)."
  },
  ratingPromptToDoer: {
    en: (creatorName) => [
      "🎉 Great job finishing and delivering all the deliverables!",
      "Thank you for doing your part. Taskifii is happy to include you as a trustworthy, responsible and valuable member.",
      "",
      `🟢 Final step: Rate the Task Creator *${creatorName || '—'}* from 1 to 5 stars.`,
      "This is required before you can use Taskifii again.",
      "",
      "• 1 star: Very poor / Unsatisfactory",
      "• 2 stars: Poor / Below expectations",
      "• 3 stars: Average / Met expectations",
      "• 4 stars: Good / Exceeded expectations",
      "• 5 stars: Excellent / Outstanding"
    ].join("\n"),
    am: (creatorName) => [
      "🎉 ሁሉንም የተፈለጉ ነገሮች በትክክል አቅርቦ ስራውን አጠናቅተዋል!",
      "ክፍሎትን በመፈፀም እናመሰግናለን። Taskifii እርስዎን እንደ እምነታዊ፣ ተጠያቂ እና ውድ አባል ለማካተት ደስ ይላል።",
      "",
      `🟢 የመጨረሻ ደረጃ፡ የተግዳሮቱን ፈጣሪ *${creatorName || '—'}* ከ1 እስከ 5 ኮከብ ያድርጉ።`,
      "ይህ ከዚህ በኋላ ማገልገል ከመጀመርዎ በፊት አስፈላጊ ነው።",
      "",
      "• 1 ኮከብ፡ በጣም ደካማ / ያልተናመሰ",
      "• 2 ኮከብ፡ ደካማ / ከጠበቀ በታች",
      "• 3 ኮከብ፡ መካከለኛ / ጠበቀውን አሟላ",
      "• 4 ኮከብ፡ ጥሩ / ጠበቀውን አሻሽሎ",
      "• 5 ኮከብ፡ በጣም ጥሩ / አስደናቂ"
    ].join("\n")
  },
  ratingPromptToCreator: {
    en: (doerName) => [
      "🎉 Congrats on successfully delegating a task!",
      "Thank you for doing your part. Taskifii is happy to include you as a trustworthy and valuable member.",
      "",
      `🟢 Final step: Rate the Task Doer *${doerName || '—'}* from 1 to 5 stars.`,
      "This is required before you can use Taskifii again.",
      "",
      "• 1 star: Very poor / Unsatisfactory",
      "• 2 stars: Poor / Below expectations",
      "• 3 stars: Average / Met expectations",
      "• 4 stars: Good / Exceeded expectations",
      "• 5 stars: Excellent / Outstanding"
    ].join("\n"),
    am: (doerName) => [
      "🎉 ተግዳሮት በተሳካ ሁኔታ እንደ ሰጡ እንምስጋናለን!",
      "ክፍሎትን በመፈፀም እናመሰግናለን። Taskifii እርስዎን እንደ እምነታዊ እና ውድ አባል ለማካተት ደስ ይላል።",
      "",
      `🟢 መጨረሻ ደረጃ፡ የተግዳሮቱን አፈጻጸም ከ1 እስከ 5 ኮከብ እንዲያደርጉ *${doerName || '—'}* ይጠይቃሉ።`,
      "ይህ ከዚህ በኋላ መጠቀም ከመጀመርዎ በፊት አስፈላጊ ነው።",
      "",
      "• 1 ኮከብ፡ በጣም ደካማ / ያልተናመሰ",
      "• 2 ኮከብ፡ ደካማ / ከጠበቀ በታች",
      "• 3 ኮከብ፡ መካከለኛ / ጠበቀውን አሟላ",
      "• 4 ኮከብ፡ ጥሩ / ጠበቀውን አሻሽሎ",
      "• 5 ኮከብ፡ በጣም ጥሩ / አስደናቂ"
    ].join("\n")
  },
  ratingSuccessToDoer: {
    en: "✅ You’ve successfully rated the Task Creator. We hope you enjoyed using Taskifii.",
    am: "✅ የተግዳሮቱን ፈጣሪ በተሳካ ሁኔታ ያደረጉት። Taskifii መጠቀም እንደደሰትዎ እናምናለን።"
  },
  ratingSuccessToCreator: {
    en: "✅ You’ve successfully rated the Task Doer. We hope you enjoyed using Taskifii.",
    am: "✅ የተግዳሮቱን አፈጻጸም በተሳካ ሁኔታ ያደረጉት። Taskifii መጠቀም እንደደሰትዎ እናምናለን።"
  },
  relatedFileForYou: {
  en: "📎 The task creator attached this file for you.",
  am: "📎 የተግዳሮቱ ፈጣሪ ለእርስዎ ይህን ፋይል ላክቷል።"
  },
    completedSentBtn: {
    en: "Completed task sent",
    am: "ተግባሩ ተልኳል"
  },
  validBtn: {
    en: "Valid",
    am: "ትክክል ነው"
  },
  needsFixBtn: {
    en: "Needs Fixing",
    am: "ማስተካከል ይፈልጋል"
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
// --- Report/Escalation constants ---
const BAN_GROUP_ID = -1002239730204;        // group to ban/unban users in
const ESCALATION_CHANNEL_ID = -1002432632907; // channel for giant escalation message

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
// ------------------------------------
//  Task Management Utility Functions
// ------------------------------------

async function checkTaskExpiries(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      status: "Open",
      expiry: { $lte: now }
    }).populate("creator").populate("applicants.user");
    
    for (const task of tasks) {
      // FIRST - Update task status to Expired and save immediately
      task.status = "Expired";
      await task.save();

      // Disable application buttons for pending applications
      const pendingApps = task.applicants.filter(app => app.status === "Pending");
      for (const app of pendingApps) {
        if (app.messageId && task.creator) {
          try {
            const creator = task.creator;
            const lang = creator.language || "en";
            
            await bot.telegram.editMessageReplyMarkup(
              creator.telegramId,
              app.messageId,
              undefined,
              {
                inline_keyboard: [
                  [
                    Markup.button.callback(TEXT.acceptBtn[lang], "_DISABLED_ACCEPT"),
                    Markup.button.callback(TEXT.declineBtn[lang], "_DISABLED_DECLINE")
                  ]
                ]
              }
            );
          } catch (err) {
            console.error("Error disabling application buttons:", err);
          }
        }
      }

      // Handle accepted applications
      const acceptedApps = task.applicants.filter(app => app.status === "Accepted");
      for (const app of acceptedApps) {
        if (app.user && app.messageId) {
          try {
            const user = app.user;
            const lang = user.language || "en";
            
            await bot.telegram.editMessageReplyMarkup(
              user.telegramId,
              app.messageId,
              undefined,
              {
                inline_keyboard: [
                  [
                    Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK"),
                    Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_CANCEL_TASK")
                  ]
                ]
              }
            );
            
            // Notify doer that time is up
            await bot.telegram.sendMessage(
              user.telegramId,
              TEXT.doerTimeUpNotification[lang]
            );
          } catch (err) {
            console.error("Error disabling buttons for user:", app.user.telegramId, err);
          }
        }
      }
      // ✅ If nobody confirmed before expiry, unlock creator (and any stale doer locks)
      const noOneConfirmed = acceptedApps.length === 0 || !acceptedApps.some(a => a.confirmedAt);
      if (noOneConfirmed) {
        try {
          await releaseLocksForTask(task._id);
        } catch (e) {
          console.error("Failed to release locks on expiry:", e);
        }
      }

      // Reload the task to ensure we have the latest version with saved status
      const freshTask = await Task.findById(task._id);
      if (!freshTask) continue;

      // Check if we need to send the "no confirmation" notification
      const shouldSendNoConfirmation = 
        acceptedApps.length > 0 && 
        !acceptedApps.some(app => app.confirmedAt) && 
        !freshTask.repostNotified;

      // Check if we need to send the menu access notification
      const shouldSendMenuAccess = 
        (!freshTask.menuAccessNotified) && 
        (!shouldSendNoConfirmation && !acceptedApps.some(app => app.confirmedAt));

      // Send notifications if needed - NEW IMPROVED LOGIC
      const creator = await User.findById(freshTask.creator);
      if (creator) {
        const lang = creator.language || "en";
        
        // Use atomic update to ensure we only send once
        const updateResult = await Task.updateOne(
          { 
            _id: freshTask._id,
            repostNotified: { $ne: true } // Only update if not already notified
          },
          { 
            $set: { 
              repostNotified: shouldSendNoConfirmation,
              menuAccessNotified: shouldSendMenuAccess
            } 
          }
        );

        // Only send if we actually updated the document (prevent race conditions)
        if (updateResult.modifiedCount > 0) {
          if (shouldSendNoConfirmation) {
            await bot.telegram.sendMessage(
              creator.telegramId,
              TEXT.noConfirmationNotification[lang],
              Markup.inlineKeyboard([
                [Markup.button.callback(
                  TEXT.repostTaskBtn[lang], 
                  `REPOST_TASK_${freshTask._id}`
                )]
              ])
            );
          } else if (shouldSendMenuAccess) {
            await bot.telegram.sendMessage(
              creator.telegramId,
              lang === "am" 
                ? "ተግዳሮቱ ጊዜው አልፎታል። አሁን ምናሌውን መጠቀም ይችላሉ።" 
                : "The task has expired. You can now access the menu."
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in checkTaskExpiries:", err);
  }
  
  // Check again in 1 minute
  setTimeout(() => checkTaskExpiries(bot), 60000);
}
// ─── Utility: Release Payment & Finalize Task ─────────────────────────
// ── Updated releasePaymentAndFinalize Function ──
async function releasePaymentAndFinalize(taskId, reason) {
  try {
    // Load task, doer, creator, and payment info
    const task = await Task.findById(taskId).populate("creator").populate("applicants.user");
    if (!task) return;
    const doerApp = task.applicants.find(a => a.confirmedAt);
    if (!doerApp) return;
    const doer = doerApp.user;
    const creator = task.creator;
    
    // Calculate payout amount (minus 5% commission)
    const intent = await PaymentIntent.findOne({ task: task._id, status: "paid" });
    const totalAmount = intent ? intent.amount : (task.paymentFee || 0);
    const commission = Math.round(totalAmount * 5) / 100;  // 5% commission
    const payoutAmount = totalAmount - commission;

    // Fetch supported banks from Chapa
    let banksList = [];
    try {
      const resBanks = await fetch("https://api.chapa.co/v1/banks", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`
        }
      });
      const dataBanks = await resBanks.json().catch(() => null);
      if (!resBanks.ok || !dataBanks?.data) {
        console.error("Failed to fetch bank list from Chapa:", dataBanks || resBanks.statusText);
      } else {
        // Filter banks to ETB currency (if needed)
        banksList = dataBanks.data.filter(b => b.currency === "ETB");
      }
    } catch (err) {
      console.error("Error fetching bank list:", err);
    }
    
    if (!banksList.length) {
      // If we could not retrieve banks, log and finalize without payout
      console.error("No bank list available – skipping payout.");
      await creditIfNeeded('doerEarned', task, doer._id);
      await creditIfNeeded('creatorSpent', task, creator._id);
      const tg = globalThis.TaskifiiBot.telegram;
      await finalizeAndRequestRatings(reason, taskId, tg);
      return;
    }

    // Store payout context for this user (to be used in callbacks)
    global.pendingPayouts = global.pendingPayouts || {};
    global.pendingPayouts[doer.telegramId] = {
      taskId: String(task._id),
      doerId: doer._id,
      creatorId: creator._id,
      payoutAmount: payoutAmount.toFixed(2),
      reference: `task_payout_${task._id}`,
      banks: banksList,
      selectedBankId: null,
      accountPromptMessageId: null
    };

    // Prompt the doer to choose a bank from the fetched list
    const lang = doer.language || "en";
    const chooseBankText = (lang === "am") 
      ? "እባክዎ የእርስዎን ባንክ ይምረጡ።" 
      : "Please choose your bank for payout:";
    const firstPageButtons = buildBankKeyboard(String(task._id), banksList, 0, null);
    
    await globalThis.TaskifiiBot.telegram.sendMessage(
      doer.telegramId,
      `${chooseBankText}`,
      { reply_markup: firstPageButtons.reply_markup }
    );

    // Exit the function to wait for user input
    return;
  } catch (err) {
    console.error("Error in releasePaymentAndFinalize:", err);
  }
}
// Helper to build inline keyboard for a given page of banks (10 per page)
function buildBankKeyboard(taskId, banks, page, selectedBankId) {
  const FIELDS_PER_PAGE = 10;
  const start = page * FIELDS_PER_PAGE;
  const end = Math.min(start + FIELDS_PER_PAGE, banks.length);
  const keyboard = [];

  // Create a button for each bank on this page
  for (let i = start; i < end; i++) {
    const bank = banks[i];
    const isSelected = selectedBankId && selectedBankId === bank.id;
    const label = isSelected ? `✔ ${bank.name}` : bank.name;
    keyboard.push([
      Markup.button.callback(label, `PAYOUT_SELECT_${taskId}_${bank.id}`)
    ]);
  }

  // Navigation buttons for pagination
  const navButtons = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback("⬅️ Prev", `PAYOUT_PAGE_${taskId}_${page-1}`));
  }
  if (end < banks.length) {
    navButtons.push(Markup.button.callback("Next ➡️", `PAYOUT_PAGE_${taskId}_${page+1}`));
  }
  if (navButtons.length) {
    keyboard.push(navButtons);
  }

  return Markup.inlineKeyboard(keyboard);
}
async function checkPendingRefunds() {
  try {
    const pendings = await PaymentIntent.find({
      status: "paid",
      refundStatus: "pending",
    }).limit(50);

    for (const intent of pendings) {
      try {
        // Use the same reference you stored earlier (fallback to tx_ref)
        const ref = intent.chapaReference || intent.chapaTxRef;
        if (!ref) continue;

        // Re-verify using your smart verifier (live/test auto-pick)
        // Many providers reflect refund state on the same verify payload;
        // if Chapa exposes a dedicated refund-status endpoint, wire it here similarly.
        const v = await verifyChapaTxRefSmart(ref);

        // Heuristic: consider it settled when provider no longer reports it as
        // refundable and/or returns a refund object with success/completed.
        const settled =
          v.ok && v.data && v.data.data && (
            v.data.data.refund_status === "success" ||
            v.data.data.refund_status === "completed" ||
            v.data.data.status === "refunded"
          );

        if (settled) {
          await PaymentIntent.updateOne(
            { _id: intent._id },
            { $set: { refundStatus: "succeeded", refundedAt: new Date() } }
          );
          // (Optional) audit you already have
        }
        // else keep as pending
      } catch (e) {
        // Swallow and try again next run
      }
    }
  } catch (e) {
    console.error("checkPendingRefunds error:", e);
  }
}

// Normalizes ET mobile numbers to +2519xxxxxxxx / +2517xxxxxxxx; returns null if unknown.
function normalizeEtPhone(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  // Already E.164
  if (/^\+251[79]\d{8}$/.test(str)) return str;

  // Strip non-digits
  const digits = str.replace(/\D/g, "");

  // 09xxxxxxxx or 9xxxxxxxx or 07xxxxxxxx or 7xxxxxxxx
  if (/^0?[79]\d{8}$/.test(digits)) return `+251${digits.slice(-9)}`;

  // 2519xxxxxxxx or 2517xxxxxxxx
  if (/^251[79]\d{8}$/.test(digits)) return `+${digits}`;

  // Unknown format → don’t send
  return null;
}
// Email validator for onboarding (Chapa-safe)
function isValidEmail(email) {
  if (typeof email !== "string") return false;
  email = email.trim();

  // shape check
  const BASIC = /^[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!BASIC.test(email)) return false;

  // conservative TLD allow-list (adjust if you need more)
  const ALLOWED_TLDS = new Set([
    "com","net","org","co","io","ai","biz","info","xyz","dev","app","me",
    "site","shop","cloud","et","gov","edu"
  ]);

  const tld = email.toLowerCase().split(".").pop();
  return ALLOWED_TLDS.has(tld);
}
// This builds the big summary block with #refund and all identities.
// We send this ONCE per dispute.
function buildDisputeSummaryText({ task, creatorUser, doerUser }) {
  const lines = [
    "#refund",
    "🚨 *DISPUTE ESCALATION*",
    "",
    "👤 *TASK CREATOR DETAILS:*",
    `• Full Name: ${creatorUser.fullName || 'N/A'}`,
    `• Phone: ${creatorUser.phone || 'N/A'}`,
    `• Telegram: @${creatorUser.username || 'N/A'}`,
    `• Email: ${creatorUser.email || 'N/A'}`,
    `• Telegram ID: ${creatorUser.telegramId}`,
    `• User ID: ${creatorUser._id}`,
    "",
    "👥 *WINNER TASK DOER DETAILS:*",
    `• Full Name: ${doerUser.fullName || 'N/A'}`,
    `• Phone: ${doerUser.phone || 'N/A'}`,
    `• Telegram: @${doerUser.username || 'N/A'}`,
    `• Email: ${doerUser.email || 'N/A'}`,
    `• Telegram ID: ${doerUser.telegramId}`,
    `• User ID: ${doerUser._id}`,
    "",
    "📝 *TASK DETAILS:*",
    `• Description: ${task.description}`,
    `• Payment Fee: ${task.paymentFee} birr`,
    `• Time to Complete: ${task.timeToComplete} hour(s)`,
    `• Skill Level: ${task.skillLevel}`,
    `• Fields: ${Array.isArray(task.fields) ? task.fields.join(', ') : (task.fields || 'N/A')}`,
    `• Exchange Strategy: ${task.exchangeStrategy || 'N/A'}`,
    `• Revision Time: ${task.revisionTime} hour(s)`,
    `• Penalty per Hour: ${task.latePenalty} birr`,
    `• Posted At: ${task.postedAt}`,
    `• Expires At: ${task.expiry}`,
    "",
    "🔎 CONTEXT:",
    "• The doer claims the creator is demanding fixes not included in the original task description.",
    "• BOTH accounts are now temporarily banned from Taskifii and the dispute group.",
    "",
    "Below are the evidences. Order:",
    "1) Doer's original COMPLETED WORK",
    "2) Creator's FIX NOTICE / requested changes",
    "3) Doer's APPLICATION PITCH when they first applied",
    "4) Task Related File (if any)",
    "",
    "—— START OF ATTACHMENTS ——"
  ];

  return lines.join("\n");
}


// ── Chapa Hosted Checkout: Initialize & return checkout_url + tx_ref ─────────
// ── Chapa Hosted Checkout: Initialize & return checkout_url + tx_ref ─────────
// ── Chapa Hosted Checkout: Initialize & return checkout_url + tx_ref ─────────
// ── Chapa Hosted Checkout: Initialize & return checkout_url + tx_ref ─────────
async function chapaInitializeEscrow({ amountBirr, currency, txRef, user }) {
  const secret = defaultChapaSecretForInit();
  if (!secret) throw new Error("CHAPA secret missing");

  // Allow safe test overrides while you test
  const rawPhone  = user.phone || process.env.CHAPA_TEST_PHONE;
  const rawEmail0 = user.email || process.env.CHAPA_TEST_EMAIL;

  // Normalize phone: include only if valid Ethiopian format
  const normalizedPhone = normalizeEtPhone(user?.phone);
  const email = emailForChapa(user);      // ← existing helper

  const payload = {
    amount: String(amountBirr),
    currency,
    email,                                // ← always valid for Chapa now
    first_name: user.fullName ? user.fullName.split(" ")[0] : "Taskifii",
    last_name:  user.fullName ? (user.fullName.split(" ").slice(1).join(" ") || "User") : "User",
    tx_ref: txRef,
    callback_url: `${process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://taskifii-bot.onrender.com"}/chapa/ipn`,
  };

  if (normalizedPhone) payload.phone_number = normalizedPhone;

  // TEMP: log once so you can see exactly what's sent
  console.log("[Chapa init] email:", payload.email);

  const resp = await fetch("https://api.chapa.co/v1/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  const checkout = data?.data?.checkout_url;
  if (!resp.ok || !checkout) {
    throw new Error(`Chapa init failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return { checkout_url: checkout };
}

// Choose the right Chapa secret by mode
const CHAPA_SECRETS = {
  live: process.env.CHAPA_LIVE_SECRET_KEY || process.env.CHAPA_SECRET_KEY || "",
  test: process.env.CHAPA_TEST_SECRET_KEY || "",
};

// Internal: verify with a specific secret
async function _verifyChapaWithSecret(txRef, secret) {
  if (!secret) return { ok: false, data: null };
  const resp = await fetch(
    `https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`,
    { method: "GET", headers: { Authorization: `Bearer ${secret}` } }
  );
  const data = await resp.json().catch(() => null);
  const txStatus = String(data?.data?.status || "").toLowerCase();
  return { ok: resp.ok && txStatus === "success", data };
}

// Try live first (most likely), then test. Returns { ok, mode, data }
async function verifyChapaTxRefSmart(txRef) {
  if (CHAPA_SECRETS.live) {
    const r = await _verifyChapaWithSecret(txRef, CHAPA_SECRETS.live);
    if (r.ok) return { ok: true, mode: "live", data: r.data };
  }
  if (CHAPA_SECRETS.test) {
    const r = await _verifyChapaWithSecret(txRef, CHAPA_SECRETS.test);
    if (r.ok) return { ok: true, mode: "test", data: r.data };
  }
  return { ok: false, mode: null, data: null };
}

// Prefer live when configured; else test; else legacy
function defaultChapaSecretForInit() {
  return CHAPA_SECRETS.live || CHAPA_SECRETS.test || process.env.CHAPA_SECRET_KEY || "";
}

// Always give Chapa an email it will accept.
// Prefer user's real email if it looks normal, otherwise fall back to tg<id>@example.com.
function emailForChapa(user) {
  const raw = (user && typeof user.email === "string" ? user.email.trim() : "");

  // simple shape check
  const BASIC = /^[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  // TLD allow-list (extend if you like)
  const ALLOWED = new Set([
    "com","net","org","co","io","ai","biz","info","xyz","dev","app","me","site","shop","cloud",
    "et","gov","edu"
  ]);

  function ok(email) {
    if (!BASIC.test(email)) return false;
    const tld = email.toLowerCase().split(".").pop();
    return ALLOWED.has(tld);
  }

  if (ok(raw)) return raw;                               // user email is fine

  // If you still keep a test email in Render env, use it only if OK
  const envEmail = (process.env.CHAPA_TEST_EMAIL || "").trim();
  if (ok(envEmail)) return envEmail;

  // Last resort: guaranteed-safe placeholder (Chapa accepts it)
  const suffix = user?.telegramId ? String(user.telegramId).replace(/\D/g,"").slice(-12) : "user";
  return `tg${suffix}@example.com`;
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function safeTelegramCall(fn, ...args) {
  while (true) {
    try {
      return await fn(...args);
    } catch (err) {
      // rate limited?
      if (err.response && err.response.error_code === 429) {
        const retryAfterSec = err.response.parameters?.retry_after || 1;
        console.error("Rate limited, sleeping for", retryAfterSec, "seconds");
        await sleep(retryAfterSec * 1000);
        continue; // retry same call
      }
      // other error: give up on THIS message, but don't kill the whole escalation
      throw err;
    }
  }
}



// ── Refund helper (small, defensive) ─────────────────────────────────────────
// ── FIXED: use the correct Chapa refund endpoint ──────────────────────────────

// Chapa refund — verify first, then refund using Chapa's canonical reference if present
// Chapa refund — verify first, then refund using the correct mode/secret
async function refundEscrowWithChapa(intent, reason = "Task canceled by creator") {
  if (intent?.provider !== "chapa_hosted" || !intent?.chapaTxRef) {
    const err = new Error("Not a Chapa-hosted transaction (no chapaTxRef/provider mismatch).");
    err.code = "NOT_CHAPA_HOSTED";
    throw err;
  }

  const originalTxRef = String(intent.chapaTxRef).trim();

  // 1) Smart-verify (detects live/test)
  const v = await verifyChapaTxRefSmart(originalTxRef);
  if (!v.ok) {
    const e = new Error(`Cannot refund: verify failed or not paid.`);
    e.code = "VERIFY_FAILED";
    e.details = { verifyData: v.data };
    throw e;
  }

  // Pick the matching secret for refund
  const secret = v.mode === "test" ? CHAPA_SECRETS.test : CHAPA_SECRETS.live;
  if (!secret) throw new Error(`Missing Chapa ${v.mode} secret key`);

  // 2) Prefer Chapa canonical reference if provided
  const chapaReference =
    (v.data && v.data.data && (v.data.data.reference || v.data.data.tx_ref)) || originalTxRef;

  // 3) Refund (amount omitted = full refund; include if you want partial)
  const form = new URLSearchParams();
  if (intent.amount) form.append("amount", String(intent.amount));
  form.append("reason", reason);

  const res = await fetch(`https://api.chapa.co/v1/refund/${encodeURIComponent(chapaReference)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data?.status && String(data.status).toLowerCase() !== "success")) {
    throw new Error(
      `Refund API declined: ${res.status} ${JSON.stringify(data)} [mode=${v.mode} tx_ref=${chapaReference}]`
    );
  }
  return data;
}







// --- Minimal gate for non-registered users coming from "Apply" deep links ---
function buildRegistrationRequiredMessage() {
  // Single bilingual message + a button that kicks off the normal onboarding
  const en = [
    "👋 To access Taskifii (apply to tasks, see details, etc.), you need to register first.",
    "If you’d like to register now, tap */start* below."
  ].join("\n");

  const am = [
    "👋 ወደ Taskifii ለመዳረስ (ተግዳሮቶችን ለመመለከት እና ለመመልከት ወዘተ) መመዝገብ መጀመር አለብዎት።",
    "አሁን መመዝገብ ከፈለጉ ከታች ያለውን */start* ይጫኑ።"
  ].join("\n");

  return `${en}\n\n${am}`;
}

async function sendRegistrationRequired(ctx) {
  const msg = buildRegistrationRequiredMessage();
  await ctx.reply(msg, { parse_mode: "Markdown" }); // no reply_markup
}


// Middleware: intercept only when user came via apply_* AND is not fully registered
async function applyGatekeeper(ctx, next) {
  try {
    const tgId = ctx.from?.id;
    if (!tgId) return next();

    // Read existing user record (schema already in your code)
    const user = await User.findOne({ telegramId: tgId }).lean();

    // Detect deep-link payload "apply_<taskId>" from /start or t.me link
    const text = ctx.message?.text || "";
    const payloadFromText = text.startsWith("/start") ? text.split(" ")[1] || "" : "";
    const payload = ctx.startPayload || payloadFromText || "";

    const cameFromApply = typeof payload === "string" && payload.toLowerCase().startsWith("apply_");

    // Consider "registered" only if you've moved them past onboarding into the normal menu.
    // (Adjust the check below if your terminal step uses a different marker.)
    const isRegistered =
      !!user && user.onboardingStep && user.onboardingStep.     toLowerCase() === "completed";

    if (cameFromApply && !isRegistered) {
      await sendRegistrationRequired(ctx);
      return; // do NOT fall through to the rest of the flow
    }

    // Otherwise do nothing — let your existing handlers run
    return next();
  } catch (e) {
    // Fail open: if anything goes wrong, don’t block your existing flow
    return next();
  }
}


// Backward-compatible boolean verifier used around the codebase
async function verifyChapaTxRef(txRef) {
  const r = await verifyChapaTxRefSmart(txRef);
  return r.ok;
}


// Reuse this in both Telegram-invoice and Hosted-Checkout flows
async function postTaskFromPaidDraft({ ctx, me, draft, intent }) {
  // Create the task with postedAt timestamp
  const now = new Date();
  const expiryDate = new Date(now.getTime() + draft.expiryHours * 3600 * 1000);

  const task = await Task.create({
    creator: me._id,
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
    stages: [],
    postedAt: now,
    reminderSent: false
  });

  // Post to channel
  const channelId = process.env.CHANNEL_ID || "-1002254896955";
  const preview = buildChannelPostText(draft, me);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      me.language === "am" ? "ያመልክቱ / Apply" : "Apply / ያመልክቱ",
      applyDeepLink(ctx, BOT_USERNAME, task._id)
    )]
  ]);


  const tg = (ctx && ctx.telegram) ? ctx.telegram : (globalThis.TaskifiiBot && globalThis.TaskifiiBot.telegram);
  if (!tg) throw new Error("Telegram handle unavailable");
  const sent = await tg.sendMessage(channelId, preview, {
    parse_mode: "Markdown",
    reply_markup: keyboard.reply_markup
  });


  task.channelMessageId = sent.message_id;
  await task.save();
  await afterTaskPosted({ ctx, task, me, draft });

  // Lock the creator on this task so they can't act as a doer concurrently
  try {
    await EngagementLock.updateOne(
      { user: me._id, task: task._id },
      { $setOnInsert: { role: 'creator', active: true, createdAt: new Date() }, $unset: { releasedAt: "" } },
      { upsert: true }
    );
  } catch (e) {
    console.error("Failed to set creator engagement lock:", e);
  }

  // Link the paid PaymentIntent to this task (idempotent)
  try {
    if (intent?._id) {
      await PaymentIntent.findByIdAndUpdate(intent._id, { $set: { task: task._id } });
    } else if (intent?.payload) {
      await PaymentIntent.findOneAndUpdate(
        { user: me._id, payload: intent.payload },
        { $set: { task: task._id } },
        { new: true }
      );
    }
  } catch (e) {
    console.error("Failed to link PaymentIntent to task:", e);
  }

  // Delete the draft now that the task is live
  try {
    await TaskDraft.findByIdAndDelete(draft._id);
  } catch (e) {
    console.error("Failed to delete draft after payment:", e);
  }

  // find the "Send the same confirmation UI you already use" block and REPLACE it:
  const tg2 = (ctx && ctx.telegram) ? ctx.telegram
            : (globalThis.TaskifiiBot && globalThis.TaskifiiBot.telegram);
  if (!tg2) throw new Error("Telegram handle unavailable (confirmation)");

  const confirmationText = me.language === "am"
    ? `✅ ተግዳሮቱ በተሳካ ሁኔታ ተለጥፏል!\n\nሌሎች ተጠቃሚዎች አሁን ማመልከት ይችላሉ።`
    : `✅ Task posted successfully!\n\nOther users can now apply.`;

  await tg2.sendMessage(
    me.telegramId,
    confirmationText,
    Markup.inlineKeyboard([
      [Markup.button.callback(
        me.language === "am" ? "ተግዳሮት ሰርዝ" : "Cancel Task",
        `CANCEL_TASK_${task._id}`
      )]
    ])
  );

}
// ---- BEGIN: unified post-payment follow-ups ----
// ---- REPLACE your afterTaskPosted with this safe version ----
async function afterTaskPosted({ ctx, task, me, draft }) {
  const tg = (ctx && ctx.telegram) ? ctx.telegram
           : (globalThis.TaskifiiBot && globalThis.TaskifiiBot.telegram);
  if (!tg) { console.error("afterTaskPosted: telegram handle unavailable"); return; }

  // (A) DM: REMOVE this block to avoid duplicate confirmation + cancel button
  // try {
  //   const txt = me?.language === "am"
  //     ? "✅ ተግዳሮቱ በተሳካ ሁኔታ ተለጥፏል! ከዚህ ቻት ውስጥ ተግዳሮቱን መቆጣጠር ትችላለህ።"
  //     : "✅ Your task is live! You can manage it from this chat.";
  //   const kb  = Markup.inlineKeyboard([
  //     [Markup.button.callback(me?.language === "am" ? "ተግዳሮት ሰርዝ" : "Cancel Task", `CANCEL_TASK_${task._id}`)]
  //   ]);
  //   await tg.sendMessage(me.telegramId, txt, { reply_markup: kb.reply_markup });
  // } catch (e) {
  //   console.error("afterTaskPosted DM error:", e);
  // }

  // (B) profile/admin refresh (keep)
  try { if (typeof updateAdminProfilePost === "function") {
    await updateAdminProfilePost({ telegram: tg }, me);
  }} catch (e) { console.error("afterTaskPosted updateAdminProfilePost:", e); }

  // (C) timers (keep)
  try { if (typeof scheduleApplicationWindow === "function")
    await scheduleApplicationWindow(task._id, tg);
  } catch (e) { console.error("scheduleApplicationWindow:", e); }

  try { if (typeof maybeStartReportWindow === "function")
    await maybeStartReportWindow(task._id, tg);
  } catch (e) { console.error("maybeStartReportWindow:", e); }

  try { if (typeof scheduleAutoClose === "function")
    await scheduleAutoClose(task._id, tg);
  } catch (e) { console.error("scheduleAutoClose:", e); }

  // (D) preview cleanup (keep)
  try {
    if (draft?.previewChatId && draft?.previewMessageId) {
      await tg.deleteMessage(draft.previewChatId, draft.previewMessageId);
    }
  } catch (e) {
    console.warn("afterTaskPosted: preview cleanup failed:", e);
  }
}


// ---- END: unified post-payment follow-ups ----


async function sendWinnerTaskDoerToChannel(bot, task, doer, creator) {
  try {
    const channelId = "-1003092603337";
    
    // Build the detailed message
    const messageLines = [
      "🏆 *TASK ASSIGNMENT CONFIRMED*",
      "",
      "👤 *TASK CREATOR DETAILS:*",
      `• Full Name: ${creator.fullName || 'N/A'}`,
      `• Phone: ${creator.phone || 'N/A'}`,
      `• Telegram: @${creator.username || 'N/A'}`,
      `• Email: ${creator.email || 'N/A'}`,
      "",
      "👥 *TASK DOER DETAILS:*",
      `• Full Name: ${doer.fullName || 'N/A'}`,
      `• Phone: ${doer.phone || 'N/A'}`,
      `• Telegram: @${doer.username || 'N/A'}`,
      `• Email: ${doer.email || 'N/A'}`,
      "",
      "📝 *TASK DETAILS:*",
      `• Description: ${task.description}`,
      `• Payment Fee: ${task.paymentFee} birr`,
      `• Time to Complete: ${task.timeToComplete} hour(s)`,
      `• Skill Level: ${task.skillLevel}`,
      `• Fields: ${task.fields.join(', ')}`,
      `• Exchange Strategy: ${task.exchangeStrategy}`,
      `• Revision Time: ${task.revisionTime} hour(s)`,
      `• Penalty per Hour: ${task.latePenalty} birr`,
      `• Posted At: ${task.postedAt.toLocaleString("en-US", {
        timeZone: "Africa/Addis_Ababa",
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true
      })} GMT+3`,
      `• Expires At: ${task.expiry.toLocaleString("en-US", {
        timeZone: "Africa/Addis_Ababa",
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true
      })} GMT+3`,
      "",
      "#winnertaskdoer"
    ];

    const message = messageLines.join("\n");
    
    await bot.telegram.sendMessage(
      channelId,
      message,
      { parse_mode: "Markdown" }
    );
    
    console.log("Winner task doer notification sent to channel");
  } catch (err) {
    console.error("Failed to send winner task doer to channel:", err);
  }
}

async function sendAcceptedApplicationToChannel(bot, task, applicant, creator) {
  try {
    const channelId = "-1003092603337";
    
    // Build the detailed message
    const messageLines = [
      "📋 *TASK APPLICATION ACCEPTED*",
      "",
      "👤 *TASK CREATOR DETAILS:*",
      `• Full Name: ${creator.fullName || 'N/A'}`,
      `• Phone: ${creator.phone || 'N/A'}`,
      `• Telegram: @${creator.username || 'N/A'}`,
      `• Email: ${creator.email || 'N/A'}`,
      "",
      "👥 *TASK DOER DETAILS:*",
      `• Full Name: ${applicant.fullName || 'N/A'}`,
      `• Phone: ${applicant.phone || 'N/A'}`,
      `• Telegram: @${applicant.username || 'N/A'}`,
      `• Email: ${applicant.email || 'N/A'}`,
      "",
      "📝 *TASK DETAILS:*",
      `• Description: ${task.description}`,
      `• Payment Fee: ${task.paymentFee} birr`,
      `• Time to Complete: ${task.timeToComplete} hour(s)`,
      `• Skill Level: ${task.skillLevel}`,
      `• Fields: ${task.fields.join(', ')}`,
      `• Exchange Strategy: ${task.exchangeStrategy}`,
      `• Revision Time: ${task.revisionTime} hour(s)`,
      `• Penalty per Hour: ${task.latePenalty} birr`,
      `• Posted At: ${task.postedAt.toLocaleString("en-US", {
        timeZone: "Africa/Addis_Ababa",
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true
      })} GMT+3`,
      `• Expires At: ${task.expiry.toLocaleString("en-US", {
        timeZone: "Africa/Addis_Ababa",
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true
      })} GMT+3`,
      "",
      "#accepted"
    ];

    const message = messageLines.join("\n");
    
    await bot.telegram.sendMessage(
      channelId,
      message,
      { parse_mode: "Markdown" }
    );
    
    console.log("Accepted application notification sent to channel");
  } catch (err) {
    console.error("Failed to send accepted application to channel:", err);
  }
}
// put this near your other helpers/utilities
function botUsernameFrom(ctx, fallback) {
  return ((ctx && ctx.botInfo && ctx.botInfo.username) || fallback || "").replace(/^@/, "");
}
function applyDeepLink(ctx, fallbackUsername, taskId) {
  const uname = botUsernameFrom(ctx, fallbackUsername);
  const payload = `apply_${taskId}`;
  // Use tg:// to open the Telegram app directly
  return `tg://resolve?domain=${uname}&start=${payload}`;
}




function decisionsLocked(task) {
  // lock is true if we set decisionsLockedAt OR any applicant already confirmed
  return Boolean(task.decisionsLockedAt) || task.applicants?.some(a => !!a.confirmedAt);
}
// Fallback bot username for non-ctx flows (like webhooks)
let BOT_USERNAME = process.env.BOT_USERNAME || "";
(async () => {
  try {
    const me = await bot.telegram.getMe();
    BOT_USERNAME = me.username || BOT_USERNAME;
  } catch (_) {}
})();

// Format minutes to "X hours Y minutes" with basic EN/AM localization
function formatHM(totalMinutes, lang = "en") {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (lang === "am") {
    const hTxt = h > 0 ? `${h} ሰዓት` : "";
    const mTxt = m > 0 ? `${m} ደቂቃ` : "";
    return [hTxt, mTxt].filter(Boolean).join(" ");
  }
  const hTxt = h > 0 ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mTxt = m > 0 ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hTxt, mTxt].filter(Boolean).join(" ");
}

// Make a neat, structured list of a doer's bank options
function renderBankDetails(user, lang = "en") {
  if (!user?.bankDetails?.length) {
    return lang === "am" ? "• ምንም የክፍያ አማራጭ አልተጨመረም" : "• No banking options provided";
  }
  return user.bankDetails.map((b, i) => `• ${b.bankName || "Bank"} — ${b.accountNumber || "N/A"}`).join("\n");
}
// 👉 Add below renderBankDetails(...) and above buildWinnerCreatorMessage(...)
function buildExchangeAndSkillSection(task, lang = "en") {
  const lines = [];

  // Exchange strategy (with explanation)
  if (task.exchangeStrategy) {
    let desc = "";
    if (task.exchangeStrategy === "100%") {
      desc = TEXT.exchangeStrategyDesc100[lang];
    } else if (task.exchangeStrategy === "30:40:30") {
      desc = TEXT.exchangeStrategyDesc304030[lang];
    } else {
      // default to 50:50 description
      desc = TEXT.exchangeStrategyDesc5050[lang];
    }
    lines.push(
      lang === "am"
        ? `🔀 *የልውውጥ ስልት:* ${desc}`
        : `🔀 *Exchange Strategy:* ${desc}`
    );
  }

  // Skill level (with emoji)
  if (task.skillLevel) {
    const emoji =
      task.skillLevel === "Beginner" ? "🟢" :
      task.skillLevel === "Intermediate" ? "🟡" : "🔴";

    const levelText = lang === "am"
      ? (task.skillLevel === "Beginner"
          ? "ጀማሪ"
          : task.skillLevel === "Intermediate"
            ? "መካከለኛ"
            : "ሙያተኛ")
      : task.skillLevel;

    lines.push(
      lang === "am"
        ? `🎯 *የስልጠና ደረጃ:* ${emoji} ${levelText}`
        : `🎯 *Skill Level Required:* ${emoji} ${levelText}`
    );
  }

  return lines.length ? lines.join("\n") : "";
}

function buildWinnerCreatorMessage({ task, doer, creatorLang, totalMinutes, revMinutes, penaltyHoursToZero }) {
  const doerName = doer.fullName || (doer.username ? `@${doer.username}` : "Task Doer");
  const timeToCompleteH = task.timeToComplete; // integer hours
  const penaltyPerHour = task.penaltyPerHour ?? task.latePenalty ?? 0; // be tolerant to schema naming
  const paymentFee = task.paymentFee || 0;
  const revisionNice =
    revMinutes < 60
      ? (creatorLang === "am" ? `${revMinutes} ደቂቃ` : `${revMinutes} minute${revMinutes === 1 ? "" : "s"}`)
      : (creatorLang === "am"
          ? `${(revMinutes/60).toString()} ሰዓት`
          : `${(revMinutes/60).toString()} hour${revMinutes/60 === 1 ? "" : "s"}`);

  const totalNice = formatHM(totalMinutes, creatorLang);
  const banks = renderBankDetails(doer, creatorLang);
  const contactLines = [
    doer.phone ? (creatorLang === "am" ? `• ስልክ: ${doer.phone}` : `• Phone: ${doer.phone}`) : null,
    doer.username ? (creatorLang === "am" ? `• ቴሌግራም: @${doer.username}` : `• Telegram: @${doer.username}`) : null,
    doer.email ? (creatorLang === "am" ? `• ኢሜይል: ${doer.email}` : `• Gmail: ${doer.email}`) : null
  ].filter(Boolean).join("\n");

  if (creatorLang === "am") {
    return [
      `✅ *${doerName}* ከእንግዲህ ጀምሮ የተግዳሮትዎ ተግባራዊ አፈፃፀም አድርጎ ተመድቧል (100% ስልት).`,
      "",
      `• ከዚህ በኋላ አስከ *${timeToCompleteH} ሰዓት* ውስጥ ተግባሩን ያቅርቡ ዘንድ የጊዜ ገደብ አለ።`,
      `• የማሻሻያ ጊዜ፡ ${revisionNice}.`,
      `• በየሰዓቱ የቅጣት መጠን፡ ${penaltyPerHour} ብር/ሰዓት.`,
      "",
      `🧭 የጊዜ መቁጠሪያ ይጀምራል ከአሁን፤ ከሁሉም ጊዜዎች ድምር (መጨረሻ ማቅረብ + ማሻሻያ + 30 ደቂቃ ለክፍያ + የቅጣት ሰዓታት ${penaltyHoursToZero}) ጠቅላላ ጊዜ፡ *${totalNice}*.`,
      `• ተግባሩ በመጨረሻ ሲደርስ ተግባሩን ለእርስዎ በቀጥታ በቴሌግራም ወይም በጄሜል ይላካል። የመልእክት ሳጥኖችዎን በተደጋጋሚ ያረጋግጡ እስከ *${timeToCompleteH} ሰዓት*.`,
      `• ተግባሩ በዚያ ጊዜ ካልተላከ የቅጣት መቀነስ በየሰዓቱ ይጀምራል ( ${penaltyPerHour} ብር/ሰዓት ) እስከ 0 ድረስ (ግምት፡ ${penaltyHoursToZero} ሰዓታት).`,
      "",
      "💳 *የክፍያ አማራጮች የተደረጉ ቅንብሮች*",
      banks,
      "",
      "📞 *የአድራሻ መረጃ*",
      contactLines || "• የሚገኙ መረጃዎች አልተሞላም",
      "",
      "⚠️ ከተሰጠው መግለጫ ውጭ ስራ መድረግ አይቻልም።",
      "",
      `✅ ተግባሩ ሲፈቀድ እና እርስዎ ሲጸድቁ የክፍያ መረጃውን ለተግባር አድርጉ እና ደረሰኝ ለተልኮ።`,
      `⏳ በ *${totalNice}* ውስጥ “ሚሽኑ ተጠናቋል” ወይም “ሪፖርት” ካልጫኑ እኛ እንደ “ሚሽኑ ተጠናቋል” ተብሎ ይቆጠራል፤ ስለዚህ ጊዜን በጥንቃቄ ይከታተሉ።`
    ].join("\n");
  }

  return [
    `✅ *${doerName}* is now officially your task doer (strategy: 100%).`,
    "",
    `• Time to complete: *${timeToCompleteH} hour(s)*.`,
    `• Revision time: ${revisionNice}.`,
    `• Penalty per hour: ${penaltyPerHour} birr/hour.`,
    "",
    `🧭 A countdown starts now. Total window (complete + revision + 30 min to pay + penalty runway ${penaltyHoursToZero}h): *${totalNice}*.`,
    `• When the doer finishes, they will send the completed work directly to you via Telegram or Gmail — please check your inbox regularly during the *${timeToCompleteH} hours*.`,
    `• If the work isn’t submitted within that time, the fee begins decreasing by ${penaltyPerHour} birr each hour until it reaches 0 (est. ${penaltyHoursToZero} hour${penaltyHoursToZero === 1 ? "" : "s"}).`,
    "",
    "💳 *Doer’s banking option(s)*",
    banks,
    "",
    "📞 *Contact the doer*",
    contactLines || "• No contact info provided",
    "",
    "⚠️ You may not ask for anything outside the original task description.",
    "",
    `✅ After you approve the completed task, send the fee using the doer’s banking option(s) *and* send them the payment receipt.`,
    `⏳ If you don’t tap “Mission accomplished” or “Report” within *${totalNice}*, Taskifii will treat it as “Mission accomplished,” so please keep an eye on the time.`
  ].join("\n");
}
function buildWinnerDoerMessage({ task, creator, doerLang, totalMinutes, revMinutes, penaltyHoursToZero }) {
  const timeToCompleteH = task.timeToComplete || 0; // integer hours
  const penaltyPerHour = task.penaltyPerHour ?? task.latePenalty ?? 0; // tolerate older field names
  const totalNice = formatHM(totalMinutes, doerLang);

  const revNice =
    revMinutes < 60
      ? (doerLang === "am" ? `${revMinutes} ደቂቃ` : `${revMinutes} minute${revMinutes === 1 ? "" : "s"}`)
      : (doerLang === "am"
          ? `${(revMinutes/60).toString()} ሰዓት`
          : `${(revMinutes/60).toString()} hour${revMinutes/60 === 1 ? "" : "s"}`);

  const creatorHandle = creator?.username ? `@${creator.username}` : (doerLang === "am" ? "ያልተሰጠ" : "N/A");
  const creatorEmail  = creator?.email || (doerLang === "am" ? "ያልተሰጠ" : "N/A");
  const creatorPhone  = creator?.phone;

  const banks = renderBankDetails(task?.doerUser || creator, doerLang); // we’ll pass the actual doer user when calling

  if (doerLang === "am") {
    return [
      `🎉 እንኳን ደስ አለዎት! ከአሁን ጀምሮ ለዚህ ተግባር የስራ አከናውን ተመድበዋል።`,
      "",
      `📝 *የተግባሩ መግለጫ:* ${task.description}`,
      "",
      `📮 *ማቅረብ:* የተጠናቀቀውን ስራ በቀጥታ ለተግባር ፈጣሪው በቴሌግራም: ${creatorHandle} ወይም በጄሜይል: ${creatorEmail} ይላኩ እና ይህ በ *${timeToCompleteH} ሰዓት* ውስጥ መሆን አለበት።`,
      `⏱ ከዚያ በኋላ ተግባር ፈጣሪው ስርዓተ-ማሻሻያ ጊዜ *${revNice}* ይኖረዋል—ስለዚህ በዚያን ጊዜ ላይ በንቃት ዝግጁ ቆይታ ያድርጉ።`,
      "",
      `⚖️ ቅጣት: በ *${timeToCompleteH} ሰዓት* ውስጥ ካልተላከ ክፍያው በየሰዓቱ *${penaltyPerHour} ብር* ይቀንሳል እስከ 0 ድረስ (ግምት: ${penaltyHoursToZero} ሰዓት).`,
      "",
      `🧭 *ጠቅላላ መቁጠሪያ:* መስጠት + ማሻሻያ + 30 ደቂቃ ለክፍያ + የቅጣት መውረድ (${penaltyHoursToZero}h) ማስታሰቢያ ድምር = *${totalNice}*.`,
      `• በዚህ ጊዜ ውስጥ “*${TEXT.missionAccomplishedBtn.am}*” ወይም “*${TEXT.reportBtn.am}*” መጫን አለብዎት።`,
      `• በ *${totalNice}* ውስጥ የአንዱንም አቋራጭ ካላጫኑ ስርአቱ እንደ “*${TEXT.missionAccomplishedBtn.am}*” ተደርጓል ይቆጠራል—ስለዚህ ጊዜን በጥንቃቄ ይከታተሉ።`,
      "",
      `💳 *የክፍያ አማራጮችዎ:*`,
      banks,
      "",
      `🧾 እርስዎ የላኩት ስራ ከተጸየፈ በኋላ ፈጣሪው ክፍያውን በእነዚህ አማራጮች መካከል መላክ እና ደረሰኝ መላክ አለበት።`,
      creatorPhone ? `📞 ፈጣሪው ማመለስ ካቋረጠ በዚህ ስልክ ይደውሉ፡ ${creatorPhone}` : null,
      "",
      `⚠️ የመጀመሪያው የተግባር መግለጫ ውጭ ስራ መጠየቅ አይፈቀድም።`,
    ].filter(Boolean).join("\n");
  }

  // English
  return [
    `🎉 You are now the official task doer for this task.`,
    "",
    `📝 *Task description:* ${task.description}`,
    "",
    `📮 *Submit to the creator:* send the completed work directly via Telegram: ${creatorHandle} or Gmail: ${creatorEmail} within *${timeToCompleteH} hour(s)*.`,
    `⏱ After you submit, the creator has *${revNice}* for revisions—stay available and responsive during that time.`,
    "",
    `⚖️ Penalty: if the work isn’t submitted within the allotted time, the fee decreases by *${penaltyPerHour} birr/hour* until it reaches 0 (est. ${penaltyHoursToZero} hour${penaltyHoursToZero === 1 ? "" : "s"}).`,
    "",
    `🧭 *Overall timer:* complete + revision + 30 min for payment + penalty runway (${penaltyHoursToZero}h) = *${totalNice}*.`,
    `• Within this window you must tap “*${TEXT.missionAccomplishedBtn.en}*” (after receiving payment) or “*${TEXT.reportBtn.en}*” (if there’s a disagreement).`,
    `• If you don’t tap either within *${totalNice}*, Taskifii will treat it as “*${TEXT.missionAccomplishedBtn.en}*.”`,
    "",
    `💳 *Your banking option(s):*`,
    banks,
    "",
    `🧾 After the creator approves your work, they must send the task fee via your banking option(s) *and* send you the payment receipt.`,
    creatorPhone ? `📞 If the creator doesn’t reply on Telegram/Gmail, call: ${creatorPhone}` : null,
    "",
    `⚠️ The creator may not ask for anything outside the original task description.`,
  ].filter(Boolean).join("\n");
}

// Replace the old "hasActiveTask" with this lock-based version
async function hasActiveTask(telegramId) {
  try {
    const user = await User.findOne({ telegramId });
    if (!user) return false;

    // If there's an active EngagementLock, user is truly locked.
    const activeLock = await EngagementLock.findOne({ user: user._id, active: true }).lean();
    return !!activeLock;
  } catch (err) {
    console.error("Error checking active tasks:", err);
    return false;
  }
}


async function disableExpiredTaskApplicationButtons(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      $or: [
        { status: "Expired" }, // Already expired tasks
        { status: "Canceled" } // Canceled tasks
      ]
    }).populate("applicants.user");

    for (const task of tasks) {
      // Disable buttons for pending applications
      const pendingApps = task.applicants.filter(app => app.status === "Pending");
      for (const app of pendingApps) {
        if (app.user && app.messageId) {
          try {
            const creator = await User.findById(task.creator);
            const lang = creator?.language || "en";
            
            await bot.telegram.editMessageReplyMarkup(
              creator.telegramId,
              app.messageId,
              undefined,
              {
                inline_keyboard: [
                  [
                    Markup.button.callback(TEXT.acceptBtn[lang], "_DISABLED_ACCEPT"),
                    Markup.button.callback(TEXT.declineBtn[lang], "_DISABLED_DECLINE")
                  ]
                ]
              }
            );
          } catch (err) {
            console.error("Error disabling application buttons for task:", task._id, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in disableExpiredTaskApplicationButtons:", err);
  }
}

async function hasUserApplied(taskId, userId) {
  try {
    const task = await Task.findById(taskId).populate('applicants.user');
    if (!task) return false;
    
    return task.applicants.some(app => {
      // Handle both populated and unpopulated user references
      const applicantId = app.user?._id?.toString() || app.user?.toString();
      return applicantId === userId.toString();
    });
  } catch (err) {
    console.error("Error in hasUserApplied:", err);
    return false;
  }
}
async function checkPendingReminders(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      status: "Open",
      reminderSent: false,
      expiry: { $gt: now }
    }).populate("creator").populate("applicants.user");

    for (const task of tasks) {
      const totalTimeMs = task.expiry - task.postedAt;
      const reminderTime = new Date(task.postedAt.getTime() + (totalTimeMs * 0.85));

      // Skip if we haven't reached the 85% mark yet
      if (now < reminderTime) continue;

      // Check if any application has been accepted
      const hasAcceptedApplicant = task.applicants.some(app => app.status === "Accepted");
      
      // Only send reminder if no applications have been accepted
      if (!hasAcceptedApplicant) {
        const lang = task.creator.language || "en";
        const timeLeftMs = task.expiry - now;
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

        const message = lang === "am" 
          ? `⏰ ማስታወሻ: የተግዳሮትዎ ጊዜ እየቀረ ነው!\n\n` +
            `የተግዳሮትዎ የማብቂያ ጊዜ የሚቀረው: ${hoursLeft} ሰዓት እና ${minutesLeft} ደቂቃ\n\n` +
            `አመልካቾችን ለመቀበል የተቀረው ጊዜ በጣም አጭር ነው። እባክዎ በቅርቡ አመልካች ይምረጡ።`
          : `⏰ Reminder: Your task time is running out!\n\n` +
            `Time remaining for your task: ${hoursLeft} hours and ${minutesLeft} minutes\n\n` +
            `You have very little time left to accept applicants. Please select an applicant soon.`;

        await bot.telegram.sendMessage(task.creator.telegramId, message);
        task.reminderSent = true;
        await task.save();
      }
    }
  } catch (err) {
    console.error("Error in checkPendingReminders:", err);
  }
}
function computeTotalMinutes(task) {
  const timeToCompleteMins = (task.timeToComplete || 0) * 60;
  const revMinutes = Math.max(0, Math.round((task.revisionTime || 0) * 60));
  const penaltyPerHour = task.penaltyPerHour ?? task.latePenalty ?? 0;
  const fee = task.paymentFee || 0;
  const penaltyHoursToZero = penaltyPerHour > 0 ? Math.ceil(fee / penaltyPerHour) : 0;
  return timeToCompleteMins + revMinutes + 30 + (penaltyHoursToZero * 60);
}
function reportWindowOpen(task) {
  if (!task.decisionsLockedAt) return true; // be permissive if missing
  const totalMinutes = computeTotalMinutes(task);
  const deadline = new Date(task.decisionsLockedAt.getTime() + totalMinutes * 60 * 1000);
  return Date.now() <= deadline.getTime();
}

function acceptedDoerUser(task) {
  const winner = task.applicants?.find(a => a.status === "Accepted" && (!a.canceledAt));
  return winner?.user || null;
}
const EMPTY_STAR = "☆"; // outline star
const FILLED_STAR = "⭐"; // yellow star

async function releaseLockForUserTask(userId, taskId) {
  try {
    await EngagementLock.updateOne(
      { user: userId, task: taskId, active: true },
      { $set: { active: false, releasedAt: new Date() } }
    );
  } catch (e) { console.error("releaseLockForUserTask failed", e); }
}

function buildStarsRow(taskId, role, fillUpTo = 0, disabled = false) {
  const row = [];
  for (let i = 1; i <= 5; i++) {
    const label = i <= fillUpTo ? FILLED_STAR : EMPTY_STAR;
    const data  = disabled ? `_RATED_${taskId}_${role}` : `RATE_${taskId}_${role}_${i}`;
    row.push(Markup.button.callback(label, data));
  }
  return [row]; // single horizontal row
}

function renderUserProfileSummary(u, lang = "en") {
  const lines = [];
  lines.push(`• Full Name: ${u.fullName || (lang === 'am' ? 'ያልተሰጠ' : 'N/A')}`);
  lines.push(`• Username: ${u.username ? '@'+u.username : (lang === 'am' ? 'ያልተሰጠ' : 'N/A')}`);
  lines.push(`• Email: ${u.email || (lang === 'am' ? 'ያልተሰጠ' : 'N/A')}`);
  lines.push(`• Phone: ${u.phone || (lang === 'am' ? 'ያልተሰጠ' : 'N/A')}`);
  lines.push(`• Telegram ID: ${u.telegramId}`);
  lines.push(`• User ID: ${u._id.toString()}`);
  lines.push(`• Banks:\n${renderBankDetails(u, lang) || (lang==='am' ? '—' : '—')}`);
  lines.push(`• Ratings: ${(u.stats?.averageRating || 0).toFixed(2)} / 5 (${u.stats?.ratingCount || 0} ratings)`);
  lines.push(`• Total Earned: ${u.stats?.totalEarned || 0} birr`);
  lines.push(`• Total Spent:  ${u.stats?.totalSpent  || 0} birr`);
  return lines.join("\n");
}

function renderTaskSummary(t, lang="en") {
  const revMins = Math.max(0, Math.round((t.revisionTime || 0) * 60));
  const totalMinutes = computeTotalMinutes(t); // you already have this
  const totalNice = formatHM(totalMinutes, lang);
  const lines = [];
  lines.push(`• Task ID: ${t._id}`);
  lines.push(`• Description: ${t.description || (lang==='am' ? 'የለም' : 'N/A')}`);
  lines.push(`• Fee: ${t.paymentFee || 0} birr`);
  lines.push(`• Time to complete: ${t.timeToComplete || 0} h`);
  lines.push(`• Revision window: ${revMins} min`);
  lines.push(`• Penalty / hour: ${t.penaltyPerHour ?? t.latePenalty ?? 0} birr`);
  lines.push(`• Exchange strategy: ${(t.exchangeStrategy || '').trim() || (lang==='am' ? 'የለም' : 'N/A')}`);
  lines.push(`• Total window (including runway): ${totalNice}`);
  return lines.join("\n");
}

async function sendGiantSummaryToChannel(botOrTelegram, task, creator, doer) {
  const lang = creator?.language || "en";
  const header = "📣 *FINALIZATION SUMMARY*";
  const body = [
    header,
    "",
    "👤 *TASK CREATOR*",
    renderUserProfileSummary(creator, lang),
    "",
    "🧑‍🔧 *TASK DOER*",
    renderUserProfileSummary(doer, lang),
    "",
    "📝 *TASK DETAILS*",
    renderTaskSummary(task, lang)
  ].join("\n");
  try {
    await botOrTelegram.sendMessage(RATING_CHANNEL_ID, body, { parse_mode: "Markdown" });
  } catch (e) { console.error("sendGiantSummaryToChannel failed:", e); }
}

async function sendRatingPromptToUser(telegram, rater, ratee, role, task) {
  const lang = rater?.language || "en";
  const text = role === 'doerRatesCreator'
    ? TEXT.ratingPromptToDoer[lang](ratee?.fullName)
    : TEXT.ratingPromptToCreator[lang](ratee?.fullName);

  const keyboard = { inline_keyboard: buildStarsRow(task._id.toString(), role) };
  try {
    await telegram.sendMessage(rater.telegramId, text + "\n\n" + TEXT.ratingStarsRowHint[lang], {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (e) { console.error("sendRatingPromptToUser failed:", e); }
}

async function updateUserRating(toUserId, score) {
  const u = await User.findById(toUserId);
  if (!u) return;
  const count = u.stats?.ratingCount || 0;
  const avg   = u.stats?.averageRating || 0;
  const newAvg = ((avg * count) + score) / (count + 1);
  u.stats.averageRating = newAvg;
  u.stats.ratingCount   = count + 1;
  await u.save();
}


async function creditIfNeeded(type, task, userId) {
  const amount = task.paymentFee || 0;
  if (!amount) return;
  // ensure one-time credit per task+type
  try {
    await CreditLog.create({ task: task._id, user: userId, type, amount });
  } catch (e) {
    // already credited
    return;
  }
  const u = await User.findById(userId);
  if (!u) return;
  if (type === 'doerEarned') u.stats.totalEarned = (u.stats.totalEarned || 0) + amount;
  if (type === 'creatorSpent') u.stats.totalSpent = (u.stats.totalSpent  || 0) + amount;
  await u.save();
}

async function finalizeAndRequestRatings(reason, taskId, botOrTelegram) {
  const task = await Task.findById(taskId).populate("creator").populate("applicants.user");
  if (!task) return;
  const doer = acceptedDoerUser(task);
  if (!doer) return; // no winner
  const creator = task.creator;

  // Don’t run if escalated
  const escalated = await Escalation.findOne({ task: task._id }).lean();
  if (escalated) return;

  const state = await FinalizationState.findOneAndUpdate(
    { task: task._id },
    { $setOnInsert: { task: task._id } },
    { new: true, upsert: true }
  );

  // Only the first call should set concludedAt
  if (!state.concludedAt) {
    state.concludedAt = new Date();
    await state.save();

    // 1) Channel summary
    await sendGiantSummaryToChannel(botOrTelegram, task, creator, doer);
  }

  // 2) Always send rating prompts to BOTH users if not already sent
  if (!state.ratingPromptsSentAt) {
    state.ratingPromptsSentAt = new Date();
    await state.save();
  }

  // Ensure both prompts are delivered every time
  await sendRatingPromptToUser(botOrTelegram, doer, creator, 'doerRatesCreator', task);
  await sendRatingPromptToUser(botOrTelegram, creator, doer, 'creatorRatesDoer', task);
}


// check if we should finalize now (C = both tapped Mission early) or at timeout (A/B/D)
async function maybeTriggerAutoFinalize(taskId, reason, botOrTelegram) {
  const task = await Task.findById(taskId);
  if (!task) return;

  // don’t interfere if a report happened
  const escalated = await Escalation.findOne({ task: task._id }).lean();
  if (escalated) return;

  const st = await FinalizationState.findOne({ task: task._id }).lean();
  if (!st) return; // will be re-checked at timeout

  // If both have tapped Mission (scenario C), finalize immediately
  if (st.creatorMissionAt && st.doerMissionAt && !st.concludedAt) {
    return finalizeAndRequestRatings('both-mission', taskId, botOrTelegram);
  }
  // For A/B/D we wait for timeout; the timeout hook will call finalizeAndRequestRatings
}
// Tries several Telegram send methods so we don't need to know the original file type.
// We keep errors internal so nothing else in your flow is disrupted.
// ===== UPDATED sendTaskRelatedFile =====
// This tries to send any kind of file to a chat (photo, document, video, etc)
// using the file_id we stored. It now uses safeTelegramCall so that
// Telegram rate limit won't kill the dispute upload.
async function sendTaskRelatedFile(telegram, chatId, fileId) {
  if (!fileId) return;

  // We don't *know* what kind of file it is, so we try formats in order.
  // The first one that succeeds, we stop.
  // Each attempt is wrapped in safeTelegramCall so it auto-retries on 429.

  // Try sending as a document
  try {
    await safeTelegramCall(
      telegram.sendDocument.bind(telegram),
      chatId,
      fileId
    );
    return;
  } catch (eDoc) {
    // We'll try other types below.
    console.error("sendTaskRelatedFile: sendDocument failed, will try other types:", eDoc);
  }

  // Try as a photo
  try {
    await safeTelegramCall(
      telegram.sendPhoto.bind(telegram),
      chatId,
      fileId
    );
    return;
  } catch (ePhoto) {
    console.error("sendTaskRelatedFile: sendPhoto failed, will try video/audio/etc:", ePhoto);
  }

  // Try as a video
  try {
    await safeTelegramCall(
      telegram.sendVideo.bind(telegram),
      chatId,
      fileId
    );
    return;
  } catch (eVideo) {
    console.error("sendTaskRelatedFile: sendVideo failed:", eVideo);
  }

  // Try as an audio/voice
  try {
    await safeTelegramCall(
      telegram.sendAudio.bind(telegram),
      chatId,
      fileId
    );
    return;
  } catch (eAudio) {
    console.error("sendTaskRelatedFile: sendAudio failed:", eAudio);
  }

  try {
    await safeTelegramCall(
      telegram.sendVoice.bind(telegram),
      chatId,
      fileId
    );
    return;
  } catch (eVoice) {
    console.error("sendTaskRelatedFile: sendVoice failed:", eVoice);
  }

  // If all fail, just send the raw fileId as text so you at least see it
  try {
    await safeTelegramCall(
      telegram.sendMessage.bind(telegram),
      chatId,
      `⚠️ Could not auto-send this file. file_id:\n${fileId}`
    );
  } catch (eMsg) {
    console.error("sendTaskRelatedFile: even sendMessage failed:", eMsg);
  }
}
// Forward a list of recorded messages (like work.messages or work.fixRequests)
// to the dispute channel, preserving original formatting, captions, attachments,
// grouped media, etc. We send them in order, one by one.
// Send a labeled block of messages (e.g. completed work / fix notice / pitch)
// to the dispute channel, preserving original formatting, in order.
async function forwardMessageLogToDispute(
  telegram,
  disputeChatId,
  fromTelegramId,
  entries,
  headerText
) {
  if (!entries || !entries.length) return;

  // 1) send header ("📦 COMPLETED TASK ...", etc.)
  try {
    await safeTelegramCall(
      telegram.sendMessage.bind(telegram),
      disputeChatId,
      headerText
    );
  } catch (e) {
    console.error("forwardMessageLogToDispute header failed:", e);
  }

  // 2) now go one by one through each saved message
  for (const entry of entries) {
    // Try to copy the exact original message first (best quality)
    let copiedOk = false;
    if (entry.messageId) {
      try {
        await safeTelegramCall(
          telegram.copyMessage.bind(telegram),
          disputeChatId,
          fromTelegramId,
          entry.messageId
        );
        copiedOk = true;
      } catch (e) {
        console.error("forwardMessageLogToDispute copyMessage failed:", e);
      }
    }

    if (!copiedOk) {
      // Fallback 1: send raw fileIds (photos/docs/audio/etc.)
      if (entry.fileIds && entry.fileIds.length) {
        for (const fid of entry.fileIds) {
          try {
            await safeTelegramCall(
              sendTaskRelatedFile,
              telegram,
              disputeChatId,
              fid
            );
          } catch (e2) {
            console.error("sendTaskRelatedFile fallback failed:", e2);
          }
          // tiny pause between files
          await sleep(1000);
        }
      }

      // Fallback 2: send text and/or caption as plain messages if we have them
      if (entry.text) {
        try {
          await safeTelegramCall(
            telegram.sendMessage.bind(telegram),
            disputeChatId,
            entry.text
          );
        } catch (e3) {
          console.error("forwardMessageLogToDispute text fallback failed:", e3);
        }
        await sleep(1000);
      }

      if (entry.caption) {
        try {
          await safeTelegramCall(
            telegram.sendMessage.bind(telegram),
            disputeChatId,
            entry.caption
          );
        } catch (e4) {
          console.error("forwardMessageLogToDispute caption fallback failed:", e4);
        }
        await sleep(1000);
      }
    }

    // pause between each entry to respect Telegram flood limits
    await sleep(1000);
  }
}



async function autoFinalizeByTimeout(taskId, botOrTelegram) {
  try {
    const task = await Task.findById(taskId);
    if (!task) return;

    // Only finalize if within/at end of window AND not escalated
    if (reportWindowOpen(task)) return; // still open → not time yet
    const escalated = await Escalation.findOne({ task: task._id }).lean();
    if (escalated) return;

    const state = await FinalizationState.findOne({ task: task._id });
    if (state?.concludedAt) return;

    return finalizeAndRequestRatings('timeout', taskId, botOrTelegram);
  } catch (e) {
    console.error("autoFinalizeByTimeout error", e);
  }
}
async function escalateDoerReport(ctx, taskId) {
  const telegram = ctx.telegram;

  // ----- PHASE A: one-time critical actions -----
  // Load task, work, users, state
  const task = await Task.findById(taskId).populate('creator').lean();
  const work = await DoerWork.findOne({ task: taskId }).populate('doer').lean();
  const creatorUser = await User.findById(task.creator._id);
  const doerUser    = await User.findById(work.doer._id);

  // FinalizationState ensure
  let state = await FinalizationState.findOne({ task: taskId });
  if (!state) {
    state = new FinalizationState({ task: taskId });
  }

  // if already marked, we stop here to avoid duplicate bans + spam
  if (!state.doerReportedAt) {
    state.doerReportedAt = new Date();
    await state.save();

    // record Escalation (upsert)
    await Escalation.updateOne(
      { task: taskId },
      { $set: { task: taskId, by: doerUser._id, role: 'doer', createdAt: new Date() } },
      { upsert: true }
    );

    // ban both
    await banUserEverywhere(ctx, creatorUser);
    await banUserEverywhere(ctx, doerUser);

    // notify creator
    try {
      await telegram.sendMessage(
        creatorUser.telegramId,
        "⚠️ The task doer has reported you, claiming you tried to force fixes that were NOT in the original task description. Taskifii will investigate and make a final decision. Until then, you cannot access Taskifii."
      );
    } catch (e) {
      console.error("notify creator fail:", e);
    }

    // notify doer
    try {
      await telegram.sendMessage(
        doerUser.telegramId,
        "✅ ሪፖርትዎ ተቀብሏል። Taskifii ጉዳዩን በሙሉ ይመርማል እና መጨረሻ ውሳኔ ይሰጣል። እስካሁን ድረስ Taskifii መጠቀም አትችሉም።"
      );
    } catch (e) {
      console.error("notify doer fail:", e);
    }

    // send top summary block ONCE
    try {
      await safeTelegramCall(
        telegram.sendMessage.bind(telegram),
        DISPUTE_CHANNEL_ID,
        buildDisputeSummaryText({ task, creatorUser, doerUser }),
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      console.error("send dispute summary fail:", e);
    }
  }

  // ----- PHASE B: evidence streaming -----
  await forwardMessageLogToDispute(
    telegram,
    DISPUTE_CHANNEL_ID,
    work.doerTelegramId,
    work.messages,
    "📦 COMPLETED TASK (from Winner Task Doer):"
  );

  await forwardMessageLogToDispute(
    telegram,
    DISPUTE_CHANNEL_ID,
    creatorUser.telegramId,
    work.fixRequests,
    "✏️ FIX NOTICE (from Task Creator):"
  );

  // PITCH
  const winnerApp = (task.applicants || []).find(a =>
    a.status === "Accepted" &&
    !a.canceledAt &&
    a.user &&
    a.user.toString() === doerUser._id.toString()
  );

  if (winnerApp && winnerApp.pitchMessages && winnerApp.pitchMessages.length) {
    await forwardMessageLogToDispute(
      telegram,
      DISPUTE_CHANNEL_ID,
      doerUser.telegramId,
      winnerApp.pitchMessages,
      "💬 ORIGINAL APPLICATION PITCH:"
    );
  } else if (winnerApp && winnerApp.pitch) {
    await safeTelegramCall(
      telegram.sendMessage.bind(telegram),
      DISPUTE_CHANNEL_ID,
      "💬 ORIGINAL APPLICATION PITCH:\n" + winnerApp.pitch
    );
  }

  // TASK RELATED FILE
  if (task.relatedFile && task.relatedFile.fileId) {
    await safeTelegramCall(
      telegram.sendMessage.bind(telegram),
      DISPUTE_CHANNEL_ID,
      "📎 TASK RELATED FILE (from original task post):"
    );

    await safeTelegramCall(
      sendTaskRelatedFile,
      telegram,
      DISPUTE_CHANNEL_ID,
      task.relatedFile.fileId
    );
  }

  // final marker
  await safeTelegramCall(
    telegram.sendMessage.bind(telegram),
    DISPUTE_CHANNEL_ID,
    "—— END OF DISPUTE PACKAGE ——"
  );
}



async function banUserEverywhere(ctx, userDoc) {
  try { await Banlist.updateOne(
    { $or: [{ user: userDoc._id }, { telegramId: userDoc.telegramId }] },
    { $set: { user: userDoc._id, telegramId: userDoc.telegramId, bannedAt: new Date() } },
    { upsert: true }
  ); } catch(e) { console.error("banlist upsert failed", e); }

  try { await ctx.telegram.banChatMember(BAN_GROUP_ID, userDoc.telegramId); }
  catch (e) { console.warn("banChatMember failed (ignore):", e?.description || e?.message); }
}
async function unbanUserEverywhere(ctx, userDoc) {
  try { await Banlist.deleteOne({ $or: [{ user: userDoc._id }, { telegramId: userDoc.telegramId }] }); }
  catch (e) { console.error("banlist delete failed", e); }

  try { await ctx.telegram.unbanChatMember(BAN_GROUP_ID, userDoc.telegramId); }
  catch (e) { console.warn("unbanChatMember failed (ignore):", e?.description || e?.message); }

  // also release any engagement locks so menus/post/apply are usable again
  try { await EngagementLock.updateMany({ user: userDoc._id, active: true }, { $set: { active: false, releasedAt: new Date() } }); }
  catch (e) { console.error("release locks on unban failed", e); }
}
// Accepts EITHER a Telegraf bot OR ctx.telegram
async function sendEscalationSummaryToChannel(botOrTelegram, task, creator, doer, reportedByRole) {
  try {
    const lines = [
      "🚨 *TASK ESCALATED (Report clicked before Mission Accomplished)*",
      `• Reported by: *${reportedByRole.toUpperCase()}*`,
      "",
      "👤 *TASK CREATOR*",
      `• Full Name: ${creator.fullName || 'N/A'}`,
      `• Phone: ${creator.phone || 'N/A'}`,
      `• Telegram: @${creator.username || 'N/A'}`,
      `• Email: ${creator.email || 'N/A'}`,
      `• User ID: ${creator._id}`,
      "",
      "👥 *WINNER TASK DOER*",
      `• Full Name: ${doer?.fullName || 'N/A'}`,
      `• Phone: ${doer?.phone || 'N/A'}`,
      `• Telegram: @${doer?.username || 'N/A'}`,
      `• Email: ${doer?.email || 'N/A'}`,
      `• User ID: ${doer?._id || 'N/A'}`,
      "",
      "📝 *TASK DETAILS (10)*",
      `• Description: ${task.description}`,
      `• Payment Fee: ${task.paymentFee} birr`,
      `• Time to Complete: ${task.timeToComplete} hour(s)`,
      `• Skill Level: ${task.skillLevel}`,
      `• Fields: ${Array.isArray(task.fields) ? task.fields.join(', ') : (task.fields || 'N/A')}`,
      `• Exchange Strategy: ${task.exchangeStrategy}`,
      `• Revision Time: ${task.revisionTime} hour(s)`,
      `• Penalty per Hour: ${(task.penaltyPerHour ?? task.latePenalty) || 0} birr/hour`,
      `• Posted At: ${task.postedAt?.toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} GMT+3`,
      `• Expires At: ${task.expiry?.toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} GMT+3`,
      "",
      "#escalated"
    ];

    // If a full Telegraf bot was passed, use its .telegram; otherwise use the Telegram client directly
    const api = botOrTelegram.telegram ? botOrTelegram.telegram : botOrTelegram;

    await api.sendMessage(ESCALATION_CHANNEL_ID, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Failed to send escalation summary:", e);
  }
}


async function sendReminders(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      status: "Open",
      expiry: { $gt: now }
    }).populate("applicants.user");
    
    for (const task of tasks) {
      // Only get applications that:
      // - Are accepted
      // - Haven't been confirmed
      // - Haven't been canceled
      // - Haven't had a reminder sent yet
      const acceptedApps = task.applicants.filter(app => 
        app.status === "Accepted" && 
        !app.confirmedAt && 
        !app.canceledAt &&
        !app.reminderSent
      );
      
      if (acceptedApps.length === 0) continue;
      
      const totalDuration = task.expiry.getTime() - task.postedAt.getTime();
      const elapsed = now.getTime() - task.postedAt.getTime();
      const timeLeftMs = task.expiry.getTime() - now.getTime();
      
      // Calculate the exact 50% point
      const fiftyPercentPoint = totalDuration / 2;
      
      // Check if we're within 1 minute of the 50% mark
      const isAt50Percent = Math.abs(elapsed - fiftyPercentPoint) <= 60000;
      
      if (isAt50Percent) {
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
        
        for (const app of acceptedApps) {
          const doer = app.user;
          const doerLang = doer.language || "en";
          const message = TEXT.reminderNotification[doerLang]
            .replace("[hours]", hoursLeft.toString())
            .replace("[minutes]", minutesLeft.toString());
          
          try {
            await bot.telegram.sendMessage(
              doer.telegramId,
              message
            );
            
            // Mark that we've sent the reminder
            app.reminderSent = true;
            await task.save();
          } catch (err) {
            console.error("Error sending reminder to doer:", doer.telegramId, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in sendReminders:", err);
  }
  
  // Check again in 1 minute (this keeps the timing precise)
  setTimeout(() => sendReminders(bot), 60000);
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
const express = require('express');
const app = express();

// Add this health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});
// Health check endpoint
app.get("/", (_req, res) => res.send("OK"));
// Parse both JSON and classic HTML forms (Chapa uses form posts for IPN)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// put near your other Express routes / app.use(...) lines
// Accept BOTH form posts and JSON on the same route
app.post("/chapa/ipn", [express.urlencoded({ extended: true }), express.json()], async (req, res) => {

  try {
    // Ignore payout webhooks here. Those are handled in /chapa/payout
    if (req.body?.event === "payout.success" && req.body?.reference?.startsWith("task_payout_")) {
      // just acknowledge so Chapa stops retrying
      return res.status(200).send("ok");
    }
    // Chapa typically includes at least tx_ref (and sometimes reference/status) in the POST.
    const txRef = String(
      req.body?.tx_ref || req.body?.txRef || req.query?.tx_ref || ""
    ).trim();

    if (!txRef) {
      console.error("IPN missing tx_ref", req.body);
      return res.status(400).send("missing tx_ref");
    }

    // Double-check with Chapa (authoritative)
    const ok = await verifyChapaTxRef(txRef);
    if (!ok) {
      console.warn("IPN verify failed for tx_ref:", txRef, req.body);
      return res.status(400).send("verify_failed");
    }

    // Find or create the intent and mark paid (you already do this in your button flow)
    let intent = await PaymentIntent.findOne({ chapaTxRef: txRef });
    if (!intent) {
      // If ever missing, you can reconstruct from your drafts or store txRef->draft when you init.
      console.error("No PaymentIntent for tx_ref:", txRef);
      return res.status(404).send("intent_not_found");
    }

    if (intent.status !== "paid") {
      intent.status = "paid";
      intent.paidAt = new Date();
      await intent.save();
    }

    // Continue exactly as you do after a successful hosted verify click:
    const draft = await TaskDraft.findById(intent.draft);
    const me    = await User.findById(intent.user);
    if (!draft || !me) {
      console.error("IPN draft/user missing", { draft: !!draft, me: !!me, txRef });
      return res.status(404).send("draft_or_user_missing");
    }

    await postTaskFromPaidDraft({ ctx: null, me, draft, intent }); // ctx not required here
    return res.send("ok");
  } catch (e) {
    console.error("IPN handler error:", e);
    return res.status(500).send("error");
  }
});

// Transfer Approval Webhook (for Chapa server-side approval)
app.post("/chapa/transfer_approval", [express.urlencoded({ extended: true }), express.json()], async (req, res) => {
  try {
    // Chapa sends a signature in the headers and transfer details in the body
    const providedSignature = req.get("Chapa-Signature") || req.get("chapa-signature");
    if (!providedSignature) {
      console.error("Transfer approval request missing signature");
      return res.status(400).send("missing signature");
    }
    
    const secret = process.env.CHAPA_APPROVAL_SECRET || "";
    // Compute HMAC SHA256 of the secret
    const expectedSignature = require("crypto")
      .createHmac("sha256", secret)
      .update(secret)
      .digest("hex");
      
    if (providedSignature !== expectedSignature) {
      console.warn("Invalid Chapa approval signature:", providedSignature);
      return res.status(400).send("invalid signature");
    }

    // Optionally, verify the transfer details here
    const { reference, amount, bank, account_number } = req.body;
    console.log("✅ Transfer approval received for:", reference, amount, bank, account_number);
    
    // Since the signature is valid, approve the transfer
    return res.status(200).send("OK");
  } catch (e) {
    console.error("Error in transfer approval webhook:", e);
    return res.status(500).send("error");
  }
});

// NEW: Webhook endpoint for Chapa payout success events
app.post("/chapa/payout", async (req, res) => {
  try {
    // Chapa sends JSON payload with event="payout.success" and a reference field.
    const { event, reference } = req.body;
    // Only handle payout success events with our custom reference prefix
    if (event === "payout.success" && typeof reference === "string") {
      const prefix = "task_payout_";
      if (reference.startsWith(prefix)) {
        // Extract the taskId from the reference string
        const taskId = reference.slice(prefix.length);
        if (taskId) {
          // Mark the task as paid in the database
          // (Assumes Task model is already required as `const Task = require("./models/Task");`)
          const update = { paidAt: new Date() };
          // Optionally set a status or flag, e.g. status = "Completed" if desired:
          // update.status = "Completed";
          const result = await Task.updateOne({ _id: taskId }, { $set: update });
          if (result.matchedCount) {
            console.log(`Chapa payout webhook: marked Task ${taskId} as paid.`);
          } else {
            console.warn(`Chapa payout webhook: no Task found with id ${taskId}.`);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error handling Chapa payout webhook:", err);
    // (We still respond 200 to prevent retries, but you could use 500 to signal failure)
  }
  // Respond with 200 OK so Chapa knows we received the event
  res.sendStatus(200);
});



// Listen on Render’s port (or default 3000 locally)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Then connect to Mongo and launch the bot
mongoose
  .connect(process.env.MONGODB_URI, { autoIndex: true })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    const bot = startBot(); // Make sure startBot() returns the bot instance
    
    // Start the expiry checkers
    checkTaskExpiries(bot);
    sendReminders(bot);
    
    // Add these lines:
    checkPendingReminders(bot);
    // Run every hour to catch any missed reminders
    setInterval(() => checkPendingReminders(bot), 3600000);
async function retryQueuedRefunds() {
  try {
    const queued = await PaymentIntent.find({
      status: "paid",
      refundStatus: { $in: ["queued", "requested"] }
    }).limit(25);

    for (const intent of queued) {
      try {
        const data = await refundEscrowWithChapa(intent, "Retry queued refund");
        const task = await Task.findById(intent.task);
        const creator = task ? await User.findById(task.creator) : null;

        const chapaReference =
          (data && data.data && (data.data.reference || data.data.tx_ref)) || intent.chapaTxRef || null;
        const refundId =
          (data && data.data && (data.data.refund_id || data.data.refundId)) || null;

        await PaymentIntent.updateOne(
          { _id: intent._id },
          { $set: { refundStatus: "pending", refundedAt: null, chapaReference, refundId } }
        );

        if (task) {
          await sendRefundAudit(globalThis.TaskifiiBot, {
            tag: "#refundsuccessful",
            task, creator, intent,
            extra: { reason: "Retry queued refund (provider accepted)", chapaReference, refundId }
          });
        }
        console.log("Queued refund request accepted by provider:", intent._id.toString());
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        if (!msg.includes("insufficient balance")) {
          await PaymentIntent.updateOne(
            { _id: intent._id },
            { $set: { refundStatus: "failed" } }
          );
          console.error("Queued refund hard-failed:", intent._id.toString(), err);
        } else {
          console.log("Queued refund still waiting for funds:", intent._id.toString());
        }
      }
    }
  } catch (e) {
    console.error("retryQueuedRefunds error:", e);
  }
}


// run every 10 minutes
  setInterval(retryQueuedRefunds, 10 * 60 * 1000);
  
  setInterval(checkPendingRefunds, 15 * 60 * 1000);


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
  // 1) Make the bot available outside ctx (for webhooks/IPN)
  globalThis.TaskifiiBot = bot;

  // 2) Store a fallback username we can use when ctx is null
  let BOT_USERNAME = process.env.BOT_USERNAME || "";
  bot.telegram.getMe().then(me => { BOT_USERNAME = me.username || BOT_USERNAME; }).catch(() => {});

  if (!process.env.CHAPA_PROVIDER_TOKEN) {
    console.warn("⚠️ CHAPA_PROVIDER_TOKEN is not set — invoices will fail.");
  }
  bot.catch((err, ctx) => {
    console.error("Telegraf error", err);
  });
  process.on("unhandledRejection", (e) => console.error("Unhandled rejection", e));

  mongoose.set('strictQuery', false); // Add this line to suppress Mongoose warning
  const { session } = require('telegraf');
  
  // Add this session initialization middleware
  // Initialize session properly
  bot.use(session());
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
  // Global ban guard: blocks all actions for banned users except "ADMIN_UNBAN_*"
  bot.use(async (ctx, next) => {
    const tgId = ctx.from?.id;
    if (!tgId) return next();

    const banned = await Banlist.findOne({ telegramId: tgId }).lean();
    const isUnbanClick = ctx.updateType === 'callback_query'
      && /^ADMIN_UNBAN_/.test(ctx.callbackQuery?.data || '');

    if (banned && !isUnbanClick) {
      if (ctx.updateType === 'callback_query') {
        await ctx.answerCbQuery("You’re currently banned. Ask anyone to click “Unban User” under your profile post to restore access.", { show_alert: true });
        return;
      }
      await ctx.reply("You’re currently banned. Ask anyone to click “Unban User” under your profile post to restore access.");
      return;
    }
    return next();
  });
  // ─── Collect Doer's Corrected Submissions (after Fix Notice) ──────────────
  bot.on('message', async (ctx) => {
    try {
      const tgId = ctx.from?.id;
      if (!tgId) return;

      // Fast path: ignore commands and /start triggers outright
      const msg = ctx.message;
      if (!msg) return;
      const text = msg.text || msg.caption || "";

      if (text?.startsWith('/')) return; // includes /start and any other command

      // Ignore the lock warning messages (both languages) – these are bot messages, not doer submissions
      const LOCK_EN = "You're actively involved in a task right now, so you can't open the menu, post a task, or apply to other tasks until everything about the current task is sorted out.";
      const LOCK_AM = "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ምናሌን መክፈት፣ ተግዳሮት መለጠፍ ወይም ሌሎች ተግዳሮቶች ላይ መመዝገብ አይችሉም።";
      if (text === LOCK_EN || text === LOCK_AM) return; // just to be extra safe

      // Find the active revision task (awaiting_fix) for this doer
      const work = await DoerWork.findOne({
        doerTelegramId: tgId,
        currentRevisionStatus: 'awaiting_fix'
      });

      if (!work) return; // user is not currently fixing anything

      // Build a normalized entry describing *exactly* what the doer sent
      const entry = {
        messageId: msg.message_id,
        date: new Date(msg.date * 1000),
        type: msg.sticker ? 'sticker'
            : msg.photo ? 'photo'
            : msg.document ? 'document'
            : msg.video ? 'video'
            : msg.audio ? 'audio'
            : msg.voice ? 'voice'
            : msg.video_note ? 'video_note'
            : 'text'
      };
      if (msg.text) entry.text = msg.text;
      if (msg.caption) entry.caption = msg.caption;
      if (msg.media_group_id) entry.mediaGroupId = msg.media_group_id;

      if (msg.photo) entry.fileIds = msg.photo.map(p => p.file_id);
      else if (msg.document) entry.fileIds = [ msg.document.file_id ];
      else if (msg.video) entry.fileIds = [ msg.video.file_id ];
      else if (msg.audio) entry.fileIds = [ msg.audio.file_id ];
      else if (msg.voice) entry.fileIds = [ msg.voice.file_id ];
      else if (msg.sticker) entry.fileIds = [ msg.sticker.file_id ];
      else if (msg.video_note) entry.fileIds = [ msg.video_note.file_id ];

      // Append to correctedBuffer
      work.correctedBuffer = work.correctedBuffer || [];
      work.correctedBuffer.push(entry);
      await work.save();
    } catch (e) {
      console.error("Collect corrected submissions error:", e);
    }
  });
  // Add this middleware right after session initialization
  bot.use(async (ctx, next) => {
    try {
      // Only process APPLY_ actions from callback queries
      if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('APPLY_')) {
        const taskId = ctx.callbackQuery.data.split('_')[1];
        const user = await User.findOne({ telegramId: ctx.from.id });
        
        if (user && user.onboardingStep === 'completed') {
          const alreadyApplied = await hasUserApplied(taskId, user._id);
          if (alreadyApplied) {
            const lang = user.language || "en";
            await ctx.answerCbQuery(
              lang === "am" 
                ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
                : "You've already applied to this task.",
              { show_alert: true }
            );
            return; // Stop further processing
          }
        }
      }
      
      // Also check for /apply_ commands
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/apply_')) {
        const taskId = ctx.message.text.split('_')[1];
        const user = await User.findOne({ telegramId: ctx.from.id });
        
        if (user && user.onboardingStep === 'completed') {
          const alreadyApplied = await hasUserApplied(taskId, user._id);
          if (alreadyApplied) {
            const lang = user.language || "en";
            await ctx.reply(
              lang === "am" 
                ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
                : "You've already applied to this task."
            );
            return; // Stop further processing
          }
        }
      }
      
      await next();
    } catch (err) {
      console.error("Error in duplicate application check middleware:", err);
      await next();
    }
  });
  
  



   // Start the expiry checkers
  checkTaskExpiries(bot);
  sendReminders(bot);
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
// ───────────────── Engagement-lock guard (read-only gate) ─────────────────
bot.use(async (ctx, next) => {
  try {
    if (!ctx.from) return next();

    // If not locked, continue as normal
    if (!(await isEngagementLocked(ctx.from.id))) {
      return next();
    }

    // Compose the bilingual message without touching TEXT object
    const user = ctx.session?.user || await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || 'en';
    const lockedMsg = (lang === 'am')
      ? "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ምናሌን መክፈት፣ ተግዳሮቶች ላይ መመልከት/መመዝገብ ወይም ተግዳሮት መለጠፍ አይችሉም።"
      : "You're actively involved in a task right now, so you can't open the menu, post a task, or apply to other tasks until everything about the current task is sorted out.";

    // Detect both plain /start and /start with payload; also deep-link apply payloads
    const isStartCmd   = !!(ctx.message?.text?.startsWith('/start') || typeof ctx.startPayload === 'string');
    const isDeepLinkApply = !!(typeof ctx.startPayload === 'string' && ctx.startPayload.startsWith('apply_'));
    const isApplyCmd   = !!(ctx.message?.text?.startsWith('/apply_')); // /apply_<id>
    const data         = ctx.callbackQuery?.data;
    const isApplyBtn   = !!(data && data.startsWith('APPLY_'));
    const isFindTask   = (data === 'FIND_TASK');
    const isPostTask   = (data === 'POST_TASK');
    const isEditBack   = (data === 'EDIT_BACK');
    const isPostConfirm = (data === 'TASK_POST_CONFIRM');

    // Intercept these while locked
    if (isStartCmd || isDeepLinkApply || isApplyCmd || isApplyBtn || isFindTask || isPostTask || isEditBack || isPostConfirm) {
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      await ctx.reply(lockedMsg);
      return;
    }


    // Everything else continues normally
    return next();
  } catch (e) {
    console.error('engagement lock guard error:', e);
    return next();
  }
});
 
// After you create `bot` and before existing start/onboarding handlers:
bot.use(applyGatekeeper);



  // ─────────── /start Handler ───────────
  // ─────────── /start Handler ───────────
  // ─────────── /start Handler ───────────
  bot.start(async (ctx) => {
    // Initialize session
    ctx.session = ctx.session || {};
    // HARD-GUARD: block all menu/apply flows while engagement-locked
    if (await isEngagementLocked(ctx.from.id)) {
      const u0 = await User.findOne({ telegramId: ctx.from.id });
      const lang0 = (u0 && u0.language) ? u0.language : 'en';  // <— subtle but important

      const lockedMsg = (lang0 === 'am')
        ? "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ምናሌን መክፈት፣ ተግዳሮት መለጠፍ ወይም ሌሎች ተግዳሮቶች ላይ መመዝገብ አይችሉም።"
        : "You're actively involved in a task right now, so you can't open the menu, post a task, or apply to other tasks until everything about the current task is sorted out.";

      await ctx.reply(msg0);
      return;
    }

    // Check if user has an active task
    const hasActive = await hasActiveTask(ctx.from.id);
    if (hasActive) {
      const user = await User.findOne({ telegramId: ctx.from.id });
      const lang = user?.language || "en";
      
      return ctx.reply(
        lang === "am" 
          ? "ይቅርታ፣ አሁን አንድ ተግዳሮት እያስተዳደሩ ነው። ተግዳሮቱ ከጊዜው አልፎ ወይም ከተሰረዘ በኋላ ብቻ ምናሌውን መጠቀም ይችላሉ።" 
          : "Sorry, you currently have an active task. You can only access the menu after the task expires or is canceled."
      );
    }

    // Rest of your existing start handler remains exactly the same...
    const startPayload = ctx.startPayload;
    const tgId = ctx.from.id;
    let user = await User.findOne({ telegramId: tgId });

    // ===== ADD THIS CHECK RIGHT HERE =====
    // Check for expired task application and duplicate applications
    if (startPayload && startPayload.startsWith('apply_')) {
      const taskId = startPayload.split('_')[1];
      const task = await Task.findById(taskId);
      
       // Check if task is canceled
      if (task && task.status === "Canceled") {
        const lang = user?.language || "en";
        return ctx.reply(lang === "am" 
          ? "❌ ይህ ተግዳሮት በፈጣሪው ተሰርዟል" 
          : "❌ This task has been canceled by the creator"
        );
      }

      if (!task || task.status === "Expired") {
        const lang = user?.language || "en";
        return ctx.reply(TEXT.taskExpired[lang]);
      }
      
      // If a doer has already confirmed, show a simple message and stop.
      if (decisionsLocked(task)) {
        const lang = user?.language || "en";
        return ctx.reply(TEXT.taskAlreadyTaken[lang]);
      }
      // NEW CHECK: Prevent creators from applying to their own tasks
      if (user && task.creator.toString() === user._id.toString()) {
        const lang = user.language || "en";
        return ctx.reply(TEXT.creatorSelfApplyError[lang]);
      }
      // Check for existing application if user is already registered
      if (user && user.onboardingStep === "completed") {
        const alreadyApplied = await hasUserApplied(taskId, user._id);
        if (alreadyApplied) {
          const lang = user.language || "en";
          return ctx.reply(
            lang === "am" 
              ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
              : "You've already applied to this task."
          );
        }
      }
    }
    // ===== END OF ADDITION =====

    // Rest of your existing start handler...
    if (user && user.onboardingStep === "completed") {
      // If there's a start payload for applying to a task, process it
      if (startPayload && startPayload.startsWith('apply_')) {
        const taskId = startPayload.split('_')[1];
        ctx.session.applyFlow = {
          taskId,
          step: "awaiting_pitch"
        };

        const lang = user.language || "en";
        const prompt = lang === "am"
          ? "እባክዎ ዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
          : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
        return ctx.reply(prompt);
      }
      
      // If no start payload, show menu with new buttons
      const lang = user.language || "en";
      return ctx.reply(
        lang === "am" 
          ? "አገልግሎት ዝርዝር፡" 
          : "Menu:",
        Markup.inlineKeyboard([
          [Markup.button.callback(TEXT.postTaskBtn[lang], "POST_TASK")],
          [Markup.button.callback(TEXT.findTaskBtn[lang], "FIND_TASK")],
          [Markup.button.callback(TEXT.editProfileBtn[lang], "EDIT_PROFILE")],
          [Markup.button.callback(TEXT.languageBtn[lang], "CHANGE_LANGUAGE")],
          [Markup.button.callback(TEXT.termsBtn[lang], "VIEW_TERMS")]
        ])
      );
    }

    // Original onboarding flow for new/uncompleted users
    if (startPayload && startPayload.startsWith('apply_')) {
      const taskId = startPayload.split('_')[1];
      ctx.session.pendingTaskId = taskId;
      
      // Send language selection with custom message
      return ctx.reply(
        "To apply for tasks, you need to complete your Taskifii profile first.\n\n" +
        "ተግዳሮቶችን ለመመዝገብ በመጀመሪያ የ Taskifii መመዝገቢያ ሂደትዎን ማጠናቀቅ አለብዎት።\n\n" +
        `${TEXT.chooseLanguage.en}\n${TEXT.chooseLanguage.am}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("English", "LANG_EN"),
            Markup.button.callback("አማርኛ", "LANG_AM")
          ]
        ])
      );
    }

    // Continue with original onboarding flow
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
  });

  // Add handler for the /start button
  bot.action("START_REGISTRATION", async (ctx) => {
    await ctx.answerCbQuery();
    // Initialize session
    ctx.session = ctx.session || {};
    return ctx.reply("/start");
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
    
    // Check if there's a pending task to apply for
    if (ctx.session?.pendingTaskId) {
      const taskId = ctx.session.pendingTaskId;
      delete ctx.session.pendingTaskId;
      
      // Initialize apply flow
      ctx.session.applyFlow = {
        taskId,
        step: "awaiting_pitch"
      };

      const prompt = user.language === "am"
        ? "እባክዎ ዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና �ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
        : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
      
      return ctx.reply(prompt);
    }

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

//  ➤ 1st step: catch Apply button clicks

// ─── Apply Button Handler ───────────────────────────────────



// Updated APPLY_ handler to check for existing applications immediately

bot.action(/^APPLY_(.+)$/, async ctx => {
  try {
    await ctx.answerCbQuery();
    const taskId = ctx.match[1];
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";

    // First check if task exists and is expired
    const task = await Task.findById(taskId);
    if (!task || task.status === "Expired") {
      return ctx.answerCbQuery(
        lang === "am" 
          ? "❌ ይህ ተግዳሮት ጊዜው አልፎታል" 
          : "❌ This task has expired",
        { show_alert: true }
      );
    }
    // NEW CHECK: Prevent creators from applying to their own tasks
    if (task.creator.toString() === user._id.toString()) {
      return ctx.reply(TEXT.creatorSelfApplyError[lang]);
    }
    // Check for existing application immediately
    if (user && user.onboardingStep === 'completed') {
      const alreadyApplied = await hasUserApplied(taskId, user._id);
      if (alreadyApplied) {
        return ctx.answerCbQuery(
          lang === "am" 
            ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
            : "You've already applied to this task.",
          { show_alert: true }
        );
      }
    }

    // Rest of your existing application flow remains exactly the same...
    if (!user || user.onboardingStep !== "completed") {
      const message = lang === "am" 
        ? "ይቅርታ፣ ተግዳሮቶችን ለመመዝገብ በመጀመሪያ መመዝገብ አለብዎት።\n\nለመመዝገብ /start ይጫኑ" 
        : "Sorry, you need to register with Taskifii before applying to tasks.\n\nClick /start to register";
      
      const deepLink = applyDeepLink(ctx, BOT_USERNAME, taskId);
      
      return ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.url(
          lang === "am" ? "መመዝገቢያ ጀምር / Register" : "Register / መመዝገቢያ ጀምር", 
          deepLink
        )]
      ]));
    }

    // Initialize application flow
    ctx.session.applyFlow = {
      taskId,
      step: "awaiting_pitch"
    };

    const prompt = lang === "am"
      ? "እባክዎ ዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
      : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
    
    return ctx.reply(prompt);
  } catch (err) {
    console.error("Error in APPLY handler:", err);
    return ctx.reply("An error occurred. Please try again.");
  }
});
//  ➤ 2nd step: when user sends /apply_<taskId>, ask for their 20–500-char pitch
// Updated /apply_ handler to check for existing applications immediately
bot.hears(/^\/apply_(.+)$/, async ctx => {
  try {
    const taskId = ctx.match[1];
    const user = await User.findOne({ telegramId: ctx.from.id });
    const lang = user?.language || "en";

    // First check if task exists and is expired
    const task = await Task.findById(taskId);
    if (!task || task.status === "Expired") {
      return ctx.reply(
        lang === "am" 
          ? "❌ ይህ ተግዳሮት ጊዜው አልፎታል እና ከእንግዲህ ለማመልከቻ አይገኝም።" 
          : "❌ This task has expired and is no longer available for application."
      );
    }

    // NEW CHECK: Prevent creators from applying to their own tasks
    if (task.creator.toString() === user._id.toString()) {
      return ctx.reply(TEXT.creatorSelfApplyError[lang]);
    }
    // Check for existing application immediately
    if (user && user.onboardingStep === 'completed') {
      const alreadyApplied = await hasUserApplied(taskId, user._id);
      if (alreadyApplied) {
        return ctx.reply(
          lang === "am" 
            ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
            : "You've already applied to this task."
        );
      }
    }

    // Rest of your existing checks...
    if (!user || user.onboardingStep !== "completed") {
      const message = lang === "am" 
        ? "ይቅርታ፣ ተግዳሮቶችን ለመመዝገብ በመጀመሪያ መመዝገብ አለብዎት።\n\nለመመዝገብ /start ይጫኑ"
        : "Sorry, you need to register with Taskifii before applying to tasks.\n\nClick /start to register";
      
      return ctx.reply(message, Markup.inlineKeyboard([
        [Markup.button.callback("/start", "START_REGISTRATION")]
      ]));
    }

    ctx.session.applyFlow = {
      taskId,
      step: "awaiting_pitch",
      taskMessageId: ctx.message?.message_id
    };

    const prompt = lang === "am"
      ? "እባክዎ ለዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
      : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
    
    return ctx.reply(prompt);
  } catch (err) {
    console.error("Error in /apply handler:", err);
    return ctx.reply("An error occurred. Please try again.");
  }
});


// Updated handler for Accept button
bot.action(/^ACCEPT_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const userId = ctx.match[2];

  // Load task & basic guards (unchanged behavior for canceled/expired)
  const task = await Task.findById(taskId);
  if (!task || task.status === "Canceled") {
    const lang = ctx.session?.user?.language || "en";
    return ctx.answerCbQuery(
      lang === "am" ? "❌ ይህ ተግዳሮት ተሰርዟል" : "❌ This task has been canceled",
      { show_alert: true }
    );
  }
  if (task.status === "Expired") {
    const lang = ctx.session?.user?.language || "en";
    return ctx.answerCbQuery(
      lang === "am" ? "❌ ይህ ተግዳሮት ጊዜው አልፎታል" : "❌ This task has expired",
      { show_alert: true }
    );
  }

  // If a doer has already confirmed (first-click-wins), stop the flow.
  const creator = await User.findOne({ telegramId: ctx.from.id });
  const lang = creator.language || "en";
  if (decisionsLocked(task)) {
    return ctx.answerCbQuery(
      TEXT.taskAlreadyTaken[lang],
      { show_alert: true }
    );
  }

  const user = await User.findById(userId);
  
  if (!task || !user || !creator) {
    return ctx.reply("Error: Could not find task or user.");
  }
  

  // 🔒 If decisions are locked and this app is still Pending, be *inert* (silent no-op)
  if (decisionsLocked(task)) {
    const app = task.applicants.find(a => a.user.toString() === user._id.toString());
    if (app && app.status === "Pending") {
      await ctx.answerCbQuery(); // silent no-op
      return;
    }
  }

  // ⚙️ Atomic accept (only when not locked and still Pending)
  const applyOk = await Task.updateOne(
    {
      _id: task._id,
      $or: [{ decisionsLockedAt: { $exists: false } }, { decisionsLockedAt: null }],

      applicants: { $elemMatch: { user: user._id, status: "Pending" } }
    },
    { $set: { "applicants.$.status": "Accepted" } }
  );

  // If we couldn't modify (locked or no longer pending), be inert:
  if (!applyOk.modifiedCount) {
    await ctx.answerCbQuery(); // silent no-op
    return;
  }

  // (optional) persist the creator-side messageId for later inert/disable visuals
  const appNow = task.applicants.find(a => a.user.toString() === user._id.toString());
  if (appNow) {
    appNow.messageId = ctx.callbackQuery.message.message_id;
    await task.save();
  }

  // Nice-to-have visuals: highlight Accept, disable Decline (unchanged)
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✅ ${TEXT.acceptBtn[lang]}`, "_DISABLED_ACCEPT"),
        Markup.button.callback(TEXT.declineBtn[lang], "_DISABLED_DECLINE")
      ]]
    });
  } catch (err) {
    console.error("Failed to edit message buttons:", err);
  }

  // Notify the doer (same as before)
  const doerLang = user.language || "en";
  const expiryTime = task.expiry.toLocaleString(
    doerLang === "am" ? "am-ET" : "en-US",
    { timeZone: "Africa/Addis_Ababa", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }
  ) + " GMT+3";

  const acceptMessage = TEXT.applicationAccepted[doerLang].replace("[expiry time]", expiryTime);
  // Don't notify an applicant who's already engaged (as doer or creator)
  if (await isEngagementLocked(user.telegramId)) {
    const msg = lang === "am"
      ? "ይህ አመልካች አሁን ከሌላ ተግዳሮት ጋር ተጣመረ ነው ወይም ተግዳሮት እየለጠፈ ነው። የማረጋገጫ መልዕክት አይቀርብለውም። እባክዎ ሌላ አመልካች ይምረጡ።"
      : "This applicant is already committed to another task or is posting a task, so they won’t receive your confirmation. Please choose another applicant.";
    await ctx.reply(msg);
    return;
  }

  await ctx.telegram.sendMessage(
    user.telegramId,
    acceptMessage,
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.doTaskBtn[doerLang], `DO_TASK_CONFIRM_${task._id}`)],
      [Markup.button.callback(TEXT.cancelBtn[doerLang], `DO_TASK_CANCEL_${task._id}`)]

    ])
  );

  // (optional) channel ping you already had
  await sendAcceptedApplicationToChannel(bot, task, user, creator);

  // Notify creator (same as before)
  const applicantName = user.fullName || `@${user.username}` || "Anonymous";
  const creatorMessage = TEXT.creatorNotification[lang].replace("[applicant]", applicantName);
  return ctx.reply(creatorMessage);
});


// ✅ Updated handler for Decline button (first-click-wins safe, inert when locked)
bot.action(/^DECLINE_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const userId = ctx.match[2];

  // Load task & basic guards (unchanged behavior for canceled/expired)
  const task = await Task.findById(taskId);
  if (!task || task.status === "Canceled") {
    const lang = ctx.session?.user?.language || "en";
    return ctx.answerCbQuery(
      lang === "am" ? "❌ ይህ ተግዳሮት ተሰርዟል" : "❌ This task has been canceled",
      { show_alert: true }
    );
  }
  if (task.status === "Expired") {
    const lang = ctx.session?.user?.language || "en";
    return ctx.answerCbQuery(
      lang === "am" ? "❌ ይህ ተግዳሮት ጊዜው አልፎታል" : "❌ This task has expired",
      { show_alert: true }
    );
  }

  const user = await User.findById(userId);
  const creator = await User.findOne({ telegramId: ctx.from.id });
  if (!task || !user || !creator) {
    return ctx.reply("Error: Could not find task or user.");
  }
  const lang = creator.language || "en";

  // 🔒 If decisions are locked and this app is still Pending, be *inert* (silent no-op)
  if (decisionsLocked(task)) {
    const app = task.applicants.find(a => a.user.toString() === user._id.toString());
    if (app && app.status === "Pending") {
      await ctx.answerCbQuery(); // silent no-op
      return;
    }
  }

  // ⚙️ Atomic decline (only when not locked and still Pending)
  const declineOk = await Task.updateOne(
    {
      _id: task._id,
      $or: [{ decisionsLockedAt: { $exists: false } }, { decisionsLockedAt: null }],

      applicants: { $elemMatch: { user: user._id, status: "Pending" } }
    },
    { $set: { "applicants.$.status": "Declined" } }
  );

  // If we couldn't modify (locked or no longer pending), be inert:
  if (!declineOk.modifiedCount) {
    await ctx.answerCbQuery(); // silent no-op
    return;
  }

  // Nice-to-have visuals: highlight Decline, disable Accept (unchanged)
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(TEXT.acceptBtn[lang], "_DISABLED_ACCEPT"),
        Markup.button.callback(`✅ ${TEXT.declineBtn[lang]}`, "_DISABLED_DECLINE")
      ]]
    });
  } catch (err) {
    console.error("Failed to edit message buttons:", err);
  }

  // Notify doer (same as before)
  const doerLang = user.language || "en";
  await ctx.telegram.sendMessage(user.telegramId, TEXT.applicationDeclined[doerLang]);
});


bot.action("_DISABLED_CHANGE_LANGUAGE", async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action("_DISABLED_VIEW_TERMS", async (ctx) => {
  await ctx.answerCbQuery();
});
bot.action("_DISABLED_TASK_POST_CONFIRM", async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id });
  const lang = u?.language || "en";
  await ctx.answerCbQuery(
    lang === 'am'
      ? "በአሁኑ ጊዜ ተግዳሮት መለጠፍ አይችሉም፤ እባክዎ እስከሁኔታው ሲያበቃ ድረስ ይጠብቁ።"
      : "You can’t post a task right now. Please wait until the current task is resolved.",
    { show_alert: true }
  );
});

bot.action("_DISABLED_SET_LANG_EN", async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action("_DISABLED_SET_LANG_AM", async (ctx) => {
  await ctx.answerCbQuery();
});
// ─────────── Language Change Handler ───────────
bot.action("CHANGE_LANGUAGE", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found. Please /start again.");
  
  const lang = user.language || "en";
  
  // Disable all menu buttons but keep them in the same positions
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [Markup.button.callback(TEXT.postTaskBtn[lang], "_DISABLED_POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn[lang], "_DISABLED_FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn[lang], "_DISABLED_EDIT_PROFILE")],
      [Markup.button.callback(`✔ ${TEXT.languageBtn[lang]}`, "_DISABLED_CHANGE_LANGUAGE")],
      [Markup.button.callback(TEXT.termsBtn[lang], "_DISABLED_VIEW_TERMS")]
    ]
  });

  // Show language selection
  return ctx.reply(
    `${TEXT.chooseLanguage.en}\n${TEXT.chooseLanguage.am}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("English", "SET_LANG_EN"),
        Markup.button.callback("አማርኛ", "SET_LANG_AM")
      ]
    ])
  );
});

// ─────────── Terms View Handler ───────────
bot.action("VIEW_TERMS", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found. Please /start again.");
  
  const lang = user.language || "en";
  
  // Disable all menu buttons but keep them in the same positions
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [Markup.button.callback(TEXT.postTaskBtn[lang], "_DISABLED_POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn[lang], "_DISABLED_FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn[lang], "_DISABLED_EDIT_PROFILE")],
      [Markup.button.callback(TEXT.languageBtn[lang], "_DISABLED_CHANGE_LANGUAGE")],
      [Markup.button.callback(`✔ ${TEXT.termsBtn[lang]}`, "_DISABLED_VIEW_TERMS")]
    ]
  });

  // Show terms without agree/disagree buttons
  return ctx.reply(TEXT.askTerms[lang]);
});

// ─────────── Language Selection Handlers ───────────
bot.action("SET_LANG_EN", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found. Please /start again.");
  
  // Highlight "English"; disable "Amharic"
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [
        Markup.button.callback("✔ English", "_DISABLED_SET_LANG_EN"),
        Markup.button.callback("አማርኛ", "_DISABLED_SET_LANG_AM")
      ]
    ]
  });

  user.language = "en";
  await user.save();
  
  // Return to menu with new language
  return ctx.reply(
    "Language set to English.",
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.postTaskBtn.en, "POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn.en, "FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn.en, "EDIT_PROFILE")],
      [Markup.button.callback(TEXT.languageBtn.en, "CHANGE_LANGUAGE")],
      [Markup.button.callback(TEXT.termsBtn.en, "VIEW_TERMS")]
    ])
  );
});

bot.action("SET_LANG_AM", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("User not found. Please /start again.");
  
  // Highlight "Amharic"; disable "English"
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [
        Markup.button.callback("English", "_DISABLED_SET_LANG_EN"),
        Markup.button.callback("✔ አማርኛ", "_DISABLED_SET_LANG_AM")
      ]
    ]
  });

  user.language = "am";
  await user.save();
  
  // Return to menu with new language
  return ctx.reply(
    "ቋንቋው ወደ አማርኛ ተቀይሯል።",
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.postTaskBtn.am, "POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn.am, "FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn.am, "EDIT_PROFILE")],
      [Markup.button.callback(TEXT.languageBtn.am, "CHANGE_LANGUAGE")],
      [Markup.button.callback(TEXT.termsBtn.am, "VIEW_TERMS")]
    ])
  );
});



// Works for both: DO_TASK_CONFIRM  and  DO_TASK_CONFIRM_<taskId>
bot.action(/^DO_TASK_CONFIRM(?:_(.+))?$/, async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return;

  const lang = user.language || "en";
  const now  = new Date();
  const taskId = ctx.match && ctx.match[1]; // may be undefined for legacy buttons

  
  // If we have a taskId, use it. Otherwise fall back to your existing "find one" logic.
  let task = taskId
    ? await Task.findOne({
        _id: taskId,
        "applicants.user": user._id,
        "applicants.status": "Accepted",
        status: "Open",
        expiry: { $gt: now },
      })
    : await Task.findOne({
        "applicants.user": user._id,
        "applicants.status": "Accepted",
        status: "Open",
        expiry: { $gt: now },
      });
  // Already engaged? Make this message's buttons inert and stop.
  if (await isEngagementLocked(ctx.from.id)) {
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
          [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
        ],
      });
    } catch (_) {}

    await ctx.answerCbQuery(
      lang === 'am'
        ? "እርስዎ አሁን በአንድ ተግዳሮት ላይ ተሳትፈዋል። ይህ አዝራር አሁን ግባ የለውም።"
        : "You’re locked to another task right now; this button is disabled.",
      { show_alert: true }
    );
    return;
  }

  if (!task) {
    // Make buttons inert but don’t scare the user; keep your current UX
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
          [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
        ],
      });
    } catch (_) {}
    return;
  }

  // Your atomic "first click wins" gate, unchanged — just constrain by _id if present
  const updated = await Task.findOneAndUpdate(
    {
      _id: task._id,
      status: "Open",
      expiry: { $gt: now },
      $or: [{ decisionsLockedAt: { $exists: false } }, { decisionsLockedAt: null }],
      applicants: {
        $elemMatch: {
          user: user._id,
          status: "Accepted",
          confirmedAt: null,
          canceledAt: null,
        },
      },
      $nor: [{ applicants: { $elemMatch: { confirmedAt: { $exists: true, $ne: null } } } }],
    },
    { $set: { "applicants.$.confirmedAt": now, decisionsLockedAt: now } },
    { new: true }
  );
  
  if (!updated) {
    // Your exact follow-ups (already in your file): show expired / someone-else / inert
    const fresh = await Task.findById(task._id).lean();
    const myApp = fresh?.applicants?.find(a => a.user && a.user.toString() === user._id.toString());

    if (myApp?.confirmedAt) {
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [Markup.button.callback(`✔ ${TEXT.doTaskBtn[lang]}`, "_DISABLED_DO_TASK_CONFIRM")],
            [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
          ],
        });
      } catch (_) {}
      return;
    }

    const isExpired = fresh?.status === "Expired" || (fresh?.expiry && new Date(fresh.expiry) <= now);
    if (isExpired) {
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
            [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
          ],
        });
      } catch (_) {}
      return ctx.reply(lang === "am" ? "❌ ይህ ተግዳሮት ጊዜው አልፎታል።" : "❌ This task has expired.");
    }

    const someoneElseConfirmed = fresh?.applicants?.some(a => a.confirmedAt && a.user?.toString() !== user._id.toString());
    if (someoneElseConfirmed) {
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
            [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
          ],
        });
      } catch (_) {}
      return ctx.reply(lang === "am" ? "❌ ቀደም ሲል ሌላ አመልካች ጀምሮታል።" : "❌ Someone else already started this task.");
    }

    await ctx.answerCbQuery(); // inert, nothing else to do
    return;
  }

  // Winner visuals (unchanged)
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(`✔ ${TEXT.doTaskBtn[lang]}`, "_DISABLED_DO_TASK_CONFIRM")],
        [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
      ],
    });
  } catch (err) {
    console.error("Error highlighting/locking buttons:", err);
  }

  // 1. we already know `task` / `updated` / `user` from earlier in this handler
  // make sure creatorUser exists FIRST so we can use it later
  let creatorUser = await User.findById(updated.creator);

  // 2. lock both sides so nobody else can take it
  try {
    if (creatorUser) {
      await lockBothForTask(updated, user._id, creatorUser._id);
    }
  } catch (e) {
    console.error("failed to set engagement locks:", e);
  }

  // 3. if the task had an attached file, send it to the doer
  try {
    if (updated?.relatedFile) {
      await sendTaskRelatedFile(ctx.telegram, user.telegramId, updated.relatedFile);
      const langForFile = user.language || "en";
      await ctx.telegram.sendMessage(user.telegramId, TEXT.relatedFileForYou[langForFile]);
    }
  } catch (e) {
    console.error("Failed to send related file to doer:", e);
  }

  // 4. BUILD THE MESSAGE FOR THE DOER (🎉 ... + bank info + penalties + extra)
  //    we do this BEFORE sending anything, so doerMsg is defined
  const doerLang = user.language || "en";

  // timing numbers used in both messages
  const timeToCompleteMins = (updated.timeToComplete || 0) * 60;
  const revMinutes = Math.max(0, Math.round((updated.revisionTime || 0) * 60));
  const penaltyPerHour = updated.penaltyPerHour ?? updated.latePenalty ?? 0;
  const fee = updated.paymentFee || 0;
  const penaltyHoursToZero = penaltyPerHour > 0
    ? Math.ceil(fee / penaltyPerHour)
    : 0;

  // total window = complete time + revision time + 30min payment window + penalty runway
  const totalMinutes =
    timeToCompleteMins + revMinutes + 30 + (penaltyHoursToZero * 60);

  // let buildWinnerDoerMessage() render correct banking info for THIS doer
  updated.doerUser = user;

  const doerText = buildWinnerDoerMessage({
    task: updated,
    creator: creatorUser,
    doerLang,
    totalMinutes,
    revMinutes,
    penaltyHoursToZero
  });

  const extra = buildExchangeAndSkillSection(updated, doerLang);

  // final combined message that starts with "🎉 You are now the official task doer..."
  const doerMsg = [doerText, extra].filter(Boolean).join("\n\n");

  // 5. CREATE / UPSERT DoerWork, START TIMER, SEND doerMsg WITH BUTTON
  try {
    const langForDoer = user.language || "en";

    const tHours = Number(updated?.timeToComplete || 0);
    const startedAt  = new Date();
    const deadlineAt = new Date(
      startedAt.getTime() + Math.max(1, tHours) * 60 * 60 * 1000
    );

    const doerWork = await DoerWork.findOneAndUpdate(
      { task: updated._id },
      {
        $setOnInsert: {
          task: updated._id,
          doer: user._id,
          doerTelegramId: user.telegramId,
          startedAt,
          deadlineAt,
          status: "active",
          messages: []
        }
      },
      { new: true, upsert: true }
    );

    // send ONE message to the doer:
    // - the big 🎉 message
    // - with the "Completed task sent" button under it
    const controlMsg = await ctx.telegram.sendMessage(
      user.telegramId,
      doerMsg,
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback(
              TEXT.completedSentBtn[langForDoer],
              `COMPLETED_SENT_${String(updated._id)}`
            )
          ]
        ]).reply_markup
      }
    );

    // remember the message id (so later when they tap Completed task sent,
    // you can edit this SAME message to show the ✔ version)
    if (!doerWork.doerControlMessageId) {
      doerWork.doerControlMessageId = controlMsg.message_id;
      await doerWork.save();
    }

  } catch (e) {
    console.error("Failed to initialize DoerWork/timer:", e);
  }

  // 6. SEND MESSAGE TO CREATOR (the one that explains timing, penalties, contact, etc.)
  try {
    // Only send if the exchange strategy allows it (you had this logic already)
    if (["100%","30:40:30","50:50"].includes((updated.exchangeStrategy || "").trim())) {
      const creatorLang = (creatorUser && creatorUser.language) || (user.language || "en");

      const timeToCompleteMinsC = (updated.timeToComplete || 0) * 60;
      const revMinutesC = Math.max(0, Math.round((updated.revisionTime || 0) * 60));
      const penaltyPerHourC = updated.penaltyPerHour ?? updated.latePenalty ?? 0;
      const feeC = updated.paymentFee || 0;
      const penaltyHoursToZeroC = penaltyPerHourC > 0
        ? Math.ceil(feeC / penaltyPerHourC)
        : 0;

      const totalMinutesC =
        timeToCompleteMinsC + revMinutesC + 30 + (penaltyHoursToZeroC * 60);

      const creatorText = buildWinnerCreatorMessage({
        task: updated,
        doer: user,
        creatorLang,
        totalMinutes: totalMinutesC,
        revMinutes: revMinutesC,
        penaltyHoursToZero: penaltyHoursToZeroC
      });

      const extraForCreator = buildExchangeAndSkillSection(updated, creatorLang);
      const creatorMsg = [creatorText, extraForCreator].filter(Boolean).join("\n\n");

      if (creatorUser) {
        await ctx.telegram.sendMessage(
          creatorUser.telegramId,
          creatorMsg,
          { parse_mode: "Markdown" }
        );
      }
    }
  } catch (e) {
    console.error("Failed to send creator summary:", e);
  }

  // 7. ANNOUNCE TO CHANNEL / UPDATE UI FOR CREATOR
  try {
    const freshCreator = await User.findById(updated.creator);
    if (freshCreator) {
      await sendWinnerTaskDoerToChannel(bot, updated, user, freshCreator);
    }
  } catch (e) {
    console.error("Failed to sendWinnerTaskDoerToChannel:", e);
  }

  
  
  

});

bot.action("_DISABLED_DO_TASK_CONFIRM", async (ctx) => { await ctx.answerCbQuery(); });
bot.action("_DISABLED_DO_TASK_CANCEL",  async (ctx) => { await ctx.answerCbQuery(); });

// CREATOR: Mission (inert if escalated)


// RATE buttons: RATE_<taskId>_(doerRatesCreator|creatorRatesDoer)_<1..5>
bot.action(/^RATE_([a-f0-9]{24})_(doerRatesCreator|creatorRatesDoer)_(\d)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const [ , taskId, role, raw ] = ctx.match;
  const score = Math.max(1, Math.min(5, parseInt(raw,10)));

  const raterTgId = ctx.from.id;
  const rater = await User.findOne({ telegramId: raterTgId });
  if (!rater) return;

  const task = await Task.findById(taskId).populate("creator").populate("applicants.user");
  if (!task) return;

  const doer = acceptedDoerUser(task);
  if (!doer) return;

  const isDoerRater    = (role === 'doerRatesCreator');
  const expectedRaterId = isDoerRater ? doer._id.toString() : task.creator._id.toString();
  if (rater._id.toString() !== expectedRaterId) {
    return ctx.answerCbQuery("Not allowed.", { show_alert: true });
  }
  const ratee = isDoerRater ? task.creator : doer;

  // upsert rating (unique per task+from+role)
  try {
    await Rating.create({
      task: task._id, from: rater._id, to: ratee._id, role, score
    });
  } catch (e) {
    // likely duplicate → stop buttons
  }

  // paint stars: fill up to selected and disable
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: buildStarsRow(task._id.toString(), role, score, true)
    });
  } catch (_) {}

  // update target’s average & count
  await updateUserRating(ratee._id, score);

  // mark who rated in finalization state
  await FinalizationState.updateOne(
    { task: task._id },
    { $set: isDoerRater ? { doerRatedAt: new Date() } : { creatorRatedAt: new Date() } },
    { upsert: true }
  );

  const lang = rater.language || "en";
  if (isDoerRater) {
    await ctx.reply(TEXT.ratingSuccessToDoer[lang]);
    // unlock ONLY the doer, and credit their earnings exactly once
    await releaseLockForUserTask(rater._id, task._id);
    await creditIfNeeded('doerEarned', task, rater._id);
  } else {
    await ctx.reply(TEXT.ratingSuccessToCreator[lang]);
    // unlock ONLY the creator, and credit their spending exactly once
    await releaseLockForUserTask(rater._id, task._id);
    await creditIfNeeded('creatorSpent', task, rater._id);
  }
});

bot.action(/^ADMIN_BAN_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.match[1];
  const u = await User.findById(userId);
  if (!u) return;

  await banUserEverywhere(ctx, u);
  await ctx.reply(`User ${u.fullName || u.username || u.telegramId} has been banned.`);
});

bot.action(/^ADMIN_UNBAN_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.match[1];
  const u = await User.findById(userId);
  if (!u) return;

  await unbanUserEverywhere(ctx, u);
  await ctx.reply(`User ${u.fullName || u.username || u.telegramId} has been unbanned and can now use Taskifii normally.`);
  try {
    const draft = await TaskDraft.findOne({ creatorTelegramId: u.telegramId });
    if (draft) {
      const lang = u.language || "en";
      await ctx.telegram.sendMessage(
        u.telegramId,
        buildPreviewText(draft, u),
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
          [Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
        ])
      );
    }
  } catch (e) {
    console.error("Failed to send restored Post Task preview after unban:", e);
  }

});



// Update the DO_TASK_CANCEL handler
// In the DO_TASK_CANCEL action handler, remove the specific notification line
// Works for both: DO_TASK_CANCEL  and  DO_TASK_CANCEL_<taskId>
// Works for both: DO_TASK_CANCEL  and  DO_TASK_CANCEL_<taskId>
bot.action(/^DO_TASK_CANCEL(?:_(.+))?$/, async (ctx) => {
  await ctx.answerCbQuery();

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return;

  const lang = user.language || "en";   // << only declare 'lang' ONCE
  const now  = new Date();
  const taskId = ctx.match && ctx.match[1];

  // Scope to the specific task if an id is present; otherwise, fall back to your legacy lookup
  const task = taskId
    ? await Task.findOne({
        _id: taskId,
        "applicants.user": user._id,
        "applicants.status": "Accepted",
        status: "Open"
      })
    : await Task.findOne({
        "applicants.user": user._id,
        "applicants.status": "Accepted",
        status: "Open"
      });

  if (!task) return;
  // Already engaged? Make this message's buttons inert and stop.
  if (await isEngagementLocked(ctx.from.id)) {
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
          [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
        ],
      });
    } catch (_) {}

    await ctx.answerCbQuery(
      lang === 'am'
        ? "እርስዎ አሁን በአንድ ተግዳሮት ላይ ተሳትፈዋል። ይህ አዝራር አሁን ግባ የለውም።"
        : "You’re locked to another task right now; this button is disabled.",
      { show_alert: true }
    );
    return;
  }

  // --- keep your current visuals/UX, just scoped better ---

  try {
    // Make the buttons inert in the original message (same layout you already use)
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK_CONFIRM")],
        [Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_DO_TASK_CANCEL")],
      ],
    });
  } catch (_) {}

  // Your existing cancel flow (persist any cancel state you track, notify parties, etc.)
  // e.g., mark my applicant row as canceledAt=now (if that’s what you already do)
  await Task.updateOne(
    {
      _id: task._id,
      applicants: { $elemMatch: { user: user._id, status: "Accepted", canceledAt: null } }
    },
    { $set: { "applicants.$.canceledAt": now } }
  );

  // (Optional) Let the user know it’s canceled — reuse your existing text/logic:
  await ctx.reply(lang === "am" ? "🚫 እርስዎ ስራውን ተዉት።" : "🚫 You canceled this task.");
});



async function disableExpiredTaskButtons(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      status: "Open",
      expiry: { $lte: now }
    }).populate("applicants.user");

    for (const task of tasks) {
      // Update task status
      task.status = "Expired";
      await task.save();

      // --- AUTO-REFUND ON EXPIRY (non-interactive paths) -----------------------
      try {
        // Only if money was actually collected
        const intent = await PaymentIntent.findOne({ task: task._id, status: "paid" });
        if (intent && intent.refundStatus !== "succeeded") {
          const creator = await User.findById(task.creator);

          // Determine scenario & reason
          const hasApplicants = Array.isArray(task.applicants) && task.applicants.length > 0;
          const accepted = (task.applicants || []).filter(a => a.status === "Accepted");

          // Did any accepted doer actually click "Do the task"? (engagement lock)
          const doerStarted = accepted.length > 0
            ? !!(await EngagementLock.findOne({ task: task._id, role: 'doer', active: true }).lean())
            : false;

          let shouldRefund = false;
          let reason = "";

          if (!hasApplicants) {
            shouldRefund = true;
            reason = "Expired with no applicants";
          } else if (accepted.length === 0) {
            shouldRefund = true;
            reason = "Expired without creator action (no accepted applicant)";
          } else if (!doerStarted) {
            shouldRefund = true;
            reason = "Accepted doer did not start (no 'Do the task' before expiry)";
          }

          if (shouldRefund) {
            // Mark as requested so we never double-refund
            await PaymentIntent.updateOne(
              { _id: intent._id, refundStatus: { $ne: "succeeded" } },
              { $set: { refundStatus: "requested" } }
            );

            try {
              // Attempt the refund via Chapa
              const data = await refundEscrowWithChapa(intent, `Auto-refund on expiry: ${reason}`);

              // Try to extract reference / refund id from provider payload (if present)
              const chapaReference =
                (data && data.data && (data.data.reference || data.data.tx_ref)) || intent.chapaTxRef || null;
              const refundId =
                (data && data.data && (data.data.refund_id || data.data.refundId)) || null;

              await PaymentIntent.updateOne(
                { _id: intent._id },
                { $set: { refundStatus: "pending", refundedAt: new Date(), chapaReference, refundId } }
              );

              await sendRefundAudit(bot, {
                tag: "#refundsuccessful",
                task, creator, intent,
                extra: { reason, chapaReference, refundId }
              });
            } catch (apiErr) {
              const msg = String(apiErr?.message || "").toLowerCase();
              const insufficient = msg.includes("insufficient balance");

              await PaymentIntent.updateOne(
                { _id: intent._id },
                { $set: { refundStatus: insufficient ? "queued" : "failed" } }
              );

              await sendRefundAudit(bot, {
                tag: "#refundfailed",
                task, creator, intent,
                extra: { reason }
              });
            }
          }
        }
      } catch (e) {
        console.error("Auto-refund-on-expiry error:", e);
      }

      // Disable buttons for accepted applicants
      const acceptedApps = task.applicants.filter(app => app.status === "Accepted");
      for (const app of acceptedApps) {
        if (app.user && app.messageId) {
          try {
            const user = app.user;
            const lang = user.language || "en";
            
            await bot.telegram.editMessageReplyMarkup(
              user.telegramId,
              app.messageId,
              undefined,
              {
                inline_keyboard: [
                  [
                    Markup.button.callback(TEXT.doTaskBtn[lang], "_DISABLED_DO_TASK"),
                    Markup.button.callback(TEXT.cancelBtn[lang], "_DISABLED_CANCEL_TASK")
                  ]
                ]
              }
            );
          } catch (err) {
            console.error("Error disabling buttons for user:", app.user.telegramId, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in disableExpiredTaskButtons:", err);
  }
  // ✅ If nobody confirmed before expiry, unlock creator (and any stale doer locks)
  const noOneConfirmed = acceptedApps.length === 0 || !acceptedApps.some(a => a.confirmedAt);
  if (noOneConfirmed) {
    try {
      await releaseLocksForTask(task._id);
    } catch (e) {
      console.error("Failed to release locks on expiry:", e);
    }
  }

}

// Update the disableExpiredTaskApplicationButtons function
async function disableExpiredTaskApplicationButtons(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      $or: [
        { status: "Expired" }, // Already expired tasks
        { status: "Canceled" } // Canceled tasks
      ]
    }).populate("applicants.user");

    for (const task of tasks) {
      // Disable buttons for pending applications
      const pendingApps = task.applicants.filter(app => app.status === "Pending");
      for (const app of pendingApps) {
        if (app.user && app.messageId) {
          try {
            const creator = await User.findById(task.creator);
            const lang = creator?.language || "en";
            
            await bot.telegram.editMessageReplyMarkup(
              creator.telegramId,
              app.messageId,
              undefined,
              {
                inline_keyboard: [
                  [
                    Markup.button.callback(TEXT.acceptBtn[lang], "_DISABLED_ACCEPT"),
                    Markup.button.callback(TEXT.declineBtn[lang], "_DISABLED_DECLINE")
                  ]
                ]
              }
            );
          } catch (err) {
            console.error("Error disabling application buttons for task:", task._id, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in disableExpiredTaskApplicationButtons:", err);
  }
}




bot.action("_DISABLED_ACCEPT", async (ctx) => {
  await ctx.answerCbQuery("This task has expired and can no longer be accepted");
});

bot.action("_DISABLED_DECLINE", async (ctx) => {
  await ctx.answerCbQuery("This task has expired and can no longer be declined");
});

// Add these near your other action handlers
bot.action("_DISABLED_DO_TASK", async (ctx) => {
  await ctx.answerCbQuery("This task has expired and can no longer be accepted");
});

bot.action("_DISABLED_CANCEL_TASK", async (ctx) => {
  await ctx.answerCbQuery("This task has expired and can no longer be canceled");
});

bot.action(/^REPOST_TASK_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  // Highlight the repost button
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${TEXT.repostTaskBtn[lang]}`, "_DISABLED_REPOST_TASK")
      ]]
    });
  } catch (err) {
    console.error("Error updating buttons:", err);
  }
  
  try {
    const task = await Task.findById(taskId);
    if (!task) return;

    // Calculate the original expiry hours
    const originalExpiryMs = task.expiry - task.postedAt;
    const originalExpiryHours = Math.round(originalExpiryMs / (1000 * 60 * 60));

    // Create a new draft from the old task WITH THE ORIGINAL EXPIRY TIME
    const draft = await TaskDraft.create({
      creatorTelegramId: ctx.from.id,
      description: task.description,
      relatedFile: task.relatedFile ? { fileId: task.relatedFile } : undefined,
      fields: task.fields,
      skillLevel: task.skillLevel,
      paymentFee: task.paymentFee,
      timeToComplete: task.timeToComplete,
      revisionTime: task.revisionTime,
      penaltyPerHour: task.latePenalty,
      expiryHours: originalExpiryHours, // Using original expiry time
      exchangeStrategy: task.exchangeStrategy
    });

    // Rest of the code remains exactly the same...
    const locked = await isEngagementLocked(ctx.from.id);
    const u = await User.findOne({ telegramId: ctx.from.id });
    const lang = u?.language || "en";
    await ctx.reply(
      buildPreviewText(draft, u),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
      ])
    );

    
    // Send instructions
    const instructions = lang === "am" 
      ? "በተግዳሮቱ ዝርዝሮች ላይ ለውጥ ማድረግ ከፈለጉ 'ተግዳሮት አርትዕ' የሚለውን ቁልፍ ይጫኑ። እንደነበረው ለመለጠፍ 'ተግዳሮት ልጥፍ' ይጫኑ።"
      : "Click 'Edit Task' if you want to make changes to the task details. Click 'Post Task' to repost as is.";
    
    await ctx.reply(instructions);
  } catch (err) {
    console.error("Error in REPOST_TASK handler:", err);
    await ctx.reply("An error occurred while processing your request. Please try again.");
  }
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
  // Initialize session
  ctx.session = ctx.session || {};
  // ─────────── 1. Check if this is part of an application flow ───────────
  // In the application flow section of the consolidated handler:
  // In the application flow section of the consolidated handler:
// In the text handler section (around line 2000), replace the awaiting_pitch section with this:

// In the text handler section (around line 2000), replace the awaiting_pitch section with this:

  if (ctx.session?.applyFlow?.step === "awaiting_pitch") {
      const user = await User.findOne({ telegramId: ctx.from.id });
      const lang = user?.language || "en";

      // First check if this is a duplicate attempt that somehow got through
      const task = await Task.findById(ctx.session.applyFlow.taskId).populate('applicants.user');
      if (!task) {
          delete ctx.session.applyFlow;
          return ctx.reply(lang === "am" 
              ? "❌ ይህ ተግዳሮት ከማግኘት አልቋል።" 
              : "❌ This task is no longer available.");
      }

      const alreadyApplied = await hasUserApplied(task._id, user._id);
      if (alreadyApplied) {
          delete ctx.session.applyFlow;
          return ctx.reply(
              lang === "am" 
                  ? "አስቀድመው ለዚህ ተግዳሮት ማመልከት ተገቢውን አግኝተዋል።" 
                  : "You've already applied to this task."
          );
      }

      // extract text (message text or caption)
      let text = (ctx.message.text || "").trim();
      if (!text && ctx.message.caption) text = ctx.message.caption.trim();
      
      // validation
      if (!text || text.length < 20) {
          const err = lang === "am"
              ? "እባክዎን መልእክት 20 ቁምፊ በላይ እንዲሆን ያረጋግጡ።"
              : "Please make sure your message is at least 20 characters!";
          return ctx.reply(err);
      }
      if (text.length > 500) {
          const err = lang === "am"
              ? "እባክዎን መልእክት ከ500 ቁምፊ በታች እንዲሆን ያረጋግጡ።"
              : "Please keep your message under 500 characters!";
          return ctx.reply(err);
      }
          
      // Get the task being applied to
      if (!task) {
          delete ctx.session.applyFlow;
          return ctx.reply(lang === "am" 
              ? "❌ ይህ ተግዳሮት ከማግኘት አልቋል።" 
              : "❌ This task is no longer available.");
      }

      // Save the application - updated to match your exact schema
      const application = {
          user: user._id,  // Must be ObjectId reference to User
          coverText: text, // Required field
          file: ctx.message.photo?.[0]?.file_id || 
              ctx.message.document?.file_id ||
              ctx.message.video?.file_id ||
              ctx.message.audio?.file_id || null,
          status: "Pending",  // Default status
          
          // createdAt is automatically added by Mongoose
      };

      // Add the application to the task (don't save yet)
      task.applicants.push(application);

      // Get the task creator's language
      const creator = await User.findById(task.creator);
      if (creator) {
          const creatorLang = creator.language || "en";
          const applicantName = user.fullName || `@${user.username}` || "Anonymous";
          
          
          // Get applicant's frequent fields from rated/finished tasks
          const topFieldsArr = await getFrequentFieldsForDoer(user._id);
          const topFields = topFieldsArr.length > 0
            ? topFieldsArr.join(", ")
            : (creatorLang === "am" ? "የተሰሩ ተግዳሮቶች የሉም" : "No completed tasks");

          
          // Build the notification message
          const notificationText = creatorLang === "am"
              ? `📩 አዲስ አመልካች ለተግዳሮትዎ!\n\n` +
                `ተግዳሮት: ${task.description.substring(0, 50)}...\n\n` +
                `አመልካች: ${applicantName}\n` +
                `ጠቅላላ የተሰሩ ተግዳሮቶች: ${user.stats.totalEarned.toFixed(2)} ብር\n` +
                `ተደጋጋሚ የስራ መስኮች: ${topFields}\n` +
                `ደረጃ: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ግምገማዎች)\n` +
                `ተቀባይነት ያላቸው ባንኮች: ${user.bankDetails.map(b => b.bankName).join(", ") || "N/A"}\n\n` +
                `መልእክት: ${text.substring(0, 100)}...`
              : `📩 New applicant for your task!\n\n` +
                `Task: ${task.description.substring(0, 50)}...\n\n` +
                `Applicant: ${applicantName}\n` +
                `Total earned: ${user.stats.totalEarned.toFixed(2)} birr\n` +
                `Frequent fields: ${topFields}\n` +
                `Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ratings)\n` +
                `Accepted banks: ${user.bankDetails.map(b => b.bankName).join(", ") || "N/A"}\n\n` +
                `Message: ${text.substring(0, 100)}...`;

          const buttons = Markup.inlineKeyboard([
              [
                  Markup.button.callback(
                      TEXT.acceptBtn[creatorLang], 
                      `ACCEPT_${task._id}_${user._id}` // Full IDs
                  ),
                  Markup.button.callback(
                      TEXT.declineBtn[creatorLang], 
                      `DECLINE_${task._id}_${user._id}` // Full IDs
                  )
              ]
          ]);

          try {
              // Send the notification and capture the message ID
              const sentMessage = await ctx.telegram.sendMessage(
                  creator.telegramId,
                  notificationText,
                  { 
                      parse_mode: "Markdown", 
                      reply_markup: buttons.reply_markup 
                  }
              );
              
              // Store the message ID on the application
              application.messageId = sentMessage.message_id;
              
              // Now save the task with the message ID
              await task.save();
          } catch (err) {
              console.error("Failed to send notification:", err);
              // Fallback - save without message ID if sending fails
              await task.save();
              // Try sending without buttons
              await ctx.telegram.sendMessage(
                  creator.telegramId,
                  notificationText,
                  { parse_mode: "Markdown" }
              );
          }
      } else {
          // Save the task if creator not found (shouldn't happen)
          await task.save();
      }

      // Confirm to applicant
      const confirmationText = lang === "am"
          ? "✅ ማመልከቻዎ ተቀብልናል! የተግዳሮቱ ባለቤት በቅርቡ ያግኝዎታል።"
          : "✅ Application received! The task creator will contact you soon.";

      delete ctx.session.applyFlow;
      return ctx.reply(confirmationText);
  }

  // ─────────── 2. Skip if in task flow ───────────
  if (ctx.session?.taskFlow) {
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
      default:
        delete ctx.session.taskFlow;
        return ctx.reply("Unexpected error. Please start again.");
    }
  }

   // 5. Payout flow: awaiting account number
  if (ctx.session?.payoutFlow?.step === "awaiting_account") {
    const userId = ctx.from.id;
    const pending = global.pendingPayouts?.[userId];
    if (!pending) {
      ctx.session.payoutFlow = undefined;
      return next();
    }
    
    const accountNumber = ctx.message.text.trim();
    
    // Basic validation: account number should be numeric
    if (!/^\d+$/.test(accountNumber)) {
      const errMsg = (pending.selectedBankName) 
        ? `❌ Invalid account number format. Please enter only digits for your ${pending.selectedBankName} account.` 
        : "❌ Invalid account number format. Please enter only digits.";
      await ctx.reply(errMsg);
      return;
    }
    
    // If bank info includes expected length, validate length
    const bankInfo = pending.banks.find(b => b.id === pending.selectedBankId);
    if (bankInfo?.acct_length && accountNumber.length !== bankInfo.acct_length) {
      const errMsg = `❌ The account number should be ${bankInfo.acct_length} digits long. Please re-enter the correct number.`;
      await ctx.reply(errMsg);
      return;
    }

    // Prepare transfer payload
    const payload = {
      account_number: accountNumber,
      bank_code: pending.selectedBankId,
      amount: pending.payoutAmount,
      currency: "ETB",
      reference: pending.reference
    };
    
    // Include account_name if available
    const user = await User.findOne({ telegramId: userId });
    if (user?.fullName) payload.account_name = user.fullName;

    // Call Chapa Transfers API to initiate the payout
    let transferData;
    try {
      const res = await fetch("https://api.chapa.co/v1/transfers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      transferData = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMessage = transferData?.message || transferData?.data || res.statusText;
        console.error("Chapa payout failed:", errorMessage);
        await ctx.reply(`❌ Payout failed: ${errorMessage}\n🔁 Please double-check the account details and try again.`);
        return;
      }
    } catch (err) {
      console.error("Chapa transfer API error:", err);
      await ctx.reply("❌ An error occurred while initiating the payout. Please try again.");
      return;
    }

    console.log("✅ Escrow payout initiated via Chapa:", transferData?.data || transferData);
    
    // Disable all bank buttons now that payout is initiated
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    } catch (_) {}

    // Send confirmation to the user
    const successMsg = (user?.language === "am") 
      ? "✅ ክፍያዎት ተከናወነ! በቀጣዮቹ ደቂቃዎች/ቀናት ውስጥ ገንዘቡ ወደ መልዕክት መለስ አካውንትዎ ይገባል።"
      : "✅ Your payout has been initiated! The funds will be transferred to your account shortly.";
    await ctx.reply(successMsg);

    // Record payout in internal stats and trigger the rating flow
    const task = await Task.findById(pending.taskId);
    if (task) {
      await creditIfNeeded('doerEarned', task, pending.doerId);
      await creditIfNeeded('creatorSpent', task, pending.creatorId);
    }
    
    const tg = globalThis.TaskifiiBot.telegram;
    await finalizeAndRequestRatings('accepted', pending.taskId, tg);

    // Cleanup session and pending state
    ctx.session.payoutFlow = undefined;
    delete global.pendingPayouts[userId];
    return;
  }

  
  // ─────────── 3. Handle profile editing ───────────
  const text = ctx.message.text?.trim();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return;

  if (ctx.session?.editing?.field) {
    // Handle name editing
    if (ctx.session.editing.field === "fullName") {
      if (text.length < 3) {
        return ctx.reply(user.language === "am" ? TEXT.fullNameError.am : TEXT.fullNameError.en);
      }

      const countSame = await User.countDocuments({ fullName: text });
      user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;
      
      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });
      
      try {
        await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId);
      } catch (err) {
        console.error("Failed to update admin profile post:", err);
      }

      await ctx.reply(TEXT.profileUpdated[user.language]);
      
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      await ctx.reply(buildProfileText(user, false), menu);
      delete ctx.session.editing;
      return;
    }

    // Handle phone editing (use the same rules as onboarding)
    if (ctx.session.editing.field === "phone") {
      const normalized = normalizeEtPhone(text);
      if (!normalized) {
        return ctx.reply(
          user.language === "am"
            ? "📱 የስልክ ቁጥር ያልተቀበለ ነው። እባክዎ ይህን አቅጣጫ ይጠቀሙ: +2519xxxxxxxx ወይም +2517xxxxxxxx"
            : "📱 That phone number isn’t valid. Please send it like this: +2519xxxxxxxx or +2517xxxxxxxx"
        );
      }

      // Block duplicates using the normalized form
      const exists = await User.findOne({ phone: normalized });
      if (exists && String(exists._id) !== String(user._id)) {
        return ctx.reply(
          user.language === "am"
            ? "📱 ይህ ስልክ ቁጥር ቀድሞ ተይዟል። እባክዎ ሌላ ቁጥር ይላኩ።"
            : "📱 This phone number is already used. Please send another one."
        );
      }

      user.phone = normalized;

      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });

      try { await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId); } 
      catch (err) { console.error("Failed to update admin profile post:", err); }

      await ctx.reply(TEXT.profileUpdated[user.language]);
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      await ctx.reply(buildProfileText(user, false), menu);
      delete ctx.session.editing;
      return;
    }


    // Handle email editing (use the same rules as onboarding)
    if (ctx.session.editing.field === "email") {
      const candidate = (text || "").trim();

      if (!isValidEmail(candidate)) {
        return ctx.reply(
          user.language === "am"
            ? "✉️ ኢሜይል አድራሻ የተሳሳተ ነው። እባክዎ user@example.com በመሳሰሉ ቅርጸ-ቃላት ያስገቡ።"
            : "✉️ That email doesn’t look valid. Please send something like user@example.com"
        );
      }

      // Block duplicates (but allow keeping your own)
      const exists = await User.findOne({ email: candidate });
      if (exists && String(exists._id) !== String(user._id)) {
        return ctx.reply(
          user.language === "am"
            ? "✉️ ይህ ኢሜይል ቀድሞ ተጠቅመዋል። እባክዎ ሌላ ኢሜይል ይላኩ።"
            : "✉️ This email is already in use. Please send another one."
        );
      }

      user.email = candidate;

      await user.save();
      const updatedUser = await User.findOne({ telegramId: ctx.from.id });

      try { await updateAdminProfilePost(ctx, updatedUser, updatedUser.adminMessageId); } 
      catch (err) { console.error("Failed to update admin profile post:", err); }

      await ctx.reply(TEXT.profileUpdated[user.language]);
      const menu = Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
        [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
        [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
      ]);

      await ctx.reply(buildProfileText(user, false), menu);
      delete ctx.session.editing;
      return;
    }


    // Handle username editing
    if (ctx.session.editing.field === "username") {
      const reply = text;
      const userHandleRegex = /^[A-Za-z0-9_]{5,}$/;
      if (!userHandleRegex.test(reply)) {
        return ctx.reply(user.language === "am" ? TEXT.usernameErrorGeneral.am : TEXT.usernameErrorGeneral.en);
      }
      const existingUser = await User.findOne({ username: reply });
      if (existingUser) {
        return ctx.reply(user.language === "am" ? TEXT.usernameErrorTaken.am : TEXT.usernameErrorTaken.en);
      }

      ctx.session.usernameProvided = true;

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

      ctx.session.newUsername = reply;
      
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
        return ctx.reply(user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en);
      }
      
      const [bankName, acctNum] = text.split(",").map((s) => s.trim());
      
      if (ctx.session.editing.field === "bankReplacing" && ctx.session.editing.bankIndex !== undefined) {
        user.bankDetails[ctx.session.editing.bankIndex] = { bankName, accountNumber: acctNum };
      } else {
        user.bankDetails.push({ bankName, accountNumber: acctNum });
      }
      
      await user.save();
      await ctx.reply(TEXT.profileUpdated[user.language]);
      await updateAdminProfilePost(ctx, user, ctx.session.editing.adminMessageId);
      
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

  // ─────────── 4. Original Onboarding Flow ───────────
  // ─── FULL NAME STEP ─────────────────────────
  if (user.onboardingStep === "fullName") {
    if (text.length < 3) {
      return ctx.reply(user.language === "am" ? TEXT.fullNameError.am : TEXT.fullNameError.en);
    }
    const countSame = await User.countDocuments({ fullName: text });
    user.fullName = countSame > 0 ? `${text} (${countSame + 1})` : text;

    user.onboardingStep = "phone";
    await user.save();
    return ctx.reply(user.language === "am" ? TEXT.askPhone.am : TEXT.askPhone.en);
  }

  
  // ─── PHONE STEP ────────────────────────────
  if (user.onboardingStep === "phone") {
    // Normalize to +2517/9xxxxxxxx; null if invalid/unknown
    const normalized = normalizeEtPhone(text);
    if (!normalized) {
      return ctx.reply(
        user.language === "am"
          ? "📱 የስልክ ቁጥር ያልተቀበለ ነው። እባክዎ ይህን አቅጣጫ ይጠቀሙ: +2519xxxxxxxx ወይም +2517xxxxxxxx"
          : "📱 That phone number isn’t valid. Please send it like this: +2519xxxxxxxx or +2517xxxxxxxx"
      );
    }

    // Block duplicates (store the normalized value)
    const existingPhone = await User.findOne({ phone: normalized });
    if (existingPhone) {
      return ctx.reply(
        user.language === "am"
          ? "📱 ይህ ስልክ ቁጥር ቀድሞ ተይዟል። እባክዎ ሌላ ቁጥር ይላኩ።"
          : "📱 This phone number is already used. Please send another one."
      );
    }

    user.phone = normalized;                 // ← save normalized E.164 form
    user.onboardingStep = "email";
    await user.save();
    return ctx.reply(user.language === "am" ? TEXT.askEmail.am : TEXT.askEmail.en);
  }


  
  // ─── EMAIL STEP ────────────────────────────
  if (user.onboardingStep === "email") {
    if (!isValidEmail(text)) {
      return ctx.reply(
        user.language === "am"
          ? "✉️ ኢሜይሉ የተሳሳተ ነው። እባክዎ username@example.com በመሳሰሉት ቅርጸ-ቁምፊ ያስገቡ።"
          : "✉️ That email address looks invalid. Please send something like username@example.com."
      );
    }

    const existingEmail = await User.findOne({ email: text.trim() });
    if (existingEmail) {
      return ctx.reply(
        user.language === "am"
          ? "✉️ ይህ ኢሜይል ቀድሞ ተጠቅመዋል። ሌላ ኢሜይል ይላኩ።"
          : "✉️ That email is already in use. Please send another one."
      );
    }

    user.email = text.trim();
    user.onboardingStep = "usernameConfirm";
    await user.save();

    const currentHandle = ctx.from.username || "";
    const promptText = user.language === "am"
      ? TEXT.askUsername.am.replace("%USERNAME%", currentHandle || "<none>")
      : TEXT.askUsername.en.replace("%USERNAME%", currentHandle || "<none>");

    return ctx.reply(
      promptText,
      Markup.inlineKeyboard([
        [Markup.button.callback(user.language === "am" ? "አዎን፣ ይቀበሉ" : "Yes, keep it", "USERNAME_KEEP")]
      ])
    );
  }


  // ─── USERNAME STEP (typed override) ─────────────────────────
  if (user.onboardingStep === "usernameConfirm") {
    const reply = text;
    const userHandleRegex = /^[A-Za-z0-9_]{5,}$/;
    if (!userHandleRegex.test(reply)) {
      return ctx.reply(user.language === "am" ? TEXT.usernameErrorGeneral.am : TEXT.usernameErrorGeneral.en);
    }
    const existingUser = await User.findOne({ username: reply });
    if (existingUser) {
      return ctx.reply(user.language === "am" ? TEXT.usernameErrorTaken.am : TEXT.usernameErrorTaken.en);
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
    } catch (err) {
      // Ignore errors if message is too old
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
      return ctx.reply(user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en);
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

  // ─── MULTI BANK ENTRY (after clicking Add) ─────────────────
  if (user.onboardingStep === "bankAdding") {
    const bankRegex = /^[A-Za-z ]+,\d+$/;
    if (!bankRegex.test(text)) {
      return ctx.reply(user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en);
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
      return ctx.reply(user.language === "am" ? TEXT.bankErrorFormat.am : TEXT.bankErrorFormat.en);
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
  // If no special flow was matched, proceed to next middleware to handle message forwarding
  return next();
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
      ], { parse_mode: "Markdown" })
    );

    ctx.session.taskFlow = null;
    return;
  }

  // Original behavior for non-edit flow
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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

  const MAX_FIELDS = 7;
  const field = ALL_FIELDS[idx];

  // Add the field only if not already selected and we’re still under the cap
  if (!draft.fields.includes(field) && draft.fields.length < MAX_FIELDS) {
    draft.fields.push(field);
    await draft.save();
  }

  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  try { await ctx.deleteMessage(); } catch(_) {}

  // If we’ve reached the cap, auto-behave like “Done” was clicked
  if (draft.fields.length >= MAX_FIELDS) {
    // Mirror TASK_FIELDS_DONE UI (disabled Add More, checked Done)
    await ctx.reply(
      `${TEXT.fieldsSelected[lang]} ${draft.fields.join(", ")}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(TEXT.fieldsAddMore[lang], "_DISABLED_ADD_MORE")],
        [Markup.button.callback(`✔ ${TEXT.fieldsDone[lang]}`, "_DISABLED_DONE")]
      ])
    );

    // Follow the same flow as TASK_FIELDS_DONE:
    if (ctx.session.taskFlow?.isEdit) {
      await ctx.reply(lang === "am" ? "✅ መስኮች ተዘምነዋል" : "✅ Fields updated.");
      const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
      const locked = await isEngagementLocked(ctx.from.id);
      await ctx.reply(
        buildPreviewText(updatedDraft, user),
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
          [ locked
            ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
            : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
          ]
        ], { parse_mode: "Markdown" })
      );
      ctx.session.taskFlow = null;
      return;
    } else {
      // Create flow: advance to skill level
      ctx.session.taskFlow = ctx.session.taskFlow || {};
      ctx.session.taskFlow.step = "skillLevel";
      return askSkillLevel(ctx, lang);
    }
  }

  // Otherwise, show the normal “Selected / Add More / Done” prompt
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
  const locked = await isEngagementLocked(ctx.from.id);
  return ctx.reply(preview,
    Markup.inlineKeyboard([
      [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
      [ locked
        ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
        : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
      ]
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
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, user),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [ locked
          ? Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")
          : Markup.button.callback(lang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")
        ]
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
  
  // EARLY EXIT WHEN LOCKED — keep button visible but inert
  const me = await User.findOne({ telegramId: ctx.from.id });
  const meLang = me?.language || "en";

  if (await isEngagementLocked(ctx.from.id)) {
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [Markup.button.callback(meLang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
          [Markup.button.callback(meLang === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "_DISABLED_TASK_POST_CONFIRM")]
        ]
      });
    } catch (_) {}

    await ctx.answerCbQuery(
      meLang === 'am'
        ? "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ተግዳሮት መለጠፍ አይችሉም።"
        : "You're actively involved in a task right now, so you can't post a task until this one is fully sorted.",
      { show_alert: true }
    );
    return;
  }



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
  // ───────────── ESCROW FUNDING BEFORE POSTING (FULL BLOCK) ─────────────
  try {
    // Load fresh copies we already have in scope
    const amountBirr = Number(draft.paymentFee || 0);
    const currency = (process.env.CHAPA_CURRENCY || "ETB").toUpperCase();

    // Validate amount (you already enforce >=50 birr upstream; keep this sanity guard)
    if (!Number.isFinite(amountBirr) || amountBirr <= 0) {
      await ctx.answerCbQuery(
        user.language === "am"
          ? "❌ የክፍያ መጠን ትክክል አይደለም።"
          : "❌ Invalid fee amount.",
        { show_alert: true }
      );
      return;
    }

    // If they already funded this draft, fall through to your normal posting code below.
    const alreadyPaid = await PaymentIntent.findOne({
      user: user._id,
      draft: draft._id,
      status: "paid"
    }).lean();

    if (!alreadyPaid) {
      // Decide the collection path: hosted checkout (Chapa link) OR Telegram invoice
      // Turn on hosted by setting USE_CHAPA_HOSTED_FOR_ESCROW=true in .env
      if (typeof USE_CHAPA_HOSTED_FOR_ESCROW !== "undefined" && USE_CHAPA_HOSTED_FOR_ESCROW) {
        // === Path A: Chapa Hosted Checkout (best for local rails like Telebirr, banks) ===
        const txRef = `escrow_${draft._id}_${Date.now()}`;

        // Create a pending PaymentIntent upfront (we refund by tx_ref later if needed)
        const intent = await PaymentIntent.create({
          user: user._id,
          draft: draft._id,
          amount: amountBirr,
          currency,
          status: "pending",
          provider: "chapa_hosted",
          payload: txRef,    // reuse payload as a unique link key
          chapaTxRef: txRef
        });

        // Initialize the hosted checkout (helper defined earlier in this file)
        const { checkout_url } = await chapaInitializeEscrow({
          amountBirr, currency, txRef, user
        });

        // Show the pay link + a “I’ve paid” verify button
        await ctx.reply(
          user.language === "am"
            ? "💳 ክፍያ ለማጠናቀቅ ይህን ክፍትዎ፣ ከዚያ ‘ክፍያ አጠናቀርሁ’ ይጫኑ።"
            : "💳 Open this to pay, then tap “I’ve paid”.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔗 Open payment (Chapa)", url: checkout_url }],
                // keep callback_data short (Telegram limit 64 bytes)
                
              ]
            }
          }
        );
        return; // stop here; user will tap “I’ve paid”

      }

      // === Path B: Telegram Invoice (Chapa provider token) — fallback ===
      // Telegram enforces a per-currency minimum; we apply a safe floor to avoid errors.
      const floorBirr = TG_MIN_BY_CURRENCY[currency] ?? 135; // see constant at top of file
      if (amountBirr < floorBirr) {
        // Re-enable the two preview buttons so they can edit or try again
        try {
          await ctx.editMessageReplyMarkup({
            inline_keyboard: [
              [Markup.button.callback(user.language === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
              [Markup.button.callback(user.language === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
            ]
          });
        } catch (_) {}

        await ctx.answerCbQuery(
          user.language === "am"
            ? `⚠️ Telegram ዝቅተኛው ${floorBirr} ብር ነው። እባክዎ ክፍያውን ያስተካክሉ።`
            : `⚠️ Telegram requires at least ${floorBirr} birr for this currency.`,
          { show_alert: true }
        );
        return;
      }

      // Create the intent & send the invoice
      const payload = `escrow:${draft._id.toString()}:${Date.now()}`;

      await PaymentIntent.create({
        user: user._id,
        draft: draft._id,
        amount: amountBirr,                    // human units
        currency,
        status: "pending",
        provider: "telegram_chapa",
        payload
      });

      const minor = Math.round(amountBirr * 100); // ETB has 2 decimals
      const normalizedPhoneForInvoice = normalizeEtPhone(
        process.env.CHAPA_TEST_PHONE || user.phone
      );

      await ctx.replyWithInvoice({
        title: user.language === "am" ? "ኢስክሮ ፈንድ ያስገቡ" : "Fund Task Escrow",
        description: user.language === "am"
          ? "ተግዳሮቱ እንዲታተም እባክዎ የተወሰነውን የክፍያ መጠን ይክፈሉ።"
          : "Please pay the exact task fee to post this task.",
        provider_token: process.env.CHAPA_PROVIDER_TOKEN,
        currency,
        prices: [{ label: user.language === "am" ? "የተግባሩ ክፍያ" : "Task fee", amount: minor }],
        payload,
        start_parameter: `fund_${draft._id}`,

        // 👇 NEW: tell Telegram to collect/show phone on the invoice sheet
        need_phone_number: true,

        // 👇 NEW: pass the phone along to the provider (Chapa sees this)
        provider_data: JSON.stringify({
          phone_number: normalizedPhoneForInvoice || undefined
        })
      });


      await ctx.reply(
        user.language === "am"
          ? "💳 ክፍያውን ያጠናቀቁ፤ ክፍያ ከሳካ በኋላ ተግዳሮቱ ራሱ ይታተማል።"
          : "💳 Complete the payment — once it succeeds, your task will be posted automatically."
      );

      // Stop here; your 'successful_payment' handler will create & post the task.
      return;
    }
  } catch (e) {
    console.error("Escrow gate error:", e);
    // Put the two buttons back so the user isn't stuck
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [Markup.button.callback(user.language === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
          [Markup.button.callback(user.language === "am" ? "ተግዳሮት ልጥፍ" : "Post Task", "TASK_POST_CONFIRM")]
        ]
      });
    } catch (_) {}

    await ctx.answerCbQuery(
      user.language === "am"
        ? "⚠️ ክፍያ መጀመር አልተቻለም። እባክዎ ዳግም ይሞክሩ።"
        : "⚠️ Couldn’t start the payment. Please try again.",
      { show_alert: true }
    );
    return;
  }
  // ───────────── END ESCROW FUNDING BEFORE POSTING ─────────────

  // If we reach here, there is an existing 'paid' intent → fall through to your existing “Create the task with postedAt timestamp” code below.

  // ... fall through to your existing “create task” code if already funded

  // If we reach here we have an existing 'paid' intent → fall through to existing post code.

  // Create the task with postedAt timestamp
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
    stages: [],
    postedAt: now,
    reminderSent: false
  });

  // Post to channel
  const channelId = process.env.CHANNEL_ID || "-1002254896955";
  const preview = buildChannelPostText(draft, me);
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      me.language === "am" ? "ያመልክቱ / Apply" : "Apply / ያመልክቱ",
      applyDeepLink(ctx, BOT_USERNAME, task._id)
    )]
  ]);


  try {
    const tg = (ctx && ctx.telegram) ? ctx.telegram : (globalThis.TaskifiiBot && globalThis.TaskifiiBot.telegram);
    if (!tg) throw new Error("Telegram handle unavailable");
    const sent = await tg.sendMessage(channelId, preview, {
      parse_mode: "Markdown",
      reply_markup: keyboard.reply_markup
    });


    task.channelMessageId = sent.message_id;
    await task.save();
    // Lock the creator on this task so they can't act as a doer concurrently
    try {
      await EngagementLock.updateOne(
        { user: user._id, task: task._id },
        { $setOnInsert: { role: 'creator', active: true, createdAt: new Date() }, $unset: { releasedAt: "" } },
        { upsert: true }
      );
    } catch (e) {
      console.error("Failed to set creator engagement lock:", e);
    }
    
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

  // Schedule the 85% reminder
  const totalTimeMs = task.expiry - task.postedAt;
  const reminderTime = new Date(task.postedAt.getTime() + (totalTimeMs * 0.85));
  
  if (reminderTime > now) {
    setTimeout(async () => {
      try {
        const updatedTask = await Task.findById(task._id).populate("applicants.user");
        if (!updatedTask || updatedTask.status !== "Open" || updatedTask.reminderSent) return;
        
        const hasAcceptedApplicant = updatedTask.applicants.some(app => app.status === "Accepted");
        if (hasAcceptedApplicant) return;
        
        const creator = await User.findById(updatedTask.creator);
        if (!creator) return;

        const lang = creator.language || "en";
        const timeLeftMs = updatedTask.expiry - new Date();
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

        const message = lang === "am" 
          ? `⏰ ማስታወሻ: የተግዳሮትዎ ጊዜ እየቀረ ነው!\n\n` +
            `የተግዳሮትዎ የማብቂያ ጊዜ የሚቀረው: ${hoursLeft} ሰዓት እና ${minutesLeft} ደቂቃ\n\n` +
            `አመልካቾችን ለመቀበል የተቀረው ጊዜ በጣም አጭር ነው። እባክዎ በቅርቡ አመልካች ይምረጡ።`
          : `⏰ Reminder: Your task time is running out!\n\n` +
            `Time remaining for your task: ${hoursLeft} hours and ${minutesLeft} minutes\n\n` +
            `You have very little time left to accept applicants. Please select an applicant soon.`;

        await ctx.telegram.sendMessage(creator.telegramId, message);
        updatedTask.reminderSent = true;
        await updatedTask.save();
      } catch (err) {
        console.error("Error sending reminder:", err);
      }
    }, reminderTime - now);
  }

  // Delete the draft
  await TaskDraft.findByIdAndDelete(draft._id);
  
  // Send confirmation message to user with Cancel Task button
  const confirmationText = user.language === "am" 
    ? `✅ ተግዳሮቱ በተሳካ ሁኔታ ተለጥፏል!\n\nሌሎች ተጠቃሚዎች አሁን ማመልከት ይችላሉ።` 
    : `✅ Task posted successfully!\n\nOther users can now apply.`;
  
  return ctx.reply(confirmationText, Markup.inlineKeyboard([
    [Markup.button.callback(
      user.language === "am" ? "ተግዳሮት ሰርዝ" : "Cancel Task", 
      `CANCEL_TASK_${task._id}`
    )]
  ]));
});




// Verify hosted checkout by tx_ref, then post task (same UX as non-escrow path)
bot.action(/^HOSTED_VERIFY:([a-zA-Z0-9_-]+):([a-f0-9]{24})$/, async (ctx) => {
  try {
    const txRef = ctx.match[1];
    const draftId = ctx.match[2];
    const me = await User.findOne({ telegramId: ctx.from.id });
    if (!me) {
      return ctx.answerCbQuery("User not found.", { show_alert: true });
    }

    // Verify payment with Chapa (hosted checkout)
    const verifyResp = await fetch(
      `https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`,
      {
        headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
      }
    );
    const verifyData = await verifyResp.json().catch(() => null);

    // ✅ FIX: Only treat as paid if the nested transaction status is "success"
    const txStatus = String(verifyData?.data?.status || "").toLowerCase();

    if (!verifyResp.ok || txStatus !== "success") {
      return ctx.answerCbQuery(
        me.language === "am"
          ? "እስካሁን ክፍያዎ አልተቀበለም። እባክዎ መክፈሉን ያረጋግጡ።"
          : "We haven’t received your payment yet. Please make sure you’ve completed it.",
        { show_alert: true }
      );
    }

    // Now verified – load draft and continue
    const draft = await TaskDraft.findById(draftId);
    if (!draft) {
      return ctx.reply(
        me.language === "am"
          ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ እንደገና ይሞክሩ።"
          : "❌ Draft expired. Please try again."
      );
    }

    // Mark payment intent paid (idempotent)
    let intent = await PaymentIntent.findOne({ chapaTxRef: txRef });
    if (!intent) {
      intent = await PaymentIntent.create({
        user: me._id,
        draft: draft._id,
        chapaTxRef: txRef,
        status: "paid",
        paidAt: new Date(),
        provider: "chapa_hosted",
        amount: draft?.paymentFee,             // optional, for nicer refund logs
        currency: process.env.CHAPA_CURRENCY || "ETB"
      });
    } else if (intent.status !== "paid") {
      intent.status = "paid";
      intent.paidAt = new Date();
      // keep provider/txRef that were already on the pending intent
      await intent.save();
    }


    // ✅ Use same helper to post task now
    await postTaskFromPaidDraft({ ctx, me, draft, intent });

  } catch (err) {
    console.error("HOSTED_VERIFY error:", err);
    try {
      await ctx.answerCbQuery(
        "⚠️ Payment check failed. Please try again later.",
        { show_alert: true }
      );
    } catch (_) {}
  }
});


// Required by Telegram payments: approve the checkout
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true); // accept
});

bot.on('successful_payment', async (ctx) => {
  try {
    const sp = ctx.message.successful_payment; // has currency, total_amount, provider_payment_charge_id, invoice_payload
    const payload = sp?.invoice_payload || "";

    // We only handle escrow payloads here
    if (!payload.startsWith("escrow:")) return;

    const [, draftId] = payload.split(":");
    const me = await User.findOne({ telegramId: ctx.from.id });
    if (!me) return;

    // Optional: capture phone number returned by Telegram and persist to the user
    const phoneFromOrder = sp?.order_info?.phone_number;
    if (phoneFromOrder) {
      const normalized = normalizeEtPhone(phoneFromOrder);
      if (normalized && !me.phone) {
        try {
          me.phone = normalized;
          await me.save();
        } catch (e) {
          console.error("Could not save phone from order_info:", e);
        }
      }
    }

    // Mark PaymentIntent as paid (idempotent)
    const intent = await PaymentIntent.findOneAndUpdate(
      { user: me._id, draft: draftId, payload },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          currency: sp.currency,
          minorTotal: sp.total_amount,
          provider_payment_charge_id: sp.provider_payment_charge_id
        }
      },
      { new: true }
    );

    // Load draft
    const draft = await TaskDraft.findById(draftId);
    if (!draft) {
      return ctx.reply(
        me.language === "am"
          ? "❌ ረቂቁ ጊዜው አልፎታል። እባክዎ እንደገና ይሞክሩ።"
          : "❌ Draft expired. Please try again."
      );
    }

    // ✅ Use the same unified task-posting helper
    await postTaskFromPaidDraft({ ctx, me, draft, intent });

  } catch (err) {
    console.error("successful_payment handler error:", err);
    try {
      await ctx.reply(
        "⚠️ Payment succeeded, but we hit an error while posting. We’ll check it immediately."
      );
    } catch (_) {}
  }
});


// Add Cancel Task handler
bot.action(/^CANCEL_TASK_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  const task = await Task.findById(taskId).populate("applicants.user");
  if (!task) {
    return ctx.reply(lang === "am" 
      ? "❌ ተግዳሮቱ አልተገኘም" 
      : "❌ Task not found"
    );
  }

  // Check if task can be canceled (not expired and no accepted applicants)
  const hasAcceptedApplicant = task.applicants.some(app => app.status === "Accepted");
  const isExpired = task.status === "Expired" || new Date() > task.expiry;
  
  if (hasAcceptedApplicant || isExpired) {
    // Make button inert but still visible
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [[
          Markup.button.callback(
            user.language === "am" ? "ተግዳሮት ሰርዝ" : "Cancel Task", 
            "_DISABLED_CANCEL_TASK"
          )
        ]]
      });
    } catch (err) {
      console.error("Error making Cancel Task button inert:", err);
    }
    
    return ctx.reply(lang === "am" 
      ? "❌ ተግዳሮቱን መሰረዝ አይቻልም - አስቀድሞ አመልካች መርጠዋል ወይም ጊዜው አልፎታል" 
      : "❌ Task cannot be canceled - you've already accepted an applicant or it's expired"
    );
  }

  // Update task status to Canceled
  task.status = "Canceled";
  await task.save();
  // ── NEW: refund escrow to creator on allowed cancel ──────────────────────────
  try {
    // Find the escrow we linked to this task
    const intent = await PaymentIntent.findOne({
      task: task._id,
      status: "paid"
    });

    if (intent && intent.refundStatus !== "succeeded") {
      // Mark as requested (so double taps don't double-refund)
      await PaymentIntent.updateOne(
        { _id: intent._id, refundStatus: { $ne: "succeeded" } },
        { $set: { refundStatus: "requested" } }
      );

      try {
        console.log("Attempting Chapa refund", {
          provider: intent?.provider,
          chapaTxRef: intent?.chapaTxRef,
          amount: intent?.amount,
        });

        await refundEscrowWithChapa(intent, "Creator canceled before engagement");
        await PaymentIntent.updateOne(
          { _id: intent._id },
          { $set: { refundStatus: "pending", refundedAt: new Date() } }
        );

        const okMsg = (lang === "am")
          ? "💸 የኢስክሮ ገንዘብዎ ወደ መጀመሪያ የክፍያ መንገድዎ ተመልሷል።"
          : "💸 Your escrow funds have been refunded to your original payment method.";
        await ctx.reply(okMsg);
      } catch (apiErr) {
        console.error("Chapa refund failed:", apiErr);

        const msg = String(apiErr?.message || "").toLowerCase();
        const insufficient = msg.includes("insufficient balance");

        await PaymentIntent.updateOne(
          { _id: intent._id },
          { $set: { refundStatus: insufficient ? "queued" : "failed" } }
        );

        const sorry = (lang === "am")
          ? (insufficient
              ? "⚠️ ራስ-ሰር መመለስ አልተሳካም (የንግድ ቀሪ ሂሳብ ዝቅተኛ ስለሆነ)። በቅርቡ እንደገና እንሞክራለን እና በተሳካ ጊዜ እናሳውቃለን።"
              : "⚠️ ራስ-ሰር መመለስ አልተሳካም። እባክዎ ድጋፍ ጋር ይገናኙ ወይም በግል እንመልሳለን።")
          : (insufficient
              ? "⚠️ Auto-refund didn’t go through (merchant balance too low). We’ll retry shortly and notify you when it succeeds."
              : "⚠️ We couldn’t auto-refund via the provider. We’ll resolve it promptly via support.");

        await ctx.reply(sorry);
      }

    }
  } catch (e) {
    console.error("Refund flow error:", e);
    // Intentionally silent for the user—task has been canceled already.
  }


  // Disable all application buttons for pending applications
  for (const app of task.applicants.filter(a => a.status === "Pending")) {
    if (app.messageId) {
      try {
        await ctx.telegram.editMessageReplyMarkup(
          user.telegramId,
          app.messageId,
          undefined,
          {
            inline_keyboard: [[
              Markup.button.callback(TEXT.acceptBtn[lang], "_DISABLED_ACCEPT"),
              Markup.button.callback(TEXT.declineBtn[lang], "_DISABLED_DECLINE")
            ]]
          }
        );
      } catch (err) {
        console.error("Error disabling application buttons:", err);
      }
    }
  }

  // Notify creator
  await ctx.reply(TEXT.cancelConfirmed[lang]);

  // Make Cancel Task button inert but still visible
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(
          `✔ ${user.language === "am" ? "ተግዳሮት ሰርዝ" : "Cancel Task"}`, 
          "_DISABLED_CANCEL_TASK"
        )
      ]]
    });
  } catch (err) {
    console.error("Error updating Cancel Task button:", err);
  }
  // ✅ Ensure both parties are unlocked if any lock existed
  try {
    await releaseLocksForTask(task._id);
  } catch (e) {
    console.error("Failed to release locks on cancel:", e);
  }

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
  //bot.action(/ADMIN_UNBAN_.+/, (ctx) => ctx.answerCbQuery());
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

// Short verify: button sends "HV:<intentId>"
bot.action(/^HV:([a-f0-9]{24})$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Checking payment…");
    const intentId = ctx.match[1];
    const intent = await PaymentIntent.findById(intentId);
    if (!intent) { return ctx.reply("❌ Payment session not found. Please try again."); }

    // Verify with Chapa (hosted checkout)
    const ok = await verifyChapaTxRef(intent.chapaTxRef);
    if (!ok) {
      return ctx.reply("🚧 We haven't received a success from Chapa yet. Please complete the payment page and try again.");
    }

    // Mark paid if not already
    if (intent.status !== "paid") {
      intent.status = "paid";
      intent.paidAt = new Date();
      await intent.save();
    }

    // Load draft + user
    const me = await User.findOne({ telegramId: ctx.from.id });
    const draft = await TaskDraft.findById(intent.draft);
    if (!me || !draft) {
      return ctx.reply("❌ Draft expired or user not found. Please try again.");
    }

    // ✅ NEW: continue exactly like your successful_payment path
    await postTaskFromPaidDraft({ ctx, me, draft, intent });

  } catch (err) {
    console.error("HOSTED_VERIFY(HV) error:", err);
    try { await ctx.answerCbQuery("Payment check failed.", { show_alert: true }); } catch (_) {}
  }
});

// Capture every message the winner sends while their work window is active.
// We only store (chatId,messageId) so we can copyMessage later (preserves types/captions).
bot.on('message', async (ctx, next) => {
  try {
    const fromId = ctx.from?.id;
    if (!fromId) return next();

    // Is this user an active doer on some task?
    // Find the latest active task work for this user
    const work = await DoerWork.findOne({ doerTelegramId: fromId, status: 'active' })
                                .sort({ startedAt: -1 })
                                .lean();

    if (!work) return next();

    // Filter out the two system prompts you explicitely do NOT want included
    const txt = ctx.message?.text || ctx.message?.caption || "";
    const blockedEn = "You're actively involved in a task right now, so you can't open the menu, post a task, or apply to other tasks until everything about the current task is sorted out.";
    const blockedAm = "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ምናሌን መክፈት፣ ተግዳሮት መለጠፍ ወይም ሌሎች ተግዳሮቶች ላይ መመዝገብ አይችሉም።";

    
    if (
      txt &&
      (
        txt.trim() === "/start" ||
        txt.trim() === blockedEn.trim() ||
        txt.trim() === blockedAm.trim()
      )
    ) {
      return next();
    }

    const m = ctx.message;
    const base = {
      messageId: m.message_id,
      date: new Date(m.date * 1000),
      type: undefined,
      mediaGroupId: m.media_group_id,
      text: undefined,
      caption: undefined,
      fileIds: [],
      photoBestFileId: undefined,
      documentFileId: undefined,
      videoFileId: undefined,
      audioFileId: undefined,
      voiceFileId: undefined,
      videoNoteFileId: undefined,
      stickerFileId: undefined
    };
    

    base.mediaGroupId = m.media_group_id || undefined; // NEW
    base.isForwarded = !!(m.forward_from || m.forward_from_chat || m.forward_origin || m.forward_date); // NEW


    // text (incl. links)
    if (m.text) {
      base.type = 'text';
      base.text = m.text;
    }
    
    // photos (possibly an album)
    if (m.photo && Array.isArray(m.photo) && m.photo.length) {
      base.type = 'photo';
      // largest size is last item
      base.fileIds = m.photo.map(p => p.file_id);
      base.photoBestFileId = m.photo[m.photo.length - 1].file_id;
      if (m.caption) base.caption = m.caption;
    }

    // document (pdf, etc.)
    if (m.document) {
      base.type = 'document';
      base.documentFileId = m.document.file_id;
      base.fileIds = [m.document.file_id];
      if (m.caption) base.caption = m.caption;
    }

    // video
    if (m.video) {
      base.type = 'video';
      base.videoFileId = m.video.file_id;
      base.fileIds = [m.video.file_id];
      if (m.caption) base.caption = m.caption;
    }

    // audio (music)
    if (m.audio) {
      base.type = 'audio';
      base.audioFileId = m.audio.file_id;
      base.fileIds = [m.audio.file_id];
      if (m.caption) base.caption = m.caption;
    }
    // animation (GIF / mp4 GIF)
    if (m.animation) {
      base.type = 'animation';
      base.animationFileId = m.animation.file_id;
      base.fileIds = [m.animation.file_id];
      if (m.caption) base.caption = m.caption;
    }

    

    // voice (PTT/voice note)
    if (m.voice) {
      base.type = 'voice';
      base.voiceFileId = m.voice.file_id;
      base.fileIds = [m.voice.file_id];
    }

    // video_note
    if (m.video_note) {
      base.type = 'video_note';
      base.videoNoteFileId = m.video_note.file_id;
      base.fileIds = [m.video_note.file_id];
    }

    // sticker (emoji-like)
    if (m.sticker) {
      base.type = 'sticker';
      base.stickerFileId = m.sticker.file_id;
      base.fileIds = [m.sticker.file_id];
    }

    // fallbacks for caption-only cases
    if (!base.type && (m.caption || m.media_group_id)) {
      base.type = 'unknown';
      if (m.caption) base.caption = m.caption;
    }

    await DoerWork.updateOne(
      { _id: work._id },
      { $push: { messages: base } }
    );


    return next();
  } catch (e) {
    console.error("capture doer message error:", e);
    return next();
  }
});
// Handle pagination for bank list
bot.action(/^PAYOUT_PAGE_([a-f0-9]{24})_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const page = parseInt(ctx.match[2]);
  const userId = ctx.from.id;
  const pending = global.pendingPayouts?.[userId];
  if (!pending || String(pending.taskId) !== taskId) {
    return ctx.answerCbQuery("❌ Session expired. Please try again.");
  }
  // Delete the old message to avoid clutter (optional)
  try { await ctx.deleteMessage(); } catch(e) {}
  // Send the new page of bank buttons
  const keyboardMarkup = buildBankKeyboard(taskId, pending.banks, page, pending.selectedBankId);
  return ctx.reply(
    pending.banks && pending.banks.length 
      ? (pending.selectedBankId 
          ? "Choose a bank for payout (current selection marked with ✔):" 
          : "Please choose your bank for payout:") 
      : "No banks available.",
    keyboardMarkup
  );
});

// Handle bank selection
bot.action(/^PAYOUT_SELECT_([a-f0-9]{24})_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const bankId = parseInt(ctx.match[2]);
  const userId = ctx.from.id;
  const pending = global.pendingPayouts?.[userId];
  if (!pending || String(pending.taskId) !== taskId) {
    return ctx.answerCbQuery("❌ Session expired. Please try again.");
  }
  // Find the selected bank details
  const bank = pending.banks.find(b => b.id === bankId);
  if (!bank) {
    return ctx.answerCbQuery("❌ Bank not found. Please try again.");
  }

  // Update selected bank in session and highlight it
  pending.selectedBankId = bank.id;
  pending.selectedBankName = bank.name;
  // Edit the bank list message to highlight the chosen bank
  try {
    const newMarkup = buildBankKeyboard(taskId, pending.banks, 
                                        Math.floor(pending.banks.findIndex(b => b.id === bankId) / 10), 
                                        pending.selectedBankId);
    await ctx.editMessageReplyMarkup(newMarkup.reply_markup);
  } catch (e) {
    console.error("Failed to highlight selected bank:", e);
  }

  // Prompt user for the account number of the selected bank
  const lang = (await User.findOne({ telegramId: userId }))?.language || "en";
  const promptText = (lang === "am") 
    ? `🏦 ${bank.name} ን ይመርጡ። አሁን የአካውንት ቁጥርዎን ያስገቡ።` 
    : `🏦 *${bank.name}* selected. Please enter the account number:`;
  // If a prompt message was sent before, edit it; otherwise, send a new prompt
  if (pending.accountPromptMessageId) {
    try {
      await ctx.telegram.editMessageText(userId, pending.accountPromptMessageId, undefined, promptText, { parse_mode: "Markdown" });
    } catch {
      // If editing fails (e.g., message too old), send a new prompt
      const msg = await ctx.reply(promptText, { parse_mode: "Markdown" });
      pending.accountPromptMessageId = msg.message_id;
    }
  } else {
    const msg = await ctx.reply(promptText, { parse_mode: "Markdown" });
    pending.accountPromptMessageId = msg.message_id;
  }

  // Prepare session state to expect an account number next
  ctx.session.payoutFlow = { step: "awaiting_account", taskId: taskId };
});
// ─── When Doer Marks Task as Completed ───────────────────────────
bot.action(/^COMPLETED_SENT_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(); // acknowledge tap
  try {
    const taskId = ctx.match[1];
    const task = await Task.findById(taskId);
    if (!task) return;

    // Ensure we fetch the correct doerWork for this user
    const work = await DoerWork.findOne({ task: task._id, doerTelegramId: ctx.from.id });
    if (!work) return;

    const doerUser = await User.findById(work.doer);
    const doerLang = doerUser?.language || 'en';

    // 1️⃣ VALIDATION SAFEGUARD:
    // Has this doer actually sent at least ONE valid message/file?
    const hasAnyValidSubmission = work.messages?.length > 0;
    if (!hasAnyValidSubmission) {
      // Use the localized button text in the error message
      const btnText = TEXT.completedSentBtn[doerLang] || TEXT.completedSentBtn.en;
      const errText = (doerLang === 'am')
        ? `እባክዎ የተጠናቀቀውን ስራ ወይም የተግባሩን የተጠናቀቀ ማረጋገጫ በመላክ በኋላ ብቻ "${btnText}" ይጫኑ።`
        : `Please send the completed task or clear proof of completion first, then press "${btnText}."`;
      await ctx.reply(errText);
      return; // 🔒 DO NOT mark completed or notify creator
    }

    


    // --- if we reach here, we allow the normal flow to continue ---

    // (rest of your original code continues here)
    // const creatorUser = await User.findById(task.creator);
    // ...
    
    // Load the task creator's user (to get their Telegram ID and language)
    const creatorUser = await User.findById(task.creator);
    if (!creatorUser) return;
    const lang = creatorUser.language || 'en';
    
    // Flip the doer's control button to checked (✔ Completed task sent)
    
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [[
          Markup.button.callback(`✔ ${TEXT.completedSentBtn[doerLang]}`, '_DISABLED_COMPLETED_SENT')
        ]]
      });
    } catch (err) {
      console.error("Error highlighting Completed task button:", err);
    }
    
    // Mark task as delivered in the database (stop the active timer)
    work.completedAt = new Date();
    work.status = 'completed';
    await work.save();
    
    // Forward all doer’s messages/files to the task creator, preserving format
    for (const entry of work.messages) {
      try {
        await ctx.telegram.copyMessage(
          creatorUser.telegramId,   // target: creator
          work.doerTelegramId,      // from: doer's chat
          entry.messageId           // message to copy
        );
      } catch (err) {
        console.error("Failed to forward doer message:", err);
      }
    }
    
    // Send the creator a decision prompt with "Valid" and "Needs Fixing" options
    const decisionMsg = (lang === 'am')
      ? "የተጠናቋል ስራ ተልኳል። እባክዎ በታች ያሉትን አማራጮች ይምረጡ።"
      : "The completed work has been submitted. Please choose below.";
    const decisionKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(TEXT.validBtn[lang], `CREATOR_VALID_${task._id}`),
        Markup.button.callback(TEXT.needsFixBtn[lang], `CREATOR_NEEDS_FIX_${task._id}`)
      ]
    ]);
    const sent = await ctx.telegram.sendMessage(creatorUser.telegramId, decisionMsg, decisionKeyboard);
    
    // Save the creator’s message ID (for editing those buttons later if needed)
    work.creatorDecisionMessageId = sent.message_id;
    await work.save();
    
    // (Revision timer logic remains unchanged below ...)
    const revisionMs = (task.revisionTime || 0) * 60 * 60 * 1000;
    const halfMs = revisionMs / 2;
    if (halfMs > 0) {
      const creatorTgId = creatorUser.telegramId;
      setTimeout(async () => {
        // ... [existing half-time auto-finalize code] ...
      }, halfMs);
    } else {
      // If no revision period, finalize immediately
      await releasePaymentAndFinalize(task._id, 'accepted');
    }
  } catch (e) {
    console.error("COMPLETED_SENT handler error:", e);
  }
});


// ─── CREATOR “Valid” Action ───────────────────────────
bot.action(/^CREATOR_VALID_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || 'en';
  // Highlight "Valid" and disable "Needs Fixing"
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(`✔ ${TEXT.validBtn[lang]}`, `_DISABLED_VALID`),
        Markup.button.callback(TEXT.needsFixBtn[lang], `_DISABLED_NEEDS_FIX`)
      ]]
    });
  } catch {}
  // Immediately finalize: release escrow and send rating prompts
  await releasePaymentAndFinalize(taskId, 'accepted');
});

// ─── CREATOR “Needs Fixing” Action ───────────────────────────
bot.action(/^CREATOR_NEEDS_FIX_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || 'en';
  // Only allow if still within first half of revision time
  const work = await DoerWork.findOne({ task: taskId });
  if (!work) return;
  const task = await Task.findById(taskId);
  const halfDeadline = new Date(work.completedAt.getTime() + (task.revisionTime * 60 * 60 * 1000) / 2);
  if (new Date() > halfDeadline) {
    // Too late: half revision window passed, auto-validating
    try {
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [[
          Markup.button.callback(`✔ ${TEXT.validBtn[lang]}`, `_DISABLED_VALID`),
          Markup.button.callback(TEXT.needsFixBtn[lang], `_DISABLED_NEEDS_FIX`)
        ]]
      });
    } catch {}
    // Finalize as valid since revision window lapsed
    await releasePaymentAndFinalize(taskId, 'timeout');
    return;
  }
  // Disable both decision buttons and mark "Needs Fixing" as chosen
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(TEXT.validBtn[lang], `_DISABLED_VALID`),
        Markup.button.callback(`✔ ${TEXT.needsFixBtn[lang]}`, `_DISABLED_NEEDS_FIX`)
      ]]
    });
  } catch {}
  // Notify the creator to list all issues and provide a "Send Fix Notice" button
  const instructMsg = (lang === 'am')
    ? "❗ እባክዎን ያስተካክሏቸው ሁሉንም ጉዳዮች በመልእክቶች ተዝርዞ ይጻፉ። ከተግባሩ ግልባጭ ውጪ ማስፈልግ አይፈቀድም። የቀረውን ጊዜ ተጠቅመው ይህን ዝርዝር ያቅርቡ። ከተጨረሱ በኋላ “ማስተካከል ማሳወቂያ ላክ” የሚለውን ቁልፍ ይጫኑ።"
    : "❗ Please *list everything* that needs fixing in separate messages below. You cannot request changes beyond the original task description. You have until halfway through the revision period to send this list. Once done, tap **Send Fix Notice**.";
  await ctx.reply(instructMsg, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [ Markup.button.callback(
          lang === 'am' ? "🛠 ማስተካከል ማሳወቂያ ላክ" : "🛠 Send Fix Notice",
          `CREATOR_SEND_FIX_NOTICE_${taskId}`
      ) ]
    ])
  });
  // Put the creator into "fix listing" mode to capture their messages
  ctx.session = ctx.session || {};
  ctx.session.fixingTaskId = taskId;
  // (Also mark in DB when revision was requested, if needed)
  // work.revisionRequestedAt = new Date();
  // await work.save();
});

// ─── CREATOR “Send Fix Notice” Action ───────────────────────────
bot.action(/^CREATOR_SEND_FIX_NOTICE_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];
  const creator = await User.findOne({ telegramId: ctx.from.id });
  const lang = creator?.language || 'en';
  // Load the work and any collected fix request messages
  const work = await DoerWork.findOne({ task: taskId }).populate('doer');
  if (!work) return;
  const doerUser = work.doer;
  const doerTid = work.doerTelegramId;
  const now = new Date();
  const halfDeadline = new Date(work.completedAt.getTime() + (await Task.findById(taskId)).revisionTime * 60 * 60 * 1000 / 2);
  if (now > halfDeadline) {
    // Past halfway point – treat as expired
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[ Markup.button.callback(`✔ ${TEXT.validBtn[lang]}`, `_DISABLED_SEND_FIX_NOTICE`) ]]
    }).catch(()=>{});
    // Auto-finalize as valid
    await releasePaymentAndFinalize(taskId, 'timeout');
    return;
  }
  // Check if creator provided any fix details
  if (!work.fixRequests || work.fixRequests.length === 0) {
    // No messages listed – show error with remaining time
    const remainingMs = halfDeadline.getTime() - now.getTime();
    const minsLeft = Math.max(0, Math.ceil(remainingMs / 60000));
    let timeLeftStr;
    if (minsLeft >= 60) {
      const hrs = Math.floor(minsLeft / 60);
      const mins = minsLeft % 60;
      timeLeftStr = (hrs > 0)
        ? `${hrs} hour${hrs>1?'s':''}${mins>0?` ${mins} min${mins>1?'s':''}`:''}`
        : `${mins} minute${mins!==1?'s':''}`;
    } else {
      timeLeftStr = `${minsLeft} minute${minsLeft!==1?'s':''}`;
    }
    const alertMsg = (lang === 'am')
      ? `❌ ማስተካከል ምንም ነገር አልጻፉም። ቀሪ ጊዜ፡ ${minsLeft} ደቂቃ።`
      : `❌ You haven't listed any issues to fix. Time remaining: ${timeLeftStr}.`;
    return ctx.answerCbQuery(alertMsg, { show_alert: true });
  }
  // Creator provided fix requests: forward all to the task doer
  for (const req of work.fixRequests) {
    try {
      await ctx.telegram.forwardMessage(doerTid, creator.telegramId, req.messageId);
    } catch (err) {
      console.error("Failed to forward fix request message:", err);
    }
  }
  // Notify the doer with options to report or send corrected work
  const doerLang = doerUser.language || 'en';
  const doerMsgText = (doerLang === 'am')
    ? "⚠️ ተግዳሮቱን ፈጣሪ ማስተካከል እንዳለበት ጠይቋል። እባክዎን የተጠየቁትን ነገሮች አስተካክሏቸው የተስተካከለውን ስራ ይላኩ። የተሳሳቱ ጥያቄዎች እንዳሉ ቢያስቡ ሪፖርት ማድረግ ይችላሉ።"
    : "⚠️ The client has requested some revisions. Please address the issues and send the corrected work. If any request seems out of scope, you may report it.";
  await ctx.telegram.sendMessage(doerTid, doerMsgText, Markup.inlineKeyboard([
    [
      Markup.button.callback(doerLang === 'am' ? "⚠️ ሪፖርት" : "⚠️ Report this", `DOER_REPORT_${taskId}`),
      Markup.button.callback(doerLang === 'am' ? "✅ አስተካክሏል እንደገና ላክ" : "✅ Send corrected version", `DOER_SEND_CORRECTED_${taskId}`)
    ]
  ]));
  

  // Mark the fix notice as sent and disable the creator's button
  work.fixNoticeSentAt = new Date();
  
  work.currentRevisionStatus = 'awaiting_fix';
  work.revisionStartedAt = new Date();
  // Optional: set a deadline if you want a hard stop; you already track half-window elsewhere
  // work.revisionDeadlineAt = new Date(Date.now() + ...);
  await work.save();

  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[ Markup.button.callback(
        lang === 'am' ? "✔ ማስተካከል ማሳወቂያ ተልኳል" : "✔ Fix Notice Sent",
        `_DISABLED_SEND_FIX_NOTICE`
      ) ]]
    });
  } catch {}
  
  // Clear the creator's session fix mode
  ctx.session.fixingTaskId = null;
});

// ─── Handle Creator’s Fix Comments (Message Handler) ───────────────────
bot.on('message', async (ctx) => {
  if (!ctx.session?.fixingTaskId) return;  // only handle if user is in fix-listing mode
  const taskId = ctx.session.fixingTaskId;
  // Ignore system/command messages
  const msg = ctx.message;
  if (!msg || msg.text?.startsWith('/')) return;
  try {
    const work = await DoerWork.findOne({ task: taskId });
    if (!work) {
      ctx.session.fixingTaskId = null;
      return;
    }
    // Build a record for this fix-request message
    const entry = {
      messageId: msg.message_id,
      date: new Date(msg.date * 1000),                // Telegram timestamp
      type: msg.sticker ? 'sticker'
           : msg.photo ? 'photo'
           : msg.document ? 'document'
           : msg.video ? 'video'
           : msg.audio ? 'audio'
           : msg.voice ? 'voice'
           : 'text'
    };
    if (msg.text) entry.text = msg.text;
    if (msg.caption) entry.caption = msg.caption;
    if (msg.media_group_id) entry.mediaGroupId = msg.media_group_id;
    // Store file identifiers for media (for record-keeping)
    if (msg.photo) {
      entry.fileIds = msg.photo.map(p => p.file_id);
    } else if (msg.document) {
      entry.fileIds = [ msg.document.file_id ];
    } else if (msg.video) {
      entry.fileIds = [ msg.video.file_id ];
    } else if (msg.audio) {
      entry.fileIds = [ msg.audio.file_id ];
    } else if (msg.voice) {
      entry.fileIds = [ msg.voice.file_id ];
    } else if (msg.sticker) {
      entry.fileIds = [ msg.sticker.file_id ];
    }
    // Append to fixRequests in DB
    work.fixRequests = work.fixRequests || [];
    work.fixRequests.push(entry);
    await work.save();
  } catch (err) {
    console.error("Error recording fix request message:", err);
  }
 


});
// ─── Collect Doer's Corrected Submissions (after Fix Notice) ──────────────
bot.on('message', async (ctx) => {
  try {
    const tgId = ctx.from?.id;
    if (!tgId) return;

    // Fast path: ignore commands and /start triggers outright
    const msg = ctx.message;
    if (!msg) return;
    const text = msg.text || msg.caption || "";

    if (text?.startsWith('/')) return; // includes /start and any other command

    // Ignore the lock warning messages (both languages) – these are bot messages, not doer submissions
    const LOCK_EN = "You're actively involved in a task right now, so you can't open the menu, post a task, or apply to other tasks until everything about the current task is sorted out.";
    const LOCK_AM = "ይቅርታ፣ አሁን በአንድ ተግዳሮት ላይ በቀጥታ ተሳትፈዋል። ይህ ተግዳሮት እስከሚጠናቀቅ ወይም የመጨረሻ ውሳኔ እስኪሰጥ ድረስ ምናሌን መክፈት፣ ተግዳሮት መለጠፍ ወይም ሌሎች ተግዳሮቶች ላይ መመዝገብ አይችሉም።";
    if (text === LOCK_EN || text === LOCK_AM) return; // just to be extra safe

    // Find the active revision task (awaiting_fix) for this doer
    const work = await DoerWork.findOne({
      doerTelegramId: tgId,
      currentRevisionStatus: 'awaiting_fix'
    });

    if (!work) return; // user is not currently fixing anything

    // Build a normalized entry describing *exactly* what the doer sent
    const entry = {
      messageId: msg.message_id,
      date: new Date(msg.date * 1000),
      type: msg.sticker ? 'sticker'
           : msg.photo ? 'photo'
           : msg.document ? 'document'
           : msg.video ? 'video'
           : msg.audio ? 'audio'
           : msg.voice ? 'voice'
           : msg.video_note ? 'video_note'
           : 'text'
    };
    if (msg.text) entry.text = msg.text;
    if (msg.caption) entry.caption = msg.caption;
    if (msg.media_group_id) entry.mediaGroupId = msg.media_group_id;

    if (msg.photo) entry.fileIds = msg.photo.map(p => p.file_id);
    else if (msg.document) entry.fileIds = [ msg.document.file_id ];
    else if (msg.video) entry.fileIds = [ msg.video.file_id ];
    else if (msg.audio) entry.fileIds = [ msg.audio.file_id ];
    else if (msg.voice) entry.fileIds = [ msg.voice.file_id ];
    else if (msg.sticker) entry.fileIds = [ msg.sticker.file_id ];
    else if (msg.video_note) entry.fileIds = [ msg.video_note.file_id ];

    // Append to correctedBuffer
    work.correctedBuffer = work.correctedBuffer || [];
    work.correctedBuffer.push(entry);
    await work.save();
  } catch (e) {
    console.error("Collect corrected submissions error:", e);
  }
});

// ─── DOER Dummy Actions for Report/Corrected (to be implemented later) ───
bot.action(/^DOER_REPORT_(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];

  // 1. Try to visually "lock" the buttons for the doer
  try {
    const currentKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;
    const newRow = currentKeyboard[0].map(btn => {
      if (btn.callback_data && btn.callback_data.startsWith("DOER_REPORT_")) {
        // Highlight the report button to show it's chosen
        return Markup.button.callback(
          "✔ " + btn.text,
          "_DISABLED_DOER_REPORT"
        );
      }
      if (btn.callback_data && btn.callback_data.startsWith("DOER_SEND_CORRECTED_")) {
        // Disable the corrected version button
        return Markup.button.callback(
          btn.text,
          "_DISABLED_DOER_SEND_CORRECTED"
        );
      }
      return Markup.button.callback(btn.text, "_DISABLED_GENERIC");
    });

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [ newRow ]
    });
  } catch (e) {
    console.error("Failed to edit inline keyboard on report:", e);
  }

  // 2. Immediate popup to the doer so they know something happened
  try {
    await ctx.answerCbQuery(
      "Your report has been registered. Taskifii is locking the task and will investigate.",
      { show_alert: true }
    );
  } catch (e) {
    // not critical
  }

  // 3. Run the escalation logic (ban both, notify both, dump evidence, etc.)
  try {
    await escalateDoerReport(ctx, taskId);
  } catch (err) {
    console.error("escalateDoerReport top-level error:", err);
  }
});



bot.action("_DISABLED_DOER_REPORT", async (ctx) => {
  await ctx.answerCbQuery(); // silent no-op
});
bot.action("_DISABLED_DOER_SEND_CORRECTED", async (ctx) => {
  await ctx.answerCbQuery(); // silent no-op
});
bot.action("_DISABLED_GENERIC", async (ctx) => {
  await ctx.answerCbQuery();
});
// ─── DOER clicks "Send corrected version" ────────────────────────────────
bot.action(/^DOER_SEND_CORRECTED_(.+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    const doerTid = ctx.from.id;

    // Load the work + task + creator
    const work = await DoerWork.findOne({ task: taskId, doerTelegramId: doerTid }).lean();
    if (!work || work.currentRevisionStatus !== 'awaiting_fix') {
      await ctx.answerCbQuery("No active fix is pending.", { show_alert: true });
      return;
    }

    // Validate at least one valid corrected submission exists
    const buf = Array.isArray(work.correctedBuffer) ? work.correctedBuffer.slice() : [];
    if (buf.length === 0) {
      await ctx.answerCbQuery(
        "Please send at least one corrected file/text *before* tapping “Send corrected version”.",
        { show_alert: true }
      );
      return;
    }

    // 1) On the doer’s button message: make both buttons inert, highlight the corrected one
    try {
      const currentKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;
      const newRow = currentKeyboard[0].map(btn => {
        if (btn.callback_data && btn.callback_data.startsWith("DOER_SEND_CORRECTED_")) {
          return Markup.button.callback("✔ " + btn.text, "_DISABLED_DOER_SEND_CORRECTED");
        }
        if (btn.callback_data && btn.callback_data.startsWith("DOER_REPORT_")) {
          return Markup.button.callback(btn.text, "_DISABLED_DOER_REPORT");
        }
        return Markup.button.callback(btn.text, "_DISABLED_GENERIC");
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    } catch (e) {
      console.error("Failed to edit inline keyboard on corrected:", e);
    }

    // 2) Tell the doer we sent it
    try {
      await ctx.answerCbQuery(
        "Your corrected work has been sent to the task creator. Please wait while they review it.",
        { show_alert: true }
      );
    } catch {}

    // 3) Forward/copy the doer’s corrected submissions to the creator, exactly as-is
    const task = await Task.findById(taskId).populate('creator');
    const creatorUser = await User.findById(task.creator);
    const creatorTid = creatorUser.telegramId;

    // Sort by original order (date then messageId)
    buf.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0) || (a.messageId - b.messageId));

    for (const m of buf) {
      try {
        await ctx.telegram.copyMessage(
          creatorTid,
          doerTid,
          m.messageId
        );
      } catch (e) {
        console.error("copyMessage failed for corrected item:", e);
      }
    }

    // 4) Ask creator to Approve/Reject this corrected batch (dummy handlers for now)
    const notice =
      "The task doer has sent a *corrected* version of the completed task.\n\n" +
      "• If everything looks acceptable, tap **Approve**.\n" +
      "• If it is still not acceptable, tap **Reject** — Taskifay will take matters into their own hands and the doer will be banned until the issue is resolved.";

    await ctx.telegram.sendMessage(
      creatorTid,
      notice,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("Approve", `CREATOR_APPROVE_CORRECTED_${taskId}`),
            Markup.button.callback("Reject",  `CREATOR_REJECT_CORRECTED_${taskId}`)
          ]
        ])
      }
    );

    // 5) Flip state to mark that a corrected batch was sent
    await DoerWork.updateOne(
      { _id: work._id },
      { $set: { currentRevisionStatus: 'fix_received' }, $unset: { correctedBuffer: "" } }
    );

  } catch (err) {
    console.error("DOER_SEND_CORRECTED handler error:", err);
    await ctx.answerCbQuery("Something went wrong. Please try again.", { show_alert: true });
  }
});
// ─── Creator Approve/Reject corrected version (dummy) ─────────────────────
bot.action(/^CREATOR_APPROVE_CORRECTED_(.+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    // Inert + highlight Approve
    try {
      const kb = ctx.callbackQuery.message.reply_markup.inline_keyboard[0];
      const newRow = kb.map(btn => {
        const data = btn.callback_data || "";
        if (data.startsWith("CREATOR_APPROVE_CORRECTED_")) {
          return Markup.button.callback("✔ " + btn.text, "_DISABLED_CREATOR_APPROVE_CORRECTED");
        }
        if (data.startsWith("CREATOR_REJECT_CORRECTED_")) {
          return Markup.button.callback(btn.text, "_DISABLED_CREATOR_REJECT_CORRECTED");
        }
        return Markup.button.callback(btn.text, "_DISABLED_GENERIC");
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    } catch {}
    await ctx.answerCbQuery("Approved (dummy).");
  } catch (e) {
    console.error("approve corrected error:", e);
    await ctx.answerCbQuery("Error.", { show_alert: true });
  }
});

bot.action(/^CREATOR_REJECT_CORRECTED_(.+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    // Inert + highlight Reject
    try {
      const kb = ctx.callbackQuery.message.reply_markup.inline_keyboard[0];
      const newRow = kb.map(btn => {
        const data = btn.callback_data || "";
        if (data.startsWith("CREATOR_REJECT_CORRECTED_")) {
          return Markup.button.callback("✔ " + btn.text, "_DISABLED_CREATOR_REJECT_CORRECTED");
        }
        if (data.startsWith("CREATOR_APPROVE_CORRECTED_")) {
          return Markup.button.callback(btn.text, "_DISABLED_CREATOR_APPROVE_CORRECTED");
        }
        return Markup.button.callback(btn.text, "_DISABLED_GENERIC");
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    } catch {}
    await ctx.answerCbQuery("Rejected (dummy).");
  } catch (e) {
    console.error("reject corrected error:", e);
    await ctx.answerCbQuery("Error.", { show_alert: true });
  }
});

// Prevent clicks on inert variants
bot.action("_DISABLED_CREATOR_APPROVE_CORRECTED", async (ctx) => { await ctx.answerCbQuery(); });
bot.action("_DISABLED_CREATOR_REJECT_CORRECTED",  async (ctx) => { await ctx.answerCbQuery(); });







// ─── Disabled Button Handlers (prevent clicks on inert buttons) ─────────
bot.action("_DISABLED_VALID", async (ctx) => { 
  await ctx.answerCbQuery(); 
});
bot.action("_DISABLED_NEEDS_FIX", async (ctx) => { 
  await ctx.answerCbQuery(); 
});
bot.action("_DISABLED_SEND_FIX_NOTICE", async (ctx) => { 
  await ctx.answerCbQuery(); 
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
      console.log("Bot started successfully");
      // Start periodic checks
      checkTaskExpiries(bot);
      sendReminders(bot);
    }).catch(err => {
      console.error("Bot failed to start:", err);
    });

    return bot;
  }
