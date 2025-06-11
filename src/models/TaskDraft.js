// src/models/TaskDraft.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const taskDraftSchema = new Schema({
  creatorTelegramId: { type: Number, required: true, index: true },
  description:       { type: String, default: null },
  relatedFile: {
    fileId:          { type: String, default: null },
    fileType:        { type: String, default: null }
  },
  fields:            { type: [String], default: [] },
  skillLevel:        { type: String, enum: ["Beginner","Intermediate","Professional", null], default: null },
  paymentFee:        { type: Number, default: null },
  timeToComplete:    { type: Number, default: null },
  revisionTime:      { type: Number, default: null },
  penaltyPerHour:    { type: Number, default: null },
  expiryHours:       { type: Number, default: null },
  exchangeStrategy:  { type: String, enum: ["100%","30:40:30","50:50", null], default: null },
  createdAt:         { type: Date, default: Date.now }
});



module.exports = mongoose.model("TaskDraft", taskDraftSchema);
