const mongoose = require('mongoose');

const PayerAllocationSchema = new mongoose.Schema(
  {
    memberEmail: { type: String, required: true, lowercase: true, trim: true },
    memberName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const SplitAllocationSchema = new mongoose.Schema(
  {
    memberEmail: { type: String, required: true, lowercase: true, trim: true },
    memberName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    percentage: { type: Number, default: 0 },
    shares: { type: Number, default: 1 },
    roundingAdjustment: { type: Number, default: 0 }
  },
  { _id: false }
);

const ExpenseSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'INR' },
    originalAmount: { type: Number, default: null },
    originalCurrency: { type: String, default: 'INR' },
    exchangeRate: { type: Number, default: 1 },
    type: { type: String, enum: ['expense', 'income'], default: 'expense' },
    category: {
      type: String,
      default: '🍔 Food & Dining'
    },
    parentExpenseId: { type: String, default: null },
    parentExpenseDesc: { type: String, default: '' },
    paidByEmail: { type: String, required: true, lowercase: true, trim: true },
    paidByName: { type: String, required: true, trim: true },
    paidByAllocations: { type: [PayerAllocationSchema], default: [] },
    splitType: { type: String, enum: ['equal', 'exact', 'percentage', 'shares'], default: 'equal' },
    splits: { type: [SplitAllocationSchema], required: true },
    roundingRemainder: { type: Number, default: 0 },
    remainderAbsorbedBy: { type: String, default: '' },
    expenseDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
