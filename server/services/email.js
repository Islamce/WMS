/**
 * Email transport — the seam where notification emails leave the system.
 *
 * Dependency-optional and network-optional by design:
 *   - If SMTP is configured (SMTP_URL, or SMTP_HOST/SMTP_PORT) AND the optional
 *     `nodemailer` package is installed, real mail is sent.
 *   - Otherwise it degrades to a logged no-op so the app runs anywhere (CI,
 *     offline, shared hosting) without a mail server or extra dependency.
 *
 * Either way the caller gets a resolved result; email is best-effort and never
 * blocks or fails a workflow action. `EMAIL_FROM` sets the sender.
 */
let transporter;      // cached nodemailer transport (or null once we know none)
let triedInit = false;

function initTransport() {
  triedInit = true;
  const url = process.env.SMTP_URL;
  const host = process.env.SMTP_HOST;
  if (!url && !host) { transporter = null; return; }
  try {
    // Optional dependency: only required if SMTP is actually configured.
    const nodemailer = require('nodemailer');
    transporter = url
      ? nodemailer.createTransport(url)
      : nodemailer.createTransport({
          host,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === '1',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        });
  } catch {
    // nodemailer not installed — fall back to logging.
    transporter = null;
  }
}

/**
 * Send an email. Resolves { ok, transport: 'smtp'|'log', error? }. Never throws.
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) return { ok: false, transport: 'none', error: 'no recipient' };
  if (!triedInit) initTransport();
  const from = process.env.EMAIL_FROM || 'wms@localhost';
  if (!transporter) {
    console.log(`[email:log] to=${to} subject="${subject}"`);
    return { ok: true, transport: 'log' };
  }
  try {
    await transporter.sendMail({ from, to, subject, text, html });
    return { ok: true, transport: 'smtp' };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return { ok: false, transport: 'smtp', error: err.message };
  }
}

module.exports = { sendEmail };
