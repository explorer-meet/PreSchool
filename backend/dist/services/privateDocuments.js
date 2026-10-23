"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validImageMime = validImageMime;
exports.validateImageBytes = validateImageBytes;
exports.assertEncryptionKey = assertEncryptionKey;
exports.storePrivateDocument = storePrivateDocument;
exports.readPrivateDocument = readPrivateDocument;
exports.encryptLegacyDocument = encryptLegacyDocument;
exports.removePrivateDocument = removePrivateDocument;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const lib_1 = require("../lib");
const MAGIC = Buffer.from('TSID1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
function validImageMime(mime) {
    return IMAGE_MIME_TYPES.includes(mime);
}
function validateImageBytes(mime, data) {
    const valid = mime === 'image/jpeg'
        ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : mime === 'image/png'
            ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
            : mime === 'image/webp'
                ? data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
                : false;
    if (!valid)
        throw new lib_1.HttpError(415, 'The uploaded file is not a valid JPEG, PNG, or WebP image');
}
function encryptionKey() {
    const configured = process.env.DOCUMENT_ENCRYPTION_KEY;
    if (!configured)
        throw new lib_1.HttpError(503, 'Sensitive document storage is not configured');
    const key = /^[\da-f]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64');
    if (key.length !== 32)
        throw new lib_1.HttpError(503, 'DOCUMENT_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key');
    return key;
}
function assertEncryptionKey() {
    encryptionKey();
}
async function storePrivateDocument(directory, fileName, plainText) {
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(fileName));
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
    const filePath = path_1.default.join(directory, fileName);
    await fs_1.default.promises.writeFile(filePath, payload, { flag: 'wx', mode: 0o600 });
    return filePath;
}
async function readPrivateDocument(directory, fileName) {
    const payload = await fs_1.default.promises.readFile(path_1.default.join(directory, fileName));
    if (payload.length < MAGIC.length + IV_LENGTH + TAG_LENGTH || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('Private document is not encrypted or has an unsupported format');
    }
    const ivStart = MAGIC.length;
    const tagStart = ivStart + IV_LENGTH;
    const contentStart = tagStart + TAG_LENGTH;
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(ivStart, tagStart));
    decipher.setAAD(Buffer.from(fileName));
    decipher.setAuthTag(payload.subarray(tagStart, contentStart));
    return Buffer.concat([decipher.update(payload.subarray(contentStart)), decipher.final()]);
}
async function encryptLegacyDocument(directory, fileName) {
    const filePath = path_1.default.join(directory, fileName);
    const plainText = await fs_1.default.promises.readFile(filePath);
    if (plainText.subarray(0, MAGIC.length).equals(MAGIC))
        return;
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(fileName));
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
    const temporaryPath = `${filePath}.${crypto_1.default.randomBytes(8).toString('hex')}.tmp`;
    await fs_1.default.promises.writeFile(temporaryPath, payload, { flag: 'wx', mode: 0o600 });
    try {
        await fs_1.default.promises.rename(temporaryPath, filePath);
    }
    catch (error) {
        await fs_1.default.promises.unlink(temporaryPath).catch(() => { });
        throw error;
    }
}
async function removePrivateDocument(directory, fileName) {
    if (!fileName)
        return;
    try {
        await fs_1.default.promises.unlink(path_1.default.join(directory, fileName));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
