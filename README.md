# TinySteps - Preschool management app

**Backend** (`backend/`): Node, Express, Prisma (SQLite), JWT, node-cron. **Mobile** (`mobile/`): Expo React Native.

## Run
```
cd backend; npm install; npm run db:push; npm run dev     # API on :4000
cd mobile;  npm install; npx expo start                    # Expo Go / emulator
```
Real phone: set `EXPO_PUBLIC_API_URL=http://<PC-IP>:4000/api`. Android emulator uses `10.0.2.2` by default.
Super admin: `admin@preschool.app` / `Admin@12345` (change in `backend/.env`).

## Roles and features
- **Super admin**: approve, reject or suspend registered schools (principal is emailed credentials).
- **Principal**: staff, classes (Jr KG / Sr KG) with Morning/Noon batches, per-class fee plans, enrolment (auto-creates the parent account and emails credentials), invoices and payments, events, scheduled (day-of-month) notifications, broadcast, fee-reminder settings, approve/reject pick-up requests.
- **Teacher**: attendance (present/absent/late + minutes), classwork and homework, photos/videos (per child, activity or whole batch), medical history, progress reports, pick-up code verification.
- **Parent**: weekly summary, attendance report, performance, reports, homework, photos, medical, fees, events, pick-up/drop requests.

## Accounts and passwords
Staff and parent accounts get a **random temporary password**, emailed to them (safer than one shared default). They must change it at first login.

## Email
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` in `backend/.env`. Without them, emails print to the backend console and the temporary password is returned to the principal's screen.

## Automation (cron)
Monthly invoices (1st, 01:00), event and fee reminders (daily 09:00), scheduled notifications (every 15 min).

## Tests
`npm run dev` then `npm run smoke` in `backend` runs an end-to-end check.

## Limits
Push notifications need a dev build (not Expo Go). Dates are typed `YYYY-MM-DD`. No online payments.
