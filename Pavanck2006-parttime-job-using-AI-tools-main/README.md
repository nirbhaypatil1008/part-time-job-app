# PartTime Job Platform

> **"Find Work. Earn More. Work Safely."**

A production-grade full-stack job marketplace connecting college students with catering businesses and event organizers needing temporary staff — food servers, kitchen assistants, cleaners, and event helpers across Bangalore.

---

## Features

### Core Platform
- **Three-Role System** — Student, Owner (catering business), and Admin with JWT authentication and bcrypt password hashing
- **Job Discovery & Application** — Public job browsing with filters (area, work type, date, payment range), plus per-job application with notes
- **Location Privacy** — General work areas shown publicly; exact venue addresses and organizer contacts unlock only after acceptance
- **On-Spot Payment Workflow** — Owners mark shifts as paid, students confirm receipt; built-in dispute resolution with six complaint types
- **Worker Slot Limits** — Strict capacity enforcement prevents over-hiring; automatic `FILLED` status when full
- **Owner Verification** — Admin-granted verified badges; safety advisory notices shown for unverified organizers

### Communication & Safety
- **In-App Notifications** — Real-time alerts for application status changes, payment updates, and system events
- **Complaint Chat** — Dedicated messaging thread between complainant and target user per dispute
- **Audit Logging** — Full trail of all critical platform actions
- **Email OTP Verification** — 6-digit code sent via SMTP during registration and password reset; registration does not require phone OTP

### Admin Dashboard
- Platform-wide metrics (total users, jobs, open disputes, active listings)
- User management with suspend/reactivate controls
- Owner verification grant/revoke
- Job moderation and removal
- Dispute resolution with formal admin remarks

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 18+ |
| **Framework** | Express 4.x |
| **Database** | MongoDB with Mongoose schemas and ObjectId references |
| **Auth** | JWT (`jsonwebtoken`) + bcryptjs |
| **File Uploads** | Multer (images up to 5 MB) |
| **Email** | Nodemailer (SMTP) |
| **Frontend** | Vanilla HTML5 / CSS3 / ES6+ JavaScript |
| **UI Framework** | Bootstrap 5.3.3 + Bootstrap Icons |
| **Styling** | Custom design system with CSS variables, dark mode support |
| **Config** | dotenv |

---

## Project Structure

```
parttime-job-platform-node/
├── server.js                    # Express app — all API routes, auth, file upload, startup
├── server/
│   ├── db.js                    # Mongoose connection, ID compatibility, and transactions
│   ├── models.js                # Mongoose schemas, validation, indexes, and references
│   └── chat.js                  # Complaint messaging routes (/api/chat)
├── scripts/
│   ├── seed.js                  # Explicit development/test data seeding
│   └── migrate-mysql-to-mongodb.js # Non-destructive MySQL data importer
├── package.json
├── .env                         # Environment config (not committed)
│
└── src/main/resources/static/   # Frontend — served by Express
        ├── index.html           # Single-page app (all views, modals, templates)
        ├── css/
        │   └── style.css        # Custom design system (~1700 lines)
        └── js/
            ├── api.js           # HTTP client wrapper (JWT, error handling)
            ├── app.js           # Router, view switching, job browsing, apply flow
            ├── auth.js          # Login, register, OTP, password reset
            ├── student.js       # Student dashboard, applications, payments
            ├── owner.js         # Owner dashboard, job CRUD, applicant management
            ├── admin.js         # Admin dashboard, user/job/report moderation
            ├── chat.js          # Complaint messaging UI
            └── notifications.js # Notification bell, unread count, mark-read
```

---

## Quick Start

### Prerequisites

- **Node.js** 18 or later — [Download](https://nodejs.org)
- **MongoDB** 6+ — run it as a single-node replica set locally, or use MongoDB Atlas. Multi-document transactions require a replica set.

### 1. Clone & install

```bash
git clone <your-repo-url>
cd parttime-job-platform-node
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` in the project root, then set the required values:

```env
MONGO_URI=mongodb://127.0.0.1:27017/parttimejob_db?replicaSet=rs0
JWT_SECRET=<generate-a-long-random-secret>
PORT=8080

# Email OTP (required for registration and password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-smtp-account>
SMTP_PASSWORD=<your-smtp-app-password>
SMTP_FROM=<verified-sender-address>
SMTP_SENDER_NAME=PartTime Job
```

> Email OTP codes are sent only to the address being verified; they are never returned by the API or printed to the server console. If SMTP is not configured, the OTP step returns a 503 error. Keep `.env` private; it is excluded from Git.

### 3. Start MongoDB locally

Run MongoDB with replica-set support:

```bash
mongod --replSet rs0 --bind_ip localhost
```

In another terminal, initialize the replica set once:

```bash
mongosh "mongodb://127.0.0.1:27017/admin" --eval "rs.initiate()"
```

For MongoDB Atlas, set `MONGO_URI` to your cluster URI. Use a replica set because application workflows use multi-document transactions.

### 4. Start the server

```bash
npm start          # production
npm run dev        # development with --watch auto-reload
```

The server connects to MongoDB, creates the required indexes, and listens on `http://localhost:8080`. Startup never seeds data. For development/test accounts, configure the `SEED_*` variables in `.env` and run:

```bash
npm run seed
```

Seeding is idempotent; it does not overwrite an existing account's password.
Each seed password must be at least 12 characters.

### Remove legacy gateway metadata

To remove old provider IDs/signatures and their indexes from MongoDB payment records after taking a database backup, run:

```bash
npm run cleanup:gateway-data
```

This does not delete manual settlement records or the job's agreed compensation/payment method.

### Import existing MySQL data

The importer copies MySQL rows into MongoDB and leaves the source database unchanged. Configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` in `.env`, then run:

```bash
npm run migrate:mysql
```

The migration requires primary keys on source tables, skips the obsolete gateway-only transaction table, removes gateway credential/signature fields, hashes legacy plaintext user passwords, and creates ObjectId reference fields while retaining numeric IDs for current API compatibility. Back up both databases first and verify the imported collections before retiring any SQL system or source data.

### 5. Open in browser

Navigate to **http://localhost:8080**

---


## API Reference

All endpoints return JSON. Authenticated routes require `Authorization: Bearer <token>`.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/request-otp` | Send email verification code |
| POST | `/api/auth/verify-otp` | Verify 6-digit email code |
| POST | `/api/auth/register` | Create Student or Owner account |
| POST | `/api/auth/login` | Sign in, receive JWT |
| POST | `/api/auth/forgot-password` | Request password reset code |
| POST | `/api/auth/forgot-password/verify` | Verify reset code |
| POST | `/api/auth/forgot-password/reset` | Set new password |
| DELETE | `/api/account` | Delete own account (requires password) |

### Public Job Discovery

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/public/jobs` | List open jobs (filters: `area`, `workType`, `jobDate`, `minPayment`, `maxPayment`, `paymentType`) |
| GET | `/api/public/jobs/recommended` | Ranked job recommendations |
| GET | `/api/public/jobs/:id` | Single job details |

### Student

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/student/profile` | Get profile |
| PUT | `/api/student/profile` | Update profile |
| GET | `/api/student/dashboard` | Stats (available, applied, accepted, completed, earnings) |
| POST | `/api/student/jobs/:jobId/apply` | Apply for a shift |
| GET | `/api/student/applications` | All applications |
| GET | `/api/student/applications/accepted` | Accepted shifts (unlocked details) |
| GET | `/api/student/applications/completed` | Completed shifts |
| DELETE | `/api/student/applications/:id` | Cancel pending application |
| PUT | `/api/student/applications/:id/confirm-payment` | Confirm on-spot payment received |
| GET | `/api/student/payments` | Payment history |

### Owner (Catering Business)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/owner/profile` | Get catering profile |
| PUT | `/api/owner/profile` | Update profile |
| POST | `/api/owner/jobs` | Create job listing |
| GET | `/api/owner/jobs` | List own jobs |
| GET | `/api/owner/jobs/:id` | Job details + applicants |
| PUT | `/api/owner/jobs/:id` | Update job |
| DELETE | `/api/owner/jobs/:id` | Cancel job (notifies applicants) |
| GET | `/api/owner/jobs/:id/applications` | List applicants |
| PUT | `/api/owner/applications/:id/accept` | Accept applicant |
| PUT | `/api/owner/applications/:id/reject` | Reject applicant |
| PUT | `/api/owner/applications/:id/attendance` | Mark PRESENT / ABSENT |
| PUT | `/api/owner/jobs/:id/complete` | Mark shift completed |
| PUT | `/api/owner/applications/:id/payment` | Mark payment as PAID |
| GET | `/api/owner/payments` | Payout records |

### Reports & Disputes

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/reports` | File complaint (types: payment, behavior, fake job, wrong location) |
| GET | `/api/reports/my-reports` | View own reports |
| DELETE | `/api/reports/:id` | Withdraw complaint (student only) |

### Complaint Chat

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/chat/:reportId/messages` | Fetch chat thread |
| POST | `/api/chat/:reportId/messages` | Send message (max 2000 chars) |

### Admin

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/dashboard` | Platform metrics |
| GET | `/api/admin/users` | All users |
| PUT | `/api/admin/owners/:id/verify` | Grant/revoke verified badge |
| PUT | `/api/admin/users/:id/suspend` | Suspend/reactivate user |
| GET | `/api/admin/jobs` | All jobs for moderation |
| DELETE | `/api/admin/jobs/:id` | Remove job |
| GET | `/api/admin/reports` | All disputes |
| PUT | `/api/admin/reports/:id/resolve` | Resolve dispute with remarks |

### Notifications

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notifications` | List notifications |
| GET | `/api/notifications/unread-count` | Unread badge count |
| PUT | `/api/notifications/:id/read` | Mark one as read |
| PUT | `/api/notifications/read-all` | Mark all as read |

### File Upload

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/upload/image` | Upload image (field: `image`, max 5 MB, types: jpg/png/gif/webp) |

---

## Database Schema

9 tables with full referential integrity:

```
users
 ├── student_profiles        (1:1 via user_id)
 ├── owner_profiles          (1:1 via user_id)
 ├── notifications           (1:N via recipient_id)
 └── audit_logs              (N via user_id)

catering_jobs
 ├── owner_profiles          (N:1 via owner_id)
 └── job_applications        (1:N via job_id)
      ├── student_profiles   (N:1 via student_id)
      └── payment_records    (1:1 via application_id)

reports
 ├── users (reporter)        (N:1 via reporter_id)
 ├── users (target)          (N:1 via target_user_id)
 ├── catering_jobs           (N:1 via job_id, nullable)
 └── complaint_messages      (1:N via report_id)
```

Key columns: `status` fields use string enums (e.g., `OPEN`, `APPLIED`, `ACCEPTED`, `PAID`, `CONFIRMED`, `PENDING`, `RESOLVED`).

---

## Frontend Architecture

The app is a single `index.html` page with view-based routing handled in JavaScript:

- **Landing page** — Hero, stats, featured jobs, how-it-works, safety, FAQ, footer
- **Browse Jobs** — Filterable job cards with area, type, date, and payment filters
- **Auth views** — Login, register (with email OTP verification), forgot password
- **Student Dashboard** — Stats cards, tabbed views (applied / accepted / completed), payment history
- **Owner Dashboard** — Job management, applicant lists with accept/reject/attendance/payment controls
- **Admin Dashboard** — Platform metrics, user table, job moderation, dispute resolution
- **Modals** — Job details, apply, applicants manager, payment confirmation, dispute form, resolve dispute
- **Chat** — Complaint messaging between disputing parties
- **Dark mode** — Toggle via `data-theme="dark"` on `<html>`
- **Responsive** — Mobile-first with breakpoints at 576px, 768px, 992px, 1200px

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | Yes | — | MongoDB connection string; a replica set is required for transactions |
| `JWT_SECRET` | Yes | — | HMAC signing key; set a long, random secret |
| `PORT` | No | `8080` | Server listen port |
| `SMTP_HOST` | For OTP | — | SMTP server hostname |
| `SMTP_PORT` | For OTP | `587` | SMTP port |
| `SMTP_SECURE` | No | `false` | Set `true` for port 465 |
| `SMTP_USER` | For OTP | — | SMTP username |
| `SMTP_PASSWORD` | For OTP | — | SMTP app password/credential |
| `SMTP_FROM` | For OTP | — | Verified sender email address |
| `SMTP_SENDER_NAME` | No | `PartTime Job` | Display name for verification emails |
| `GOOGLE_MAPS_API_KEY` | No | — | Optional reverse-geocoding API key |
| `MYSQL_HOST` | For migration | `127.0.0.1` | Legacy MySQL hostname |
| `MYSQL_PORT` | For migration | `3306` | Legacy MySQL port |
| `MYSQL_DATABASE` | For migration | — | Legacy database to import |
| `MYSQL_USER` | For migration | — | Legacy MySQL account |
| `MYSQL_PASSWORD` | For migration | — | Legacy MySQL password |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_PHONE` | For seeding | — | Development/test admin credentials |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_OWNER_PHONE` | For seeding | — | Development/test owner credentials |
| `SEED_STUDENT_EMAIL`, `SEED_STUDENT_PASSWORD`, `SEED_STUDENT_PHONE` | For seeding | — | Development/test student credentials |

Twilio variables are intentionally absent because phone OTP verification has been removed and Twilio is not used by the application.

---

## License

Private — All rights reserved.
