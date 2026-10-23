import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinysteps-smoke-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'smoke.db')}`;
  process.env.UPLOAD_DIR = path.join(directory, 'uploads');
  process.env.DOCUMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.SUPER_ADMIN_EMAIL = 'admin@isolated.test';
  process.env.SUPER_ADMIN_PASSWORD = crypto.randomBytes(16).toString('hex');
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT']) delete process.env[key];
  try {
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { stdio: 'inherit' });
    const { app } = await import('./index');
    const { prisma, hash } = await import('./lib');
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not determine isolated API address');
      process.env.API = `http://127.0.0.1:${address.port}/api`;
      await prisma.user.create({ data: { name: 'Test admin', email: process.env.SUPER_ADMIN_EMAIL, passwordHash: await hash(process.env.SUPER_ADMIN_PASSWORD), role: 'SUPER_ADMIN', mustChangePassword: false } });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, 'smoke.ts')], { stdio: 'inherit', env: process.env });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Smoke test exited with code ${code}`)));
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await prisma.$disconnect();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
