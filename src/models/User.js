// models/User.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  telegramId: { type: Number, unique: true, required: true },
  username:   { type: String, unique: true, sparse: true, default: null },
  // NEW: skills (fields) the user is good at – used for recommendations
  skills:         { type: [String], default: [] },

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
      // bank‐details steps
      "bankFirst",        // first bank detail typed
      "bankMulti",        // in “Add/Replace/Done” phase
      "bankAdding",       // after clicking “Add”
      "bankReplacing",    // after clicking “Replace”
      // terms & conditions
      "termsReview",      // after clicking “Done”, review T&C
      "terms",            // accept or reject T&C
      // age verification
      "age",              // click “Yes I am” or “No I’m not”
      // final
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
    totalEarned: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    fieldStats: { type: Object, default: {} } // Tracks frequency of task fields
    
  },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);
