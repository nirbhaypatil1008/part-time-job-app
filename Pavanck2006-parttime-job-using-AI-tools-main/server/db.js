const {MongoClient} = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/parttimejob_db?replicaSet=rs0';
const client = new MongoClient(uri);
let database;

function collection(name) {
  if (!database) throw new Error('MongoDB has not been initialized');
  return database.collection(name);
}

function toId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw Object.assign(new Error('Invalid identifier'), {status: 400});
  }
  return id;
}

async function nextId(name, session) {
  const counter = await collection('counters').findOneAndUpdate(
    {_id: name},
    {$inc: {value: 1}},
    {upsert: true, returnDocument: 'after', session}
  );
  return counter.value;
}

async function insertDocument(name, document, session) {
  const created = {
    ...document,
    id: document.id || await nextId(name, session),
    created_at: document.created_at || new Date().toISOString(),
    updated_at: document.updated_at || new Date().toISOString()
  };
  await collection(name).insertOne(created, {session});
  return created;
}

async function transaction(work) {
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function initializeDatabase() {
  if (database) return;
  await client.connect();
  database = client.db();

  const indexes = {
    users: [[{email: 1}, {unique: true}], [{phone: 1}, {unique: true}], [{role: 1}]],
    student_profiles: [[{user_id: 1}, {unique: true}]],
    owner_profiles: [[{user_id: 1}, {unique: true}]],
    catering_jobs: [[{owner_id: 1}], [{status: 1, work_area: 1, job_date: 1}]],
    job_applications: [[{job_id: 1, student_id: 1}, {unique: true}], [{status: 1}]],
    payment_records: [[{application_id: 1}, {unique: true, sparse: true}], [{razorpay_order_id: 1}, {sparse: true}], [{transaction_id: 1}, {sparse: true}]],
    reports: [[{reporter_id: 1}], [{status: 1}]],
    notifications: [[{recipient_id: 1, created_at: -1}], [{recipient_id: 1, is_read: 1}]],
    job_deletion_requests: [[{job_id: 1, status: 1}], [{student_id: 1, status: 1}]],
    otp_verifications: [[{email: 1, purpose: 1, created_at: -1}]],
    pending_registrations: [[{token: 1}, {unique: true}], [{email: 1}], [{phone: 1}]],
    complaint_messages: [[{report_id: 1, created_at: 1}]],
    audit_logs: [[{user_id: 1, created_at: -1}]]
  };

  for (const [name, definitions] of Object.entries(indexes)) {
    for (const [keys, options] of definitions) {
      await collection(name).createIndex(keys, options);
    }
  }

  if (process.env.RUN_SEED !== 'false') {
    const users = [
      {id: 1, email: 'admin@parttimejob.com', password_hash: '$2a$10$9CarXmRbD3mKT7UJjSPSo.HJkgeFYqgNvqhAUxm5Zlp2u6ARlq61e', full_name: 'Platform Admin', phone: '9999999999', role: 'ROLE_ADMIN'},
      {id: 2, email: 'owner.srilakshmi@catering.com', password_hash: '$2a$10$e4wlcMo/hHmpHGStKvAA2eUyfR/0fICb2vilmwRqz3oQMaFEwNs9O', full_name: 'Sri Lakshmi', phone: '9876543210', role: 'ROLE_OWNER'},
      {id: 3, email: 'student.pavan@gmail.com', password_hash: '$2a$10$ZKJ2LAWgW3bXkAQHAv/cp.M6BjmAdmJtGXpNLw5V/iOY58RW7/HbG', full_name: 'Pavan Kumar', phone: '9123456789', role: 'ROLE_STUDENT'}
    ].map(user => ({is_active: true, is_suspended: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...user}));

    for (const user of users) {
      await collection('users').updateOne({id: user.id}, {$setOnInsert: user}, {upsert: true});
    }
    await collection('counters').updateOne({_id: 'users'}, {$max: {value: 3}}, {upsert: true});
    await collection('owner_profiles').updateOne(
      {id: 1},
      {$setOnInsert: {id: 1, user_id: 2, catering_name: 'Sri Lakshmi Catering Services', business_address: 'Koramangala, Bangalore', business_phone: '9876543210', verification_status: 'VERIFIED', total_jobs_posted: 0}},
      {upsert: true}
    );
    await collection('student_profiles').updateOne(
      {id: 1},
      {$setOnInsert: {id: 1, user_id: 3, college_name: 'R.V. College of Engineering', preferred_area: 'Koramangala', skills: 'Guest Hospitality, Counter Assistance', bio: 'Punctual student with prior catering experience.', emergency_contact: '9999999999', total_jobs_completed: 0, rating: 5}},
      {upsert: true}
    );
    await collection('counters').updateOne({_id: 'owner_profiles'}, {$max: {value: 1}}, {upsert: true});
    await collection('counters').updateOne({_id: 'student_profiles'}, {$max: {value: 1}}, {upsert: true});
    const verifiedOtpSeeds = [
      {id: 1, email: users[1].email, purpose: 'email_registration'},
      {id: 2, email: users[1].email, purpose: 'phone_registration'},
      {id: 3, email: users[2].email, purpose: 'email_registration'},
      {id: 4, email: users[2].email, purpose: 'phone_registration'}
    ];
    const seedTime = new Date().toISOString();
    for (const otp of verifiedOtpSeeds) {
      await collection('otp_verifications').updateOne(
        {id: otp.id},
        {$setOnInsert: {...otp, otp_hash: 'seed-account-verification', expires_at: seedTime, attempts: 0, max_attempts: 5, is_verified: true, is_used: true, created_at: seedTime, updated_at: seedTime}},
        {upsert: true}
      );
    }
    await collection('counters').updateOne({_id: 'otp_verifications'}, {$max: {value: 4}}, {upsert: true});
  }

  console.log(`MongoDB connected to database "${database.databaseName}"`);
}

module.exports = {client, collection, insertDocument, initializeDatabase, nextId, toId, transaction};
