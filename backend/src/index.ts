import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, prisma, hash } from './lib';
import { publicRouter, adminRouter } from './routes/public';
import { principalRouter } from './routes/principal';
import './routes/principalOps';
import { teacherRouter, mediaRouter } from './routes/teacher';
import { parentRouter } from './routes/parent';
import { startJobs } from './services/jobs';

export const app = express();
app.use(helmet(), cors(), express.json({ limit: '1mb' }));
app.get('/health', (_q, r) => r.json({ ok: true }));
app.use('/api', publicRouter);
app.use('/api/admin', adminRouter);
app.use('/api/principal', principalRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/media', mediaRouter);
app.use('/api/parent', parentRouter);
app.use(errorHandler);

async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL, pw = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !pw) return;
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({ data: { role: 'SUPER_ADMIN', name: 'Super Admin', email, passwordHash: await hash(pw), mustChangePassword: false } });
  }
}

if (require.main === module) {
  ensureSuperAdmin().then(() => {
    startJobs();
    const port = Number(process.env.PORT ?? 4000);
    app.listen(port, () => console.log(`API on :${port}`));
  });
}

