import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sendCredentials } from '../services/mail';
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

adminRouter.post('/schools/:id/approve', wrap(async (req, res) => {
  const school = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!school) throw new HttpError(404, 'School not found');
  if (school.status === 'APPROVED') throw new HttpError(409, 'Already approved');
  const password = tempPassword();
  const principal = await prisma.$transaction(async (tx) => {
    await tx.school.update({ where: { id: school.id }, data: { status: 'APPROVED', approvedAt: new Date(), rejectReason: null } });
    return tx.user.create({
      data: {
        schoolId: school.id, role: 'PRINCIPAL', name: school.principalName, email: school.email,
        phone: school.phone, passwordHash: await hash(password), designation: 'Principal',
      },
    });
  });
  const emailSent = await sendCredentials({ to: school.email, name: school.principalName, login: school.email, password, school: school.name, role: 'Principal' });
  res.json({ schoolId: school.id, principalId: principal.id, login: school.email, emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));

adminRouter.post('/schools/:id/reject', wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  await prisma.school.update({ where: { id: req.params.id }, data: { status: 'REJECTED', rejectReason: reason } });
  res.json({ ok: true });
}));

adminRouter.post('/schools/:id/suspend', wrap(async (req, res) => {
  await prisma.school.update({ where: { id: req.params.id }, data: { status: 'SUSPENDED' } });
  res.json({ ok: true });
}));

// ---- Notification inbox for any signed-in user ----
publicRouter.get('/me/notifications', authenticate, wrap(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));
publicRouter.post('/me/notifications/read-all', authenticate, wrap(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
