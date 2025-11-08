// models/paymentintent.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PaymentIntentSchema = new Schema({
  user:   { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },

  // NEW: make punishment vs escrow explicit
  type:   { type: String, enum: ["escrow", "punishment"], default: "escrow", index: true },

  // Only required for the escrow/posting flow, not for punishment
  draft: {
    type: Schema.Types.ObjectId,
    ref: "TaskDraft",
    required: function () { return this.type === "escrow"; }
  },

  // Link to a posted task (used by punishment flow + audits)
  task:   { type: Schema.Types.ObjectId, ref: "Task", index: true },

  amount:   { type: Number, required: true }, // birr (human units)
  currency: { type: String, default: "ETB" },

  // Keep both for compatibility; your code references these in different places
  chapaTxRef: { type: String },   // legacy/find-by-ref
  reference:  { type: String },   // you set this for punishment: `punish_<id>`
  checkoutUrl:{ type: String },   // hosted checkout URL (punishment + escrow)

  status: { type: String, enum: ["pending", "paid", "failed", "voided"], default: "pending", index: true },
  provider: { type: String, default: "telegram_chapa" },

  // Only required for escrow (Telegram invoice payload)
  payload: {
    type: String,
    required: function () { return this.type === "escrow"; }
  },

  minorTotal: Number,
  provider_payment_charge_id: String,
  paidAt: Date,

  // Refund tracking for escrow
  refundStatus: { type: String, enum: ["none","requested","succeeded","failed"], default: "none", index: true },
  refundedAt: Date,

  // For invalidating old unpaid punishment sessions safely
  voidedAt: Date,

  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.models.PaymentIntent || mongoose.model("PaymentIntent", PaymentIntentSchema);
