"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.wrap = exports.HttpError = exports.tempPassword = exports.hash = exports.signToken = exports.prisma = void 0;
exports.authenticate = authenticate;
exports.schoolId = schoolId;
exports.errorHandler = errorHandler;
const client_1 = require("@prisma/client");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
exports.prisma = new client_1.PrismaClient();
const SECRET = process.env.JWT_SECRET ?? 'dev-secret';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
}
const signToken = (u) => jsonwebtoken_1.default.sign(u, SECRET, { expiresIn: '7d' });
exports.signToken = signToken;
const hash = (p) => bcryptjs_1.default.hash(p, 10);
exports.hash = hash;
const tempPassword = () => crypto_1.default.randomBytes(5).toString('hex');
exports.tempPassword = tempPassword;
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.HttpError = HttpError;
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
exports.wrap = wrap;
function authenticate(req, _res, next) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer '))
        return next(new HttpError(401, 'Missing token'));
    try {
        req.user = jsonwebtoken_1.default.verify(h.slice(7), SECRET);
    }
    catch {
        return next(new HttpError(401, 'Invalid token'));
    }
    exports.prisma.user.findUnique({ where: { id: req.user.id }, select: { active: true, role: true, schoolId: true, school: { select: { status: true } } } })
        .then((user) => {
        if (!user?.active || user.role !== req.user.role || user.schoolId !== req.user.schoolId)
            return next(new HttpError(401, 'Account access is no longer active. Please sign in again.'));
        if (user.school && user.school.status !== 'APPROVED')
            return next(new HttpError(403, 'School is not active'));
        next();
    }).catch(next);
}
const requireRole = (...roles) => (req, _res, next) => roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Forbidden'));
exports.requireRole = requireRole;
// Every school-scoped query must use this so tenants never see each other's data.
function schoolId(req) {
    const id = req.user?.schoolId;
    if (!id)
        throw new HttpError(403, 'No school context');
    return id;
}
function errorHandler(err, _req, res, _next) {
    if (err instanceof zod_1.ZodError)
        return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
    if (err instanceof HttpError)
        return res.status(err.status).json({ error: err.message });
    if (err?.name === 'MulterError')
        return res.status(400).json({ error: err.message });
    if (err?.code === 'P2002')
        return res.status(409).json({ error: 'Already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
}
