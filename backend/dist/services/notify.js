"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUsers = notifyUsers;
exports.parentIdsFor = parentIdsFor;
const lib_1 = require("../lib");
async function sendExpoPush(tokens, title, body) {
    if (!tokens.length)
        return;
    try {
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
        });
    }
    catch (e) {
        console.warn('Push failed', e.message);
    }
}
// Stores an in-app notification and fires a push to all the users' devices.
async function notifyUsers(userIds, type, title, body) {
    const ids = [...new Set(userIds)];
    if (!ids.length)
        return;
    await lib_1.prisma.notification.createMany({ data: ids.map((userId) => ({ userId, type, title, body })) });
    const tokens = await lib_1.prisma.deviceToken.findMany({ where: { userId: { in: ids } } });
    await sendExpoPush(tokens.map((t) => t.token), title, body);
}
async function parentIdsFor(scope) {
    const s = await lib_1.prisma.student.findMany({
        where: {
            status: 'ACTIVE',
            ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
            ...(scope.batchId ? { batchId: scope.batchId } : {}),
            ...(scope.classId ? { batch: { classId: scope.classId } } : {}),
        },
        select: { parentId: true },
    });
    return s.map((x) => x.parentId);
}
