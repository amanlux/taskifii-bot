// models/User.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * BankSchema
 *  - bankName: String (required when adding)
 *  - accountNumber: String (required when adding)
 */
const BankSchema = new Schema({
  bankName:     { type: String, required: true },
  accountNumber: { type: String, required: true },
});

/**
 * StatsSchema
 *  - totalEarned: Number, default 0
 *  - totalSpent: Number, default 0
 *  - averageRating: Number, default 0
 *  - ratingCount: Number, default 0
 */
const StatsSchema = new Schema({
  totalEarned:   { type: Number, default: 0 },
  totalSpent:    { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  ratingCount:   { type: Number, default: 0 },
});

/**
 * UserSchema
 *
 * Fields:
 *  - telegramId       : Number (required, unique)
 *  - username         : String (required, unique)
 *  - fullName         : String (optional, default "")
 *  - phone            : String (optional, default "", unique)
 *  - email            : String (optional, default "", unique)
 *  - bankDetails      : [BankSchema] (default empty array)
 *  - language         : String (enum ["en","am"], optional)
 *  - onboardingStep   : String (enum of steps; default "language")
 *  - stats            : StatsSchema (embed)
 *  - createdAt, updatedAt (timestamps)
 */
const UserSchema = new Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    username:   { type: String, required: true, unique: true },

    // These four are optional at creation; will be filled during onboarding:
    fullName:    { type: String, default: "" },
    phone:       { type: String, default: "", unique: true },
    email:       { type: String, default: "", unique: true },
    bankDetails: { type: [BankSchema], default: [] },

    // Language remains undefined until the user selects "en" or "am":
    language: { type: String, enum: ["en", "am"] },

    // Track which onboarding question the user is on:
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
    timestamps: true, // automatically adds createdAt & updatedAt
  }
);

module.exports = mongoose.model("User", UserSchema);
