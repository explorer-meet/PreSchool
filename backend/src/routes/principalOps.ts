import crypto from 'crypto';
import { z } from 'zod';
import { HttpError, prisma, schoolId, wrap } from '../lib';
import { generateInvoices } from '../services/jobs';
import { notifyUsers, parentIdsFor } from '../services/notify';
import { ownBatch, ownClass, principalRouter } from './principal';

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
  const d = z.object({ amount: z.number().int().positive().optional(), dueDay: z.number().int().min(1).max(28).optional(), name: z.string().min(2).optional() }).parse(req.body);
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

principalRouter.get('/invoices', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await prisma.feeInvoice.findMany({
    where: { student: { schoolId: schoolId(req) }, ...(status === 'OPEN' ? { status: { not: 'PAID' } } : status ? { status } : {}) },
    include: { student: { select: { name: true, batch: { select: { name: true, class: { select: { name: true } } } } } }, feeStructure: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  }));
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
  const d = z.object({ title: z.string().min(2), description: z.string().optional(), date, batchId: z.string().optional() }).parse(req.body);
  const sid = schoolId(req);
  if (d.batchId) await ownBatch(sid, d.batchId);
  const ev = await prisma.event.create({ data: { ...d, schoolId: sid } });
  await notifyUsers(await parentIdsFor({ schoolId: sid, batchId: d.batchId }), 'EVENT', `New event: ${ev.title}`, `On ${ev.date.toDateString()}`);
  res.status(201).json(ev);
}));

// ---- Notifications: scheduled / recurring announcements and instant broadcasts ----
const audienceSchema = z.object({
  audience: z.enum(['SCHOOL', 'CLASS', 'BATCH']).default('SCHOOL'), classId: z.string().optional(), batchId: z.string().optional(),
});

async function checkAudience(sid: string, a: z.infer<typeof audienceSchema>) {
  if (a.audience === 'CLASS') { if (!a.classId) throw new HttpError(400, 'classId required'); await ownClass(sid, a.classId); }
  if (a.audience === 'BATCH') { if (!a.batchId) throw new HttpError(400, 'batchId required'); await ownBatch(sid, a.batchId); }
}

principalRouter.get('/notifications', wrap(async (req, res) => {
  res.json(await prisma.scheduledNotification.findMany({ where: { schoolId: schoolId(req) }, orderBy: { createdAt: 'desc' } }));
}));

principalRouter.post('/notifications', wrap(async (req, res) => {
  const d = audienceSchema.extend({
    title: z.string().min(2), body: z.string().min(2), kind: z.enum(['ONCE', 'MONTHLY']),
    date: date.optional(), dayOfMonth: z.number().int().min(1).max(31).optional(), sendHour: z.number().int().min(0).max(23).optional(),
  }).refine((x) => (x.kind === 'ONCE' ? !!x.date : !!x.dayOfMonth), { message: 'ONCE needs date; MONTHLY needs dayOfMonth' }).parse(req.body);
  const sid = schoolId(req);
  await checkAudience(sid, d);
  res.status(201).json(await prisma.scheduledNotification.create({ data: { ...d, schoolId: sid } }));
}));

principalRouter.patch('/notifications/:id', wrap(async (req, res) => {
  const d = z.object({ active: z.boolean() }).parse(req.body);
  const r = await prisma.scheduledNotification.updateMany({ where: { id: req.params.id, schoolId: schoolId(req) }, data: d });
  if (!r.count) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
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

// ---- Pick-up / drop requests ----
principalRouter.get('/pickup-requests', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await prisma.pickupRequest.findMany({
    where: { schoolId: schoolId(req), ...(status ? { status } : {}) }, orderBy: { date: 'desc' },
    include: { student: { select: { name: true, batch: { select: { name: true, class: { select: { name: true } } } } } } },
  }));
}));

principalRouter.post('/pickup-requests/:id/decide', wrap(async (req, res) => {
  const d = z.object({ approve: z.boolean(), note: z.string().optional() }).parse(req.body);
  const pr = await prisma.pickupRequest.findFirst({ where: { id: req.params.id, schoolId: schoolId(req) }, include: { student: true } });
  if (!pr) throw new HttpError(404, 'Request not found');
  if (pr.status !== 'PENDING') throw new HttpError(409, `Already ${pr.status.toLowerCase()}`);
  const code = d.approve ? String(crypto.randomInt(1000, 10000)) : null;
  await prisma.pickupRequest.update({
    where: { id: pr.id }, data: { status: d.approve ? 'APPROVED' : 'REJECTED', code, decisionNote: d.note, decidedAt: new Date() },
  });
  await notifyUsers([pr.parentId], 'PICKUP',
    d.approve ? 'Pick-up request approved' : 'Pick-up request rejected',
    d.approve
      ? `${pr.personName} may ${pr.type.toLowerCase()} ${pr.student.name} on ${pr.date.toDateString()}. Share this code with them: ${code}`
      : `Request for ${pr.personName} on ${pr.date.toDateString()} was rejected.${d.note ? ' ' + d.note : ''}`);
  res.json({ ok: true });
}));

