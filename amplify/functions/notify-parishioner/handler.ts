import nodemailer from 'nodemailer';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/notifyParishioner';

const cognito = new CognitoIdentityProviderClient();

/* ============================================
   Parishioner email notifier — ported from
   server/email-notifier/server.js (the original
   local-only Express proxy) so it runs as a real,
   publicly reachable backend instead of localhost:3001.

   AppSync already verifies the caller's Cognito ID
   token for a signed-in request (groups/email land on
   event.identity below) — no manual JWT verification
   here, unlike the old server. signup-code/password-
   reset still need to work for a caller who isn't
   signed in yet, so the mutation itself allows guests
   (API key); the per-kind staff/self checks below are
   this function's job, same as the old server's.
   ============================================ */

type Kind = 'signup-code' | 'password-reset' | 'service-reminder' | 'service-update' | 'certificate-ready';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Strip control characters (incl. CR/LF) so nothing can inject extra mail headers or lines.
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, max);
const cleanLines = (arr: unknown) => (Array.isArray(arr) ? arr : []).slice(0, 20).map((l) => clean(l, 200)).filter(Boolean);

const SITE_URL = 'https://jmcampomanes.github.io/CAPSTONE_SACRADIGIT/';
const BRAND = '#1e2a4a';

// Every dynamic value below was control-character-stripped by clean()/cleanLines(),
// not HTML-escaped - escape before it ever lands in the HTML part.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Table-based layout with inline styles so it renders consistently across Gmail/Outlook/Apple Mail. */
function shell(bodyHtml: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
<tr><td style="background:${BRAND};padding:20px 28px;">
<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.2px;">SacraDigit</span><br>
<span style="color:#b6bdca;font-size:12px;">Our Lady of Fatima Parish</span>
</td></tr>
<tr><td style="padding:28px 28px 8px;color:#1f2937;font-size:14.5px;line-height:1.6;">
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 28px 28px;">
<a href="${SITE_URL}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">Open SacraDigit</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eef0f3;color:#9ca3af;font-size:11.5px;line-height:1.5;">
This is an automated message from SacraDigit. If anything above looks wrong, please contact the parish office.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

const greeting = (who: string) => `Hi ${esc(who || 'there')},`;

/** A two-column "fact sheet" block (Service / Date / Time / etc.) shared by booking emails. */
function factSheet(rows: Array<[string, string]>): string {
  const trs = rows.map(([label, value]) => `
<tr>
<td style="padding:6px 0;color:#6b7280;font-size:13px;width:38%;vertical-align:top;">${esc(label)}</td>
<td style="padding:6px 0;color:#1f2937;font-size:13.5px;font-weight:600;vertical-align:top;">${nl2br(value)}</td>
</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #eef0f3;border-radius:8px;padding:14px 16px;margin:14px 0;">${trs}</table>`;
}

type BuilderInput = {
  name: string; serviceType: string; certificateType: string; status: string;
  date: string; time: string; declineReason: string; location: string; contact: string;
  detailsLines: string[];
};

const KIND_BUILDERS: Record<Kind, (d: BuilderInput) => { subject: string; text: string; html: string }> = {
  'signup-code': ({ name }) => {
    const who = name || 'there';
    return {
      subject: 'Confirm your SacraDigit account',
      text: `Hi ${who},\n\nWe just sent a 6-digit verification code to this email address to confirm your new SacraDigit parishioner account.\n\nPlease check your inbox (and spam folder) for a message from AWS Cognito and enter that code on the sign-up screen. If you didn't try to create a SacraDigit account, you can ignore this message.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 12px;">We just sent a 6-digit verification code to this email address to confirm your new SacraDigit parishioner account.</p>
<p style="margin:0 0 12px;">Check your inbox (and spam folder) for a message from <strong>AWS Cognito</strong> and enter that code on the sign-up screen.</p>
<p style="margin:0;color:#6b7280;font-size:13px;">If you didn't try to create a SacraDigit account, you can ignore this message.</p>`),
    };
  },
  'password-reset': ({ name }) => {
    const who = name || 'there';
    return {
      subject: 'SacraDigit password reset requested',
      text: `Hi ${who},\n\nWe just sent a 6-digit code to this email address to reset your SacraDigit password.\n\nPlease check your inbox (and spam folder) for a message from AWS Cognito and enter that code on the reset screen. If you didn't request this, you can ignore this message — your password will stay the same.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 12px;">We just sent a 6-digit code to this email address to reset your SacraDigit password.</p>
<p style="margin:0 0 12px;">Check your inbox (and spam folder) for a message from <strong>AWS Cognito</strong> and enter that code on the reset screen.</p>
<p style="margin:0;color:#6b7280;font-size:13px;">If you didn't request this, you can ignore this message — your password will stay the same.</p>`),
    };
  },
  'service-reminder': ({ name, serviceType, date, time, location }) => {
    const who = name || 'there';
    const service = serviceType || 'service request';
    const when = `${date || ''}${time ? ` at ${time}` : ''}`.trim();
    return {
      subject: `Reminder: your ${service} is tomorrow`,
      text: `Hi ${who},\n\nJust a reminder — your ${service} is scheduled for tomorrow, ${date || ''}${time ? ` at ${time}` : ''}.${location ? `\n\nLocation: ${location}` : ''}\n\nSee you then! If you need to reschedule or cancel, please contact the parish office.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">Just a reminder — your <strong>${esc(service)}</strong> is scheduled for <strong>tomorrow</strong>.</p>
${factSheet([['Date', when], ...(location ? [['Location', location] as [string, string]] : [])])}
<p style="margin:0;color:#6b7280;font-size:13px;">See you then! If you need to reschedule or cancel, please contact the parish office.</p>`),
    };
  },
  'service-update': ({ name, serviceType, status, date, time, declineReason, location, contact, detailsLines }) => {
    const who = name || 'there';
    const service = serviceType || 'service request';
    if (status === 'declined') {
      return {
        subject: `Update on your ${service} request`,
        text: `Hi ${who},\n\nWe're sorry — your ${service} request could not be scheduled.${declineReason ? `\n\nReason: ${declineReason}` : ''}\n\nPlease contact the parish office if you have questions or would like to submit a new request.\n\n— SacraDigit`,
        html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 12px;">We're sorry — your <strong>${esc(service)}</strong> request could not be scheduled.</p>
${declineReason ? factSheet([['Reason', declineReason]]) : ''}
<p style="margin:0;color:#6b7280;font-size:13px;">Please contact the parish office if you have questions or would like to submit a new request.</p>`),
      };
    }
    if (status === 'completed') {
      const when = date ? `${date}${time ? ` at ${time}` : ''}` : '';
      return {
        subject: `Your ${service} appointment is complete`,
        text: `Hi ${who},\n\nYour ${service} appointment${date ? ` on ${date}${time ? ` at ${time}` : ''}` : ''} has been completed.\n\nThank you for trusting the parish with this. You can see this anytime under "Requested Services" in SacraDigit. If anything looks wrong, please contact the parish office.\n\n— SacraDigit`,
        html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">Your <strong>${esc(service)}</strong> appointment${when ? ` on <strong>${esc(when)}</strong>` : ''} has been completed.</p>
<p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Thank you for trusting the parish with this. You can see this anytime under "Requested Services" in SacraDigit.</p>`),
      };
    }
    const factRows: Array<[string, string]> = [
      ['Service', service],
      ['Date', date || 'TBD'],
      ...(time ? [['Time', time] as [string, string]] : []),
      ...(location ? [['Location', location] as [string, string]] : []),
      ...(contact ? [['Contact', contact] as [string, string]] : []),
      ...(detailsLines.length ? [['Details', detailsLines.join('\n')] as [string, string]] : []),
    ];
    const facts = [
      `Service: ${service}`,
      `Date: ${date || 'TBD'}`,
      ...(time ? [`Time: ${time}`] : []),
      ...(location ? [`Location: ${location}`] : []),
      ...(contact ? [`Contact: ${contact}`] : []),
      ...detailsLines,
    ];
    // 'approved' = the parish office approved a pending request; anything
    // else (e.g. 'scheduled') = a booking confirmed without an approval step.
    const approved = status === 'approved';
    const verb = approved ? 'has been approved by the parish office' : 'is confirmed';
    return {
      subject: `${approved ? 'Approved' : 'Confirmed'}: your ${service} request`,
      text: `Hi ${who},\n\nGood news — your ${service} request ${verb}. Here are the details:\n\n${facts.join('\n')}\n\nYou can see this anytime under "Requested Services" in SacraDigit. If anything above looks wrong, please contact the parish office.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 4px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">Good news — your <strong>${esc(service)}</strong> request ${verb}.</p>
${factSheet(factRows)}
<p style="margin:0;color:#6b7280;font-size:13px;">You can see this anytime under "Requested Services" in SacraDigit.</p>`),
    };
  },
  'certificate-ready': ({ name, certificateType }) => {
    const who = name || 'there';
    const cert = certificateType || 'certificate';
    return {
      subject: `Your ${cert} is ready`,
      text: `Hi ${who},\n\nGood news — your ${cert} request has been approved and is ready for pickup at the parish office.\n\nYou can see this anytime under "My Requests" in SacraDigit.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">Good news — your <strong>${esc(cert)}</strong> request has been approved and is ready for pickup at the parish office.</p>
<p style="margin:12px 0 0;color:#6b7280;font-size:13px;">You can see this anytime under "My Requests" in SacraDigit.</p>`),
    };
  },
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
});

function isStaff(identity: AppSyncIdentityCognito | null) {
  return !!identity?.groups?.some((g) => g === 'admin' || g === 'staff');
}

/**
 * The AppSync identity for allow.authenticated() reflects the caller's
 * access token, which never carries an email claim (only the ID token
 * does). Resolve the signed-in caller's real email via AdminGetUser
 * instead, keyed by the token's own username — never trust the client.
 */
async function callerEmail(identity: AppSyncIdentityCognito | null): Promise<string> {
  if (!identity?.username) return '';
  try {
    const res = await cognito.send(new AdminGetUserCommand({
      UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      Username: identity.username,
    }));
    return (res.UserAttributes?.find((a) => a.Name === 'email')?.Value || '').toLowerCase();
  } catch {
    return '';
  }
}

export const handler: Schema['notifyParishioner']['functionHandler'] = async (event) => {
  const { kind, to } = event.arguments;
  const build = KIND_BUILDERS[kind as Kind];
  if (!build) return { success: false, error: 'Unsupported notification kind' };
  if (!EMAIL_RE.test(String(to || ''))) return { success: false, error: 'Invalid recipient email' };

  const identity = (event.identity ?? null) as AppSyncIdentityCognito | null;

  if (kind === 'service-reminder' || kind === 'certificate-ready') {
    if (!isStaff(identity)) return { success: false, error: 'Staff sign-in required' };
  }
  if (kind === 'service-update') {
    // Only staff can tell someone their request was approved or declined —
    // but a confirmation (scheduled) may come from the parishioner who just
    // booked it themselves, not just staff approving someone else's.
    if (event.arguments.status === 'declined' || event.arguments.status === 'approved') {
      if (!isStaff(identity)) return { success: false, error: 'Staff sign-in required' };
    } else {
      // Never trust the client's `to` for the self case — pull the
      // recipient from the verified identity's own email, so a
      // signed-in parishioner can only ever "confirm" their own address.
      const email = await callerEmail(identity);
      if (!isStaff(identity) && email !== String(to).toLowerCase()) {
        return { success: false, error: 'Sign-in required' };
      }
    }
  }

  const data: BuilderInput = {
    name: clean(event.arguments.name, 100),
    serviceType: clean(event.arguments.serviceType, 100),
    certificateType: clean(event.arguments.certificateType, 100),
    status: clean(event.arguments.status, 30),
    date: clean(event.arguments.date, 40),
    time: clean(event.arguments.time, 40),
    declineReason: clean(event.arguments.declineReason, 400),
    location: clean(event.arguments.location, 200),
    contact: clean(event.arguments.contact, 60),
    detailsLines: cleanLines(JSON.parse(event.arguments.detailsLines || '[]')),
  };

  try {
    const { subject, text, html } = build(data);
    await transporter.sendMail({ from: env.GMAIL_USER, to, subject, text, html });
    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, error: 'Could not send the email' };
  }
};
