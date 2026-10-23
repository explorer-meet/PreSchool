"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_child_process_1 = require("node:child_process");
async function main() {
    const directory = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'tinysteps-smoke-'));
    process.env.DATABASE_URL = `file:${node_path_1.default.join(directory, 'smoke.db')}`;
    process.env.UPLOAD_DIR = node_path_1.default.join(directory, 'uploads');
    process.env.DOCUMENT_ENCRYPTION_KEY = node_crypto_1.default.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = node_crypto_1.default.randomBytes(32).toString('hex');
    process.env.SUPER_ADMIN_EMAIL = 'admin@isolated.test';
    process.env.SUPER_ADMIN_PASSWORD = node_crypto_1.default.randomBytes(16).toString('hex');
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT'])
        delete process.env[key];
    try {
        (0, node_child_process_1.execFileSync)(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { stdio: 'inherit' });
        const { app } = await Promise.resolve().then(() => __importStar(require('./index')));
        const { prisma, hash } = await Promise.resolve().then(() => __importStar(require('./lib')));
        const server = app.listen(0, '127.0.0.1');
        try {
            await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
            const address = server.address();
            if (!address || typeof address === 'string')
                throw new Error('Could not determine isolated API address');
            process.env.API = `http://127.0.0.1:${address.port}/api`;
            await prisma.user.create({ data: { name: 'Test admin', email: process.env.SUPER_ADMIN_EMAIL, passwordHash: await hash(process.env.SUPER_ADMIN_PASSWORD), role: 'SUPER_ADMIN', mustChangePassword: false } });
            await new Promise((resolve, reject) => {
                const child = (0, node_child_process_1.spawn)(process.execPath, ['--import', 'tsx', node_path_1.default.join(__dirname, 'smoke.ts')], { stdio: 'inherit', env: process.env });
                child.once('error', reject);
                child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Smoke test exited with code ${code}`)));
            });
        }
        finally {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            await prisma.$disconnect();
        }
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
