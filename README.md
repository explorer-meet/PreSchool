# TinySteps - Preschool management app

**Backend** (`backend/`): Node, Express, Prisma (SQLite), JWT, node-cron. **Mobile** (`mobile/`): Expo React Native.

## Run
```
cd backend; npm install; npm run db:push; npm run dev     # API on :4000
cd mobile;  npm install; npm start -- --clear              # Expo Go QR / emulator
```
Real phone: set `EXPO_PUBLIC_API_URL=http://<PC-IP>:4000/api`. Android emulator uses `10.0.2.2` by default.
Super admin: `admin@preschool.app` / `Admin@12345` (change in `backend/.env`).

## Roles and features
- **Super admin**: approve, reject or suspend registered schools (principal is emailed credentials).
- **Principal**: dashboard with attendance and weekly activity, staff, classes (Jr KG / Sr KG) with Morning/Noon batches, per-class fee plans, two-step student enrolment (including transport, photo consent and optional identity-document image; auto-creates the parent account and emails credentials), invoices and payment history, events, scheduled (day-of-month) notifications, broadcast, fee-reminder settings, approve/reject pick-up requests, and secure authorized pickup-person management.
- **Teacher**: attendance (present/absent/late + minutes), classwork and homework, photos/videos (per child, activity or whole batch), medical history, progress reports, pick-up code verification, and an approved registered pickup person's photo at handover.
- **Parent**: weekly summary, attendance report, performance, reports, homework, photos, medical, fees, events, pick-up/drop requests, and selection of a registered authorized pickup person.

## Sensitive identity documents
For local development, run `npm run documents:setup` in `backend` once. It creates an ignored `.env.documents.local` key file without displaying the key and refuses to replace existing keys or create a new key over encrypted files. Backend start/dev and document migration scripts load this local file automatically. Back it up securely; it must never be committed. Firebase/S3 are not needed for these local uploads and are not configured by this command.

For hosted deployments, configure `DOCUMENT_ENCRYPTION_KEY` as a secret environment variable (32 bytes encoded as base64 or 64 hex characters). Keep it in a secret manager or a protected environment file; do not commit or share it. Run `npm run documents:encrypt` once after setting the key to migrate existing private images, and rerun it after restoring old database/upload backups. Back up the key separately from the database and encrypted upload directory. Losing it makes stored documents unrecoverable. The API encrypts uploaded student, staff, and authorized-person images with AES-256-GCM, validates image content, and serves private files only through authenticated, school-scoped, no-store endpoints. Teachers may retrieve only the photo for an approved same-day pickup assigned to their batch; Aadhaar documents are never exposed to teachers or parents. No Aadhaar number is collected or stored.

## Accounts and passwords
Staff and parent accounts get a **random temporary password**, emailed to them (safer than one shared default). They must change it at first login.

## Email
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` in `backend/.env`. Without them, emails print to the backend console and the temporary password is returned to the principal's screen.

## Automation (cron)
Monthly invoices (1st, 01:00), event and fee reminders (daily 09:00), scheduled notifications (every 15 min).

## Tests
`npm run dev` then `npm run smoke` in `backend` runs an end-to-end check.
For a disposable database/API/upload directory with no real email delivery, run `npm run smoke:isolated` in `backend`. The test creates and removes its own data and does not modify the configured project database. It covers manual invoice creation/detail/listing, amount/date validation, duplicate and one-time fee checks, class/school/role restrictions, parent visibility, payment status/history, and coexistence with monthly generation, alongside the other Principal workflows. Run `npm run test:uploads` in `mobile` to check SDK 57 multipart conversion, native/web image handling, the 10 MB image limit, video compatibility, authentication headers, visible API errors, dynamic success screens and tab labels/layout/callbacks.

## Principal People workflow
The People tab supports student and teacher/staff registration, total counts, search, class/transport or role/access filters, full profile viewing, editing, and confirmed removal. Student removal marks the student as left and deletes private documents; staff removal disables login and clears class assignments while retaining historical records. Authenticated requests also check current account/school access, so deactivated accounts cannot keep using existing sessions.

Student and staff registration show an animated success screen using the saved person's name. Email is marked sent only when the API confirms delivery; existing parent accounts are shown as linked, and undelivered temporary credentials can be viewed and shared securely. “Add another” resets the form without leaving registration.

All image upload screens use the shared `appendUploadFile` helper: Expo SDK 57 requires real `expo-file-system` File/Blob parts rather than React Native URI descriptor objects. Photos, student identity images, and authorized-person Aadhaar images accept JPEG/PNG/WebP up to 10 MB, with backend MIME/signature checks and encrypted private storage. Student editing can replace both private images. Teachers' photo/video sharing uses the same multipart helper. Aadhaar uploads currently accept card **images**, not PDFs. No database schema migration is needed for these workflow changes.

## Principal fees and navigation
Class/Batch/Fee and Student/Teacher navigation uses content-sized, wrapping tabs with visible labels, icons and 48-point minimum touch targets, rather than a fixed-height horizontal scroller that can clip text at larger font sizes.

Fee collection has two entry points: **Generate Invoice** and **View Invoices**. The individual invoice form selects an active student, a fee plan from their class, an amount in rupees, a billing month (`YYYY-MM`), and a valid due date. Amounts are saved in paise without modifying the fee plan. `POST /api/principal/invoices` rejects cross-school/class selections, duplicate student/fee/month invoices, and repeat one-time fees. Existing monthly batch generation remains available in the invoice list and continues to skip invoices already generated manually.

The invoice list includes all saved invoices by default, with search, All/Due/Paid tabs, class, payment and overdue filters. **View invoice details** loads the saved student, admission number, amounts, due date and transactions from `GET /api/principal/invoices/:id`. **Record payment** saves a partial or full payment, updates the balance/status, and refreshes the previous screen. The same invoices are available in the parent's existing fee view. These changes use the existing database schema; no new database or migration is required.

## Principal layout and live data
Shared pages, lists and forms use centered, bounded content widths, wrapping action rows, readable labels and keyboard-aware forms. Dashboard cards navigate to the matching student, staff and batch lists. People cards keep View/Edit visible and group documents, password resets and removal under **More actions**. Profile/document modals respect safe areas; private images show loading/error feedback. Confirmation and credential popups scroll on small screens and result popups can be dismissed.

The dashboard and management lists refresh every 30 seconds **while focused and active**, on screen focus, when the app resumes, and on pull-to-refresh. This is polling, not a WebSocket feed. Requests are cancelled when leaving a screen; stale responses cannot overwrite a newer path or refresh. Failed refreshes retain the last loaded records and display an explicit retry message and update timestamp. Form values are not overwritten by background refreshes.

Forms show inline required/contact/date/time/numeric validation. Large option lists are searchable and failed option loads can be retried. Optional selections can be cleared, including batch teacher assignment and an event's batch audience. Fee-reminder settings load the existing value and enforce whole days from 0 to 30. Batch time edits validate the merged start/end times on the API.

Scheduled announcements support content/recurrence/audience editing as well as pause/resume/delete. Only relevant class, batch, date or monthly-day fields appear; the API clears irrelevant targeting/recurrence values and enforces school ownership. Editing does not reset the same-day send guard. Pickup requests support search, status/type/date filters, a decision confirmation screen, optional notes, and duplicate-decision protection. Authorized pickup people support search and active/removed filters. Alerts support search/category/read filters and **Mark all as read**.

`npm run test:uploads` also tests form-validation boundaries, conditional fields, wrapping action rows, stale-request protection, refresh failures, app-resume refresh and background/blur cleanup. `npm run smoke:isolated` additionally checks saved settings/bounds, batch time edits/clearing, notification edits and school/role restrictions, event audience clearing, read receipts and concurrent pickup decisions. No additional database or schema migration is needed for this polish pass.

## Postman
Import [`backend/postman/PreSchool API.postman_collection.json`](backend/postman/PreSchool%20API.postman_collection.json) into Postman to use the backend API requests. The collection defaults to `http://localhost:4000`; change its `baseUrl` collection variable if the backend is hosted elsewhere. Run **Log in** with the desired role's credentials to save its JWT to the collection-level `token` variable, then replace the example ID variables with IDs from your data.

## Limits
Push notifications need a dev build (not Expo Go). Dates are typed `YYYY-MM-DD`. No online payments.
