import path from 'path';
import { prisma } from './lib';
import { assertEncryptionKey, encryptLegacyDocument } from './services/privateDocuments';

async function migrate() {
  assertEncryptionKey();
  const directory = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
  const [students, staff, pickupPeople] = await Promise.all([
    prisma.student.findMany({ select: { photoFileName: true, identityDocumentFileName: true } }),
    prisma.user.findMany({ where: { role: { in: ['TEACHER', 'HELPER', 'STAFF'] } }, select: { photoFileName: true } }),
    prisma.authorizedPickupPerson.findMany({ select: { photoFileName: true, aadhaarFileName: true } }),
  ]);
  const names = new Set([
    ...students.flatMap((row) => [row.photoFileName, row.identityDocumentFileName]),
    ...staff.map((row) => row.photoFileName),
    ...pickupPeople.flatMap((row) => [row.photoFileName, row.aadhaarFileName]),
  ].filter((name): name is string => !!name));
  for (const fileName of names) await encryptLegacyDocument(directory, fileName);
  console.log(`Encrypted or verified ${names.size} private document(s).`);
}

migrate().catch((error) => {
  console.error('Private document migration failed:', error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
