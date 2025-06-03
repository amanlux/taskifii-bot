// models/Task.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

// We’ll capture:
// - creator: ObjectId ref to User
// - description: String (required)
// - relatedFile: String (URL or file ID) or null
// - fields: [String] (array of hashtags or field names)
// - skillLevel: String enum ["Beginner", "Intermediate", "Professional"]
// - paymentFee: Number (Birr)
// - timeToComplete: Number (hours)
// - revisionTime: Number (hours)
// - latePenalty: Number (Birr/hour)
// - expiry: Date (when “Apply” expires)
// - exchangeStrategy: String enum ["100%", "30:40:30", "50:50"]
// - status: String enum ["Open", "Taken", "Canceled", "Completed"]
// - applicants: [ { user: ObjectId, coverText: String, file: String, status: "Pending"|"Accepted"|"Declined" } ]
// - acceptedDoer: ObjectId ref to User (nullable until accepted)
// - stages: subdoc array tracking multi‐stage progress and payments
// - createdAt, updatedAt

const ApplicantSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  coverText: { type: String, required: true },
  file: { type: String, default: null },
  status: { type: String, enum: ["Pending", "Accepted", "Declined"], default: "Pending" },
});

const StageSchema = new Schema({
  stageNum: { type: Number, required: true }, // e.g., 1, 2, 3
  percent: { type: Number, required: true }, // e.g., 30 for first stage
  delivered: { type: Boolean, default: false },
  paid: { type: Boolean, default: false },
  deliveredAt: { type: Date },
  paidAt: { type: Date },
});

const TaskSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    description: { type: String, required: true, minlength: 20, maxlength: 1250 },
    relatedFile: { type: String, default: null }, // could store a file ID or URL
    fields: { type: [String], default: [] }, // e.g. ["#design", "#writing"]
    skillLevel: { type: String, enum: ["Beginner", "Intermediate", "Professional"], required: true },
    paymentFee: { type: Number, required: true },
    timeToComplete: { type: Number, required: true },
    revisionTime: { type: Number, required: true },
    latePenalty: { type: Number, required: true },
    expiry: { type: Date, required: true },
    exchangeStrategy: { type: String, enum: ["100%", "30:40:30", "50:50"], required: true },
    status: { type: String, enum: ["Open", "Taken", "Canceled", "Completed"], default: "Open" },
    applicants: { type: [ApplicantSchema], default: [] },
    acceptedDoer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    stages: { type: [StageSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Task", TaskSchema);
