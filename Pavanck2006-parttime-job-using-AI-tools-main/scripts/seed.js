require('dotenv').config();

const bcrypt = require('bcryptjs');
const {initializeDatabase, closeDatabase, insertDocument, collection} = require('../server/db');

const demoAccounts = [
  {
    role: 'ROLE_ADMIN',
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    phone: process.env.SEED_ADMIN_PHONE,
    fullName: 'Development Admin'
  },
  {
    role: 'ROLE_OWNER',
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
    phone: process.env.SEED_OWNER_PHONE,
    fullName: 'Development Owner'
  },
  {
    role: 'ROLE_STUDENT',
    email: process.env.SEED_STUDENT_EMAIL,
    password: process.env.SEED_STUDENT_PASSWORD,
    phone: process.env.SEED_STUDENT_PHONE,
    fullName: 'Development Student'
  }
];

async function seedAccount(account) {
  if (!account.email || !account.password || !account.phone) {
    throw new Error(`Set the email, password, and phone environment variables for ${account.role} before seeding.`);
  }
  if (account.password.length < 12) {
    throw new Error(`The seed password for ${account.role} must contain at least 12 characters.`);
  }

  const email = account.email.trim().toLowerCase();
  let user = await collection('users').findOne({email});
  if (!user) {
    user = await insertDocument('users', {
      email,
      password_hash: await bcrypt.hash(account.password, 12),
      full_name: account.fullName,
      phone: account.phone.trim(),
      role: account.role,
      is_active: true,
      is_suspended: false
    });
  }

  if (account.role === 'ROLE_OWNER' && !(await collection('owner_profiles').findOne({user_id: user.id}))) {
    await insertDocument('owner_profiles', {
      user_id: user.id,
      catering_name: 'Development Catering',
      business_address: '',
      business_phone: user.phone,
      verification_status: 'PENDING_VERIFICATION',
      total_jobs_posted: 0
    });
  }

  if (account.role === 'ROLE_STUDENT' && !(await collection('student_profiles').findOne({user_id: user.id}))) {
    await insertDocument('student_profiles', {
      user_id: user.id,
      college_name: 'Development College',
      preferred_area: 'Bangalore',
      skills: '',
      total_jobs_completed: 0,
      rating: 5
    });
  }
}

async function main() {
  if (demoAccounts.some(account => !account.email || !account.password || !account.phone)) {
    throw new Error('Configure all SEED_*_EMAIL, SEED_*_PASSWORD, and SEED_*_PHONE values in .env before running npm run seed.');
  }

  await initializeDatabase();
  for (const account of demoAccounts) await seedAccount(account);
  console.log('Development seed accounts are ready. Passwords were not printed.');
}

main()
  .catch(error => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
