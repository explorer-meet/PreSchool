import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { authenticate, HttpError, prisma, requireRole, schoolId, wrap } from '../lib';
import { notifyUsers, parentIdsFor } from '../services/notify';
import { readPrivateDocument } from '../services/privateDocuments';

export const teacherRouter = Router();
export const mediaRouter = Router();
teacherRouter.use(authenticate, requireRole('TEACHER'));

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp',
};
// Extension comes from the validated MIME type, never from the client's filename.
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[f.mimetype]),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => (EXT[f.mimetype] ? cb(null, true) : cb(new HttpError(415, 'Only images and videos are allowed'))),
});

async function myBatch(userId: string, sid: string, batchId: string) {
  const b = await prisma.batch.findFirst({ where: { id: batchId, teacherId: userId, schoolId: sid } });
  if (!b) throw new HttpError(404, 'Batch not found');
  return b;
}
async function myStudent(userId: string, sid: string, studentId: string) {
  const s = await prisma.student.findFirst({ where: { id: studentId, batch: { teacherId: userId }, schoolId: sid } });
  if (!s) throw new HttpError(404, 'Student not found');
  return s;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---- Classes & students ----
teacherRouter.get('/batches', wrap(async (req, res) => {
  res.json(await prisma.batch.findMany({
    where: { teacherId: req.user!.id, schoolId: schoolId(req) },
    include: { class: { select: { name: true } }, _count: { select: { students: true } } },
  }));
}));

teacherRouter.get('/batches/:id/students', wrap(async (req, res) => {
  await myBatch(req.user!.id, schoolId(req), req.params.id);
  res.json(await prisma.student.findMany({
    where: { batchId: req.params.id, status: 'ACTIVE' }, orderBy: { name: 'asc' },
    select: { id: true, name: true, dob: true, gender: true, allergies: true, bloodGroup: true, parent: { select: { name: true, phone: true } } },
  }));
}));

// ---- Attendance: PRESENT | ABSENT | LATE(+minutes) ----
teacherRouter.get('/batches/:id/attendance', wrap(async (req, res) => {
  await myBatch(req.user!.id, schoolId(req), req.params.id);
  const day = startOfDay(z.coerce.date().default(new Date()).parse(req.query.date));
  const students = await prisma.student.findMany({
    where: { batchId: req.params.id, status: 'ACTIVE' }, orderBy: { name: 'asc' },
    select: { id: true, name: true, attendance: { where: { date: day }, select: { status: true, lateMinutes: true } } },
  });
  res.json(students.map((s) => ({ id: s.id, name: s.name, status: s.attendance[0]?.status ?? null, lateMinutes: s.attendance[0]?.lateMinutes ?? null })));
}));

teacherRouter.post('/batches/:id/attendance', wrap(async (req, res) => {
  const d = z.object({
    date: z.coerce.date(),
    records: z.array(z.object({
      studentId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'LATE']), lateMinutes: z.number().int().min(1).max(240).optional(),
    }).refine((r) => r.status !== 'LATE' || !!r.lateMinutes, { message: 'lateMinutes required for LATE' })),
  }).parse(req.body);
  await myBatch(req.user!.id, schoolId(req), req.params.id);
  const day = startOfDay(d.date);
  if (day.getTime() > startOfDay(new Date()).getTime()) throw new HttpError(400, 'Cannot mark attendance for a future date');
  const kids = await prisma.student.findMany({ where: { batchId: req.params.id, status: 'ACTIVE' }, select: { id: true, name: true, parentId: true } });
  const byId = new Map(kids.map((k) => [k.id, k]));
  const isToday = day.getTime() === startOfDay(new Date()).getTime();
  for (const r of d.records) {
    const kid = byId.get(r.studentId);
    if (!kid) continue;
    const lateMinutes = r.status === 'LATE' ? r.lateMinutes : null;
    const prev = await prisma.attendance.findUnique({ where: { studentId_date: { studentId: kid.id, date: day } } });
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: kid.id, date: day } },
      update: { status: r.status, lateMinutes }, create: { studentId: kid.id, date: day, status: r.status, lateMinutes },
    });
    if (isToday && r.status !== 'PRESENT' && prev?.status !== r.status) {
      await notifyUsers([kid.parentId], 'ATTENDANCE', r.status === 'ABSENT' ? `${kid.name} marked absent` : `${kid.name} arrived late`,
        r.status === 'ABSENT' ? `${kid.name} was marked absent today.` : `${kid.name} arrived ${lateMinutes} min late today.`);
    }
  }
  res.json({ ok: true });
}));

// ---- Classwork & homework ----
teacherRouter.post('/batches/:id/homework', wrap(async (req, res) => {
  const d = z.object({
    kind: z.enum(['CLASSWORK', 'HOMEWORK']).default('HOMEWORK'), title: z.string().min(2), description: z.string().min(2), dueDate: z.coerce.date().optional(),
  }).parse(req.body);
  const sid = schoolId(req);
  await myBatch(req.user!.id, sid, req.params.id);
  const hw = await prisma.homework.create({ data: { ...d, batchId: req.params.id, authorId: req.user!.id } });
  await notifyUsers(await parentIdsFor({ schoolId: sid, batchId: req.params.id }), 'HOMEWORK',
    `${d.kind === 'CLASSWORK' ? 'Classwork' : 'Homework'}: ${hw.title}`, hw.description.slice(0, 140));
  res.status(201).json(hw);
}));

teacherRouter.get('/batches/:id/homework', wrap(async (req, res) => {
  await myBatch(req.user!.id, schoolId(req), req.params.id);
  res.json(await prisma.homework.findMany({ where: { batchId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));

// ---- Reports & medical history ----
const rating = z.number().int().min(1).max(5).optional();
teacherRouter.post('/students/:id/reports', wrap(async (req, res) => {
  const d = z.object({ term: z.string(), language: rating, numeracy: rating, social: rating, motor: rating, creativity: rating, remarks: z.string().optional() }).parse(req.body);
  await myStudent(req.user!.id, schoolId(req), req.params.id);
  res.status(201).json(await prisma.progressReport.create({ data: { ...d, studentId: req.params.id, authorId: req.user!.id } }));
}));

teacherRouter.get('/students/:id/medical', wrap(async (req, res) => {
  await myStudent(req.user!.id, schoolId(req), req.params.id);
  res.json(await prisma.medicalRecord.findMany({ where: { studentId: req.params.id }, orderBy: { date: 'desc' } }));
}));

teacherRouter.post('/students/:id/medical', wrap(async (req, res) => {
  const d = z.object({ type: z.enum(['CHECKUP', 'VACCINATION', 'ILLNESS', 'ALLERGY', 'OTHER']), title: z.string().min(2), notes: z.string().optional(), date: z.coerce.date() }).parse(req.body);
  await myStudent(req.user!.id, schoolId(req), req.params.id);
  res.status(201).json(await prisma.medicalRecord.create({ data: { ...d, studentId: req.params.id, authorId: req.user!.id } }));
}));

// ---- Photos & videos. studentIds => about those children (activity); none => whole batch ----
teacherRouter.post('/batches/:id/media', upload.single('file'), wrap(async (req, res) => {
  const sid = schoolId(req);
  const file = req.file;
  if (!file) throw new HttpError(400, 'file is required');
  try {
    await myBatch(req.user!.id, sid, req.params.id);
    const d = z.object({
      caption: z.string().optional(), activity: z.string().optional(),
      studentIds: z.string().optional().transform((s) => (s ? (JSON.parse(s) as string[]) : [])).pipe(z.array(z.string())),
    }).parse(req.body);
    let kids = await prisma.student.findMany({
      where: {
        batchId: req.params.id, status: 'ACTIVE',
        ...(d.studentIds.length ? { id: { in: d.studentIds } } : { OR: [{ photoConsent: true }, { photoConsent: null }] }),
      },
      select: { id: true, parentId: true, photoConsent: true },
    });
    if (d.studentIds.length && kids.length !== d.studentIds.length) {
      const validStudents = await prisma.student.count({
        where: { id: { in: d.studentIds }, batchId: req.params.id, status: 'ACTIVE' },
      });
      if (validStudents !== d.studentIds.length) throw new HttpError(400, 'Some students are not in this batch');
      throw new HttpError(403, 'Photo and video sharing requires parent consent');
    }
    if (!kids.length) throw new HttpError(400, 'No students in this batch have photo-sharing consent');
    if (kids.some((kid) => kid.photoConsent === false)) throw new HttpError(403, 'Photo and video sharing requires parent consent');
    const media = await prisma.media.create({
      data: {
        schoolId: sid, batchId: req.params.id, uploaderId: req.user!.id, mime: file.mimetype, fileName: file.filename,
        type: file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE', caption: d.caption, activity: d.activity,
        tags: { create: kids.map((k) => ({ studentId: k.id })) },
      },
    });
    const what = media.type === 'VIDEO' ? 'video' : 'photo';
    const title = d.activity ? `New ${what}: ${d.activity}` : `New class ${what}`;
    const targets = kids.map((k) => k.parentId);
    await notifyUsers(targets, 'MEDIA', title, d.caption ?? 'Open the app to view.');
    res.status(201).json(media);
  } catch (e) {
    fs.unlink(file.path, () => {});
    throw e;
  }
}));

teacherRouter.get('/batches/:id/media', wrap(async (req, res) => {
  await myBatch(req.user!.id, schoolId(req), req.params.id);
  res.json(await prisma.media.findMany({
    where: { batchId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100,
    include: { tags: { include: { student: { select: { name: true } } } } },
  }));
}));

// ---- Pick-up verification at handover ----
teacherRouter.get('/pickups', wrap(async (req, res) => {
  const day = startOfDay(new Date());
  res.json(await prisma.pickupRequest.findMany({
    where: { schoolId: schoolId(req), status: 'APPROVED', date: { gte: day, lt: new Date(day.getTime() + 86400000) }, student: { status: 'ACTIVE', batch: { teacherId: req.user!.id } } },
    select: {
      id: true, personName: true, personPhone: true, relation: true, type: true,
      authorizedPersonId: true, student: { select: { name: true } },
    }, // code and identity documents are never sent to teachers
  }));
}));

teacherRouter.get('/pickups/:id/authorized-photo', wrap(async (req, res) => {
  const day = startOfDay(new Date());
  const request = await prisma.pickupRequest.findFirst({
    where: {
      id: req.params.id, schoolId: schoolId(req), status: 'APPROVED',
      date: { gte: day, lt: new Date(day.getTime() + 86400000) },
      student: { status: 'ACTIVE', batch: { teacherId: req.user!.id } },
    },
    select: { authorizedPerson: { select: { photoFileName: true, photoMime: true, active: true } } },
  });
  const person = request?.authorizedPerson;
  if (!person?.active || !person.photoFileName || !person.photoMime) throw new HttpError(404, 'Registered pickup photo not available');
  const image = await readPrivateDocument(UPLOAD_DIR, person.photoFileName);
  res.type(person.photoMime).set('Cache-Control', 'private, no-store').send(image);
}));

teacherRouter.post('/pickups/:id/complete', wrap(async (req, res) => {
  const { code } = z.object({ code: z.string().length(4) }).parse(req.body);
  const pr = await prisma.pickupRequest.findFirst({
    where: { id: req.params.id, schoolId: schoolId(req), status: 'APPROVED', student: { status: 'ACTIVE', batch: { teacherId: req.user!.id } } }, include: { student: true },
  });
  if (!pr) throw new HttpError(404, 'Approved request not found');
  if (startOfDay(pr.date).getTime() !== startOfDay(new Date()).getTime()) throw new HttpError(400, 'Request is not valid today');
  if (!pr.code || !crypto.timingSafeEqual(Buffer.from(pr.code), Buffer.from(code))) throw new HttpError(403, 'Incorrect code');
  await prisma.pickupRequest.update({ where: { id: pr.id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: req.user!.id } });
  await notifyUsers([pr.parentId], 'PICKUP', 'Handover completed', `${pr.student.name} was handed over to ${pr.personName}.`);
  res.json({ ok: true });
}));

teacherRouter.get('/events', wrap(async (req, res) => {
  res.json(await prisma.event.findMany({ where: { schoolId: schoolId(req), date: { gte: new Date() } }, orderBy: { date: 'asc' } }));
}));

// ---- Authenticated media download (teacher of batch, principal of school, parent of tagged/batch child) ----
mediaRouter.get('/:id/file', authenticate, wrap(async (req, res) => {
  const u = req.user!;
  const m = await prisma.media.findUnique({ where: { id: req.params.id }, include: { tags: true, batch: true } });
  if (!m || m.schoolId !== u.schoolId) throw new HttpError(404, 'Not found');
  let ok = u.role === 'PRINCIPAL' || (u.role === 'TEACHER' && m.batch.teacherId === u.id);
  if (u.role === 'PARENT') {
    const kids = await prisma.student.findMany({ where: { parentId: u.id }, select: { id: true, batchId: true } });
    ok = m.tags.length ? m.tags.some((t) => kids.some((k) => k.id === t.studentId)) : kids.some((k) => k.batchId === m.batchId);
  }
  if (!ok) throw new HttpError(404, 'Not found');
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(UPLOAD_DIR, m.fileName));
}));
