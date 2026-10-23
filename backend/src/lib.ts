import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export const prisma = new PrismaClient();

export type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'HELPER' | 'STAFF' | 'PARENT';
export interface AuthUser { id: string; role: Role; schoolId: string | null }

const SECRET = process.env.JWT_SECRET ?? 'dev-secret';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const signToken = (u: AuthUser) => jwt.sign(u, SECRET, { expiresIn: '7d' });
export const hash = (p: string) => bcrypt.hash(p, 10);
export const tempPassword = () => crypto.randomBytes(5).toString('hex');

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const wrap = (fn: (req: Request<any>, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Missing token'));
  try {
    req.user = jwt.verify(h.slice(7), SECRET) as AuthUser;
  } catch {
    return next(new HttpError(401, 'Invalid token'));
  }
  prisma.user.findUnique({ where: { id: req.user.id }, select: { active: true, role: true, schoolId: true, school: { select: { status: true } } } })
    .then((user) => {
      if (!user?.active || user.role !== req.user!.role || user.schoolId !== req.user!.schoolId) return next(new HttpError(401, 'Account access is no longer active. Please sign in again.'));
      if (user.school && user.school.status !== 'APPROVED') return next(new HttpError(403, 'School is not active'));
      next();
    }).catch(next);
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) =>
  roles.includes(req.user!.role) ? next() : next(new HttpError(403, 'Forbidden'));

// Every school-scoped query must use this so tenants never see each other's data.
export function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw new HttpError(403, 'No school context');
  return id;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as any)?.name === 'MulterError') return res.status(400).json({ error: (err as Error).message });
  if ((err as any)?.code === 'P2002') return res.status(409).json({ error: 'Already exists' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

