require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {collection, insertDocument, initializeDatabase, toId, transaction} = require('./server/db');
const otpService = require('./server/otp');
const regService = require('./server/register');
const chatRouter = require('./server/chat');
const razorpayRouter = require('./server/razorpay');
const {createOrUpdateTransaction, updateTransactionStatus, getTransactionDetails, getTransactionsList, getTransactionSummary} = require('./server/transactions');
const multer = require('multer');

// File upload config
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, {recursive: true});
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `job-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({
  storage, limits: {fileSize: 5 * 1024 * 1024},
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (JPG, PNG, GIF, WebP) are allowed.'));
  }
});

const app = express();
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.JWT_SECRET || 'development-secret-change-me';
const staticDir = path.join(__dirname, 'src', 'main', 'resources', 'static');


app.use(express.json({limit: '1mb'}));
app.use(express.urlencoded({extended: true}));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ─── STATIC FILES (served before auth so /, /css/*, /js/* work without JWT) ──
app.use(express.static(path.join(__dirname, 'uploads')));
app.use(express.static(staticDir));

const ok = (res, data, message) => res.json({data, ...(message ? {message} : {})});
const fail = (res, status, message) => res.status(status).json({message});
const guard = (...roles) => (req, res, next) => req.user && roles.includes(req.user.role) ? next() : fail(res, 403, 'You do not have permission for this action');

// Wire up auth before DELETE on reports
app.use('/api/reports/:id', (req, res, next) => req.method === 'DELETE' ? auth(req, res, () => guard('ROLE_STUDENT')(req, res, next)) : next());
app.use('/api/chat', auth, chatRouter);
// Razorpay public key endpoint (no auth required)
app.get('/api/public/razorpay-key', (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  ok(res, {apiKey: keyId, configured: !!keyId});
});

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(res, 401, 'Authentication is required');
    const c = jwt.verify(token, SECRET);
    const user = await collection('users').findOne({id: toId(c.id)});
    if (!user || !user.is_active || user.is_suspended) return fail(res, 401, 'Account is inactive or suspended');
    req.user = user;
    next();
  } catch { fail(res, 401, 'Invalid or expired token'); }
}

function token(user, extra = {}) {
  return {
    token: jwt.sign({id: user.id, role: user.role}, SECRET, {expiresIn: '7d'}),
    type: 'Bearer', id: user.id, email: user.email, fullName: user.full_name,
    phone: user.phone, role: user.role, active: !!user.is_active,
    suspended: !!user.is_suspended, ...extra
  };
}

async function sendEmailOtp(destination, code) {
  // Delegate to OTP service which handles Nodemailer
  await otpService.sendEmail(destination, code, otpService.OTP_EXPIRY_MINUTES);
}

// ─── MULTI-STEP REGISTRATION ──────────────────────────────────────────────

app.post('/api/auth/register/start', async (req, res, next) => {
  try {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const result = await regService.startRegistration(req.body, clientIp);
    if (!result.success) return fail(res, result.status || 500, result.message);
    ok(res, {
      registrationToken: result.registrationToken,
      maskedEmail: result.maskedEmail,
      currentStep: result.currentStep
    }, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/register/email/send', async (req, res, next) => {
  try {
    const token = req.body.registrationToken || req.body.token;
    if (!token) return fail(res, 400, 'Registration token is required');
    const result = await regService.sendEmailVerification(token);
    if (!result.success) return fail(res, result.status || 500, result.message);
    ok(res, { maskedEmail: result.maskedEmail, expiresIn: result.expiresIn }, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/register/email/verify', async (req, res, next) => {
  try {
    const token = req.body.registrationToken || req.body.token;
    const otp = req.body.otp;
    if (!token) return fail(res, 400, 'Registration token is required');
    const result = await regService.verifyEmailOtp(token, otp);
    if (!result.success) return fail(res, result.status || 500, result.message);
    ok(res, null, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/register/complete', async (req, res, next) => {
  try {
    const token = req.body.registrationToken || req.body.token;
    if (!token) return fail(res, 400, 'Registration token is required');
    const result = await regService.completeRegistration(token);
    if (!result.success) return fail(res, result.status || 500, result.message);
    const { success, ...authData } = result;
    ok(res, authData, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/register/status', async (req, res, next) => {
  try {
    const token = req.body.registrationToken || req.body.token;
    if (!token) return fail(res, 400, 'Registration token is required');
    const status = await regService.getRegistrationStatus(token);
    if (!status) return fail(res, 404, 'Registration session not found or expired');
    ok(res, status, 'Registration status retrieved');
  } catch (e) { next(e); }
});

app.post('/api/auth/register/resend-email', async (req, res, next) => {
  try {
    const token = req.body.registrationToken || req.body.token;
    if (!token) return fail(res, 400, 'Registration token is required');
    const result = await regService.resendEmailOtp(token);
    if (!result.success) return fail(res, result.status || 500, result.message);
    ok(res, { maskedEmail: result.maskedEmail, expiresIn: result.expiresIn }, result.message);
  } catch (e) { next(e); }
});

// ─── AUTH (Legacy — kept for backward compat) ───────────────────────────────

app.post('/api/auth/request-otp', async (req, res, next) => {
  try {
    const destination = String(req.body.email || '').trim().toLowerCase();
    if (!destination || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return fail(res, 400, 'Enter a valid email address');
    const existing = await collection('users').findOne({email: destination}, {projection: {id: 1}});
    if (existing) return fail(res, 409, 'That email is already registered');
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const result = await otpService.sendOtp(destination, 'registration', clientIp);
    if (!result.success) return fail(res, result.status || 500, result.message);
    // Find the verification ID we just created
    const otpRecord = await collection('otp_verifications').findOne(
      {email: destination, purpose: 'registration'}, {sort: {created_at: -1}, projection: {id: 1}}
    );
    ok(res, {verificationId: otpRecord ? String(otpRecord.id) : '0', expiresInSeconds: result.expiresIn}, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/verify-otp', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address');
    const result = await otpService.verifyOtp(email, 'registration', otp);
    if (!result.success) return fail(res, result.status || 500, result.message);
    ok(res, {verificationId: String(result.verificationId)}, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.fullName || !b.email || !b.password || !b.phone || !['ROLE_STUDENT', 'ROLE_OWNER'].includes(b.role))
      return fail(res, 400, 'Full name, email, password, phone and a valid role are required');
    const destination = String(b.email).trim().toLowerCase();
    // Verify that email was verified via OTP
    const verified = await otpService.isVerified(b.verificationId, destination, 'registration');
    if (!verified)
      return fail(res, 400, 'Verify your email before creating the account');
    // Invalidate the OTP record now that registration is proceeding
    await otpService.invalidateVerification(b.verificationId);
    const data = await transaction(async session => {
      const user = await insertDocument('users', {
        email: b.email.toLowerCase(), password_hash: await bcrypt.hash(b.password, 10),
        full_name: b.fullName, phone: b.phone, role: b.role, is_active: true, is_suspended: false
      }, session);
      if (b.role === 'ROLE_STUDENT') {
        await insertDocument('student_profiles', {
          user_id: user.id, college_name: b.collegeName || null, preferred_area: b.preferredArea || null,
          skills: b.skills || null, bio: b.bio || null, emergency_contact: b.emergencyContact || null,
          total_jobs_completed: 0, rating: 5
        }, session);
      } else {
        await insertDocument('owner_profiles', {
          user_id: user.id, catering_name: b.cateringName || b.fullName,
          business_address: b.businessAddress || null, business_phone: b.businessPhone || b.phone,
          verification_status: 'PENDING_VERIFICATION', total_jobs_posted: 0
        }, session);
      }
      return token(user);
    });
    ok(res, data, 'Registration successful! Welcome to PartTime Job.');
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, 'Email or phone is already registered');
    next(e);
  }
});

app.post('/api/auth/resend-otp', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const purpose = req.body.purpose || 'registration';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address');
    if (purpose === 'registration') {
      const existing = await collection('users').findOne({email}, {projection: {id: 1}});
      if (existing) return fail(res, 409, 'That email is already registered');
    }
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const result = await otpService.resendOtp(email, purpose, clientIp);
    if (!result.success) return fail(res, result.status || 500, result.message);
    const otpRecord = await collection('otp_verifications').findOne(
      {email, purpose}, {sort: {created_at: -1}, projection: {id: 1}}
    );
    ok(res, {verificationId: otpRecord ? String(otpRecord.id) : '0', expiresInSeconds: result.expiresIn}, result.message);
  } catch (e) { next(e); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const u = await collection('users').findOne({email: (req.body.email || '').toLowerCase()});
    if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return fail(res, 401, 'Invalid email or password');
    if (u.is_suspended || !u.is_active) return fail(res, 403, 'Your account is suspended or inactive');
    // Check if email was verified via OTP during registration (skip for admin accounts)
    if (u.role !== 'ROLE_ADMIN') {
      const otpVerified = await collection('otp_verifications').findOne({
        email: u.email, purpose: {$in: ['registration', 'email_registration']}, is_verified: true, is_used: true
      }, {projection: {_id: 1}});
      if (!otpVerified) return fail(res, 403, 'Email verification is required. Please verify your email to continue.');
    }
    let extra = {};
    if (u.role === 'ROLE_STUDENT') {
      const student = await collection('student_profiles').findOne({user_id: u.id});
      extra.preferredArea = student?.preferred_area;
    }
    if (u.role === 'ROLE_OWNER') {
      const owner = await collection('owner_profiles').findOne({user_id: u.id});
      extra = {profileId: owner?.id, cateringName: owner?.catering_name, verificationStatus: owner?.verification_status};
    }
    ok(res, token(u, extra), 'Login successful!');
  } catch (e) { next(e); }
});

// ─── GEOCODING PROXY ───────────────────────────────────────────────────────
app.get('/api/geocode/reverse', async (req, res, next) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return fail(res, 400, 'lat and lon query parameters required');
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'PartTimeJobPlatform/1.0', 'Accept-Language': 'en' }
    });
    if (!resp.ok) return fail(res, 502, 'Geocoding service unavailable');
    const data = await resp.json();
    ok(res, data);
  } catch (e) { next(e); }
});

// ─── JOBS ────────────────────────────────────────────────────────────────────

function jobPipeline(match, sort) {
  return [
    {$match: match},
    {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}},
    {$unwind: '$owner'},
    {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}},
    {$unwind: '$owner_user'},
    {$match: {'owner_user.is_suspended': {$ne: true}}},
    {$set: {catering_name: '$owner.catering_name', verification_status: '$owner.verification_status', owner_user_id: '$owner_user.id', owner_name: '$owner_user.full_name'}},
    {$unset: ['owner', 'owner_user']},
    ...(Object.keys(sort || {}).length ? [{$sort: sort}] : [])
  ];
}

function applicationPipeline(match, sort) {
  return [
    {$match: match},
    {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}},
    {$unwind: '$job'},
    {$lookup: {from: 'owner_profiles', localField: 'job.owner_id', foreignField: 'id', as: 'owner'}},
    {$unwind: '$owner'},
    {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}},
    {$unwind: '$owner_user'},
    {$lookup: {from: 'student_profiles', localField: 'student_id', foreignField: 'id', as: 'student'}},
    {$unwind: '$student'},
    {$lookup: {from: 'users', localField: 'student.user_id', foreignField: 'id', as: 'student_user'}},
    {$unwind: '$student_user'},
    {$set: {
      job_title: '$job.title', work_type: '$job.work_type', work_area: '$job.work_area',
      detailed_location: '$job.detailed_location', job_date: '$job.job_date', start_time: '$job.start_time',
      end_time: '$job.end_time', payment_type: '$job.payment_type', is_on_spot_payment: '$job.is_on_spot_payment',
      contact_phone: '$job.contact_phone', contact_email: '$job.contact_email',
      catering_name: '$owner.catering_name', verification_status: '$owner.verification_status',
      owner_user_id: '$owner_user.id', owner_name: '$owner_user.full_name',
      student_user_id: '$student_user.id', student_name: '$student_user.full_name',
      student_email: '$student_user.email', student_phone: '$student_user.phone',
      college_name: '$student.college_name', skills: '$student.skills',
      student_rating: '$student.rating', total_jobs_completed: '$student.total_jobs_completed'
    }},
    {$unset: ['job', 'owner', 'owner_user', 'student', 'student_user']},
    ...(Object.keys(sort || {}).length ? [{$sort: sort}] : [])
  ];
}

async function fetchJobs(match, sort) {
  return collection('catering_jobs').aggregate(jobPipeline(match, sort)).toArray();
}

async function fetchApplications(match, sort = {created_at: -1}, session) {
  return collection('job_applications').aggregate(
    applicationPipeline(match, sort), session ? {session} : {}
  ).toArray();
}

function paymentPipeline(match, sort = {created_at: -1}, limit) {
  return [
    {$match: match},
    {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}}, {$unwind: {path: '$job', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'student_profiles', localField: 'student_id', foreignField: 'id', as: 'student'}}, {$unwind: {path: '$student', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'student.user_id', foreignField: 'id', as: 'student_user'}}, {$unwind: {path: '$student_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}}, {$unwind: {path: '$owner', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}}, {$unwind: {path: '$owner_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'job_applications', localField: 'application_id', foreignField: 'id', as: 'application'}}, {$unwind: {path: '$application', preserveNullAndEmptyArrays: true}},
    {$set: {
      job_title: '$job.title', work_area: '$job.work_area', work_type: '$job.work_type', job_date: '$job.job_date',
      student_name: '$student_user.full_name', student_email: '$student_user.email', student_phone: '$student_user.phone',
      college_name: '$student.college_name', skills: '$student.skills', student_rating: '$student.rating',
      total_jobs_completed: '$student.total_jobs_completed', owner_name: '$owner_user.full_name',
      owner_email: '$owner_user.email', catering_name: '$owner.catering_name',
      application_status: '$application.status', work_completion_status: '$application.work_completion_status'
    }},
    {$unset: ['job', 'student', 'student_user', 'owner', 'owner_user', 'application']},
    ...(Object.keys(sort || {}).length ? [{$sort: sort}] : []),
    ...(limit ? [{$limit: limit}] : [])
  ];
}

async function fetchPayments(match, sort, limit) {
  return collection('payment_records').aggregate(paymentPipeline(match, sort, limit)).toArray();
}

async function deleteJob(jobId, session) {
  const applications = await collection('job_applications').find({job_id: jobId}, {session, projection: {id: 1}}).toArray();
  const applicationIds = applications.map(item => item.id);
  await Promise.all([
    collection('payment_records').deleteMany({job_id: jobId}, {session}),
    collection('job_applications').deleteMany({job_id: jobId}, {session}),
    collection('job_deletion_requests').deleteMany({job_id: jobId}, {session}),
    collection('reports').updateMany({job_id: jobId}, {$set: {job_id: null}}, {session})
  ]);
  if (applicationIds.length) {
    await collection('reports').updateMany(
      {application_id: {$in: applicationIds}}, {$set: {application_id: null}}, {session}
    );
  }
  await collection('catering_jobs').deleteOne({id: jobId}, {session});
}

function job(r, unlocked = false) {
  return {
    id: r.id, title: r.title, description: r.description,
    workType: r.work_type, workTypeDisplayName: r.work_type,
    workArea: r.work_area, detailedLocation: unlocked ? r.detailed_location : undefined,
    jobDate: r.job_date, startTime: r.start_time, endTime: r.end_time,
    paymentAmount: r.payment_amount, paymentType: r.payment_type,
    paymentTypeDisplayName: r.payment_type, onSpotPayment: !!r.is_on_spot_payment,
    workersRequired: r.workers_required, workersSelected: r.workers_selected,
    requiredSkills: r.required_skills,
    contactPhone: unlocked ? r.contact_phone : undefined,
    contactEmail: unlocked ? r.contact_email : undefined,
    locationPhotoUrl: r.location_photo_url || null,
    latitude: r.latitude || null,
    longitude: r.longitude || null,
    locationAddress: r.location_address || null,
    applyDeadline: r.apply_deadline || null,
    status: r.status, ownerDecision: r.owner_decision || null, ownerDecisionAt: r.owner_decision_at || null, cateringName: r.catering_name,
    ownerId: r.owner_user_id,
    ownerVerified: r.verification_status === 'VERIFIED',
    createdAt: r.created_at
  };
}

function application(r, unlocked = false) {
  return {
    id: r.id, jobId: r.job_id, jobTitle: r.job_title,
    workType: r.work_type, workTypeDisplayName: r.work_type,
    workArea: r.work_area,
    detailedLocation: unlocked ? r.detailed_location : undefined,
    locationUnlocked: unlocked,
    jobDate: r.job_date, startTime: r.start_time, endTime: r.end_time,
    paymentType: r.payment_type, paymentTypeDisplayName: r.payment_type,
    onSpotPayment: !!r.is_on_spot_payment,
    contactPhone: unlocked ? r.contact_phone : undefined,
    contactEmail: unlocked ? r.contact_email : undefined,
    contactUnlocked: unlocked,
    ownerId: r.owner_user_id, cateringName: r.catering_name,
    ownerName: r.owner_name,
    ownerVerified: r.verification_status === 'VERIFIED',
    studentId: r.student_id, studentUserId: r.student_user_id,
    studentName: r.student_name, studentEmail: r.student_email,
    studentPhone: r.student_phone, collegeName: r.college_name,
    skills: r.skills, studentRating: r.student_rating,
    totalJobsCompleted: r.total_jobs_completed,
    status: r.status, attendanceStatus: r.attendance_status,
    workCompletionStatus: r.work_completion_status,
    paymentStatus: r.payment_status, paymentAmount: r.payment_amount,
    paymentConfirmationDate: r.payment_confirmation_date,
    notes: r.notes, appliedAt: r.applied_at,
    respondedAt: r.responded_at, createdAt: r.created_at
  };
}

function profile(r) {
  return r ? {
    id: r.id, userId: r.user_id, fullName: r.full_name,
    email: r.email, phone: r.phone,
    collegeName: r.college_name, preferredArea: r.preferred_area,
    skills: r.skills, bio: r.bio,
    emergencyContact: r.emergency_contact,
    profilePhotoUrl: r.profile_photo_url,
    totalJobsCompleted: r.total_jobs_completed, rating: r.rating,
    cateringName: r.catering_name,
    businessAddress: r.business_address,
    businessPhone: r.business_phone,
    verified: r.verification_status === 'VERIFIED',
    verificationStatus: r.verification_status,
    verifiedAt: r.verified_at,
    totalJobsPosted: r.total_jobs_posted,
    profilePhotoUrl: r.profile_photo_url
  } : null;
}

async function listJobs(req, res, next) {
  try {
    const match = {
      status: 'OPEN',
      $and: [
        {$or: [{apply_deadline: {$exists: false}}, {apply_deadline: null}, {apply_deadline: {$gt: new Date().toISOString()}}]},
        {$or: [{owner_decision: {$exists: false}}, {owner_decision: null}, {owner_decision: {$ne: 'REMOVED'}}]}
      ]
    };
    const q = req.query;
    if (q.area || q.location) match.work_area = {$regex: escapeRegex(q.area || q.location), $options: 'i'};
    if (q.workType) match.work_type = q.workType;
    if (q.jobDate) match.job_date = q.jobDate;
    if (q.minPayment) match.payment_amount = {$gte: Number(q.minPayment)};
    if (q.maxPayment) match.payment_amount = {...(match.payment_amount || {}), $lte: Number(q.maxPayment)};
    if (q.paymentType) match.payment_type = q.paymentType;
    const r = await fetchJobs(match, {job_date: 1, created_at: -1});
    ok(res, r.map(x => job(x)), 'Jobs retrieved successfully');
  } catch (e) { next(e); }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/public/google-maps-key', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  ok(res, {apiKey: key});
});

app.get('/api/public/jobs', listJobs);
app.get('/api/public/jobs/recommended', listJobs);

// Full jobs endpoint - returns jobs where all positions are filled
app.get('/api/public/jobs/full', async (req, res, next) => {
  try {
    const match = {status: {$in: ['OPEN', 'FILLED']}, $expr: {$gte: ['$workers_selected', '$workers_required']}};
    const q = req.query;
    if (q.area || q.location) match.work_area = {$regex: escapeRegex(q.area || q.location), $options: 'i'};
    if (q.workType) match.work_type = q.workType;
    const r = await fetchJobs(match, {job_date: -1, created_at: -1});
    ok(res, r.map(x => ({...job(x), isFullyBooked: true})), 'Fully booked jobs retrieved');
  } catch (e) { next(e); }
});

app.get('/api/public/jobs/:id', async (req, res, next) => {
  try {
    const r = await fetchJobs({id: toId(req.params.id)}, {});
    if (!r[0]) return fail(res, 404, 'Job not found');
    const j = job(r[0]);
    j.ownerName = r[0].owner_name;
    ok(res, j, 'Job details retrieved');
  } catch (e) { next(e); }
});

// ─── STUDENT ─────────────────────────────────────────────────────────────────

async function current(req, kind) {
  const table = kind === 'student' ? 'student_profiles' : 'owner_profiles';
  const [user, profile] = await Promise.all([
    collection('users').findOne({id: req.user.id}),
    collection(table).findOne({user_id: req.user.id})
  ]);
  return user && profile ? {...user, ...profile} : null;
}

app.get('/api/student/profile', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try { ok(res, profile(await current(req, 'student'))); } catch (e) { next(e); }
});

app.put('/api/student/profile', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const b = req.body;
    await transaction(async session => {
      const now = new Date().toISOString();
      const userUpdate = {};
      if (b.fullName != null) userUpdate.full_name = b.fullName;
      if (b.phone != null) userUpdate.phone = b.phone;
      if (Object.keys(userUpdate).length) {
        await collection('users').updateOne({id: req.user.id}, {$set: {...userUpdate, updated_at: now}}, {session});
      }
      await collection('student_profiles').updateOne(
        {user_id: req.user.id},
        {$set: {
          college_name: b.collegeName || null, preferred_area: b.preferredArea || null,
          skills: b.skills || null, bio: b.bio || null, emergency_contact: b.emergencyContact || null,
          updated_at: now, ...(b.profilePhotoUrl ? {profile_photo_url: b.profilePhotoUrl} : {})
        }},
        {session}
      );
    });
    ok(res, profile(await current(req, 'student')), 'Profile updated successfully');
  } catch (e) { next(e); }
});

app.get('/api/student/dashboard', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const studentId = student?.id;
    const [availableJobsCount, totalApplicationsCount, acceptedApplicationsCount, appliedJobsCount,
      completedJobsCount, payments, pendingPayments, unreadNotificationsCount] = await Promise.all([
      collection('catering_jobs').countDocuments({status: 'OPEN'}),
      collection('job_applications').countDocuments({student_id: studentId}),
      collection('job_applications').countDocuments({student_id: studentId, status: 'ACCEPTED'}),
      collection('job_applications').countDocuments({student_id: studentId, status: 'APPLIED'}),
      collection('job_applications').countDocuments({student_id: studentId, work_completion_status: 'COMPLETED'}),
      collection('payment_records').aggregate([{$match: {student_id: studentId, payment_status: 'PAID'}}, {$group: {_id: null, total: {$sum: '$amount'}}}]).toArray(),
      collection('payment_records').aggregate([{$match: {student_id: studentId, payment_status: {$in: ['PENDING', 'INITIATED']}}}, {$group: {_id: null, total: {$sum: '$amount'}}}]).toArray(),
      collection('notifications').countDocuments({recipient_id: req.user.id, is_read: false})
    ]);
    ok(res, {
      availableJobsCount, totalApplicationsCount, acceptedApplicationsCount, appliedJobsCount,
      completedJobsCount, totalEarnings: payments[0]?.total || 0,
      pendingEarnings: pendingPayments[0]?.total || 0, unreadNotificationsCount
    });
  } catch (e) { next(e); }
});

app.get('/api/student/jobs', auth, guard('ROLE_STUDENT'), listJobs);

app.post('/api/student/jobs/:jobId/apply', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const data = await transaction(async session => {
      const s = await collection('student_profiles').findOne({user_id: req.user.id}, {session});
      const j = await collection('catering_jobs').findOne({id: toId(req.params.jobId)}, {session});
      if (!s || !j || j.status !== 'OPEN') throw Object.assign(new Error('Job is not available'), {status: 400});
      // Check if job is fully booked
      if (j.workers_selected >= j.workers_required) throw Object.assign(new Error('Applications are closed because all required workers have been hired.'), {status: 400});
      // Check application deadline
      if (j.apply_deadline) {
        const deadline = new Date(j.apply_deadline);
        if (new Date() > deadline) throw Object.assign(new Error('The application deadline for this job has passed.'), {status: 400});
      }
      const created = await insertDocument('job_applications', {
        job_id: j.id, student_id: s.id, payment_amount: j.payment_amount, notes: req.body.notes || null,
        status: 'APPLIED', attendance_status: 'NOT_MARKED', work_completion_status: 'NOT_COMPLETED',
        payment_status: 'PENDING'
      }, session);
      const [r] = await fetchApplications({id: created.id}, {}, session);
      return application(r);
    });
    ok(res, data, 'Application submitted successfully!');
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, 'You have already applied for this job');
    next(e);
  }
});

async function studentApps(req, res, next, filter = {}) {
  try {
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    if (!student) return ok(res, []);
    const r = await fetchApplications({student_id: student.id, ...filter});
    ok(res, r.map(x => application(x, x.status === 'ACCEPTED' || x.work_completion_status === 'COMPLETED')));
  } catch (e) { next(e); }
}

app.get('/api/student/applications', auth, guard('ROLE_STUDENT'), studentApps);
app.get('/api/student/applications/accepted', auth, guard('ROLE_STUDENT'), (q, s, n) => studentApps(q, s, n, {status: 'ACCEPTED'}));
app.get('/api/student/applications/completed', auth, guard('ROLE_STUDENT'), (q, s, n) => studentApps(q, s, n, {work_completion_status: 'COMPLETED'}));

app.delete('/api/student/applications/:id', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const result = await collection('job_applications').updateOne(
      {id: toId(req.params.id), student_id: student?.id, status: 'APPLIED'},
      {$set: {status: 'CANCELLED', updated_at: new Date().toISOString()}}
    );
    if (!result.modifiedCount) return fail(res, 400, 'Only pending applications can be cancelled');
    ok(res, null, 'Application cancelled successfully');
  } catch (e) { next(e); }
});

// ─── STUDENT CONFIRM RECEIPT (on-spot payment) ────────────────────────────
app.put('/api/student/applications/:id/confirm-payment', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const data = await transaction(async session => {
      const student = await collection('student_profiles').findOne({user_id: req.user.id}, {session});
      const app = await collection('job_applications').findOne(
        {id: toId(req.params.id), student_id: student?.id}, {session}
      );
      if (!app) throw Object.assign(new Error('Application not found'), {status: 404});
      const payment = await collection('payment_records').findOne({application_id: app.id}, {session});
      app.pay_status = payment?.payment_status;
      app.payment_id = payment?.id;
      app.amount = payment?.amount;
      if (app.status !== 'ACCEPTED' && app.status !== 'COMPLETED')
        throw Object.assign(new Error('You can only confirm receipt for accepted or completed jobs'), {status: 400});
      if (app.pay_status === 'CONFIRMED')
        throw Object.assign(new Error('Payment has already been confirmed'), {status: 400});
      if (app.pay_status !== 'PAID' && app.pay_status !== 'PENDING')
        throw Object.assign(new Error('Payment is not in a confirmable state'), {status: 400});

      // Update payment_records: mark as CONFIRMED
      const now = new Date().toISOString();
      await collection('payment_records').updateOne(
        {id: app.payment_id}, {$set: {
          payment_status: 'CONFIRMED', confirmed_paid_at: now,
          ...(req.body.notes ? {notes: req.body.notes} : {}), updated_at: now
        }}, {session}
      );
      await collection('job_applications').updateOne(
        {id: app.id}, {$set: {payment_status: 'CONFIRMED', payment_confirmation_date: now, updated_at: now}}, {session}
      );

      return {confirmed: true, amount: app.amount};
    });
    ok(res, data, 'Payment receipt confirmed successfully!');
  } catch (e) { next(e); }
});

// ─── STUDENT EARNINGS & TRANSACTION HISTORY ────────────────────────────────

// Get student earnings summary (total earned, pending, this month, etc.)
app.get('/api/student/earnings', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const month = new Date().toISOString().slice(0, 7);
    const [summary] = await collection('payment_records').aggregate([
      {$match: {student_id: student?.id}},
      {$group: {
        _id: null,
        totalEarned: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, '$amount', 0]}},
        pendingAmount: {$sum: {$cond: [{$eq: ['$payment_status', 'PENDING']}, '$amount', 0]}},
        processingAmount: {$sum: {$cond: [{$eq: ['$payment_status', 'INITIATED']}, '$amount', 0]}},
        completedJobs: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, 1, 0]}},
        pendingJobs: {$sum: {$cond: [{$in: ['$payment_status', ['PENDING', 'INITIATED']]}, 1, 0]}},
        thisMonthEarnings: {$sum: {$cond: [
          {$and: [{$eq: ['$payment_status', 'PAID']}, {$regexMatch: {input: {$ifNull: ['$marked_paid_at', '']}, regex: `^${month}`}}]},
          '$amount', 0
        ]}}
      }},
      {$project: {_id: 0}}
    ]).toArray();
    ok(res, summary || {totalEarned: 0, pendingAmount: 0, processingAmount: 0, completedJobs: 0, pendingJobs: 0, thisMonthEarnings: 0}, 'Earnings summary retrieved');
  } catch (e) { next(e); }
});

// Get student transaction history (earnings/payments received)
app.get('/api/student/earnings/transactions', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const q = req.query;
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const match = {student_id: student?.id};
    if (q.status) match.payment_status = q.status;
    if (q.minAmount) match.amount = {...(match.amount || {}), $gte: Number(q.minAmount)};
    if (q.maxAmount) match.amount = {...(match.amount || {}), $lte: Number(q.maxAmount)};
    if (q.fromDate || q.toDate) match.marked_paid_at = {
      ...(q.fromDate ? {$gte: q.fromDate} : {}), ...(q.toDate ? {$lte: `${q.toDate}T23:59:59.999Z`} : {})
    };
    const r = await fetchPayments(match, {marked_paid_at: -1}, 100);
    
    ok(res, r.map(x => ({
      id: x.id, applicationId: x.application_id, jobId: x.job_id,
      amount: x.amount, paymentType: x.payment_type, paymentTypeDisplayName: x.payment_type,
      paymentStatus: x.payment_status,
      jobTitle: x.job_title, workArea: x.work_area, jobDate: x.job_date,
      workType: x.work_type, ownerName: x.owner_name, cateringName: x.catering_name,
      applicationStatus: x.application_status, workCompletionStatus: x.work_completion_status,
      initiatedAt: x.initiated_at, markedPaidAt: x.marked_paid_at, notes: x.notes,
      createdAt: x.created_at
    })), 'Transaction history retrieved');
  } catch (e) { next(e); }
});

// ─── OWNER ───────────────────────────────────────────────────────────────────

async function ownerId(req) {
  const owner = await collection('owner_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
  return owner?.id;
}

app.get('/api/owner/dashboard', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const [totalActiveJobsCount, totalCompletedJobsCount, acceptedJobs, appliedJobs,
      totalSuccessTransactions, totalFailedTransactions, totalPendingTransactions, revenue, unreadNotificationsCount] = await Promise.all([
      collection('catering_jobs').countDocuments({owner_id: oid, status: 'OPEN'}),
      collection('catering_jobs').countDocuments({owner_id: oid, status: 'COMPLETED'}),
      collection('job_applications').countDocuments({status: 'ACCEPTED'}),
      collection('job_applications').countDocuments({status: 'APPLIED'}),
      collection('payment_records').countDocuments({owner_id: oid, payment_status: 'SUCCESS'}),
      collection('payment_records').countDocuments({owner_id: oid, payment_status: 'FAILED'}),
      collection('payment_records').countDocuments({owner_id: oid, payment_status: 'CREATED'}),
      collection('payment_records').aggregate([{$match: {owner_id: oid, payment_status: 'SUCCESS'}}, {$group: {_id: null, total: {$sum: '$amount'}}}]).toArray(),
      collection('notifications').countDocuments({recipient_id: req.user.id, is_read: false})
    ]);
    const jobIds = (await collection('catering_jobs').find({owner_id: oid}, {projection: {id: 1}}).toArray()).map(row => row.id);
    const [totalHiredCount, totalPendingApplications] = await Promise.all([
      collection('job_applications').countDocuments({job_id: {$in: jobIds}, status: 'ACCEPTED'}),
      collection('job_applications').countDocuments({job_id: {$in: jobIds}, status: 'APPLIED'})
    ]);
    ok(res, {
      totalActiveJobsCount, totalCompletedJobsCount, totalHiredCount, totalPendingApplications,
      totalSuccessTransactions, totalFailedTransactions, totalPendingTransactions,
      totalTestRevenue: revenue[0]?.total || 0, unreadNotificationsCount
    });
  } catch (e) { next(e); }
});

app.get('/api/owner/profile', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try { ok(res, profile(await current(req, 'owner'))); } catch (e) { next(e); }
});

app.put('/api/owner/profile', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const b = req.body;
    await transaction(async session => {
      const now = new Date().toISOString();
      const userUpdate = {};
      if (b.fullName != null) userUpdate.full_name = b.fullName;
      if (b.phone != null) userUpdate.phone = b.phone;
      if (Object.keys(userUpdate).length) {
        await collection('users').updateOne({id: req.user.id}, {$set: {...userUpdate, updated_at: now}}, {session});
      }
      await collection('owner_profiles').updateOne(
        {user_id: req.user.id},
        {$set: {
          ...(b.cateringName != null ? {catering_name: b.cateringName} : {}),
          business_address: b.businessAddress || null,
          business_phone: b.businessPhone || null, updated_at: now,
          ...(b.profilePhotoUrl ? {profile_photo_url: b.profilePhotoUrl} : {})
        }},
        {session}
      );
    });
    ok(res, profile(await current(req, 'owner')), 'Profile updated successfully');
  } catch (e) { next(e); }
});

app.post('/api/owner/jobs', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const b = req.body, id = await ownerId(req);
    // Validate location coordinates (required for new jobs)
    if (!b.latitude || !b.longitude) {
      return fail(res, 400, 'Please select the exact job location on Google Maps.');
    }
    const lat = Number(b.latitude), lng = Number(b.longitude);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180)
      return fail(res, 400, 'Invalid location coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.');
    const created = await insertDocument('catering_jobs', {
      owner_id: id, title: b.title, description: b.description || null,
      work_type: b.workType, work_area: b.workArea, detailed_location: b.detailedLocation,
      job_date: b.jobDate, start_time: b.startTime, end_time: b.endTime,
      payment_amount: Number(b.paymentAmount), payment_type: b.paymentType,
      is_on_spot_payment: b.onSpotPayment !== false, workers_required: Number(b.workersRequired),
      workers_selected: 0, required_skills: b.requiredSkills || null, contact_phone: b.contactPhone,
      contact_email: b.contactEmail || null, location_photo_url: b.locationPhotoUrl || null,
      apply_deadline: b.applyDeadline || null, latitude: Number(b.latitude), longitude: Number(b.longitude),
      location_address: b.locationAddress || null, status: 'OPEN'
    });
    const [r] = await fetchJobs({id: created.id}, {});
    ok(res, job(r, true), 'Job posted successfully!');
  } catch (e) { next(e); }
});

app.get('/api/owner/jobs', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const r = await fetchJobs({owner_id: oid}, {created_at: -1});
    const jobIds = r.map(x => x.id);
    let acceptedMap = {};
    let cancellationMap = {};
    let applicationCountMap = {};
    if (jobIds.length > 0) {
      const [acceptedRows, delRows, appCountRows] = await Promise.all([
        collection('job_applications').aggregate([{$match: {job_id: {$in: jobIds}, status: 'ACCEPTED'}}, {$group: {_id: '$job_id', count: {$sum: 1}}}]).toArray(),
        collection('job_deletion_requests').aggregate([{$match: {job_id: {$in: jobIds}, status: 'PENDING'}}, {$group: {_id: '$job_id', count: {$sum: 1}}}]).toArray(),
        collection('job_applications').aggregate([{$match: {job_id: {$in: jobIds}}}, {$group: {_id: '$job_id', count: {$sum: 1}}}]).toArray()
      ]);
      acceptedRows.forEach(row => { acceptedMap[row._id] = true; });
      delRows.forEach(row => { cancellationMap[row._id] = true; });
      appCountRows.forEach(row => { applicationCountMap[row._id] = row.count; });
    }
    // Compute canDelete per job based on 3 scenarios
    const now = new Date();
    ok(res, r.map(x => {
      const hasAccepted = !!acceptedMap[x.id];
      const hasPendingCancel = !!cancellationMap[x.id];
      const jobEnd = new Date(`${x.job_date}T${x.end_time || '23:59:59'}`);
      const timeCrossed = now > jobEnd;

      const deadlinePassed = !!(x.apply_deadline && new Date(x.apply_deadline) <= now);
      const isFull = x.workers_selected >= x.workers_required;
      const needsDecision = deadlinePassed && !isFull && !x.owner_decision;
      const canDelete = !hasAccepted || timeCrossed || deadlinePassed || hasPendingCancel || x.status === 'REMOVED';
      return {...job(x, true), canDelete, hasPendingDeletionRequest: hasPendingCancel, isFull, deadlinePassed, needsDecision, applicationCount: applicationCountMap[x.id] || 0};
    }));
  } catch (e) { next(e); }
});

app.get('/api/owner/jobs/closed', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    // Closed jobs = jobs where apply_deadline has passed OR status is CANCELLED/COMPLETED/FILLED
    const r = await fetchJobs(
      {owner_id: oid, $or: [
        {status: {$in: ['CANCELLED', 'COMPLETED']}},
        {apply_deadline: {$ne: null, $lte: new Date().toISOString()}}
      ]},
      {updated_at: -1}
    );
    if (r.length === 0) return ok(res, []);

    const jobIds = r.map(x => x.id);
    // Get all applicants for these jobs with their details
    const apps = await fetchApplications({job_id: {$in: jobIds}}, {job_id: 1, applied_at: 1});

    // Group applications by job
    const appsByJob = {};
    apps.forEach(a => {
      if (!appsByJob[a.job_id]) appsByJob[a.job_id] = [];
      appsByJob[a.job_id].push(application(a, true));
    });

    ok(res, r.map(x => {
      const j = job(x, true);
      j.applicants = appsByJob[x.id] || [];
      j.isDeadlinePassed = !!(x.apply_deadline && new Date(x.apply_deadline) <= new Date());
      return j;
    }));
  } catch (e) { next(e); }
});

app.get('/api/owner/jobs/:id', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const r = await fetchJobs({id: toId(req.params.id), owner_id: await ownerId(req)}, {});
    if (!r[0]) return fail(res, 404, 'Job not found');
    const a = await fetchApplications({job_id: toId(req.params.id)});
    ok(res, {...job(r[0], true), applications: a.map(x => application(x, true))});
  } catch (e) { next(e); }
});

app.put('/api/owner/jobs/:id', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const b = req.body;
    // Validate location coordinates if provided
    if (b.latitude != null && b.longitude != null) {
      const lat = Number(b.latitude), lng = Number(b.longitude);
      if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180)
        return fail(res, 400, 'Invalid location coordinates.');
    }
    const fields = {
      title: b.title, description: b.description || null, work_type: b.workType, work_area: b.workArea,
      detailed_location: b.detailedLocation, job_date: b.jobDate, start_time: b.startTime, end_time: b.endTime,
      payment_amount: Number(b.paymentAmount), payment_type: b.paymentType, is_on_spot_payment: b.onSpotPayment,
      workers_required: Number(b.workersRequired), required_skills: b.requiredSkills || null,
      contact_phone: b.contactPhone, contact_email: b.contactEmail || null,
      location_photo_url: b.locationPhotoUrl || null, apply_deadline: b.applyDeadline || null,
      latitude: b.latitude == null ? null : Number(b.latitude), longitude: b.longitude == null ? null : Number(b.longitude),
      location_address: b.locationAddress || null, updated_at: new Date().toISOString()
    };
    await collection('catering_jobs').updateOne(
      {id: toId(req.params.id), owner_id: await ownerId(req)}, {$set: fields}
    );
    const r = await fetchJobs({id: toId(req.params.id)}, {});
    ok(res, job(r[0], true), 'Job updated successfully');
  } catch (e) { next(e); }
});

app.delete('/api/owner/jobs/:id', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const data = await transaction(async session => {
      // 1. Verify job exists and belongs to this owner
      const jobRow = await collection('catering_jobs').findOne(
        {id: toId(req.params.id), owner_id: oid}, {session}
      );
      if (!jobRow) throw Object.assign(new Error('Job not found'), {status: 404});

      // 2. Find all hired (ACCEPTED) students
      const acceptedApps = await fetchApplications(
        {job_id: jobRow.id, status: 'ACCEPTED'}
      );

      if (acceptedApps.length === 0) {
        // CASE A: No student hired → delete immediately
        await deleteJob(jobRow.id, session);
        return {deleted: true};
      }

      // CASE B: Student(s) hired → check for existing pending request
      const existingPending = await collection('job_deletion_requests').countDocuments(
        {job_id: jobRow.id, status: 'PENDING'}, {session}
      );
      if (existingPending > 0) {
        throw Object.assign(new Error('A deletion request is already waiting for the hired student(s) to respond.'), {status: 400});
      }

      // Create deletion request for EACH hired student
      for (const app of acceptedApps) {
        await insertDocument('job_deletion_requests', {job_id: jobRow.id, owner_id: oid, student_id: app.student_id}, session);
        // Notify the hired student
        await insertDocument('notifications', {
          recipient_id: app.student_id, title: 'Job Deletion Request',
          message: 'The owner wants to delete the job you were hired for. Do you want to approve this request?',
          type: 'JOB_DELETION_REQUEST', related_entity_id: null, is_read: false
        }, session);
      }
      return {deleted: false, requestCreated: true, hiredStudentCount: acceptedApps.length};
    });
    if (data.deleted) {
      ok(res, data, 'Job deleted successfully');
    } else {
      ok(res, data, 'Deletion request sent to the hired student(s).');
    }
  } catch (e) { next(e); }
});

// ─── STUDENT JOB DELETION REQUESTS ──────────────────────────────────────────

app.get('/api/student/deletion-requests', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const sp = await collection('student_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!sp) return ok(res, []);
    const rows = await collection('job_deletion_requests').aggregate([
      {$match: {student_id: sp.id}},
      {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}}, {$unwind: '$job'},
      {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}}, {$unwind: '$owner'},
      {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}}, {$unwind: '$owner_user'},
      {$set: {job_title: '$job.title', work_area: '$job.work_area', job_date: '$job.job_date', start_time: '$job.start_time', end_time: '$job.end_time', catering_name: '$owner.catering_name', owner_name: '$owner_user.full_name'}},
      {$unset: ['job', 'owner', 'owner_user']}, {$sort: {created_at: -1}}
    ]).toArray();
    ok(res, rows.map(r => ({
      id: r.id, jobId: r.job_id, ownerId: r.owner_id,
      status: r.status, createdAt: r.created_at, respondedAt: r.responded_at,
      jobTitle: r.job_title, workArea: r.work_area,
      jobDate: r.job_date, startTime: r.start_time, endTime: r.end_time,
      cateringName: r.catering_name, ownerName: r.owner_name
    })));
  } catch (e) { next(e); }
});

app.post('/api/student/deletion-requests/:id/accept', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const sp = await collection('student_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!sp) return fail(res, 404, 'Student profile not found');
    const data = await transaction(async session => {
      // 1. Verify request exists, belongs to this student, and is PENDING
      const reqRow = await collection('job_deletion_requests').findOne(
        {id: toId(req.params.id), student_id: sp.id, status: 'PENDING'}, {session}
      );
      if (!reqRow) throw Object.assign(new Error('This deletion request is no longer available.'), {status: 404});

      // 2. Mark request as ACCEPTED
      await collection('job_deletion_requests').updateOne(
        {id: reqRow.id}, {$set: {status: 'ACCEPTED', responded_at: new Date().toISOString()}}, {session}
      );

      // 3. Delete the job (CASCADE handles applications, payments, other deletion requests)
      await deleteJob(reqRow.job_id, session);

      // 4. Notify the owner
      await insertDocument('notifications', {
        recipient_id: reqRow.owner_id, title: 'Deletion Request Accepted',
        message: 'The hired student accepted your job deletion request. The job has been deleted.',
        type: 'JOB_DELETION_ACCEPTED', related_entity_id: reqRow.id, is_read: false
      }, session);
    });
    ok(res, data, 'Request accepted. The job has been deleted.');
  } catch (e) { next(e); }
});

app.post('/api/student/deletion-requests/:id/reject', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const sp = await collection('student_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!sp) return fail(res, 404, 'Student profile not found');
    const data = await transaction(async session => {
      // 1. Verify request exists, belongs to this student, and is PENDING
      const reqRow = await collection('job_deletion_requests').findOne(
        {id: toId(req.params.id), student_id: sp.id, status: 'PENDING'}, {session}
      );
      if (!reqRow) throw Object.assign(new Error('This deletion request is no longer available.'), {status: 404});

      // 2. Mark as REJECTED
      await collection('job_deletion_requests').updateOne(
        {id: reqRow.id}, {$set: {status: 'REJECTED', responded_at: new Date().toISOString()}}, {session}
      );

      // 3. Notify the owner
      await insertDocument('notifications', {
        recipient_id: reqRow.owner_id, title: 'Deletion Request Rejected',
        message: 'The hired student rejected your job deletion request. The job remains active.',
        type: 'JOB_DELETION_REJECTED', related_entity_id: reqRow.id, is_read: false
      }, session);
    });
    ok(res, data, 'Request rejected. The job remains active.');
  } catch (e) { next(e); }
});

app.get('/api/owner/jobs/:id/applications', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const jobRow = await collection('catering_jobs').findOne(
      {id: toId(req.params.id), owner_id: await ownerId(req)}, {projection: {id: 1}}
    );
    if (!jobRow) return fail(res, 404, 'Job not found');
    const r = await fetchApplications({job_id: jobRow.id});
    ok(res, r.map(x => application(x, true)));
  } catch (e) { next(e); }
});

async function appAction(req, res, next, accept) {
  try {
    const id = await ownerId(req);
    const data = await transaction(async session => {
      const [a] = await fetchApplications({id: toId(req.params.id)}, {}, session);
      if (!a) throw Object.assign(new Error('Application not found'), {status: 404});
      const jobRow = await collection('catering_jobs').findOne({id: a.job_id, owner_id: id}, {session});
      if (!jobRow) throw Object.assign(new Error('Application not found'), {status: 404});
      const now = new Date().toISOString();
      if (accept) {
        const updatedJob = await collection('catering_jobs').findOneAndUpdate(
          {id: a.job_id, $expr: {$lt: ['$workers_selected', '$workers_required']}},
          {$inc: {workers_selected: 1}, $set: {updated_at: now}},
          {session, returnDocument: 'after'}
        );
        if (!updatedJob) throw Object.assign(new Error('Worker limit has been reached'), {status: 400});
        await collection('catering_jobs').updateOne(
          {id: a.job_id, workers_selected: {$gte: updatedJob.workers_required}},
          {$set: {status: 'FILLED'}}, {session}
        );
        await collection('job_applications').updateOne(
          {id: a.id}, {$set: {status: 'ACCEPTED', responded_at: now, updated_at: now}}, {session}
        );
        await insertDocument('payment_records', {
          application_id: a.id, job_id: a.job_id, student_id: a.student_id, owner_id: id,
          amount: a.payment_amount, payment_type: jobRow.payment_type, payment_status: 'PENDING'
        }, session);
        await insertDocument('notifications', {
          recipient_id: a.student_user_id, title: 'Application Accepted',
          message: `Your application for "${a.job_title}" was accepted. Check Accepted Shifts for venue and contact details.`,
          type: 'APPLICATION_ACCEPTED', related_entity_id: a.id, is_read: false
        }, session);
      } else {
        await collection('job_applications').updateOne(
          {id: a.id}, {$set: {status: 'REJECTED', responded_at: now, updated_at: now}}, {session}
        );
        await insertDocument('notifications', {
          recipient_id: a.student_user_id, title: 'Application Update',
          message: `Your application for "${a.job_title}" was not accepted.`,
          type: 'APPLICATION_REJECTED', related_entity_id: a.id, is_read: false
        }, session);
      }
      const [updated] = await fetchApplications({id: a.id}, {}, session);
      return application(updated, true);
    });
    ok(res, data, accept ? 'Applicant accepted successfully!' : 'Applicant rejected.');
  } catch (e) { next(e); }
}

app.put('/api/owner/applications/:id/accept', auth, guard('ROLE_OWNER'), (q, s, n) => appAction(q, s, n, true));
app.put('/api/owner/applications/:id/reject', auth, guard('ROLE_OWNER'), (q, s, n) => appAction(q, s, n, false));

app.put('/api/owner/applications/:id/attendance', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const id = await ownerId(req);
    const appRecord = await collection('job_applications').findOne({id: toId(req.params.id)});
    if (appRecord) {
      const ownedJob = await collection('catering_jobs').findOne({id: appRecord.job_id, owner_id: id});
      if (ownedJob) {
        await collection('job_applications').updateOne(
          {id: appRecord.id},
          {$set: {attendance_status: req.body.attendanceStatus, work_completion_status: req.body.workCompletionStatus || 'COMPLETED', updated_at: new Date().toISOString()}}
        );
      }
    }
    ok(res, null, 'Attendance updated successfully');
  } catch (e) { next(e); }
});

app.put('/api/owner/jobs/:id/complete', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const id = await ownerId(req);
    await transaction(async session => {
      const jobId = toId(req.params.id);
      const now = new Date().toISOString();
      await collection('catering_jobs').updateOne(
        {id: jobId, owner_id: id}, {$set: {status: 'COMPLETED', updated_at: now}}, {session}
      );
      await collection('job_applications').updateMany(
        {job_id: jobId, status: 'ACCEPTED'}, {$set: {work_completion_status: 'COMPLETED', updated_at: now}}, {session}
      );
    });
    ok(res, null, 'Job marked as completed!');
  } catch (e) { next(e); }
});

// ─── OWNER PAYMENTS ──────────────────────────────────────────────────────────

// Get pending payments owner needs to make
app.get('/api/owner/payments/pending', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const r = await fetchPayments(
      {owner_id: oid, payment_status: {$in: ['PENDING', 'INITIATED']}}, {created_at: 1}
    );
    ok(res, r.map(x => ({
      id: x.id, applicationId: x.application_id, jobId: x.job_id,
      amount: x.amount, paymentType: x.payment_type, paymentStatus: x.payment_status,
      jobTitle: x.job_title, workArea: x.work_area, workType: x.work_type, jobDate: x.job_date,
      studentName: x.student_name, studentEmail: x.student_email, studentPhone: x.student_phone,
      collegeName: x.college_name, skills: x.skills, studentRating: x.student_rating,
      totalJobsCompleted: x.total_jobs_completed,
      applicationStatus: x.application_status, workCompletionStatus: x.work_completion_status,
      createdAt: x.created_at
    })), 'Pending payments retrieved');
  } catch (e) { next(e); }
});

// Get payment summary for owner
app.get('/api/owner/payments/summary', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const month = new Date().toISOString().slice(0, 7);
    const [summary] = await collection('payment_records').aggregate([
      {$match: {owner_id: oid}},
      {$group: {
        _id: null,
        totalPaid: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, '$amount', 0]}},
        totalPending: {$sum: {$cond: [{$in: ['$payment_status', ['PENDING', 'INITIATED']]}, '$amount', 0]}},
        completedPayments: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, 1, 0]}},
        pendingPayments: {$sum: {$cond: [{$in: ['$payment_status', ['PENDING', 'INITIATED']]}, 1, 0]}},
        thisMonthPaid: {$sum: {$cond: [
          {$and: [{$eq: ['$payment_status', 'PAID']}, {$regexMatch: {input: {$ifNull: ['$marked_paid_at', '']}, regex: `^${month}`}}]},
          '$amount', 0
        ]}}
      }},
      {$project: {_id: 0}}
    ]).toArray();
    ok(res, summary || {totalPaid: 0, totalPending: 0, completedPayments: 0, pendingPayments: 0, thisMonthPaid: 0}, 'Payment summary retrieved');
  } catch (e) { next(e); }
});

// Initiate payment (owner starts the payment process)
app.put('/api/owner/payments/:id/initiate', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const paymentId = toId(req.params.id);
    const now = new Date().toISOString();
    const payment = await collection('payment_records').findOneAndUpdate(
      {id: paymentId, owner_id: oid, payment_status: 'PENDING'},
      {$set: {payment_status: 'INITIATED', initiated_at: now, updated_at: now}},
      {returnDocument: 'after'}
    );
    if (!payment) return fail(res, 400, 'Payment not found or already initiated');
    await insertDocument('notifications', {
      recipient_id: payment.student_id, title: 'Payment Initiated',
      message: 'The owner has initiated your payment and will transfer it soon.',
      type: 'PAYMENT_INITIATED', related_entity_id: paymentId, is_read: false
    });
    
    ok(res, null, 'Owner has initiated payment to student');
  } catch (e) { next(e); }
});

// Complete payment (owner marks as paid with details)
app.put('/api/owner/payments/:id/complete', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const b = req.body;
    const data = await transaction(async session => {
      const payment = await collection('payment_records').findOne(
        {id: toId(req.params.id), owner_id: oid}, {session}
      );
      if (!payment) throw Object.assign(new Error('Payment not found'), {status: 404});
      const now = new Date().toISOString();
      await collection('payment_records').updateOne(
        {id: payment.id}, {$set: {payment_status: 'PAID', marked_paid_at: now, payment_method: b.paymentMethod || 'BANK_TRANSFER', notes: b.notes || null, updated_at: now}},
        {session}
      );
      await collection('job_applications').updateOne(
        {id: payment.application_id}, {$set: {payment_status: 'PAID', payment_confirmation_date: now, updated_at: now}}, {session}
      );
      await insertDocument('notifications', {
        recipient_id: payment.student_id, title: 'Payment Received',
        message: 'You have received payment from the owner for your work.',
        type: 'PAYMENT_COMPLETED', related_entity_id: payment.id, is_read: false
      }, session);
      
      return {paid: true};
    });
    
    ok(res, data, 'Payment to student has been recorded successfully!');
  } catch (e) { next(e); }
});

// Owner views all payments (with filters)
app.get('/api/owner/payments', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const q = req.query;
    const match = {owner_id: oid};
    if (q.status) match.payment_status = q.status;
    if (q.minAmount) match.amount = {$gte: Number(q.minAmount)};
    if (q.maxAmount) match.amount = {...(match.amount || {}), $lte: Number(q.maxAmount)};
    if (q.fromDate || q.toDate) match.marked_paid_at = {
      ...(q.fromDate ? {$gte: q.fromDate} : {}), ...(q.toDate ? {$lte: `${q.toDate}T23:59:59.999Z`} : {})
    };
    const r = await fetchPayments(match, {created_at: -1}, 100);
    
    ok(res, r.map(x => ({
      id: x.id, applicationId: x.application_id, jobId: x.job_id,
      studentId: x.student_id, ownerId: x.owner_id,
      amount: x.amount, paymentType: x.payment_type,
      paymentTypeDisplayName: x.payment_type,
      paymentStatus: x.payment_status, paymentMethod: x.payment_method,
      initiatedAt: x.initiated_at, markedPaidAt: x.marked_paid_at,
      notes: x.notes, createdAt: x.created_at,
      jobTitle: x.job_title, workArea: x.work_area,
      studentName: x.student_name, studentEmail: x.student_email
    })));
  } catch (e) { next(e); }
});

app.get('/api/owner/complaints', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const r = await collection('reports').aggregate([
      {$match: {target_user_id: req.user.id}},
      {$lookup: {from: 'users', localField: 'reporter_id', foreignField: 'id', as: 'student_user'}}, {$unwind: '$student_user'},
      {$lookup: {from: 'student_profiles', localField: 'reporter_id', foreignField: 'user_id', as: 'student'}}, {$unwind: {path: '$student', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}}, {$unwind: {path: '$job', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'job_applications', localField: 'application_id', foreignField: 'id', as: 'application'}}, {$unwind: {path: '$application', preserveNullAndEmptyArrays: true}},
      {$set: {
        student_name: '$student_user.full_name', student_email: '$student_user.email', student_phone: '$student_user.phone',
        student_skills: '$student.skills', student_area: '$student.preferred_area',
        job_title: '$job.title', work_area: '$job.work_area', job_date: '$job.job_date',
        application_status: '$application.status', application_payment_status: '$application.payment_status',
        assigned_amount: '$application.payment_amount'
      }},
      {$unset: ['student_user', 'student', 'job', 'application']},
      {$sort: {created_at: -1}}
    ]).toArray();
    ok(res, r.map(x => ({
      ...x,
      studentName: x.student_name, studentEmail: x.student_email,
      studentPhone: x.student_phone, studentSkills: x.student_skills,
      studentArea: x.student_area, jobTitle: x.job_title,
      workArea: x.work_area, jobDate: x.job_date,
      applicationStatus: x.application_status,
      applicationPaymentStatus: x.application_payment_status,
      assignedAmount: x.assigned_amount, reportType: x.report_type,
      expectedAmount: x.expected_amount, receivedAmount: x.received_amount,
      evidenceNotes: x.evidence_notes, adminRemarks: x.admin_remarks,
      createdAt: x.created_at
    })));
  } catch (e) { next(e); }
});


// ─── OWNER MARK PAYMENT PAID ────────────────────────────────────────────────
app.put('/api/owner/applications/:id/payment', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    await checkPaymentTiming(req.params.id);
    const b = req.body;
    const status = (b.status || 'PAID').toUpperCase();
    const data = await transaction(async session => {
      const [app] = await fetchApplications({id: toId(req.params.id)}, {}, session);
      const jobRow = app && await collection('catering_jobs').findOne({id: app.job_id, owner_id: oid}, {session});
      if (!app) throw Object.assign(new Error('Application not found'), {status: 404});
      if (!jobRow) throw Object.assign(new Error('Application not found'), {status: 404});
      const now = new Date().toISOString();
      const existing = await collection('payment_records').findOne({application_id: app.id}, {session});
      if (existing) {
        await collection('payment_records').updateOne(
          {application_id: app.id}, {$set: {payment_status: status, payment_method: 'ON_SPOT', marked_paid_at: now, notes: b.notes || null, updated_at: now}}, {session}
        );
      } else {
        await insertDocument('payment_records', {
          application_id: app.id, job_id: app.job_id, student_id: app.student_id,
          owner_id: oid, amount: app.payment_amount, payment_type: 'ON_SPOT',
          payment_status: status, payment_method: 'ON_SPOT', marked_paid_at: now, notes: b.notes || null
        }, session);
      }
      await collection('job_applications').updateOne(
        {id: app.id}, {$set: {payment_status: status, payment_confirmation_date: now, updated_at: now}}, {session}
      );
      if (status === 'PAID') {
        await insertDocument('notifications', {
          recipient_id: app.student_user_id, title: 'Payment Received',
          message: 'You have received payment of ₹' + app.payment_amount + ' for "' + app.job_title + '".',
          type: 'PAYMENT_COMPLETED', related_entity_id: app.id, is_read: false
        }, session);
      }
      return {paid: true};
    });
    ok(res, data, 'Payment recorded successfully!');
  } catch (e) { next(e); }
});

// ─── STUDENT PAYMENTS LIST ──────────────────────────────────────────────────
app.get('/api/student/payments', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const r = await fetchPayments({student_id: student?.id});
    ok(res, r.map(x => ({
      id: x.id, applicationId: x.application_id, jobId: x.job_id,
      amount: x.amount, paymentType: x.payment_type, paymentStatus: x.payment_status,
      jobTitle: x.job_title, workArea: x.work_area, jobDate: x.job_date,
      cateringName: x.catering_name, ownerName: x.owner_name,
      razorpayOrderId: x.razorpay_order_id, razorpayPaymentId: x.razorpay_payment_id,
      environment: x.environment, paymentMethod: x.payment_method,
      createdAt: x.created_at, confirmedPaidAt: x.confirmed_paid_at
    })), 'Payments retrieved');
  } catch (e) { next(e); }
});

// ─── ADMIN PAYMENTS ──────────────────────────────────────────────────────────

// Admin views all platform payments
app.get('/api/admin/payments', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const q = req.query;
    const match = {};
    if (q.status) match.payment_status = q.status;
    if (q.fromDate || q.toDate) match.marked_paid_at = {
      ...(q.fromDate ? {$gte: q.fromDate} : {}), ...(q.toDate ? {$lte: `${q.toDate}T23:59:59.999Z`} : {})
    };
    const r = await fetchPayments(match, {created_at: -1}, 200);
    
    ok(res, r.map(x => ({
      id: x.id, applicationId: x.application_id, jobId: x.job_id,
      amount: x.amount, paymentType: x.payment_type, paymentStatus: x.payment_status,
      jobTitle: x.job_title, workArea: x.work_area,
      studentName: x.student_name, studentEmail: x.student_email,
      ownerName: x.owner_name, ownerEmail: x.owner_email, cateringName: x.catering_name,
      markedPaidAt: x.marked_paid_at, createdAt: x.created_at
    })), 'All payments retrieved');
  } catch (e) { next(e); }
});

// Admin payment statistics
app.get('/api/admin/payments/stats', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const [stats] = await collection('payment_records').aggregate([
      {$group: {
        _id: null, totalTransacted: {$sum: '$amount'},
        totalPaid: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, '$amount', 0]}},
        totalPending: {$sum: {$cond: [{$in: ['$payment_status', ['PENDING', 'INITIATED']]}, '$amount', 0]}},
        totalTransactions: {$sum: 1},
        completedTransactions: {$sum: {$cond: [{$eq: ['$payment_status', 'PAID']}, 1, 0]}},
        owners: {$addToSet: '$owner_id'}, students: {$addToSet: '$student_id'}
      }},
      {$project: {_id: 0, totalTransacted: 1, totalPaid: 1, totalPending: 1, totalTransactions: 1, completedTransactions: 1, uniqueOwners: {$size: '$owners'}, uniqueStudents: {$size: '$students'}}}
    ]).toArray();
    ok(res, stats || {totalTransacted: 0, totalPaid: 0, totalPending: 0, totalTransactions: 0, completedTransactions: 0, uniqueOwners: 0, uniqueStudents: 0}, 'Payment statistics retrieved');
  } catch (e) { next(e); }
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────

app.get('/api/admin/dashboard', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const [totalStudentsCount, totalOwnersCount, verifiedOwnersCount, totalActiveJobsCount,
      totalCompletedJobsCount, totalApplicationsCount, pendingDisputesCount, suspendedUsersCount,
      paid, pending, completedPaymentCount, pendingPaymentCount] = await Promise.all([
      collection('student_profiles').countDocuments({}),
      collection('owner_profiles').countDocuments({}),
      collection('owner_profiles').countDocuments({verification_status: 'VERIFIED'}),
      collection('catering_jobs').countDocuments({status: {$in: ['OPEN', 'FILLED']}}),
      collection('catering_jobs').countDocuments({status: 'COMPLETED'}),
      collection('job_applications').countDocuments({}),
      collection('reports').countDocuments({status: 'PENDING'}),
      collection('users').countDocuments({is_suspended: true}),
      collection('payment_records').aggregate([{$match: {payment_status: 'PAID'}}, {$group: {_id: null, sum: {$sum: '$amount'}}}]).toArray(),
      collection('payment_records').aggregate([{$match: {payment_status: {$in: ['PENDING', 'INITIATED']}}}, {$group: {_id: null, sum: {$sum: '$amount'}}}]).toArray(),
      collection('payment_records').countDocuments({payment_status: 'PAID'}),
      collection('payment_records').countDocuments({payment_status: {$in: ['PENDING', 'INITIATED']}})
    ]);
    ok(res, {
      totalStudentsCount, totalOwnersCount, verifiedOwnersCount, totalActiveJobsCount,
      totalCompletedJobsCount, totalApplicationsCount, pendingDisputesCount, suspendedUsersCount,
      totalPaymentsPaid: paid[0]?.sum || 0, totalPaymentsPending: pending[0]?.sum || 0,
      completedPaymentCount, pendingPaymentCount
    });
  } catch (e) { next(e); }
});

app.get('/api/admin/users', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const r = await collection('users').aggregate([
      {$lookup: {from: 'student_profiles', localField: 'id', foreignField: 'user_id', as: 'student'}},
      {$unwind: {path: '$student', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'owner_profiles', localField: 'id', foreignField: 'user_id', as: 'owner'}},
      {$unwind: {path: '$owner', preserveNullAndEmptyArrays: true}},
      {$set: {student_college_name: '$student.college_name', owner_catering_name: '$owner.catering_name'}},
      {$unset: ['student', 'owner']}, {$sort: {created_at: -1}}
    ]).toArray();
    ok(res, r.map(x => ({
      id: x.id, email: x.email, fullName: x.full_name, phone: x.phone,
      role: x.role, active: !!x.is_active, suspended: !!x.is_suspended,
      createdAt: x.created_at,
      collegeName: x.student_college_name || null,
      cateringName: x.owner_catering_name || null
    })));
  } catch (e) { next(e); }
});

async function adminProfiles(req, res, next, t) {
  try {
    const r = await collection(t === 'student' ? 'student_profiles' : 'owner_profiles').aggregate([
      {$lookup: {from: 'users', localField: 'user_id', foreignField: 'id', as: 'user'}},
      {$unwind: '$user'}, {$replaceRoot: {newRoot: {$mergeObjects: ['$user', '$$ROOT']}}},
      {$unset: ['user']}
    ]).toArray();
    ok(res, r.map(profile));
  } catch (e) { next(e); }
}

app.get('/api/admin/students', auth, guard('ROLE_ADMIN'), (q, s, n) => adminProfiles(q, s, n, 'student'));
app.get('/api/admin/owners', auth, guard('ROLE_ADMIN'), (q, s, n) => adminProfiles(q, s, n, 'owner'));

app.put('/api/admin/owners/:id/verify', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const v = req.query.verified !== 'false';
    const owner = await collection('owner_profiles').findOneAndUpdate(
      {id: toId(req.params.id)},
      {$set: {verification_status: v ? 'VERIFIED' : 'PENDING_VERIFICATION', verified_at: v ? new Date().toISOString() : null}},
      {returnDocument: 'after'}
    );
    const user = owner && await collection('users').findOne({id: owner.user_id});
    ok(res, profile(owner && user ? {...user, ...owner} : null), v ? 'Owner verified successfully!' : 'Owner verification reverted to pending.');
  } catch (e) { next(e); }
});

app.put('/api/admin/users/:id/suspend', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const v = req.query.suspended === 'true';
    const user = await collection('users').findOneAndUpdate(
      {id: toId(req.params.id), role: {$ne: 'ROLE_ADMIN'}},
      {$set: {is_suspended: v, updated_at: new Date().toISOString()}},
      {returnDocument: 'after'}
    );
    ok(res, user, v ? 'User suspended successfully' : 'User reactivated successfully');
  } catch (e) { next(e); }
});

app.get('/api/admin/jobs', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const r = await fetchJobs({}, {created_at: -1});
    ok(res, r.map(x => job(x, true)));
  } catch (e) { next(e); }
});

app.delete('/api/admin/jobs/:id', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    await collection('catering_jobs').updateOne({id: toId(req.params.id)}, {$set: {status: 'CANCELLED', updated_at: new Date().toISOString()}});
    ok(res, null, 'Job deleted/cancelled by admin');
  } catch (e) { next(e); }
});

// ─── ADMIN TRANSACTIONS ──────────────────────────────────────────────────────

// Get all transactions with filters, search, and pagination
app.get('/api/admin/transactions', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      environment: req.query.environment || 'TEST',
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      searchQuery: req.query.search,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0
    };

    const result = await getTransactionsList(filters);
    ok(res, result, 'Transactions retrieved');
  } catch (e) { next(e); }
});

// Get transaction summary/statistics for admin dashboard
app.get('/api/admin/transactions/summary', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const summary = await getTransactionSummary({
      fromDate: req.query.fromDate,
      toDate: req.query.toDate
    });
    ok(res, summary, 'Transaction summary retrieved');
  } catch (e) { next(e); }
});

// Get transaction details by ID
app.get('/api/admin/transactions/:id', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const txn = await getTransactionDetails(req.params.id);
    if (!txn) return fail(res, 404, 'Transaction not found');
    ok(res, txn, 'Transaction details retrieved');
  } catch (e) { next(e); }
});

// Export transactions (admin only)
app.get('/api/admin/transactions/export/csv', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      environment: 'TEST',
      fromDate: req.query.fromDate,
      toDate: req.query.toDate
    };

    const {transactions} = await getTransactionsList({...filters, limit: 10000, offset: 0});

    // Build CSV
    const headers = ['Transaction ID', 'Student', 'Owner', 'Job', 'Amount', 'Status', 'Environment', 'Payment Method', 'Order ID', 'Payment ID', 'Created Date'];
    const rows = transactions.map(t => [
      t.transactionId,
      t.studentName,
      t.ownerName,
      t.jobTitle,
      `₹${t.amount}`,
      t.paymentStatus,
      t.environment,
      t.paymentMethod || 'N/A',
      t.razorpayOrderId || '',
      t.razorpayPaymentId || '',
      new Date(t.createdAt).toLocaleString('en-IN')
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

// ─── STUDENT TRANSACTIONS ───────────────────────────────────────────────────

// Get student's own transactions
app.get('/api/student/transactions', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const studentProfile = await collection('student_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!studentProfile) return fail(res, 404, 'Student profile not found');

    const filters = {
      studentId: studentProfile.id,
      status: req.query.status,
      environment: 'TEST',
      limit: req.query.limit || 20,
      offset: req.query.offset || 0
    };

    const result = await getTransactionsList(filters);
    ok(res, result, 'Student transactions retrieved');
  } catch (e) { next(e); }
});

// Get student transaction details
app.get('/api/student/transactions/:id', auth, guard('ROLE_STUDENT'), async (req, res, next) => {
  try {
    const studentProfile = await collection('student_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!studentProfile) return fail(res, 404, 'Student profile not found');

    const txn = await getTransactionDetails(req.params.id);
    if (!txn) return fail(res, 404, 'Transaction not found');
    
    // Verify student owns this transaction
    if (txn.studentId !== studentProfile.id) {
      return fail(res, 403, 'You do not have permission to view this transaction');
    }

    ok(res, txn, 'Transaction details retrieved');
  } catch (e) { next(e); }
});

// ─── OWNER TRANSACTIONS ─────────────────────────────────────────────────────

// Get owner's transactions (from their jobs)
app.get('/api/owner/transactions', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const ownerProfile = await collection('owner_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!ownerProfile) return fail(res, 404, 'Owner profile not found');

    const filters = {
      ownerId: ownerProfile.id,
      status: req.query.status,
      environment: 'TEST',
      limit: req.query.limit || 20,
      offset: req.query.offset || 0
    };

    const result = await getTransactionsList(filters);
    ok(res, result, 'Owner transactions retrieved');
  } catch (e) { next(e); }
});

// Get owner transaction details
app.get('/api/owner/transactions/:id', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const ownerProfile = await collection('owner_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!ownerProfile) return fail(res, 404, 'Owner profile not found');

    const txn = await getTransactionDetails(req.params.id);
    if (!txn) return fail(res, 404, 'Transaction not found');
    
    // Verify owner owns the job in this transaction
    if (txn.ownerId !== ownerProfile.id) {
      return fail(res, 403, 'You do not have permission to view this transaction');
    }

    ok(res, txn, 'Transaction details retrieved');
  } catch (e) { next(e); }
});

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

app.get('/api/notifications', auth, async (req, res, next) => {
  try {
    const r = await collection('notifications').find({recipient_id: req.user.id}).sort({created_at: -1}).toArray();
    ok(res, r.map(x => ({...x, isRead: !!x.is_read})));
  } catch (e) { next(e); }
});

app.get('/api/notifications/unread-count', auth, async (req, res, next) => {
  try {
    const count = await collection('notifications').countDocuments({recipient_id: req.user.id, is_read: false});
    ok(res, count);
  } catch (e) { next(e); }
});

app.put('/api/notifications/:id/read', auth, async (req, res, next) => {
  try {
    await collection('notifications').updateOne(
      {id: toId(req.params.id), recipient_id: req.user.id}, {$set: {is_read: true}}
    );
    ok(res, null, 'Notification marked as read');
  } catch (e) { next(e); }
});

app.put('/api/notifications/read-all', auth, async (req, res, next) => {
  try {
    await collection('notifications').updateMany({recipient_id: req.user.id}, {$set: {is_read: true}});
    ok(res, null, 'All notifications marked as read');
  } catch (e) { next(e); }
});

// ─── REPORTS / COMPLAINTS ───────────────────────────────────────────────────

app.post('/api/reports', auth, async (req, res, next) => {
  try {
    const b = req.body;
    const result = await transaction(async session => {
      const [applicationRow] = await fetchApplications({id: toId(b.applicationId)}, {}, session);
      const jobRow = applicationRow && await collection('catering_jobs').findOne({id: applicationRow.job_id}, {session});
      const ownerProfile = jobRow && await collection('owner_profiles').findOne({id: jobRow.owner_id}, {session});
      const ownerUser = ownerProfile && await collection('users').findOne({id: ownerProfile.user_id}, {session});
      const target = applicationRow?.student_user_id === req.user.id && ownerUser ? {owner_user_id: ownerUser.id, title: jobRow.title} : null;
      if (!target) throw Object.assign(new Error('Application not found or not owned by student'), {status: 404});
      const created = await insertDocument('reports', {
        reporter_id: req.user.id, target_user_id: target.owner_user_id,
        job_id: jobRow.id, application_id: applicationRow.id, report_type: b.reportType,
        description: b.description, expected_amount: b.expectedAmount || null,
        received_amount: b.receivedAmount || null, evidence_notes: b.evidenceNotes || null,
        status: 'PENDING', admin_remarks: null
      }, session);
      await insertDocument('notifications', {
        recipient_id: target.owner_user_id, title: 'Student Complaint Received',
        message: `A student submitted a complaint about "${target.title}". Please review it and cooperate with platform administrators.`,
        type: 'REPORT_SUBMITTED', related_entity_id: created.id, is_read: false
      }, session);
      return created.id;
    });
    ok(res, {id: result}, 'Report submitted to the owner and platform administrators.');
  } catch (e) { next(e); }
});

app.get('/api/reports/my-reports', auth, async (req, res, next) => {
  try {
    const r = await collection('reports').find({reporter_id: req.user.id}).toArray();
    ok(res, r);
  } catch (e) { next(e); }
});

// FIXED: Admin reports endpoint now includes target user details (name, email, catering name)
app.get('/api/admin/reports', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const r = await collection('reports').aggregate([
      {$lookup: {from: 'users', localField: 'reporter_id', foreignField: 'id', as: 'reporter'}}, {$unwind: '$reporter'},
      {$lookup: {from: 'users', localField: 'target_user_id', foreignField: 'id', as: 'target'}}, {$unwind: '$target'},
      {$lookup: {from: 'owner_profiles', localField: 'target_user_id', foreignField: 'user_id', as: 'owner'}}, {$unwind: {path: '$owner', preserveNullAndEmptyArrays: true}},
      {$set: {reporter_name: '$reporter.full_name', reporter_email: '$reporter.email', target_user_name: '$target.full_name', target_user_email: '$target.email', target_catering_name: '$owner.catering_name'}},
      {$unset: ['reporter', 'target', 'owner']}, {$sort: {created_at: -1}}
    ]).toArray();
    ok(res, r.map(x => ({
      ...x,
      reporterName: x.reporter_name,
      reporterEmail: x.reporter_email,
      targetUserName: x.target_user_name,
      targetUserEmail: x.target_user_email,
      targetCateringName: x.target_catering_name,
      reportTypeDisplayName: x.report_type
    })));
  } catch (e) { next(e); }
});

app.put('/api/admin/reports/:id/resolve', auth, guard('ROLE_ADMIN'), async (req, res, next) => {
  try {
    const report = await collection('reports').findOneAndUpdate(
      {id: toId(req.params.id)},
      {$set: {status: req.body.status, admin_remarks: req.body.adminRemarks || null, resolved_at: new Date().toISOString()}},
      {returnDocument: 'after'}
    );
    ok(res, report, 'Report resolved successfully');
  } catch (e) { next(e); }
});

app.delete('/api/reports/:id', auth, async (req, res, next) => {
  try {
    const result = await transaction(async session => {
      const report = await collection('reports').findOne(
        {id: toId(req.params.id), reporter_id: req.user.id}, {session}
      );
      if (!report) throw Object.assign(new Error('Complaint not found'), {status: 404});
      await collection('reports').deleteOne({id: report.id, reporter_id: req.user.id}, {session});
      await collection('complaint_messages').deleteMany({report_id: report.id}, {session});
      await insertDocument('notifications', {
        recipient_id: report.target_user_id, title: 'Complaint Withdrawn',
        message: 'The student withdrew the complaint. It has been removed from your complaints list.',
        type: 'REPORT_WITHDRAWN', related_entity_id: report.id, is_read: false
      }, session);
      return report.id;
    });
    ok(res, {id: result}, 'Complaint withdrawn successfully.');
  } catch (e) { next(e); }
});

// ─── FILE UPLOAD ─────────────────────────────────────────────────────────────

app.post('/api/upload/image', auth, upload.single('image'), (req, res, next) => {
  try {
    if (!req.file) {
      console.error('[UPLOAD] No file received. Body keys:', Object.keys(req.body || {}));
      return fail(res, 400, 'No image file uploaded. Please select an image file under 5MB.');
    }
    const url = `/uploads/${req.file.filename}`;
    console.log('[UPLOAD] File saved:', req.file.filename, 'URL:', url);
    ok(res, {url}, 'Image uploaded successfully');
  } catch (e) {
    console.error('[UPLOAD] Error:', e.message);
    next(e);
  }
});
// Multer + general error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('[UPLOAD] Multer error:', err.code, err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 400, 'File too large. Maximum size is 5MB.');
    return fail(res, 400, 'Upload failed: ' + err.message);
  }
  if (err.message && err.message.includes('image')) {
    console.error('[UPLOAD] Image filter error:', err.message);
    return fail(res, 400, err.message);
  }
  next(err);
});

// ─── FORGOT PASSWORD ───────────────────────────────────────────────────────

const resetChallenges = new Map();

app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address');
    const user = await collection('users').findOne({email}, {projection: {id: 1, email: 1}});
    if (!user) return fail(res, 404, 'No account found with that email');
    const id = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1000000));
    await sendEmailOtp(email, code);
    resetChallenges.set(id, {email, code, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0});
    ok(res, {verificationId: id, expiresInSeconds: 600}, 'Password reset code sent to your email');
  } catch (e) { next(e); }
});

app.post('/api/auth/forgot-password/verify', async (req, res, next) => {
  try {
    const challenge = resetChallenges.get(req.body.verificationId);
    const otp = String(req.body.otp || '');
    if (!challenge || challenge.expiresAt < Date.now()) return fail(res, 400, 'Request a new reset code');
    if (!/^\d{6}$/.test(otp)) return fail(res, 400, 'OTP must contain exactly 6 digits');
    if (challenge.attempts >= 5) return fail(res, 429, 'Too many incorrect codes. Request a new code');
    if (otp !== challenge.code) { challenge.attempts++; return fail(res, 400, 'Incorrect verification code'); }
    challenge.verified = true;
    ok(res, null, 'Email verified successfully');
  } catch (e) { next(e); }
});

app.post('/api/auth/forgot-password/reset', async (req, res, next) => {
  try {
    const challenge = resetChallenges.get(req.body.verificationId);
    if (!challenge || !challenge.verified) return fail(res, 400, 'Please verify your email first');
    const newPassword = String(req.body.password || '');
    if (!newPassword || newPassword.length < 6) return fail(res, 400, 'Password must be at least 6 characters');
    const hash = await bcrypt.hash(newPassword, 10);
    await collection('users').updateOne({email: challenge.email}, {$set: {password_hash: hash, updated_at: new Date().toISOString()}});
    resetChallenges.delete(req.body.verificationId);
    ok(res, null, 'Password reset successful! You can now sign in with your new password.');
  } catch (e) { next(e); }
});

// ─── DELETE ACCOUNT ─────────────────────────────────────────────────────────

app.delete('/api/account', auth, async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (!password) return fail(res, 400, 'Password is required to delete your account');
    const user = await collection('users').findOne({id: req.user.id}, {projection: {id: 1, password_hash: 1, role: 1}});
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return fail(res, 401, 'Incorrect password');
    if (user.role === 'ROLE_ADMIN') return fail(res, 403, 'Admin accounts cannot be deleted');
    const student = await collection('student_profiles').findOne({user_id: req.user.id});
    const owner = await collection('owner_profiles').findOne({user_id: req.user.id});
    await transaction(async session => {
      if (student) {
        const applications = await collection('job_applications').find({student_id: student.id}, {session, projection: {id: 1}}).toArray();
        await collection('payment_records').deleteMany({student_id: student.id}, {session});
        await collection('job_applications').deleteMany({student_id: student.id}, {session});
        if (applications.length) await collection('reports').updateMany(
          {application_id: {$in: applications.map(row => row.id)}}, {$set: {application_id: null}}, {session}
        );
        await collection('student_profiles').deleteOne({id: student.id}, {session});
      }
      if (owner) {
        const jobs = await collection('catering_jobs').find({owner_id: owner.id}, {session, projection: {id: 1}}).toArray();
        for (const jobRow of jobs) await deleteJob(jobRow.id, session);
        await collection('payment_records').deleteMany({owner_id: owner.id}, {session});
        await collection('owner_profiles').deleteOne({id: owner.id}, {session});
      }
      await Promise.all([
        collection('notifications').deleteMany({recipient_id: req.user.id}, {session}),
        collection('reports').deleteMany({$or: [{reporter_id: req.user.id}, {target_user_id: req.user.id}]}, {session}),
        collection('users').deleteOne({id: req.user.id}, {session})
      ]);
    });
    ok(res, null, 'Account deleted successfully');
  } catch (e) { next(e); }
});

// ─── STATIC FILES & ERROR HANDLING ───────────────────────────────────────────


// ─── JOB LIFECYCLE: DEADLINE DETECTION ──────────────────────────────────────

async function detectDeadlinePassedJobs() {
  try {
    const jobs = await collection('catering_jobs').aggregate([
      {$match: {status: 'OPEN', apply_deadline: {$ne: null, $lte: new Date().toISOString()}, $expr: {$lt: ['$workers_selected', '$workers_required']}, owner_decision: {$ne: 'CONTINUE'}}},
      {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}}, {$unwind: '$owner'},
      {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}}, {$unwind: '$owner_user'},
      {$set: {owner_user_id: '$owner_user.id'}}, {$unset: ['owner', 'owner_user']}
    ]).toArray();
    for (const j of jobs) {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const existingNotif = await collection('notifications').findOne({
        recipient_id: j.owner_user_id, type: 'DEADLINE_REACHED', related_entity_id: j.id, created_at: {$gt: yesterday}
      }, {projection: {id: 1}});
      if (!existingNotif) {
        await insertDocument('notifications', {
          recipient_id: j.owner_user_id, title: 'Application Deadline Reached',
          message: `Your job has not received all required workers (${j.workers_selected}/${j.workers_required}). Please choose whether to continue or remove the job.`,
          type: 'DEADLINE_REACHED', related_entity_id: j.id, is_read: false
        });
      }
    }
  } catch (e) {
    console.error('[LIFECYCLE] Deadline detection error:', e.message);
  }
}
setInterval(detectDeadlinePassedJobs, 5 * 60 * 1000);

app.put('/api/owner/jobs/:id/decision', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const { decision } = req.body;
    if (!decision || !['CONTINUE', 'REMOVE'].includes(decision.toUpperCase())) {
      return fail(res, 400, 'Decision must be CONTINUE or REMOVE');
    }
    const jobRec = await collection('catering_jobs').findOne({id: toId(req.params.id), owner_id: oid});
    if (!jobRec) return fail(res, 404, 'Job not found');
    const now = new Date().toISOString();
    if (decision.toUpperCase() === 'CONTINUE') {
      const jobId = toId(req.params.id);
      await collection('catering_jobs').updateOne({id: jobId}, {$set: {owner_decision: 'CONTINUE', owner_decision_at: now}});
      const acceptedApps = await fetchApplications({job_id: jobId, status: 'ACCEPTED'});
      for (const app of acceptedApps) {
        await insertDocument('notifications', {recipient_id: app.student_user_id, title: 'Job Confirmed', message: 'The owner confirmed the job will proceed.', type: 'JOB_CONTINUED', related_entity_id: jobRec.id, is_read: false});
      }
      ok(res, null, 'Job continued successfully');
    } else {
      const jobId = toId(req.params.id);
      await collection('catering_jobs').updateOne({id: jobId}, {$set: {owner_decision: 'REMOVED', owner_decision_at: now, status: 'REMOVED'}});
      await collection('job_applications').updateMany({job_id: jobId, status: 'APPLIED'}, {$set: {status: 'CANCELLED', updated_at: now}});
      const pendingApps = await fetchApplications({job_id: jobId});
      for (const app of pendingApps) {
        await insertDocument('notifications', {recipient_id: app.student_user_id, title: 'Job Removed', message: 'The job has been removed by the owner.', type: 'JOB_REMOVED', related_entity_id: jobRec.id, is_read: false});
      }
      ok(res, null, 'Job removed successfully');
    }
  } catch (e) { next(e); }
});

app.put('/api/owner/jobs/:id/remove', auth, guard('ROLE_OWNER'), async (req, res, next) => {
  try {
    const oid = await ownerId(req);
    const jobRec = await collection('catering_jobs').findOne({id: toId(req.params.id), owner_id: oid});
    if (!jobRec) return fail(res, 404, 'Job not found');
    if (jobRec.status === 'REMOVED') return fail(res, 400, 'Job is already removed');
    const now = new Date().toISOString();
    const jobId = toId(req.params.id);
    await collection('catering_jobs').updateOne({id: jobId}, {$set: {owner_decision: 'REMOVED', owner_decision_at: now, status: 'REMOVED'}});
    await collection('job_applications').updateMany({job_id: jobId, status: 'APPLIED'}, {$set: {status: 'CANCELLED', updated_at: now}});
    const allApps = await fetchApplications({job_id: jobId});
    for (const app of allApps) {
      await insertDocument('notifications', {recipient_id: app.student_user_id, title: 'Job Removed', message: 'The job has been removed by the owner.', type: 'JOB_REMOVED', related_entity_id: jobRec.id, is_read: false});
    }
    ok(res, null, 'Job removed successfully');
  } catch (e) { next(e); }
});

async function checkPaymentTiming(applicationId) {
  const applicationRow = await collection('job_applications').findOne({id: toId(applicationId)});
  const jobRow = applicationRow && await collection('catering_jobs').findOne({id: applicationRow.job_id});
  const app = jobRow && {...applicationRow, job_date: jobRow.job_date, end_time: jobRow.end_time};
  if (!app) throw Object.assign(new Error('Application not found'), {status: 404});
  const jobDateTime = new Date(app.job_date + 'T' + (app.end_time || '23:59:59'));
  const paymentAvailableAt = new Date(jobDateTime.getTime() - 60 * 60 * 1000);
  if (new Date() < paymentAvailableAt) {
    throw Object.assign(new Error('Payment is not available yet. It becomes available 1 hour before job completion.'), {status: 400});
  }
  return true;
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(staticDir));
// Wire up Razorpay routes (some require auth, some don't - handled in routes)
app.use('/', razorpayRouter);
// Razorpay webhook needs raw body - mount before JSON parser for this specific route  
app.post('/api/razorpay/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    if (webhookSecret) {
      const signature = req.headers['x-razorpay-signature'];
      const body = typeof req.body === 'string' ? req.body : req.body.toString();
      const expectedSig = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
      if (signature !== expectedSig) return res.status(400).json({message: 'Invalid signature'});
    }
    const event = JSON.parse(typeof req.body === 'string' ? req.body : req.body.toString());
    console.log('[RAZORPAY] Webhook:', event.event);
    if (event.event === 'payment.captured') {
      const p = event.payload.payment.entity;
      const rec = await collection('payment_records').findOne({razorpay_order_id: p.order_id, payment_status: {$ne: 'SUCCESS'}});
      if (rec) {
        await transaction(async session => {
          const now = new Date().toISOString();
          await collection('payment_records').updateOne(
            {id: rec.id, payment_status: {$ne: 'SUCCESS'}},
            {$set: {razorpay_payment_id: p.id || rec.razorpay_payment_id, payment_status: 'SUCCESS', payment_method: p.method, confirmed_paid_at: now, updated_at: now}},
            {session}
          );
          await collection('job_applications').updateOne(
            {id: rec.application_id, payment_status: {$ne: 'SUCCESS'}},
            {$set: {payment_status: 'SUCCESS', payment_confirmation_date: now, updated_at: now}}, {session}
          );
        });
      }
    } else if (event.event === 'payment.failed') {
      const p = event.payload.payment.entity;
      const failReason = p.error_description || p.error_reason || null;
      await collection('payment_records').updateOne(
        {razorpay_order_id: p.order_id, payment_status: 'CREATED'},
        {$set: {payment_status: 'FAILED', failure_reason: failReason, updated_at: new Date().toISOString()}}
      );
    } else if (event.event === 'refund.created' || event.event === 'refund.processed') {
      const r = event.payload.refund.entity;
      if (r.payment_id) {
        await collection('payment_records').updateOne(
          {razorpay_payment_id: r.payment_id, payment_status: {$in: ['SUCCESS', 'CONFIRMED']}},
          {$set: {payment_status: 'REFUNDED', updated_at: new Date().toISOString()}}
        );
        console.log('[RAZORPAY] Webhook: refund processed for payment', r.payment_id);
      }
    }
    res.json({status: 'ok'});
  } catch (e) { console.error('[RAZORPAY] Webhook error:', e.message); res.json({status: 'ok'}); }
});
app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
app.use((e, req, res, next) => { console.error(e); fail(res, e.status || 500, e.status ? e.message : 'Internal server error'); });

// ─── START ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  initializeDatabase().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`PartTime Job Platform listening on http://0.0.0.0:${PORT}`)))
    .catch(e => { console.error('Database initialization failed:', e.message); process.exitCode = 1; });
}

module.exports = app;
