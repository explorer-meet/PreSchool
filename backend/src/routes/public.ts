import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { sendCredentials, sendResetCode } from '../services/mail';
import { authenticate, hash, HttpError, prisma, requireRole, signToken, tempPassword, wrap } from '../lib';

export const publicRouter = Router();
export const adminRouter = Router();

publicRouter.post('/auth/login', wrap(async (req, res) => {
  const { identifier, password } = z.object({ identifier: z.string(), password: z.string() }).parse(req.body);
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier.toLowerCase() }, { phone: identifier }] },
    include: { school: true },
  });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }
  if (user.school && user.school.status !== 'APPROVED') throw new HttpError(403, 'School is not active');
  const token = signToken({ id: user.id, role: user.role as any, schoolId: user.schoolId });
  res.json({
    token,
    mustChangePassword: user.mustChangePassword,
    user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId },
  });
}));

// Password reset by emailed 6-digit code. The response never reveals whether the email exists.
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

publicRouter.post('/auth/forgot-password', wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().email().transform((s) => s.toLowerCase()) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, include: { school: true } });
  if (user && user.active && (!user.school || user.school.status === 'APPROVED')) {
    const recent = await prisma.passwordReset.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (!recent) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await prisma.passwordReset.create({ data: { userId: user.id, codeHash: await hash(code), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
      await sendResetCode({ to: email, name: user.name, code });
    }
  }
  res.json({ ok: true, message: 'If this email is registered, a reset code is on its way.' });
}));

publicRouter.post('/auth/reset-password', wrap(async (req, res) => {
  const d = z.object({
    email: z.string().email().transform((s) => s.toLowerCase()),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8),
  }).parse(req.body);
  const invalid = new HttpError(400, 'Invalid or expired code');
  const user = await prisma.user.findUnique({ where: { email: d.email } });
  if (!user) throw invalid;
  const reset = await prisma.passwordReset.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!reset || reset.expiresAt < new Date() || reset.attempts >= MAX_RESET_ATTEMPTS) throw invalid;
  if (!(await bcrypt.compare(d.code, reset.codeHash))) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(d.newPassword), mustChangePassword: false } }),
  ]);
  res.json({ ok: true });
}));

publicRouter.post('/auth/change-password', authenticate, wrap(async (req, res) => {
  const { newPassword } = z.object({ newPassword: z.string().min(8) }).parse(req.body);
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash: await hash(newPassword), mustChangePassword: false },
  });
  res.json({ ok: true });
}));

publicRouter.post('/auth/device-token', authenticate, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  await prisma.deviceToken.upsert({
    where: { token }, update: { userId: req.user!.id }, create: { token, userId: req.user!.id },
  });
  res.json({ ok: true });
}));

// School self-registration. Nothing is usable until the super admin approves.
publicRouter.post('/schools/register', wrap(async (req, res) => {
  const d = z.object({
    name: z.string().min(2), address: z.string(), city: z.string(), phone: z.string().min(8),
    email: z.string().email().transform((s) => s.toLowerCase()),
    registrationNo: z.string().optional(), principalName: z.string().min(2),
  }).parse(req.body);
  const clash = await prisma.user.findUnique({ where: { email: d.email } });
  if (clash) throw new HttpError(409, 'Email already in use');
  const school = await prisma.school.create({ data: d });
  res.status(201).json({ id: school.id, status: school.status, message: 'Submitted for verification' });
}));

// ---- Super admin ----
adminRouter.use(authenticate, requireRole('SUPER_ADMIN'));

adminRouter.get('/schools', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await prisma.school.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' } }));
}));

const adminName = async (id: string) => (await prisma.user.findUnique({ where: { id } }))?.name ?? 'Super Admin';

// Every status change is written to the log in the same transaction as the update.
async function changeStatus(schoolId: string, to: 'APPROVED' | 'REJECTED' | 'SUSPENDED', adminId: string, reason?: string, allowed?: string[]) {
  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw new HttpError(404, 'School not found');
  if (school.status === to) throw new HttpError(409, `Already ${to.toLowerCase()}`);
  if (allowed && !allowed.includes(school.status)) throw new HttpError(409, `Cannot change from ${school.status} to ${to}`);
  const name = await adminName(adminId);
  const now = new Date();
  await prisma.$transaction([
    prisma.school.update({
      where: { id: schoolId },
      data: {
        status: to, statusChangedAt: now,
        rejectReason: to === 'APPROVED' ? null : reason ?? null,
        ...(to === 'APPROVED' && !school.approvedAt ? { approvedAt: now } : {}),
      },
    }),
    prisma.schoolStatusLog.create({
      data: { schoolId, fromStatus: school.status, toStatus: to, reason: reason ?? null, adminId, adminName: name, createdAt: now },
    }),
  ]);
  return school;
}

adminRouter.post('/schools/:id/approve', wrap(async (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(1).max(1200).optional() }).parse(req.body ?? {});
  const school = await changeStatus(req.params.id, 'APPROVED', req.user!.id, message);
  const existing = await prisma.user.findFirst({ where: { schoolId: school.id, role: 'PRINCIPAL' } });
  // Reactivation: the principal already has an account, so no new credentials are issued.
  if (existing) {
    return res.json({ schoolId: school.id, principalId: existing.id, login: school.email, reactivated: true, emailSent: false });
  }
  const password = tempPassword();
  const principal = await prisma.user.create({
    data: {
      schoolId: school.id, role: 'PRINCIPAL', name: school.principalName, email: school.email,
      phone: school.phone, passwordHash: await hash(password), designation: 'Principal',
    },
  });
  const emailSent = await sendCredentials({ to: school.email, name: school.principalName, login: school.email, password, school: school.name, role: 'Principal', message });
  res.json({ schoolId: school.id, principalId: principal.id, login: school.email, emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));

adminRouter.post('/schools/:id/reject', wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(1200) }).parse(req.body);
  await changeStatus(req.params.id, 'REJECTED', req.user!.id, reason);
  res.json({ ok: true });
}));

adminRouter.post('/schools/:id/suspend', wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(1200).optional() }).parse(req.body ?? {});
  await changeStatus(req.params.id, 'SUSPENDED', req.user!.id, reason, ['APPROVED']);
  res.json({ ok: true });
}));

adminRouter.get('/schools/:id/history', wrap(async (req, res) => {
  res.json(await prisma.schoolStatusLog.findMany({ where: { schoolId: req.params.id }, orderBy: { createdAt: 'desc' } }));
}));

adminRouter.get('/status-log', wrap(async (_req, res) => {
  res.json(await prisma.schoolStatusLog.findMany({
    orderBy: { createdAt: 'desc' }, take: 200, include: { school: { select: { name: true } } },
  }));
}));

// ---- Notification inbox for any signed-in user ----
publicRouter.get('/me/notifications', authenticate, wrap(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));
publicRouter.post('/me/notifications/read-all', authenticate, wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
