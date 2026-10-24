const mongoose = require('mongoose');

const SplitAllocationSchema = new mongoose.Schema(
  {
    memberEmail: { type: String, required: true, lowercase: true, trim: true },
    memberName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    percentage: { type: Number, default: 0 },
    shares: { type: Number, default: 1 }
  },
  { _id: false }
);

const ExpenseSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'INR' },
    type: { type: String, enum: ['expense', 'income'], default: 'expense' },
    category: {
      type: String,
      default: '🍔 Food & Dining'
    },
    paidByEmail: { type: String, required: true, lowercase: true, trim: true },
    paidByName: { type: String, required: true, trim: true },
    splitType: { type: String, enum: ['equal', 'exact', 'percentage', 'shares'], default: 'equal' },
    splits: { type: [SplitAllocationSchema], required: true },
    expenseDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
