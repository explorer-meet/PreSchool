"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.periodOf = void 0;
exports.generateInvoices = generateInvoices;
exports.sendEventReminders = sendEventReminders;
exports.sendFeeReminders = sendFeeReminders;
exports.runScheduledNotifications = runScheduledNotifications;
exports.startJobs = startJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const lib_1 = require("../lib");
const mail_1 = require("./mail");
const notify_1 = require("./notify");
const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const periodOf = (d) => ymd(d).slice(0, 7);
exports.periodOf = periodOf;
// Creates invoices for the month for every active student whose class has a matching fee structure (idempotent).
async function generateInvoices(schoolId, month = new Date()) {
    const period = (0, exports.periodOf)(month);
    const structures = await lib_1.prisma.feeStructure.findMany({ where: { schoolId } });
    let created = 0;
    for (const fs of structures) {
        if (fs.frequency === 'QUARTERLY' && month.getMonth() % 3 !== 0)
            continue;
        if (fs.frequency === 'YEARLY' && month.getMonth() !== 0)
            continue;
        const students = await lib_1.prisma.student.findMany({ where: { status: 'ACTIVE', batch: { classId: fs.classId } } });
        for (const s of students) {
            if (fs.frequency === 'ONE_TIME' && (await lib_1.prisma.feeInvoice.findFirst({ where: { studentId: s.id, feeStructureId: fs.id } })))
                continue;
            const dueDate = new Date(month.getFullYear(), month.getMonth(), fs.dueDay);
            try {
                await lib_1.prisma.feeInvoice.create({ data: { studentId: s.id, feeStructureId: fs.id, period, amount: fs.amount, dueDate } });
                created++;
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
            }
        }
    }
    return created;
}
async function sendEventReminders() {
    const from = startOfDay(new Date(Date.now() + DAY));
    const events = await lib_1.prisma.event.findMany({ where: { reminderSent: false, date: { gte: from, lt: new Date(from.getTime() + DAY) } } });
    for (const e of events) {
        const parents = await (0, notify_1.parentIdsFor)({ schoolId: e.schoolId, batchId: e.batchId });
        await (0, notify_1.notifyUsers)(parents, 'EVENT', `Reminder: ${e.title}`, `Tomorrow: ${e.title}${e.description ? ' - ' + e.description : ''}`);
        await lib_1.prisma.event.update({ where: { id: e.id }, data: { reminderSent: true } });
    }
    return events.length;
}
// Reminds `feeReminderDays` before due date, then every 3 days while unpaid. Also emailed when the parent has an email.
async function sendFeeReminders() {
    const now = new Date();
    const schools = await lib_1.prisma.school.findMany({ where: { status: 'APPROVED' }, select: { id: true, name: true, feeReminderDays: true } });
    let sent = 0;
    for (const sc of schools) {
        const invoices = await lib_1.prisma.feeInvoice.findMany({
            where: { status: { not: 'PAID' }, student: { schoolId: sc.id }, dueDate: { lte: new Date(now.getTime() + sc.feeReminderDays * DAY) } },
            include: { student: { include: { parent: true } }, feeStructure: true },
        });
        for (const inv of invoices) {
            if (inv.lastReminderAt && now.getTime() - inv.lastReminderAt.getTime() < 3 * DAY)
                continue;
            const overdue = inv.dueDate < now;
            const title = overdue ? 'Fee overdue' : 'Fee due soon';
            const body = `${inv.feeStructure.name} fee of ₹${((inv.amount - inv.paidAmount) / 100).toFixed(2)} for ${inv.student.name} ${overdue ? 'was due on' : 'is due on'} ${inv.dueDate.toDateString()}.`;
            await (0, notify_1.notifyUsers)([inv.student.parentId], 'FEE', title, body);
            await (0, mail_1.sendMail)(inv.student.parent.email, `${title} - ${sc.name}`, `Dear ${inv.student.parent.name},\n\n${body}\n\nRegards,\n${sc.name}`);
            await lib_1.prisma.feeInvoice.update({ where: { id: inv.id }, data: { lastReminderAt: now } });
            sent++;
        }
    }
    return sent;
}
// Fires principal-scheduled announcements. Safe to call often: lastSentOn guards against repeats.
async function runScheduledNotifications(now = new Date()) {
    const today = ymd(now);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const items = await lib_1.prisma.scheduledNotification.findMany({ where: { active: true, school: { status: 'APPROVED' } } });
    let fired = 0;
    for (const n of items) {
        if (n.lastSentOn === today || now.getHours() < n.sendHour)
            continue;
        const due = n.kind === 'MONTHLY'
            ? now.getDate() === Math.min(n.dayOfMonth ?? 1, lastDay)
            : !!n.date && ymd(n.date) <= today; // ONCE: also catches up if the server was down on the day
        if (!due)
            continue;
        const parents = await (0, notify_1.parentIdsFor)({
            schoolId: n.schoolId, classId: n.audience === 'CLASS' ? n.classId : null, batchId: n.audience === 'BATCH' ? n.batchId : null,
        });
        await (0, notify_1.notifyUsers)(parents, 'GENERAL', n.title, n.body);
        await lib_1.prisma.scheduledNotification.update({
            where: { id: n.id }, data: { lastSentOn: today, ...(n.kind === 'ONCE' ? { active: false } : {}) },
        });
        fired++;
    }
    return fired;
}
function startJobs() {
    node_cron_1.default.schedule('0 1 1 * *', async () => {
        for (const s of await lib_1.prisma.school.findMany({ where: { status: 'APPROVED' } }))
            await generateInvoices(s.id);
    });
    node_cron_1.default.schedule('0 9 * * *', async () => { await sendEventReminders(); await sendFeeReminders(); });
    node_cron_1.default.schedule('*/15 * * * *', () => { runScheduledNotifications().catch((e) => console.error(e)); });
}
