"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const lib_1 = require("./lib");
const public_1 = require("./routes/public");
const principal_1 = require("./routes/principal");
require("./routes/principalOps");
const teacher_1 = require("./routes/teacher");
const parent_1 = require("./routes/parent");
const jobs_1 = require("./services/jobs");
exports.app = (0, express_1.default)();
exports.app.use((0, helmet_1.default)(), (0, cors_1.default)(), express_1.default.json({ limit: '1mb' }));
exports.app.get('/health', (_q, r) => r.json({ ok: true }));
exports.app.use('/api', public_1.publicRouter);
exports.app.use('/api/admin', public_1.adminRouter);
exports.app.use('/api/principal', principal_1.principalRouter);
exports.app.use('/api/teacher', teacher_1.teacherRouter);
exports.app.use('/api/media', teacher_1.mediaRouter);
exports.app.use('/api/parent', parent_1.parentRouter);
exports.app.use(lib_1.errorHandler);
async function ensureSuperAdmin() {
    const email = process.env.SUPER_ADMIN_EMAIL, pw = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !pw)
        return;
    if (!(await lib_1.prisma.user.findUnique({ where: { email } }))) {
        await lib_1.prisma.user.create({ data: { role: 'SUPER_ADMIN', name: 'Super Admin', email, passwordHash: await (0, lib_1.hash)(pw), mustChangePassword: false } });
    }
}
if (require.main === module) {
    ensureSuperAdmin().then(() => {
        (0, jobs_1.startJobs)();
        const port = Number(process.env.PORT ?? 4000);
        exports.app.listen(port, () => console.log(`API on :${port}`));
    });
}
