/**
 * PARTTIME JOB PLATFORM — OTP VERIFICATION SERVICE
 *
 * Database-backed OTP system with:
 * - bcrypt-hashed OTP storage
 * - 5-minute expiry
 * - 5 max verification attempts
 * - 60-second resend cooldown
 * - Per-email and per-IP rate limiting
 * - Purpose-based (registration, password_reset, etc.)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {collection, insertDocument, toId} = require('./db');

// ─── Configuration ────────────────────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_OTPS_PER_EMAIL = 5;     // max OTP requests per email in window
const MAX_OTPS_PER_IP = 10;       // max OTP requests per IP in window

// In-memory store for IP rate limiting and resend cooldowns
// Key: email → lastSentAt timestamp
const resendCooldowns = new Map();
// Key: ip → [{ timestamp }] (sliding window)
const ipRateLimits = new Map();

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, entries] of ipRateLimits) {
    const valid = entries.filter(t => t > cutoff);
    if (valid.length === 0) ipRateLimits.delete(key);
    else ipRateLimits.set(key, valid);
  }
}, 5 * 60 * 1000);

// ─── OTP Generation ───────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 6-digit OTP.
 * @returns {string} 6-digit OTP string
 */
function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

// ─── OTP Hashing ──────────────────────────────────────────────────────────────

/**
 * Hash an OTP code using bcrypt (cost factor 10).
 * @param {string} code - Plain text OTP
 * @returns {Promise<string>} Bcrypt hash
 */
async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

/**
 * Constant-time-safe comparison of OTP with stored hash.
 * @param {string} code - Plain text OTP attempt
 * @param {string} hash - Bcrypt hash from database
 * @returns {Promise<boolean>} Whether the code matches
 */
async function verifyOtpHash(code, hash) {
  return bcrypt.compare(code, hash);
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Check if an IP has exceeded the rate limit for OTP requests.
 * @param {string} ip - Client IP address
 * @returns {boolean} True if rate limited
 */
function isIpRateLimited(ip) {
  const now = Date.now();
  const entries = ipRateLimits.get(ip) || [];
  const valid = entries.filter(t => t > now - RATE_LIMIT_WINDOW_MS);
  return valid.length >= MAX_OTPS_PER_IP;
}

function recordIpRequest(ip) {
  const now = Date.now();
  const entries = ipRateLimits.get(ip) || [];
  entries.push(now);
  ipRateLimits.set(ip, entries);
}

/**
 * Check if resend cooldown is active for an email.
 * @param {string} email
 * @returns {number} Seconds remaining (0 if not on cooldown)
 */
function getResendCooldown(email) {
  const lastSent = resendCooldowns.get(email);
  if (!lastSent) return 0;
  const elapsed = Math.floor((Date.now() - lastSent) / 1000);
  const remaining = RESEND_COOLDOWN_SECONDS - elapsed;
  return remaining > 0 ? remaining : 0;
}

function setResendCooldown(email) {
  resendCooldowns.set(email, Date.now());
}

// ─── Email count rate limiting (per email) ────────────────────────────────────

async function countRecentOtps(email) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  return collection('otp_verifications').countDocuments({email, created_at: {$gt: since}});
}

// ─── Core OTP Operations ──────────────────────────────────────────────────────

/**
 * Create and send an OTP for the given email and purpose.
 *
 * @param {string} email - Target email address
 * @param {string} purpose - OTP purpose (e.g. 'registration', 'password_reset')
 * @param {string} ip - Client IP for rate limiting
 * @param {string} [templateFn] - Optional function(code, expiryMinutes) => { subject, html }
 * @returns {Promise<{ success: boolean, expiresIn: number, message: string }>}
 */
async function sendOtp(email, purpose, ip, templateFn) {
  const normalizedEmail = email.trim().toLowerCase();

  // Validate email format
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { success: false, message: 'Enter a valid email address', status: 400 };
  }

  // Check IP rate limit
  if (isIpRateLimited(ip)) {
    return { success: false, message: 'Too many requests. Please try again later.', status: 429 };
  }

  // Check per-email rate limit
  const recentCount = await countRecentOtps(normalizedEmail);
  if (recentCount >= MAX_OTPS_PER_EMAIL) {
    return { success: false, message: 'Please wait before requesting another OTP.', status: 429 };
  }

  // Check resend cooldown
  const cooldown = getResendCooldown(normalizedEmail);
  if (cooldown > 0) {
    return { success: false, message: `Please wait ${cooldown} seconds before resending.`, status: 429 };
  }

  // Invalidate any previous active OTPs for this email+purpose
  await collection('otp_verifications').updateMany(
    {email: normalizedEmail, purpose, is_verified: false, is_used: false},
    {$set: {is_used: true, updated_at: new Date().toISOString()}}
  );

  // Generate and hash OTP
  const code = generateOtpCode();
  const otpHash = await hashOtp(code);

  console.log('\n======================================================');
  console.log(`🔑 [OTP CODE]: ${code}  (Email: ${normalizedEmail}, Purpose: ${purpose})`);
  console.log('======================================================\n');

  // Store in database
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const otpRecord = await insertDocument('otp_verifications', {
    email: normalizedEmail,
    otp_hash: otpHash,
    purpose,
    expires_at: expiresAt,
    attempts: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    is_verified: false,
    is_used: false
  });

  // Record rate limits
  recordIpRequest(ip);
  setResendCooldown(normalizedEmail);

  // Send email (caller provides template function, or we use default)
  try {
    await sendEmail(normalizedEmail, code, OTP_EXPIRY_MINUTES, templateFn);
  } catch (emailErr) {
    // Don't expose SMTP details; log server-side only
    console.error('[OTP] Email send failed:', emailErr.message);
    return { success: false, message: 'Failed to send verification email. Please try again.', status: 503 };
  }

  return {
    success: true,
    expiresIn: OTP_EXPIRY_MINUTES * 60,
    devOtp: code,
    message: 'Verification code sent by email'
  };
}

/**
 * Verify an OTP code.
 *
 * @param {string} email - Target email
 * @param {string} purpose - OTP purpose
 * @param {string} code - 6-digit code attempt
 * @returns {Promise<{ success: boolean, message: string, verificationId?: number }>}
 */
async function verifyOtp(email, purpose, code) {
  const normalizedEmail = email.trim().toLowerCase();

  // Validate input
  if (!code || !/^\d{6}$/.test(code)) {
    return { success: false, message: 'OTP must contain exactly 6 digits', status: 400 };
  }

  // Find the latest active OTP
  const otpRecord = await collection('otp_verifications').findOne(
    {email: normalizedEmail, purpose, is_verified: false, is_used: false},
    {sort: {created_at: -1}}
  );

  if (!otpRecord) {
    return { success: false, message: 'No active verification code found. Request a new one.', status: 400 };
  }

  // Check expiry
  const expiresAt = new Date(otpRecord.expires_at).getTime();
  if (expiresAt < Date.now()) {
    return { success: false, message: 'Verification code has expired. Request a new one.', status: 400 };
  }

  // Check attempt count
  if (otpRecord.attempts >= otpRecord.max_attempts) {
    return { success: false, message: 'Too many incorrect attempts. Request a new code.', status: 429 };
  }

  // Verify OTP (constant-time comparison via bcrypt)
  const matches = await verifyOtpHash(code, otpRecord.otp_hash);

  if (!matches) {
    // Increment attempts
    await collection('otp_verifications').updateOne(
      {id: otpRecord.id},
      {$inc: {attempts: 1}, $set: {updated_at: new Date().toISOString()}}
    );
    return { success: false, message: 'Incorrect verification code', status: 400 };
  }

  // Mark as verified and used
  await collection('otp_verifications').updateOne(
    {id: otpRecord.id},
    {$set: {is_verified: true, is_used: true, updated_at: new Date().toISOString()}}
  );

  return {
    success: true,
    message: 'Email verified successfully',
    verificationId: otpRecord.id
  };
}

/**
 * Resend OTP — invalidates previous, generates new one.
 */
async function resendOtp(email, purpose, ip, templateFn) {
  return sendOtp(email, purpose, ip, templateFn);
}

/**
 * Validate that a verification is confirmed (used during registration).
 * @param {number} verificationId - The OTP record ID
 * @param {string} email
 * @param {string} purpose
 * @returns {Promise<boolean>}
 */
async function isVerified(verificationId, email, purpose) {
  if (!verificationId) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return !!(await collection('otp_verifications').findOne({
    id: toId(verificationId), email: normalizedEmail, purpose, is_verified: true, is_used: true
  }, {projection: {_id: 1}}));
}

/**
 * Invalidate a verification record after it's been used (e.g. after registration).
 */
async function invalidateVerification(verificationId) {
  if (!verificationId) return;
  await collection('otp_verifications').updateOne(
    {id: toId(verificationId)},
    {$set: {is_used: true, updated_at: new Date().toISOString()}}
  );
}

// ─── Email Sending ────────────────────────────────────────────────────────────

/**
 * Send OTP email using Nodemailer (already a project dependency).
 */
async function sendEmail(destination, code, expiryMinutes, templateFn) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) {
    throw Object.assign(new Error('Email service is not configured. Add SMTP settings to .env.'), { status: 503 });
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });

  const senderName = process.env.SMTP_SENDER_NAME || 'PartTime Job';

  // Use custom template if provided, otherwise use default HTML template
  let mailOptions;
  if (typeof templateFn === 'function') {
    mailOptions = templateFn(code, expiryMinutes);
    mailOptions.from = process.env.SMTP_FROM;
    mailOptions.to = destination;
  } else {
    mailOptions = {
      from: process.env.SMTP_FROM,
      to: destination,
      subject: `Your ${senderName} Verification Code`,
      html: defaultEmailTemplate(code, expiryMinutes, senderName)
    };
  }

  await transporter.sendMail(mailOptions);
}

/**
 * Default professional HTML email template for OTP.
 */
function defaultEmailTemplate(code, expiryMinutes, senderName) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">📋</div>
      <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Verify Your Email</h1>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#334155;font-size:15px;margin:0 0 16px;">We've sent a 6-digit verification code to your email address.</p>
      <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
        <div style="font-size:36px;font-weight:800;letter-spacing:12px;color:#4f46e5;font-family:monospace;">${code}</div>
      </div>
      <p style="color:#64748b;font-size:13px;margin:0 0 8px;">⏱ This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
      <p style="color:#64748b;font-size:13px;margin:0;">🔒 For your security, do not share this code with anyone.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
    <div style="background:#f8fafc;padding:16px 24px;text-align:center;">
      <p style="color:#94a3b8;font-size:11px;margin:0;">© ${new Date().getFullYear()} ${senderName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
  sendOtp,
  verifyOtp,
  resendOtp,
  isVerified,
  invalidateVerification,
  getResendCooldown,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS
};
