"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.privateUploadDir = exports.privateUpload = exports.principalRouter = void 0;
exports.ownBatch = ownBatch;
exports.ownClass = ownClass;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
const lib_1 = require("../lib");
const mail_1 = require("../services/mail");
const privateDocuments_1 = require("../services/privateDocuments");
exports.principalRouter = (0, express_1.Router)();
exports.principalRouter.use(lib_1.authenticate, (0, lib_1.requireRole)('PRINCIPAL'));
const uploadDir = path_1.default.resolve(process.env.UPLOAD_DIR ?? 'uploads');
fs_1.default.mkdirSync(uploadDir, { recursive: true });
exports.privateUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 2 },
    fileFilter: (_req, file, done) => ((0, privateDocuments_1.validImageMime)(file.mimetype) ? done(null, true) : done(new lib_1.HttpError(415, 'Only JPEG, PNG, or WebP images are allowed'))),
});
exports.privateUploadDir = uploadDir;
async function ownBatch(sid, id) {
    const b = await lib_1.prisma.batch.findFirst({ where: { id, schoolId: sid } });
    if (!b)
        throw new lib_1.HttpError(404, 'Batch not found');
    return b;
}
async function ownClass(sid, id) {
    const c = await lib_1.prisma.schoolClass.findFirst({ where: { id, schoolId: sid } });
    if (!c)
        throw new lib_1.HttpError(404, 'Class not found');
    return c;
}
const STAFF_ROLES = ['TEACHER', 'HELPER', 'STAFF'];
// ---- Dashboard ----
exports.principalRouter.get('/dashboard', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(weekStart.getDate() + 7);
    const [students, staff, batches, pendingPickups, att, dues, school, mediaPosts, homeworkPosts, events] = await Promise.all([
        lib_1.prisma.student.count({ where: { schoolId: sid, status: 'ACTIVE' } }),
        lib_1.prisma.user.count({ where: { schoolId: sid, role: { in: STAFF_ROLES }, active: true } }),
        lib_1.prisma.batch.count({ where: { schoolId: sid } }),
        lib_1.prisma.pickupRequest.count({ where: { schoolId: sid, status: 'PENDING' } }),
        lib_1.prisma.attendance.groupBy({ by: ['status'], where: { date: today, student: { schoolId: sid, status: 'ACTIVE' } }, _count: true }),
        lib_1.prisma.feeInvoice.findMany({ where: { student: { schoolId: sid }, status: { not: 'PAID' } }, select: { amount: true, paidAmount: true, dueDate: true } }),
        lib_1.prisma.school.findUniqueOrThrow({ where: { id: sid }, select: { name: true } }),
        lib_1.prisma.media.count({ where: { schoolId: sid, createdAt: { gte: weekStart, lt: nextWeek } } }),
        lib_1.prisma.homework.count({ where: { batch: { schoolId: sid }, createdAt: { gte: weekStart, lt: nextWeek } } }),
        lib_1.prisma.event.count({ where: { schoolId: sid, date: { gte: weekStart, lt: nextWeek } } }),
    ]);
    res.json({
        schoolName: school.name, students, staff, batches, pendingPickups,
        updatesThisWeek: mediaPosts + homeworkPosts + events,
        attendanceToday: Object.fromEntries(att.map((a) => [a.status, a._count])),
        feesOutstanding: dues.reduce((t, i) => t + i.amount - i.paidAmount, 0),
        feesOverdue: dues.filter((i) => i.dueDate < now).reduce((t, i) => t + i.amount - i.paidAmount, 0),
    });
}));
exports.principalRouter.get('/settings', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.school.findUnique({ where: { id: (0, lib_1.schoolId)(req) }, select: { name: true, feeReminderDays: true } }));
}));
exports.principalRouter.patch('/settings', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ feeReminderDays: zod_1.z.number().int().min(0).max(30) }).parse(req.body);
    res.json(await lib_1.prisma.school.update({ where: { id: (0, lib_1.schoolId)(req) }, data: d, select: { feeReminderDays: true } }));
}));
// ---- Classes (Jr KG, Sr KG...) ----
exports.principalRouter.get('/classes', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.schoolClass.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req) }, orderBy: { name: 'asc' },
        include: { _count: { select: { batches: true } }, feeStructures: true },
    }));
}));
exports.principalRouter.post('/classes', (0, lib_1.wrap)(async (req, res) => {
    const { name } = zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(60) }).parse(req.body);
    res.status(201).json(await lib_1.prisma.schoolClass.create({ data: { name: name.trim(), schoolId: (0, lib_1.schoolId)(req) } }));
}));
exports.principalRouter.patch('/classes/:id', (0, lib_1.wrap)(async (req, res) => {
    const { name } = zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(60) }).parse(req.body);
    await ownClass((0, lib_1.schoolId)(req), req.params.id);
    res.json(await lib_1.prisma.schoolClass.update({ where: { id: req.params.id }, data: { name: name.trim() } }));
}));
exports.principalRouter.delete('/classes/:id', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    await ownClass(sid, req.params.id);
    const [batches, fees] = await Promise.all([
        lib_1.prisma.batch.count({ where: { classId: req.params.id, schoolId: sid } }),
        lib_1.prisma.feeStructure.count({ where: { classId: req.params.id, schoolId: sid } }),
    ]);
    if (batches || fees)
        throw new lib_1.HttpError(409, 'Remove this class’s batches and fee plans before deleting it');
    await lib_1.prisma.schoolClass.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));
// ---- Batches (Morning / Noon shifts of a class) ----
exports.principalRouter.get('/batches', (0, lib_1.wrap)(async (req, res) => {
    const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
    res.json(await lib_1.prisma.batch.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req), ...(classId ? { classId } : {}) },
        orderBy: [{ classId: 'asc' }, { name: 'asc' }],
        include: { class: { select: { name: true } }, teacher: { select: { id: true, name: true } }, _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
    }));
}));
const time = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const batchSchema = zod_1.z.object({
    classId: zod_1.z.string(), name: zod_1.z.string().min(1), startTime: time.nullable().optional(), endTime: time.nullable().optional(),
    academicYear: zod_1.z.string(), capacity: zod_1.z.number().int().positive().optional(), teacherId: zod_1.z.string().nullable().optional(),
});
function checkBatchTimes(batch) {
    if (batch.startTime && batch.endTime && batch.startTime >= batch.endTime)
        throw new lib_1.HttpError(400, 'Batch end time must be after its start time');
}
async function checkTeacher(sid, teacherId) {
    if (!teacherId)
        return;
    if (!(await lib_1.prisma.user.findFirst({ where: { id: teacherId, schoolId: sid, role: 'TEACHER', active: true } })))
        throw new lib_1.HttpError(400, 'Invalid teacher');
}
exports.principalRouter.post('/batches', (0, lib_1.wrap)(async (req, res) => {
    const d = batchSchema.parse(req.body);
    checkBatchTimes(d);
    const sid = (0, lib_1.schoolId)(req);
    await ownClass(sid, d.classId);
    await checkTeacher(sid, d.teacherId);
    res.status(201).json(await lib_1.prisma.batch.create({ data: { ...d, schoolId: sid } }));
}));
exports.principalRouter.patch('/batches/:id', (0, lib_1.wrap)(async (req, res) => {
    const d = batchSchema.partial().parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const batch = await ownBatch(sid, req.params.id);
    checkBatchTimes({ ...batch, ...d });
    if (d.classId)
        await ownClass(sid, d.classId);
    await checkTeacher(sid, d.teacherId);
    if (d.capacity !== undefined && d.capacity < await lib_1.prisma.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) {
        throw new lib_1.HttpError(409, 'Capacity cannot be lower than the number of enrolled students');
    }
    res.json(await lib_1.prisma.batch.update({ where: { id: req.params.id }, data: d }));
}));
exports.principalRouter.delete('/batches/:id', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    await ownBatch(sid, req.params.id);
    if (await lib_1.prisma.student.count({ where: { batchId: req.params.id } }))
        throw new lib_1.HttpError(409, 'Move or mark students as left before deleting this batch');
    await lib_1.prisma.batch.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));
// ---- Teachers & staff ----
exports.principalRouter.get('/staff', (0, lib_1.wrap)(async (req, res) => {
    const staff = await lib_1.prisma.user.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req), role: { in: STAFF_ROLES } }, orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true, email: true, phone: true, designation: true, address: true, salary: true, active: true, mustChangePassword: true, photoFileName: true, batchesTaught: { select: { id: true, name: true, class: { select: { name: true } } } } },
    });
    res.json(staff.map(({ photoFileName, ...user }) => ({ ...user, hasPhoto: !!photoFileName })));
}));
exports.principalRouter.get('/staff/:id/photo', (0, lib_1.wrap)(async (req, res) => {
    const staff = await lib_1.prisma.user.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req), role: { in: STAFF_ROLES } },
        select: { photoFileName: true, photoMime: true },
    });
    if (!staff?.photoFileName)
        throw new lib_1.HttpError(404, 'Staff photo not found');
    await (0, privateDocuments_1.encryptLegacyDocument)(uploadDir, staff.photoFileName);
    const image = await (0, privateDocuments_1.readPrivateDocument)(uploadDir, staff.photoFileName);
    res.type(staff.photoMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));
exports.principalRouter.post('/staff', exports.privateUpload.single('photo'), (0, lib_1.wrap)(async (req, res) => {
    const photo = req.file;
    if (photo)
        (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
    const d = zod_1.z.object({
        name: zod_1.z.string().trim().min(2), role: zod_1.z.enum(['TEACHER', 'HELPER', 'STAFF']),
        email: zod_1.z.string().email().transform((s) => s.toLowerCase()), phone: zod_1.z.string().trim().min(8),
        designation: zod_1.z.string().optional(), address: zod_1.z.string().optional(),
        salary: zod_1.z.preprocess((value) => value === '' || value == null ? undefined : Number(value), zod_1.z.number().int().nonnegative().optional()),
        batchId: zod_1.z.string().optional(),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    if (d.batchId && d.role !== 'TEACHER')
        throw new lib_1.HttpError(400, 'Only teachers can be assigned to a batch');
    if (d.batchId)
        await ownBatch(sid, d.batchId);
    const password = (0, lib_1.tempPassword)();
    const { batchId, ...staff } = d;
    const photoFileName = photo ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    let photoPath;
    let staffCreated = false;
    try {
        if (photo && photoFileName)
            photoPath = await (0, privateDocuments_1.storePrivateDocument)(uploadDir, photoFileName, photo.buffer);
        const u = await lib_1.prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: { ...staff, schoolId: sid, passwordHash: await (0, lib_1.hash)(password), photoFileName, photoMime: photo?.mimetype },
            });
            if (batchId)
                await tx.batch.update({ where: { id: batchId }, data: { teacherId: created.id } });
            return created;
        });
        staffCreated = true;
        const school = await lib_1.prisma.school.findUniqueOrThrow({ where: { id: sid } });
        const emailSent = await (0, mail_1.sendCredentials)({ to: d.email, name: d.name, login: d.email, password, school: school.name, role: d.role });
        res.status(201).json({ id: u.id, name: u.name, role: u.role, login: d.email, emailSent, hasPhoto: !!photoFileName, ...(emailSent ? {} : { temporaryPassword: password }) });
    }
    catch (error) {
        if (!staffCreated && photoPath)
            await (0, privateDocuments_1.removePrivateDocument)(uploadDir, path_1.default.basename(photoPath)).catch((cleanupError) => console.error('Unable to remove an unlinked staff photo', cleanupError));
        throw error;
    }
}));
exports.principalRouter.patch('/staff/:id', exports.privateUpload.single('photo'), (0, lib_1.wrap)(async (req, res) => {
    const photo = req.file;
    if (photo)
        (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
    const d = zod_1.z.object({
        name: zod_1.z.string().trim().min(2).optional(), phone: zod_1.z.string().trim().min(8).optional(), designation: zod_1.z.string().optional(), address: zod_1.z.string().optional(),
        salary: zod_1.z.preprocess((value) => value === '' || value == null ? undefined : Number(value), zod_1.z.number().int().nonnegative().optional()),
        active: zod_1.z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), zod_1.z.boolean()).optional(),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const old = await lib_1.prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: { in: STAFF_ROLES } }, select: { photoFileName: true } });
    if (!old)
        throw new lib_1.HttpError(404, 'Staff not found');
    const photoFileName = photo ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    let photoPath;
    let updated = false;
    try {
        if (photo && photoFileName)
            photoPath = await (0, privateDocuments_1.storePrivateDocument)(uploadDir, photoFileName, photo.buffer);
        const updatedStaff = await lib_1.prisma.user.update({
            where: { id: req.params.id },
            data: { ...d, ...(photo ? { photoFileName, photoMime: photo.mimetype } : {}) },
        });
        updated = true;
        if (d.active === false)
            await lib_1.prisma.batch.updateMany({ where: { teacherId: req.params.id }, data: { teacherId: null } });
        if (photo && old.photoFileName)
            await (0, privateDocuments_1.removePrivateDocument)(uploadDir, old.photoFileName).catch((error) => console.error('Unable to remove replaced staff photo', error));
        res.json({ ok: true, hasPhoto: !!updatedStaff.photoFileName });
    }
    catch (error) {
        if (!updated && photoPath)
            await (0, privateDocuments_1.removePrivateDocument)(uploadDir, path_1.default.basename(photoPath)).catch((cleanupError) => console.error('Unable to remove an unlinked staff photo', cleanupError));
        throw error;
    }
}));
exports.principalRouter.delete('/staff/:id', (0, lib_1.wrap)(async (req, res) => {
    const staff = await lib_1.prisma.user.findFirst({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req), role: { in: STAFF_ROLES } } });
    if (!staff)
        throw new lib_1.HttpError(404, 'Staff not found');
    await lib_1.prisma.$transaction([
        lib_1.prisma.user.update({ where: { id: staff.id }, data: { active: false } }),
        lib_1.prisma.batch.updateMany({ where: { teacherId: staff.id }, data: { teacherId: null } }),
        lib_1.prisma.deviceToken.deleteMany({ where: { userId: staff.id } }),
    ]);
    res.json({ ok: true });
}));
exports.principalRouter.post('/staff/:id/reset-password', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const u = await lib_1.prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: { in: STAFF_ROLES } } });
    if (!u)
        throw new lib_1.HttpError(404, 'Staff not found');
    const password = (0, lib_1.tempPassword)();
    await lib_1.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await (0, lib_1.hash)(password), mustChangePassword: true } });
    const school = await lib_1.prisma.school.findUniqueOrThrow({ where: { id: sid } });
    const emailSent = await (0, mail_1.sendCredentials)({ to: u.email, name: u.name, login: u.email ?? u.phone ?? '', password, school: school.name, role: u.role });
    res.json({ emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));
// ---- Students ----
exports.principalRouter.get('/students', (0, lib_1.wrap)(async (req, res) => {
    const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
    const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
    const students = await lib_1.prisma.student.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req), status: 'ACTIVE', ...(batchId ? { batchId } : {}), ...(classId ? { batch: { classId } } : {}) },
        orderBy: { name: 'asc' },
        include: { batch: { select: { name: true, class: { select: { name: true } } } }, parent: { select: { name: true, phone: true, email: true } } },
    });
    res.json(students.map(({ identityDocumentFileName, photoFileName, identityDocumentMime: _identityMime, photoMime: _photoMime, ...student }) => ({
        ...student, hasIdentityDocument: !!identityDocumentFileName, hasPhoto: !!photoFileName,
    })));
}));
exports.principalRouter.get('/students/:id/identity-document', (0, lib_1.wrap)(async (req, res) => {
    const student = await lib_1.prisma.student.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) },
        select: { identityDocumentFileName: true, identityDocumentMime: true },
    });
    if (!student?.identityDocumentFileName)
        throw new lib_1.HttpError(404, 'Identity document not found');
    await (0, privateDocuments_1.encryptLegacyDocument)(uploadDir, student.identityDocumentFileName);
    const image = await (0, privateDocuments_1.readPrivateDocument)(uploadDir, student.identityDocumentFileName);
    res.type(student.identityDocumentMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));
exports.principalRouter.get('/students/:id/private-documents/:kind', (0, lib_1.wrap)(async (req, res) => {
    const kind = zod_1.z.enum(['photo', 'identity']).parse(req.params.kind);
    const student = await lib_1.prisma.student.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) },
        select: { photoFileName: true, photoMime: true, identityDocumentFileName: true, identityDocumentMime: true },
    });
    if (!student)
        throw new lib_1.HttpError(404, 'Student not found');
    const fileName = kind === 'photo' ? student.photoFileName : student.identityDocumentFileName;
    const mime = kind === 'photo' ? student.photoMime : student.identityDocumentMime;
    if (!fileName)
        throw new lib_1.HttpError(404, 'Document not found');
    await (0, privateDocuments_1.encryptLegacyDocument)(uploadDir, fileName);
    const image = await (0, privateDocuments_1.readPrivateDocument)(uploadDir, fileName);
    res.type(mime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));
exports.principalRouter.get('/students/:id/photo', (0, lib_1.wrap)(async (req, res) => {
    const student = await lib_1.prisma.student.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) },
        select: { photoFileName: true, photoMime: true },
    });
    if (!student?.photoFileName)
        throw new lib_1.HttpError(404, 'Student photo not found');
    await (0, privateDocuments_1.encryptLegacyDocument)(uploadDir, student.photoFileName);
    const image = await (0, privateDocuments_1.readPrivateDocument)(uploadDir, student.photoFileName);
    res.type(student.photoMime ?? 'application/octet-stream').set('Cache-Control', 'private, no-store').send(image);
}));
// Enrols a child into a batch. First enrolment for a parent creates their account and emails the credentials.
exports.principalRouter.post('/students', exports.privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'identityDocument', maxCount: 1 }]), (0, lib_1.wrap)(async (req, res) => {
    const files = (req.files ?? {});
    const photo = files.photo?.[0];
    const identityDocument = files.identityDocument?.[0];
    const storedFiles = [];
    let studentCreated = false;
    try {
        let parentInput = req.body.parent;
        if (typeof parentInput === 'string') {
            try {
                parentInput = JSON.parse(parentInput);
            }
            catch {
                throw new lib_1.HttpError(400, 'Invalid parent details');
            }
        }
        const d = zod_1.z.object({
            name: zod_1.z.string().trim().min(2), dob: zod_1.z.coerce.date().max(new Date(), 'Date of birth cannot be in the future'), gender: zod_1.z.string().optional(), batchId: zod_1.z.string(),
            bloodGroup: zod_1.z.string().optional(), allergies: zod_1.z.string().optional(), homeAddress: zod_1.z.string().optional(),
            alternateParentPhone: zod_1.z.string().optional(), transportMode: zod_1.z.enum(['SCHOOL_VAN', 'PERSONAL']).optional(),
            transportContact: zod_1.z.string().optional(),
            photoConsent: zod_1.z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), zod_1.z.boolean()).optional(),
            parent: zod_1.z.object({ name: zod_1.z.string().min(2), phone: zod_1.z.string().min(8), email: zod_1.z.string().email().transform((s) => s.toLowerCase()) }),
        }).parse({ ...req.body, parent: parentInput });
        if (photo)
            (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
        if (identityDocument)
            (0, privateDocuments_1.validateImageBytes)(identityDocument.mimetype, identityDocument.buffer);
        const sid = (0, lib_1.schoolId)(req);
        const batch = await ownBatch(sid, d.batchId);
        if ((await lib_1.prisma.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) >= batch.capacity)
            throw new lib_1.HttpError(409, 'Batch is full');
        const photoFileName = photo ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
        const identityDocumentFileName = identityDocument ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
        if (photo && photoFileName)
            storedFiles.push(await (0, privateDocuments_1.storePrivateDocument)(uploadDir, photoFileName, photo.buffer));
        if (identityDocument && identityDocumentFileName)
            storedFiles.push(await (0, privateDocuments_1.storePrivateDocument)(uploadDir, identityDocumentFileName, identityDocument.buffer));
        const generatedPassword = (0, lib_1.tempPassword)();
        const passwordHash = await (0, lib_1.hash)(generatedPassword);
        const { student, parent, password } = await lib_1.prisma.$transaction(async (tx) => {
            if ((await tx.student.count({ where: { batchId: batch.id, status: 'ACTIVE' } })) >= batch.capacity)
                throw new lib_1.HttpError(409, 'Batch is full');
            const matchingParents = await tx.user.findMany({ where: { OR: [{ phone: d.parent.phone }, { email: d.parent.email }] } });
            let parent = matchingParents[0];
            if (matchingParents.length > 1 || (parent && (parent.role !== 'PARENT' || parent.schoolId !== sid || !parent.active)))
                throw new lib_1.HttpError(409, 'Phone or email belongs to another account');
            if (parent && (parent.phone !== d.parent.phone || parent.email !== d.parent.email))
                throw new lib_1.HttpError(409, 'Use the existing parent account’s registered email and phone');
            const password = parent ? undefined : generatedPassword;
            if (!parent)
                parent = await tx.user.create({
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
            const school = await lib_1.prisma.school.findUniqueOrThrow({ where: { id: sid } });
            emailSent = await (0, mail_1.sendCredentials)({ to: parent.email, name: parent.name, login: parent.email, password, school: school.name, role: 'Parent' });
        }
        const { identityDocumentFileName: _documentFile, identityDocumentMime: _identityMime, photoFileName: _photoFile, photoMime: _photoMime, ...studentResponse } = student;
        res.status(201).json({
            student: { ...studentResponse, hasIdentityDocument: !!identityDocumentFileName, hasPhoto: !!photoFileName },
            parentAccountCreated: !!password, parentLogin: parent.email, emailSent,
            ...(password && !emailSent ? { temporaryPassword: password } : {}),
        });
    }
    catch (error) {
        if (!studentCreated) {
            for (const filePath of storedFiles) {
                try {
                    await fs_1.default.promises.unlink(filePath);
                }
                catch (cleanupError) {
                    console.error('Unable to remove an unlinked private document', cleanupError);
                }
            }
        }
        throw error;
    }
}));
exports.principalRouter.patch('/students/:id', exports.privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'identityDocument', maxCount: 1 }]), (0, lib_1.wrap)(async (req, res) => {
    const files = req.files;
    const photo = files?.photo?.[0];
    const identity = files?.identityDocument?.[0];
    if (photo)
        (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
    if (identity)
        (0, privateDocuments_1.validateImageBytes)(identity.mimetype, identity.buffer);
    const optionalText = zod_1.z.preprocess((value) => value === '' ? null : value, zod_1.z.string().nullable().optional());
    const d = zod_1.z.object({
        batchId: zod_1.z.string().optional(), status: zod_1.z.enum(['ACTIVE', 'LEFT']).optional(), name: zod_1.z.string().trim().min(2).optional(),
        dob: zod_1.z.coerce.date().max(new Date(), 'Date of birth cannot be in the future').optional(), gender: optionalText, bloodGroup: optionalText,
        allergies: optionalText, homeAddress: optionalText,
        alternateParentPhone: optionalText, transportMode: zod_1.z.preprocess((value) => value === '' ? null : value, zod_1.z.enum(['SCHOOL_VAN', 'PERSONAL']).nullable().optional()),
        transportContact: optionalText, photoConsent: zod_1.z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, zod_1.z.boolean().nullable().optional()),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    if (d.batchId)
        await ownBatch(sid, d.batchId);
    const student = await lib_1.prisma.student.findFirst({ where: { id: req.params.id, schoolId: sid } });
    if (!student)
        throw new lib_1.HttpError(404, 'Student not found');
    if ((d.status ?? student.status) === 'LEFT' && (photo || identity))
        throw new lib_1.HttpError(400, 'Cannot upload documents for a student marked as left');
    if (d.batchId && d.batchId !== student.batchId) {
        const targetBatch = await ownBatch(sid, d.batchId);
        if ((await lib_1.prisma.student.count({ where: { batchId: d.batchId, status: 'ACTIVE' } })) >= targetBatch.capacity && (d.status ?? student.status) === 'ACTIVE') {
            throw new lib_1.HttpError(409, 'The selected batch is full');
        }
    }
    const storedFiles = [];
    const photoFileName = photo ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    const identityDocumentFileName = identity ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    const pickupDocuments = [];
    try {
        if (photo && photoFileName)
            storedFiles.push(await (0, privateDocuments_1.storePrivateDocument)(uploadDir, photoFileName, photo.buffer));
        if (identity && identityDocumentFileName)
            storedFiles.push(await (0, privateDocuments_1.storePrivateDocument)(uploadDir, identityDocumentFileName, identity.buffer));
        await lib_1.prisma.$transaction(async (tx) => {
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
    }
    catch (error) {
        await Promise.all(storedFiles.map((filePath) => (0, privateDocuments_1.removePrivateDocument)(uploadDir, path_1.default.basename(filePath)).catch((cleanupError) => console.error('Unable to remove unlinked student document', cleanupError))));
        throw error;
    }
    if (d.status === 'LEFT' || photo || identity) {
        await Promise.all([
            d.status === 'LEFT' || photo ? (0, privateDocuments_1.removePrivateDocument)(uploadDir, student.photoFileName) : Promise.resolve(),
            d.status === 'LEFT' || identity ? (0, privateDocuments_1.removePrivateDocument)(uploadDir, student.identityDocumentFileName) : Promise.resolve(),
        ]);
    }
    await Promise.all(pickupDocuments.flatMap((docs) => [
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, docs.photoFileName),
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, docs.aadhaarFileName),
    ]));
    res.json({ ok: true });
}));
exports.principalRouter.delete('/students/:id', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const student = await lib_1.prisma.student.findFirst({ where: { id: req.params.id, schoolId: sid } });
    if (!student)
        throw new lib_1.HttpError(404, 'Student not found');
    const pickupDocuments = await lib_1.prisma.authorizedPickupPerson.findMany({
        where: { studentId: student.id }, select: { photoFileName: true, aadhaarFileName: true },
    });
    await lib_1.prisma.$transaction(async (tx) => {
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
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, student.photoFileName),
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, student.identityDocumentFileName),
    ]);
    await Promise.all(pickupDocuments.flatMap((docs) => [
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, docs.photoFileName),
        (0, privateDocuments_1.removePrivateDocument)(uploadDir, docs.aadhaarFileName),
    ]));
    res.json({ ok: true });
}));
exports.principalRouter.post('/parents/:id/reset-password', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const u = await lib_1.prisma.user.findFirst({ where: { id: req.params.id, schoolId: sid, role: 'PARENT' } });
    if (!u)
        throw new lib_1.HttpError(404, 'Parent not found');
    const password = (0, lib_1.tempPassword)();
    await lib_1.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await (0, lib_1.hash)(password), mustChangePassword: true } });
    const school = await lib_1.prisma.school.findUniqueOrThrow({ where: { id: sid } });
    const emailSent = await (0, mail_1.sendCredentials)({ to: u.email, name: u.name, login: u.email ?? '', password, school: school.name, role: 'Parent' });
    res.json({ emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));
