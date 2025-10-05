// models/paymentintent.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PaymentIntentSchema = new Schema({
  user:   { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  draft:  { type: Schema.Types.ObjectId, ref: "TaskDraft", index: true, required: true },
  task:   { type: Schema.Types.ObjectId, ref: "Task", index: true },        // NEW: link to posted task
  amount: { type: Number, required: true }, // birr (human units)
  currency: { type: String, default: "ETB" },
  chapaTxRef: { type: String }, // will hold Chapa tx_ref when we have it

  status: { type: String, enum: ["pending", "paid", "failed"], default: "pending", index: true },
  provider: { type: String, default: "telegram_chapa" },
  payload: { type: String, unique: true, required: true }, // invoice payload
  minorTotal: Number, // Telegram's smallest units
  provider_payment_charge_id: String,
  paidAt: Date,
  refundStatus: { type: String, enum: ["none","requested","succeeded","failed"], default: "none", index: true }, // NEW
  refundedAt: Date,  
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.models.PaymentIntent || mongoose.model("PaymentIntent", PaymentIntentSchema);
