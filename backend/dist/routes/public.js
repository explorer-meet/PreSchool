"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = exports.publicRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const mail_1 = require("../services/mail");
const lib_1 = require("../lib");
exports.publicRouter = (0, express_1.Router)();
exports.adminRouter = (0, express_1.Router)();
exports.publicRouter.post('/auth/login', (0, lib_1.wrap)(async (req, res) => {
    const { identifier, password } = zod_1.z.object({ identifier: zod_1.z.string(), password: zod_1.z.string() }).parse(req.body);
    const user = await lib_1.prisma.user.findFirst({
        where: { OR: [{ email: identifier.toLowerCase() }, { phone: identifier }] },
        include: { school: true },
    });
    if (!user || !user.active || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
        throw new lib_1.HttpError(401, 'Invalid credentials');
    }
    if (user.school && user.school.status !== 'APPROVED')
        throw new lib_1.HttpError(403, 'School is not active');
    const token = (0, lib_1.signToken)({ id: user.id, role: user.role, schoolId: user.schoolId });
    res.json({
        token,
        mustChangePassword: user.mustChangePassword,
        user: { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId },
    });
}));
// Password reset by emailed 6-digit code. The response never reveals whether the email exists.
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;
exports.publicRouter.post('/auth/forgot-password', (0, lib_1.wrap)(async (req, res) => {
    const { email } = zod_1.z.object({ email: zod_1.z.string().email().transform((s) => s.toLowerCase()) }).parse(req.body);
    const user = await lib_1.prisma.user.findUnique({ where: { email }, include: { school: true } });
    if (user && user.active && (!user.school || user.school.status === 'APPROVED')) {
        const recent = await lib_1.prisma.passwordReset.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
        if (!recent) {
            const code = String(crypto_1.default.randomInt(0, 1_000_000)).padStart(6, '0');
            await lib_1.prisma.passwordReset.create({ data: { userId: user.id, codeHash: await (0, lib_1.hash)(code), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
            await (0, mail_1.sendResetCode)({ to: email, name: user.name, code });
        }
    }
    res.json({ ok: true, message: 'If this email is registered, a reset code is on its way.' });
}));
exports.publicRouter.post('/auth/reset-password', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        email: zod_1.z.string().email().transform((s) => s.toLowerCase()),
        code: zod_1.z.string().regex(/^\d{6}$/),
        newPassword: zod_1.z.string().min(8),
    }).parse(req.body);
    const invalid = new lib_1.HttpError(400, 'Invalid or expired code');
    const user = await lib_1.prisma.user.findUnique({ where: { email: d.email } });
    if (!user)
        throw invalid;
    const reset = await lib_1.prisma.passwordReset.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!reset || reset.expiresAt < new Date() || reset.attempts >= MAX_RESET_ATTEMPTS)
        throw invalid;
    if (!(await bcryptjs_1.default.compare(d.code, reset.codeHash))) {
        await lib_1.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
        throw invalid;
    }
    await lib_1.prisma.$transaction([
        lib_1.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
        lib_1.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await (0, lib_1.hash)(d.newPassword), mustChangePassword: false } }),
    ]);
    res.json({ ok: true });
}));
exports.publicRouter.post('/auth/change-password', lib_1.authenticate, (0, lib_1.wrap)(async (req, res) => {
    const { newPassword } = zod_1.z.object({ newPassword: zod_1.z.string().min(8) }).parse(req.body);
    await lib_1.prisma.user.update({
        where: { id: req.user.id },
        data: { passwordHash: await (0, lib_1.hash)(newPassword), mustChangePassword: false },
    });
    res.json({ ok: true });
}));
exports.publicRouter.post('/auth/device-token', lib_1.authenticate, (0, lib_1.wrap)(async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(10) }).parse(req.body);
    await lib_1.prisma.deviceToken.upsert({
        where: { token }, update: { userId: req.user.id }, create: { token, userId: req.user.id },
    });
    res.json({ ok: true });
}));
// School self-registration. Nothing is usable until the super admin approves.
exports.publicRouter.post('/schools/register', (0, lib_1.wrap)(async (req, res) => {
    const d = zod_1.z.object({
        name: zod_1.z.string().min(2), address: zod_1.z.string(), city: zod_1.z.string(), phone: zod_1.z.string().min(8),
        email: zod_1.z.string().email().transform((s) => s.toLowerCase()),
        registrationNo: zod_1.z.string().optional(), principalName: zod_1.z.string().min(2),
    }).parse(req.body);
    const clash = await lib_1.prisma.user.findUnique({ where: { email: d.email } });
    if (clash)
        throw new lib_1.HttpError(409, 'Email already in use');
    const school = await lib_1.prisma.school.create({ data: d });
    res.status(201).json({ id: school.id, status: school.status, message: 'Submitted for verification' });
}));
// ---- Super admin ----
exports.adminRouter.use(lib_1.authenticate, (0, lib_1.requireRole)('SUPER_ADMIN'));
exports.adminRouter.get('/schools', (0, lib_1.wrap)(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(await lib_1.prisma.school.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' } }));
}));
const adminName = async (id) => (await lib_1.prisma.user.findUnique({ where: { id } }))?.name ?? 'Super Admin';
// Every status change is written to the log in the same transaction as the update.
async function changeStatus(schoolId, to, adminId, reason, allowed) {
    const school = await lib_1.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school)
        throw new lib_1.HttpError(404, 'School not found');
    if (school.status === to)
        throw new lib_1.HttpError(409, `Already ${to.toLowerCase()}`);
    if (allowed && !allowed.includes(school.status))
        throw new lib_1.HttpError(409, `Cannot change from ${school.status} to ${to}`);
    const name = await adminName(adminId);
    const now = new Date();
    await lib_1.prisma.$transaction([
        lib_1.prisma.school.update({
            where: { id: schoolId },
            data: {
                status: to, statusChangedAt: now,
                rejectReason: to === 'APPROVED' ? null : reason ?? null,
                ...(to === 'APPROVED' && !school.approvedAt ? { approvedAt: now } : {}),
            },
        }),
        lib_1.prisma.schoolStatusLog.create({
            data: { schoolId, fromStatus: school.status, toStatus: to, reason: reason ?? null, adminId, adminName: name, createdAt: now },
        }),
    ]);
    return school;
}
exports.adminRouter.post('/schools/:id/approve', (0, lib_1.wrap)(async (req, res) => {
    const { message } = zod_1.z.object({ message: zod_1.z.string().trim().min(1).max(1200).optional() }).parse(req.body ?? {});
    const school = await changeStatus(req.params.id, 'APPROVED', req.user.id, message);
    const existing = await lib_1.prisma.user.findFirst({ where: { schoolId: school.id, role: 'PRINCIPAL' } });
    // Reactivation: the principal already has an account, so no new credentials are issued.
    if (existing) {
        return res.json({ schoolId: school.id, principalId: existing.id, login: school.email, reactivated: true, emailSent: false });
    }
    const password = (0, lib_1.tempPassword)();
    const principal = await lib_1.prisma.user.create({
        data: {
            schoolId: school.id, role: 'PRINCIPAL', name: school.principalName, email: school.email,
            phone: school.phone, passwordHash: await (0, lib_1.hash)(password), designation: 'Principal',
        },
    });
    const emailSent = await (0, mail_1.sendCredentials)({ to: school.email, name: school.principalName, login: school.email, password, school: school.name, role: 'Principal', message });
    res.json({ schoolId: school.id, principalId: principal.id, login: school.email, emailSent, ...(emailSent ? {} : { temporaryPassword: password }) });
}));
exports.adminRouter.post('/schools/:id/reject', (0, lib_1.wrap)(async (req, res) => {
    const { reason } = zod_1.z.object({ reason: zod_1.z.string().trim().min(3).max(1200) }).parse(req.body);
    await changeStatus(req.params.id, 'REJECTED', req.user.id, reason);
    res.json({ ok: true });
}));
exports.adminRouter.post('/schools/:id/suspend', (0, lib_1.wrap)(async (req, res) => {
    const { reason } = zod_1.z.object({ reason: zod_1.z.string().trim().min(3).max(1200).optional() }).parse(req.body ?? {});
    await changeStatus(req.params.id, 'SUSPENDED', req.user.id, reason, ['APPROVED']);
    res.json({ ok: true });
}));
exports.adminRouter.get('/schools/:id/history', (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.schoolStatusLog.findMany({ where: { schoolId: req.params.id }, orderBy: { createdAt: 'desc' } }));
}));
exports.adminRouter.get('/status-log', (0, lib_1.wrap)(async (_req, res) => {
    res.json(await lib_1.prisma.schoolStatusLog.findMany({
        orderBy: { createdAt: 'desc' }, take: 200, include: { school: { select: { name: true } } },
    }));
}));
// ---- Notification inbox for any signed-in user ----
exports.publicRouter.get('/me/notifications', lib_1.authenticate, (0, lib_1.wrap)(async (req, res) => {
    res.json(await lib_1.prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 }));
}));
exports.publicRouter.post('/me/notifications/read-all', lib_1.authenticate, (0, lib_1.wrap)(async (req, res) => {
    await lib_1.prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
}));
