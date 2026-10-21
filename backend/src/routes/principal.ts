import { Router } from 'express';
import { z } from 'zod';
import { authenticate, hash, HttpError, prisma, requireRole, schoolId, tempPassword, wrap } from '../lib';
import { sendCredentials } from '../services/mail';

export const principalRouter = Router();
principalRouter.use(authenticate, requireRole('PRINCIPAL'));

export async function ownBatch(sid: string, id: string) {
  const b = await prisma.batch.findFirst({ where: { id, schoolId: sid } });
  if (!b) throw new HttpError(404, 'Batch not found');
  return b;
}
export async function ownClass(sid: string, id: string) {
  const c = await prisma.schoolClass.findFirst({ where: { id, schoolId: sid } });
  if (!c) throw new HttpError(404, 'Class not found');
  return c;
}

const STAFF_ROLES = ['TEACHER', 'HELPER', 'STAFF'];

// ---- Dashboard ----
principalRouter.get('/dashboard', wrap(async (req, res) => {
  const sid = schoolId(req);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [students, staff, batches, pendingPickups, att, dues] = await Promise.all([
    prisma.student.count({ where: { schoolId: sid, status: 'ACTIVE' } }),
    prisma.user.count({ where: { schoolId: sid, role: { in: STAFF_ROLES }, active: true } }),
    prisma.batch.count({ where: { schoolId: sid } }),
    prisma.pickupRequest.count({ where: { schoolId: sid, status: 'PENDING' } }),
    prisma.attendance.groupBy({ by: ['status'], where: { date: today, student: { schoolId: sid } }, _count: true }),
    prisma.feeInvoice.findMany({ where: { student: { schoolId: sid }, status: { not: 'PAID' } }, select: { amount: true, paidAmount: true, dueDate: true } }),
  ]);
  res.json({
    students, staff, batches, pendingPickups,
    attendanceToday: Object.fromEntries(att.map((a) => [a.status, a._count])),
    feesOutstanding: dues.reduce((t, i) => t + i.amount - i.paidAmount, 0),
    feesOverdue: dues.filter((i) => i.dueDate < now).reduce((t, i) => t + i.amount - i.paidAmount, 0),
  });
}));

principalRouter.get('/settings', wrap(async (req, res) => {
  res.json(await prisma.school.findUnique({ where: { id: schoolId(req) }, select: { name: true, feeReminderDays: true } }));
}));
principalRouter.patch('/settings', wrap(async (req, res) => {
  const d = z.object({ feeReminderDays: z.number().int().min(0).max(30) }).parse(req.body);
  res.json(await prisma.school.update({ where: { id: schoolId(req) }, data: d, select: { feeReminderDays: true } }));
}));

// ---- Classes (Jr KG, Sr KG...) ----
principalRouter.get('/classes', wrap(async (req, res) => {
  res.json(await prisma.schoolClass.findMany({
    where: { schoolId: schoolId(req) }, orderBy: { name: 'asc' },
    include: { _count: { select: { batches: true } }, feeStructures: true },
  }));
}));
principalRouter.post('/classes', wrap(async (req, res) => {
  const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
  res.status(201).json(await prisma.schoolClass.create({ data: { name: name.trim(), schoolId: schoolId(req) } }));
}));
principalRouter.patch('/classes/:id', wrap(async (req, res) => {
  const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
  await ownClass(schoolId(req), req.params.id);
  res.json(await prisma.schoolClass.update({ where: { id: req.params.id }, data: { name: name.trim() } }));
}));

// ---- Batches (Morning / Noon shifts of a class) ----
principalRouter.get('/batches', wrap(async (req, res) => {
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
  res.json(await prisma.batch.findMany({
    where: { schoolId: schoolId(req), ...(classId ? { classId } : {}) },
    orderBy: [{ classId: 'asc' }, { name: 'asc' }],
    include: { class: { select: { name: true } }, teacher: { select: { id: true, name: true } }, _count: { select: { students: true } } },
  }));
}));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const batchSchema = z.object({
  classId: z.string(), name: z.string().min(1), startTime: time.optional(), endTime: time.optional(),
  academicYear: z.string(), capacity: z.number().int().positive().optional(), teacherId: z.string().nullable().optional(),
});

async function checkTeacher(sid: string, teacherId?: string | null) {
  if (!teacherId) return;
  if (!(await prisma.user.findFirst({ where: { id: teacherId, schoolId: sid, role: 'TEACHER', active: true } }))) throw new HttpError(400, 'Invalid teacher');
}

principalRouter.post('/batches', wrap(async (req, res) => {
  const d = batchSchema.parse(req.body);
  const sid = schoolId(req);
  await ownClass(sid, d.classId);
  await checkTeacher(sid, d.teacherId);
  res.status(201).json(await prisma.batch.create({ data: { ...d, schoolId: sid } }));
}));

principalRouter.patch('/batches/:id', wrap(async (req, res) => {
  const d = batchSchema.omit({ classId: true }).partial().parse(req.body);
  const sid = schoolId(req);
  await ownBatch(sid, req.params.id);
  await checkTeacher(sid, d.teacherId);
  res.json(await prisma.batch.update({ where: { id: req.params.id }, data: d }));
}));

// ---- Teachers & staff ----
principalRouter.get('/staff', wrap(async (req, res) => {
  res.json(await prisma.user.findMany({
    where: { schoolId: schoolId(req), role: { in: STAFF_ROLES } }, orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, email: true, phone: true, designation: true, salary: true, active: true, mustChangePassword: true, batchesTaught: { select: { id: true, name: true, class: { select: { name: true } } } } },
  }));
}));

principalRouter.post('/staff', wrap(async (req, res) => {
  const d = z.object({
    name: z.string().min(2), role: z.enum(['TEACHER', 'HELPER', 'STAFF']),
    email: z.string().email().transform((s) => s.toLowerCase()), phone: z.string().min(8),
    designation: z.string().optional(), salary: z.number().int().optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  const password = tempPassword();
  const u = await prisma.user.create({ data: { ...d, schoolId: sid, passwordHash: await hash(password) } });
  const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
  const emailSent = await sendCredentials({ to: d.email, name: d.name, login: d.email, password, school: school.name, role: d.role });
  res.status(201).json({ id: u.id, login: d.email, emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));

principalRouter.patch('/staff/:id', wrap(async (req, res) => {
  const d = z.object({
    name: z.string().min(2).optional(), phone: z.string().min(8).optional(), designation: z.string().optional(),
    salary: z.number().int().optional(), active: z.boolean().optional(),
  }).parse(req.body);
  const r = await prisma.user.updateMany({ where: { id: req.params.id, schoolId: schoolId(req), role: { in: STAFF_ROLES } }, data: d });
  if (!r.count) throw new HttpError(404, 'Staff not found');
  if (d.active === false) await prisma.batch.updateMany({ where: { teacherId: req.params.id }, data: { teacherId: null } });
  res.json({ ok: true });
}));

principalRouter.post('/staff/:id/reset-password', wrap(async (req, res) => {
  const sid = schoolId(req);
  const u = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: { in: STAFF_ROLES } } });
  if (!u) throw new HttpError(404, 'Staff not found');
  const password = tempPassword();
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hash(password), mustChangePassword: true } });
  const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
  const emailSent = await sendCredentials({ to: u.email, name: u.name, login: u.email ?? u.phone ?? '', password, school: school.name, role: u.role });
  res.json({ emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));

// ---- Students ----
principalRouter.get('/students', wrap(async (req, res) => {
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
  res.json(await prisma.student.findMany({
    where: { schoolId: schoolId(req), status: 'ACTIVE', ...(batchId ? { batchId } : {}), ...(classId ? { batch: { classId } } : {}) },
    orderBy: { name: 'asc' },
    include: { batch: { select: { name: true, class: { select: { name: true } } } }, parent: { select: { name: true, phone: true, email: true } } },
  }));
}));

// Enrols a child into a batch. First enrolment for a parent creates their account and emails the credentials.
principalRouter.post('/students', wrap(async (req, res) => {
  const d = z.object({
    name: z.string().min(2), dob: z.coerce.date(), gender: z.string().optional(), batchId: z.string(),
    bloodGroup: z.string().optional(), allergies: z.string().optional(),
    parent: z.object({ name: z.string().min(2), phone: z.string().min(8), email: z.string().email().transform((s) => s.toLowerCase()) }),
  }).parse(req.body);
  const sid = schoolId(req);
  const batch = await ownBatch(sid, d.batchId);
  if ((await prisma.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) >= batch.capacity) throw new HttpError(409, 'Batch is full');

  let parent = await prisma.user.findFirst({ where: { OR: [{ phone: d.parent.phone }, { email: d.parent.email }] } });
  if (parent && (parent.role !== 'PARENT' || parent.schoolId !== sid)) throw new HttpError(409, 'Phone or email belongs to another account');
  let password: string | undefined;
  if (!parent) {
    password = tempPassword();
    parent = await prisma.user.create({
      data: { schoolId: sid, role: 'PARENT', name: d.parent.name, phone: d.parent.phone, email: d.parent.email, passwordHash: await hash(password) },
    });
  }
  const admissionNo = `ADM${new Date().getFullYear()}${String((await prisma.student.count({ where: { schoolId: sid } })) + 1).padStart(4, '0')}`;
  const { parent: _p, ...rest } = d;
  const student = await prisma.student.create({ data: { ...rest, schoolId: sid, parentId: parent.id, admissionNo } });

  let emailSent = false;
  if (password) {
    const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
    emailSent = await sendCredentials({ to: parent.email, name: parent.name, login: parent.email!, password, school: school.name, role: 'Parent' });
  }
  res.status(201).json({
    student, parentAccountCreated: !!password, parentLogin: parent.email, emailSent,
    ...(password && !emailSent ? { temporaryPassword: password } : {}),
  });
}));

principalRouter.patch('/students/:id', wrap(async (req, res) => {
  const d = z.object({
    batchId: z.string().optional(), status: z.enum(['ACTIVE', 'LEFT']).optional(),
    bloodGroup: z.string().optional(), allergies: z.string().optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  if (d.batchId) await ownBatch(sid, d.batchId);
  const r = await prisma.student.updateMany({ where: { id: req.params.id, schoolId: sid }, data: d });
  if (!r.count) throw new HttpError(404, 'Student not found');
  res.json({ ok: true });
}));

principalRouter.post('/parents/:id/reset-password', wrap(async (req, res) => {
  const sid = schoolId(req);
  const u = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: 'PARENT' } });
  if (!u) throw new HttpError(404, 'Parent not found');
  const password = tempPassword();
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hash(password), mustChangePassword: true } });
  const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
  const emailSent = await sendCredentials({ to: u.email, name: u.name, login: u.email ?? '', password, school: school.name, role: 'Parent' });
  res.json({ emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));
