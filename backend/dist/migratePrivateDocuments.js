"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const lib_1 = require("./lib");
const privateDocuments_1 = require("./services/privateDocuments");
async function migrate() {
    (0, privateDocuments_1.assertEncryptionKey)();
    const directory = path_1.default.resolve(process.env.UPLOAD_DIR ?? 'uploads');
    const [students, staff, pickupPeople] = await Promise.all([
        lib_1.prisma.student.findMany({ select: { photoFileName: true, identityDocumentFileName: true } }),
        lib_1.prisma.user.findMany({ where: { role: { in: ['TEACHER', 'HELPER', 'STAFF'] } }, select: { photoFileName: true } }),
        lib_1.prisma.authorizedPickupPerson.findMany({ select: { photoFileName: true, aadhaarFileName: true } }),
    ]);
    const names = new Set([
        ...students.flatMap((row) => [row.photoFileName, row.identityDocumentFileName]),
        ...staff.map((row) => row.photoFileName),
        ...pickupPeople.flatMap((row) => [row.photoFileName, row.aadhaarFileName]),
    ].filter((name) => !!name));
    for (const fileName of names)
        await (0, privateDocuments_1.encryptLegacyDocument)(directory, fileName);
    console.log(`Encrypted or verified ${names.size} private document(s).`);
}
migrate().catch((error) => {
    console.error('Private document migration failed:', error);
    process.exitCode = 1;
}).finally(async () => {
    await lib_1.prisma.$disconnect();
});
