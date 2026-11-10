const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    sessionDurationValue: { type: Number, default: 7 },
    sessionDurationUnit: { type: String, enum: ['hours', 'days'], default: 'days' },
    sessionDurationString: { type: String, default: '7d' }, // '7d', '14d', '30d', etc.
    description: { type: String, default: 'Global application session timeout and security settings' },
    updatedByEmail: { type: String, default: 'system' }
  },
  { timestamps: true }
);

module.exports = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);
