import crypto from 'node:crypto';
import { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertEncryptionKey } from './services/privateDocuments';

async function setup() {
  if (process.env.DOCUMENT_ENCRYPTION_KEY) {
    assertEncryptionKey();
    console.log('An encryption key is already configured; no changes made.');
    return;
  }
  const directory = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
  let entries: Dirent[];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = await fs.open(path.join(directory, entry.name), 'r');
    try {
      const signature = Buffer.alloc(5);
      await file.read(signature, 0, signature.length, 0);
      if (entry.name.endsWith('.enc') || signature.equals(Buffer.from('TSID1'))) {
        throw new Error('Existing encrypted files found. Restore their original DOCUMENT_ENCRYPTION_KEY instead of generating a new key.');
      }
    } finally { await file.close(); }
  }
  const target = path.resolve('.env.documents.local');
  const key = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(target, `DOCUMENT_ENCRYPTION_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created the ignored local encryption-key file. Back it up securely and restart the backend.');
}

setup().catch((error) => { console.error('Private upload setup failed:', error.message); process.exitCode = 1; });
