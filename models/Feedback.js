const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    userEmail: { type: String, default: null },
    userName: { type: String, default: null },
    type: {
      type: String,
      enum: ['bug', 'feature', 'general', 'ux'],
      default: 'general'
    },
    rating: { type: Number, min: 1, max: 5, default: null },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    page: { type: String, default: null },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'in_progress', 'resolved'],
      default: 'new'
    },
    adminNotes: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Feedback || mongoose.model('Feedback', FeedbackSchema);
