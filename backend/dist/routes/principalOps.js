"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
const lib_1 = require("../lib");
const jobs_1 = require("../services/jobs");
const notify_1 = require("../services/notify");
const privateDocuments_1 = require("../services/privateDocuments");
const principal_1 = require("./principal");
const date = zod_1.z.coerce.date();
// ---- Fee structures (per class) & collection ----
principal_1.principalRouter.get('/fee-structures', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.feeStructure.findMany({ where: { schoolId: (0, lib_1.schoolId)(req) }, include: { class: { select: { name: true } } }, orderBy: { classId: 'asc' } }));
}));
principal_1.principalRouter.post('/fee-structures', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        classId: zod_1.z.string(), name: zod_1.z.string().min(2), amount: zod_1.z.number().int().positive(),
        frequency: zod_1.z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']), dueDay: zod_1.z.number().int().min(1).max(28).optional(),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    await (0, principal_1.ownClass)(sid, d.classId);
    res.status(201).json(await lib_1.prisma.feeStructure.create({ data: { ...d, schoolId: sid } }));
}));
principal_1.principalRouter.patch('/fee-structures/:id', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        amount: zod_1.z.number().int().positive().optional(), dueDay: zod_1.z.number().int().min(1).max(28).optional(),
        name: zod_1.z.string().trim().min(2).max(80).optional(),
        frequency: zod_1.z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']).optional(),
    }).parse(req.body);
    const r = await lib_1.prisma.feeStructure.updateMany({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) }, data: d });
    if (!r.count)
        throw new lib_1.HttpError(404, 'Fee structure not found');
    res.json({ ok: true }); // existing invoices keep their original amount
}));
principal_1.principalRouter.delete('/fee-structures/:id', (0, lib_1.wrap)(async (req, res) => {
    const sid = (0, lib_1.schoolId)(req);
    const fs = await lib_1.prisma.feeStructure.findFirst({ where: { id: req.params.id, schoolId: sid } });
    if (!fs)
        throw new lib_1.HttpError(404, 'Fee structure not found');
    if (await lib_1.prisma.feeInvoice.count({ where: { feeStructureId: fs.id } }))
        throw new lib_1.HttpError(409, 'Invoices exist for this fee; edit the amount instead');
    await lib_1.prisma.feeStructure.delete({ where: { id: fs.id } });
    res.json({ ok: true });
}));
principal_1.principalRouter.post('/invoices/generate', (0, lib_1.wrap)(async (req, res) => {
    res.json({ created: await (0, jobs_1.generateInvoices)((0, lib_1.schoolId)(req)) });
}));
const invoiceInclude = {
    student: { select: { id: true, name: true, admissionNo: true, batch: { select: { name: true, class: { select: { name: true } } } } } },
    feeStructure: { select: { name: true } }, payments: { orderBy: { paidAt: 'desc' } },
};
principal_1.principalRouter.post('/invoices', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        studentId: zod_1.z.string().min(1), feeStructureId: zod_1.z.string().min(1),
        amount: zod_1.z.number().int().positive().max(2147483647),
        period: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Billing period must use YYYY-MM'),
        dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
            const parsed = new Date(value);
            return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        }, 'Enter a valid due date'),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const invoice = await lib_1.prisma.$transaction(async (tx) => {
        const student = await tx.student.findFirst({ where: { id: d.studentId, schoolId: sid, status: 'ACTIVE' }, select: { batch: { select: { classId: true } } } });
        if (!student)
            throw new lib_1.HttpError(404, 'Active student not found');
        const fee = await tx.feeStructure.findFirst({ where: { id: d.feeStructureId, schoolId: sid, classId: student.batch.classId } });
        if (!fee)
            throw new lib_1.HttpError(400, 'Choose a fee plan belonging to this student’s class');
        const existing = await tx.feeInvoice.findFirst({
            where: { studentId: d.studentId, feeStructureId: d.feeStructureId, ...(fee.frequency === 'ONE_TIME' ? {} : { period: d.period }) },
            select: { id: true },
        });
        if (existing)
            throw new lib_1.HttpError(409, 'An invoice already exists for this student, fee and billing period');
        return tx.feeInvoice.create({ data: { ...d, dueDate: new Date(`${d.dueDate}T00:00:00`) }, include: invoiceInclude });
    });
    res.status(201).json(invoice);
}));
principal_1.principalRouter.get('/invoices', (0, lib_1.wrap)(async (req, res) => {
    const status = zod_1.z.enum(['OPEN', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE']).optional().parse(req.query.status);
    const overdue = new Date();
    overdue.setHours(0, 0, 0, 0);
    res.json(await lib_1.prisma.feeInvoice.findMany({
        where: { student: { schoolId: (0, lib_1.schoolId)(req) }, ...(status === 'OVERDUE' ? { status: { not: 'PAID' }, dueDate: { lt: overdue } } : status === 'OPEN' ? { status: { not: 'PAID' } } : status ? { status } : {}) },
        include: invoiceInclude,
        orderBy: [{ dueDate: 'desc' }, { id: 'asc' }],
    }));
}));
principal_1.principalRouter.get('/invoices/:id', (0, lib_1.wrap)(async (req, res) => {
    const invoice = await lib_1.prisma.feeInvoice.findFirst({ where: { id: req.params.id, student: { schoolId: (0, lib_1.schoolId)(req) } }, include: invoiceInclude });
    if (!invoice)
        throw new lib_1.HttpError(404, 'Invoice not found');
    res.json(invoice);
}));
principal_1.principalRouter.post('/invoices/:id/payments', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ amount: zod_1.z.number().int().positive(), method: zod_1.z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: zod_1.z.string().optional() }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const inv = await lib_1.prisma.$transaction(async (tx) => {
        const i = await tx.feeInvoice.findFirst({ where: { id: req.params.id, student: { schoolId: sid } }, include: { student: true } });
        if (!i)
            throw new lib_1.HttpError(404, 'Invoice not found');
        if (d.amount > i.amount - i.paidAmount)
            throw new lib_1.HttpError(400, 'Amount exceeds balance');
        await tx.payment.create({ data: { invoiceId: i.id, ...d } });
        const paid = i.paidAmount + d.amount;
        await tx.feeInvoice.update({ where: { id: i.id }, data: { paidAmount: paid, status: paid >= i.amount ? 'PAID' : 'PARTIAL' } });
        return i;
    });
    await (0, notify_1.notifyUsers)([inv.student.parentId], 'FEE', 'Payment received', `₹${(d.amount / 100).toFixed(2)} received for ${inv.student.name}. Thank you!`);
    res.json({ ok: true });
}));
// ---- Events ----
principal_1.principalRouter.get('/events', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.event.findMany({ where: { schoolId: (0, lib_1.schoolId)(req) }, orderBy: { date: 'asc' }, include: { batch: { select: { name: true, class: { select: { name: true } } } } } }));
}));
principal_1.principalRouter.post('/events', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ title: zod_1.z.string().min(2), description: zod_1.z.string().optional(), date, batchId: zod_1.z.string().nullable().optional() }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    if (d.batchId)
        await (0, principal_1.ownBatch)(sid, d.batchId);
    const ev = await lib_1.prisma.event.create({ data: { ...d, schoolId: sid } });
    await (0, notify_1.notifyUsers)(await (0, notify_1.parentIdsFor)({ schoolId: sid, batchId: d.batchId }), 'EVENT', `New event: ${ev.title}`, `On ${ev.date.toDateString()}`);
    res.status(201).json(ev);
}));
principal_1.principalRouter.patch('/events/:id', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        title: zod_1.z.string().trim().min(2).max(120).optional(),
        description: zod_1.z.string().nullable().optional(),
        date: date.optional(),
        batchId: zod_1.z.string().nullable().optional(),
    }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const event = await lib_1.prisma.event.findFirst({ where: { id: req.params.id, schoolId: sid } });
    if (!event)
        throw new lib_1.HttpError(404, 'Event not found');
    if (d.batchId)
        await (0, principal_1.ownBatch)(sid, d.batchId);
    res.json(await lib_1.prisma.event.update({ where: { id: event.id }, data: { ...d, reminderSent: false } }));
}));
principal_1.principalRouter.delete('/events/:id', (0, lib_1.wrap)(async (req, res) => {
    const r = await lib_1.prisma.event.deleteMany({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) } });
    if (!r.count)
        throw new lib_1.HttpError(404, 'Event not found');
    res.json({ ok: true });
}));
// ---- Notifications: scheduled / recurring announcements and instant broadcasts ----
const audienceSchema = zod_1.z.object({
    audience: zod_1.z.enum(['SCHOOL', 'CLASS', 'BATCH']).default('SCHOOL'), classId: zod_1.z.string().nullable().optional(), batchId: zod_1.z.string().nullable().optional(),
});
async function checkAudience(sid, a) {
    if (a.audience === 'CLASS') {
        if (!a.classId)
            throw new lib_1.HttpError(400, 'classId required');
        await (0, principal_1.ownClass)(sid, a.classId);
    }
    if (a.audience === 'BATCH') {
        if (!a.batchId)
            throw new lib_1.HttpError(400, 'batchId required');
        await (0, principal_1.ownBatch)(sid, a.batchId);
    }
}
principal_1.principalRouter.get('/notifications', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.scheduledNotification.findMany({ where: { schoolId: (0, lib_1.schoolId)(req) }, orderBy: { createdAt: 'desc' } }));
}));
const scheduleFields = audienceSchema.extend({
    title: zod_1.z.string().trim().min(2).max(200), body: zod_1.z.string().trim().min(2).max(5000), kind: zod_1.z.enum(['ONCE', 'MONTHLY']),
    date: date.nullable().optional(), dayOfMonth: zod_1.z.number().int().min(1).max(31).nullable().optional(),
    sendHour: zod_1.z.number().int().min(0).max(23).default(9), active: zod_1.z.boolean().default(true),
});
const scheduleSchema = scheduleFields.refine((x) => x.kind === 'ONCE' ? !!x.date : !!x.dayOfMonth, { message: 'Choose a date for one-time notifications or a day for monthly notifications' });
function normalizeSchedule(d) {
    return { ...d, classId: d.audience === 'CLASS' ? d.classId : null, batchId: d.audience === 'BATCH' ? d.batchId : null, date: d.kind === 'ONCE' ? d.date : null, dayOfMonth: d.kind === 'MONTHLY' ? d.dayOfMonth : null };
}
principal_1.principalRouter.post('/notifications', (0, lib_1.wrap)(async (req, res) => {
    const d = scheduleSchema.parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    await checkAudience(sid, d);
    res.status(201).json(await lib_1.prisma.scheduledNotification.create({ data: { ...normalizeSchedule(d), schoolId: sid } }));
}));
principal_1.principalRouter.patch('/notifications/:id', (0, lib_1.wrap)(async (req, res) => {
    const patch = scheduleFields.extend({ audience: zod_1.z.enum(['SCHOOL', 'CLASS', 'BATCH']), sendHour: zod_1.z.number().int().min(0).max(23), active: zod_1.z.boolean() }).partial().strict()
        .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update').parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    const existing = await lib_1.prisma.scheduledNotification.findFirst({ where: { id: req.params.id, schoolId: sid } });
    if (!existing)
        throw new lib_1.HttpError(404, 'Schedule not found');
    // Changing the recurrence/target requires its matching field, not a stale hidden value.
    const merged = { ...existing, ...patch };
    if (patch.kind && patch.kind !== existing.kind) {
        if (patch.kind === 'ONCE' && patch.date === undefined)
            merged.date = null;
        if (patch.kind === 'MONTHLY' && patch.dayOfMonth === undefined)
            merged.dayOfMonth = null;
    }
    const d = scheduleSchema.parse(merged);
    await checkAudience(sid, d);
    res.json(await lib_1.prisma.scheduledNotification.update({ where: { id: existing.id }, data: normalizeSchedule(d) }));
}));
principal_1.principalRouter.delete('/notifications/:id', (0, lib_1.wrap)(async (req, res) => {
    const r = await lib_1.prisma.scheduledNotification.deleteMany({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) } });
    if (!r.count)
        throw new lib_1.HttpError(404, 'Not found');
    res.json({ ok: true });
}));
principal_1.principalRouter.post('/broadcast', (0, lib_1.wrap)(async (req, res) => {
    const d = audienceSchema.extend({ title: zod_1.z.string().min(2), body: zod_1.z.string().min(2) }).parse(req.body);
    const sid = (0, lib_1.schoolId)(req);
    await checkAudience(sid, d);
    const parents = await (0, notify_1.parentIdsFor)({ schoolId: sid, classId: d.audience === 'CLASS' ? d.classId : null, batchId: d.audience === 'BATCH' ? d.batchId : null });
    await (0, notify_1.notifyUsers)(parents, 'GENERAL', d.title, d.body);
    res.json({ recipients: new Set(parents).size });
}));
// ---- Principal-managed authorized pickup people and encrypted documents ----
principal_1.principalRouter.get('/authorized-pickups', (0, lib_1.wrap)(async (req, res) => {
    const rows = await lib_1.prisma.authorizedPickupPerson.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req) },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { student: { select: { id: true, name: true, status: true, batch: { select: { name: true, class: { select: { name: true } } } } } } },
    });
    res.json(rows.map(({ photoFileName, aadhaarFileName, photoMime: _photoMime, aadhaarMime: _aadhaarMime, ...person }) => ({
        ...person, hasPhoto: !!photoFileName, hasAadhaar: !!aadhaarFileName,
    })));
}));
principal_1.principalRouter.post('/authorized-pickups', principal_1.privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'aadhaar', maxCount: 1 }]), (0, lib_1.wrap)(async (req, res) => {
    const files = (req.files ?? {});
    const photo = files.photo?.[0];
    const aadhaar = files.aadhaar?.[0];
    const stored = [];
    try {
        const d = zod_1.z.object({
            studentId: zod_1.z.string().min(1),
            name: zod_1.z.string().trim().min(2).max(100),
            phone: zod_1.z.string().trim().min(8).max(20),
            relation: zod_1.z.string().trim().min(2).max(50),
        }).parse(req.body);
        if (!photo || !aadhaar)
            throw new lib_1.HttpError(400, 'A recent photo and Aadhaar card image are required');
        (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
        (0, privateDocuments_1.validateImageBytes)(aadhaar.mimetype, aadhaar.buffer);
        const sid = (0, lib_1.schoolId)(req);
        const student = await lib_1.prisma.student.findFirst({ where: { id: d.studentId, schoolId: sid, status: 'ACTIVE' } });
        if (!student)
            throw new lib_1.HttpError(404, 'Active student not found');
        if (await lib_1.prisma.authorizedPickupPerson.findFirst({ where: { studentId: student.id, phone: d.phone } })) {
            throw new lib_1.HttpError(409, 'This phone number is already registered for the student');
        }
        const photoFileName = `${crypto_1.default.randomBytes(16).toString('hex')}.enc`;
        const aadhaarFileName = `${crypto_1.default.randomBytes(16).toString('hex')}.enc`;
        stored.push(await (0, privateDocuments_1.storePrivateDocument)(principal_1.privateUploadDir, photoFileName, photo.buffer));
        stored.push(await (0, privateDocuments_1.storePrivateDocument)(principal_1.privateUploadDir, aadhaarFileName, aadhaar.buffer));
        const person = await lib_1.prisma.authorizedPickupPerson.create({
            data: {
                ...d, schoolId: sid, photoFileName, photoMime: photo.mimetype,
                aadhaarFileName, aadhaarMime: aadhaar.mimetype,
            },
            select: { id: true, studentId: true, name: true, phone: true, relation: true, active: true, createdAt: true },
        });
        res.status(201).json({ ...person, hasPhoto: true, hasAadhaar: true });
    }
    catch (error) {
        for (const file of stored)
            await (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, path_1.default.basename(file)).catch((cleanupError) => console.error('Unable to remove an unlinked authorized-person document', cleanupError));
        throw error;
    }
}));
principal_1.principalRouter.patch('/authorized-pickups/:id', principal_1.privateUpload.fields([{ name: 'photo', maxCount: 1 }, { name: 'aadhaar', maxCount: 1 }]), (0, lib_1.wrap)(async (req, res) => {
    const files = (req.files ?? {});
    const photo = files.photo?.[0];
    const aadhaar = files.aadhaar?.[0];
    const d = zod_1.z.object({
        name: zod_1.z.string().trim().min(2).max(100).optional(),
        phone: zod_1.z.string().trim().min(8).max(20).optional(),
        relation: zod_1.z.string().trim().min(2).max(50).optional(),
        active: zod_1.z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), zod_1.z.boolean()).optional(),
    }).parse(req.body);
    if (photo)
        (0, privateDocuments_1.validateImageBytes)(photo.mimetype, photo.buffer);
    if (aadhaar)
        (0, privateDocuments_1.validateImageBytes)(aadhaar.mimetype, aadhaar.buffer);
    const old = await lib_1.prisma.authorizedPickupPerson.findFirst({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) } });
    if (!old)
        throw new lib_1.HttpError(404, 'Authorized pickup person not found');
    if (d.phone && d.phone !== old.phone && await lib_1.prisma.authorizedPickupPerson.findFirst({ where: { studentId: old.studentId, phone: d.phone } })) {
        throw new lib_1.HttpError(409, 'This phone number is already registered for the student');
    }
    if (d.active && ((!old.photoFileName && !photo) || (!old.aadhaarFileName && !aadhaar))) {
        throw new lib_1.HttpError(400, 'Add both the photo and Aadhaar image before restoring access');
    }
    const replacementPhoto = photo ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    const replacementAadhaar = aadhaar ? `${crypto_1.default.randomBytes(16).toString('hex')}.enc` : undefined;
    const photoFileName = replacementPhoto ?? old.photoFileName;
    const aadhaarFileName = replacementAadhaar ?? old.aadhaarFileName;
    const stored = [];
    let updated = false;
    try {
        if (photo && replacementPhoto)
            stored.push(await (0, privateDocuments_1.storePrivateDocument)(principal_1.privateUploadDir, replacementPhoto, photo.buffer));
        if (aadhaar && replacementAadhaar)
            stored.push(await (0, privateDocuments_1.storePrivateDocument)(principal_1.privateUploadDir, replacementAadhaar, aadhaar.buffer));
        const person = await lib_1.prisma.authorizedPickupPerson.update({
            where: { id: old.id },
            data: { ...d, photoFileName, photoMime: photo?.mimetype ?? old.photoMime, aadhaarFileName, aadhaarMime: aadhaar?.mimetype ?? old.aadhaarMime },
            select: { id: true, studentId: true, name: true, phone: true, relation: true, active: true, createdAt: true },
        });
        updated = true;
        if (photo)
            await (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, old.photoFileName).catch((error) => console.error('Unable to remove replaced pickup photo', error));
        if (aadhaar)
            await (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, old.aadhaarFileName).catch((error) => console.error('Unable to remove replaced Aadhaar image', error));
        res.json({ ...person, hasPhoto: !!photoFileName, hasAadhaar: !!aadhaarFileName });
    }
    catch (error) {
        if (!updated) {
            for (const file of stored)
                await (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, path_1.default.basename(file)).catch((cleanupError) => console.error('Unable to remove an unlinked authorized-person document', cleanupError));
        }
        throw error;
    }
}));
principal_1.principalRouter.delete('/authorized-pickups/:id', (0, lib_1.wrap)(async (req, res) => {
    const person = await lib_1.prisma.authorizedPickupPerson.findFirst({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) } });
    if (!person)
        throw new lib_1.HttpError(404, 'Authorized pickup person not found');
    const parentIds = await lib_1.prisma.$transaction(async (tx) => {
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
        (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, person.photoFileName),
        (0, privateDocuments_1.removePrivateDocument)(principal_1.privateUploadDir, person.aadhaarFileName),
    ]);
    if (parentIds.length)
        await (0, notify_1.notifyUsers)(parentIds, 'PICKUP', 'Authorized pickup access revoked', `${person.name} is no longer authorized to pick up or drop off the student. Related open requests were cancelled.`);
    res.json({ ok: true });
}));
principal_1.principalRouter.get('/authorized-pickups/:id/documents/:kind', (0, lib_1.wrap)(async (req, res) => {
    const kind = zod_1.z.enum(['photo', 'aadhaar']).parse(req.params.kind);
    const person = await lib_1.prisma.authorizedPickupPerson.findFirst({
        where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) },
        select: { photoFileName: true, photoMime: true, aadhaarFileName: true, aadhaarMime: true },
    });
    if (!person)
        throw new lib_1.HttpError(404, 'Authorized pickup person not found');
    const fileName = kind === 'photo' ? person.photoFileName : person.aadhaarFileName;
    const mime = kind === 'photo' ? person.photoMime : person.aadhaarMime;
    if (!fileName || !mime)
        throw new lib_1.HttpError(404, 'Document not found');
    const image = await (0, privateDocuments_1.readPrivateDocument)(principal_1.privateUploadDir, fileName);
    res.type(mime).set('Cache-Control', 'private, no-store').send(image);
}));
// ---- Pick-up / drop requests ----
principal_1.principalRouter.get('/pickup-requests', (0, lib_1.wrap)(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(await lib_1.prisma.pickupRequest.findMany({
        where: { schoolId: (0, lib_1.schoolId)(req), ...(status ? { status } : {}) }, orderBy: { date: 'desc' },
        include: { student: { select: { name: true, batch: { select: { name: true, class: { select: { name: true } } } } } } },
    }));
}));
principal_1.principalRouter.post('/pickup-requests/:id/decide', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({ approve: zod_1.z.boolean(), note: zod_1.z.string().trim().max(500).optional() }).parse(req.body);
    const pr = await lib_1.prisma.pickupRequest.findFirst({ where: { id: req.params.id, schoolId: (0, lib_1.schoolId)(req) }, include: { student: true } });
    if (!pr)
        throw new lib_1.HttpError(404, 'Request not found');
    if (pr.status !== 'PENDING')
        throw new lib_1.HttpError(409, `Already ${pr.status.toLowerCase()}`);
    if (d.approve && pr.student.status !== 'ACTIVE')
        throw new lib_1.HttpError(409, 'Student is no longer active');
    if (d.approve && pr.authorizedPersonId) {
        const person = await lib_1.prisma.authorizedPickupPerson.findFirst({
            where: { id: pr.authorizedPersonId, schoolId: (0, lib_1.schoolId)(req), studentId: pr.studentId, active: true },
        });
        if (!person)
            throw new lib_1.HttpError(409, 'Registered pickup access has been revoked');
    }
    const code = d.approve ? String(crypto_1.default.randomInt(1000, 10000)) : null;
    const updated = await lib_1.prisma.pickupRequest.updateMany({
        where: { id: pr.id, schoolId: (0, lib_1.schoolId)(req), status: 'PENDING' }, data: { status: d.approve ? 'APPROVED' : 'REJECTED', code, decisionNote: d.note, decidedAt: new Date() },
    });
    if (!updated.count)
        throw new lib_1.HttpError(409, 'This request has already been decided. Refresh to see its current status.');
    await (0, notify_1.notifyUsers)([pr.parentId], 'PICKUP', d.approve ? 'Pick-up request approved' : 'Pick-up request rejected', d.approve
        ? `${pr.personName} may ${pr.type.toLowerCase()} ${pr.student.name} on ${pr.date.toDateString()}. Share this code with them: ${code}`
        : `Request for ${pr.personName} on ${pr.date.toDateString()} was rejected.${d.note ? ' ' + d.note : ''}`);
    res.json({ ok: true });
}));
