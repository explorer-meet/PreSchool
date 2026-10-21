import { prisma } from '../lib';

export type NotifType = 'HOMEWORK' | 'EVENT' | 'FEE' | 'PICKUP' | 'ATTENDANCE' | 'MEDIA' | 'GENERAL';

async function sendExpoPush(tokens: string[], title: string, body: string) {
  if (!tokens.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
    });
  } catch (e) {
    console.warn('Push failed', (e as Error).message);
  }
}

// Stores an in-app notification and fires a push to all the users' devices.
export async function notifyUsers(userIds: string[], type: NotifType, title: string, body: string) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, type, title, body })) });
  const tokens = await prisma.deviceToken.findMany({ where: { userId: { in: ids } } });
  await sendExpoPush(tokens.map((t) => t.token), title, body);
}

type Scope = { schoolId?: string; classId?: string | null; batchId?: string | null };

export async function parentIdsFor(scope: Scope) {
  const s = await prisma.student.findMany({
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
