// models/Task.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ApplicantSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  coverText: { type: String, required: true },
  file: { type: String, default: null },
  status: { 
    type: String, 
    enum: ["Pending", "Accepted", "Declined", "Canceled", "Confirmed"],
    default: "Pending" 
  },
  messageId: { type: Number },
  confirmedAt: { type: Date }, // Add this to track confirmation time
  lastReminderAt: { type: Date }, // Track when last reminder was sent
  createdAt: { type: Date, default: Date.now }
});

const StageSchema = new Schema({
  stageNum: { type: Number, required: true },
  percent: { type: Number, required: true },
  delivered: { type: Boolean, default: false },
  paid: { type: Boolean, default: false },
  deliveredAt: { type: Date },
  paidAt: { type: Date },
});

const TaskSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    description: { type: String, required: true, minlength: 20, maxlength: 1250 },
    relatedFile: { type: Schema.Types.Mixed, default: null },
    fields: { type: [String], default: [] },
    skillLevel: { type: String, enum: ["Beginner", "Intermediate", "Professional"], required: true },
    paymentFee: { type: Number, required: true },
    timeToComplete: { type: Number, required: true },
    revisionTime: { type: Number, required: true },
    latePenalty: { type: Number, required: true },
    expiry: { type: Date, required: true },
    exchangeStrategy: { type: String, enum: ["100%", "30:40:30", "50:50"], required: true },
    status: { 
      type: String, 
      enum: ["Open", "Taken", "Canceled",  "InProgress", "Completed", "Expired", "PendingConfirmation"], // Added "Expired"
      default: "Open" 
    },
    applicants: { type: [ApplicantSchema], default: [] },
    acceptedDoer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    stages: { type: [StageSchema], default: [] },
    channelMessageId: { type: Number },
    lastReminderSent: { type: Date },
    postedAt: { type: Date, default: Date.now },
    reminderSent: { type: Boolean, default: false },
    confirmationMessageId: { type: Number, default: null },
    canceledAt: { type: Date, default: null },
    repostNotified: { type: Boolean, default: false },
    menuAccessNotified: { type: Boolean, default: false },
    decisionsLockedAt: { type: Date, default: null },
    
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);