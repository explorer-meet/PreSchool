"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const privateDocuments_1 = require("./services/privateDocuments");
async function setup() {
    if (process.env.DOCUMENT_ENCRYPTION_KEY) {
        (0, privateDocuments_1.assertEncryptionKey)();
        console.log('An encryption key is already configured; no changes made.');
        return;
    }
    const directory = node_path_1.default.resolve(process.env.UPLOAD_DIR ?? 'uploads');
    let entries;
    try {
        entries = await promises_1.default.readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        entries = [];
    }
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const file = await promises_1.default.open(node_path_1.default.join(directory, entry.name), 'r');
        try {
            const signature = Buffer.alloc(5);
            await file.read(signature, 0, signature.length, 0);
            if (entry.name.endsWith('.enc') || signature.equals(Buffer.from('TSID1'))) {
                throw new Error('Existing encrypted files found. Restore their original DOCUMENT_ENCRYPTION_KEY instead of generating a new key.');
            }
        }
        finally {
            await file.close();
        }
    }
    const target = node_path_1.default.resolve('.env.documents.local');
    const key = node_crypto_1.default.randomBytes(32).toString('hex');
    await promises_1.default.writeFile(target, `DOCUMENT_ENCRYPTION_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Created the ignored local encryption-key file. Back it up securely and restart the backend.');
}
setup().catch((error) => { console.error('Private upload setup failed:', error.message); process.exitCode = 1; });
