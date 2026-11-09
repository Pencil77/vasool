const mongoose = require('mongoose');

const MemberSubSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'owner', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'pending_acceptance', 'rejected'], default: 'pending_acceptance' },
    defaultWeight: { type: Number, default: 1 },
    upiId: { type: String, default: '', trim: true },
    invitedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null }
  },
  { _id: false }
);

const GroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: { type: String, enum: ['Trip', 'Home', 'Couple', 'Project', 'Event', 'Other'], default: 'Trip' },
    currency: { type: String, default: 'INR' },
    inviteCode: { type: String, required: true, unique: true, index: true },
    createdByEmail: { type: String, required: true, lowercase: true },
    adminEmail: { type: String, lowercase: true, trim: true },
    splitsVisibility: { type: String, enum: ['personal_only', 'show_all'], default: 'personal_only' },
    minimizeDebts: { type: Boolean, default: true },
    allowMembersToAddOthers: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    members: { type: [MemberSubSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Group || mongoose.model('Group', GroupSchema);
