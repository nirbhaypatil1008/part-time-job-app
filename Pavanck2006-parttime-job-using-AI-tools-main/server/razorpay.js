const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const {collection, toId, transaction} = require('./db');
const {createOrUpdateTransaction, updateTransactionStatus} = require('./transactions');

const router = express.Router();
function paymentPipeline(match, limit) {
  return [
    {$match: match},
    {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}}, {$unwind: {path: '$job', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}}, {$unwind: {path: '$owner', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}}, {$unwind: {path: '$owner_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'student_profiles', localField: 'student_id', foreignField: 'id', as: 'student'}}, {$unwind: {path: '$student', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'student.user_id', foreignField: 'id', as: 'student_user'}}, {$unwind: {path: '$student_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'job_applications', localField: 'application_id', foreignField: 'id', as: 'application'}}, {$unwind: {path: '$application', preserveNullAndEmptyArrays: true}},
    {$set: {
      job_title: '$job.title', work_area: '$job.work_area', job_date: '$job.job_date',
      start_time: '$job.start_time', end_time: '$job.end_time', job_payment_amount: '$job.payment_amount',
      job_payment_type: '$job.payment_type', owner_catering_name: '$owner.catering_name',
      owner_name: '$owner_user.full_name', student_name: '$student_user.full_name',
      student_email: '$student_user.email', student_phone: '$student_user.phone',
      student_user_id: '$student_user.id', owner_user_id: '$owner_user.id',
      college_name: '$student.college_name', skills: '$student.skills', app_status: '$application.status'
    }},
    {$unset: ['job', 'owner', 'owner_user', 'student', 'student_user', 'application']},
    {$sort: {created_at: -1}},
    ...(limit ? [{$limit: limit}] : [])
  ];
}
// Auth middleware for protected routes
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'development-secret-change-me';
async function rpAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({message: 'Authentication is required'});
    const c = jwt.verify(token, SECRET);
    const user = await collection('users').findOne({id: toId(c.id)});
    if (!user || !user.is_active || user.is_suspended) return res.status(401).json({message: 'Account is inactive or suspended'});
    req.user = user;
    next();
  } catch { return res.status(401).json({message: 'Invalid or expired token'}); }
}


// ─── Razorpay client (lazy init) ──────────────────────────────────────────────
let razorpay = null;
function getRazorpay() {
  if (razorpay) return razorpay;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw Object.assign(new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'), {status: 503});
  razorpay = new Razorpay({key_id: keyId, key_secret: keySecret});
  return razorpay;
}

// ─── Helper: verify Razorpay signature ────────────────────────────────────────
function verifySignature(orderId, paymentId, signature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return false;
  const body = orderId + '|' + paymentId;
  const expectedSig = crypto.createHmac('sha256', keySecret).update(body).digest('hex');
  return expectedSig === signature;
}

// ─── Helper: get auth middleware (reuse from parent server) ────────────────────
// We export these routes expecting auth middleware to be applied in parent

// ─── GET /api/public/razorpay-key ─────────────────────────────────────────────
// Returns Razorpay key_id for frontend checkout (never expose secret)
router.get('/api/public/razorpay-key', (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  res.json({data: {keyId, configured: !!keyId}});
});

// ─── POST /api/student/razorpay/create-order ──────────────────────────────────
// Creates a Razorpay order for a payment record
router.post('/api/student/razorpay/create-order', rpAuth, async (req, res) => {
  try {
    const {paymentRecordId} = req.body;
    if (!paymentRecordId) return res.status(400).json({message: 'paymentRecordId is required'});

    const rp = getRazorpay();

    // Get payment record and validate ownership
    const profile = await collection('student_profiles').findOne({user_id: req.user.id});
    const record = await collection('payment_records').findOne({id: toId(paymentRecordId), student_id: profile?.id});
    const application = record && await collection('job_applications').findOne({id: record.application_id});
    if (record) record.app_status = application?.status;

    if (!record) return res.status(404).json({message: 'Payment record not found'});
    if (record.app_status !== 'ACCEPTED') return res.status(400).json({message: 'Application is not accepted'});
    if (record.payment_status === 'SUCCESS' || record.payment_status === 'CONFIRMED')
      return res.status(400).json({message: 'This job is already paid for'});

    // Check if there's already a CREATED order that hasn't expired (within 15 min)
    if (record.razorpay_order_id && record.payment_status === 'CREATED') {
      const orderAge = Date.now() - new Date(record.created_at).getTime();
      if (orderAge < 15 * 60 * 1000) {
        // Return existing order
        return res.json({data: {
          orderId: record.razorpay_order_id,
          amount: Number(record.amount) * 100,
          currency: 'INR',
          paymentRecordId: record.id,
          jobTitle: record.payment_type
        }});
      }
    }

    // Get job title for the receipt
    const job = await collection('catering_jobs').findOne({id: record.job_id}, {projection: {title: 1}});
    const amountPaise = Math.round(Number(record.amount) * 100);

    // Create Razorpay order
    const order = await rp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `ptjob_pr${record.id}_j${record.job_id}`,
      notes: {jobId: String(record.job_id), studentId: String(record.student_id)}
    });

    // Update payment record with order ID
    await collection('payment_records').updateOne(
      {id: record.id},
      {$set: {razorpay_order_id: order.id, payment_status: 'CREATED', environment: 'TEST', razorpay_receipt: order.receipt || null, updated_at: new Date().toISOString()}}
    );

    res.json({data: {
      orderId: order.id,
      amount: amountPaise,
      currency: 'INR',
      paymentRecordId: record.id,
      jobTitle: job ? job.title : 'Job'
    }});
  } catch (e) {
    console.error('[RAZORPAY] create-order error:', e.message);
    res.status(e.status || 500).json({message: e.message || 'Failed to create payment order'});
  }
});

// ─── POST /api/student/razorpay/verify ────────────────────────────────────────
// Verifies Razorpay payment signature and updates transaction
router.post('/api/student/razorpay/verify', rpAuth, async (req, res) => {
  try {
    const {razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentRecordId} = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentRecordId)
      return res.status(400).json({message: 'Missing required payment verification fields'});

    // Verify signature
    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature))
      return res.status(400).json({message: 'Invalid payment signature'});

    // Get payment record and validate
    const profile = await collection('student_profiles').findOne({user_id: req.user.id});
    const record = await collection('payment_records').findOne({id: toId(paymentRecordId), student_id: profile?.id});

    if (!record) return res.status(404).json({message: 'Payment record not found'});
    if (record.payment_status === 'SUCCESS' || record.payment_status === 'CONFIRMED')
      return res.status(400).json({message: 'Already verified'});

    // Verify the order_id matches
    if (record.razorpay_order_id !== razorpay_order_id)
      return res.status(400).json({message: 'Order ID mismatch'});

    // Try to fetch payment details from Razorpay to get method
    let paymentMethod = null;
    try {
      const rp = getRazorpay();
      const payment = await rp.payments.fetch(razorpay_payment_id);
      paymentMethod = payment.method || null;
    } catch (e) {
      console.error('[RAZORPAY] Could not fetch payment details:', e.message);
    }

    // Update in transaction
    await transaction(async session => {
      const now = new Date().toISOString();
      await collection('payment_records').updateOne(
        {id: record.id}, {$set: {razorpay_payment_id, razorpay_signature, payment_status: 'SUCCESS', payment_method: paymentMethod, confirmed_paid_at: now, updated_at: now}}, {session}
      );
      await collection('job_applications').updateOne(
        {id: record.application_id}, {$set: {payment_status: 'SUCCESS', payment_confirmation_date: now, updated_at: now}}, {session}
      );
    });

    res.json({data: {
      success: true,
      paymentRecordId: record.id,
      razorpay_payment_id,
      paymentMethod
    }, message: 'Payment verified successfully!'});
  } catch (e) {
    console.error('[RAZORPAY] verify error:', e.message);
    res.status(e.status || 500).json({message: e.message || 'Payment verification failed'});
  }
});

// ─── POST /api/student/razorpay/cancel ────────────────────────────────────────
// Marks a CREATED payment as CANCELLED (user closed checkout)
router.post('/api/student/razorpay/cancel', rpAuth, async (req, res) => {
  try {
    const {paymentRecordId} = req.body;
    if (!paymentRecordId) return res.status(400).json({message: 'paymentRecordId is required'});

    const profile = await collection('student_profiles').findOne({user_id: req.user.id});
    const record = await collection('payment_records').findOne({id: toId(paymentRecordId), student_id: profile?.id});

    if (!record) return res.status(404).json({message: 'Payment record not found'});
    if (record.payment_status !== 'CREATED')
      return res.status(400).json({message: 'Only pending orders can be cancelled'});

    await collection('payment_records').updateOne(
      {id: record.id}, {$set: {payment_status: 'CANCELLED', updated_at: new Date().toISOString()}}
    );
    res.json({data: null, message: 'Payment cancelled'});
  } catch (e) {
    console.error('[RAZORPAY] cancel error:', e.message);
    res.status(500).json({message: 'Failed to cancel payment'});
  }
});

// ─── POST /api/razorpay/webhook ───────────────────────────────────────────────
// Razorpay webhook handler (no auth required, uses signature verification)
router.post('/api/razorpay/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn('[RAZORPAY] Webhook secret not configured, skipping verification');
    }

    // Verify webhook signature if secret is set
    if (webhookSecret) {
      const signature = req.headers['x-razorpay-signature'];
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const expectedSig = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
      if (signature !== expectedSig) {
        console.error('[RAZORPAY] Invalid webhook signature');
        return res.status(400).json({message: 'Invalid signature'});
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    console.log('[RAZORPAY] Webhook received:', event.event);

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const method = payment.method;

      // Find and update the payment record (idempotent)
      const record = await collection('payment_records').findOne(
        {razorpay_order_id: orderId, payment_status: {$ne: 'SUCCESS'}}
      );

      if (record) {
        await transaction(async session => {
          const now = new Date().toISOString();
          await collection('payment_records').updateOne(
            {id: record.id, payment_status: {$ne: 'SUCCESS'}},
            {$set: {razorpay_payment_id: paymentId || record.razorpay_payment_id, payment_status: 'SUCCESS', payment_method: method, confirmed_paid_at: now, updated_at: now}},
            {session}
          );
          await collection('job_applications').updateOne(
            {id: record.application_id, payment_status: {$ne: 'SUCCESS'}},
            {$set: {payment_status: 'SUCCESS', payment_confirmation_date: now, updated_at: now}}, {session}
          );
        });
        console.log('[RAZORPAY] Webhook: payment confirmed for record', record.id);
      }
    } else if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      await collection('payment_records').updateOne(
        {razorpay_order_id: orderId, payment_status: 'CREATED'},
        {$set: {payment_status: 'FAILED', updated_at: new Date().toISOString()}}
      );
      console.log('[RAZORPAY] Webhook: payment failed for order', orderId);
    }

    res.json({status: 'ok'});
  } catch (e) {
    console.error('[RAZORPAY] Webhook error:', e.message);
    res.status(500).json({message: 'Webhook processing error'});
  }
});

// ─── GET /api/student/razorpay/transactions ───────────────────────────────────────────────────────
// Student transaction history with Razorpay details
router.get('/api/student/razorpay/transactions', rpAuth, async (req, res) => {
  try {
    const profile = await collection('student_profiles').findOne({user_id: req.user.id});
    const rows = await collection('payment_records').aggregate(paymentPipeline({student_id: profile?.id})).toArray();
    res.json({data: rows.map(r => ({
      id: r.id, applicationId: r.application_id, jobId: r.job_id,
      amount: r.amount, paymentType: r.payment_type,
      paymentStatus: r.payment_status,
      razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id,
      environment: r.environment, paymentMethod: r.payment_method,
      createdAt: r.created_at, confirmedPaidAt: r.confirmed_paid_at,
      jobTitle: r.job_title, workArea: r.work_area,
      ownerCateringName: r.owner_catering_name,
      appStatus: r.app_status
    }))});
  } catch (e) {
    console.error('[RAZORPAY] transactions error:', e.message);
    res.status(500).json({message: 'Failed to fetch transactions'});
  }
});

// ─── GET /api/owner/razorpay/transactions ─────────────────────────────────────────────────────────
// Owner transaction history
router.get('/api/owner/razorpay/transactions', rpAuth, async (req, res) => {
  try {
    const op = await collection('owner_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!op) return res.json({data: []});

    const rows = await collection('payment_records').aggregate(paymentPipeline({owner_id: op.id})).toArray();
    res.json({data: rows.map(r => ({
      id: r.id, applicationId: r.application_id, jobId: r.job_id,
      amount: r.amount, paymentType: r.payment_type,
      paymentStatus: r.payment_status,
      razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id,
      environment: r.environment, paymentMethod: r.payment_method,
      createdAt: r.created_at, confirmedPaidAt: r.confirmed_paid_at,
      markedPaidAt: r.marked_paid_at,
      jobTitle: r.job_title, workArea: r.work_area,
      studentName: r.student_name, studentEmail: r.student_email,
      studentPhone: r.student_phone, collegeName: r.college_name,
      jobDate: r.job_date
    }))});
  } catch (e) {
    console.error('[RAZORPAY] owner transactions error:', e.message);
    res.status(500).json({message: 'Failed to fetch transactions'});
  }
});



// ─── GET /api/student/razorpay/transactions/:id ─────────────────────────────
// Single transaction detail for student
router.get('/api/student/razorpay/transactions/:id', rpAuth, async (req, res) => {
  try {
    const [row] = await collection('payment_records').aggregate(
      paymentPipeline({id: toId(req.params.id)})
    ).toArray();
    if (row?.student_user_id !== req.user.id) return res.status(404).json({message: 'Transaction not found'});
    if (!row) return res.status(404).json({message: 'Transaction not found'});
    res.json({data: {
      id: row.id, applicationId: row.application_id, jobId: row.job_id,
      amount: row.amount, currency: 'INR',
      paymentType: row.payment_type, paymentStatus: row.payment_status,
      razorpayOrderId: row.razorpay_order_id, razorpayPaymentId: row.razorpay_payment_id,
      razorpaySignature: row.razorpay_signature ? '***' : null,
      environment: row.environment, paymentMethod: row.payment_method,
      createdAt: row.created_at, confirmedPaidAt: row.confirmed_paid_at,
      markedPaidAt: row.marked_paid_at, updatedAt: row.updated_at,
      jobTitle: row.job_title, workArea: row.work_area,
      jobDate: row.job_date, startTime: row.start_time, endTime: row.end_time,
      ownerCateringName: row.owner_catering_name, ownerName: row.owner_name,
      studentName: row.student_name, studentEmail: row.student_email,
      studentPhone: row.student_phone, collegeName: row.college_name
    }});
  } catch (e) {
    console.error('[RAZORPAY] transaction detail error:', e.message);
    res.status(500).json({message: 'Failed to fetch transaction detail'});
  }
});

// ─── GET /api/owner/razorpay/transactions/:id ────────────────────────────────
// Single transaction detail for owner
router.get('/api/owner/razorpay/transactions/:id', rpAuth, async (req, res) => {
  try {
    const op = await collection('owner_profiles').findOne({user_id: req.user.id}, {projection: {id: 1}});
    if (!op) return res.status(404).json({message: 'Owner profile not found'});
    const [row] = await collection('payment_records').aggregate(
      paymentPipeline({id: toId(req.params.id), owner_id: op.id})
    ).toArray();
    if (!row) return res.status(404).json({message: 'Transaction not found'});
    res.json({data: {
      id: row.id, applicationId: row.application_id, jobId: row.job_id,
      amount: row.amount, currency: 'INR',
      paymentType: row.payment_type, paymentStatus: row.payment_status,
      razorpayOrderId: row.razorpay_order_id, razorpayPaymentId: row.razorpay_payment_id,
      environment: row.environment, paymentMethod: row.payment_method,
      createdAt: row.created_at, confirmedPaidAt: row.confirmed_paid_at,
      markedPaidAt: row.marked_paid_at, updatedAt: row.updated_at,
      jobTitle: row.job_title, workArea: row.work_area,
      jobDate: row.job_date, startTime: row.start_time, endTime: row.end_time,
      ownerCateringName: row.owner_catering_name,
      studentName: row.student_name, studentEmail: row.student_email,
      studentPhone: row.student_phone, collegeName: row.college_name, skills: row.skills
    }});
  } catch (e) {
    console.error('[RAZORPAY] owner transaction detail error:', e.message);
    res.status(500).json({message: 'Failed to fetch transaction detail'});
  }
});

// ─── GET /api/admin/razorpay/transactions ────────────────────────────────────
// Admin can view all transactions
router.get('/api/admin/razorpay/transactions', rpAuth, async (req, res) => {
  if (req.user.role !== 'ROLE_ADMIN') return res.status(403).json({message: 'Admin only'});
  try {
    const rows = await collection('payment_records').aggregate(paymentPipeline({}, 200)).toArray();
    res.json({data: rows.map(r => ({
      id: r.id, applicationId: r.application_id, jobId: r.job_id,
      amount: r.amount, paymentType: r.payment_type,
      paymentStatus: r.payment_status,
      razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id,
      environment: r.environment, paymentMethod: r.payment_method,
      createdAt: r.created_at, confirmedPaidAt: r.confirmed_paid_at,
      jobTitle: r.job_title, workArea: r.work_area,
      studentName: r.student_name, studentEmail: r.student_email,
      ownerCateringName: r.owner_catering_name, ownerName: r.owner_name
    }))});
  } catch (e) {
    console.error('[RAZORPAY] admin transactions error:', e.message);
    res.status(500).json({message: 'Failed to fetch admin transactions'});
  }
});

module.exports = router;
