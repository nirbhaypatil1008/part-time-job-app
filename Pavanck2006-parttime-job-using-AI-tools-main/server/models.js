const mongoose = require('mongoose');

const {Schema} = mongoose;
const objectId = Schema.Types.ObjectId;

function defineModel(name, collection, fields, {indexes = [], timestamps = true} = {}) {
  const schema = new Schema({
    id: {type: Number, min: 1, unique: true, sparse: true, index: true},
    ...fields
  }, {
    collection,
    strict: false,
    versionKey: false,
    timestamps: timestamps ? {createdAt: 'created_at', updatedAt: 'updated_at'} : false
  });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema);
}

const User = defineModel('User', 'users', {
  email: {type: String, required: true, trim: true, lowercase: true},
  password_hash: {type: String, required: true},
  full_name: {type: String, required: true, trim: true},
  phone: {type: String, required: true, trim: true},
  role: {type: String, required: true, enum: ['ROLE_ADMIN', 'ROLE_OWNER', 'ROLE_STUDENT']},
  is_active: {type: Boolean, default: true},
  is_suspended: {type: Boolean, default: false}
}, {indexes: [[{email: 1}, {unique: true}], [{phone: 1}, {unique: true}], [{role: 1}]]});

const OwnerProfile = defineModel('OwnerProfile', 'owner_profiles', {
  user_id: {type: Number, required: true, min: 1},
  user_ref: {type: objectId, ref: 'User', index: true},
  catering_name: String,
  business_address: String,
  business_phone: String,
  verification_status: {type: String, default: 'PENDING_VERIFICATION'},
  verified_at: String,
  profile_photo_url: String,
  total_jobs_posted: {type: Number, default: 0, min: 0}
}, {indexes: [[{user_id: 1}, {unique: true}]]});

const StudentProfile = defineModel('StudentProfile', 'student_profiles', {
  user_id: {type: Number, required: true, min: 1},
  user_ref: {type: objectId, ref: 'User', index: true},
  college_name: String,
  preferred_area: String,
  skills: String,
  bio: String,
  emergency_contact: String,
  profile_photo_url: String,
  total_jobs_completed: {type: Number, default: 0, min: 0},
  rating: {type: Number, default: 5, min: 0, max: 5}
}, {indexes: [[{user_id: 1}, {unique: true}]]});

const CateringJob = defineModel('CateringJob', 'catering_jobs', {
  owner_id: {type: Number, required: true, min: 1},
  owner_ref: {type: objectId, ref: 'OwnerProfile', index: true},
  title: {type: String, required: true, trim: true},
  description: {type: String, default: ''},
  work_type: String,
  work_area: String,
  detailed_location: String,
  location_photo: String,
  location_photo_url: String,
  location_address: String,
  latitude: {type: Number, min: -90, max: 90},
  longitude: {type: Number, min: -180, max: 180},
  job_date: {type: String, required: true},
  start_time: String,
  end_time: String,
  payment_amount: {type: Number, required: true, min: 0},
  payment_type: String,
  is_on_spot_payment: {type: Boolean, default: true},
  workers_required: {type: Number, required: true, min: 1},
  workers_selected: {type: Number, default: 0, min: 0},
  required_skills: Schema.Types.Mixed,
  contact_phone: String,
  contact_email: String,
  apply_deadline: String,
  owner_decision: String,
  owner_decision_at: String,
  status: {type: String, default: 'OPEN'}
}, {indexes: [[{owner_id: 1}], [{status: 1, work_area: 1, job_date: 1}]]});

const JobApplication = defineModel('JobApplication', 'job_applications', {
  job_id: {type: Number, required: true, min: 1},
  job_ref: {type: objectId, ref: 'CateringJob', index: true},
  student_id: {type: Number, required: true, min: 1},
  student_ref: {type: objectId, ref: 'StudentProfile', index: true},
  owner_id: {type: Number, min: 1},
  owner_ref: {type: objectId, ref: 'OwnerProfile', index: true},
  status: {type: String, required: true, default: 'APPLIED'},
  payment_amount: {type: Number, min: 0},
  notes: String,
  work_completion_status: String,
  attendance_status: String,
  payment_status: String,
  applied_at: String,
  responded_at: String,
  payment_confirmation_date: String
}, {indexes: [[{job_id: 1, student_id: 1}, {unique: true}], [{status: 1}]]});

const OtpVerification = defineModel('OtpVerification', 'otp_verifications', {
  email: {type: String, required: true, trim: true, lowercase: true},
  pending_registration_ref: {type: objectId, ref: 'PendingRegistration', index: true},
  otp_hash: {type: String, required: true},
  purpose: {type: String, required: true},
  expires_at: {type: String, required: true},
  attempts: {type: Number, default: 0, min: 0},
  max_attempts: {type: Number, default: 5, min: 1},
  is_verified: {type: Boolean, default: false},
  is_used: {type: Boolean, default: false}
}, {indexes: [[{email: 1, purpose: 1, created_at: -1}]]});

const PaymentRecord = defineModel('PaymentRecord', 'payment_records', {
  application_id: {type: Number, required: true, min: 1},
  application_ref: {type: objectId, ref: 'JobApplication', index: true},
  job_id: {type: Number, required: true, min: 1},
  job_ref: {type: objectId, ref: 'CateringJob', index: true},
  student_id: {type: Number, required: true, min: 1},
  student_ref: {type: objectId, ref: 'StudentProfile', index: true},
  owner_id: {type: Number, required: true, min: 1},
  owner_ref: {type: objectId, ref: 'OwnerProfile', index: true},
  amount: {type: Number, required: true, min: 0},
  payment_type: String,
  payment_status: {type: String, default: 'PENDING'},
  payment_method: String,
  initiated_at: String,
  marked_paid_at: String,
  confirmed_paid_at: String,
  notes: String
}, {indexes: [[{application_id: 1}, {unique: true, sparse: true}], [{owner_id: 1, payment_status: 1}], [{student_id: 1, payment_status: 1}]]});

const Report = defineModel('Report', 'reports', {
  reporter_id: {type: Number, required: true, min: 1},
  reporter_ref: {type: objectId, ref: 'User', index: true},
  target_user_id: Number,
  target_ref: {type: objectId, ref: 'User', index: true},
  job_id: Number,
  job_ref: {type: objectId, ref: 'CateringJob'},
  application_id: Number,
  application_ref: {type: objectId, ref: 'JobApplication'},
  report_type: {type: String, required: true},
  description: {type: String, required: true},
  expected_amount: {type: Number, min: 0},
  received_amount: {type: Number, min: 0},
  evidence_notes: String,
  admin_remarks: String,
  resolved_at: String,
  status: {type: String, default: 'PENDING'}
}, {indexes: [[{reporter_id: 1}], [{status: 1}]]});

const ComplaintMessage = defineModel('ComplaintMessage', 'complaint_messages', {
  report_id: {type: Number, required: true, min: 1},
  report_ref: {type: objectId, ref: 'Report', index: true},
  sender_id: {type: Number, required: true, min: 1},
  sender_ref: {type: objectId, ref: 'User', index: true},
  message: {type: String, required: true}
}, {indexes: [[{report_id: 1, created_at: 1}]]});

const Notification = defineModel('Notification', 'notifications', {
  recipient_id: {type: Number, required: true, min: 1},
  recipient_ref: {type: objectId, ref: 'User', index: true},
  title: {type: String, required: true},
  message: {type: String, required: true},
  type: {type: String, required: true},
  related_entity_id: Number,
  is_read: {type: Boolean, default: false}
}, {indexes: [[{recipient_id: 1, created_at: -1}], [{recipient_id: 1, is_read: 1}]]});

const JobDeletionRequest = defineModel('JobDeletionRequest', 'job_deletion_requests', {
  job_id: {type: Number, required: true, min: 1},
  job_ref: {type: objectId, ref: 'CateringJob', index: true},
  student_id: {type: Number, min: 1},
  student_ref: {type: objectId, ref: 'StudentProfile', index: true},
  owner_id: {type: Number, min: 1},
  owner_ref: {type: objectId, ref: 'OwnerProfile', index: true},
  status: {type: String, default: 'PENDING'},
  reason: String,
  responded_at: String
}, {indexes: [[{job_id: 1, status: 1}], [{student_id: 1, status: 1}]]});

const PendingRegistration = defineModel('PendingRegistration', 'pending_registrations', {
  token: {type: String, required: true, unique: true},
  email: {type: String, required: true, trim: true, lowercase: true},
  role: {type: String, required: true, enum: ['ROLE_OWNER', 'ROLE_STUDENT']},
  full_name: {type: String, required: true, trim: true},
  phone: {type: String, required: true},
  password_hash: {type: String, required: true},
  college_name: String,
  preferred_area: String,
  skills: String,
  bio: String,
  emergency_contact: String,
  catering_name: String,
  business_address: String,
  business_phone: String,
  email_verified: {type: Boolean, default: false},
  current_step: {type: String, default: 'email'},
  status: {type: String, default: 'pending'},
  expires_at: {type: String, required: true}
}, {indexes: [[{email: 1}], [{phone: 1}]]});

const AuditLog = defineModel('AuditLog', 'audit_logs', {
  user_id: {type: Number, min: 1},
  user_ref: {type: objectId, ref: 'User', index: true},
  action: {type: String, required: true},
  entity_type: String,
  entity_id: Number,
  details: Schema.Types.Mixed
}, {indexes: [[{user_id: 1, created_at: -1}]]});

const Counter = defineModel('Counter', 'counters', {
  _id: {type: String},
  value: {type: Number, default: 0, min: 0}
}, {timestamps: false});

const models = {
  users: User,
  owner_profiles: OwnerProfile,
  student_profiles: StudentProfile,
  catering_jobs: CateringJob,
  job_applications: JobApplication,
  payment_records: PaymentRecord,
  otp_verifications: OtpVerification,
  reports: Report,
  complaint_messages: ComplaintMessage,
  notifications: Notification,
  job_deletion_requests: JobDeletionRequest,
  pending_registrations: PendingRegistration,
  audit_logs: AuditLog,
  counters: Counter
};

const relations = {
  owner_profiles: [['user_id', 'user_ref', 'users']],
  student_profiles: [['user_id', 'user_ref', 'users']],
  catering_jobs: [['owner_id', 'owner_ref', 'owner_profiles']],
  job_applications: [
    ['job_id', 'job_ref', 'catering_jobs'],
    ['student_id', 'student_ref', 'student_profiles'],
    ['owner_id', 'owner_ref', 'owner_profiles']
  ],
  payment_records: [
    ['application_id', 'application_ref', 'job_applications'],
    ['job_id', 'job_ref', 'catering_jobs'],
    ['student_id', 'student_ref', 'student_profiles'],
    ['owner_id', 'owner_ref', 'owner_profiles']
  ],
  reports: [
    ['reporter_id', 'reporter_ref', 'users'],
    ['target_user_id', 'target_ref', 'users'],
    ['job_id', 'job_ref', 'catering_jobs'],
    ['application_id', 'application_ref', 'job_applications']
  ],
  complaint_messages: [
    ['report_id', 'report_ref', 'reports'],
    ['sender_id', 'sender_ref', 'users']
  ],
  notifications: [['recipient_id', 'recipient_ref', 'users']],
  job_deletion_requests: [
    ['job_id', 'job_ref', 'catering_jobs'],
    ['student_id', 'student_ref', 'student_profiles'],
    ['owner_id', 'owner_ref', 'owner_profiles']
  ],
  audit_logs: [['user_id', 'user_ref', 'users']]
};

function modelFor(collectionName) {
  if (models[collectionName]) return models[collectionName];
  const modelName = `Legacy_${collectionName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return mongoose.models[modelName] || mongoose.model(
    modelName,
    new Schema({}, {
      collection: collectionName,
      strict: false,
      versionKey: false,
      timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}
    })
  );
}

module.exports = {models, relations, modelFor};
