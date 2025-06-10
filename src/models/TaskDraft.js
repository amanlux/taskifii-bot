// src/models/TaskDraft.js
const taskDraftSchema = new Schema({
  creatorTelegramId: { type: Number, required: true, index: true },
  description:       { type: String, default: null },
  relatedFile: {
    fileId:          { type: String, default: null },
    fileType:        { type: String, default: null }
  },
  fields:            { type: [String], default: [] },
  // Change skillLevel default to undefined, allow absence until set
  skillLevel:        { type: String, enum: ["Beginner","Intermediate","Professional"], default: undefined },
  paymentFee:        { type: Number, default: null },
  timeToComplete:    { type: Number, default: null },
  revisionTime:      { type: Number, default: null },
  penaltyPerHour:    { type: Number, default: null },
  expiryHours:       { type: Number, default: null },
  // Change exchangeStrategy default to undefined
  exchangeStrategy:  { type: String, enum: ["100%","30:40:30","50:50"], default: undefined },
  createdAt:         { type: Date, default: Date.now }
});



