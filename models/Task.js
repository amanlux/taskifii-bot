// models/Task.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * ApplicantSchema
 *  - user   : ObjectId (ref "User", required)
 *  - coverText: String (required)
 *  - file   : String (URL or file ID; optional)
 *  - status : String (enum ["Pending","Accepted","Declined"], default "Pending")
 */
const ApplicantSchema = new Schema({
  user:      { type: Schema.Types.ObjectId, ref: "User", required: true },
  coverText: { type: String, required: true },
  file:      { type: String, default: null },
  status:    { type: String, enum: ["Pending", "Accepted", "Declined"], default: "Pending" },
});

/**
 * StageSchema
 *  - stageNum : Number (e.g. 1,2,3; required)
 *  - percent  : Number (e.g. 30 for 30%; required)
 *  - delivered: Boolean (default false)
 *  - paid     : Boolean (default false)
 *  - deliveredAt: Date (optional)
 *  - paidAt   : Date (optional)
 */
const StageSchema = new Schema({
  stageNum:    { type: Number, required: true },
  percent:     { type: Number, required: true },
  delivered:   { type: Boolean, default: false },
  paid:        { type: Boolean, default: false },
  deliveredAt: { type: Date },
  paidAt:      { type: Date },
});

/**
 * TaskSchema
 *
 * Fields:
 *  - creator         : ObjectId (ref "User", required)
 *  - description     : String (required, min 20, max 1250)
 *  - relatedFile     : String (URL or file ID; optional)
 *  - fields          : [String] (hashtags or field names; default [])
 *  - skillLevel      : String (enum ["Beginner","Intermediate","Professional"], required)
 *  - paymentFee      : Number (in birr; required)
 *  - timeToComplete  : Number (hours; required)
 *  - revisionTime    : Number (hours; required)
 *  - latePenalty     : Number (birr/hour; required)
 *  - expiry          : Date (when the “Apply” expires; required)
 *  - exchangeStrategy: String (enum ["100%","30:40:30","50:50"], required)
 *  - status          : String (enum ["Open","Taken","Canceled","Completed"], default "Open")
 *  - applicants      : [ApplicantSchema] (default [])
 *  - acceptedDoer    : ObjectId (ref "User"; default null)
 *  - stages          : [StageSchema] (default [])
 *  - createdAt, updatedAt (timestamps)
 */
const TaskSchema = new Schema(
  {
    creator:          { type: Schema.Types.ObjectId, ref: "User", required: true },
    description:      { type: String, required: true, minlength: 20, maxlength: 1250 },
    relatedFile:      { type: String, default: null },
    fields:           { type: [String], default: [] },
    skillLevel:       { type: String, enum: ["Beginner", "Intermediate", "Professional"], required: true },
    paymentFee:       { type: Number, required: true },
    timeToComplete:   { type: Number, required: true },   // in hours
    revisionTime:     { type: Number, required: true },   // in hours
    latePenalty:      { type: Number, required: true },   // birr/hour
    expiry:           { type: Date, required: true },
    exchangeStrategy: { type: String, enum: ["100%", "30:40:30", "50:50"], required: true },
    status:           { type: String, enum: ["Open", "Taken", "Canceled", "Completed"], default: "Open" },
    applicants:       { type: [ApplicantSchema], default: [] },
    acceptedDoer:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    stages:           { type: [StageSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Task", TaskSchema);
