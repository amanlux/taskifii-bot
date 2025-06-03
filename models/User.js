// models/User.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

// We’ll capture:
// - telegramId: the user’s unique Telegram ID (Number, required, unique)
// - username: their @username (String, required, unique)
// - fullName: their “Full Name” string (String, required)
// - phone: their phone number (String, required, unique)
// - email: their email (String, required, unique)
// - bankDetails: array of { bankName, accountNumber } objects
// - language: “en” or “am” (String, required)
// - stats: embedded subdoc for totalEarned, totalSpent, averageRating, ratingCount
// - createdAt, updatedAt: timestamps

const BankSchema = new Schema({
  bankName: { type: String, required: true },
  accountNumber: { type: String, required: true },
});

const StatsSchema = new Schema({
  totalEarned: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
});

const UserSchema = new Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    bankDetails: { type: [BankSchema], default: [] },
    language: { type: String, enum: ["en", "am"], required: true },
    // NEW: track which question the user is on
    onboardingStep: {
      type: String,
      enum: [
        "language",
        "fullName",
        "phone",
        "email",
        "usernameConfirm",
        "bankEntry",
        "ageVerify",
        "completed"
      ],
      default: "language"
    },

    stats: { type: StatsSchema, default: () => ({}) },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", UserSchema);
