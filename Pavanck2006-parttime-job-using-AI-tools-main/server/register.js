/**
 * PARTTIME JOB PLATFORM — MULTI-STEP REGISTRATION SERVICE
 *
 * Steps: Account Type → Personal Info → Email OTP → Account Created
 * Pending registration data is stored server-side until email verification.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {collection, insertDocument, transaction} = require('./db');
const otpService = require('./otp');

// ─── Configuration ──────────────────────────────────────────────────────────

const REGISTRATION_EXPIRY_HOURS = 24; // pending registration expires after 24h
const EMAIL_PURPOSE = 'email_registration';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateRegToken() {
  return crypto.randomBytes(32).toString('hex');
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) return local[0] + '***@' + domain;
  return local[0] + '***' + local.slice(-1) + '@' + domain;
}

function parseExpiresAt(dateVal) {
  if (!dateVal) return 0;
  if (dateVal instanceof Date) return dateVal.getTime();
  const s = String(dateVal).trim();
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

/**
 * Normalize a phone number to E.164 for consistent account contact details.
 * Indian inputs all become +91XXXXXXXXXX:
 *   9876543210 / 0 98765 43210 / 91 9876543210 / +91 98765 43210
 * Other already-international numbers just get a leading '+'. Numbers that
 * already carry a country code are never double-prefixed.
 */
function normalizeIndianPhone(raw) {
  if (!raw) return raw;
  let p = String(raw).replace(/[\s\-().]/g, '');
  if (/^0\d{10}$/.test(p)) p = '+91' + p.slice(1);            // 0XXXXXXXXXX → +91
  else if (/^91\d{10}$/.test(p)) p = '+' + p;                 // 91XXXXXXXXXX → +91…
  else if (/^\+91\d{10}$/.test(p)) { /* already E.164 */ }
  else if (/^\d{10}$/.test(p)) p = '+91' + p;                 // bare 10-digit mobile
  else if (!p.startsWith('+') && /^\d{8,15}$/.test(p)) p = '+' + p; // other country
  return p;
}

// ─── Registration Flow ──────────────────────────────────────────────────────

/**
 * Step 1-2: Start registration — validates info, creates pending record.
 */
async function startRegistration(data, clientIp) {
  const { role, fullName, email, phone, password, ...profileData } = data;

  // Validate required fields
  if (!role || !['ROLE_STUDENT', 'ROLE_OWNER'].includes(role)) {
    return { success: false, message: 'Valid role (student or owner) is required', status: 400 };
  }
  if (!fullName || fullName.trim().length < 2) {
    return { success: false, message: 'Full name is required', status: 400 };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, message: 'Enter a valid email address', status: 400 };
  }
  const candidatePhone = normalizeIndianPhone(phone);
  if (!phone || !/^\+\d{8,15}$/.test(candidatePhone)) {
    return { success: false, message: 'Enter a valid phone number (e.g. 9876543210 or +91 9876543210)', status: 400 };
  }
  if (!password || password.length < 6) {
    return { success: false, message: 'Password must be at least 6 characters', status: 400 };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = candidatePhone;

  // Check for existing email
  const existingEmail = await collection('users').findOne({email: normalizedEmail}, {projection: {id: 1}});
  if (existingEmail) return { success: false, message: 'An account with this email already exists', status: 409 };

  // Check for existing phone
  const existingPhone = await collection('users').findOne({phone: normalizedPhone}, {projection: {id: 1}});
  if (existingPhone) return { success: false, message: 'An account with this phone number already exists', status: 409 };

  // Check for pending registration with same email
  const pendingEmail = await collection('pending_registrations').findOne({email: normalizedEmail, status: 'pending'});
  if (pendingEmail) {
    // Update existing pending registration
    const passwordHash = await bcrypt.hash(password, 10);
    const expiresAt = new Date(Date.now() + REGISTRATION_EXPIRY_HOURS * 3600 * 1000).toISOString();
    await collection('pending_registrations').updateOne(
      {id: pendingEmail.id},
      {$set: {
        role, full_name: fullName.trim(), phone: normalizedPhone, password_hash: passwordHash,
        college_name: profileData.collegeName || null, preferred_area: profileData.preferredArea || null,
        skills: profileData.skills || null, bio: profileData.bio || null,
        emergency_contact: profileData.emergencyContact || null,
        catering_name: profileData.cateringName || null, business_address: profileData.businessAddress || null,
        business_phone: profileData.businessPhone || null, email_verified: false,
        current_step: 'email', status: 'pending', expires_at: expiresAt, updated_at: new Date().toISOString()
      }}
    );
    // Invalidate old OTPs
    await collection('otp_verifications').updateMany(
      {email: pendingEmail.token, purpose: {$in: [EMAIL_PURPOSE, 'phone_registration']}},
      {$set: {is_used: true, updated_at: new Date().toISOString()}}
    );
    return {
      success: true,
      registrationToken: pendingEmail.token,
      maskedEmail: maskEmail(normalizedEmail),
      message: 'Registration information saved. Please verify your email address.',
      currentStep: 'email'
    };
  }

  // Create new pending registration
  const token = generateRegToken();
  const passwordHash = await bcrypt.hash(password, 10);
  const expiresAt = new Date(Date.now() + REGISTRATION_EXPIRY_HOURS * 3600 * 1000).toISOString();

  await insertDocument('pending_registrations', {
    token, role, full_name: fullName.trim(), email: normalizedEmail, phone: normalizedPhone,
    password_hash: passwordHash, college_name: profileData.collegeName || null,
    preferred_area: profileData.preferredArea || null, skills: profileData.skills || null,
    bio: profileData.bio || null, emergency_contact: profileData.emergencyContact || null,
    catering_name: profileData.cateringName || null, business_address: profileData.businessAddress || null,
    business_phone: profileData.businessPhone || null, current_step: 'email', status: 'pending',
    email_verified: false, expires_at: expiresAt
  });

  return {
    success: true,
    registrationToken: token,
    maskedEmail: maskEmail(normalizedEmail),
    message: 'Registration information saved. Please verify your email address.',
    currentStep: 'email'
  };
}

/**
 * Send an email OTP for registration.
 */
async function sendEmailVerification(registrationToken) {
  const pending = await collection('pending_registrations').findOne({token: registrationToken, status: 'pending'});
  if (!pending) return { success: false, message: 'Invalid or expired registration session', status: 400 };
  if (pending.expires_at && parseExpiresAt(pending.expires_at) < Date.now()) {
    await collection('pending_registrations').updateOne(
      {id: pending.id}, {$set: {status: 'expired', updated_at: new Date().toISOString()}}
    );
    return { success: false, message: 'Registration session has expired. Please start again.', status: 400 };
  }

  const senderEmail = process.env.SMTP_FROM;
  if (!senderEmail || !process.env.SMTP_HOST) {
    return { success: false, message: 'Email service is not configured. Please contact the administrator.', status: 503 };
  }

  const senderName = process.env.SMTP_SENDER_NAME || 'PartTime Job';
  const code = otpService.generateOtpCode();
  const otpHash = await otpService.hashOtp(code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Invalidate previous email OTPs for this registration
  await collection('otp_verifications').updateMany(
    {email: pending.token, purpose: EMAIL_PURPOSE, is_verified: false, is_used: false},
    {$set: {is_used: true, updated_at: new Date().toISOString()}}
  );

  await insertDocument('otp_verifications', {
    email: pending.token, otp_hash: otpHash, purpose: EMAIL_PURPOSE,
    expires_at: expiresAt, attempts: 0, max_attempts: 5, is_verified: false, is_used: false
  });

  // Send email using the existing OTP service
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });

    await transporter.sendMail({
      from: senderEmail,
      to: pending.email,
      subject: `Verify Your Email — ${senderName}`,
      html: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">✉️</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Verify Your Email</h1>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#334155;font-size:15px;margin:0 0 16px;">Welcome to <strong>${senderName}</strong>! Confirm your email address.</p>
      <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
        <div style="font-size:36px;font-weight:800;letter-spacing:12px;color:#4f46e5;font-family:monospace;">${code}</div>
      </div>
      <p style="color:#64748b;font-size:13px;margin:0 0 8px;">⏱ Expires in <strong>5 minutes</strong></p>
      <p style="color:#64748b;font-size:13px;margin:0;">🔒 Do not share this code with anyone.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`
    });
  } catch (e) {
    console.error('[REGISTRATION] Email send failed:', e.message);
    return { success: false, message: 'Failed to send verification email. Please try again.', status: 503 };
  }

  await collection('pending_registrations').updateOne(
    {id: pending.id}, {$set: {current_step: 'email', updated_at: new Date().toISOString()}}
  );

  return {
    success: true,
    maskedEmail: maskEmail(pending.email),
    expiresIn: 300,
    message: 'Verification code sent to your email'
  };
}

/**
 * Step 4b: Verify email OTP
 */
async function verifyEmailOtp(registrationToken, otp) {
  if (!otp || !/^\d{6}$/.test(otp)) {
    return { success: false, message: 'Enter the complete 6-digit code', status: 400 };
  }

  const pending = await collection('pending_registrations').findOne({token: registrationToken, status: 'pending'});
  if (!pending) return { success: false, message: 'Invalid or expired registration session', status: 400 };
  if (pending.expires_at && parseExpiresAt(pending.expires_at) < Date.now()) {
    await collection('pending_registrations').updateOne(
      {id: pending.id}, {$set: {status: 'expired', updated_at: new Date().toISOString()}}
    );
    return { success: false, message: 'Registration session has expired. Please start again.', status: 400 };
  }

  const otpRecord = await collection('otp_verifications').findOne(
    {email: pending.token, purpose: EMAIL_PURPOSE, is_verified: false, is_used: false},
    {sort: {created_at: -1}}
  );

  if (!otpRecord) return { success: false, message: 'No active verification code. Request a new one.', status: 400 };
  if (parseExpiresAt(otpRecord.expires_at) < Date.now()) {
    return { success: false, message: 'Verification code has expired. Request a new one.', status: 400 };
  }
  if (otpRecord.attempts >= otpRecord.max_attempts) {
    return { success: false, message: 'Too many incorrect attempts. Request a new code.', status: 429 };
  }

  const matches = await otpService.verifyOtpHash(otp, otpRecord.otp_hash);
  if (!matches) {
    await collection('otp_verifications').updateOne(
      {id: otpRecord.id}, {$inc: {attempts: 1}, $set: {updated_at: new Date().toISOString()}}
    );
    return { success: false, message: 'Incorrect verification code', status: 400 };
  }

  await collection('otp_verifications').updateOne(
    {id: otpRecord.id}, {$set: {is_verified: true, is_used: true, updated_at: new Date().toISOString()}}
  );
  await collection('pending_registrations').updateOne(
    {id: pending.id}, {$set: {email_verified: true, current_step: 'complete', updated_at: new Date().toISOString()}}
  );

  return { success: true, message: 'Email verified successfully. Click "Complete Registration" to create your account.' };
}

/**
 * Step 5: Complete registration — create the actual user account.
 * Only succeeds after the email address has been verified.
 */
async function completeRegistration(registrationToken) {
  const pending = await collection('pending_registrations').findOne({token: registrationToken, status: 'pending'});
  if (!pending) return { success: false, message: 'Invalid or expired registration session', status: 400 };
  if (pending.expires_at && parseExpiresAt(pending.expires_at) < Date.now()) {
    await collection('pending_registrations').updateOne(
      {id: pending.id}, {$set: {status: 'expired', updated_at: new Date().toISOString()}}
    );
    return { success: false, message: 'Registration session has expired. Please start again.', status: 400 };
  }

  if (!pending.email_verified) {
    return { success: false, message: 'Verify your email before completing registration', status: 400 };
  }

  // Create the user account in a transaction
  try {
    const result = await transaction(async session => {
      const user = await insertDocument('users', {
        email: pending.email, password_hash: pending.password_hash, full_name: pending.full_name,
        phone: pending.phone, role: pending.role, is_active: true, is_suspended: false
      }, session);

      if (pending.role === 'ROLE_STUDENT') {
        await insertDocument('student_profiles', {
          user_id: user.id, college_name: pending.college_name || null, preferred_area: pending.preferred_area || null,
          skills: pending.skills || null, bio: pending.bio || null, emergency_contact: pending.emergency_contact || null,
          total_jobs_completed: 0, rating: 5
        }, session);
      } else {
        await insertDocument('owner_profiles', {
          user_id: user.id, catering_name: pending.catering_name || pending.full_name,
          business_address: pending.business_address || null, business_phone: pending.business_phone || pending.phone,
          verification_status: 'PENDING_VERIFICATION', total_jobs_posted: 0
        }, session);
      }

      const now = new Date().toISOString();
      await collection('pending_registrations').updateOne(
        {id: pending.id}, {$set: {status: 'completed', updated_at: now}}, {session}
      );
      await collection('otp_verifications').updateMany(
        {email: pending.token, purpose: {$in: [EMAIL_PURPOSE, 'phone_registration']}},
        {$set: {is_used: true, updated_at: now}}, {session}
      );
      await collection('otp_verifications').updateMany(
        {email: pending.token, purpose: EMAIL_PURPOSE, is_verified: true},
        {$set: {email: pending.email, updated_at: now}}, {session}
      );
      return user;
    });

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    const SECRET = process.env.JWT_SECRET || 'development-secret-change-me';
    const jwtToken = jwt.sign({ id: result.id, role: result.role }, SECRET, { expiresIn: '7d' });

    return {
      success: true,
      token: jwtToken,
      type: 'Bearer',
      id: result.id,
      email: result.email,
      fullName: result.full_name,
      phone: result.phone,
      role: result.role,
      active: !!result.is_active,
      suspended: !!result.is_suspended,
      message: 'Registration successful! Welcome to PartTime Job.'
    };
  } catch (e) {
    if (e.code === 11000) {
      return { success: false, message: 'Email or phone is already registered', status: 409 };
    }
    console.error('[REGISTRATION] Account creation failed:', e.message);
    return { success: false, message: 'Registration failed. Please try again.', status: 500 };
  }
}

/**
 * Get registration status
 */
async function getRegistrationStatus(registrationToken) {
  const pending = await collection('pending_registrations').findOne(
    {token: registrationToken},
    {projection: {token: 1, role: 1, email_verified: 1, current_step: 1, status: 1, email: 1}}
  );
  if (!pending) return null;
  return {
    role: pending.role,
    emailVerified: !!pending.email_verified,
    currentStep: pending.current_step,
    status: pending.status,
    maskedEmail: maskEmail(pending.email)
  };
}

/**
 * Resend email OTP
 */
async function resendEmailOtp(registrationToken) {
  return sendEmailVerification(registrationToken);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  startRegistration,
  sendEmailVerification,
  verifyEmailOtp,
  completeRegistration,
  getRegistrationStatus,
  resendEmailOtp
};
