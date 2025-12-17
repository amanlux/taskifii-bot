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
  // NEW: skills (fields) the user is good at – used for recommendations
  skills:         { type: [String], default: [] },
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
// Helper: track if the creator’s rating prompt was sent early.
global.sentRatingPromptToCreator = global.sentRatingPromptToCreator || {};


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

// ---------------------------
// Ratings / Finalization / Credits
// ---------------------------
const RATING_CHANNEL_ID = "-1002289847417";
const REFUND_AUDIT_CHANNEL_ID = "-1002616271109";
const DISPUTE_CHANNEL_ID = "-1002432632907";
const AUDIT_CHANNEL_ID = "-1002616271109";      // private audit channel
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
const DisputePackageSchema = new mongoose.Schema({
  task:    { type: mongoose.Schema.Types.ObjectId, ref: 'Task', index: true, required: true, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doer:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // For visual grouping + reliability months later
  headerMessageId: { type: Number },            // first message in channel (group header)
  lastChunkMessageId: { type: Number },         // message that has the buttons
  channelId: { type: String, default: String(DISPUTE_CHANNEL_ID) },

  // Audit & resiliency
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const DisputePackage = mongoose.models.DisputePackage
  || mongoose.model('DisputePackage', DisputePackageSchema);

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
  // First-half / second-half tracking
  halfWindowEnforcedAt: { type: Date },
  halfWindowCanceledAt: { type: Date },

  // When the doer clicked "Send corrected version" during revision
  doerCorrectedClickedAt: { type: Date },


  // We'll store the doer-facing message that contains the "Completed task sent" button,
  // so we can flip it to a checked/inert state.
  doerControlMessageId: { type: Number },
  // Add these fields inside DoerWorkSchema
  reminder65SentAt: { type: Date },       // ensures the 65% reminder is sent once
  timeUpNotifiedAt: { type: Date },       // ensures the "time up" notice is sent once
  penaltyStartAt:   { type: Date },       // when the late-penalty window begins
  penaltyEndAt:     { type: Date },       // when fee would hit 35% (or below)
  // In DoerWorkSchema (add anywhere among other fields)
  punishmentStartedAt: { type: Date },
  punishmentMessageId: { type: Number },
  punishmentPaidAt: { type: Date },


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
    // stores the message id of the "Report this / Send corrected version" keyboard sent to the doer
  doerDecisionMessageId: { type: Number },

  // optional flags for auditing/cancellation
  secondHalfEnforcedAt: { type: Date },
  secondHalfCanceledAt: { type: Date },

  
  
  // NEW: Revision tracking
  revisionStartedAt: { type: Date },
  revisionDeadlineAt: { type: Date },
  revisionCount: { type: Number, default: 0 },
  currentRevisionStatus: { 
    type: String, 
    enum: ['none', 'awaiting_fix', 'fix_received', 'accepted'], 
    default: 'none' 
  },
  
    // NEW: Creator final decision (after corrected work)
  creatorFinalDecisionMessageId: { type: Number }, // Approve/Reject keyboard message id
  finalDecisionEnforcedAt:       { type: Date },   // when the post-correction timeout was enforced
  finalDecisionCanceledAt:       { type: Date },   // set when creator Approve/Reject in time



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
  profileFieldsIntro: {
    en: "Select 1–7 fields that you are skilled at. These will help us recommend tasks that match your expertise if you decide to become a task doer. It doesn’t matter if your skill level is beginner, intermediate, or professional. You can change your selections anytime, except when you are involved with an active task.",
    am: "በችሎታ ያለዎትን 1-7 መስኮች ይምረጡ። እነዚህ ከፈለጉ ወደ ተግዳሮት አካል ሲሆኑ ከባለሙያነትዎ ጋር የሚጣጣሙ ተግዳሮቶችን እንድናመርምርሎት ይረዳናሉ። የችሎታዎ ደረጃ ጀማሪ ወይም መካከለኛ ወይም ፕሮፌሽናል መሆኑ አይገባም። ከአንድ ንቁ ተግዳሮት ጋር ባለማያተሉ ጊዜ ምርጫዎን በማንኛውም ጊዜ መቀየር ትችላላችሁ።"
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
    en: "If you have any related file for this task (like a reference document, image, or example), send it now.\n\nYou can send multiple files (photos, documents, videos, audio, etc.). When you finish, click Done. If you don't have any, you can click Skip.",
    am: "ለዚህ ተግዳሮት የተያያዘ ፋይል (ሰነድ፣ ምስል ወይም ምሳሌ) ካለዎት አሁን ይላኩት።\n\nብዙ ፋይሎች (ፎቶ፣ ሰነድ፣ ቪዲዮ፣ ኦዲዮ ወዘተ) ማስተላለፍ ትችላላችሁ። ሲጨርሱ \"Done\" ይጫኑ። ፋይል ካልነበረዎት እባክዎን \"Skip\" ይጫኑ።"
  },
  relatedFileError: {
    en: "Please send a valid related file (photo, document, video, audio, voice, etc.). Plain text messages (even if they only contain a link) are not accepted as related files.",
    am: "እባክዎን ትክክለኛ የተያያዘ ፋይል (ፎቶ፣ ሰነድ፣ ቪዲዮ፣ ኦዲዮ፣ የድምጽ መልዕክት ወዘተ) ይላኩ። ጽሁፍ መልዕክቶች (ብቸኛ አገናኝ ቢኖራቸውም) እንደ ተያያዥ ፋይል አንቀበልም።"
  },
  relatedFileDoneBtn: {
    en: "Done",
    am: "ተጠናቋል"
  },
  relatedFileDoneError: {
    en: "Please send at least one valid related file before tapping Done. Any file, audio, video, photo, voice note or even a message that only contains a link is accepted. Plain text messages without a file or link are not accepted as related files.",
    am: "እባክዎን \"Done\" ከመጫኑ በፊት ቢያንስ አንድ ትክክለኛ የተያያዘ ፋይል ይላኩ። ፋይሉ ፎቶ፣ ሰነድ፣ ቪዲዮ፣ ኦዲዮ፣ የድምጽ መልዕክት ወይም ብቻውን አገናኝ ያለው መልዕክት ሊሆን ይችላል። በፋይል ወይም አገናኝ ያልተያያዘ ቀለማት ጽሁፍ እንደ ተያያዥ ፋይል አንቀበልም።"
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
  paymentFeeErrorRelativePenalty: {
    en: "Payment fee must be at least 5× the penalty per hour you set. Please increase the payment amount (or reduce the penalty) and try again.",
    am: "የክፍያው መጠን ቢያንስ ከእያንዳንዱ ሰዓት የቅጣት መጠን 5 ጊዜ መሆን አለበት። እባክዎ የክፍያውን መጠን ያሳድጉ (ወይም የቅጣቱን መጠን ያሳንሱ) እና ዳግም ይሞክሩ።"
  },

  askTimeToComplete: {
    en: "What's the time required in hours to complete the task? (1-120)",
    am: "ተግዳሮቱን ለመጨረስ የሚወስደው ጊዜ በሰዓት ያስገቡ (1-120)"
  },
  timeToCompleteError: {
    en: "Hours must be >0 and ≤120.",
    am: "ሰዓቶቹ ከ0 በላይ እና ≤120 መሆን አለበት።"
  },
  timeToCompleteErrorRelativeRevision: {
    en: "Time to complete must be at least 2× the revision time you set. Please enter a larger number of hours and try again.",
    am: "የተግባሩ ጊዜ ቢያንስ ከማሻሻያ ጊዜው 2 ጊዜ መሆን አለበት። እባክዎ የስራ ጊዜውን ቁጥር ያሳድጉ እና ዳግም ይሞክሩ።"
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
    en: "Skills",
    am: "ችሎታዎች"

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
  doer65Reminder: {
    en: (h, m) => [
      "⏰ Heads up: time is ticking!",
      `You have ${h} hour(s) and ${m} minute(s) left to complete and submit your task.`,
      "Please send your completed work to the bot, to @taskifay, and to the task creator, then tap “Completed task sent”."
    ].join("\n"),
    am: (h, m) => [
      "⏰ ማስታወሻ፦ ጊዜው በፍጥነት እየፈጠነ ነው!",
      `ለተሰሩት ስራዎች ማቅረብ እና ለመላክ ${h} ሰአት እና ${m} ደቂቃ ብቻ ቀርቶታል።`,
      "እባክዎ ተጠናቀቀው ያሉትን ስራዎች ለቦቱ፣ ለ@taskifay እና ለስራ ፈጣሪው ያስሩ እና “ተጠናቋል” የሚለውን ቁልፍ ይጫኑ።"
    ].join("\n")
  },

  creator65Reminder: {
    en: (doerName) => [
      "⏰ 65% of the time to complete has passed.",
      `Please consider checking in with the task doer${doerName ? ` (${doerName})` : ""} to confirm status.`
    ].join("\n"),
    am: (doerName) => [
      "⏰ ስራውን ለመጨረስ የተመደበው ጊዜ 65% አልፏል።",
      `እባክዎ የስራውን ሁኔታ ለማረጋገጥ ከስራ ሰሪው${doerName ? ` (${doerName})` : ""} ጋር ለመገናኘት ያስቡ።`
    ].join("\n")
  },

  // Replace the whole doerTimeUp entry inside TEXT = { ... }
  doerTimeUp: {
    en: (penaltyPerHour, penaltyEndAt) => {
      const now = new Date();
      const leftMs = Math.max(0, new Date(penaltyEndAt).getTime() - now.getTime());
      const h = Math.floor(leftMs / 3600000);
      const m = Math.floor((leftMs % 3600000) / 60000);

      return [
        "⏰ Time’s up.",
        penaltyPerHour > 0
          ? `From now on, ${penaltyPerHour} birr will be deducted every hour until you submit the completed task.`
          : "From now on, late submission may affect your fee (penalty per hour was not set).",
        penaltyPerHour > 0
          ? `Exact time until your fee would drop to 35%: ${h} hour(s) and ${m} minute(s).`
          : null,
        "If you don’t send a valid completed task and tap “Completed task sent” before the fee hits 35%, your Taskifii access will be banned until you pay a punishment fee (50% of the task fee).",
        "Please submit to the bot, to @taskifay, and to the task creator as soon as possible."
      ].filter(Boolean).join("\n");
    },
    am: (penaltyPerHour, penaltyEndAt) => {
      const now = new Date();
      const leftMs = Math.max(0, new Date(penaltyEndAt).getTime() - now.getTime());
      const h = Math.floor(leftMs / 3600000);
      const m = Math.floor((leftMs % 3600000) / 60000);

      return [
        "⏰ ጊዜው አልቋል።",
        penaltyPerHour > 0
          ? `ከአሁን ጀምሮ በየሰአቱ ${penaltyPerHour} ብር ከክፍያዎ ይቀነሳል እስከ ተጠናቀቀ ስራ እስኪላክ ድረስ።`
          : "ከአሁን ጀምሮ ዘግይተው ማቅረብ በክፍያዎ ላይ ተፅእኖ ሊኖረው ይችላል (የቅጣት መጠን አልተቀመጠም)።",
        penaltyPerHour > 0
          ? `እስኪደርስ ድረስ ወደ 35% የሚወርድ ትክክለኛ ጊዜ፦ ${h} ሰአት እና ${m} ደቂቃ።`
          : null,
        "ትክክለኛ የተጠናቀቀ ስራ ካልላኩ እና “ተጠናቋል” ካልጫኑ እስከ ክፍያዎ 35% እስኪሆን ድረስ፣ ከTaskifii ታግዳሉ እና እንደገና ለመግባት የተግባሩ ክፍያ 50% የቅጣት ክፍያ መክፈል ያስፈልግዎታል።",
        "እባክዎ የተጠናቀቀውን ስራ ለቦቱ፣ ለ@taskifay እና ለስራ ፈጣሪው ያስሩ፣ ከዚያም “ተጠናቋል” ይጫኑ።"
      ].filter(Boolean).join("\n");
    }
  },

  punishBtn: { 
    en: "Punishment fee",
    am: "የቅጣት ክፍያ" },
  punishAlreadyPaid: {
    en: "✅ Punishment fee already paid. You have full access again.",
    am: "✅ የቅጣት ክፍያ ተከፍሏል። መዳረሻዎ ተመልሷል።"
  },
  punishLinkReady: {
    en: "💳 Here’s your punishment-fee checkout link:",
    am: "💳 የቅጣት ክፍያ መክፈል ሊንክ እዚህ ነው፦"
  },
  punishLinkNew: {
    en: "Session refreshed. Use the newest link below.",
    am: "ክፍያ ስርዓት ተዘምኗል። ከታች ያለውን አዲሱን ሊንክ ይጠቀሙ።"
  },
  

  creatorTimeUp: {
    en: (penaltyPerHour) => [
      "⚠️ The doer has not submitted within the allotted time.",
      penaltyPerHour > 0
        ? `A penalty of ${penaltyPerHour} birr per hour now applies until submission (before the fee reaches 35%).`
        : "A late penalty window is now in effect.",
      "We’re extremely sorry for this inconvenience."
    ].join("\n"),
    am: (penaltyPerHour) => [
      "⚠️ የስራው ሰሪ በተመደበው ጊዜ ውስጥ ስራውን አላስረከበም።",
      penaltyPerHour > 0
        ? `ከአሁን ጀምሮ እስከስራው ድረስ በየሰአቱ ${penaltyPerHour} ብር ቅጣት ይተገበራል (ክፍያው እስከ 35% እንዲደርስ በፊት)።`
        : "የቆይታ ቅጣት ሂደት ተጀምሯል።",
      "ስለተፈጠረው እርምጃ በጣም ይቅርታ እናቀርባለን።"
    ].join("\n")
  },
  disputeCreatorRejectNoticeToCreator: {
    en: [
      "✅ We have received your claim for this task.",
      "Taskifii will study this case and get back to you with the final decision.",
      "",
      "⛔ Until then, you are temporarily banned from using Taskifii."
    ].join("\n"),
    am: [
      "✅ የዚህ ተግባር ቅሬታዎን ተቀብለናል።",
      "Taskifii ጉዳዩን በዝርዝር ይመርማል እና መጨረሻ ውሳኔ ይሰጣል።",
      "",
      "⛔ እስከዚያ ድረስ በጊዜያዊነት ከTaskifii መጠቀም ተከልክላችሁ።"
    ].join("\n")
  },

  disputeCreatorRejectNoticeToDoer: {
    en: [
      "⚠️ The task creator has rejected your corrected version of the completed task.",
      "Taskifii will study this case and get back to you with the final decision.",
      "",
      "⛔ Until then, you are temporarily banned from using Taskifii."
    ].join("\n"),
    am: [
      "⚠️ የተግባሩ ፈጣሪ የተጠናቀቀውን የተስተካከለውን ስራዎ አልተቀበለውም።",
      "Taskifii ጉዳዩን በዝርዝር ይመርማል እና መጨረሻ ውሳኔ ይሰጣል።",
      "",
      "⛔ እስከዚያ ድረስ በጊዜያዊነት ከTaskifii መጠቀም ተከልክላችሁ።"
    ].join("\n")
  },
  duplicateTaskPaymentNotice: {
    en: "⚠️ You can only have one task active at a time. This payment link was for an older task draft, so the money you just paid will be refunded back to your original payment method shortly.",
    am: "⚠️ በአንድ ጊዜ አንድ ንቁ ተግዳሮት ብቻ ማስቀመጥ ትችላላችሁ። ይህ የክፍያ ሊንክ ለቀድሞ የተተወ ረቂቅ ነበር፣ ስለዚህ አሁን የከፈሉት ገንዘብ ወደ መጀመሪያው የክፍያ መንገድዎ በቅርቡ ይመለሳል።"
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

  // ⚠️ New: explain why "Post Task" might not do anything
  lines.push(
    lang === "am"
      ? "ℹ️ ከታች ያለውን “ተግዳሮት ልጥፍ” ቁልፍ ሲጫኑት ምንም ነገር ካልተፈጠረ፣ በፕሮፋይልዎ ያስገቡት የስልክ ቁጥር ወይም ኢሜይል ትክክል አልሆነም ማለት ነው።"
      : "ℹ️ If the *Post Task* button below does nothing when you tap it, it means the phone number or email you gave in your profile is not valid."
  );

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
    
    
    // ----- BEGIN: commission + payout calculation (replace your old block with this) -----
    const intent = await PaymentIntent.findOne({ task: task._id, status: "paid" });

    // We always base the commission on the full task fee (not net of any gateway fees).
    // Use intent.amount if present (from the Chapa payment that funded escrow), else fall back to task.paymentFee.
    const totalAmountRaw = intent ? intent.amount : (task.paymentFee || 0);
    const totalAmount = Number(totalAmountRaw) || 0;

    // Platform commission: 5% of the task fee.
    const commission = round2(totalAmount * 0.05);

    // Amount to *send* to the doer (before Chapa recipient fee): task fee - platform commission
    // You explicitly want the doer transfer to be this amount, and let Chapa charge the recipient from this amount.
    const payoutAmount = round2(totalAmount - commission);

    // (Keep using payoutAmount exactly as you already do later: store in global.pendingPayouts, etc.)



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
      accountPromptMessageId: null,
      // NEW: persist the user's language for localization in later steps
      language: doer.language || "en"
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
function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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



function formatGmt3(date) {
  try {
    const opts = { timeZone: "Africa/Addis_Ababa", year: "numeric", month: "short", day: "2-digit",
                   hour: "2-digit", minute: "2-digit", hour12: false };
    const s = new Intl.DateTimeFormat("en-GB", opts).format(date);
    return `${s} (GMT+3)`;
  } catch {
    return new Date(date).toISOString();
  }
}

function buildDisputeChunks({ task, creatorUser, doerUser, winnerApp }) {
  // 1) identities + task meta (NO description here)
  const meta = [
    "🚨 *DISPUTE ESCALATION*",
    "",
    "👤 *TASK CREATOR*",
    `• Full Name: ${creatorUser.fullName || 'N/A'}`,
    `• Telegram: @${creatorUser.username || 'N/A'}`,
    `• Phone: ${creatorUser.phone || 'N/A'}`,
    `• Email: ${creatorUser.email || 'N/A'}`,
    `• Telegram ID: ${creatorUser.telegramId}`,
    `• User ID: ${creatorUser._id}`,
    "",
    "👥 *WINNER TASK DOER*",
    `• Full Name: ${doerUser.fullName || 'N/A'}`,
    `• Telegram: @${doerUser.username || 'N/A'}`,
    `• Phone: ${doerUser.phone || 'N/A'}`,
    `• Email: ${doerUser.email || 'N/A'}`,
    `• Telegram ID: ${doerUser.telegramId}`,
    `• User ID: ${doerUser._id}`,
    "",
    "📝 *TASK DETAILS*",
    `• Task ID: ${task._id}`,
    `• Payment Fee: ${task.paymentFee} birr`,
    `• Time to Complete: ${task.timeToComplete} hour(s)`,
    `• Skill Level: ${task.skillLevel}`,
    `• Fields: ${Array.isArray(task.fields) ? task.fields.join(', ') : (task.fields || 'N/A')}`,
    `• Exchange Strategy: ${task.exchangeStrategy || 'N/A'}`,
    `• Revision Time: ${task.revisionTime} hour(s)`,
    `• Penalty per Hour: ${task.latePenalty} birr`,
    `• Posted At: ${formatGmt3(task.postedAt)}`,
    `• Expires At: ${formatGmt3(task.expiry)}`
  ].join("\n");

  // 2) description on its own chunk (can be long)
  const description = `🧾 *TASK DESCRIPTION*\n${task.description || '(No description provided)'}`;

  // 3) winner’s original pitch (text form; media is fetched via buttons)
  const pitchText = (winnerApp?.coverText && String(winnerApp.coverText).trim().length > 0)
    ? winnerApp.coverText
    : "• (No pitch content recorded)";
  const pitchBlock = [
    "💬 *ORIGINAL APPLICATION PITCH*",
    pitchText
  ].join("\n");

  // Split each block safely and preserve their order
  return [
    ...splitIntoChunks(meta),
    ...splitIntoChunks(description),
    ...splitIntoChunks(pitchBlock)
  ];
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
async function sendWithUnlimitedRetry(notifyChannelId, telegramFn, ...args) {
  let attempts = 0;
  while (true) {
    try {
      return await telegramFn(...args);
    } catch (err) {
      attempts += 1;
      // Telegram "retry_after" handling if present
      if (err?.response?.error_code === 429) {
        const s = err.response.parameters?.retry_after || 1;
        await sleep(s * 1000);
      } else {
        // backoff anyway
        await sleep(Math.min(30000, 500 * attempts));
      }

      // After 5 failed tries, notify your audit channel once per attempt
      // (still keep retrying forever after the notify)
      if (attempts === 5) {
        try {
          await (telegram.sendMessage
            ? telegram.sendMessage(notifyChannelId,
              `⚠️ Dispute delivery keeps failing after 5 attempts.\n(${(err?.description || err?.message || 'Unknown error')})`)
            : Promise.resolve());
        } catch (_e) { /* keep going */ }
      }
    }
  }
}

function splitIntoChunks(text, maxLen = 3500) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return out;
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
async function refundStaleOrDuplicateEscrow({ intent, user, reason }) {
  try {
    if (!intent || !user) return;
    if (intent.refundStatus === "succeeded") return;

    // Guard against double-refund: mark as requested first
    await PaymentIntent.updateOne(
      { _id: intent._id, refundStatus: { $ne: "succeeded" } },
      { $set: { refundStatus: "requested" } }
    );

    try {
      const data = await refundEscrowWithChapa(
        intent,
        reason || "Stale or duplicate escrow payment"
      );

      const chapaReference =
        (data && data.data && (data.data.reference || data.data.tx_ref)) ||
        intent.chapaTxRef ||
        null;

      const refundId =
        (data && data.data && (data.data.refund_id || data.data.refundId)) ||
        null;

      await PaymentIntent.updateOne(
        { _id: intent._id },
        {
          $set: {
            refundStatus: "pending",
            refundedAt: new Date(),
            chapaReference,
            refundId
          }
        }
      );

      // Optional audit log (task-less, but still useful)
      try {
        await sendRefundAudit(globalThis.TaskifiiBot, {
          tag: "#refund successful",
          task: {
            description: "[No task posted – stale checkout link]",
            expiry: new Date(),
            paymentFee: intent.amount
          },
          creator: user,
          intent,
          extra: { reason, chapaReference, refundId }
        });
      } catch (auditErr) {
        console.error("Refund audit send failed (stale/duplicate success):", auditErr);
      }
    } catch (apiErr) {
      console.error("Stale/duplicate escrow refund failed:", apiErr);

      await PaymentIntent.updateOne(
        { _id: intent._id },
        { $set: { refundStatus: "queued" } }
      );

      try {
        await sendRefundAudit(globalThis.TaskifiiBot, {
          tag: "#refundfailed",
          task: {
            description: "[No task posted – stale checkout link]",
            expiry: new Date(),
            paymentFee: intent.amount
          },
          creator: user,
          intent,
          extra: { reason, error: String(apiErr?.message || "") }
        });
      } catch (auditErr) {
        console.error("Refund audit send failed (stale/duplicate failure):", auditErr);
      }
    }

    // Notify the creator in their language (once)
    try {
      const bot = globalThis.TaskifiiBot;
      if (bot && user.telegramId) {
        const lang = user.language || "en";
        const msg =
          TEXT.duplicateTaskPaymentNotice[lang] || TEXT.duplicateTaskPaymentNotice.en;
        await bot.telegram.sendMessage(user.telegramId, msg);
      }
    } catch (e) {
      console.error("Failed to send stale/duplicate payment notice:", e);
    }
  } catch (err) {
    console.error("refundStaleOrDuplicateEscrow wrapper error:", err);
  }
}







// --- Minimal gate for non-registered users coming from "Apply" deep links ---
function buildRegistrationRequiredMessage() {
  // Single bilingual message + a button that kicks off the normal onboarding
  const en = [
    "👋 To access Taskifay (apply to tasks,post tasks, etc.), you need to register first.",
    "If you’d like to register now, send or click this */start* ."
  ].join("\n");

  const am = [
    "👋 ታስኪፌይን ለመጠቀም  (በቻናላችን ላይ ላሉት ስራዎች ለማመልከት ፣ ሰራ እንዲሰራላቹ ፣  ወዘተ) መመዝገብ አለብዎት።",
    "አሁን መመዝገብ ከፈለጉ ይሄን */start* ይጫኑ ወይም ወደ ቦቱ ይላኩት።"
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
    relatedFile: draft.relatedFile || null,

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
      `• Taskifii User ID: ${creator._id || "N/A"}`,
      "",
      "👥 *TASK DOER DETAILS:*",
      `• Full Name: ${doer.fullName || 'N/A'}`,
      `• Phone: ${doer.phone || 'N/A'}`,
      `• Telegram: @${doer.username || 'N/A'}`,
      `• Email: ${doer.email || 'N/A'}`,
      `• Taskifii User ID: ${doer._id || "N/A"}`,
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
      `• Taskifii User ID: ${creator._id || "N/A"}`,
      "",
      "👥 *TASK DOER DETAILS:*",
      `• Full Name: ${applicant.fullName || 'N/A'}`,
      `• Phone: ${applicant.phone || 'N/A'}`,
      `• Telegram: @${applicant.username || 'N/A'}`,
      `• Email: ${applicant.email || 'N/A'}`,
      `• Taskifii User ID: ${applicant._id || "N/A"}`,
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

  // 🔁 Exchange strategy section REMOVED on purpose
  // We no longer add any "Exchange Strategy" text to the creator message.
  // (We still keep the logic that *uses* exchangeStrategy elsewhere in your bot.)

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
      `✅ *${doerName}* ከዚህ ጀምሮ *ስራውን የሚተገብረው* ይሆናል።`,
      "",
      `• ከዚህ ጀመሮ ያለቀ ስራ  በ*${timeToCompleteH} ሰዓት* ውስጥ  ይደስሎታል።`,
      "",
      "",
      "",
      `• *የማሻሻያ ጊዜ* (ግን መገንዘብ ያለባቹ የመጀመሪያው የማሻሻያ ጊዜ ግማሽ ለእርሶ እንደሆነ ነው እናም በዚህ ሰዓት ውስጥ የሚላክሎት ሰራ ምንም ችግር የለበትም ለማለት ወይም ችግር አለበት እና  እንዲስተካከልሊኝ እፈልጋለው እንዲሉ የመደቡት ጊዜ ነው ፤ የቀረው የማሻሻያው ጊዜ ግማሽ ደሞ ለሰሪው የሚሰጥ ይሆናል እናም በዚ ጊዜ ውስጥ የተስተካከል ሰራ ማላክ ውይም የተስማማንበት አደለም ብሎ ሪፖርት ማቅረብ ይጠበቅባችዋል)፡   *${revisionNice}*።`,
      "",
      "",
      "",
      `• ከላይ በተሰጠው ጊዜ ያለቀ ሰራ ባለማላኩ  በየሰዓቱ ከክፍያው *የሚቀነሰው የቅጣት መጠን*፡      *${penaltyPerHour}* ብር/ሰዓት።`,
      "",
      "",
      "",
      
      `• ልክ ስራው ሲጨረስ ሰሪው ያለቀውን ሰራ ወደዚ ቦት ብቻ ሳይሆን በ እርሶ ቴሌግራም አካውንት  ወይም  ኢሜል አድራሻ ውይም ሌላ አንድላይ በምትስማሙበት አማራቾች ይልኩታል ስለዚህ ቦቱን በቻ ሳይሆን የመልእክት ሳጥኖችዎን አዝወትሮ ይመልከቱት በዚህ *${timeToCompleteH} ሰዓት* ውስጥ።`,
      "",
      "",
      "",
      `• ያለቀውን ስራ በዚያ ጊዜ ውስጥ ካልተላከ  የብር ቅጣት ( *${penaltyPerHour}* ብር ) በየሰዓቱ ይቀነሳል ክፍያው (${paymentFee} ብር) የራሱ 35% እስከሚደርስ (ይሄም እስከሚሆን የሚፈጀው ሰዓት፡ *${penaltyPerHour > 0 ? formatHM(Math.ceil((paymentFee * 0.65) / penaltyPerHour) * 60, creatorLang) : " እርሶ በሰጡት የቅጣት መጠን ምሰረት ነው"}* )።`,
      "",
      "",
      "",
      "📞 *የሰሪው ግንኙነት መስመሮች:*",
      contactLines || "• ይቂርታ መረጃዎች አልተሞላም",
      "",
      "",
      "",
      "⚠️ *እርሶ ከሰጡት የሰራ መግለጫ ውጭ ሰሪውን የተለየ ነገር ማዘዝ አይቻላም‼️* ።",
      "",
      "",
      "",
      
      `⏳ የተጠናቀቀው ስራ ከውሳኔ አማራቾች ጋር ወደዚህ ቦት ሲላክልዎ ከላይ እንደተገለጸላቹ ስራውን ወይ ማጽደቅ ወይም ማስተካከያ መጠየቅ የሚችሉት በ *${revMinutes > 1 ? formatHM(Math.floor(revMinutes / 2), creatorLang) : revisionNice}* (*የማሻሻያ ጊዜው ግማሽ*) ውስጥ ብቻ ስለሚሆን በዛች ጊዜ ውስጥ ምንም አይነት እርምጃ ካልወሰዱ በተላከላቹ ስራ እንደረካቹ የቆጠራል  ስለዚህ እባክዎ  ቦቱን በየጊዜው ይመልከቱት።`
    ].join("\n");
  }

  return [
    `✅ *${doerName}* is now *officially* your *task doer*.`,
    "",
    "",
    `• *Time given* for the *task doer* to *complete and send the task*: *${timeToCompleteH} hour(s)*.`,
    "",
    "",
    "",
    `• *Total Revision time* (which will begin as soon as the task doer sends the completed task/proof of task completetion to the bot in which the first half of the revision time is for you to either approve the recieved completed task or to request fixes in it ; and the second half of the revision time is for the task doer to either submit the corrected version of the task or report if there are any issues with the fixes you requested from them):       *${revisionNice}*.`,
    "",
    "",
    "",
    `• *Penalty per hour*(which will start being deducted every hour as soon as the time given to complete and submit the completed task is up before the task doer sent the completed task to the bot):      *${penaltyPerHour} birr/hour*.`,
    "",
    "",
    "",
    `• When the doer finishes, they will send the completed work to you *not only through this bot but also directly *via your Telegram account or your Gmail address or etc. so please check your inboxes regularly during the *${timeToCompleteH} hours*.`,
    "",
    "",
    "",
    `• If the completed task isn’t submitted within that time, the fee (${paymentFee} birr) begins decreasing by ${penaltyPerHour} birr each hour until the task fee reaches 35% of the original fee (exact time until 35%: ${penaltyPerHour > 0 ? formatHM(Math.ceil((paymentFee * 0.65) / penaltyPerHour) * 60, creatorLang) : "based on your penalty settings"}).`,
,
    "",
    "",
    "",
    "📞 *You can contact the doer through:*",
    contactLines || "• No contact info provided",
    "",
    "",
    "⚠️ You can not ask for anything outside the original task description.",
    "",
    "",
    "",
    `⏳ Once the completed task is sent to you in the bot with the decision buttons, you will have only *${revMinutes > 1 ? formatHM(Math.floor(revMinutes / 2), creatorLang) : revisionNice}* (half of the revision time) to either approve the completed task or request fixes in it. If you don’t take any action(with the decision buttons that will be sent you once the completed task is sent to you through the bot)  within half of the revision time, it will be taken as if you were satisfied with the completed task sent to you , so please stay alert and check the bot regularly‼️`

  ].join("\n");
}
function buildWinnerDoerMessage({ task, creator, doerLang, totalMinutes, revMinutes, penaltyHoursToZero }) {
  const timeToCompleteH = task.timeToComplete || 0; // integer hours
  const penaltyPerHour = task.penaltyPerHour ?? task.latePenalty ?? 0; // tolerate older field names
  const totalNice = formatHM(totalMinutes, doerLang);
  const paymentFee = task.paymentFee || 0;
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
      `🎉 እንኳን ደስ አለዎት! ከአሁን ጀምሮ ለዚህ ስራ ተግባሪው እርሶ ኖት።`,
      "",
      "",
      "",
      `📝 *የተግባሩ መግለጫ(አሰሪው ከዚ ውጪ ተጨማሪ ነግር ማዘዝ አይችልም):* ${task.description}`,
      "",
      "",
      "",
      `📮 *ያለቀውን ሰራ * በ *${timeToCompleteH} ሰዓት* ውስጥ ለከዉት ከዛ እታች ያለውን ቁልፍ መጫን አለቦት እናም መላክ ያለቦት ለነዚህ ሶስት አካላቶች ናቸው: 
      
      *1. ለአሰሪው* ( በቴሌግራም አካውንታቸው: ${creatorHandle} ወይም በኢሜይል አድራሻቸው: ${creatorEmail} ወይም ሌላ አንድላይ በምትስማሙበት አማራቾች)፤                                                
      
      *2. ወደኛ ቴሌግራም አካውንት*: @taskifaysupport ፤                                                                                                        *3. ወደዚ ቦት*             ⚠️*ነገር ግን ወደ ሁሉም አካላት ከላኩት ቡሃላ አታች ያለውን ቁልፍ መጫን አለቦት አለበዚያ ከላይ በተባለው ስዓት እንደላኩት አይቆጠርም‼️*`,
      "",
      "",
      "",
      `⏱ ከላይ በተባለው ጊዜ ውስጥ ያለቀውንም ሰራ ወደዚ ቦት ልከዉት እታች ያለውን ቁልፍ ከተጫኑት ቡሃላ አሰሪው *${revMinutes > 1 ? formatHM(Math.floor(revMinutes / 2), doerLang) : revNice}* ይኖረዋል ማስተካከያ ለመጠየቅ (የተላከው ስራ ችግር ካለበት) ስለዚህ በዚያን ጊዜ ውስጥ በንቃት ዝግጁ ሆነው ይጠብቁ።`,
      "",
      "",
      "",
      `⚖️ ቅጣት: በ *${timeToCompleteH} ሰዓት* ውስጥ የለቀ ስራ ካልተላከ ከክፍያው (*${paymentFee}* ብር)  በየሰዓቱ *${penaltyPerHour} ብር* ይቀንሳል ክፍያው 35% እስከ ሚደርስ (ይሄም እስከሚሆን የሚፈጀው ሰዓት: *${penaltyPerHour > 0 ? formatHM(Math.ceil((paymentFee * 0.65) / penaltyPerHour) * 60, doerLang) : "እርሶ በሰቱት የቅጣት መጠን መሰረት"}*).`,
      "",
      "",
      "",
      creatorPhone ? `📞 አሰሪውን የአስገዳጅ ፈልገዉት በቴልግራም አካውንታቸው ወይም በኢሜል አድራሻቸው ካልመለሱሎት በዚህ ስልክ ይደውሉ፡ ${creatorPhone}` : null,
      "",
      "",
      "",
      `⚠️ እታች ያለውን ቁልፍ አንዴ ብቻ መጫን ስለሚቻል ሂሉንም ያለቀ ስራ ከላኩ ብሃላ ቁልፉን ይጫኑት።`,
    ].filter(Boolean).join("\n");
  }

  // English
  return [
    `🎉 *You* are now *the official task doer* for this *task*.`,
    "",
    "",
    `📝 *Task description(please note that the task creator can't give you more work outside of this description):* ${task.description}.`,
    "",
    "",
    `📮 *Within ${timeToCompleteH} hour(s)* *submit the completed task* *to the creator* ( via their Telegram account : ${creatorHandle} or their Gmail address: ${creatorEmail} or any other means that you both agree on), *to our telegram account *: @taskifaysupport , and *to this bot* ... in which *you must click the button below after you sent it to all the parties mentioned above, other wise it won't be considered as you sent the completed task/s to any of the parties within the time given above*‼️`,
    "",
    "",
    "",
    `⏱ After you submit the completed task/s and click the button below , the creator has *${revMinutes > 1 ? formatHM(Math.floor(revMinutes / 2), doerLang) : revNice}* to check the completed task/s sent to them and request any fixes from you(if there are any) so stay available and responsive during that time.`,
    "",
    "",
    "",
    `⚖️ *Penalty*: if the completed task isn’t submitted within the allotted time, the fee(*${paymentFee} birr*) decreases by *${penaltyPerHour} birr/hour* until it reaches 35% of the original amount  (exact time it will take till that happens:*${penaltyPerHour > 0 ? formatHM(Math.ceil((paymentFee * 0.65) / penaltyPerHour) * 60, doerLang) : "Based on your penalty settings"}*).`,
    "",
    "",
    creatorPhone ? `📞 If the task creator doesn’t reply on Telegram/Gmail, call them: ${creatorPhone}` : null,
    "",
    "",
    `⚠️ *Since* you *can click* the *button below* only *once*, make sure you click it after you sent the completed task/s to all the parties mentioned previously. `
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
// ── Generic Chapa hosted-checkout initializer (wrapper) ─────────────────────
// Returns { data: { checkout_url: "https://..." } } to match existing callers.
async function createChapaCheckoutLink({
  amount,
  currency = "ETB",
  email,
  first_name = "Taskifii",
  last_name = "User",
  tx_ref,
  callback_url,
  return_url,
  phone_number
}) {
  const secret =
    (typeof defaultChapaSecretForInit === "function"
      ? defaultChapaSecretForInit()
      : (process.env.CHAPA_LIVE_SECRET_KEY ||
         process.env.CHAPA_SECRET_KEY ||
         process.env.CHAPA_TEST_SECRET_KEY ||
         process.env.CHAPA_SECRET ||
         "")); // last-ditch fallback

  if (!secret) throw new Error("CHAPA secret missing");

  // Build payload exactly as Chapa expects
  const payload = {
    amount: String(amount),
    currency,
    email,
    first_name,
    last_name,
    tx_ref,
    callback_url:
      callback_url ||
      `${process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://taskifii-bot.onrender.com"}/chapa/ipn`,
    return_url
  };

  if (phone_number) payload.phone_number = phone_number;

  const resp = await fetch("https://api.chapa.co/v1/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => null);
  const checkout = data?.data?.checkout_url;
  if (!resp.ok || !checkout) {
    throw new Error(`Chapa init failed: ${resp.status} ${JSON.stringify(data)}`);
  }

  // Match the shape your callers use: checkout?.data?.checkout_url
  return { data: { checkout_url: checkout } };
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

  // 2) Always set the ratingPromptsSentAt timestamp if not already set
  if (!state.ratingPromptsSentAt) {
    state.ratingPromptsSentAt = new Date();
    await state.save();
  }

  // Always send the rating prompt to the doer (for rating the creator)
  await sendRatingPromptToUser(botOrTelegram, doer, creator, 'doerRatesCreator', task);

  // Only send the creator's rating prompt if it hasn't already been sent
  const tIdString = task._id.toString();
  if (!global.sentRatingPromptToCreator || !global.sentRatingPromptToCreator[tIdString]) {
    await sendRatingPromptToUser(botOrTelegram, creator, doer, 'creatorRatesDoer', task);
  }

  // Mark that the creator's prompt has been sent so it isn't sent again later
  if (global.sentRatingPromptToCreator) {
    global.sentRatingPromptToCreator[tIdString] = true;
  }
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


  }

  // ----- PHASE B: dispute summary in safe chunks + buttons -----
  const winnerApp = (task.applicants || []).find(a =>
    a.status === "Accepted" && !a.canceledAt && a.user && a.user.toString() === doerUser._id.toString()
  );

  // Build chunks (9 task details + task id + both profiles + pitch pointer/content)
  const chunks = buildDisputeChunks({ task, creatorUser, doerUser, winnerApp });

  // 1) Create/ensure a DisputePackage (one per task)
  let pkg = await DisputePackage.findOne({ task: task._id });
  if (!pkg) {
    pkg = await DisputePackage.create({
      task: task._id,
      creator: creatorUser._id,
      doer: doerUser._id,
      channelId: String(DISPUTE_CHANNEL_ID)
    });
  }

  // 2) Post a visible header to group everything via reply threads
  const header = await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    ctx.telegram.sendMessage.bind(ctx.telegram),
    DISPUTE_CHANNEL_ID,
    `#dispute\nTASK ${task._id}\nCreator:${creatorUser._id} Doer:${doerUser._id}\n—— START OF DISPUTE PACKAGE ——`,
  );
  await DisputePackage.updateOne({ _id: pkg._id }, { $set: { headerMessageId: header.message_id } });

  // 3) Send the chunks replying to the header, with [n/N] markers
  let lastChunkMsg = null;
  for (let i = 0; i < chunks.length; i++) {
    const numbered = `(${i+1}/${chunks.length})\n` + chunks[i];
    lastChunkMsg = await sendWithUnlimitedRetry(
      REFUND_AUDIT_CHANNEL_ID,
      ctx.telegram.sendMessage.bind(ctx.telegram),
      DISPUTE_CHANNEL_ID,
      numbered,
      { parse_mode: "Markdown", reply_to_message_id: header.message_id, allow_sending_without_reply: true }
    );
  }

  // 4) Attach the 3 persistent buttons under the final chunk
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback("Completed task",   `DP_OPEN_${pkg._id}_completed`),
      Markup.button.callback("Send corrections", `DP_SEND_CORRECTIONS_${pkg._id}`),
      Markup.button.callback("Related file",     `DP_OPEN_${pkg._id}_related`),
      Markup.button.callback("Fix notice",       `DP_OPEN_${pkg._id}_fix`),
    ]
  ]);

  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    ctx.telegram.sendMessage.bind(ctx.telegram),
    DISPUTE_CHANNEL_ID,
    "Use the buttons below to load the originals on demand.",
    { reply_to_message_id: header.message_id, allow_sending_without_reply: true, reply_markup: buttons.reply_markup }
  );
  await DisputePackage.updateOne({ _id: pkg._id }, { $set: { lastChunkMessageId: (lastChunkMsg?.message_id || null) } });

  // 5) Footer, also a reply to header, so every package stays visually grouped
  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    ctx.telegram.sendMessage.bind(ctx.telegram),
    DISPUTE_CHANNEL_ID,
    "—— END OF DISPUTE PACKAGE ——",
    { reply_to_message_id: header.message_id, allow_sending_without_reply: true }
  );

}
// Creator rejected the corrected version – escalate dispute from creator side.
// Mirrors escalateDoerReport but sets creatorReportedAt and uses different texts.
async function escalateCreatorReject(ctx, taskId) {
  const telegram = ctx.telegram;

  // ----- PHASE A: one-time critical actions -----
  const task = await Task.findById(taskId).populate('creator').lean();
  if (!task) return;

  const work = await DoerWork.findOne({ task: taskId }).populate('doer').lean();
  if (!work) return;

  const creatorUser = await User.findById(task.creator._id);
  const doerUser    = await User.findById(work.doer._id);

  // FinalizationState ensure
  let state = await FinalizationState.findOne({ task: taskId });
  if (!state) {
    state = new FinalizationState({ task: taskId });
  }

  // Avoid duplicate escalation
  if (!state.creatorReportedAt) {
    state.creatorReportedAt = new Date();
    await state.save();

    // record Escalation (creator role)
    await Escalation.updateOne(
      { task: taskId },
      { $set: { task: taskId, by: creatorUser._id, role: 'creator', createdAt: new Date() } },
      { upsert: true }
    );

    // Ban both users, same behavior as doer-report path
    await banUserEverywhere(ctx, creatorUser);
    await banUserEverywhere(ctx, doerUser);

    // Notify the task creator (who is reporting)
    try {
      const lang = creatorUser.language === 'am' ? 'am' : 'en';
      await telegram.sendMessage(
        creatorUser.telegramId,
        TEXT.disputeCreatorRejectNoticeToCreator[lang]
      );
    } catch (e) {
      console.error("notify creator (reject) fail:", e);
    }

    // Notify the winner task doer
    try {
      const lang = doerUser.language === 'am' ? 'am' : 'en';
      await telegram.sendMessage(
        doerUser.telegramId,
        TEXT.disputeCreatorRejectNoticeToDoer[lang]
      );
    } catch (e) {
      console.error("notify doer (reject) fail:", e);
    }

  }

  // ----- PHASE B: dispute summary in safe chunks + buttons -----
  const winnerApp = (task.applicants || []).find(a =>
    a.status === "Accepted" &&
    !a.canceledAt &&
    a.user &&
    a.user.toString() === work.doer._id.toString()
  );

  const chunks = buildDisputeChunks({
    task,
    creatorUser: creatorUser.toObject ? creatorUser.toObject() : creatorUser,
    doerUser:    doerUser.toObject ? doerUser.toObject() : doerUser,
    winnerApp
  });

  // Create/ensure DisputePackage (same as doer-report path)
  let pkg = await DisputePackage.findOne({ task: task._id });
  if (!pkg) {
    pkg = await DisputePackage.create({
      task: task._id,
      creator: creatorUser._id,
      doer: doerUser._id,
      channelId: String(DISPUTE_CHANNEL_ID)
    });
  }

  const header = await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    telegram.sendMessage.bind(telegram),
    DISPUTE_CHANNEL_ID,
    `#dispute\nTASK ${task._id}\nCreator:${creatorUser._id} Doer:${doerUser._id}\n—— START OF DISPUTE PACKAGE ——`
  );
  await DisputePackage.updateOne(
    { _id: pkg._id },
    { $set: { headerMessageId: header.message_id } }
  );

  let lastChunkMsg = null;
  for (let i = 0; i < chunks.length; i++) {
    const numbered = `(${i+1}/${chunks.length})\n` + chunks[i];
    lastChunkMsg = await sendWithUnlimitedRetry(
      REFUND_AUDIT_CHANNEL_ID,
      telegram.sendMessage.bind(telegram),
      DISPUTE_CHANNEL_ID,
      numbered,
      { parse_mode: "Markdown", reply_to_message_id: header.message_id, allow_sending_without_reply: true }
    );
  }

  // Attach dispute buttons (including "Send corrections"; see section 3)
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback("Completed task",   `DP_OPEN_${pkg._id}_completed`),
      Markup.button.callback("Send corrections", `DP_SEND_CORRECTIONS_${pkg._id}`),
      Markup.button.callback("Related file",     `DP_OPEN_${pkg._id}_related`),
      Markup.button.callback("Fix notice",       `DP_OPEN_${pkg._id}_fix`),
    ]
  ]);

  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    telegram.sendMessage.bind(telegram),
    DISPUTE_CHANNEL_ID,
    "Use the buttons below to load the originals on demand.",
    {
      reply_to_message_id: header.message_id,
      allow_sending_without_reply: true,
      reply_markup: buttons.reply_markup
    }
  );

  await DisputePackage.updateOne(
    { _id: pkg._id },
    { $set: { lastChunkMessageId: (lastChunkMsg?.message_id || null) } }
  );

  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    telegram.sendMessage.bind(telegram),
    DISPUTE_CHANNEL_ID,
    "—— END OF DISPUTE PACKAGE ——",
    {
      reply_to_message_id: header.message_id,
      allow_sending_without_reply: true
    }
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
// Schedules an in-process timeout for doer second-half enforcement
function scheduleDoerSecondHalfEnforcement(taskId, delayMs) {
  setTimeout(async () => {
    try {
      await enforceDoerSecondHalf(taskId);
    } catch (e) {
      console.error("enforceDoerSecondHalf error:", e);
    }
  }, delayMs);
}
function scheduleCreatorFinalDecisionEnforcement(taskId, delayMs) {
  setTimeout(async () => {
    try {
      await enforceCreatorFinalDecision(taskId);
    } catch (e) {
      console.error("Creator final decision enforcement failed:", e);
    }
  }, delayMs);
}

async function enforceCreatorFinalDecision(taskId) {
  const telegram = globalThis.TaskifiiBot?.telegram;
  if (!telegram) return;

  try {
    const task = await Task.findById(taskId).populate('creator').lean();
    if (!task) return;

    const work = await DoerWork.findOne({ task: taskId }).lean();
    if (!work) return;

    // If this enforcement was already handled or cancelled, do nothing.
    if (work.finalDecisionEnforcedAt || work.finalDecisionCanceledAt) return;

    // Only makes sense if the doer actually sent a corrected version
    if (!work.doerCorrectedClickedAt) return;

    // If task is already concluded or escalated, don't double-handle
    const [state, escal, credit] = await Promise.all([
      FinalizationState.findOne({ task: taskId }).lean(),
      Escalation.findOne({ task: taskId }).lean(),
      CreditLog.findOne({ task: taskId, type: 'doerEarned' }).lean()
    ]);
    if ((state && state.concludedAt) || escal || credit) {
      await DoerWork.updateOne(
        { _id: work._id },
        { $set: { finalDecisionCanceledAt: new Date() } }
      );
      return;
    }

    const creatorDoc = await User.findById(task.creator._id || task.creator);
    if (!creatorDoc) return;
    const doerDoc = await User.findById(work.doer);
    if (!doerDoc) return;

    // Mark that we enforced this path
    await DoerWork.updateOne(
      { _id: work._id },
      { $set: { finalDecisionEnforcedAt: new Date() } }
    );

    // 1) Make Approve/Reject buttons inert but still visible (difference A)
    if (work.creatorFinalDecisionMessageId && creatorDoc.telegramId) {
      const lang = creatorDoc.language === 'am' ? 'am' : 'en';
      const approveLabel = lang === 'am' ? "✅ አጸድቅ" : "✅ Approve";
      const rejectLabel  = lang === 'am' ? "❌ እስት ፍቀድ" : "❌ Reject";

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback(approveLabel, '_DISABLED_APPROVE_REVISION'),
          Markup.button.callback(rejectLabel,  '_DISABLED_REJECT_REVISION'),
        ]
      ]);

      try {
        await telegram.editMessageReplyMarkup(
          creatorDoc.telegramId,
          work.creatorFinalDecisionMessageId,
          undefined,
          buttons.reply_markup
        );
      } catch (e) {
        console.error("Failed to inactivate Approve/Reject keyboard:", e);
      }
    }

    // 2) Ban the creator everywhere (bot + group) – matches your existing ban flow.
    try {
      await banUserEverywhere(globalThis.TaskifiiBot, creatorDoc);
    } catch (e) {
      console.error("banUserEverywhere (creator final decision) failed:", e);
    }

    // 3) Release any locks on this task so the doer can use Taskifii again
    try { await releaseLocksForTask(task._id); } catch (_) {}
    try {
      await EngagementLock.updateMany(
        { task: task._id },
        { $set: { active: false, releasedAt: new Date() } }
      );
    } catch (_) {}

    // 4) Notify the task creator (difference B – creator message, bilingual)
    try {
      const lang = creatorDoc.language === 'am' ? 'am' : 'en';
      const text = (lang === 'am')
        ? "🚫 በራስዎ የተወሰነው የማሻሻያ ጊዜ ውስጥ ለተስተካከለው ስራ ምንም አይነት ግብዣ (አጸድቅ ወይም እስትፍቀድ) አልሰጡም። በምንም መንገድ የራስዎን ጊዜ-ገደብ አልከበሩም። Taskifii ይህን ጉዳይ በጊዜያዊ ሁኔታ ትመርማለች፣ እስከምንለቀቅዎ ድረስ መጠቀምዎን እንከልክላለን። የመጨረሻ ውሳኔውን በቴሌግራም እንረዳዎታለን።"
        : "🚫 You didn’t give any feedback (Approve or Reject) on the corrected work within the revision time you set yourself. Taskifii has temporarily suspended your access while we study this case and make a final decision. We’ll contact you with the result on Telegram.";
      await telegram.sendMessage(creatorDoc.telegramId, text);
    } catch (_) {}

    // 5) Notify the winner task doer (difference B – doer message, bilingual)
    try {
      const lang = doerDoc.language === 'am' ? 'am' : 'en';
      const text = (lang === 'am')
        ? "ℹ️ ተግዳሮቱን ፈጣሪ በራሱ የማሻሻያ ጊዜ ውስጥ ለተስተካከለው ስራ ማጽደቅ ወይም መካከል አላደረገም። ጉዳዩን Taskifii በአሁኑ ጊዜ ትመርማለች እና የመጨረሻ ውሳኔውን በቅርቡ ትደርስብዎታለች። በዚህ ጊዜ የነበሩት መቆለፊያዎች ተወግደዋል፤ ሌሎች ተግዳሮቶችን መማመር እና በTaskifii ላይ ያሉ ሌሎች ባህሪያትን መጠቀም ይችላሉ።"
        : "ℹ️ The task creator didn’t Approve or Reject your corrected work within their part of the revision time. Taskifii will now review this case and get back to you with a final decision soon. In the meantime you’re free to start applying to other tasks and use other Taskifii features that were previously locked while you were engaged with this task.";
      await telegram.sendMessage(work.doerTelegramId, text);
    } catch (_) {}

    // 6) Tag the dispute channel with #NeitherApproveNorReject2 + 4 buttons (difference C)

    // Compute repeat counter & penalty, same style as the original #NeitherApproveNorReject audit
    let creatorRepeat = 1;
    try {
      await User.updateOne(
        { _id: creatorDoc._id },
        { $inc: { noFeedbackCount: 1 } }
      );
      const again = await User.findById(creatorDoc._id).lean();
      creatorRepeat = Math.max(again?.noFeedbackCount || 1, 1);
    } catch (_) {}

    const fee = Number(task.paymentFee || 0);
    const penaltyPerHour = Number((task.penaltyPerHour ?? task.latePenalty) || 0);
    let deducted = 0;
    try {
      const completedAt  = work.completedAt ? new Date(work.completedAt) : null;
      const deadlineAt   = work.deadlineAt ? new Date(work.deadlineAt) : null;
      const penaltyStart = work.penaltyStartAt ? new Date(work.penaltyStartAt) : null;
      const penaltyEnd   = work.penaltyEndAt ? new Date(work.penaltyEndAt) : null;

      if (completedAt && deadlineAt && penaltyStart && penaltyEnd && penaltyPerHour > 0) {
        if (completedAt > deadlineAt && completedAt < penaltyEnd) {
          const hours = Math.ceil((completedAt - penaltyStart) / 3600000);
          deducted = Math.max(0, hours) * penaltyPerHour;
        }
      }
    } catch (_) {}

    const lines = [
      "#NeitherApproveNorReject2" + (creatorRepeat > 1 ? ` #${creatorRepeat}` : ""),
      `Task: ${task._id}`,
      `Creator User ID: ${creatorDoc?._id}`,
      `Doer User ID: ${doerDoc?._id || "-"}`,
      `Task Fee: ${fee}`,
    ];
    if (deducted > 0) lines.push(`Penalty Deducted (so far): ${deducted}`);

    // Ensure a DisputePackage exists so the DP_* buttons know which task to load
    let pkg = await DisputePackage.findOne({ task: task._id });
    if (!pkg) {
      pkg = await DisputePackage.create({
        task: task._id,
        creator: creatorDoc._id,
        doer: doerDoc._id,
        channelId: String(DISPUTE_CHANNEL_ID)
      });
    }

    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("Completed task",   `DP_OPEN_${pkg._id}_completed`),
        Markup.button.callback("Related file",     `DP_OPEN_${pkg._id}_related`),
        Markup.button.callback("Send corrections", `DP_SEND_CORRECTIONS_${pkg._id}`),
        Markup.button.callback("Fix notice",       `DP_OPEN_${pkg._id}_fix`),
      ]
    ]);

    try {
      await sendWithUnlimitedRetry(
        REFUND_AUDIT_CHANNEL_ID,
        telegram.sendMessage.bind(telegram),
        DISPUTE_CHANNEL_ID, // -1002432632907
        lines.join("\n"),
        {
          disable_web_page_preview: true,
          reply_markup: buttons.reply_markup
        }
      );
    } catch (e) {
      console.error("NeitherApproveNorReject2 tag send failed:", e);
    }

  } catch (err) {
    console.error("enforceCreatorFinalDecision fatal:", err);
  }
}

// Enforce when doer gave no feedback (neither reported nor sent corrected) by second-half end
async function enforceDoerSecondHalf(taskId) {
  const task = await Task.findById(taskId).populate("creator").lean();
  if (!task) return;

  const work = await DoerWork.findOne({ task: task._id }).lean();
  if (!work) return;


  // Skip if creator canceled enforcement or we already enforced
  if (work.secondHalfEnforcedAt || work.secondHalfCanceledAt) return;

  // If a dispute already exists (doer clicked report), abort
  const escalated = await Escalation.findOne({ task: task._id }).lean();
  if (escalated) return;

  // If doer clicked "Send corrected version" after actually sending messages, abort
  const acted = !!work.doerCorrectedClickedAt;
  if (acted) return;

  // Inert the doer's decision buttons (if still on screen)
  try {
    if (work.doerDecisionMessageId && work.doerTelegramId) {
      await globalThis.TaskifiiBot.telegram.editMessageReplyMarkup(
        work.doerTelegramId,
        work.doerDecisionMessageId,
        undefined,
        {
          inline_keyboard: [[
            Markup.button.callback("🚩 Report this", "_DISABLED_DOER_REPORT"),
            Markup.button.callback("📤 Send corrected version", "_DISABLED_DOER_SEND_CORRECTED")
          ]]
        }
      );
    }
  } catch (_) {}

  // Ban the doer (bot + group)
  const doerUser = await User.findById(work.doer);
  try { await banUserEverywhere({ telegram: globalThis.TaskifiiBot.telegram }, doerUser); } catch (_) {}

  // Close the task and unlock creator
  try {
    await DoerWork.updateOne(
      { _id: work._id },
      { $set: { status: 'completed', secondHalfEnforcedAt: new Date() } }
    );
  } catch (_) {}

  try { await releaseLocksForTask(task._id); } catch (_) {}
  try {
    await EngagementLock.updateMany(
      { task: task._id },
      { $set: { active: false, releasedAt: new Date() } }
    );
  } catch (_) {}

  // Send dispute package just like a "report", but tag it
  const creatorUser = await User.findById(task.creator);
  const winnerApp = (task.applicants || []).find(a => a.confirmedAt || a.status === "Accepted");
  const doerUserLean = doerUser?.toObject ? doerUser.toObject() : doerUser;

  // Build standard package
  let pkg = await DisputePackage.findOne({ task: task._id });
  if (!pkg) {
    pkg = await DisputePackage.create({
      task: task._id, creator: creatorUser._id, doer: doerUser._id,
      channelId: String(DISPUTE_CHANNEL_ID)
    });
  }

  const header = await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    globalThis.TaskifiiBot.telegram.sendMessage.bind(globalThis.TaskifiiBot.telegram),
    DISPUTE_CHANNEL_ID,
    `#dispute\nTASK ${task._id}\nCreator:${creatorUser._id} Doer:${doerUser._id}\n—— START OF DISPUTE PACKAGE ——`
  );
  await DisputePackage.updateOne({ _id: pkg._id }, { $set: { headerMessageId: header.message_id } });

  const chunks = buildDisputeChunks({ task, creatorUser, doerUser: doerUserLean, winnerApp });
  let lastChunkMsg = null;
  for (let i = 0; i < chunks.length; i++) {
    const numbered = `(${i+1}/${chunks.length})\n` + chunks[i];
    lastChunkMsg = await sendWithUnlimitedRetry(
      REFUND_AUDIT_CHANNEL_ID,
      globalThis.TaskifiiBot.telegram.sendMessage.bind(globalThis.TaskifiiBot.telegram),
      DISPUTE_CHANNEL_ID,
      numbered,
      { parse_mode: "Markdown", reply_to_message_id: header.message_id, allow_sending_without_reply: true }
    );
  }

  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback("Completed task",   `DP_OPEN_${pkg._id}_completed`),
      Markup.button.callback("Send corrections", `DP_SEND_CORRECTIONS_${pkg._id}`),
      Markup.button.callback("Related file",     `DP_OPEN_${pkg._id}_related`),
      Markup.button.callback("Fix notice",       `DP_OPEN_${pkg._id}_fix`),
    ]
  ]);

  const lastChunk = await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    globalThis.TaskifiiBot.telegram.sendMessage.bind(globalThis.TaskifiiBot.telegram),
    DISPUTE_CHANNEL_ID,
    "Use the buttons below to load the originals on demand.",
    { reply_to_message_id: header.message_id, allow_sending_without_reply: true, reply_markup: buttons.reply_markup }
  );
  await DisputePackage.updateOne({ _id: pkg._id }, { $set: { lastChunkMessageId: (lastChunk?.message_id || null) } });

  // Compute penalty deduction (same logic as creator half-window audit)
  const fee = Number(task.paymentFee || 0);
  const penaltyPerHour = Number((task.penaltyPerHour ?? task.latePenalty) || 0);
  let deducted = 0;
  try {
    const completedAt   = work.completedAt ? new Date(work.completedAt) : null;
    const deadlineAt    = work.deadlineAt ? new Date(work.deadlineAt) : null;
    const penaltyEndAt  = work.penaltyEndAt ? new Date(work.penaltyEndAt) : null;
    if (completedAt && deadlineAt && penaltyEndAt && completedAt > deadlineAt) {
      const hoursLate = Math.max(0, (Math.min(Date.now(), penaltyEndAt.getTime()) - completedAt.getTime()) / (60*60*1000));
      deducted = Math.min(0.35*fee, hoursLate * penaltyPerHour);
    }
  } catch (_) {}

  // increment doer repeat counter (like creator’s noFeedbackCount)
  let doerRepeat = 1;
  try {
    await User.updateOne({ _id: doerUser._id }, { $inc: { doerNoFeedbackCount: 1 } });
    const again = await User.findById(doerUser._id).lean();
    doerRepeat = Math.max(again?.doerNoFeedbackCount || 1, 1);
  } catch (_) {}

  // Tag post (NeitherReportNorSend + repeat + penalty info line)
  const tagLines = [
    "#NeitherReportNorSend",
    (doerRepeat > 1 ? `#${doerRepeat}` : ""),
    (deducted > 0 ? `Total deducted penalty so far: ${Math.round(deducted)} birr` : "")
  ].filter(Boolean).join("\n");

  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    globalThis.TaskifiiBot.telegram.sendMessage.bind(globalThis.TaskifiiBot.telegram),
    DISPUTE_CHANNEL_ID,
    tagLines,
    { reply_to_message_id: header.message_id, allow_sending_without_reply: true }
  );

  await sendWithUnlimitedRetry(
    REFUND_AUDIT_CHANNEL_ID,
    globalThis.TaskifiiBot.telegram.sendMessage.bind(globalThis.TaskifiiBot.telegram),
    DISPUTE_CHANNEL_ID,
    "—— END OF DISPUTE PACKAGE ——",
    { reply_to_message_id: header.message_id, allow_sending_without_reply: true }
  );

  // Notify users
  try {
    await globalThis.TaskifiiBot.telegram.sendMessage(
      doerUser.telegramId,
      doerUser.language === 'am'
        ? "🚫 በማሻሻያ ጊዜ ውስጥ ምንም አይነት ግብዣ (ሪፖርት ወይም የተስተካከለ ስራ መላክ) አላደረጉም። ከአሁን ጀምሮ Taskifii መጠቀም አትችሉም። ጉዳዩ ይመረመራል እና ፍርድ ይሰጣል።"
        : "🚫 You didn’t give any required feedback (report or send corrected work) within the revision window. You’re banned from Taskifii while we investigate and decide."
    );
  } catch (_) {}

  try {
    const creatorUser2 = await User.findById(task.creator);
    await globalThis.TaskifiiBot.telegram.sendMessage(
      creatorUser2.telegramId,
      (creatorUser2.language === 'am'
        ? "ℹ️ የሥራ አከናውኗ በማሻሻያ ጊዜ ውስጥ ምንም አይነት ምላሽ አላቀረበም። ጉዳዩን እንመርማለን እና በተቻለ ፍጥነት ውሳኔ እንሰጣለን። እስካሁን ድረስ እንደገና Taskifii መጠቀም ትችላለህ/ትችላለሽ።"
        : "ℹ️ The winner did not give feedback within the revision window. We’ll review and decide as soon as possible. You can use Taskifii again for other tasks now.")
    );
  } catch (_) {}
}


async function sendReminders(bot) {
  try {
    const now = new Date();
    const tasks = await Task.find({
      status: "Open",
      expiry: { $gt: now },
      "applicants.status": "Accepted"
    }).populate("applicants.user");

    for (const task of tasks) {
      if (!task.postedAt || !task.expiry) continue;

      const postedAt = task.postedAt instanceof Date ? task.postedAt : new Date(task.postedAt);
      const expiry   = task.expiry   instanceof Date ? task.expiry   : new Date(task.expiry);

      // 🛑 C: If ANY applicant has already confirmed "Do the task" for this task,
      // skip reminders for ALL other accepted applicants of this task.
      const someoneAlreadyConfirmed = task.applicants.some(a => a.confirmedAt);
      if (someoneAlreadyConfirmed) {
        continue;
      }

      // Only consider accepted applicants who have not confirmed, not canceled,
      // and have not already been processed for a reminder.
      const acceptedApps = task.applicants.filter(
        app =>
          app.status === "Accepted" &&
          !app.confirmedAt &&
          !app.canceledAt &&
          !app.reminderSent
      );

      // Nothing to do for this task
      if (acceptedApps.length === 0) continue;

      // ⏰ Halfway timing logic
      const elapsed = now - postedAt;
      const total   = expiry - postedAt;
      if (total <= 0) continue;

      const half = total * 0.5;

      // ✅ Wide 60-second window around halfway so we don't miss it
      // but we'll use an atomic DB lock so it's still only sent once.
      const windowSize = 60 * 1000; // 60 seconds
      const isAt50Percent = Math.abs(elapsed - half) <= windowSize;
      if (!isAt50Percent) continue;

      for (const app of acceptedApps) {
        if (!app.user) continue;

        const doer = app.user;
        const lang = doer.language || "en";

        // 🛑 B: If this user is already engagement-locked,
        // it means they either:
        //   - started another task as the winner doer, OR
        //   - became a task creator with an active engaged task.
        // In both cases, they shouldn't get this reminder.
        try {
          const locked = await isEngagementLocked(doer.telegramId);
          if (locked) {
            try {
              await Task.updateOne(
                {
                  _id: task._id,
                  "applicants._id": app._id
                },
                {
                  $set: { "applicants.$.reminderSent": true }
                }
              );
            } catch (saveErr) {
              console.error("Error marking reminderSent for locked doer:", saveErr);
            }
            continue; // do NOT send the reminder message
          }
        } catch (lockErr) {
          console.error("Error checking engagement lock in sendReminders:", lockErr);
          // If lock check fails, fall through and behave as before
        }

        // 🔄 NEW GUARD:
        // If this user has their OWN active task as a creator (status "Open", not expired),
        // we treat them as a creator and do NOT nag them with this doer reminder.
        let hasOpenCreatorTask = false;
        try {
          hasOpenCreatorTask = !!(await Task.exists({
            creator: doer._id,
            status: "Open",
            expiry: { $gt: now }
          }));
        } catch (creatorErr) {
          console.error("Error checking creator open tasks in sendReminders:", creatorErr);
        }

        if (hasOpenCreatorTask) {
          // Mark as handled so we don't keep checking this applicant again
          try {
            await Task.updateOne(
              {
                _id: task._id,
                "applicants._id": app._id
              },
              {
                $set: { "applicants.$.reminderSent": true }
              }
            );
          } catch (saveErr) {
            console.error("Error marking reminderSent for creator-doer:", saveErr);
          }
          continue; // skip sending reminder to this user
        }

        // 🔐 Atomic claim: only ONE process is allowed to send this reminder.
        // If another bot instance / another loop already set reminderSent=true,
        // modifiedCount will be 0 and we skip sending.
        let claimResult;
        try {
          claimResult = await Task.updateOne(
            {
              _id: task._id,
              "applicants._id": app._id,
              "applicants.reminderSent": { $ne: true }
            },
            {
              $set: { "applicants.$.reminderSent": true }
            }
          );
        } catch (claimErr) {
          console.error("Error trying to claim reminder lock:", claimErr);
          continue;
        }

        if (!claimResult || !claimResult.modifiedCount) {
          // Someone else already handled this reminder (or another loop got here first)
          continue;
        }

        // Time remaining until task expiry (for [hours]/[minutes] in the message)
        const msRemaining = expiry - now;
        const totalMinutes = Math.max(0, Math.ceil(msRemaining / 60000));
        const hours   = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const template = TEXT.reminderNotification[lang] || TEXT.reminderNotification["en"];
        const message = template
          .replace("[hours]", String(hours))
          .replace("[minutes]", String(minutes));

        try {
          await bot.telegram.sendMessage(doer.telegramId, message);
        } catch (err) {
          console.error("Error sending reminder to doer:", doer.telegramId, err);
          // We already set reminderSent; worst case they miss the reminder once.
        }
      }
    }
  } catch (err) {
    console.error("Error in sendReminders:", err);
  }

  // Check again in 1 minute (this keeps the timing precise)
  setTimeout(() => sendReminders(bot), 60000);
}




async function runDoerWorkTimers(bot) {
  const now = new Date();

  // 3.1 — 65% reminder to DOER and CREATOR (only once)
  // active work, not completed, reminder not sent, and passed 65% of the window
  const works65 = await DoerWork.aggregate([
    { $match: { status: 'active', completedAt: { $exists: false }, reminder65SentAt: { $exists: false } } },
    {
      $lookup: {
        from: 'tasks',
        localField: 'task',
        foreignField: '_id',
        as: 'taskDoc'
      }
    },
    { $unwind: '$taskDoc' }
  ]);

  for (const w of works65) {
    const startedAt  = new Date(w.startedAt);
    const deadlineAt = new Date(w.deadlineAt);
    const durationMs = deadlineAt - startedAt;
    if (durationMs <= 0) continue;

    const thresholdMs = startedAt.getTime() + durationMs * 0.65;
    if (now.getTime() >= thresholdMs && now.getTime() < deadlineAt.getTime()) {
      // Skip if completed in the meantime
      const fresh = await DoerWork.findById(w._id);
      if (!fresh || fresh.completedAt) continue;
      if (fresh.reminder65SentAt) continue; // idempotency

      // Compute time left
      const leftMs = Math.max(0, deadlineAt.getTime() - now.getTime());
      const h = Math.floor(leftMs / 3600000);
      const m = Math.floor((leftMs % 3600000) / 60000);

      // Load users
      const doer = await User.findById(fresh.doer);
      const creator = await User.findById(w.taskDoc.creator);
      // Hard gate: only proceed if THIS doer actually confirmed THIS task
      const confirmed = await Task.exists({
        _id: w.taskDoc._id,
        applicants: {
          $elemMatch: {
            user: fresh.doer,
            status: "Accepted",
            confirmedAt: { $ne: null },
            canceledAt: null
          }
        }
      });
      if (!confirmed) continue;

      try {
        // Doer message (once)
        const doerLang = (doer?.language) || 'en';
        const msgDoer = (TEXT.doer65Reminder?.[doerLang] || TEXT.doer65Reminder.en)(h, m);
        await bot.telegram.sendMessage(doer.telegramId, msgDoer);

        // Creator message (once)
        const creatorLang = (creator?.language) || 'en';
        const doerName = doer?.fullName || doer?.username || '';
        const msgCreator = (TEXT.creator65Reminder?.[creatorLang] || TEXT.creator65Reminder.en)(doerName);
        await bot.telegram.sendMessage(creator.telegramId, msgCreator);

        fresh.reminder65SentAt = new Date();
        await fresh.save();
      } catch (e) {
        console.error("65% reminder send failed:", e);
      }
    }
  }

  // 3.2 — Time up: notify both, start penalty window timer (only once)
  const worksTimeUp = await DoerWork.aggregate([
    { $match: { status: 'active', completedAt: { $exists: false }, timeUpNotifiedAt: { $exists: false } } },
    {
      $lookup: {
        from: 'tasks',
        localField: 'task',
        foreignField: '_id',
        as: 'taskDoc'
      }
    },
    { $unwind: '$taskDoc' }
  ]);

  for (const w of worksTimeUp) {
    const deadlineAt = new Date(w.deadlineAt);
    if (now.getTime() < deadlineAt.getTime()) continue; // not reached yet

    const fresh = await DoerWork.findById(w._id);
    if (!fresh || fresh.completedAt) continue;
    if (fresh.timeUpNotifiedAt) continue; // idempotency
    // Only notify time-up if the doer actually confirmed this task
    const confirmed = await Task.exists({
      _id: w.taskDoc._id,
      applicants: {
        $elemMatch: {
          user: fresh.doer,
          status: "Accepted",
          confirmedAt: { $ne: null },
          canceledAt: null
        }
      }
    });
    if (!confirmed) continue;

    // Pull fee/penalty from Task (handles both names you use)
    const fee = Number(w.taskDoc.paymentFee || 0);
    const penaltyPerHour = Number(
      (w.taskDoc.penaltyPerHour ?? w.taskDoc.latePenalty) || 0
    );

    // Hours until fee would reach 35% (i.e., a 65% deduction)
    // If penaltyPerHour is 0, hoursTo35 = 0 (we still send a neutral message)
    const amountToDeduct = Math.max(0, fee * 0.65);
    const hoursTo35 = penaltyPerHour > 0
      ? Math.ceil(amountToDeduct / penaltyPerHour)
      : 0;

    const penaltyStartAt = now;
    const penaltyEndAt   = new Date(now.getTime() + hoursTo35 * 3600000);

    // Load users
    const doer = await User.findById(fresh.doer);
    const creator = await User.findById(w.taskDoc.creator);

    try {
      // Replace the two lines that build and send the doer message in the "time-up" section:

      const doerLang = (doer?.language) || 'en';
      const msgDoer = (TEXT.doerTimeUp?.[doerLang] || TEXT.doerTimeUp.en)(penaltyPerHour, penaltyEndAt);
      await bot.telegram.sendMessage(doer.telegramId, msgDoer);


      // Creator message
      const creatorLang = (creator?.language) || 'en';
      const msgCreator = (TEXT.creatorTimeUp?.[creatorLang] || TEXT.creatorTimeUp.en)(penaltyPerHour);
      await bot.telegram.sendMessage(creator.telegramId, msgCreator);

      // Persist idempotency + penalty window
      fresh.timeUpNotifiedAt = new Date();
      fresh.penaltyStartAt = penaltyStartAt;
      fresh.penaltyEndAt = penaltyEndAt;
      await fresh.save();
    } catch (e) {
      console.error("Time-up notify failed:", e);
    }
  }
  // Add BELOW your "time-up notify" block, inside runDoerWorkTimers(bot):

  // 3.2 — Penalty-end enforcement (ban + punishment entry), one-shot
  const overdueWorks = await DoerWork.aggregate([
    { $match: { status: 'active', completedAt: { $exists: false }, penaltyEndAt: { $exists: true } } },
    {
      $lookup: {
        from: 'tasks',
        localField: 'task',
        foreignField: '_id',
        as: 'taskDoc'
      }
    },
    { $unwind: '$taskDoc' }
  ]);

  for (const w of overdueWorks) {
    const now = new Date();
    if (now < new Date(w.penaltyEndAt)) continue; // not reached yet

    // Idempotency check
    const fresh = await DoerWork.findById(w._id);
    if (!fresh || fresh.completedAt) continue;
    // Skip if we've already processed punishment for this work
    if (fresh.punishmentStartedAt) continue;
    // Final safeguard before punishment: doer must have confirmed this exact task
    const confirmed = await Task.exists({
      _id: w.taskDoc._id,
      applicants: {
        $elemMatch: {
          user: fresh.doer,
          status: "Accepted",
          confirmedAt: { $ne: null },
          canceledAt: null
        }
      }
    });
    if (!confirmed) {
      // Defensive: prevent this stale row from ever triggering again
      try {
        fresh.status = 'completed';
        fresh.completedAt = new Date();
        await fresh.save();
      } catch (_) {}
      continue;
    }

    // Store a "punishment started" timestamp to avoid repeats
    fresh.punishmentStartedAt = now;
    await fresh.save().catch(()=>{});

    // 1) Make the "Completed task sent" button inert (but still displayed, not highlighted)
    try {
      if (fresh.doerControlMessageId) {
        await bot.telegram.editMessageReplyMarkup(
          fresh.doerTelegramId,
          fresh.doerControlMessageId,
          undefined,
          {
            inline_keyboard: [[
              // keep the exact visible text you already use
              Markup.button.callback(TEXT.completedSentBtn.en, "_DISABLED_COMPLETED_SENT")
            ]]
          }
        );
      }
    } catch (e) {
      console.error("Failed to inert completed button after penalty:", e);
    }

    // Fetch users
    const doer = await User.findById(fresh.doer);
    const creator = await User.findById(w.taskDoc.creator);
    const doerLang = doer?.language || 'en';
    const creatorLang = creator?.language || 'en';

    // 2) Ban the doer (Banlist + kick from the group)
    try {
      await Banlist.updateOne(
        { telegramId: fresh.doerTelegramId },
        { $setOnInsert: { telegramId: fresh.doerTelegramId, user: doer?._id, reason: 'Penalty end reached without submission' } },
        { upsert: true }
      );
    } catch (e) {
      console.error("Adding to Banlist failed:", e);
    }

    try {
      // Kick from the group (ignore errors if not a member)
      await bot.telegram.banChatMember("-1002239730204", fresh.doerTelegramId).catch(()=>{});
    } catch (e) {
      console.error("Group ban failed:", e);
    }

    // 3) Send punishment message to the doer with a "Punishment fee" button
    const punishBtn = Markup.inlineKeyboard([
      [ Markup.button.callback(
          doerLang === 'am' ? "የቅጣት ክፍያ" : "Punishment fee",
          `PUNISH_PAY_${w.taskDoc._id}`
        )]
    ]);

    const punishText = (doerLang === 'am')
      ? [
          "🚫 ከTaskifii ታግዷችሁ ነው።",
          "በተመደበው ጊዜ ውስጥ ትክክለኛ የተጠናቀቀ ስራ አልላኩም፣ እና “ተጠናቋል” አልጫኑም።",
          "እንደገና ለመግባት ከታች ያለውን “የቅጣት ክፍያ” ይጫኑ እና የተግባሩ ክፍያ 50% ይክፈሉ።"
        ].join("\n")
      : [
          "🚫 You’ve been banned from Taskifii.",
          "You didn’t submit valid completed work and press “Completed task sent” within the time limits.",
          "To restore access, tap “Punishment fee” below and pay 50% of the task fee."
        ].join("\n");

    let punishMsg;
    try {
      punishMsg = await bot.telegram.sendMessage(fresh.doerTelegramId, punishText, punishBtn);
    } catch (e) {
      console.error("Failed to send punishment message:", e);
    }

    // persist the punishment message id (new fields, see schema patch below)
    if (punishMsg?.message_id) {
      await DoerWork.updateOne({ _id: fresh._id }, { $set: { punishmentMessageId: punishMsg.message_id } });
    }

    // 4) Inform the creator (and unlock creator features for this task)
    try {
      const creatorMsg = (creatorLang === 'am')
        ? "😞 የስራው አዳራሽ በተመደበው ጊዜ ውስጥ ስራውን አላቀረበም። ተግባሩ በቅጣት ተይዟል፣ እና ለማንኛውም የተቆለፉ ባህሪያት እንደገና ክፍት ሆነዋል። ስለ ችግኙ በጣም እናዝናለን።"
        : "😞 The winner task doer did not submit within the set time. They’ve received a disciplinary action. Any features that were locked for you are now unlocked. We’re very sorry for the inconvenience.";
      await bot.telegram.sendMessage(creator.telegramId, creatorMsg);
    } catch (e) {
      console.error("Notify creator failed:", e);
    }

    // unlock any creator engagement lock for this task
    try { await releaseLocksForTask(w.taskDoc._id); } catch (_) {}
    // Defensive unlock to guarantee creator access is restored
    try {
      await EngagementLock.updateMany(
        { user: creator._id, task: w.taskDoc._id },
        { $set: { active: false, releasedAt: new Date() } }
      );
    } catch (e) {
      console.error("Force-unlock creator failed:", e);
    }

    // 5) Send audit notice to your private channel (-1002616271109)
    try {
      const original = Number(w.taskDoc.paymentFee || 0);
      const half = Math.round(original * 0.5);
      const audit = [
        "#notoriousWTD",
        `Task: ${w.taskDoc._id}`,
        `Doer User ID: ${doer?._id}`,
        `Original Fee: ${original}`,
        `Punishment (50%): ${half}`
      ].join("\n");
      await bot.telegram.sendMessage("-1002616271109", audit, { disable_web_page_preview: true });
    } catch (e) {
      console.error("Failed to send #notoriousWTD audit:", e);
    }
  }
  // 3.3 — Second-half revision enforcement (NeitherReportNorSend)
  // If a Fix Notice was sent and the doer gave no feedback by the revision deadline,
  // enforce the same logic as enforceDoerSecondHalf (ban + dispute package + tags).
  try {
    const revWorks = await DoerWork.aggregate([
      {
        $match: {
          
          currentRevisionStatus: 'awaiting_fix',
          revisionDeadlineAt: { $exists: true },
        }
      },
      {
        $lookup: {
          from: 'tasks',
          localField: 'task',
          foreignField: '_id',
          as: 'taskDoc'
        }
      },
      { $unwind: '$taskDoc' }
    ]);

    for (const w of revWorks) {
      if (!w.revisionDeadlineAt) continue;

      const deadline = new Date(w.revisionDeadlineAt);
      if (now.getTime() < deadline.getTime()) continue; // still inside revision window

      // Reload fresh copy to respect any updates/cancellations
      const fresh = await DoerWork.findById(w._id);
      if (!fresh) continue;
      
      if (fresh.secondHalfEnforcedAt || fresh.secondHalfCanceledAt) continue;

      // If a dispute already exists (doer reported), skip
      const escalated = await Escalation.findOne({ task: w.task }).lean();
      if (escalated) continue;


      // If doer clicked "Send corrected version", skip
      if (fresh.doerCorrectedClickedAt) continue;

      // Call the existing helper; it will:
      // - inert the buttons
      // - ban the doer + group
      // - send dispute package with #NeitherReportNorSend and penalty total
      // - close the task and unlock creator
      await enforceDoerSecondHalf(String(w.task));
    }
  } catch (e) {
    console.error("Second-half revision enforcement sweep failed:", e);
  }

  // sweep again in ~1 minute
  setTimeout(() => runDoerWorkTimers(bot), 60_000);
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
    if (req.body?.event === "payout.success" && String(req.body?.reference || "").startsWith("task_payout_")) {
      return res.status(200).send("ok");
    }

    // Chapa typically includes at least tx_ref (and sometimes reference/status) in the POST.
    const txRef = String(
      req.body?.tx_ref || req.body?.txRef || req.query?.tx_ref || req.body?.reference || ""
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

    // ────────────────────────────────────────────────────────────────────────────
    // A) PUNISHMENT-FEE BRANCH  (tx_ref = "punish_<PaymentIntent._id>")
    // ────────────────────────────────────────────────────────────────────────────
    if (txRef.startsWith("punish_")) {
      const intentId = txRef.slice("punish_".length);
      const intent = await PaymentIntent.findById(intentId);
      if (!intent) {
        // Unknown or already cleaned up; ack so Chapa stops retries
        return res.status(200).send("ok");
      }

      // Accept this exactly once
      if (intent.status !== "pending") {
        return res.status(200).send("ok");
      }

      // Mark payment intent paid
      intent.status = "paid";
      intent.paidAt = new Date();
      await intent.save();

      // Find the relevant work (task + user are stored on the intent created by PUNISH_PAY)
      const work = await DoerWork.findOne({ task: intent.task, doer: intent.user });
      const doer = await User.findById(intent.user);

      if (work && !work.punishmentPaidAt) {
        work.punishmentPaidAt = new Date();
        await work.save().catch(() => {});
      }

      // Remove from Banlist and unban from the group
      if (doer?.telegramId) {
        try { await Banlist.deleteOne({ user: doer._id }); } catch (_) {}
        try { await Banlist.deleteOne({ telegramId: doer.telegramId }); } catch (_) {}

        // Use global bot handle safely even inside Express
        const tg = (globalThis.TaskifiiBot && globalThis.TaskifiiBot.telegram) || (bot && bot.telegram);
        if (tg) {
          try { await tg.unbanChatMember("-1002239730204", doer.telegramId); } catch (_) {}

          // Flip the "Punishment fee" button to inert + highlighted if we still have the message
          if (work?.punishmentMessageId) {
            const lang = doer.language || 'en';
            try {
              await tg.editMessageReplyMarkup(
                doer.telegramId,
                work.punishmentMessageId,
                undefined,
                {
                  inline_keyboard: [[
                    // highlighted inert (✔ …)
                    buildButton(TEXT.punishBtn, "_DISABLED_PUNISH", lang, /*highlighted=*/true)
                  ]]
                }
              );
            } catch (_) {}
          }

          // Let the doer know access is restored
          try {
            await tg.sendMessage(
              doer.telegramId,
              (doer.language === 'am')
                ? "✅ የቅጣት ክፍያ ተከፍሏል። ወደ Taskifii መዳረሻዎ ተመልሷል።"
                : "✅ Punishment fee paid successfully. Your access to Taskifii has been restored."
            );
          } catch (_) {}
        }
      }

      return res.status(200).send("ok");
    }

    // ────────────────────────────────────────────────────────────────────────────
    // B) EXISTING DRAFT/ESCROW BRANCH (hosted checkout for posting tasks)
    // ────────────────────────────────────────────────────────────────────────────
    // Find or create the intent and mark paid (you already do this in your button flow)
    let intent = await PaymentIntent.findOne({ chapaTxRef: txRef });
    if (!intent) {
      console.error("No PaymentIntent for tx_ref:", txRef);
      return res.status(404).send("intent_not_found");
    }

    if (intent.status !== "paid") {
      intent.status = "paid";
      intent.paidAt = new Date();
      await intent.save();
    }

    const me = await User.findById(intent.user);
    const draft = intent.draft ? await TaskDraft.findById(intent.draft) : null;

    // If the draft is gone but payment arrived, treat as stale / duplicate:
    if (!me) {
      console.error("IPN user missing for intent", intent._id.toString());
      return res.status(404).send("user_missing");
    }

    if (!draft) {
      console.warn("IPN: stale or missing draft for intent", intent._id.toString(), "txRef:", txRef);

      await refundStaleOrDuplicateEscrow({
        intent,
        user: me,
        reason: "Stale or abandoned draft paid via Chapa IPN"
      });

      return res.status(200).send("stale_draft_refunded");
    }

    // Normal happy path: post the task
    await postTaskFromPaidDraft({ ctx: null, me, draft, intent });
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
  .then(async () => {

    console.log("✅ Connected to MongoDB Atlas");
    // --- FIX: paymentintents.payload index (unique only for real strings) ---
    async function migratePaymentIntentIndexes() {
      const col = mongoose.connection.collection('paymentintents');
      try {
        // Old index (unique on all values including null) — drop if it exists
        await col.dropIndex('payload_1');
      } catch (e) {
        // ignore if not found
      }
      // Recreate with a partial filter so only non-empty strings must be unique
      await col.createIndex(
        { payload: 1 },
        // Keep unique only when payload exists and is non-empty.
        // Using "payload.0": {$exists:true} matches non-empty strings (and arrays) without $type.
        { unique: true, partialFilterExpression: { payload: { $exists: true }, "payload.0": { $exists: true } } }
      );

    }

    // Run it before the bot or timers create any new PaymentIntents
    await migratePaymentIntentIndexes().catch(err =>
      console.error('migratePaymentIntentIndexes failed:', err)
    );

    const bot = startBot(); // Make sure startBot() returns the bot instance
    
    // Start the expiry checkers (guarded so they run exactly once)
    if (!globalThis.__TASKIFII_TIMERS_STARTED__) {
      globalThis.__TASKIFII_TIMERS_STARTED__ = true;

      checkTaskExpiries(bot);
      sendReminders(bot);
      runDoerWorkTimers(bot);
      checkPendingReminders(bot);

      // periodic background passes
      setInterval(() => checkPendingReminders(bot), 60 * 60 * 1000);
    }

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
            tag: "#refund successful", // ✅ new text
            task, creator, intent,
            extra: { reason: "Retry queued refund (provider accepted)", chapaReference, refundId }
          });
        }
        console.log("Queued refund request accepted by provider:", intent._id.toString());
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();

        // ❗ IMPORTANT: do NOT mark as failed anymore.
        // Keep it as "queued"/"requested" so this worker retries forever.
        if (msg.includes("insufficient balance")) {
          console.log("Queued refund still waiting for funds:", intent._id.toString());
        } else {
          console.error("Queued refund attempt failed, will retry:", intent._id.toString(), err);
        }
        // No status update here → infinite automatic retries
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
    // In the global ban guard middleware:
    const isUnbanClick = ctx.updateType === 'callback_query'
      && (/^ADMIN_UNBAN_/.test(ctx.callbackQuery?.data || '')
          || /^PUNISH_PAY_/.test(ctx.callbackQuery?.data || ''));  // <-- add this

// leave the rest unchanged


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

  // ─────────── Global "first button wins" throttle (per message) ───────────
  bot.use(async (ctx, next) => {
    try {
      // Only care about button clicks (callback queries) that belong to a message
      if (!ctx.callbackQuery || !ctx.callbackQuery.message) {
        return next();
      }

      const userId = ctx.from?.id;
      const msg = ctx.callbackQuery.message;

      if (!userId || !msg.chat || msg.message_id == null) {
        return next();
      }

      // 1) Skip ALL buttons that live on channel posts
      //    (your control buttons: profile admin, completed task, send corrections, etc.)
      if (msg.chat.type === 'channel') {
        return next();
      }

      // 2) Skip the "Punishment fee" button even in user chats
      const data = ctx.callbackQuery.data || "";
      if (data.startsWith("PUNISH_PAY_")) {
        return next();
      }

      // One global in-memory store shared by the whole process
      if (!globalThis.__TASKIFII_BUTTON_THROTTLE__) {
        globalThis.__TASKIFII_BUTTON_THROTTLE__ = new Map();
      }

      const store = globalThis.__TASKIFII_BUTTON_THROTTLE__;
      const key = `${userId}:${msg.chat.id}:${msg.message_id}`;
      const existing = store.get(key);

      // If we've already processed ANY button from this user on this message,
      // ignore all further clicks on the same message.
      if (existing) {
        try {
          // Just stop the Telegram "loading" spinner, no extra text
          await ctx.answerCbQuery();
        } catch (_) {}
        return;
      }

      const now = Date.now();
      store.set(key, now);

      // Light cleanup so the Map doesn't grow forever
      if (store.size > 5000) {
        const cutoff = now - 5 * 60 * 1000; // keep last 5 minutes
        for (const [k, t] of store.entries()) {
          if (t < cutoff) store.delete(k);
        }
      }

      return next();
    } catch (err) {
      console.error("button throttle middleware error:", err);
      return next();
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
      return; // do NOT call next() again
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
    await cancelRelatedFileDraftIfActive(ctx);


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
      user.skills = []; // NEW: reset skills too
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
    user.onboardingStep = "skillsSelect";
    await user.save();
    return startUserSkillsSelection(ctx, user, false);

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

    // Mark onboarding as completed and save to DB
    user.onboardingStep = "completed";
    await user.save();

    // 🔒 VERY IMPORTANT:
    // Always ensure there is an Admin Profile post for this user
    try {
      await updateAdminProfilePost(ctx, user, user.adminMessageId);
    } catch (err) {
      console.error("Failed to create admin profile post during onboarding:", err);
      // Keep your existing error message so behavior is familiar to you
      return ctx.reply("Profile created, but failed to notify admin. Please contact support.");
    }

    // If there's a pending task to apply for, continue that flow
    if (ctx.session?.pendingTaskId) {
      const taskId = ctx.session.pendingTaskId;
      delete ctx.session.pendingTaskId;
      
      // Initialize apply flow
      ctx.session.applyFlow = {
        taskId,
        step: "awaiting_pitch"
      };

      const prompt = user.language === "am"
        ? "እባክዎ ዚህ ተግዳሮት ያቀረቡትን ነገር በአጭሩ ይጻፉ (20–500 ቁምፊ). ፎቶ፣ ሰነዶች፣ እና ሌሎች ማቅረብ ከፈለጉ ካፕሽን አስገቡ።"
        : "Please write a brief message about what you bring to this task (20–500 characters). You may attach photos, documents, etc., but be sure to include a caption.";
      
      return ctx.reply(prompt);
    }

    // Normal case: Build and send user profile WITH congratulations
    const menu = Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.postTaskBtn[user.language], "POST_TASK")],
      [Markup.button.callback(TEXT.findTaskBtn[user.language], "FIND_TASK")],
      [Markup.button.callback(TEXT.editProfileBtn[user.language], "EDIT_PROFILE")]
    ]);
    
    // Send profile WITH congratulations (showCongrats = true)
    return ctx.reply(buildProfileText(user, true), menu);
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
    await cancelRelatedFileDraftIfActive(ctx);

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
  // If they were in related-file step for their own draft, terminate it and freeze buttons
  await cancelRelatedFileDraftIfActive(ctx);
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

  // 3. if the task had attached related file(s), send them to the doer
  try {
    const rf = updated?.relatedFile;

    if (rf) {
      const langForFile = user.language || "en";

      // New behaviour: if we have stored original messages, forward them "as is"
      if (Array.isArray(rf.messages) && rf.messages.length > 0) {
        await ctx.telegram.sendMessage(
          user.telegramId,
          langForFile === "am"
            ? "📎 ለዚህ ተግዳሮት ከፈጣሪው የመጡ ተያያዥ ፋይሎች እነዚህ ናቸው፦"
            : "📎 Here are the related file(s) from the task creator:"
        );

        for (const m of rf.messages) {
          try {
            await ctx.telegram.forwardMessage(
              user.telegramId,   // to the winner doer
              m.chatId,          // original chat
              m.messageId        // original message
            );
          } catch (e) {
            console.error("Failed to forward related file message to doer:", e);
          }
        }
      } else {
        // Legacy behaviour: single fileId or string
        const legacyFileId =
          typeof rf === "string"
            ? rf
            : (rf && rf.fileId) ? rf.fileId : null;

        if (legacyFileId) {
          await sendTaskRelatedFile(ctx.telegram, user.telegramId, legacyFileId);
        }
      }

      // Keep your helper text so doer knows what is coming
      await ctx.telegram.sendMessage(user.telegramId, TEXT.relatedFileForYou[langForFile]);
    }
  } catch (e) {
    console.error("Failed to send related file(s) to doer:", e);
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

  // Your existing unban everywhere logic
  await unbanUserEverywhere(ctx, u);

  // 4f additions:
  // 1) Remove any Banlist rows tied to this user
  try { await Banlist.deleteOne({ user: u._id }); } catch (_) {}
  try { await Banlist.deleteOne({ telegramId: u.telegramId }); } catch (_) {}

  // 2) Cancel any pending punishment PaymentIntents (prevents any old hosted links from accepting money)
  try {
    await PaymentIntent.updateMany(
      { user: u._id, type: 'punishment', status: 'pending' },
      { $set: { status: 'voided', voidedAt: new Date() } }
    );
  } catch (e) {
    console.error("Failed voiding punishment intents on ADMIN_UNBAN:", e);
  }

  // 3) Make any on-screen "Punishment fee" button inert (NOT highlighted)
  try {
    const works = await DoerWork.find({
      doer: u._id,
      punishmentMessageId: { $exists: true }
    }).lean();

    for (const w of works) {
      try {
        await ctx.telegram.editMessageReplyMarkup(
          u.telegramId,
          w.punishmentMessageId,
          undefined,
          {
            inline_keyboard: [[
              // inert only (no checkmark)
              Markup.button.callback(
                (u.language === 'am' ? TEXT.punishBtn.am : TEXT.punishBtn.en),
                "_DISABLED_PUNISH"
              )
            ]]
          }
        );
      } catch (_) {}
    }
  } catch (_) {}

  await ctx.reply(`User ${u.fullName || u.username || u.telegramId} has been unbanned and can now use Taskifii normally.`);

  // Cancel any half-window enforcement for tasks awaiting creator feedback
  try {
    const pending = await DoerWork.find({
      halfWindowEnforcedAt: { $exists: false },
      completedAt: { $exists: true },     // doer already submitted
      status: { $ne: 'completed' }        // still considered active
    }).lean();

    for (const w of pending) {
      // Mark canceled so the half-window setTimeout does nothing
      await DoerWork.updateOne(
        { _id: w._id },
        { $set: { halfWindowCanceledAt: new Date(), status: 'completed' } }
      );

      // Inert the decision buttons (safety), if still on screen
      try {
        if (w.creatorDecisionMessageId) {
          await ctx.telegram.editMessageReplyMarkup(
            u.telegramId, // if u is the creator here; if not, look up the task’s creator
            w.creatorDecisionMessageId,
            undefined,
            {
              inline_keyboard: [[
                Markup.button.callback(TEXT.validBtn[u.language || 'en'], `_DISABLED_VALID`),
                Markup.button.callback(TEXT.needsFixBtn[u.language || 'en'], `_DISABLED_NEEDS_FIX`)
              ]]
            }
          );
        }
      } catch (_) {}
    }
  } catch (_) {}
  
  // Also cancel any doer second-half enforcement and close tasks awaiting fix feedback
  try {
    const pendingDoer = await DoerWork.find({
      secondHalfEnforcedAt: { $exists: false },
      currentRevisionStatus: 'awaiting_fix',
      status: { $ne: 'completed' }
    }).lean();

    for (const w of pendingDoer) {
      await DoerWork.updateOne(
        { _id: w._id },
        { $set: { secondHalfCanceledAt: new Date(), status: 'completed' } }
      );

      // Inert the doer decision buttons if still on screen
      try {
        if (w.doerDecisionMessageId && w.doerTelegramId) {
          await ctx.telegram.editMessageReplyMarkup(
            w.doerTelegramId,
            w.doerDecisionMessageId,
            undefined,
            {
              inline_keyboard: [[
                Markup.button.callback(TEXT.reportThisBtn?.[u.language || 'en'] || "🚩 Report this", "_DISABLED_DOER_REPORT"),
                Markup.button.callback(TEXT.sendCorrectedBtn?.[u.language || 'en'] || "📤 Send corrected version", "_DISABLED_DOER_SEND_CORRECTED")
              ]]
            }
          );
        }
      } catch (_) {}
    }
  } catch (_) {}

  

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

              // ✅ On success: #taskRefund + "#refund successful"
              await sendRefundAudit(bot, {
                tag: "#refund successful",
                task, creator, intent,
                extra: { reason, chapaReference, refundId }
              });
            } catch (apiErr) {
              const msg = String(apiErr?.message || "").toLowerCase();

              // ❗ Any type of failure → mark as queued so the worker keeps retrying forever
              await PaymentIntent.updateOne(
                { _id: intent._id },
                { $set: { refundStatus: "queued" } }
              );

              // ✅ On first failure: #taskRefund + "#refundfailed" (only once for this refund attempt)
              await sendRefundAudit(bot, {
                tag: "#refundfailed",
                task, creator, intent,
                extra: { reason }
              });
            }

            // --- NEW: cleanup when accepted doer never started (no "Do the task" before expiry) ---
            if (reason === "Accepted doer did not start (no 'Do the task' before expiry)") {
              try {
                // Remove any accidental/legacy DoerWork rows tied to this task that could keep timers alive
                await DoerWork.deleteMany({ task: task._id, status: 'active' });

                // Release any engagement locks that might still be active for this task
                await EngagementLock.updateMany(
                  { task: task._id, active: true },
                  { $set: { active: false, releasedAt: new Date() } }
                );
              } catch (e) {
                console.error("Cleanup after expiry (no doer started) failed:", e);
              }
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
                `መልእክት: ${text.substring(0, 100)}...`
              : `📩 New applicant for your task!\n\n` +
                `Task: ${task.description.substring(0, 50)}...\n\n` +
                `Applicant: ${applicantName}\n` +
                `Total earned: ${user.stats.totalEarned.toFixed(2)} birr\n` +
                `Frequent fields: ${topFields}\n` +
                `Rating: ${user.stats.ratingCount > 0 ? user.stats.averageRating.toFixed(1) : "N/A"} ★ (${user.stats.ratingCount} ratings)\n` + 
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
    user.onboardingStep = "skillsSelect";
    await user.save();
    return startUserSkillsSelection(ctx, user, false);

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
    Markup.inlineKeyboard([
      [Markup.button.callback(TEXT.skipBtn[lang], "TASK_SKIP_FILE")],
      [Markup.button.callback(TEXT.relatedFileDoneBtn[lang], "TASK_DONE_FILE")]
    ])
  );
    // For new tasks (not editing), skip the related file step
  // and go directly to the fields selection step.
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);


}



bot.action("TASK_SKIP_FILE", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";
  
  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }
  
  const promptId = ctx.session.taskFlow.relatedFilePromptId;

  // 1) Disable both Skip and Done (Skip highlighted, Done inert)
  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      promptId,
      undefined,
      {
        inline_keyboard: [
          [
            Markup.button.callback(`✔ ${TEXT.skipBtn[lang]}`, "_DISABLED_SKIP")
          ],
          [
            Markup.button.callback(TEXT.relatedFileDoneBtn[lang], "_DISABLED_DONE_FILE")
          ]
        ]
      }
    );
  } catch (err) {
    console.error("Failed to edit message reply markup (TASK_SKIP_FILE):", err);
  }

  // 2) Clear any related file that might have been set
  const draft = await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });
  if (draft) {
    draft.relatedFile = undefined;
    await draft.save();
  }

  // 3) In edit mode, return to preview instead of proceeding
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

  // 4) Original behavior for non-edit flow: move on to fields
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
});
bot.action("TASK_DONE_FILE", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }

  const promptId = ctx.session.taskFlow.relatedFilePromptId;
  const draftId = ctx.session.taskFlow.draftId;
  const isEdit = !!ctx.session.taskFlow.isEdit;

  const draft = draftId
    ? await TaskDraft.findById(draftId)
    : await TaskDraft.findOne({ creatorTelegramId: ctx.from.id });

  if (!draft) {
    // Draft is gone; just inform user gracefully
    return ctx.reply(
      lang === "am"
        ? "⚠️ የተግዳሮቱ ረቂቅ አልተገኘም። እባክዎ እንደገና ይጀምሩ።"
        : "⚠️ The task draft could not be found. Please start again."
    );
  }

  const rf = draft.relatedFile || {};
  const msgCount = Array.isArray(rf.messages) ? rf.messages.length : 0;
  const fileIdsCount = Array.isArray(rf.fileIds) ? rf.fileIds.length : 0;
  const legacyHasFile = !!rf.fileId;

  const hasAnyValid = msgCount > 0 || fileIdsCount > 0 || legacyHasFile;

  // If no valid related file was sent, show alert (Amharic + English)
  if (!hasAnyValid) {
    const alertText = TEXT.relatedFileDoneError[lang] || TEXT.relatedFileDoneError.en;
    try {
      await ctx.answerCbQuery(alertText, { show_alert: true });
    } catch (_) {}
    return; // stay on the same step, keep buttons active
  }

  // We DO have at least one valid related file.
  // Highlight Done, disable both buttons (Skip normal, Done with checkmark)
  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      promptId,
      undefined,
      {
        inline_keyboard: [
          [
            Markup.button.callback(TEXT.skipBtn[lang], "_DISABLED_SKIP")
          ],
          [
            Markup.button.callback(`✔ ${TEXT.relatedFileDoneBtn[lang]}`, "_DISABLED_DONE_FILE")
          ]
        ]
      }
    );
  } catch (err) {
    console.error("Failed to edit message reply markup (TASK_DONE_FILE):", err);
  }

  // EDIT MODE: just show updated preview
  if (isEdit) {
    await ctx.reply(lang === "am" ? "✅ ተያያዥ ፋይሎች ተዘምነዋል" : "✅ Related file(s) updated.");
    const updatedDraft = await TaskDraft.findById(draft._id);
    const userDoc = await User.findOne({ telegramId: ctx.from.id });
    const locked = await isEngagementLocked(ctx.from.id);

    await ctx.reply(
      buildPreviewText(updatedDraft, userDoc),
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

  // NON-EDIT MODE: move on exactly like your old handleRelatedFile did
  ctx.session.taskFlow.step = "fields";
  return askFieldsPage(ctx, 0);
});

bot.action("_DISABLED_SKIP", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (_) {}
});

bot.action("_DISABLED_DONE_FILE", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (_) {}
});






// Helper: if the user is currently in the "related file" step (create or edit),
// freeze the Skip/Done buttons and delete that specific draft.
async function cancelRelatedFileDraftIfActive(ctx) {
  try {
    if (!ctx || !ctx.from) return;

    ctx.session = ctx.session || {};

    if (ctx.session.taskFlow?.step !== "relatedFile") {
      return;
    }

    const me = await User.findOne({ telegramId: ctx.from.id });
    const lang = me?.language || "en";

    const promptId = ctx.session.taskFlow.relatedFilePromptId;

    if (promptId && ctx.chat && ctx.chat.id) {
      try {
        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          promptId,
          undefined,
          {
            inline_keyboard: [
              [
                Markup.button.callback(
                  TEXT.skipBtn[lang],
                  "_DISABLED_SKIP"
                )
              ],
              [
                Markup.button.callback(
                  TEXT.relatedFileDoneBtn[lang],
                  "_DISABLED_DONE_FILE"
                )
              ]
            ]
          }
        );
      } catch (e) {
        console.error("Failed to disable related-file buttons:", e);
      }
    }

    // Terminate ONLY this draft (if we know its id)
    if (ctx.session.taskFlow.draftId) {
      try {
        await TaskDraft.findByIdAndDelete(ctx.session.taskFlow.draftId);
      } catch (e) {
        console.error("Failed to delete draft in cancelRelatedFileDraftIfActive:", e);
      }
    }

    ctx.session.taskFlow = null;
  } catch (e) {
    console.error("Error cleaning up related-file flow:", e);
  }
}


async function handleRelatedFile(ctx, draft) {
  // Get user for language (even though we don't send an error message now, keep this for future)
  const user = await User.findOne({ telegramId: ctx.from.id });
  const lang = user?.language || "en";

  if (!ctx.session.taskFlow) {
    ctx.session.taskFlow = {};
  }

  const msg = ctx.message || {};

  // 1️⃣ Detect whether this message is "plain text only" or actually contains something
  //    we should treat as a valid related file.

  // Any of these keys mean "this message is more than just plain text"
  const mediaLikeKeys = [
    "photo",
    "document",
    "video",
    "audio",
    "voice",
    "video_note",
    "animation",
    "sticker",
    "contact",
    "location",
    "venue",
    "poll",
    "dice",
    "invoice",
    "game"
  ];

  const hasAnyMediaLike = mediaLikeKeys.some((k) => !!msg[k]);

  // URL / link detection in text or caption
  const hasLinkEntity =
    Array.isArray(msg.entities) &&
    msg.entities.some((e) => e.type === "url" || e.type === "text_link");

  const hasCaptionLink =
    Array.isArray(msg.caption_entities) &&
    msg.caption_entities.some((e) => e.type === "url" || e.type === "text_link");

  // "Plain text only" means:
  // - there IS msg.text
  // - NO media-like keys
  // - NO url/text_link entities in text or caption
  const isPlainTextOnly =
    !!msg.text && !hasAnyMediaLike && !hasLinkEntity && !hasCaptionLink;

  // ❌ Invalid related file = plain text only → IGNORE it completely.
  // We do NOT send TEXT.relatedFileError anymore.
  if (isPlainTextOnly) {
    return;
  }

  // ✅ Anything that is NOT plain text only is a valid related file:
  // - any media (photo, doc, video, audio, voice, video_note, animation, sticker, etc.)
  // - contact, location, poll, dice, etc.
  // - link-only messages (text that has URL/text_link entities)

  // 2️⃣ Initialize relatedFile object if needed
  if (!draft.relatedFile) {
    draft.relatedFile = {
      fileId: null,       // legacy representative file
      fileType: null,     // legacy type
      fileIds: [],        // additional file IDs (mainly for media)
      messages: []        // ALL original message references (for forwarding)
    };
  }

  const rf = draft.relatedFile;

  // 3️⃣ Extract ONE representative fileId + type for backwards compatibility
  let fileId = null;
  let fileType = null;

  if (msg.photo) {
    // photo is an array; use the highest resolution
    const photos = msg.photo;
    fileId = photos[photos.length - 1].file_id;
    fileType = "photo";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = "document";
  } else if (msg.video) {
    fileId = msg.video.file_id;
    fileType = "video";
  } else if (msg.audio) {
    fileId = msg.audio.file_id;
    fileType = "audio";
  } else if (msg.voice) {
    fileId = msg.voice.file_id;
    fileType = "voice";
  } else if (msg.video_note) {
    fileId = msg.video_note.file_id;
    fileType = "video_note";
  } else if (msg.animation) {
    fileId = msg.animation.file_id;
    fileType = "animation";
  } else if (msg.sticker) {
    fileId = msg.sticker.file_id;
    fileType = "sticker";
  } else if (hasLinkEntity || hasCaptionLink) {
    // Link-only or text-with-link message.
    // We don't have a fileId, but we still want it recognized as a valid related "file".
    fileId = null;
    fileType = "link";
  } else {
    // e.g. contact, location, venue, poll, dice, invoice, game
    // No fileId, but still a valid related "file" because it's not plain text.
    fileId = null;
    fileType = rf.fileType || null;
  }

  // 4️⃣ Save primary (legacy) fileId/fileType only once (first valid file)
  if (fileId && !rf.fileId) {
    rf.fileId = fileId;
  }
  if (fileType && !rf.fileType) {
    rf.fileType = fileType;
  }

  // 5️⃣ Save list of fileIds (for media that has file_id)
  if (!Array.isArray(rf.fileIds)) rf.fileIds = [];
  if (fileId && !rf.fileIds.includes(fileId)) {
    rf.fileIds.push(fileId);
  }

  // 6️⃣ Save original message reference so we can forward "as is" later
  if (!Array.isArray(rf.messages)) rf.messages = [];
  rf.messages.push({
    chatId: ctx.chat.id,
    messageId: msg.message_id
  });

  await draft.save();

  // IMPORTANT:
  // - We do NOT change ctx.session.taskFlow.step here.
  // - We do NOT touch Skip/Done buttons.
  // The creator can keep sending more valid related files, then tap Done.
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
// ===============================================
//  USER PROFILE SKILLS SELECTION (ONBOARDING + EDIT PROFILE)
//  Reuses ALL_FIELDS but stores selections in user.skills
// ===============================================

const MAX_USER_SKILLS = 7;

/**
 * Show a page of field buttons for selecting skills
 */
async function askUserSkillsPage(ctx, page, user) {
  const lang = user.language || "en";
  const start = page * FIELDS_PER_PAGE;
  const end = Math.min(start + FIELDS_PER_PAGE, ALL_FIELDS.length);

  const rows = [];

  for (let i = start; i < end; i++) {
    rows.push([
      Markup.button.callback(
        ALL_FIELDS[i],
        `USER_FIELD_${i}`
      )
    ]);
  }

  const navRow = [];
  if (page > 0) {
    navRow.push(
      Markup.button.callback(
        lang === "am" ? "⬅️ ወደ ኋላ" : "⬅️ Prev",
        `USER_FIELDS_PAGE_${page - 1}`
      )
    );
  }
  if (end < ALL_FIELDS.length) {
    navRow.push(
      Markup.button.callback(
        lang === "am" ? "ወደ ፊት ➡️" : "Next ➡️",
        `USER_FIELDS_PAGE_${page + 1}`
      )
    );
  }
  if (navRow.length > 0) rows.push(navRow);

  const intro = TEXT.profileFieldsIntro[lang];

  return ctx.reply(
    intro,
    Markup.inlineKeyboard(rows)
  );
}

/**
 * Start skills selection, used both in onboarding and edit-profile.
 */
async function startUserSkillsSelection(ctx, user, fromEdit = false) {
  ctx.session = ctx.session || {};
  
  // Always ensure it's an array
  user.skills = user.skills || [];

  if (fromEdit) {
    // We are editing from the profile → treat this as a fresh answer
    ctx.session.skillsEdit = true;
    user.skills = [];  // clear previous skills so new choices fully replace them
  }

  await user.save();
  return askUserSkillsPage(ctx, 0, user);
}


/**
 * Finalize skill selection.
 * - If onboardingStep === "skillsSelect" → move to Terms & Conditions.
 * - Otherwise → treat as an edit and go back to profile.
 */
async function finalizeUserSkillsSelection(ctx, user) {
  const lang = user.language || "en";

  // Ensure we have at least one skill
  if (!user.skills || user.skills.length === 0) {
    return ctx.reply(
      lang === "am"
        ? "እባክዎ ቢያንስ አንድ መስክ ይምረጡ ከመቀጠልዎ በፊት።"
        : "Please select at least one field before continuing."
    );
  }

  

  // 🟢 ONBOARDING PATH
  if (user.onboardingStep === "skillsSelect") {
    user.onboardingStep = "terms";
    await user.save();

    return ctx.reply(
      lang === "am" ? TEXT.askTerms.am : TEXT.askTerms.en,
      Markup.inlineKeyboard([
        [buildButton(TEXT.agreeBtn, "TC_AGREE", lang, false)],
        [buildButton(TEXT.disagreeBtn, "TC_DISAGREE", lang, false)]
      ])
    );
  }

  // 🟢 EDIT PROFILE PATH
  await user.save();
  ctx.session = ctx.session || {};
  delete ctx.session.skillsEdit;

  try {
    await updateAdminProfilePost(ctx, user, user.adminMessageId);
  } catch (err) {
    console.error("Failed to update admin profile after skills edit:", err);
  }

  await ctx.reply(TEXT.profileUpdated[lang]);

  const menu = Markup.inlineKeyboard([
    [Markup.button.callback(TEXT.postTaskBtn[lang], "POST_TASK")],
    [Markup.button.callback(TEXT.findTaskBtn[lang], "FIND_TASK")],
    [Markup.button.callback(TEXT.editProfileBtn[lang], "EDIT_PROFILE")]
  ]);

  return ctx.reply(buildProfileText(user, false), menu);
}

// ─── USER SKILLS PAGINATION ─────────────────────────
bot.action(/USER_FIELDS_PAGE_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  const page = parseInt(ctx.match[1], 10) || 0;

  try {
    await ctx.deleteMessage();
  } catch (e) {}

  return askUserSkillsPage(ctx, page, user);
});

// ─── USER SELECTS A FIELD AS SKILL ──────────────────
bot.action(/USER_FIELD_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  const lang = user.language || "en";
  const idx = parseInt(ctx.match[1], 10);
  const field = ALL_FIELDS[idx];

  user.skills = user.skills || [];

  if (!user.skills.includes(field) && user.skills.length < MAX_USER_SKILLS) {
    user.skills.push(field);
    await user.save();
  }

  // Delete previous keyboard message (ignore errors)
  try {
    await ctx.deleteMessage();
  } catch (e) {}

  const numbered = user.skills.map((f, i) => `${i + 1}. ${f}`).join("\n");

  // Text used while user is still choosing (1–6 skills) – with buttons
  const summaryTextWithButtons =
    lang === "am"
      ? `✅ የችሎታ መስኮች ምርጫዎ ተመዝግቧል። እስካሁን ያመረጡት:\n${numbered}\n\nሌላ መስክ ለመጨመር \"Add another field\" ይጫኑ ወይም ለመቀጠል \"Done\" ይጫኑ።`
      : `✅ Your field selection has been recorded. So far you've chosen:\n${numbered}\n\nTap \"Add another field\" to pick more, or \"Done\" to continue.`;

  // Text used when user reaches the hard cap (7 skills) – NO buttons
  const summaryTextFinal =
    lang === "am"
      ? `✅ የችሎታ መስኮች ምርጫዎ ተመዝግቧል። ያመረጡት:\n${numbered}`
      : `✅ Your field selection has been recorded. You've chosen:\n${numbered}`;

  // Auto-complete if they hit the hard cap (7 skills)
  if (user.skills.length >= MAX_USER_SKILLS) {
    // Show the final list WITHOUT buttons
    await ctx.reply(summaryTextFinal);
    return finalizeUserSkillsSelection(ctx, user);
  }

  // Normal case (1–6 skills): show summary + Add / Done buttons
  return ctx.reply(
    summaryTextWithButtons,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          lang === "am" ? "ሌላ መስክ ጨምር" : "Add another field",
          "USER_FIELDS_PAGE_0"
        )
      ],
      [
        Markup.button.callback(
          lang === "am" ? "ጨርስ" : "Done",
          "USER_FIELDS_DONE"
        )
      ]
    ])
  );
});


// ─── USER TAPS "DONE" FOR SKILLS ────────────────────
bot.action("USER_FIELDS_DONE", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  const lang = user.language || "en";

  // Build the same "so far you've chosen" text, using current skills
  const numbered = user.skills && user.skills.length
    ? user.skills.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "";

  const summaryText =
    lang === "am"
      ? `✅ የችሎታ መስኮች ምርጫዎ ተመዝግቧል። እስካሁን ያመረጡት:\n${numbered}\n\nሌላ መስክ ለመጨመር \"Add another field\" ይጫኑ ወይም ለመቀጠል \"Done\" ይጫኑ።`
      : `✅ Your field selection has been recorded. So far you've chosen:\n${numbered}\n\nTap \"Add another field\" to pick more, or \"Done\" to continue.`;

  // Edit the existing message:
  // - keep the text
  // - disable both buttons (we'll use dummy callback_data)
  // - highlight the Done button with a check mark
  try {
    await ctx.editMessageText(
      summaryText,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            lang === "am" ? "ሌላ መስክ ጨምር" : "Add another field",
            "_DISABLED_USER_FIELDS_ADD"
          )
        ],
        [
          Markup.button.callback(
            lang === "am" ? `✔ ጨርስ` : `✔ Done`,
            "_DISABLED_USER_FIELDS_DONE"
          )
        ]
      ])
    );
  } catch (e) {
    console.error("Failed to edit skills summary message:", e);
  }

  // Now move on (onboarding → Terms, edit → back to profile)
  return finalizeUserSkillsSelection(ctx, user);
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

  // 1) digits-only check
  if (!/^\d+$/.test(text)) {
    return ctx.reply(TEXT.paymentFeeErrorDigits[lang]);
  }

  const val = parseInt(text, 10);

  // 2) minimum 50 birr
  if (val < 50) {
    return ctx.reply(TEXT.paymentFeeErrorMin[lang]);
  }

  // 3) NEW RULE (only when editing):
  //    paymentFee must be ≥ 5 * penaltyPerHour
  if (
    ctx.session.taskFlow?.isEdit &&
    typeof draft.penaltyPerHour === "number" &&
    draft.penaltyPerHour > 0
  ) {
    const minAllowed = draft.penaltyPerHour * 5;
    if (val < minAllowed) {
      return ctx.reply(TEXT.paymentFeeErrorRelativePenalty[lang]);
    }
  }

  // If all checks pass, save and continue exactly as before
  draft.paymentFee = val;
  await draft.save();

  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am"
      ? "✅ የክፍያ መጠን ተዘምኗል"
      : "✅ Payment fee updated."
    );
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const userAgain = await User.findOne({ telegramId: ctx.from.id });
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, userAgain),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [
          locked
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
  
  // 1) digits-only check
  if (!/^\d+$/.test(text)) {
    return ctx.reply(TEXT.digitsOnlyError[lang]);
  }

  const hrs = parseInt(text, 10);

  // 2) basic range check
  if (hrs <= 0 || hrs > 120) {
    return ctx.reply(TEXT.timeToCompleteError[lang]); 
  }

  // 3) NEW RULE (only when editing):
  //    timeToComplete must be ≥ 2 * revisionTime
  if (
    ctx.session.taskFlow?.isEdit &&
    typeof draft.revisionTime === "number" &&
    draft.revisionTime > 0
  ) {
    const minAllowed = 2 * draft.revisionTime;
    if (hrs < minAllowed) {
      return ctx.reply(TEXT.timeToCompleteErrorRelativeRevision[lang]);
    }
  }

  // If all checks pass, save & continue as before
  draft.timeToComplete = hrs;
  await draft.save();
  
  if (ctx.session.taskFlow?.isEdit) {
    await ctx.reply(lang === "am"
      ? "✅ የስራ ጊዜ ተዘምኗል"
      : "✅ Time to complete updated."
    );
    const updatedDraft = await TaskDraft.findById(ctx.session.taskFlow.draftId);
    const userAgain = await User.findOne({ telegramId: ctx.from.id });
    const locked = await isEngagementLocked(ctx.from.id);
    await ctx.reply(
      buildPreviewText(updatedDraft, userAgain),
      Markup.inlineKeyboard([
        [Markup.button.callback(lang === "am" ? "ተግዳሮት አርትዕ" : "Edit Task", "TASK_EDIT")],
        [
          locked
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
        {
          // Removed parse_mode: "Markdown" to avoid errors with special characters
          reply_markup: adminButtons.reply_markup
        }
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
      {
        // Removed parse_mode: "Markdown" here too
        reply_markup: adminButtons.reply_markup
      }
    );
    console.log("Successfully updated admin message");
    return result;
  } catch (err) {
    console.error("Failed to edit admin message:", err.message);
    
    // If the message is too old to edit, send a new one and delete the old
    if (err.description && (
          err.description.includes("message to edit not found") || 
          err.description.includes("message is too old")
        )) {
      console.log("Message too old, sending new one");
      
      // Send new message
      const sent = await ctx.telegram.sendMessage(
        ADMIN_CHANNEL,
        adminText,
        {
          // Removed parse_mode: "Markdown" here as well
          reply_markup: adminButtons.reply_markup
        }
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
      [Markup.button.callback(TEXT.skipBtn[lang], "TASK_SKIP_FILE_EDIT")],
      [Markup.button.callback(TEXT.relatedFileDoneBtn[lang], "TASK_DONE_FILE")]
    ])

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
              
        inline_keyboard: [
          [
            Markup.button.callback(`✔ ${TEXT.skipBtn[lang]}`, "_DISABLED_SKIP")
          ],
          [
            Markup.button.callback(TEXT.relatedFileDoneBtn[lang], "_DISABLED_DONE_FILE")
          ]
        ]
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
    relatedFile: draft.relatedFile || null,

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
          ? `⏰ ማስታወሻ: ሰራውን ለመስራት ያመለከቱትን ለመምረጥ የቀረው ሰዓት እያለቀ ነው!\n\n` +
            `የሚቀረውም ሰዓት: ${hoursLeft} ሰዓት እና ${minutesLeft} ደቂቃ\n\n` 
          : `⏰ Reminder: Your task time is running out!\n\n` +
            `Time remaining for your task: ${hoursLeft} hours and ${minutesLeft} minutes\n\n` +
            `You have very little time left to accept applicants. Please select an applicant soon(if there are any).`;

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

    // Mark payment intent paid (idempotent)
    let intent = await PaymentIntent.findOne({ chapaTxRef: txRef });
    if (!intent) {
      intent = await PaymentIntent.create({
        user: me._id,
        draft: draftId, // may or may not still exist; we cast the id here
        chapaTxRef: txRef,
        status: "paid",
        paidAt: new Date(),
        provider: "chapa_hosted",
        amount: undefined, // optional; can be filled later from draft if needed
        currency: process.env.CHAPA_CURRENCY || "ETB"
      });
    } else if (intent.status !== "paid") {
      intent.status = "paid";
      intent.paidAt = new Date();
      await intent.save();
    }

    // Now verified – load draft and continue
    const draft = await TaskDraft.findById(draftId);

    if (!draft) {
      // Draft is gone => this payment is for an abandoned draft; refund it.
      await refundStaleOrDuplicateEscrow({
        intent,
        user: me,
        reason: "Stale or abandoned draft (HOSTED_VERIFY)"
      });

      return ctx.reply(
        me.language === "am"
          ? TEXT.duplicateTaskPaymentNotice.am
          : TEXT.duplicateTaskPaymentNotice.en
      );
    }
    // ✅ Before posting, if we were in the related-file step for some draft, terminate it
    await cancelRelatedFileDraftIfActive(ctx);
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

    if (!intent) {
      // No matching intent (should be rare); just stop.
      return ctx.reply(
        me.language === "am"
          ? "⚠️ የክፍያ መረጃ አልተገኘም። እባክዎ ከስራ አስኪያጆች ጋር ያግኙ።"
          : "⚠️ We couldn’t find the payment session. Please contact support."
      );
    }

    // Load draft
    const draft = await TaskDraft.findById(draftId);
    if (!draft) {
      // Draft is gone => refund this Telegram/Chapa escrow payment as stale
      await refundStaleOrDuplicateEscrow({
        intent,
        user: me,
        reason: "Stale or abandoned draft (Telegram successful_payment)"
      });

      return ctx.reply(
        me.language === "am"
          ? TEXT.duplicateTaskPaymentNotice.am
          : TEXT.duplicateTaskPaymentNotice.en
      );
    }
    // Before posting, clean up any active related-file draft (if user was in that step)
    await cancelRelatedFileDraftIfActive(ctx);

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

        // ✅ Audit for immediate success
        try {
          await sendRefundAudit(bot, {
            tag: "#refund successful",
            task,
            creator: user,
            intent,
            extra: { reason: "Creator canceled before engagement" }
          });
        } catch (auditErr) {
          console.error("Refund audit send failed (cancel success):", auditErr);
        }

        const okMsg = (lang === "am")
          ? "💸 የኢስክሮ ገንዘብዎ ወደ መጀመሪያ የክፍያ መንገድዎ ተመልሷል።"
          : "💸 Your escrow funds have been refunded to your original payment method.";
        await ctx.reply(okMsg);
      } catch (apiErr) {
        console.error("Chapa refund failed:", apiErr);

        const msg = String(apiErr?.message || "").toLowerCase();

        // ❗ Any kind of problem → queue it for unlimited retries
        await PaymentIntent.updateOne(
          { _id: intent._id },
          { $set: { refundStatus: "queued" } } // retryQueuedRefunds keeps trying
        );

        // ✅ On first failure: #taskRefund + "#refundfailed" (only once)
        try {
          await sendRefundAudit(bot, {
            tag: "#refundfailed",
            task,
            creator: user,
            intent,
            extra: { reason: "Creator canceled before engagement (initial auto-refund failed)" }
          });
        } catch (auditErr) {
          console.error("Refund audit send failed (cancel failure):", auditErr);
        }

        const sorry = (lang === "am")
          ? "💸 የተግዳሮቱ ክፍያ ወደ መጀመሪያ የክፍያ መንገድዎ እንመልሳለን። መመለሱ በሂደት ላይ ነው።"
          : "💸 Your task fee will be refunded back to your original payment method. The refund is being processed.";

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
  const skillsList = user.skills && user.skills.length
    ? user.skills.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : (lang === "am" ? "አልተመረጡም" : "N/A");
  
  const profileLines = user.language === "am" 
    ? [
        showCongrats ? "🎉 እንኳን ደስ አለዎት! ይህ የዎት Taskifii ፕሮፋይል ነው፦" : "📋 የእርስዎ Taskifii ፕሮፋይል፦",
        `• ሙሉ ስም: ${user.fullName}`,
        `• ስልክ: ${user.phone}`,
        `• ኢሜይል: ${user.email}`,
        `• ተጠቃሚ ስም: @${user.username}`,
        `• Taskifii መታወቂያ (ID): ${user._id}`,
        `• የስራ ልምድ(ዕውቀት):\n${skillsList}`,
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
        `• Taskifii ID: ${user._id}`,
        `• Your skills:\n${skillsList}`,
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
  const skillsList = user.skills && user.skills.length
    ? user.skills.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "N/A";
  
  // Add user ID to the header
  const lines = user.language === "am" 
    ? [
        `📋 **መግለጫ ፕሮፋይል ለአስተዳደር ማረጋገጫ** (User ID: ${user._id})`, // Added user ID
        `• ሙሉ ስም: ${user.fullName}`,
        `• ስልክ: ${user.phone}`,
        `• ኢሜይል: ${user.email}`,
        `• ተጠቃሚ ስም: @${user.username}`,
        `• የስራ ልምድ(ዕውቀት):\n${skillsList}`,
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
        `• Skill fields:\n${skillsList}`,
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
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_SKILLS")],
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
bot.action("EDIT_SKILLS", async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = ctx.from.id;
  const user = await User.findOne({ telegramId: tgId });
  if (!user) return ctx.reply("User not found. Please /start again.");

  const lang = user.language || "en";

  // Mark that we are editing skills (used by finalizeUserSkillsSelection)
  ctx.session = ctx.session || {};
  ctx.session.skillsEdit = true;

  // Highlight "Skills" and disable all edit buttons
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [Markup.button.callback(TEXT.editNameBtn[lang], "_DISABLED_EDIT_NAME")],
        [Markup.button.callback(TEXT.editPhoneBtn[lang], "_DISABLED_EDIT_PHONE")],
        [Markup.button.callback(TEXT.editEmailBtn[lang], "_DISABLED_EDIT_EMAIL")],
        [Markup.button.callback(TEXT.editUsernameBtn[lang], "_DISABLED_EDIT_USERNAME")],
        [Markup.button.callback(`✔ ${TEXT.editBanksBtn[lang]}`, "_DISABLED_EDIT_SKILLS")],
        [Markup.button.callback(TEXT.backBtn[lang], "_DISABLED_EDIT_BACK")]
      ]
    });
  } catch (err) {
    console.error("Error editing edit-profile markup for skills:", err);
  }

  // Start the same skills selection flow as onboarding, but from edit mode
  return startUserSkillsSelection(ctx, user, true);
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
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_SKILLS")],
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
    [Markup.button.callback(TEXT.editBanksBtn[user.language], "EDIT_SKILLS")],
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
    const draft = intent.draft ? await TaskDraft.findById(intent.draft) : null;

    if (!me) {
      return ctx.reply("❌ User not found. Please try again.");
    }

    if (!draft) {
      // Draft is gone => payment is stale/duplicate; refund and inform.
      await refundStaleOrDuplicateEscrow({
        intent,
        user: me,
        reason: "Stale or abandoned draft (HV button)"
      });

      return ctx.reply(
        me.language === "am"
          ? TEXT.duplicateTaskPaymentNotice.am
          : TEXT.duplicateTaskPaymentNotice.en
      );
    }
    await cancelRelatedFileDraftIfActive(ctx);

    // ✅ Use your existing post-from-draft helper
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
    // We also capture messages during the revision window when a fix notice
    // has been sent but the work is not yet fully accepted.  The `$or` clause
    // finds tasks in either the active work window or awaiting corrections.
    const work = await DoerWork.findOne({
      doerTelegramId: fromId,
      $or: [
        { status: 'active' },
        { status: 'completed', fixNoticeSentAt: { $exists: true }, currentRevisionStatus: { $ne: 'accepted' } }
      ]
    })
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

  // Ensure there is a valid pending payout session for this task
  if (!pending || String(pending.taskId) !== taskId) {
    return ctx.answerCbQuery("❌ Session expired. Please try again.");
  }

  // Delete the old bank list message to avoid clutter
  try {
    await ctx.deleteMessage();
  } catch (e) {
    // Ignored if message cannot be deleted (e.g. already removed)
  }

  // Build the keyboard for the requested page
  const keyboardMarkup = buildBankKeyboard(
    taskId,
    pending.banks,
    page,
    pending.selectedBankId
  );

  // Determine language and prompt text
  const lang = pending.language || "en";
  let promptText;
  if (pending.banks && pending.banks.length) {
    if (pending.selectedBankId) {
      // A bank has already been selected; show which one is marked
      promptText =
        lang === "am"
          ? "እባክዎ የእርስዎን ባንክ ይምረጡ። (የተመረጠው በ ✔ ይታያል)"
          : "Choose a bank for payout (current selection marked with ✔):";
    } else {
      // No bank has been selected yet
      promptText =
        lang === "am"
          ? "እባክዎ የእርስዎን ባንክ ይምረጡ።"
          : "Please choose your bank for payout:";
    }
  } else {
    // There are no available banks to choose
    promptText =
      lang === "am"
        ? "ባንኮች አልተገኙም።"
        : "No banks available.";
  }

  // Send the localized prompt with the new keyboard
  return ctx.reply(promptText, keyboardMarkup);
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

// Somewhere with other actions:
bot.action(/^PUNISH_PAY_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const taskId = ctx.match[1];
  const doerTgId = ctx.from.id;
  const user = await User.findOne({ telegramId: doerTgId });
  if (!user) return;

  const task = await Task.findById(taskId);
  if (!task) return;

  // Locate the doerWork record
  const work = await DoerWork.findOne({ task: task._id, doer: user._id });
  if (!work) return;

  // If already paid, short-circuit
  if (work.punishmentPaidAt) {
    const t = TEXT.punishAlreadyPaid[user.language || 'en'] || TEXT.punishAlreadyPaid.en;
    await ctx.reply(t);
    return;
  }

  // Void any previous pending punishment intents (so old links stop working)
  await PaymentIntent.updateMany(
    { task: task._id, user: user._id, type: 'punishment', status: 'pending' },
    { $set: { status: 'voided', voidedAt: new Date() } }
  );

  const original = Number(task.paymentFee || 0);
  const punishAmount = Math.round(original * 0.5);

  // Create a fresh PaymentIntent
  const intent = await PaymentIntent.create({
    task: task._id,
    user: user._id,
    amount: punishAmount,
    currency: 'ETB',
    type: 'punishment',
    status: 'pending',
    provider: 'chapa',
    createdAt: new Date()
  });

  // Build hosted checkout via Chapa (tx_ref unique per intent)
  const txRef = `punish_${intent._id}`;
  // Reuse whatever helper you have to create hosted checkout; otherwise inline:
  const checkout = await createChapaCheckoutLink({
    amount: punishAmount,
    currency: 'ETB',
    email: user.email || 'noemail@taskifii.local',
    first_name: user.fullName || user.username || `${user.telegramId}`,
    tx_ref: txRef,
    // We keep callback_url so the server receives IPN and unbans automatically.
    callback_url: `${process.env.PUBLIC_BASE_URL || ''}/chapa/ipn`
    // No return_url -> Chapa shows its receipt and doesn’t redirect.
  });


  await PaymentIntent.updateOne(
    { _id: intent._id },
    { $set: { reference: txRef, checkoutUrl: checkout?.data?.checkout_url || null } }
  );

  const lang = user.language || 'en';
  const lead = (TEXT.punishLinkReady?.[lang] || TEXT.punishLinkReady.en);
  const link = checkout?.data?.checkout_url || "(link unavailable)";
  await ctx.reply(`${lead}\n${link}`);
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
        try {
          const freshTask = await Task.findById(task._id).populate("creator").lean();
          if (!freshTask) return;

          // Bail out if someone already finalized/closed or we cancelled this half-window
          const freshWork = await DoerWork.findOne({ task: task._id });
          if (!freshWork) return;
          if (freshWork.halfWindowEnforcedAt || freshWork.halfWindowCanceledAt) return;

          // Condition A: creator never chose Valid nor Needs Fix
          const creatorNeverDecided = !freshWork?.creatorDecisionMessageIdChosen; // we’ll set this when they click either button (see step 5)

          // Condition B: creator clicked Needs Fix but never sent the fix notice (and clicked Send Fix Notice)
          const needsFixClicked = !!freshWork?.needsFixChosenAt;
          const fixNoticeSent   = !!freshWork?.fixNoticeSentAt;

          const shouldBan = (creatorNeverDecided) || (needsFixClicked && !fixNoticeSent);

          if (!shouldBan) return;

          // 1) Make decision buttons inert (but still displayed)
          try {
            if (freshWork.creatorDecisionMessageId && freshTask.creator?.telegramId) {
              await globalThis.TaskifiiBot.telegram.editMessageReplyMarkup(
                freshTask.creator.telegramId,
                freshWork.creatorDecisionMessageId,
                undefined,
                {
                  inline_keyboard: [[
                    Markup.button.callback(TEXT.validBtn[freshTask.creator.language || 'en'], `_DISABLED_VALID`),
                    Markup.button.callback(TEXT.needsFixBtn[freshTask.creator.language || 'en'], `_DISABLED_NEEDS_FIX`)
                  ]]
                }
              );
            }
          } catch (_) {}

          // 1b) If there was a "Send Fix Notice" prompt shown, make that button inert too
          try {
            if (freshWork.fixPromptMessageId && freshTask.creator?.telegramId) {
              await globalThis.TaskifiiBot.telegram.editMessageReplyMarkup(
                freshTask.creator.telegramId,
                freshWork.fixPromptMessageId,
                undefined,
                {
                  inline_keyboard: [[
                    Markup.button.callback(
                      (freshTask.creator.language === 'am' ? "🛠 ማስተካከል ማሳወቂያ ላክ" : "🛠 Send Fix Notice"),
                      "_DISABLED_SEND_FIX_NOTICE"
                    )
                  ]]
                }
              );
            }
          } catch (_) {}

          // 2) Ban the creator everywhere (bot + group)
          const creatorUser = await User.findById(freshTask.creator._id);
          await banUserEverywhere({ telegram: globalThis.TaskifiiBot.telegram }, creatorUser);

          // 3) Close the task / stop revision life-cycle; unlock the winner doer
          try {
            await DoerWork.updateOne(
              { _id: freshWork._id },
              { $set: { status: 'completed', halfWindowEnforcedAt: new Date() } }
            );
          } catch (_) {}

          try { await releaseLocksForTask(freshTask._id); } catch (_) {}
          try {
            await EngagementLock.updateMany(
              { task: freshTask._id },
              { $set: { active: false, releasedAt: new Date() } }
            );
          } catch (_) {}

          // 4) Notifications
          try {
            await globalThis.TaskifiiBot.telegram.sendMessage(
              creatorUser.telegramId,
              "🚫 You’ve been temporarily banned from Taskifii for not giving the required feedback (Valid vs Needs Fixing) within the first half of the revision period. Taskifii will investigate and make a final decision."
            );
          } catch (_) {}

          try {
            const doerApp = (freshTask.applicants || []).find(a => a.confirmedAt);
            const doerUser = doerApp ? await User.findById(doerApp.user) : null;
            if (doerUser) {
              await globalThis.TaskifiiBot.telegram.sendMessage(
                doerUser.telegramId,
                "ℹ️ The task creator didn’t provide feedback in time. Taskifii will review and decide as soon as possible. You can use Taskifii again in the meantime."
              );
            }
          } catch (_) {}

          // 5) Audit post with #NeitherApproveNorReject (+ repeat count + penalty total if applicable)
          try {
            const doerApp = (freshTask.applicants || []).find(a => a.confirmedAt);
            const doerUser = doerApp ? await User.findById(doerApp.user) : null;

            // increment creator repeat counter
            let creatorRepeat = 1;
            try {
              const inc = await User.updateOne(
                { _id: creatorUser._id },
                { $inc: { noFeedbackCount: 1 } }
              );
              // fetch back value
              const again = await User.findById(creatorUser._id).lean();
              creatorRepeat = Math.max(again?.noFeedbackCount || 1, 1);
            } catch (_) {}

            const fee = Number(freshTask.paymentFee || 0);
            const penaltyPerHour = Number((freshTask.penaltyPerHour ?? freshTask.latePenalty) || 0);

            // compute total deducted penalty if doer submitted AFTER original deadline but BEFORE 35% limit
            let deducted = 0;
            try {
              const completedAt   = freshWork.completedAt ? new Date(freshWork.completedAt) : null;
              const deadlineAt    = freshWork.deadlineAt ? new Date(freshWork.deadlineAt) : null;
              const penaltyStart  = freshWork.penaltyStartAt ? new Date(freshWork.penaltyStartAt) : null;
              const penaltyEnd    = freshWork.penaltyEndAt ? new Date(freshWork.penaltyEndAt) : null;

              if (completedAt && deadlineAt && penaltyStart && penaltyEnd && penaltyPerHour > 0) {
                if (completedAt > deadlineAt && completedAt < penaltyEnd) {
                  const hours = Math.ceil((completedAt - penaltyStart) / 3600000);
                  deducted = Math.max(0, hours) * penaltyPerHour;
                }
              }
            } catch (_) {}

            const lines = [
              "#NeitherApproveNorReject" + (creatorRepeat > 1 ? ` #${creatorRepeat}` : ""),
              `Task: ${freshTask._id}`,
              `Creator User ID: ${creatorUser?._id}`,
              `Doer User ID: ${doerUser?._id || "-"}`,
              `Task Fee: ${fee}`,
            ];
            if (deducted > 0) lines.push(`Penalty Deducted (so far): ${deducted}`);

            await globalThis.TaskifiiBot.telegram.sendMessage(
              AUDIT_CHANNEL_ID,
              lines.join("\n"),
              { disable_web_page_preview: true }
            );
          } catch (e) {
            console.error("Audit send failed:", e);
          }

        } catch (e) {
          console.error("Half-window enforcement failed:", e);
        }
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
  try {
    await DoerWork.updateOne(
      { task: taskId },
      { $set: { creatorDecisionMessageIdChosen: true } }
    );
  } catch (_) {}

  // Immediately send the rating prompt to the creator before finalizing.
  try {
    const task = await Task.findById(taskId).populate("creator").populate("applicants.user");
    if (task) {
      const doer = acceptedDoerUser(task);
      const creator = task.creator;
      if (doer && creator) {
        const tIdString = task._id.toString();
        // Only send if not already sent for this task.
        if (!global.sentRatingPromptToCreator[tIdString]) {
          await sendRatingPromptToUser(ctx.telegram, creator, doer, 'creatorRatesDoer', task);
          global.sentRatingPromptToCreator[tIdString] = true;
        }
      }
    }
  } catch (e) {
    console.error("Error sending early rating prompt:", e);
  }
  // Now proceed with the existing finalize call.
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
  
  // Disable both decision buttons and mark "Needs Fixing" as chosen
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[
        Markup.button.callback(TEXT.validBtn[lang], `_DISABLED_VALID`),
        Markup.button.callback(`✔ ${TEXT.needsFixBtn[lang]}`, `_DISABLED_NEEDS_FIX`)
      ]]
    });
  } catch {}
  try {
    await DoerWork.updateOne(
      { task: taskId },
      { $set: { creatorDecisionMessageIdChosen: true } }
    );
  } catch (_) {}

  // Notify the creator to list all issues and provide a "Send Fix Notice" button
  const instructMsg = (lang === 'am')
    ? "❗ እባክዎን ያስተካክሏቸው ሁሉንም ጉዳዮች በመልእክቶች ተዝርዞ ይጻፉ። ከተግባሩ ግልባጭ ውጪ ማስፈልግ አይፈቀድም። የቀረውን ጊዜ ተጠቅመው ይህን ዝርዝር ያቅርቡ። ከተጨረሱ በኋላ “ማስተካከል ማሳወቂያ ላክ” የሚለውን ቁልፍ ይጫኑ።"
    : "❗ Please *list everything* that needs fixing in separate messages below. You cannot request changes beyond the original task description. You have until halfway through the revision period to send this list. Once done, tap **Send Fix Notice**.";
  const sentPrompt = await ctx.reply(instructMsg, {
  parse_mode: "Markdown",
  ...Markup.inlineKeyboard([
    [ Markup.button.callback(
        lang === 'am' ? "🛠 ማስተካከል ማሳወቂያ ላክ" : "🛠 Send Fix Notice",
        `CREATOR_SEND_FIX_NOTICE_${taskId}`
    ) ]
  ])
  });

  // Mark that creator chose "Needs Fixing" (we'll use this at half window)
  try {
    work.needsFixChosenAt = new Date();
    work.fixPromptMessageId = sentPrompt?.message_id;
    await work.save();
  } catch (_) {}

  // Put the creator into "fix listing" mode to capture their messages
  ctx.session = ctx.session || {};
  ctx.session.fixingTaskId = taskId;
  // (Also mark in DB when revision was requested, if needed)
  work.revisionRequestedAt = new Date();
  await work.save();
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
  // Load the task once so we can reuse it below
  const task = await Task.findById(taskId);
  if (!task) {
    return ctx.answerCbQuery("Error: task not found.", { show_alert: true });
  }

  // First-half deadline = completedAt + (revisionTime / 2)
  const halfDeadline = new Date(
    work.completedAt.getTime() + (task.revisionTime * 60 * 60 * 1000) / 2
  );

  // Flag that the creator actually submitted a fix notice (before clicking the button)
  try {
    work.fixNoticeSentAt = new Date();
    await work.save();
  } catch (_) {}

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
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[ Markup.button.callback(
        lang === 'am' ? "✔ ማስተካከል ማሳወቂያ ተልኳል" : "✔ Fix Notice Sent",
        `_DISABLED_SEND_FIX_NOTICE`
      ) ]]
    });
  } catch {}
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
  // capture the buttons message id so we can inactivate later without deleting it
  const sentToDoer = await ctx.telegram.sendMessage(
    doerUser.telegramId,
    doerMsgText,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          (doerUser.language === 'am' ? "🚩 ይህን ያሳውቁ" : "🚩 Report this"),
          `DOER_REPORT_${String(task._id)}`
        ),
        Markup.button.callback(
          (doerUser.language === 'am' ? "📤 የተስተካከለ ስራ ላክ" : "📤 Send corrected version"),
          `DOER_SEND_CORRECTED_${String(task._id)}`
        )
      ]
    ])
  );

  // store the keyboard message id on the work doc
  await DoerWork.updateOne(
    { _id: work._id },
    { $set: { doerDecisionMessageId: sentToDoer.message_id } }
  );

  // if Fix Notice was sent before the midpoint, end the first half NOW and begin the second half window
  try {
    const revisionHours = Number(task.revisionTime || 0);
    if (revisionHours > 0 && work.completedAt) {
      const firstHalfMillis = (revisionHours * 60 * 60 * 1000) / 2;
      const revisionStart = new Date(work.completedAt);
      const halfDeadline = new Date(revisionStart.getTime() + firstHalfMillis);
      const now = new Date();

      if (now < halfDeadline) {
        // stop any future "creator first-half enforcement"
        await DoerWork.updateOne(
          { _id: work._id },
          { $set: { halfWindowCanceledAt: now } }
        );

        // arm the second-half timer (a fresh half of the revision time starting now)
        const secondHalfEnd = new Date(now.getTime() + firstHalfMillis);
        const delay = Math.max(0, secondHalfEnd.getTime() - now.getTime());
        scheduleDoerSecondHalfEnforcement(String(task._id), delay); // function added in section 3

      }
    }
  } catch (e) { console.error("second-half arming failed:", e); }

  

  // Mark fix notice as sent and track revision status
  work.fixNoticeSentAt = new Date();
  work.currentRevisionStatus = 'awaiting_fix';

  // Also store revision start/end so timers survive restarts
  // (use the moment the Fix Notice is sent + HALF of task.revisionTime hours)
  try {
    if (work.fixNoticeSentAt && task && Number(task.revisionTime || 0) > 0) {
      const revisionHours = Number(task.revisionTime || 0);
      const secondHalfMillis = (revisionHours * 60 * 60 * 1000) / 2;

      const revisionStart = new Date(work.fixNoticeSentAt);
      const revisionEnd = new Date(
        revisionStart.getTime() + secondHalfMillis
      );

      work.revisionStartedAt = revisionStart;
      work.revisionDeadlineAt = revisionEnd;
    }
  } catch (e) {
    console.error("Failed to set revision window:", e);
  }


  await work.save();

  
  
  // Clear the creator's session fix mode
  ctx.session.fixingTaskId = null;
});
bot.action(/^DP_OPEN_(.+)_(completed|related|fix)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}

  const [, pkgId, which] = ctx.match;
  const pkg = await DisputePackage.findById(pkgId).lean();
  if (!pkg) return;

  const task = await Task.findById(pkg.task).populate('creator').lean();
  const work = await DoerWork.findOne({ task: pkg.task }).populate('doer').lean();
  const creatorUser = await User.findById(task.creator._id).lean();
  const doerUser    = await User.findById(work.doer._id).lean();

  // We always send to the same channel the package used
  const channelId = pkg.channelId || DISPUTE_CHANNEL_ID;

  if (which === 'completed') {
    // We want ONLY the original completed submission, not later corrections.
    const cutoff =
      work.fixNoticeSentAt ||
      work.completedAt ||
      work.startedAt ||
      new Date(0);

    // Messages up to and including the cutoff = original completed work
    const baseEntries = (work.messages || []).filter(entry =>
      entry.date && new Date(entry.date) <= cutoff
    );

    // Fallback: if for some legacy reason we don't get anything, send all
    const entriesToSend = baseEntries.length ? baseEntries : (work.messages || []);

    await forwardMessageLogToDispute(
      ctx.telegram,
      channelId,
      work.doerTelegramId,
      entriesToSend,
      `📦 COMPLETED TASK (from Winner Task Doer) — TASK ${task._id}:`
    );
  } else if (which === 'related') {

    const rf = task.relatedFile;

    // New behaviour: if we have stored original messages, forward them all
    if (rf && Array.isArray(rf.messages) && rf.messages.length > 0) {
      await safeTelegramCall(
        ctx.telegram.sendMessage.bind(ctx.telegram),
        channelId,
        "📎 TASK RELATED FILE(S) (from original task post):"
      );

      for (const m of rf.messages) {
        try {
          await safeTelegramCall(
            ctx.telegram.forwardMessage.bind(ctx.telegram),
            channelId, // send into dispute channel
            m.chatId,
            m.messageId
          );
        } catch (e) {
          console.error("Failed to forward related file message to dispute channel:", e);
        }
      }
    } else {
      // Legacy: single fileId or string
      const legacyFileId =
        typeof rf === "string"
          ? rf
          : (rf && rf.fileId) ? rf.fileId : null;

      if (legacyFileId) {
        await safeTelegramCall(
          ctx.telegram.sendMessage.bind(ctx.telegram),
          channelId,
          "📎 TASK RELATED FILE (from original task post):"
        );
        await safeTelegramCall(
          sendTaskRelatedFile,
          ctx.telegram,
          channelId,
          legacyFileId
        );
      } else {
        await safeTelegramCall(
          ctx.telegram.sendMessage.bind(ctx.telegram),
          channelId,
          "No related file was attached on the original task."
        );
      }
    }

  } else if (which === 'fix') {

    await forwardMessageLogToDispute(
      ctx.telegram, channelId, creatorUser.telegramId, work.fixRequests,
      `✏️ FIX NOTICE (from Task Creator) — TASK ${task._id}:`
    );
  }
});
// From the dispute channel: send ONLY the corrected version of the completed work.
bot.action(/^DP_SEND_CORRECTIONS_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}

  const pkgId = ctx.match[1];

  try {
    const pkg = await DisputePackage.findById(pkgId).lean();
    if (!pkg) return;

    const work = await DoerWork.findOne({ task: pkg.task }).lean();
    if (!work) {
      await ctx.reply("No recorded work found for this task.");
      return;
    }

    // "Corrected" messages = messages that came AFTER the fix notice
    const cutoff =
      work.fixNoticeSentAt ||
      work.completedAt ||
      work.startedAt ||
      new Date(0);

    const correctedEntries = (work.messages || []).filter(entry =>
      entry.date && new Date(entry.date) > cutoff
    );

    if (!correctedEntries.length) {
      await ctx.reply("No corrected submissions were recorded for this task.");
      return;
    }

    const channelId = pkg.channelId || DISPUTE_CHANNEL_ID;

    await forwardMessageLogToDispute(
      ctx.telegram,
      channelId,
      work.doerTelegramId,
      correctedEntries,
      `📦 CORRECTED COMPLETED TASK (from Winner Task Doer) — TASK ${pkg.task}:`
    );
  } catch (e) {
    console.error("DP_SEND_CORRECTIONS handler failed:", e);
  }
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
// Handle when the doer has finished uploading their corrections and clicks
// the “Send corrected version” button. This forwards all doer messages that
// arrived after the fix notice to the creator and shows the creator
// Approve/Reject buttons.
bot.action(/^DOER_SEND_CORRECTED_(.+)$/, async (ctx) => {
  // highlight the clicked button and disable both buttons
  try {
    const currentKeyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
    if (currentKeyboard && currentKeyboard[0]) {
      const newRow = currentKeyboard[0].map(btn => {
        if (btn.callback_data && btn.callback_data.startsWith("DOER_REPORT_")) {
          // disable report, keep label
          return Markup.button.callback(btn.text, "_DISABLED_DOER_REPORT");
        }
        if (btn.callback_data && btn.callback_data.startsWith("DOER_SEND_CORRECTED_")) {
          const highlighted = btn.text.startsWith("✔") ? btn.text : (`✔ ${btn.text}`);
          return Markup.button.callback(highlighted, "_DISABLED_DOER_SEND_CORRECTED");
        }
        return Markup.button.callback(btn.text, "_DISABLED_GENERIC");
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    }
  } catch (err) {
    console.error("Failed to edit inline keyboard on send corrected:", err);
  }

  const taskId = ctx.match[1];
  const work = await DoerWork.findOne({ task: taskId });
  const task = await Task.findById(taskId);
  if (!work || !task) {
    await ctx.answerCbQuery("Error: task not found.", { show_alert: true });
    return;
  }

  // enforce the total revision window: completedAt + revisionTime hours
  const revisionHours = task.revisionTime || 0;
  if (revisionHours > 0) {
    const baseEnd = new Date(work.completedAt.getTime() + revisionHours * 60 * 60 * 1000);
    const effectiveEnd = work.revisionDeadlineAt
      ? new Date(work.revisionDeadlineAt)
      : baseEnd;

    if (new Date() > effectiveEnd) {
      await ctx.answerCbQuery(
        (work.doer?.language || 'en') === 'am'
          ? "የማሻሻያ ጊዜ አልፎታል።"
          : "The revision window has expired.",
        { show_alert: true }
      );
      return;
    }
  }


  // messages sent after the fix notice are considered corrections
  const cutOff   = work.fixNoticeSentAt || work.completedAt;
  const correctedEntries = (work.messages || []).filter(
    entry => entry.date && entry.date > cutOff
  );
  if (!correctedEntries.length) {
    await ctx.answerCbQuery(
      (work.doer?.language || 'en') === 'am'
        ? "አስተካክሏት ያላኩት ምንም መልእክት አልተገኘም። እባክዎን የተስተካከለውን ስራ በመመልከት ማስተላለፊያ ላኩ።"
        : "No corrected work was detected. Please send the corrected files or messages before tapping this button.",
      { show_alert: true }
    );
    return;
  }

  // forward each corrected message to the creator preserving type and caption
  const creatorUser = await User.findById(task.creator);
  if (!creatorUser) {
    await ctx.answerCbQuery("Error: creator not found.", { show_alert: true });
    return;
  }
  for (const entry of correctedEntries) {
    try {
      await ctx.telegram.copyMessage(
        creatorUser.telegramId,
        work.doerTelegramId,
        entry.messageId
      );
    } catch (err) {
      console.error("Failed to forward corrected message:", err);
    }
  }

  // send a prompt to the creator to approve or reject the corrected work
  const creatorLang = creatorUser.language || 'en';
  const approveLabel = creatorLang === 'am' ? "✅ አጸድቅ" : "✅ Approve";
  const rejectLabel  = creatorLang === 'am' ? "❌ እስት ፍቀድ" : "❌ Reject";
  const infoText = creatorLang === 'am'
    ? "የተስተካከለው ስራ ተልኳል። እባክዎ ይመልከቱና ለመቀበል ወይም ለመካከል ቁልፍ ይጫኑ።"
    : "The corrected work has been submitted. Please review it and tap Approve or Reject below.";

  const creatorPrompt = await ctx.telegram.sendMessage(
    creatorUser.telegramId,
    infoText,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(approveLabel, `CREATOR_APPROVE_REVISION_${taskId}`),
        Markup.button.callback(rejectLabel,  `CREATOR_REJECT_REVISION_${taskId}`)
      ]
    ])
  );

  // store this message id so we can later make Approve/Reject inert (difference A)
  try {
    await DoerWork.updateOne(
      { _id: work._id },
      {
        $set: {
          creatorFinalDecisionMessageId: creatorPrompt.message_id,
          finalDecisionCanceledAt: null
        }
      }
    );
  } catch (e) {
    console.error("Failed to store creatorFinalDecisionMessageId:", e);
  }

  // Start a fresh post-correction timer equal to HALF of the revision time.
  // This only runs because we already checked that we are still within the second revision window.
  try {
    const revisionHoursLocal = task.revisionTime || 0;
    if (revisionHoursLocal > 0) {
      const halfMillis = (revisionHoursLocal * 60 * 60 * 1000) / 2;
      scheduleCreatorFinalDecisionEnforcement(String(taskId), halfMillis);
    }
  } catch (e) {
    console.error("Failed to schedule creator final decision enforcement:", e);
  }


  // update revision state (optional but harmless)
  try {
    work.currentRevisionStatus = 'fix_received';
    work.revisionCount = (work.revisionCount || 0) + 1;
    work.doerCorrectedClickedAt = new Date();

    await work.save();
  } catch (err) {
    console.error("Failed to update work after corrected send:", err);
  }

  await ctx.answerCbQuery();
});
// Creator clicked Approve on a corrected submission.
// Visually behaves like before, but now also finalizes exactly like "Valid".
bot.action(/^CREATOR_APPROVE_REVISION_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];

  // 1) VISUAL: highlight Approve and disable both buttons (same behavior)
  try {
    const currentKeyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
    if (currentKeyboard && currentKeyboard[0]) {
      const newRow = currentKeyboard[0].map(btn => {
        if (btn.callback_data && btn.callback_data.startsWith('CREATOR_APPROVE_REVISION_')) {
          const highlighted = btn.text.startsWith('✔') ? btn.text : (`✔ ${btn.text}`);
          return Markup.button.callback(highlighted, '_DISABLED_APPROVE_REVISION');
        }
        if (btn.callback_data && btn.callback_data.startsWith('CREATOR_REJECT_REVISION_')) {
          return Markup.button.callback(btn.text, '_DISABLED_REJECT_REVISION');
        }
        return Markup.button.callback(btn.text, '_DISABLED_GENERIC');
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    }
  } catch (err) {
    console.error('Failed to edit approve revision buttons:', err);
  }

  // 2) LOGIC: do the same things as CREATOR_VALID
  try {
    // Mark that the creator has made a final decision and cancel any pending timeout
    await DoerWork.updateOne(
      { task: taskId },
      {
        $set: {
          creatorDecisionMessageIdChosen: true,
          finalDecisionCanceledAt: new Date()
        }
      }
    );
  } catch (e) {
    console.error("DoerWork update from approve failed:", e);
  }


  // Send early rating prompt to creator (same logic as CREATOR_VALID)
  try {
    const task = await Task.findById(taskId)
      .populate("creator")
      .populate("applicants.user");

    if (task) {
      const doer = acceptedDoerUser(task);
      const creator = task.creator;
      if (doer && creator) {
        const tIdString = task._id.toString();
        if (!global.sentRatingPromptToCreator[tIdString]) {
          await sendRatingPromptToUser(ctx.telegram, creator, doer, 'creatorRatesDoer', task);
          global.sentRatingPromptToCreator[tIdString] = true;
        }
      }
    }
  } catch (e) {
    console.error("Error sending early rating prompt from approve:", e);
  }

  // 3) Finalize and release payment as 'accepted' (identical to CREATOR_VALID)
  try {
    await releasePaymentAndFinalize(taskId, 'accepted');
  } catch (e) {
    console.error("releasePaymentAndFinalize from approve failed:", e);
  }
});


// Creator clicked Reject on a corrected submission.
// Visually behaves the same, but now escalates like "Report this".
bot.action(/^CREATOR_REJECT_REVISION_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const taskId = ctx.match[1];

  // 1) VISUAL: highlight Reject and disable both buttons (same behavior)
  try {
    const currentKeyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
    if (currentKeyboard && currentKeyboard[0]) {
      const newRow = currentKeyboard[0].map(btn => {
        if (btn.callback_data && btn.callback_data.startsWith('CREATOR_REJECT_REVISION_')) {
          const highlighted = btn.text.startsWith('✔') ? btn.text : (`✔ ${btn.text}`);
          return Markup.button.callback(highlighted, '_DISABLED_REJECT_REVISION');
        }
        if (btn.callback_data && btn.callback_data.startsWith('CREATOR_APPROVE_REVISION_')) {
          return Markup.button.callback(btn.text, '_DISABLED_APPROVE_REVISION');
        }
        return Markup.button.callback(btn.text, '_DISABLED_GENERIC');
      });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [ newRow ] });
    }
  } catch (err) {
    console.error('Failed to edit reject revision buttons:', err);
  }
  // Mark that a final decision was made so the post-correction timeout won't fire
  try {
    await DoerWork.updateOne(
      { task: taskId },
      { $set: { finalDecisionCanceledAt: new Date() } }
    );
  } catch (e) {
    console.error("DoerWork update from reject failed:", e);
  }

  // 2) LOGIC: escalate exactly like a "Report this", but from creator side
  try {
    await escalateCreatorReject(ctx, taskId);
  } catch (err) {
    console.error("escalateCreatorReject top-level error:", err);
  }
});


// Disabled handlers for the new revision buttons to swallow extra clicks.
bot.action('_DISABLED_APPROVE_REVISION', async (ctx) => {
  await ctx.answerCbQuery();
});
bot.action('_DISABLED_REJECT_REVISION', async (ctx) => {
  await ctx.answerCbQuery();
});







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
