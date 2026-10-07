const {collection} = require('./db');

function dateFilter(filters, field) {
  const match = {};
  if (filters.fromDate || filters.toDate) {
    match[field] = {};
    for (const value of [filters.fromDate, filters.toDate].filter(Boolean)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
        throw Object.assign(new Error('Dates must use YYYY-MM-DD format'), {status: 400});
      }
    }
    if (filters.fromDate) match[field].$gte = `${filters.fromDate}T00:00:00.000Z`;
    if (filters.toDate) match[field].$lt = new Date(new Date(`${filters.toDate}T00:00:00.000Z`).getTime() + 86400000).toISOString();
  }
  return match;
}

function transactionJoins() {
  return [
    {$lookup: {from: 'catering_jobs', localField: 'job_id', foreignField: 'id', as: 'job'}},
    {$unwind: {path: '$job', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'student_profiles', localField: 'student_id', foreignField: 'id', as: 'student'}},
    {$unwind: {path: '$student', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'student.user_id', foreignField: 'id', as: 'student_user'}},
    {$unwind: {path: '$student_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'owner_profiles', localField: 'owner_id', foreignField: 'id', as: 'owner'}},
    {$unwind: {path: '$owner', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'users', localField: 'owner.user_id', foreignField: 'id', as: 'owner_user'}},
    {$unwind: {path: '$owner_user', preserveNullAndEmptyArrays: true}},
    {$lookup: {from: 'job_applications', localField: 'application_id', foreignField: 'id', as: 'application'}},
    {$unwind: {path: '$application', preserveNullAndEmptyArrays: true}},
    {$set: {
      job_title: '$job.title', work_area: '$job.work_area', work_type: '$job.work_type',
      student_name: '$student_user.full_name', student_email: '$student_user.email',
      student_user_id: '$student_user.id', college_name: '$student.college_name',
      owner_name: '$owner_user.full_name', owner_email: '$owner_user.email',
      owner_user_id: '$owner_user.id', catering_name: '$owner.catering_name',
      application_status: '$application.status'
    }},
    {$unset: ['job', 'student', 'student_user', 'owner', 'owner_user', 'application']}
  ];
}

function formatTransaction(txn) {
  return {
    transactionId: txn.transaction_id,
    paymentRecordId: txn.id,
    applicationId: txn.application_id,
    jobId: txn.job_id,
    jobTitle: txn.job_title,
    workArea: txn.work_area,
    workType: txn.work_type,
    studentId: txn.student_id,
    studentName: txn.student_name,
    studentEmail: txn.student_email,
    studentUserId: txn.student_user_id,
    collegeName: txn.college_name,
    ownerId: txn.owner_id,
    ownerName: txn.owner_name,
    ownerEmail: txn.owner_email,
    ownerUserId: txn.owner_user_id,
    cateringName: txn.catering_name,
    amount: txn.amount,
    currency: txn.currency || 'INR',
    paymentType: txn.payment_type,
    paymentStatus: txn.payment_status,
    razorpayOrderId: txn.razorpay_order_id,
    razorpayPaymentId: txn.razorpay_payment_id,
    paymentMethod: txn.payment_method,
    failureReason: txn.failure_reason,
    environment: txn.environment,
    applicationStatus: txn.application_status,
    createdAt: txn.created_at,
    initiatedAt: txn.initiated_at,
    markedPaidAt: txn.marked_paid_at,
    confirmedPaidAt: txn.confirmed_paid_at,
    updatedAt: txn.updated_at
  };
}

async function generateTransactionId() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const counter = await collection('counters').findOneAndUpdate(
    {_id: `transaction-${today}`},
    {$inc: {value: 1}},
    {upsert: true, returnDocument: 'after'}
  );
  return `TXN-${today}-${String(counter.value).padStart(5, '0')}`;
}

async function createOrUpdateTransaction(paymentRecord) {
  try {
    const payments = collection('payment_records');
    const existing = await payments.findOne(
      {razorpay_order_id: paymentRecord.razorpay_order_id},
      {projection: {transaction_id: 1}}
    );
    if (existing?.transaction_id) return existing.transaction_id;
    const transactionId = await generateTransactionId();
    await payments.updateOne(
      {razorpay_order_id: paymentRecord.razorpay_order_id, transaction_id: {$exists: false}},
      {$set: {transaction_id: transactionId, updated_at: new Date().toISOString()}}
    );
    const updated = await payments.findOne({razorpay_order_id: paymentRecord.razorpay_order_id});
    return updated?.transaction_id || transactionId;
  } catch (error) {
    console.error('[TRANSACTION] Error creating/updating transaction:', error.message);
    throw error;
  }
}

async function updateTransactionStatus(razorpayOrderId, status, paymentId, failureReason = null) {
  try {
    const payments = collection('payment_records');
    const record = await payments.findOne({razorpay_order_id: razorpayOrderId});
    if (!record) {
      console.error('[TRANSACTION] No payment record found for order:', razorpayOrderId);
      return null;
    }
    const now = new Date().toISOString();
    const updates = {payment_status: status, razorpay_payment_id: paymentId, updated_at: now};
    if (failureReason) updates.failure_reason = failureReason;
    if (status === 'SUCCESS') {
      updates.confirmed_paid_at = now;
      updates.marked_paid_at = now;
    }
    await payments.updateOne({id: record.id}, {$set: updates});
    return record.transaction_id;
  } catch (error) {
    console.error('[TRANSACTION] Error updating transaction status:', error.message);
    throw error;
  }
}

async function getTransactionDetails(transactionId) {
  try {
    const [txn] = await collection('payment_records').aggregate([
      {$match: {transaction_id: transactionId}},
      ...transactionJoins(),
      {$limit: 1}
    ]).toArray();
    return txn ? formatTransaction(txn) : null;
  } catch (error) {
    console.error('[TRANSACTION] Error getting transaction details:', error.message);
    throw error;
  }
}

async function getTransactionsList(filters = {}) {
  try {
    const match = {};
    if (filters.status) match.payment_status = filters.status;
    if (filters.environment) match.environment = filters.environment;
    if (filters.studentId) match.student_id = Number(filters.studentId);
    if (filters.ownerId) match.owner_id = Number(filters.ownerId);
    if (filters.jobId) match.job_id = Number(filters.jobId);
    Object.assign(match, dateFilter(filters, 'created_at'));
    const limit = Math.max(1, parseInt(filters.limit, 10) || 50);
    const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
    const search = filters.searchQuery?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchMatch = search ? {$match: {$or: [
      {transaction_id: {$regex: search, $options: 'i'}},
      {student_name: {$regex: search, $options: 'i'}},
      {owner_name: {$regex: search, $options: 'i'}},
      {job_title: {$regex: search, $options: 'i'}},
      {razorpay_order_id: {$regex: search, $options: 'i'}},
      {razorpay_payment_id: {$regex: search, $options: 'i'}}
    ]}} : null;
    const baseMatch = {...match};
    const pipeline = [{$match: match}, ...transactionJoins()];
    if (searchMatch) pipeline.push(searchMatch);
    pipeline.push({$sort: {created_at: -1}}, {$skip: offset}, {$limit: limit});
    const [transactions, total] = await Promise.all([
      collection('payment_records').aggregate(pipeline).toArray(),
      collection('payment_records').countDocuments(baseMatch)
    ]);
    return {transactions: transactions.map(formatTransaction), total, limit, offset};
  } catch (error) {
    console.error('[TRANSACTION] Error getting transactions list:', error.message);
    throw error;
  }
}

async function getTransactionSummary(filters = {}) {
  try {
    const match = {environment: 'TEST', ...dateFilter(filters, 'created_at')};
    const [summary] = await collection('payment_records').aggregate([
      {$match: match},
      {$group: {
        _id: null,
        totalTransactions: {$sum: 1},
        successfulTransactions: {$sum: {$cond: [{$eq: ['$payment_status', 'SUCCESS']}, 1, 0]}},
        pendingTransactions: {$sum: {$cond: [{$eq: ['$payment_status', 'PENDING']}, 1, 0]}},
        failedTransactions: {$sum: {$cond: [{$eq: ['$payment_status', 'FAILED']}, 1, 0]}},
        cancelledTransactions: {$sum: {$cond: [{$eq: ['$payment_status', 'CANCELLED']}, 1, 0]}},
        totalSuccessfulAmount: {$sum: {$cond: [{$in: ['$payment_status', ['SUCCESS', 'CONFIRMED', 'PAID']]}, '$amount', 0]}},
        totalPendingAmount: {$sum: {$cond: [{$eq: ['$payment_status', 'PENDING']}, '$amount', 0]}},
        totalTestAmount: {$sum: '$amount'}
      }},
      {$project: {_id: 0}}
    ]).toArray();
    return summary || {
      totalTransactions: 0, successfulTransactions: 0, pendingTransactions: 0,
      failedTransactions: 0, cancelledTransactions: 0, totalSuccessfulAmount: 0,
      totalPendingAmount: 0, totalTestAmount: 0
    };
  } catch (error) {
    console.error('[TRANSACTION] Error getting summary:', error.message);
    throw error;
  }
}

module.exports = {
  generateTransactionId,
  createOrUpdateTransaction,
  updateTransactionStatus,
  getTransactionDetails,
  formatTransaction,
  getTransactionsList,
  getTransactionSummary
};
