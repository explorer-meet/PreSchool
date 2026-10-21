// End-to-end check of the full flow against a running server: `npm run smoke`.
import assert from 'node:assert/strict';
import { prisma } from './lib';
import { runScheduledNotifications } from './services/jobs';

const B = process.env.API ?? 'http://localhost:4000/api';
async function call(method: string, path: string, body?: unknown, token?: string, expect = 200): Promise<any> {
  const isForm = body instanceof FormData;
  const r = await fetch(B + path, {
    method,
    headers: { ...(isForm || !body ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const j: any = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer();
  if (r.status >= 300 && expect < 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
  assert.equal(r.status < 300 ? 200 : r.status, expect < 300 ? 200 : expect, `${method} ${path} status ${r.status}`);
  return j;
}
const login = async (identifier: string, password: string) => (await call('POST', '/auth/login', { identifier, password })).token as string;

(async () => {
  const n = String(Date.now()).slice(-7);
  const email = `p${n}@sunshine.test`;
  const school = await call('POST', '/schools/register', { name: 'Sunshine', address: 'x', city: 'Pune', phone: '9100' + n, email, principalName: 'Priya' });
  const admin = await login(process.env.SUPER_ADMIN_EMAIL!, process.env.SUPER_ADMIN_PASSWORD!);
  const ap = await call('POST', `/admin/schools/${school.id}/approve`, {}, admin);
  const pr = await login(email, ap.temporaryPassword);

  const t = await call('POST', '/principal/staff', { name: 'Tina', role: 'TEACHER', phone: '9200' + n, email: `t${n}@sunshine.test` }, pr);
  const tc = await login(`t${n}@sunshine.test`, t.temporaryPassword);
  const jr = await call('POST', '/principal/classes', { name: 'Jr KG' }, pr);
  const morning = await call('POST', '/principal/batches', { classId: jr.id, name: 'Morning', startTime: '09:00', endTime: '12:00', academicYear: '2026-27', teacherId: t.id }, pr);
  await call('POST', '/principal/batches', { classId: jr.id, name: 'Noon', startTime: '13:00', endTime: '16:00', academicYear: '2026-27' }, pr);
  await call('POST', '/principal/fee-structures', { classId: jr.id, name: 'Tuition', amount: 300000, frequency: 'MONTHLY', dueDay: 5 }, pr);

  const pPhone = '9300' + n, pEmail = `par${n}@x.test`;
  const enr = await call('POST', '/principal/students', { name: 'Kid', dob: '2022-05-01', batchId: morning.id, parent: { name: 'Raj', phone: pPhone, email: pEmail } }, pr);
  assert.ok(enr.parentAccountCreated);
  const sib = await call('POST', '/principal/students', { name: 'Sib', dob: '2022-06-01', batchId: morning.id, parent: { name: 'Raj', phone: pPhone, email: pEmail } }, pr);
  assert.equal(sib.parentAccountCreated, false);
  const pl = await call('POST', '/auth/login', { identifier: pEmail, password: enr.temporaryPassword });
  assert.equal(pl.mustChangePassword, true);
  const par = pl.token as string;
  await call('POST', '/auth/change-password', { newPassword: 'NewPass@123' }, par);
  assert.equal((await call('POST', '/auth/login', { identifier: pEmail, password: 'NewPass@123' })).mustChangePassword, false);

  console.log('invoices', await call('POST', '/principal/invoices/generate', {}, pr));
  const kids = await call('GET', '/parent/children', undefined, par);
  const kid = kids.find((k: any) => k.name === 'Kid');

  // attendance
  const today = new Date().toISOString().slice(0, 10);
  await call('POST', `/teacher/batches/${morning.id}/attendance`, { date: today, records: [{ studentId: kid.id, status: 'LATE', lateMinutes: 15 }, { studentId: sib.student.id, status: 'ABSENT' }] }, tc);
  await call('POST', `/teacher/batches/${morning.id}/attendance`, { date: today, records: [{ studentId: kid.id, status: 'LATE' }] }, tc, 400);
  const ar = await call('GET', `/parent/children/${kid.id}/attendance-report`, undefined, par);
  assert.equal(ar.summary.late, 1); assert.equal(ar.summary.totalLateMinutes, 15);

  // classwork / homework / medical / report
  await call('POST', `/teacher/batches/${morning.id}/homework`, { kind: 'CLASSWORK', title: 'Colours', description: 'Red and blue' }, tc);
  await call('POST', `/teacher/batches/${morning.id}/homework`, { kind: 'HOMEWORK', title: 'Draw circle', description: 'Crayons' }, tc);
  await call('POST', `/teacher/students/${kid.id}/medical`, { type: 'VACCINATION', title: 'MMR', date: '2026-01-01' }, tc);
  await call('POST', `/teacher/students/${kid.id}/reports`, { term: 'T1', language: 3, numeracy: 4, remarks: 'good' }, tc);
  await call('POST', `/teacher/students/${kid.id}/reports`, { term: 'T2', language: 4, numeracy: 4 }, tc);
  const perf = await call('GET', `/parent/children/${kid.id}/performance`, undefined, par);
  assert.equal(perf.skills[0].change, 1);

  // media: one for the batch, one tagged to the kid only
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = (extra: Record<string, string>) => { const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'x.png'); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return f; };
  const m1 = await call('POST', `/teacher/batches/${morning.id}/media`, form({ caption: 'Sports day prep' }), tc);
  const m2 = await call('POST', `/teacher/batches/${morning.id}/media`, form({ activity: 'Painting', studentIds: JSON.stringify([kid.id]) }), tc);
  const sibPar = par; // same parent: both visible
  assert.equal((await call('GET', `/parent/children/${kid.id}/media`, undefined, sibPar)).length, 2);
  assert.equal((await call('GET', `/parent/children/${sib.student.id}/media`, undefined, sibPar)).length, 1);
  await call('GET', `/media/${m1.id}/file`, undefined, par);
  await call('GET', `/media/${m2.id}/file`, undefined, par);
  const bad = new FormData(); bad.append('file', new Blob(['x'], { type: 'text/html' }), 'x.html');
  await call('POST', `/teacher/batches/${morning.id}/media`, bad, tc, 415);
  // another school's parent cannot fetch it
  const n2 = n + '2';
  const s2 = await call('POST', '/schools/register', { name: 'Other', address: 'x', city: 'Pune', phone: '9400' + n2, email: `o${n2}@s.test`, principalName: 'Olive' });
  const a2 = await call('POST', `/admin/schools/${s2.id}/approve`, {}, admin);
  const pr2 = await login(`o${n2}@s.test`, a2.temporaryPassword);
  await call('GET', `/media/${m1.id}/file`, undefined, pr2, 404);

  const weekly = await call('GET', `/parent/children/${kid.id}/weekly-summary`, undefined, par);
  assert.equal(weekly.classwork.length, 1); assert.equal(weekly.homework.length, 1); assert.equal(weekly.mediaCount, 2);

  // pickup flow
  const rq = await call('POST', `/parent/children/${kid.id}/pickup-requests`, { personName: 'Uncle Sam', personPhone: '9999999999', relation: 'Uncle', type: 'PICKUP', date: today }, par);
  assert.equal((await call('GET', '/teacher/pickups', undefined, tc)).length, 0);
  await call('POST', `/principal/pickup-requests/${rq.id}/decide`, { approve: true }, pr);
  const pickups = await call('GET', '/teacher/pickups', undefined, tc);
  assert.equal(pickups.length, 1); assert.equal(pickups[0].code, undefined);
  await call('POST', `/teacher/pickups/${rq.id}/complete`, { code: '0000' }, tc, 403);
  const code = (await prisma.pickupRequest.findUniqueOrThrow({ where: { id: rq.id } })).code!;
  await call('POST', `/teacher/pickups/${rq.id}/complete`, { code }, tc);

  // scheduled notification (monthly on today's date, sent immediately by the job)
  await call('POST', '/principal/notifications', { title: 'Monthly meet', body: 'PTM today', kind: 'MONTHLY', dayOfMonth: new Date().getDate(), sendHour: 0 }, pr);
  assert.ok((await runScheduledNotifications()) >= 1);
  assert.equal(await runScheduledNotifications(), 0); // no double send

  const inv = await call('GET', `/parent/children/${kid.id}/invoices`, undefined, par);
  await call('POST', `/principal/invoices/${inv[0].id}/payments`, { amount: 100000, method: 'CASH' }, pr);
  const notes = await call('GET', '/me/notifications', undefined, par);
  console.log('dashboard', await call('GET', '/principal/dashboard', undefined, pr));
  console.log('parent notifications', notes.map((x: any) => x.type).join(','));
  await call('GET', '/principal/batches', undefined, tc, 403);
  console.log('ALL OK');
  await prisma.$disconnect();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

