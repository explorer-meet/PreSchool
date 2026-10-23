import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { authenticate, hash, HttpError, prisma, requireRole, schoolId, tempPassword, wrap } from '../lib';
import { sendCredentials } from '../services/mail';
import { encryptLegacyDocument, readPrivateDocument, removePrivateDocument, storePrivateDocument, validateImageBytes, validImageMime } from '../services/privateDocuments';

export const principalRouter = Router();
principalRouter.use(authenticate, requireRole('PRINCIPAL'));

const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
export const privateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, done) => (validImageMime(file.mimetype) ? done(null, true) : done(new HttpError(415, 'Only JPEG, PNG, or WebP images are allowed'))),
});
export const privateUploadDir = uploadDir;

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
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const [students, staff, batches, pendingPickups, att, dues, school, mediaPosts, homeworkPosts, events] = await Promise.all([
    prisma.student.count({ where: { schoolId: sid, status: 'ACTIVE' } }),
    prisma.user.count({ where: { schoolId: sid, role: { in: STAFF_ROLES }, active: true } }),
    prisma.batch.count({ where: { schoolId: sid } }),
    prisma.pickupRequest.count({ where: { schoolId: sid, status: 'PENDING' } }),
    prisma.attendance.groupBy({ by: ['status'], where: { date: today, student: { schoolId: sid, status: 'ACTIVE' } }, _count: true }),
    prisma.feeInvoice.findMany({ where: { student: { schoolId: sid }, status: { not: 'PAID' } }, select: { amount: true, paidAmount: true, dueDate: true } }),
    prisma.school.findUniqueOrThrow({ where: { id: sid }, select: { name: true } }),
    prisma.media.count({ where: { schoolId: sid, createdAt: { gte: weekStart, lt: nextWeek } } }),
    prisma.homework.count({ where: { batch: { schoolId: sid }, createdAt: { gte: weekStart, lt: nextWeek } } }),
    prisma.event.count({ where: { schoolId: sid, date: { gte: weekStart, lt: nextWeek } } }),
  ]);
  res.json({
    schoolName: school.name, students, staff, batches, pendingPickups,
    updatesThisWeek: mediaPosts + homeworkPosts + events,
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
  const { name } = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
  res.status(201).json(await prisma.schoolClass.create({ data: { name: name.trim(), schoolId: schoolId(req) } }));
}));
principalRouter.patch('/classes/:id', wrap(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
  await ownClass(schoolId(req), req.params.id);
  res.json(await prisma.schoolClass.update({ where: { id: req.params.id }, data: { name: name.trim() } }));
}));
principalRouter.delete('/classes/:id', wrap(async (req, res) => {
  const sid = schoolId(req);
  await ownClass(sid, req.params.id);
  const [batches, fees] = await Promise.all([
    prisma.batch.count({ where: { classId: req.params.id, schoolId: sid } }),
    prisma.feeStructure.count({ where: { classId: req.params.id, schoolId: sid } }),
  ]);
  if (batches || fees) throw new HttpError(409, 'Remove this class’s batches and fee plans before deleting it');
  await prisma.schoolClass.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---- Batches (Morning / Noon shifts of a class) ----
principalRouter.get('/batches', wrap(async (req, res) => {
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
  res.json(await prisma.batch.findMany({
    where: { schoolId: schoolId(req), ...(classId ? { classId } : {}) },
    orderBy: [{ classId: 'asc' }, { name: 'asc' }],
    include: { class: { select: { name: true } }, teacher: { select: { id: true, name: true } }, _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
  }));
}));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const batchSchema = z.object({
  classId: z.string(), name: z.string().min(1), startTime: time.nullable().optional(), endTime: time.nullable().optional(),
  academicYear: z.string(), capacity: z.number().int().positive().optional(), teacherId: z.string().nullable().optional(),
});

function checkBatchTimes(batch: { startTime?: string | null; endTime?: string | null }) {
  if (batch.startTime && batch.endTime && batch.startTime >= batch.endTime) throw new HttpError(400, 'Batch end time must be after its start time');
}

async function checkTeacher(sid: string, teacherId?: string | null) {
  if (!teacherId) return;
  if (!(await prisma.user.findFirst({ where: { id: teacherId, schoolId: sid, role: 'TEACHER', active: true } }))) throw new HttpError(400, 'Invalid teacher');
}

principalRouter.post('/batches', wrap(async (req, res) => {
  const d = batchSchema.parse(req.body);
  checkBatchTimes(d);
  const sid = schoolId(req);
  await ownClass(sid, d.classId);
  await checkTeacher(sid, d.teacherId);
  res.status(201).json(await prisma.batch.create({ data: { ...d, schoolId: sid } }));
}));

principalRouter.patch('/batches/:id', wrap(async (req, res) => {
  const d = batchSchema.partial().parse(req.body);
  const sid = schoolId(req);
  const batch = await ownBatch(sid, req.params.id);
  checkBatchTimes({ ...batch, ...d });
  if (d.classId) await ownClass(sid, d.classId);
  await checkTeacher(sid, d.teacherId);
  if (d.capacity !== undefined && d.capacity < await prisma.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) {
    throw new HttpError(409, 'Capacity cannot be lower than the number of enrolled students');
  }
  res.json(await prisma.batch.update({ where: { id: req.params.id }, data: d }));
}));
principalRouter.delete('/batches/:id', wrap(async (req, res) => {
  const sid = schoolId(req);
  await ownBatch(sid, req.params.id);
  if (await prisma.student.count({ where: { batchId: req.params.id } })) throw new HttpError(409, 'Move or mark students as left before deleting this batch');
  await prisma.batch.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---- Teachers & staff ----
principalRouter.get('/staff', wrap(async (req, res) => {
  const staff = await prisma.user.findMany({
    where: { schoolId: schoolId(req), role: { in: STAFF_ROLES } }, orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, email: true, phone: true, designation: true, address: true, salary: true, active: true, mustChangePassword: true, photoFileName: true, batchesTaught: { select: { id: true, name: true, class: { select: { name: true } } } } },
  });
  res.json(staff.map(({ photoFileName, ...user }) => ({ ...user, hasPhoto: !!photoFileName })));
}));

principalRouter.get('/staff/:id/photo', wrap(async (req, res) => {
  const staff = await prisma.user.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req), role: { in: STAFF_ROLES } },
    select: { photoFileName: true, photoMime: true },
  });
  if (!staff?.photoFileName) throw new HttpError(404, 'Staff photo not found');
  await encryptLegacyDocument(uploadDir, staff.photoFileName);
  const image = await readPrivateDocument(uploadDir, staff.photoFileName);
  res.type(staff.photoMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));

principalRouter.post('/staff', privateUpload.single('photo'), wrap(async (req, res) => {
  const photo = req.file;
  if (photo) validateImageBytes(photo.mimetype, photo.buffer);
  const d = z.object({
    name: z.string().trim().min(2), role: z.enum(['TEACHER', 'HELPER', 'STAFF']),
    email: z.string().email().transform((s) => s.toLowerCase()), phone: z.string().trim().min(8),
    designation: z.string().optional(), address: z.string().optional(),
    salary: z.preprocess((value) => value === '' || value == null ? undefined : Number(value), z.number().int().nonnegative().optional()),
    batchId: z.string().optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  if (d.batchId && d.role !== 'TEACHER') throw new HttpError(400, 'Only teachers can be assigned to a batch');
  if (d.batchId) await ownBatch(sid, d.batchId);
  const password = tempPassword();
  const { batchId, ...staff } = d;
  const photoFileName = photo ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  let photoPath: string | undefined;
  let staffCreated = false;
  try {
    if (photo && photoFileName) photoPath = await storePrivateDocument(uploadDir, photoFileName, photo.buffer);
    const u = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...staff, schoolId: sid, passwordHash: await hash(password), photoFileName, photoMime: photo?.mimetype },
      });
      if (batchId) await tx.batch.update({ where: { id: batchId }, data: { teacherId: created.id } });
      return created;
    });
    staffCreated = true;
    const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
    const emailSent = await sendCredentials({ to: d.email, name: d.name, login: d.email, password, school: school.name, role: d.role });
    res.status(201).json({ id: u.id, name: u.name, role: u.role, login: d.email, emailSent, hasPhoto: !!photoFileName, ...(emailSent ? {} : { temporaryPassword: password }) });
  } catch (error) {
    if (!staffCreated && photoPath) await removePrivateDocument(uploadDir, path.basename(photoPath)).catch((cleanupError) => console.error('Unable to remove an unlinked staff photo', cleanupError));
    throw error;
  }
}));

principalRouter.patch('/staff/:id', privateUpload.single('photo'), wrap(async (req, res) => {
  const photo = req.file;
  if (photo) validateImageBytes(photo.mimetype, photo.buffer);
  const d = z.object({
    name: z.string().trim().min(2).optional(), phone: z.string().trim().min(8).optional(), designation: z.string().optional(), address: z.string().optional(),
    salary: z.preprocess((value) => value === '' || value == null ? undefined : Number(value), z.number().int().nonnegative().optional()),
    active: z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean()).optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  const old = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: { in: STAFF_ROLES } }, select: { photoFileName: true } });
  if (!old) throw new HttpError(404, 'Staff not found');
  const photoFileName = photo ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  let photoPath: string | undefined;
  let updated = false;
  try {
    if (photo && photoFileName) photoPath = await storePrivateDocument(uploadDir, photoFileName, photo.buffer);
    const updatedStaff = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...d, ...(photo ? { photoFileName, photoMime: photo.mimetype } : {}) },
    });
    updated = true;
    if (d.active === false) await prisma.batch.updateMany({ where: { teacherId: req.params.id }, data: { teacherId: null } });
    if (photo && old.photoFileName) await removePrivateDocument(uploadDir, old.photoFileName).catch((error) => console.error('Unable to remove replaced staff photo', error));
    res.json({ ok: true, hasPhoto: !!updatedStaff.photoFileName });
  } catch (error) {
    if (!updated && photoPath) await removePrivateDocument(uploadDir, path.basename(photoPath)).catch((cleanupError) => console.error('Unable to remove an unlinked staff photo', cleanupError));
    throw error;
  }
}));

principalRouter.delete('/staff/:id', wrap(async (req, res) => {
  const staff = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: schoolId(req), role: { in: STAFF_ROLES } } });
  if (!staff) throw new HttpError(404, 'Staff not found');
  await prisma.$transaction([
    prisma.user.update({ where: { id: staff.id }, data: { active: false } }),
    prisma.batch.updateMany({ where: { teacherId: staff.id }, data: { teacherId: null } }),
    prisma.deviceToken.deleteMany({ where: { userId: staff.id } }),
  ]);
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
  const students = await prisma.student.findMany({
    where: { schoolId: schoolId(req), status: 'ACTIVE', ...(batchId ? { batchId } : {}), ...(classId ? { batch: { classId } } : {}) },
    orderBy: { name: 'asc' },
    include: { batch: { select: { name: true, class: { select: { name: true } } } }, parent: { select: { name: true, phone: true, email: true } } },
  });
  res.json(students.map(({ identityDocumentFileName, photoFileName, identityDocumentMime: _identityMime, photoMime: _photoMime, ...student }) => ({
    ...student, hasIdentityDocument: !!identityDocumentFileName, hasPhoto: !!photoFileName,
  })));
}));

principalRouter.get('/students/:id/identity-document', wrap(async (req, res) => {
  const student = await prisma.student.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req) },
    select: { identityDocumentFileName: true, identityDocumentMime: true },
  });
  if (!student?.identityDocumentFileName) throw new HttpError(404, 'Identity document not found');
  await encryptLegacyDocument(uploadDir, student.identityDocumentFileName);
  const image = await readPrivateDocument(uploadDir, student.identityDocumentFileName);
  res.type(student.identityDocumentMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));

principalRouter.get('/students/:id/private-documents/:kind', wrap(async (req, res) => {
  const kind = z.enum(['photo', 'identity']).parse(req.params.kind);
  const student = await prisma.student.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req) },
    select: { photoFileName: true, photoMime: true, identityDocumentFileName: true, identityDocumentMime: true },
  });
  if (!student) throw new HttpError(404, 'Student not found');
  const fileName = kind === 'photo' ? student.photoFileName : student.identityDocumentFileName;
  const mime = kind === 'photo' ? student.photoMime : student.identityDocumentMime;
  if (!fileName) throw new HttpError(404, 'Document not found');
  await encryptLegacyDocument(uploadDir, fileName);
  const image = await readPrivateDocument(uploadDir, fileName);
  res.type(mime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));

principalRouter.get('/students/:id/photo', wrap(async (req, res) => {
  const student = await prisma.student.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req) },
    select: { photoFileName: true, photoMime: true },
  });
  if (!student?.photoFileName) throw new HttpError(404, 'Student photo not found');
  await encryptLegacyDocument(uploadDir, student.photoFileName);
  const image = await readPrivateDocument(uploadDir, student.photoFileName);
  res.type(student.photoMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));

// Enrols a child into a batch. First enrolment for a parent creates their account and emails the credentials.
principalRouter.post('/students', privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'identityDocument', maxCount: 1 }]), wrap(async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const photo = files.photo?.[0];
  const identityDocument = files.identityDocument?.[0];
  const storedFiles: string[] = [];
  let studentCreated = false;
  try {
    let parentInput = req.body.parent;
    if (typeof parentInput === 'string') {
      try { parentInput = JSON.parse(parentInput); }
      catch { throw new HttpError(400, 'Invalid parent details'); }
    }
    const d = z.object({
      name: z.string().trim().min(2), dob: z.coerce.date().max(new Date(), 'Date of birth cannot be in the future'), gender: z.string().optional(), batchId: z.string(),
      bloodGroup: z.string().optional(), allergies: z.string().optional(), homeAddress: z.string().optional(),
      alternateParentPhone: z.string().optional(), transportMode: z.enum(['SCHOOL_VAN', 'PERSONAL']).optional(),
      transportContact: z.string().optional(),
      photoConsent: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
      parent: z.object({ name: z.string().min(2), phone: z.string().min(8), email: z.string().email().transform((s) => s.toLowerCase()) }),
    }).parse({ ...req.body, parent: parentInput });
    if (photo) validateImageBytes(photo.mimetype, photo.buffer);
    if (identityDocument) validateImageBytes(identityDocument.mimetype, identityDocument.buffer);
    const sid = schoolId(req);
    const batch = await ownBatch(sid, d.batchId);
    if ((await prisma.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) >= batch.capacity) throw new HttpError(409, 'Batch is full');

    const photoFileName = photo ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
    const identityDocumentFileName = identityDocument ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
    if (photo && photoFileName) storedFiles.push(await storePrivateDocument(uploadDir, photoFileName, photo.buffer));
    if (identityDocument && identityDocumentFileName) storedFiles.push(await storePrivateDocument(uploadDir, identityDocumentFileName, identityDocument.buffer));

    const generatedPassword = tempPassword();
    const passwordHash = await hash(generatedPassword);
    const { student, parent, password } = await prisma.$transaction(async (tx) => {
      if ((await tx.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) >= batch.capacity) throw new HttpError(409, 'Batch is full');
      const matchingParents = await tx.user.findMany({ where: { OR: [{ phone: d.parent.phone }, { email: d.parent.email }] } });
      let parent = matchingParents[0];
      if (matchingParents.length > 1 || (parent && (parent.role !== 'PARENT' || parent.schoolId !== sid || !parent.active))) throw new HttpError(409, 'Phone or email belongs to another account');
      if (parent && (parent.phone !== d.parent.phone || parent.email !== d.parent.email)) throw new HttpError(409, 'Use the existing parent account’s registered email and phone');
      const password = parent ? undefined : generatedPassword;
      if (!parent) parent = await tx.user.create({
        data: { schoolId: sid, role: 'PARENT', name: d.parent.name, phone: d.parent.phone, email: d.parent.email, passwordHash },
      });
      const admissionNo = `ADM${new Date().getFullYear()}${String((await tx.student.count({ where: { schoolId: sid } })) + 1).padStart(4, '0')}`;
      const { parent: _p, ...rest } = d;
      const student = await tx.student.create({
        data: {
          ...rest, schoolId: sid, parentId: parent.id, admissionNo,
          identityDocumentFileName, identityDocumentMime: identityDocument?.mimetype,
          photoFileName, photoMime: photo?.mimetype,
        },
      });
      return { student, parent, password };
    });
    studentCreated = true;

    let emailSent = false;
    if (password) {
      const school = await prisma.school.findUniqueOrThrow({ where: { id: sid } });
      emailSent = await sendCredentials({ to: parent.email, name: parent.name, login: parent.email!, password, school: school.name, role: 'Parent' });
    }
    const { identityDocumentFileName: _documentFile, identityDocumentMime: _identityMime, photoFileName: _photoFile, photoMime: _photoMime, ...studentResponse } = student;
    res.status(201).json({
      student: { ...studentResponse, hasIdentityDocument: !!identityDocumentFileName, hasPhoto: !!photoFileName },
      parentAccountCreated: !!password, parentLogin: parent.email, emailSent,
      ...(password && !emailSent ? { temporaryPassword: password } : {}),
    });
  } catch (error) {
    if (!studentCreated) {
      for (const filePath of storedFiles) {
        try { await fs.promises.unlink(filePath); }
        catch (cleanupError) { console.error('Unable to remove an unlinked private document', cleanupError); }
      }
    }
    throw error;
  }
}));

principalRouter.patch('/students/:id', privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'identityDocument', maxCount: 1 }]), wrap(async (req, res) => {
  const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
  const photo = files?.photo?.[0];
  const identity = files?.identityDocument?.[0];
  if (photo) validateImageBytes(photo.mimetype, photo.buffer);
  if (identity) validateImageBytes(identity.mimetype, identity.buffer);
  const optionalText = z.preprocess((value) => value === '' ? null : value, z.string().nullable().optional());
  const d = z.object({
    batchId: z.string().optional(), status: z.enum(['ACTIVE', 'LEFT']).optional(), name: z.string().trim().min(2).optional(),
    dob: z.coerce.date().max(new Date(), 'Date of birth cannot be in the future').optional(), gender: optionalText, bloodGroup: optionalText,
    allergies: optionalText, homeAddress: optionalText,
    alternateParentPhone: optionalText, transportMode: z.preprocess((value) => value === '' ? null : value, z.enum(['SCHOOL_VAN', 'PERSONAL']).nullable().optional()),
    transportContact: optionalText, photoConsent: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean().nullable().optional()),
  }).parse(req.body);
  const sid = schoolId(req);
  if (d.batchId) await ownBatch(sid, d.batchId);
  const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId: sid } });
  if (!student) throw new HttpError(404, 'Student not found');
  if ((d.status ?? student.status) === 'LEFT' && (photo || identity)) throw new HttpError(400, 'Cannot upload documents for a student marked as left');
  if (d.batchId && d.batchId !== student.batchId) {
    const targetBatch = await ownBatch(sid, d.batchId);
    if ((await prisma.student.count({ where: { batchId: d.batchId, status: 'ACTIVE' } })) >= targetBatch.capacity && (d.status ?? student.status) === 'ACTIVE') {
      throw new HttpError(409, 'The selected batch is full');
    }
  }
  const storedFiles: string[] = [];
  const photoFileName = photo ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  const identityDocumentFileName = identity ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  const pickupDocuments: Array<{ photoFileName: string | null; aadhaarFileName: string | null }> = [];
  try {
    if (photo && photoFileName) storedFiles.push(await storePrivateDocument(uploadDir, photoFileName, photo.buffer));
    if (identity && identityDocumentFileName) storedFiles.push(await storePrivateDocument(uploadDir, identityDocumentFileName, identity.buffer));
    await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: student.id },
        data: d.status === 'LEFT'
          ? { ...d, photoFileName: null, photoMime: null, identityDocumentFileName: null, identityDocumentMime: null }
          : { ...d, ...(photo ? { photoFileName, photoMime: photo.mimetype } : {}), ...(identity ? { identityDocumentFileName, identityDocumentMime: identity.mimetype } : {}) },
      });
      if (d.status === 'LEFT') {
        pickupDocuments.push(...await tx.authorizedPickupPerson.findMany({
          where: { studentId: student.id }, select: { photoFileName: true, aadhaarFileName: true },
        }));
        await tx.authorizedPickupPerson.updateMany({
          where: { studentId: student.id },
          data: { active: false, photoFileName: null, photoMime: null, aadhaarFileName: null, aadhaarMime: null },
        });
      }
    });
  } catch (error) {
    await Promise.all(storedFiles.map((filePath) => removePrivateDocument(uploadDir, path.basename(filePath)).catch((cleanupError) => console.error('Unable to remove unlinked student document', cleanupError))));
    throw error;
  }
  if (d.status === 'LEFT' || photo || identity) {
    await Promise.all([
      d.status === 'LEFT' || photo ? removePrivateDocument(uploadDir, student.photoFileName) : Promise.resolve(),
      d.status === 'LEFT' || identity ? removePrivateDocument(uploadDir, student.identityDocumentFileName) : Promise.resolve(),
    ]);
  }
  await Promise.all(pickupDocuments.flatMap((docs) => [
    removePrivateDocument(uploadDir, docs.photoFileName),
    removePrivateDocument(uploadDir, docs.aadhaarFileName),
  ]));
  res.json({ ok: true });
}));

principalRouter.delete('/students/:id', wrap(async (req, res) => {
  const sid = schoolId(req);
  const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId: sid } });
  if (!student) throw new HttpError(404, 'Student not found');
  const pickupDocuments = await prisma.authorizedPickupPerson.findMany({
    where: { studentId: student.id }, select: { photoFileName: true, aadhaarFileName: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.student.update({
      where: { id: student.id },
      data: { status: 'LEFT', photoFileName: null, photoMime: null, identityDocumentFileName: null, identityDocumentMime: null },
    });
    await tx.authorizedPickupPerson.updateMany({
      where: { studentId: student.id },
      data: { active: false, photoFileName: null, photoMime: null, aadhaarFileName: null, aadhaarMime: null },
    });
  });
  await Promise.all([
    removePrivateDocument(uploadDir, student.photoFileName),
    removePrivateDocument(uploadDir, student.identityDocumentFileName),
  ]);
  await Promise.all(pickupDocuments.flatMap((docs) => [
    removePrivateDocument(uploadDir, docs.photoFileName),
    removePrivateDocument(uploadDir, docs.aadhaarFileName),
  ]));
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
