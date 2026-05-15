import { Resend } from 'resend';

const resend  = new Resend(process.env.RESEND_API_KEY);
const FROM    = `ANIMEX <noreply@${process.env.APP_DOMAIN ?? 'animex.tv'}>`;
const APP_URL = process.env.APP_URL ?? 'https://animex.tv';

export async function sendVerificationEmail(email: string, token: string) {
  const url = `${APP_URL}/verify-email.html?token=${token}`;
  await resend.emails.send({
    from: FROM, to: email,
    subject: 'Verify your ANIMEX account',
    html: emailTemplate('Verify your email',
      `Click the button below to activate your account. This link expires in <strong>24 hours</strong>.`,
      url, 'Verify Email',
      `Link expires: ${new Date(Date.now() + 86400000).toUTCString()}`),
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const url = `${APP_URL}/reset-password.html?token=${token}`;
  await resend.emails.send({
    from: FROM, to: email,
    subject: 'Reset your ANIMEX password',
    html: emailTemplate('Reset your password',
      `This link expires in <strong>1 hour</strong>. If you did not request this, ignore this email.`,
      url, 'Reset Password', ''),
  });
}

function emailTemplate(title: string, body: string, url: string, btnText: string, footer: string) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#080808;color:#f0f0f0;padding:40px;border-radius:12px;border:1px solid rgba(255,255,255,0.08)">
    <div style="font-size:22px;font-weight:700;letter-spacing:3px;margin-bottom:24px">ANIMEX</div>
    <h2 style="margin:0 0 16px;font-size:20px">${title}</h2>
    <p style="color:#a0a0a0;line-height:1.6;margin-bottom:24px">${body}</p>
    <a href="${url}" style="display:inline-block;padding:14px 28px;background:#fff;color:#000;border-radius:8px;font-weight:700;text-decoration:none">${btnText}</a>
    ${footer ? `<p style="color:#505050;font-size:11px;margin-top:24px">${footer}</p>` : ''}
    <p style="color:#333;font-size:11px;word-break:break-all;margin-top:12px">${url}</p>
  </div>`;
}
