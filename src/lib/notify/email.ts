import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Gửi email qua SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 * Ví dụ Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=<gmail>, SMTP_PASS=<app password>.
 */

export const emailEnabled = () => !!process.env.SMTP_HOST;

let transporter: Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = TLS ngay từ đầu; cổng khác dùng STARTTLS nếu máy chủ hỗ trợ
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  if (!emailEnabled()) throw new Error("Máy chủ chưa cấu hình SMTP_HOST");
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}
