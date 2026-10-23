import { Router } from 'express';
import { z } from 'zod';
import { authenticate, HttpError, prisma, requireRole, wrap } from '../lib';
import { notifyUsers } from '../services/notify';

export const parentRouter = Router();
parentRouter.use(authenticate, requireRole('PARENT'));

async function myChild(userId: string, id: string) {
  const s = await prisma.student.findFirst({
    where: { id, parentId: userId },
    select: {
      id: true, schoolId: true, batchId: true, name: true, dob: true, gender: true,
      admissionNo: true, admissionDate: true, status: true, bloodGroup: true, allergies: true,
      homeAddress: true, alternateParentPhone: true, transportMode: true, transportContact: true, photoConsent: true,
      batch: { select: { id: true, name: true, startTime: true, endTime: true, class: { select: { name: true } }, teacher: { select: { name: true } } } },
    },
  });
  if (!s) throw new HttpError(404, 'Child not found');
  return s;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY = 86400000;
const SKILLS = ['language', 'numeracy', 'social', 'motor', 'creativity'] as const;

function summarize(rows: { status: string; lateMinutes: number | null }[]) {
  const present = rows.filter((r) => r.status === 'PRESENT').length;
  const late = rows.filter((r) => r.status === 'LATE');
  const absent = rows.filter((r) => r.status === 'ABSENT').length;
  const attended = present + late.length;
  return {
    total: rows.length, present, late: late.length, absent,
    totalLateMinutes: late.reduce((t, r) => t + (r.lateMinutes ?? 0), 0),
    percentage: rows.length ? Math.round((attended / rows.length) * 100) : null,
  };
}

parentRouter.get('/children', wrap(async (req, res) => {
  res.json(await prisma.student.findMany({
    where: { parentId: req.user!.id, status: 'ACTIVE' },
    select: {
      id: true, schoolId: true, batchId: true, name: true, dob: true, gender: true,
      admissionNo: true, admissionDate: true, status: true, bloodGroup: true, allergies: true,
      homeAddress: true, alternateParentPhone: true, transportMode: true, transportContact: true, photoConsent: true,
      batch: { select: { name: true, class: { select: { name: true } }, teacher: { select: { name: true } } } },
    },
  }));
}));
parentRouter.get('/children/:id', wrap(async (req, res) => res.json(await myChild(req.user!.id, req.params.id))));

parentRouter.get('/children/:id/medical', wrap(async (req, res) => {
  await myChild(req.user!.id, req.params.id);
  res.json(await prisma.medicalRecord.findMany({ where: { studentId: req.params.id }, orderBy: { date: 'desc' } }));
}));

parentRouter.get('/children/:id/reports', wrap(async (req, res) => {
  await myChild(req.user!.id, req.params.id);
  res.json(await prisma.progressReport.findMany({ where: { studentId: req.params.id }, orderBy: { createdAt: 'desc' } }));
}));

// Skill averages, latest scores and change vs the previous report.
parentRouter.get('/children/:id/performance', wrap(async (req, res) => {
  await myChild(req.user!.id, req.params.id);
  const reports = await prisma.progressReport.findMany({ where: { studentId: req.params.id }, orderBy: { createdAt: 'asc' } });
  const latest = reports[reports.length - 1], prev = reports[reports.length - 2];
  const skills = SKILLS.map((k) => {
    const vals = reports.map((r) => r[k]).filter((v): v is number => v != null);
    return {
      skill: k, latest: latest?.[k] ?? null,
      average: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
      change: latest?.[k] != null && prev?.[k] != null ? latest[k]! - prev[k]! : null,
    };
  });
  res.json({ reportCount: reports.length, skills, trend: reports.map((r) => ({ term: r.term, date: r.createdAt, ...Object.fromEntries(SKILLS.map((k) => [k, r[k]])) })), latestRemarks: latest?.remarks ?? null });
}));

// Month attendance with totals; ?month=YYYY-MM (default current)
parentRouter.get('/children/:id/attendance-report', wrap(async (req, res) => {
  await myChild(req.user!.id, req.params.id);
  const m = z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)).parse(req.query.month);
  const [y, mo] = m.split('-').map(Number);
  const rows = await prisma.attendance.findMany({
    where: { studentId: req.params.id, date: { gte: new Date(y, mo - 1, 1), lt: new Date(y, mo, 1) } }, orderBy: { date: 'asc' },
  });
  res.json({ month: m, summary: summarize(rows), days: rows });
}));

// Mon-Sun overview; ?weekStart=YYYY-MM-DD (default: this week's Monday)
parentRouter.get('/children/:id/weekly-summary', wrap(async (req, res) => {
  const child = await myChild(req.user!.id, req.params.id);
  const base = z.coerce.date().default(new Date()).parse(req.query.weekStart);
  const from = startOfDay(base);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  const to = new Date(from.getTime() + 7 * DAY);
  const [attendance, work, media, report, due] = await Promise.all([
    prisma.attendance.findMany({ where: { studentId: child.id, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } }),
    prisma.homework.findMany({ where: { batchId: child.batchId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } }),
    prisma.media.findMany({
      where: { createdAt: { gte: from, lt: to }, OR: [{ tags: { some: { studentId: child.id } } }, { batchId: child.batchId, tags: { none: {} } }] },
      select: { id: true, type: true, activity: true, caption: true, createdAt: true },
    }),
    prisma.progressReport.findFirst({ where: { studentId: child.id }, orderBy: { createdAt: 'desc' } }),
    prisma.feeInvoice.findMany({ where: { studentId: child.id, status: { not: 'PAID' } }, include: { feeStructure: { select: { name: true } } } }),
  ]);
  res.json({
    weekStart: from, weekEnd: new Date(to.getTime() - DAY),
    attendance: { summary: summarize(attendance), days: attendance },
    classwork: work.filter((w) => w.kind === 'CLASSWORK'), homework: work.filter((w) => w.kind === 'HOMEWORK'),
    activities: [...new Set(media.map((x) => x.activity).filter(Boolean))],
    mediaCount: media.length, media,
    teacherRemarks: report?.remarks ?? null,
    feesDue: due.map((i) => ({ name: i.feeStructure.name, due: i.amount - i.paidAmount, dueDate: i.dueDate })),
  });
}));

parentRouter.get('/children/:id/homework', wrap(async (req, res) => {
  const c = await myChild(req.user!.id, req.params.id);
  res.json(await prisma.homework.findMany({ where: { batchId: c.batchId }, orderBy: { createdAt: 'desc' }, take: 60 }));
}));

parentRouter.get('/children/:id/media', wrap(async (req, res) => {
  const c = await myChild(req.user!.id, req.params.id);
  res.json(await prisma.media.findMany({
    where: { OR: [{ tags: { some: { studentId: c.id } } }, { batchId: c.batchId, tags: { none: {} } }] },
    orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, caption: true, activity: true, createdAt: true },
  }));
}));

parentRouter.get('/children/:id/invoices', wrap(async (req, res) => {
  await myChild(req.user!.id, req.params.id);
  res.json(await prisma.feeInvoice.findMany({ where: { studentId: req.params.id }, include: { feeStructure: { select: { name: true } }, payments: true }, orderBy: { dueDate: 'desc' } }));
}));

parentRouter.get('/events', wrap(async (req, res) => {
  const kids = await prisma.student.findMany({ where: { parentId: req.user!.id }, select: { schoolId: true, batchId: true } });
  res.json(await prisma.event.findMany({
    where: { date: { gte: startOfDay(new Date()) }, OR: [{ schoolId: { in: kids.map((k) => k.schoolId) }, batchId: null }, { batchId: { in: kids.map((k) => k.batchId) } }] },
    orderBy: { date: 'asc' },
  }));
}));

// ---- Pick-up / drop by another person: needs principal approval ----
parentRouter.get('/children/:id/authorized-pickups', wrap(async (req, res) => {
  const child = await myChild(req.user!.id, req.params.id);
  res.json(await prisma.authorizedPickupPerson.findMany({
    where: { studentId: child.id, schoolId: child.schoolId, active: true },
    select: { id: true, name: true, relation: true },
    orderBy: { name: 'asc' },
  }));
}));

parentRouter.post('/children/:id/pickup-requests', wrap(async (req, res) => {
  const d = z.object({
    authorizedPersonId: z.string().optional(),
    personName: z.string().min(2).optional(), personPhone: z.string().min(8).optional(), relation: z.string().min(2).optional(),
    type: z.enum(['PICKUP', 'DROP', 'BOTH']), date: z.coerce.date(), reason: z.string().optional(),
  }).parse(req.body);
  const c = await myChild(req.user!.id, req.params.id);
  if (startOfDay(d.date) < startOfDay(new Date())) throw new HttpError(400, 'Date cannot be in the past');
  let person: { id: string; name: string; phone: string; relation: string } | null = null;
  if (d.authorizedPersonId) {
    person = await prisma.authorizedPickupPerson.findFirst({
      where: { id: d.authorizedPersonId, studentId: c.id, schoolId: c.schoolId, active: true },
      select: { id: true, name: true, phone: true, relation: true },
    });
    if (!person) throw new HttpError(404, 'Authorized pickup person not found');
  }
  if (!person && (!d.personName || !d.personPhone || !d.relation)) {
    throw new HttpError(400, 'Choose a registered person or provide their name, phone, and relation');
  }
  const pr = await prisma.pickupRequest.create({
    data: {
      type: d.type, date: startOfDay(d.date), reason: d.reason,
      personName: person?.name ?? d.personName!, personPhone: person?.phone ?? d.personPhone!,
      relation: person?.relation ?? d.relation!, authorizedPersonId: person?.id,
      schoolId: c.schoolId, studentId: c.id, parentId: req.user!.id,
    },
  });
  const principals = await prisma.user.findMany({ where: { schoolId: c.schoolId, role: 'PRINCIPAL' }, select: { id: true } });
  await notifyUsers(principals.map((p) => p.id), 'PICKUP', 'New pick-up request', `${pr.personName} (${pr.relation}) for ${c.name} on ${pr.date.toDateString()}`);
  res.status(201).json(pr);
}));

parentRouter.get('/pickup-requests', wrap(async (req, res) => {
  res.json(await prisma.pickupRequest.findMany({
    where: { parentId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { student: { select: { name: true } } },
  }));
}));

parentRouter.post('/pickup-requests/:id/cancel', wrap(async (req, res) => {
  const r = await prisma.pickupRequest.updateMany({ where: { id: req.params.id, parentId: req.user!.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
  if (!r.count) throw new HttpError(404, 'Request not found or already closed');
  res.json({ ok: true });
}));
