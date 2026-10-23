"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_DIR = exports.mediaRouter = exports.teacherRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const zod_1 = require("zod");
const lib_1 = require("../lib");
const notify_1 = require("../services/notify");
const privateDocuments_1 = require("../services/privateDocuments");
exports.teacherRouter = (0, express_1.Router)();
exports.mediaRouter = (0, express_1.Router)();
exports.teacherRouter.use(lib_1.authenticate, (0, lib_1.requireRole)('TEACHER'));
exports.UPLOAD_DIR = path_1.default.resolve(process.env.UPLOAD_DIR ?? 'uploads');
fs_1.default.mkdirSync(exports.UPLOAD_DIR, { recursive: true });
const EXT = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp',
};
// Extension comes from the validated MIME type, never from the client's filename.
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: exports.UPLOAD_DIR,
        filename: (_r, f, cb) => cb(null, crypto_1.default.randomBytes(16).toString('hex') + EXT[f.mimetype]),
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter: (_r, f, cb) => (EXT[f.mimetype] ? cb(null, true) : cb(new lib_1.HttpError(415, 'Only images and videos are allowed'))),
});
async function myBatch(userId, sid, batchId) {
    const b = await lib_1.prisma.batch.findFirst({ where: { id: batchId, teacherId: userId, schoolId: sid } });
    if (!b)
        throw new lib_1.HttpError(404, 'Batch not found');
    return b;
}
async function myStudent(userId, sid, studentId) {
    const s = await lib_1.prisma.student.findFirst({ where: { id: studentId, batch: { teacherId: userId }, schoolId: sid } });
    if (!s)
        throw new lib_1.HttpError(404, 'Student not found');
    return s;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// ---- Classes & students ----
exports.teacherRouter.get('/batches', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.batch.findMany({
        where: { teacherId: req.user.id, schoolId: (0, lib_1.schoolId)(req) },
        include: { class: { select: { name: true } }, _count: { select: { students: true } } },
    }));
}));
exports.teacherRouter.get('/batches/:id/students', (0, lib_1.wrap)(async (req, res) => {
    await myBatch(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.json(await lib_1.prisma.student.findMany({
        where: { batchId: req.params.id, status: 'ACTIVE' }, orderBy: { name: 'asc' },
        select: { id: true, name: true, dob: true, gender: true, allergies: true, bloodGroup: true, parent: { select: { name: true, phone: true } } },
    }));
}));
// ---- Attendance: PRESENT | ABSENT | LATE(+minutes) ----
exports.teacherRouter.get('/batches/:id/attendance', (0, lib_1.wrap)(async (req, res) => {
    await myBatch(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    const day = startOfDay(zod_1.z.coerce.date().default(new Date()).parse(req.query.date));
    const students = await lib_1.prisma.student.findMany({
        where: { batchId: req.params.id, status: 'ACTIVE' }, orderBy: { name: 'asc' },
        select: { id: true, name: true, attendance: { where: { date: day }, select: { status: true, lateMinutes: true } } },
    });
    res.json(students.map((s) => ({ id: s.id, name: s.name, status: s.attendance[0]?.status ?? null, lateMinutes: s.attendance[0]?.lateMinutes ?? null })));
}));
exports.teacherRouter.post('/batches/:id/attendance', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        date: zod_1.z.coerce.date(),
        records: zod_1.z.array(zod_1.z.object({
            studentId: zod_1.z.string(), status: zod_1.z.enum(['PRESENT', 'ABSENT', 'LATE']), lateMinutes: zod_1.z.number().int().min(1).max(240).optional(),
        }).refine((r) => r.status !== 'LATE' || !!r.lateMinutes, { message: 'lateMinutes required for LATE' })),
    }).parse(req.body);
    await myBatch(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    const day = startOfDay(d.date);
    if (day.getTime() > startOfDay(new Date()).getTime())
        throw new lib_1.HttpError(400, 'Cannot mark attendance for a future date');
    const kids = await lib_1.prisma.student.findMany({ where: { batchId: req.params.id, status: 'ACTIVE' }, select: { id: true, name: true, parentId: true } });
    const byId = new Map(kids.map((k) => [k.id, k]));
    const isToday = day.getTime() === startOfDay(new Date()).getTime();
    for (const r of d.records) {
        const kid = byId.get(r.studentId);
        if (!kid)
            continue;
        const lateMinutes = r.status === 'LATE' ? r.lateMinutes : null;
        const prev = await lib_1.prisma.attendance.findUnique({ where: { studentId_date: { studentId: kid.id, date: day } } });
        await lib_1.prisma.attendance.upsert({
            where: { studentId_date: { studentId: kid.id, date: day } },
            update: { status: r.status, lateMinutes }, create: { studentId: kid.id, date: day, status: r.status, lateMinutes },
        });
        if (isToday && r.status !== 'PRESENT' && prev?.status !== r.status) {
            await (0, notify_1.notifyUsers)([kid.parentId], 'ATTENDANCE', r.status === 'ABSENT' ? `${kid.name} marked absent` : `${kid.name} arrived late`, r.status === 'ABSENT' ? `${kid.name} was marked absent today.` : `${kid.name} arrived ${lateMinutes} min late today.`);
        }
    }
    res.json({ ok: true });
}));
// ---- Classwork & homework ----
exports.teacherRouter.post('/batches/:id/homework', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        kind: zod_1.z.enum(['CLASSWORK', 'HOMEWORK']).default('HOMEWORK'), title: zod_1.z.string().min(2), description: zod_1.z.string().min(2), dueDate: zod_1.z.coerce.date().optional(),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    await myBatch(req.user.id, sid, req.params.id);
    const hw = await lib_1.prisma.homework.create({ data: { ...d, batchId: req.params.id, authorId: req.user.id } });
    await (0, notify_1.notifyUsers)(await (0, notify_1.parentIdsFor)({ schoolId: sid, batchId: req.params.id }), 'HOMEWORK', `${d.kind === 'CLASSWORK' ? 'Classwork' : 'Homework'}: ${hw.title}`, hw.description.slice(0, 140));
    res.status(201).json(hw);
}));
exports.teacherRouter.get('/batches/:id/homework', (0, lib_1.wrap)(async (req, res) => {
    await myBatch(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.json(await lib_1.prisma.homework.findMany({ where: { batchId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));
// ---- Reports & medical history ----
const rating = zod_1.z.number().int().min(1).max(5).optional();
exports.teacherRouter.post('/students/:id/reports', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ term: zod_1.z.string(), language: rating, numeracy: rating, social: rating, motor: rating, creativity: rating, remarks: zod_1.z.string().optional() }).parse(req.body);
    await myStudent(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.status(201).json(await lib_1.prisma.progressReport.create({ data: { ...d, studentId: req.params.id, authorId: req.user.id } }));
}));
exports.teacherRouter.get('/students/:id/medical', (0, lib_1.wrap)(async (req, res) => {
    await myStudent(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.json(await lib_1.prisma.medicalRecord.findMany({ where: { studentId: req.params.id }, orderBy: { date: 'desc' } }));
}));
exports.teacherRouter.post('/students/:id/medical', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ type: zod_1.z.enum(['CHECKUP', 'VACCINATION', 'ILLNESS', 'ALLERGY', 'OTHER']), title: zod_1.z.string().min(2), notes: zod_1.z.string().optional(), date: zod_1.z.coerce.date() }).parse(req.body);
    await myStudent(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.status(201).json(await lib_1.prisma.medicalRecord.create({ data: { ...d, studentId: req.params.id, authorId: req.user.id } }));
}));
// ---- Photos & videos. studentIds => about those children (activity); none => whole batch ----
exports.teacherRouter.post('/batches/:id/media', upload.single('file'), (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const file = req.file;
    if (!file)
        throw new lib_1.HttpError(400, 'file is required');
    try {
        await myBatch(req.user.id, sid, req.params.id);
        const d = zod_1.z.object({
            caption: zod_1.z.string().optional(), activity: zod_1.z.string().optional(),
            studentIds: zod_1.z.string().optional().transform((s) => (s ? JSON.parse(s) : [])).pipe(zod_1.z.array(zod_1.z.string())),
        }).parse(req.body);
        let kids = await lib_1.prisma.student.findMany({
            where: {
                batchId: req.params.id, status: 'ACTIVE',
                ...(d.studentIds.length ? { id: { in: d.studentIds } } : { OR: [{ photoConsent: true }, { photoConsent: null }] }),
            },
            select: { id: true, parentId: true, photoConsent: true },
        });
        if (d.studentIds.length && kids.length !== d.studentIds.length) {
            const validStudents = await lib_1.prisma.student.count({
                where: { id: { in: d.studentIds }, batchId: req.params.id, status: 'ACTIVE' },
            });
            if (validStudents !== d.studentIds.length)
                throw new lib_1.HttpError(400, 'Some students are not in this batch');
            throw new lib_1.HttpError(403, 'Photo and video sharing requires parent consent');
        }
        if (!kids.length)
            throw new lib_1.HttpError(400, 'No students in this batch have photo-sharing consent');
        if (kids.some((kid) => kid.photoConsent === false))
            throw new lib_1.HttpError(403, 'Photo and video sharing requires parent consent');
        const media = await lib_1.prisma.media.create({
            data: {
                schoolId: sid, batchId: req.params.id, uploaderId: req.user.id, mime: file.mimetype, fileName: file.filename,
                type: file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE', caption: d.caption, activity: d.activity,
                tags: { create: kids.map((k) => ({ studentId: k.id })) },
            },
        });
        const what = media.type === 'VIDEO' ? 'video' : 'photo';
        const title = d.activity ? `New ${what}: ${d.activity}` : `New class ${what}`;
        const targets = kids.map((k) => k.parentId);
        await (0, notify_1.notifyUsers)(targets, 'MEDIA', title, d.caption ?? 'Open the app to view.');
        res.status(201).json(media);
    }
    catch (e) {
        fs_1.default.unlink(file.path, () => { });
        throw e;
    }
}));
exports.teacherRouter.get('/batches/:id/media', (0, lib_1.wrap)(async (req, res) => {
    await myBatch(req.user.id, (0, lib_1.schoolId)(req), req.params.id);
    res.json(await lib_1.prisma.media.findMany({
        where: { batchId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100,
        include: { tags: { include: { student: { select: { name: true } } } } },
    }));
}));
// ---- Pick-up verification at handover ----
exports.teacherRouter.get('/pickups', (0, lib_1.wrap)(async (req, res) => {
    const day = startOfDay(new Date());
    res.json(await lib_1.prisma.pickupRequest.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req), status: 'APPROVED', date: { gte: day, lt: new Date(day.getTime() + 86400000) }, student: { status: 'ACTIVE', batch: { teacherId: req.user.id } } },
        select: {
            id: true, personName: true, personPhone: true, relation: true, type: true,
            authorizedPersonId: true, student: { select: { name: true } },
        }, // code and identity documents are never sent to teachers
    }));
}));
exports.teacherRouter.get('/pickups/:id/authorized-photo', (0, lib_1.wrap)(async (req, res) => {
    const day = startOfDay(new Date());
    const request = await lib_1.prisma.pickupRequest.findFirst({
        where: {
            id: req.params.id, schoolId: (0, lib_1.schoolId)(req), status: 'APPROVED',
            date: { gte: day, lt: new Date(day.getTime() + 86400000) },
            student: { status: 'ACTIVE', batch: { teacherId: req.user.id } },
        },
        select: { authorizedPerson: { select: { photoFileName: true, photoMime: true, active: true } } },
    });
    const person = request?.authorizedPerson;
    if (!person?.active || !person.photoFileName || !person.photoMime)
        throw new lib_1.HttpError(404, 'Registered pickup photo not available');
    const image = await (0, privateDocuments_1.readPrivateDocument)(exports.UPLOAD_DIR, person.photoFileName);
    res.type(person.photoMime).set('Cache-Control', 'private, no-store').send(image);
}));
exports.teacherRouter.post('/pickups/:id/complete', (0, lib_1.wrap)(async (req, res) => {
    const { code } = zod_1.z.object({ code: zod_1.z.string().length(4) }).parse(req.body);
    const pr = await lib_1.prisma.pickupRequest.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req), status: 'APPROVED', student: { status: 'ACTIVE', batch: { teacherId: req.user.id } } }, include: { student: true },
    });
    if (!pr)
        throw new lib_1.HttpError(404, 'Approved request not found');
    if (startOfDay(pr.date).getTime() !== startOfDay(new Date()).getTime())
        throw new lib_1.HttpError(400, 'Request is not valid today');
    if (!pr.code || !crypto_1.default.timingSafeEqual(Buffer.from(pr.code), Buffer.from(code)))
        throw new lib_1.HttpError(403, 'Incorrect code');
    await lib_1.prisma.pickupRequest.update({ where: { id: pr.id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: req.user.id } });
    await (0, notify_1.notifyUsers)([pr.parentId], 'PICKUP', 'Handover completed', `${pr.student.name} was handed over to ${pr.personName}.`);
    res.json({ ok: true });
}));
exports.teacherRouter.get('/events', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.event.findMany({ where: { schoolId: (0, lib_1.schoolId)(req), date: { gte: new Date() } }, orderBy: { date: 'asc' } }));
}));
// ---- Authenticated media download (teacher of batch, principal of school, parent of tagged/batch child) ----
exports.mediaRouter.get('/:id/file', lib_1.authenticate, (0, lib_1.wrap)(async (req, res) => {
    const u = req.user;
    const m = await lib_1.prisma.media.findUnique({ where: { id: req.params.id }, include: { tags: true, batch: true } });
    if (!m || m.schoolId !== u.schoolId)
        throw new lib_1.HttpError(404, 'Not found');
    let ok = u.role === 'PRINCIPAL' || (u.role === 'TEACHER' && m.batch.teacherId === u.id);
    if (u.role === 'PARENT') {
        const kids = await lib_1.prisma.student.findMany({ where: { parentId: u.id }, select: { id: true, batchId: true } });
        ok = m.tags.length ? m.tags.some((t) => kids.some((k) => k.id === t.studentId)) : kids.some((k) => k.batchId === m.batchId);
    }
    if (!ok)
        throw new lib_1.HttpError(404, 'Not found');
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path_1.default.join(exports.UPLOAD_DIR, m.fileName));
}));
