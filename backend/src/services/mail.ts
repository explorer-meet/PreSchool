import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const transport = host
  ? nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

// Returns true when handed to the SMTP server. Without SMTP config, the mail is printed (dev only).
export async function sendMail(to: string | undefined | null, subject: string, text: string): Promise<boolean> {
  if (!to) return false;
  if (!transport) {
    if (process.env.NODE_ENV !== 'production') console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return false;
  }
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM ?? 'TinySteps <no-reply@tinysteps.app>', to, subject, text });
    return true;
  } catch (e) {
    console.warn('Mail failed:', (e as Error).message);
    return false;
  }
}

export function sendResetCode(opts: { to?: string | null; name: string; code: string }) {
  return sendMail(
    opts.to,
    'Your TinySteps password reset code',
    `Hello ${opts.name},\n\nYour password reset code is ${opts.code}. It expires in 15 minutes.\n\n` +
      `If you did not ask for this, you can ignore this email; your password will not change.\n`,
  );
}

export function sendCredentials(opts: { to?: string | null; name: string; login: string; password: string; school: string; role: string; message?: string }) {
  return sendMail(
    opts.to,
    `Your ${opts.school} account on TinySteps`,
    `Hello ${opts.name},\n\n${opts.message?.trim() || `An account has been created for you as ${opts.role} at ${opts.school}.`}\n\n` +
      `Login: ${opts.login}\nTemporary password: ${opts.password}\n\n` +
      `Open the TinySteps app and sign in. You will be asked to set a new password on first login.\n`,
  );
}
