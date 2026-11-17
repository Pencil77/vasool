// Single source of truth for Super Admin identity across models, routes, and the debt engine.
// Override with a comma-separated SUPER_ADMIN_EMAILS environment variable if needed.
const DEFAULT_SUPER_ADMIN_EMAILS = ['mdzubair7592@gmail.com', 'mrzoromit3@gmail.com'];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS
  ? String(process.env.SUPER_ADMIN_EMAILS).split(',')
  : DEFAULT_SUPER_ADMIN_EMAILS
).map(normalizeEmail).filter(Boolean);

const SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0];

function isSuperAdminEmail(email) {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(normalizeEmail(email));
}

module.exports = {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_EMAILS,
  isSuperAdminEmail,
  normalizeEmail
};
