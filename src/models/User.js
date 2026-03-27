// models/User.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  telegramId: { type: Number, unique: true, required: true },

  username: { type: String, default: undefined, trim: true },
  phone:    { type: String, default: undefined, trim: true },
  email:    { type: String, default: undefined, trim: true, lowercase: true },

  skills: { type: [String], default: [] },

  onboardingStep: {
    type: String,
    enum: [
      "language",
      "setupProfile",
      "fullName",
      "phone",
      "email",
      "usernameConfirm",
      "skillsSelect",
      "bankFirst",
      "bankMulti",
      "bankAdding",
      "bankReplacing",
      "termsReview",
      "terms",
      "age",
      "completed"
    ],
    default: "language"
  },

  language: { type: String, enum: ["en", "am"], default: "en" },
  fullName: { type: String, default: null },

  bankDetails: {
    type: [
      {
        bankName: { type: String },
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
    fieldStats: { type: Object, default: {} }
  },

  createdAt: { type: Date, default: Date.now }
});

// Only real non-empty strings must be unique
UserSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: {
      username: { $exists: true, $gt: "" }
    }
  }
);

UserSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $exists: true, $gt: "" }
    }
  }
);

UserSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $gt: "" }
    }
  }
);

module.exports =
  mongoose.models.User || mongoose.model("User", UserSchema);