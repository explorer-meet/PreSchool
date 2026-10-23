import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { HttpError, prisma, schoolId, wrap } from '../lib';
import { generateInvoices } from '../services/jobs';
import { notifyUsers, parentIdsFor } from '../services/notify';
import { readPrivateDocument, removePrivateDocument, storePrivateDocument, validateImageBytes } from '../services/privateDocuments';
import { ownBatch, ownClass, privateUpload, privateUploadDir, principalRouter } from './principal';

const date = z.coerce.date();

// ---- Fee structures (per class) & collection ----
principalRouter.get('/fee-structures', wrap(async (req, res) => {
  res.json(await prisma.feeStructure.findMany({ where: { schoolId: schoolId(req) }, include: { class: { select: { name: true } } }, orderBy: { classId: 'asc' } }));
}));

principalRouter.post('/fee-structures', wrap(async (req, res) => {
  const d = z.object({
    classId: z.string(), name: z.string().min(2), amount: z.number().int().positive(),
    frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']), dueDay: z.number().int().min(1).max(28).optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  await ownClass(sid, d.classId);
  res.status(201).json(await prisma.feeStructure.create({ data: { ...d, schoolId: sid } }));
}));

principalRouter.patch('/fee-structures/:id', wrap(async (req, res) => {
  const d = z.object({
    amount: z.number().int().positive().optional(), dueDay: z.number().int().min(1).max(28).optional(),
    name: z.string().trim().min(2).max(80).optional(),
    frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']).optional(),
  }).parse(req.body);
  const r = await prisma.feeStructure.updateMany({ where: { id: req.params.id, schoolId: schoolId(req) }, data: d });
  if (!r.count) throw new HttpError(404, 'Fee structure not found');
  res.json({ ok: true }); // existing invoices keep their original amount
}));

principalRouter.delete('/fee-structures/:id', wrap(async (req, res) => {
  const sid = schoolId(req);
  const fs = await prisma.feeStructure.findFirst({ where: { id: req.params.id, schoolId: sid } });
  if (!fs) throw new HttpError(404, 'Fee structure not found');
  if (await prisma.feeInvoice.count({ where: { feeStructureId: fs.id } })) throw new HttpError(409, 'Invoices exist for this fee; edit the amount instead');
  await prisma.feeStructure.delete({ where: { id: fs.id } });
  res.json({ ok: true });
}));

principalRouter.post('/invoices/generate', wrap(async (req, res) => {
  res.json({ created: await generateInvoices(schoolId(req)) });
}));

const invoiceInclude = {
  student: { select: { id: true, name: true, admissionNo: true, batch: { select: { name: true, class: { select: { name: true } } } } } },
  feeStructure: { select: { name: true } }, payments: { orderBy: { paidAt: 'desc' as const } },
};

principalRouter.post('/invoices', wrap(async (req, res) => {
  const d = z.object({
    studentId: z.string().min(1), feeStructureId: z.string().min(1),
    amount: z.number().int().positive().max(2147483647),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Billing period must use YYYY-MM'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
      const parsed = new Date(value);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Enter a valid due date'),
  }).parse(req.body);
  const sid = schoolId(req);
  const invoice = await prisma.$transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: d.studentId, schoolId: sid, status: 'ACTIVE' }, select: { batch: { select: { classId: true } } } });
    if (!student) throw new HttpError(404, 'Active student not found');
    const fee = await tx.feeStructure.findFirst({ where: { id: d.feeStructureId, schoolId: sid, classId: student.batch.classId } });
    if (!fee) throw new HttpError(400, 'Choose a fee plan belonging to this student’s class');
    const existing = await tx.feeInvoice.findFirst({
      where: { studentId: d.studentId, feeStructureId: d.feeStructureId, ...(fee.frequency === 'ONE_TIME' ? {} : { period: d.period }) },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, 'An invoice already exists for this student, fee and billing period');
    return tx.feeInvoice.create({ data: { ...d, dueDate: new Date(`${d.dueDate}T00:00:00`) }, include: invoiceInclude });
  });
  res.status(201).json(invoice);
}));

principalRouter.get('/invoices', wrap(async (req, res) => {
  const status = z.enum(['OPEN', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE']).optional().parse(req.query.status);
  const overdue = new Date();
  overdue.setHours(0, 0, 0, 0);
  res.json(await prisma.feeInvoice.findMany({
    where: { student: { schoolId: schoolId(req) }, ...(status === 'OVERDUE' ? { status: { not: 'PAID' }, dueDate: { lt: overdue } } : status === 'OPEN' ? { status: { not: 'PAID' } } : status ? { status } : {}) },
    include: invoiceInclude,
    orderBy: [{ dueDate: 'desc' }, { id: 'asc' }],
  }));
}));

principalRouter.get('/invoices/:id', wrap(async (req, res) => {
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: req.params.id, student: { schoolId: schoolId(req) } }, include: invoiceInclude });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  res.json(invoice);
}));

principalRouter.post('/invoices/:id/payments', wrap(async (req, res) => {
  const d = z.object({ amount: z.number().int().positive(), method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().optional() }).parse(req.body);
  const sid = schoolId(req);
  const inv = await prisma.$transaction(async (tx) => {
    const i = await tx.feeInvoice.findFirst({ where: { id: req.params.id, student: { schoolId: sid } }, include: { student: true } });
    if (!i) throw new HttpError(404, 'Invoice not found');
    if (d.amount > i.amount - i.paidAmount) throw new HttpError(400, 'Amount exceeds balance');
    await tx.payment.create({ data: { invoiceId: i.id, ...d } });
    const paid = i.paidAmount + d.amount;
    await tx.feeInvoice.update({ where: { id: i.id }, data: { paidAmount: paid, status: paid >= i.amount ? 'PAID' : 'PARTIAL' } });
    return i;
  });
  await notifyUsers([inv.student.parentId], 'FEE', 'Payment received', `₹${(d.amount / 100).toFixed(2)} received for ${inv.student.name}. Thank you!`);
  res.json({ ok: true });
}));

// ---- Events ----
principalRouter.get('/events', wrap(async (req, res) => {
  res.json(await prisma.event.findMany({ where: { schoolId: schoolId(req) }, orderBy: { date: 'asc' }, include: { batch: { select: { name: true, class: { select: { name: true } } } } } }));
}));

principalRouter.post('/events', wrap(async (req, res) => {
  const d = z.object({ title: z.string().min(2), description: z.string().optional(), date, batchId: z.string().nullable().optional() }).parse(req.body);
  const sid = schoolId(req);
  if (d.batchId) await ownBatch(sid, d.batchId);
  const ev = await prisma.event.create({ data: { ...d, schoolId: sid } });
  await notifyUsers(await parentIdsFor({ schoolId: sid, batchId: d.batchId }), 'EVENT', `New event: ${ev.title}`, `On ${ev.date.toDateString()}`);
  res.status(201).json(ev);
}));

principalRouter.patch('/events/:id', wrap(async (req, res) => {
  const d = z.object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().nullable().optional(),
    date: date.optional(),
    batchId: z.string().nullable().optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  const event = await prisma.event.findFirst({ where: { id: req.params.id, schoolId: sid } });
  if (!event) throw new HttpError(404, 'Event not found');
  if (d.batchId) await ownBatch(sid, d.batchId);
  res.json(await prisma.event.update({ where: { id: event.id }, data: { ...d, reminderSent: false } }));
}));

principalRouter.delete('/events/:id', wrap(async (req, res) => {
  const r = await prisma.event.deleteMany({ where: { id: req.params.id, schoolId: schoolId(req) } });
  if (!r.count) throw new HttpError(404, 'Event not found');
  res.json({ ok: true });
}));

// ---- Notifications: scheduled / recurring announcements and instant broadcasts ----
const audienceSchema = z.object({
  audience: z.enum(['SCHOOL', 'CLASS', 'BATCH']).default('SCHOOL'), classId: z.string().nullable().optional(), batchId: z.string().nullable().optional(),
});

async function checkAudience(sid: string, a: z.infer<typeof audienceSchema>) {
  if (a.audience === 'CLASS') { if (!a.classId) throw new HttpError(400, 'classId required'); await ownClass(sid, a.classId); }
  if (a.audience === 'BATCH') { if (!a.batchId) throw new HttpError(400, 'batchId required'); await ownBatch(sid, a.batchId); }
}

principalRouter.get('/notifications', wrap(async (req, res) => {
  res.json(await prisma.scheduledNotification.findMany({ where: { schoolId: schoolId(req) }, orderBy: { createdAt: 'desc' } }));
}));

const scheduleFields = audienceSchema.extend({
  title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(5000), kind: z.enum(['ONCE', 'MONTHLY']),
  date: date.nullable().optional(), dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  sendHour: z.number().int().min(0).max(23).default(9), active: z.boolean().default(true),
});
const scheduleSchema = scheduleFields.refine((x) => x.kind === 'ONCE' ? !!x.date : !!x.dayOfMonth, { message: 'Choose a date for one-time notifications or a day for monthly notifications' });
function normalizeSchedule(d: z.infer<typeof scheduleSchema>) {
  return { ...d, classId: d.audience === 'CLASS' ? d.classId : null, batchId: d.audience === 'BATCH' ? d.batchId : null, date: d.kind === 'ONCE' ? d.date : null, dayOfMonth: d.kind === 'MONTHLY' ? d.dayOfMonth : null };
}

principalRouter.post('/notifications', wrap(async (req, res) => {
  const d = scheduleSchema.parse(req.body);
  const sid = schoolId(req);
  await checkAudience(sid, d);
  res.status(201).json(await prisma.scheduledNotification.create({ data: { ...normalizeSchedule(d), schoolId: sid } }));
}));

principalRouter.patch('/notifications/:id', wrap(async (req, res) => {
  const patch = scheduleFields.extend({ audience: z.enum(['SCHOOL', 'CLASS', 'BATCH']), sendHour: z.number().int().min(0).max(23), active: z.boolean() }).partial().strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update').parse(req.body);
  const sid = schoolId(req);
  const existing = await prisma.scheduledNotification.findFirst({ where: { id: req.params.id, schoolId: sid } });
  if (!existing) throw new HttpError(404, 'Schedule not found');
  // Changing the recurrence/target requires its matching field, not a stale hidden value.
  const merged = { ...existing, ...patch };
  if (patch.kind && patch.kind !== existing.kind) {
    if (patch.kind === 'ONCE' && patch.date === undefined) merged.date = null;
    if (patch.kind === 'MONTHLY' && patch.dayOfMonth === undefined) merged.dayOfMonth = null;
  }
  const d = scheduleSchema.parse(merged);
  await checkAudience(sid, d);
  res.json(await prisma.scheduledNotification.update({ where: { id: existing.id }, data: normalizeSchedule(d) }));
}));

principalRouter.delete('/notifications/:id', wrap(async (req, res) => {
  const r = await prisma.scheduledNotification.deleteMany({ where: { id: req.params.id, schoolId: schoolId(req) } });
  if (!r.count) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

principalRouter.post('/broadcast', wrap(async (req, res) => {
  const d = audienceSchema.extend({ title: z.string().min(2), body: z.string().min(2) }).parse(req.body);
  const sid = schoolId(req);
  await checkAudience(sid, d);
  const parents = await parentIdsFor({ schoolId: sid, classId: d.audience === 'CLASS' ? d.classId : null, batchId: d.audience === 'BATCH' ? d.batchId : null });
  await notifyUsers(parents, 'GENERAL', d.title, d.body);
  res.json({ recipients: new Set(parents).size });
}));

// ---- Principal-managed authorized pickup people and encrypted documents ----
principalRouter.get('/authorized-pickups', wrap(async (req, res) => {
  const rows = await prisma.authorizedPickupPerson.findMany({
    where: { schoolId: schoolId(req) },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { student: { select: { id: true, name: true, status: true, batch: { select: { name: true, class: { select: { name: true } } } } } } },
  });
  res.json(rows.map(({ photoFileName, aadhaarFileName, photoMime: _photoMime, aadhaarMime: _aadhaarMime, ...person }) => ({
    ...person, hasPhoto: !!photoFileName, hasAadhaar: !!aadhaarFileName,
  })));
}));

principalRouter.post('/authorized-pickups', privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'aadhaar', maxCount: 1 }]), wrap(async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const photo = files.photo?.[0];
  const aadhaar = files.aadhaar?.[0];
  const stored: string[] = [];
  try {
    const d = z.object({
      studentId: z.string().min(1),
      name: z.string().trim().min(2).max(100),
      phone: z.string().trim().min(8).max(20),
      relation: z.string().trim().min(2).max(50),
    }).parse(req.body);
    if (!photo || !aadhaar) throw new HttpError(400, 'A recent photo and Aadhaar card image are required');
    validateImageBytes(photo.mimetype, photo.buffer);
    validateImageBytes(aadhaar.mimetype, aadhaar.buffer);
    const sid = schoolId(req);
    const student = await prisma.student.findFirst({ where: { id: d.studentId, schoolId: sid, status: 'ACTIVE' } });
    if (!student) throw new HttpError(404, 'Active student not found');
    if (await prisma.authorizedPickupPerson.findFirst({ where: { studentId: student.id, phone: d.phone } })) {
      throw new HttpError(409, 'This phone number is already registered for the student');
    }

    const photoFileName = `${crypto.randomBytes(16).toString('hex')}.enc`;
    const aadhaarFileName = `${crypto.randomBytes(16).toString('hex')}.enc`;
    stored.push(await storePrivateDocument(privateUploadDir, photoFileName, photo.buffer));
    stored.push(await storePrivateDocument(privateUploadDir, aadhaarFileName, aadhaar.buffer));
    const person = await prisma.authorizedPickupPerson.create({
      data: {
        ...d, schoolId: sid, photoFileName, photoMime: photo.mimetype,
        aadhaarFileName, aadhaarMime: aadhaar.mimetype,
      },
      select: { id: true, studentId: true, name: true, phone: true, relation: true, active: true, createdAt: true },
    });
    res.status(201).json({ ...person, hasPhoto: true, hasAadhaar: true });
  } catch (error) {
    for (const file of stored) await removePrivateDocument(privateUploadDir, path.basename(file)).catch((cleanupError) => console.error('Unable to remove an unlinked authorized-person document', cleanupError));
    throw error;
  }
}));

principalRouter.patch('/authorized-pickups/:id', privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'aadhaar', maxCount: 1 }]), wrap(async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const photo = files.photo?.[0];
  const aadhaar = files.aadhaar?.[0];
  const d = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().min(8).max(20).optional(),
    relation: z.string().trim().min(2).max(50).optional(),
    active: z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean()).optional(),
  }).parse(req.body);
  if (photo) validateImageBytes(photo.mimetype, photo.buffer);
  if (aadhaar) validateImageBytes(aadhaar.mimetype, aadhaar.buffer);
  const old = await prisma.authorizedPickupPerson.findFirst({ where: { id: req.params.id, schoolId: schoolId(req) } });
  if (!old) throw new HttpError(404, 'Authorized pickup person not found');
  if (d.phone && d.phone !== old.phone && await prisma.authorizedPickupPerson.findFirst({ where: { studentId: old.studentId, phone: d.phone } })) {
    throw new HttpError(409, 'This phone number is already registered for the student');
  }
  if (d.active && ((!old.photoFileName && !photo) || (!old.aadhaarFileName && !aadhaar))) {
    throw new HttpError(400, 'Add both the photo and Aadhaar image before restoring access');
  }

  const replacementPhoto = photo ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  const replacementAadhaar = aadhaar ? `${crypto.randomBytes(16).toString('hex')}.enc` : undefined;
  const photoFileName = replacementPhoto ?? old.photoFileName;
  const aadhaarFileName = replacementAadhaar ?? old.aadhaarFileName;
  const stored: string[] = [];
  let updated = false;
  try {
    if (photo && replacementPhoto) stored.push(await storePrivateDocument(privateUploadDir, replacementPhoto, photo.buffer));
    if (aadhaar && replacementAadhaar) stored.push(await storePrivateDocument(privateUploadDir, replacementAadhaar, aadhaar.buffer));
    const person = await prisma.authorizedPickupPerson.update({
      where: { id: old.id },
      data: { ...d, photoFileName, photoMime: photo?.mimetype ?? old.photoMime, aadhaarFileName, aadhaarMime: aadhaar?.mimetype ?? old.aadhaarMime },
      select: { id: true, studentId: true, name: true, phone: true, relation: true, active: true, createdAt: true },
    });
    updated = true;
    if (photo) await removePrivateDocument(privateUploadDir, old.photoFileName).catch((error) => console.error('Unable to remove replaced pickup photo', error));
    if (aadhaar) await removePrivateDocument(privateUploadDir, old.aadhaarFileName).catch((error) => console.error('Unable to remove replaced Aadhaar image', error));
    res.json({ ...person, hasPhoto: !!photoFileName, hasAadhaar: !!aadhaarFileName });
  } catch (error) {
    if (!updated) {
      for (const file of stored) await removePrivateDocument(privateUploadDir, path.basename(file)).catch((cleanupError) => console.error('Unable to remove an unlinked authorized-person document', cleanupError));
    }
    throw error;
  }
}));

principalRouter.delete('/authorized-pickups/:id', wrap(async (req, res) => {
  const person = await prisma.authorizedPickupPerson.findFirst({ where: { id: req.params.id, schoolId: schoolId(req) } });
  if (!person) throw new HttpError(404, 'Authorized pickup person not found');
  const parentIds = await prisma.$transaction(async (tx) => {
    const openRequests = await tx.pickupRequest.findMany({
      where: { authorizedPersonId: person.id, status: { in: ['PENDING', 'APPROVED'] } },
      select: { parentId: true },
    });
    await tx.authorizedPickupPerson.update({
      where: { id: person.id },
      data: { active: false, photoFileName: null, photoMime: null, aadhaarFileName: null, aadhaarMime: null },
    });
    await tx.pickupRequest.updateMany({
      where: { authorizedPersonId: person.id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'CANCELLED', code: null, decisionNote: 'Authorized pickup access was revoked.', decidedAt: new Date() },
    });
    return [...new Set(openRequests.map((request) => request.parentId))];
  });
  await Promise.all([
    removePrivateDocument(privateUploadDir, person.photoFileName),
    removePrivateDocument(privateUploadDir, person.aadhaarFileName),
  ]);
  if (parentIds.length) await notifyUsers(parentIds, 'PICKUP', 'Authorized pickup access revoked', `${person.name} is no longer authorized to pick up or drop off the student. Related open requests were cancelled.`);
  res.json({ ok: true });
}));

principalRouter.get('/authorized-pickups/:id/documents/:kind', wrap(async (req, res) => {
  const kind = z.enum(['photo', 'aadhaar']).parse(req.params.kind);
  const person = await prisma.authorizedPickupPerson.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req) },
    select: { photoFileName: true, photoMime: true, aadhaarFileName: true, aadhaarMime: true },
  });
  if (!person) throw new HttpError(404, 'Authorized pickup person not found');
  const fileName = kind === 'photo' ? person.photoFileName : person.aadhaarFileName;
  const mime = kind === 'photo' ? person.photoMime : person.aadhaarMime;
  if (!fileName || !mime) throw new HttpError(404, 'Document not found');
  const image = await readPrivateDocument(privateUploadDir, fileName);
  res.type(mime).set('Cache-Control', 'private, no-store').send(image);
}));

// ---- Pick-up / drop requests ----
principalRouter.get('/pickup-requests', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await prisma.pickupRequest.findMany({
    where: { schoolId: schoolId(req), ...(status ? { status } : {}) }, orderBy: { date: 'desc' },
    include: { student: { select: { name: true, batch: { select: { name: true, class: { select: { name: true } } } } } } },
  }));
}));

principalRouter.post('/pickup-requests/:id/decide', wrap(async (req, res) => {
  const d = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(req.body);
  const pr = await prisma.pickupRequest.findFirst({ where: { id: req.params.id, schoolId: schoolId(req) }, include: { student: true } });
  if (!pr) throw new HttpError(404, 'Request not found');
  if (pr.status !== 'PENDING') throw new HttpError(409, `Already ${pr.status.toLowerCase()}`);
  if (d.approve && pr.student.status !== 'ACTIVE') throw new HttpError(409, 'Student is no longer active');
  if (d.approve && pr.authorizedPersonId) {
    const person = await prisma.authorizedPickupPerson.findFirst({
      where: { id: pr.authorizedPersonId, schoolId: schoolId(req), studentId: pr.studentId, active: true },
    });
    if (!person) throw new HttpError(409, 'Registered pickup access has been revoked');
  }
  const code = d.approve ? String(crypto.randomInt(1000, 10000)) : null;
  const updated = await prisma.pickupRequest.updateMany({
    where: { id: pr.id, schoolId: schoolId(req), status: 'PENDING' }, data: { status: d.approve ? 'APPROVED' : 'REJECTED', code, decisionNote: d.note, decidedAt: new Date() },
  });
  if (!updated.count) throw new HttpError(409, 'This request has already been decided. Refresh to see its current status.');
  await notifyUsers([pr.parentId], 'PICKUP',
    d.approve ? 'Pick-up request approved' : 'Pick-up request rejected',
    d.approve
      ? `${pr.personName} may ${pr.type.toLowerCase()} ${pr.student.name} on ${pr.date.toDateString()}. Share this code with them: ${code}`
      : `Request for ${pr.personName} on ${pr.date.toDateString()} was rejected.${d.note ? ' ' + d.note : ''}`);
  res.json({ ok: true });
}));
