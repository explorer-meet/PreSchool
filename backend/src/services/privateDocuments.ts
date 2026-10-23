import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { HttpError } from '../lib';

const MAGIC = Buffer.from('TSID1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function validImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.includes(mime as (typeof IMAGE_MIME_TYPES)[number]);
}

export function validateImageBytes(mime: string, data: Buffer): void {
  const valid = mime === 'image/jpeg'
    ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : mime === 'image/png'
      ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mime === 'image/webp'
        ? data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
        : false;
  if (!valid) throw new HttpError(415, 'The uploaded file is not a valid JPEG, PNG, or WebP image');
}

function encryptionKey(): Buffer {
  const configured = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!configured) throw new HttpError(503, 'Sensitive document storage is not configured');
  const key = /^[\da-f]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new HttpError(503, 'DOCUMENT_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key');
  return key;
}

export function assertEncryptionKey(): void {
  encryptionKey();
}

export async function storePrivateDocument(directory: string, fileName: string, plainText: Buffer): Promise<string> {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(fileName));
  const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
  const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  const filePath = path.join(directory, fileName);
  await fs.promises.writeFile(filePath, payload, { flag: 'wx', mode: 0o600 });
  return filePath;
}

export async function readPrivateDocument(directory: string, fileName: string): Promise<Buffer> {
  const payload = await fs.promises.readFile(path.join(directory, fileName));
  if (payload.length < MAGIC.length + IV_LENGTH + TAG_LENGTH || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Private document is not encrypted or has an unsupported format');
  }
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const contentStart = tagStart + TAG_LENGTH;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(ivStart, tagStart));
  decipher.setAAD(Buffer.from(fileName));
  decipher.setAuthTag(payload.subarray(tagStart, contentStart));
  return Buffer.concat([decipher.update(payload.subarray(contentStart)), decipher.final()]);
}

export async function encryptLegacyDocument(directory: string, fileName: string): Promise<void> {
  const filePath = path.join(directory, fileName);
  const plainText = await fs.promises.readFile(filePath);
  if (plainText.subarray(0, MAGIC.length).equals(MAGIC)) return;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(fileName));
  const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
  const payload = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  const temporaryPath = `${filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await fs.promises.writeFile(temporaryPath, payload, { flag: 'wx', mode: 0o600 });
  try { await fs.promises.rename(temporaryPath, filePath); }
  catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function removePrivateDocument(directory: string, fileName: string | null | undefined): Promise<void> {
  if (!fileName) return;
  try { await fs.promises.unlink(path.join(directory, fileName)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
