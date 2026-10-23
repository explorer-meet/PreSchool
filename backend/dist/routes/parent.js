"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parentRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const lib_1 = require("../lib");
const notify_1 = require("../services/notify");
exports.parentRouter = (0, express_1.Router)();
exports.parentRouter.use(lib_1.authenticate, (0, lib_1.requireRole)('PARENT'));
async function myChild(userId, id) {
    const s = await lib_1.prisma.student.findFirst({
        where: { id, parentId: userId },
        select: {
            id: true, schoolId: true, batchId: true, name: true, dob: true, gender: true,
            admissionNo: true, admissionDate: true, status: true, bloodGroup: true, allergies: true,
            homeAddress: true, alternateParentPhone: true, transportMode: true, transportContact: true, photoConsent: true,
            batch: { select: { id: true, name: true, startTime: true, endTime: true, class: { select: { name: true } }, teacher: { select: { name: true } } } },
        },
    });
    if (!s)
        throw new lib_1.HttpError(404, 'Child not found');
    return s;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY = 86400000;
const SKILLS = ['language', 'numeracy', 'social', 'motor', 'creativity'];
function summarize(rows) {
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
exports.parentRouter.get('/children', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.student.findMany({
        where: { parentId: req.user.id, status: 'ACTIVE' },
        select: {
            id: true, schoolId: true, batchId: true, name: true, dob: true, gender: true,
            admissionNo: true, admissionDate: true, status: true, bloodGroup: true, allergies: true,
            homeAddress: true, alternateParentPhone: true, transportMode: true, transportContact: true, photoConsent: true,
            batch: { select: { name: true, class: { select: { name: true } }, teacher: { select: { name: true } } } },
        },
    }));
}));
exports.parentRouter.get('/children/:id', (0, lib_1.wrap)(async (req, res) => res.json(await myChild(req.user.id, req.params.id))));
exports.parentRouter.get('/children/:id/medical', (0, lib_1.wrap)(async (req, res) => {
    await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.medicalRecord.findMany({ where: { studentId: req.params.id }, orderBy: { date: 'desc' } }));
}));
exports.parentRouter.get('/children/:id/reports', (0, lib_1.wrap)(async (req, res) => {
    await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.progressReport.findMany({ where: { studentId: req.params.id }, orderBy: { createdAt: 'desc' } }));
}));
// Skill averages, latest scores and change vs the previous report.
exports.parentRouter.get('/children/:id/performance', (0, lib_1.wrap)(async (req, res) => {
    await myChild(req.user.id, req.params.id);
    const reports = await lib_1.prisma.progressReport.findMany({ where: { studentId: req.params.id }, orderBy: { createdAt: 'asc' } });
    const latest = reports[reports.length - 1], prev = reports[reports.length - 2];
    const skills = SKILLS.map((k) => {
        const vals = reports.map((r) => r[k]).filter((v) => v != null);
        return {
            skill: k, latest: latest?.[k] ?? null,
            average: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null,
            change: latest?.[k] != null && prev?.[k] != null ? latest[k] - prev[k] : null,
        };
    });
    res.json({ reportCount: reports.length, skills, trend: reports.map((r) => ({ term: r.term, date: r.createdAt, ...Object.fromEntries(SKILLS.map((k) => [k, r[k]])) })), latestRemarks: latest?.remarks ?? null });
}));
// Month attendance with totals; ?month=YYYY-MM (default current)
exports.parentRouter.get('/children/:id/attendance-report', (0, lib_1.wrap)(async (req, res) => {
    await myChild(req.user.id, req.params.id);
    const m = zod_1.z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)).parse(req.query.month);
    const [y, mo] = m.split('-').map(Number);
    const rows = await lib_1.prisma.attendance.findMany({
        where: { studentId: req.params.id, date: { gte: new Date(y, mo - 1, 1), lt: new Date(y, mo, 1) } }, orderBy: { date: 'asc' },
    });
    res.json({ month: m, summary: summarize(rows), days: rows });
}));
// Mon-Sun overview; ?weekStart=YYYY-MM-DD (default: this week's Monday)
exports.parentRouter.get('/children/:id/weekly-summary', (0, lib_1.wrap)(async (req, res) => {
    const child = await myChild(req.user.id, req.params.id);
    const base = zod_1.z.coerce.date().default(new Date()).parse(req.query.weekStart);
    const from = startOfDay(base);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    const to = new Date(from.getTime() + 7 * DAY);
    const [attendance, work, media, report, due] = await Promise.all([
        lib_1.prisma.attendance.findMany({ where: { studentId: child.id, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } }),
        lib_1.prisma.homework.findMany({ where: { batchId: child.batchId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } }),
        lib_1.prisma.media.findMany({
            where: { createdAt: { gte: from, lt: to }, OR: [{ tags: { some: { studentId: child.id } } }, { batchId: child.batchId, tags: { none: {} } }] },
            select: { id: true, type: true, activity: true, caption: true, createdAt: true },
        }),
        lib_1.prisma.progressReport.findFirst({ where: { studentId: child.id }, orderBy: { createdAt: 'desc' } }),
        lib_1.prisma.feeInvoice.findMany({ where: { studentId: child.id, status: { not: 'PAID' } }, include: { feeStructure: { select: { name: true } } } }),
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
exports.parentRouter.get('/children/:id/homework', (0, lib_1.wrap)(async (req, res) => {
    const c = await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.homework.findMany({ where: { batchId: c.batchId }, orderBy: { createdAt: 'desc' }, take: 60 }));
}));
exports.parentRouter.get('/children/:id/media', (0, lib_1.wrap)(async (req, res) => {
    const c = await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.media.findMany({
        where: { OR: [{ tags: { some: { studentId: c.id } } }, { batchId: c.batchId, tags: { none: {} } }] },
        orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, caption: true, activity: true, createdAt: true },
    }));
}));
exports.parentRouter.get('/children/:id/invoices', (0, lib_1.wrap)(async (req, res) => {
    await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.feeInvoice.findMany({ where: { studentId: req.params.id }, include: { feeStructure: { select: { name: true } }, payments: true }, orderBy: { dueDate: 'desc' } }));
}));
exports.parentRouter.get('/events', (0, lib_1.wrap)(async (req, res) => {
    const kids = await lib_1.prisma.student.findMany({ where: { parentId: req.user.id }, select: { schoolId: true, batchId: true } });
    res.json(await lib_1.prisma.event.findMany({
        where: { date: { gte: startOfDay(new Date()) }, OR: [{ schoolId: { in: kids.map((k) => k.schoolId) }, batchId: null }, { batchId: { in: kids.map((k) => k.batchId) } }] },
        orderBy: { date: 'asc' },
    }));
}));
// ---- Pick-up / drop by another person: needs principal approval ----
exports.parentRouter.get('/children/:id/authorized-pickups', (0, lib_1.wrap)(async (req, res) => {
    const child = await myChild(req.user.id, req.params.id);
    res.json(await lib_1.prisma.authorizedPickupPerson.findMany({
        where: { studentId: child.id, schoolId: child.schoolId, active: true },
        select: { id: true, name: true, relation: true },
        orderBy: { name: 'asc' },
    }));
}));
exports.parentRouter.post('/children/:id/pickup-requests', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        authorizedPersonId: zod_1.z.string().optional(),
        personName: zod_1.z.string().min(2).optional(), personPhone: zod_1.z.string().min(8).optional(), relation: zod_1.z.string().min(2).optional(),
        type: zod_1.z.enum(['PICKUP', 'DROP', 'BOTH']), date: zod_1.z.coerce.date(), reason: zod_1.z.string().optional(),
    }).parse(req.body);
    const c = await myChild(req.user.id, req.params.id);
    if (startOfDay(d.date) < startOfDay(new Date()))
        throw new lib_1.HttpError(400, 'Date cannot be in the past');
    let person = null;
    if (d.authorizedPersonId) {
        person = await lib_1.prisma.authorizedPickupPerson.findFirst({
            where: { id: d.authorizedPersonId, studentId: c.id, schoolId: c.schoolId, active: true },
            select: { id: true, name: true, phone: true, relation: true },
        });
        if (!person)
            throw new lib_1.HttpError(404, 'Authorized pickup person not found');
    }
    if (!person && (!d.personName || !d.personPhone || !d.relation)) {
        throw new lib_1.HttpError(400, 'Choose a registered person or provide their name, phone, and relation');
    }
    const pr = await lib_1.prisma.pickupRequest.create({
        data: {
            type: d.type, date: startOfDay(d.date), reason: d.reason,
            personName: person?.name ?? d.personName, personPhone: person?.phone ?? d.personPhone,
            relation: person?.relation ?? d.relation, authorizedPersonId: person?.id,
            schoolId: c.schoolId, studentId: c.id, parentId: req.user.id,
        },
    });
    const principals = await lib_1.prisma.user.findMany({ where: { schoolId: c.schoolId, role: 'PRINCIPAL' }, select: { id: true } });
    await (0, notify_1.notifyUsers)(principals.map((p) => p.id), 'PICKUP', 'New pick-up request', `${pr.personName} (${pr.relation}) for ${c.name} on ${pr.date.toDateString()}`);
    res.status(201).json(pr);
}));
exports.parentRouter.get('/pickup-requests', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.pickupRequest.findMany({
        where: { parentId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { student: { select: { name: true } } },
    }));
}));
exports.parentRouter.post('/pickup-requests/:id/cancel', (0, lib_1.wrap)(async (req, res) => {
    const r = await lib_1.prisma.pickupRequest.updateMany({ where: { id: req.params.id, parentId: req.user.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    if (!r.count)
        throw new lib_1.HttpError(404, 'Request not found or already closed');
    res.json({ ok: true });
}));
