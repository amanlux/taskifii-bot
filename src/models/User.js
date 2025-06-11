// models/User.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  telegramId: { type: Number, unique: true, required: true },
  username:   { type: String, unique: true, sparse: true, default: null },

  // ─── Onboarding Flow State ──────────────────────────────────────
  onboardingStep: {
    type: String,
    enum: [
      "language",         // initial language selection
      "setupProfile",     // after language, before full name
      "fullName",         // enter full name
      "phone",            // enter phone
      "email",            // enter email
      "usernameConfirm",  // click “Yes, keep it” or type new one
      // your bank steps:
      "bankFirst",        // first bank detail typed
      "bankMulti",        // in “add/replace/done” phase
      "bankAdding",       // after clicking “Add”
      "bankReplacing",    // after clicking “Replace”
      "termsReview",      // after clicking “Done”, review terms
      "terms",            // accept terms
      "ageVerify",        // enter age or verify
      "completed"         // onboarding finished
    ],
    default: "language"
  },

  language:    { type: String, enum: ["en", "am"], default: "en" },
  fullName:    { type: String, default: null },
  phone:       { type: String, unique: true, sparse: true, default: null },
  email:       { type: String, unique: true, sparse: true, default: null },
  bankDetails: {
    type: [
      {
        bankName:      { type: String },
        accountNumber: { type: String }
      }
    ],
    default: []
  },
  stats: {
    totalEarned:   { type: Number, default: 0 },
    totalSpent:    { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 }
  },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);
