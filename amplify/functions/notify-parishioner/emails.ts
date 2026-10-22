/* ============================================
   Parishioner email templates — shared by
   notify-parishioner (sent when staff act on a
   request) and blessing-reminder (the daily job).
   ============================================ */

export type Kind = 'signup-code' | 'password-reset' | 'service-reminder' | 'service-update'
  | 'certificate-ready' | 'certificate-update' | 'mass-intention-update';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Strip control characters (incl. CR/LF) so nothing can inject extra mail headers or lines.
export const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, max);
export const cleanLines = (arr: unknown) => (Array.isArray(arr) ? arr : []).slice(0, 20).map((l) => clean(l, 200)).filter(Boolean);

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

export type BuilderInput = {
  name: string; serviceType: string; certificateType: string; status: string;
  date: string; time: string; declineReason: string; location: string; contact: string;
  detailsLines: string[];
};

export const KIND_BUILDERS: Record<Kind, (d: BuilderInput) => { subject: string; text: string; html: string }> = {
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
    if (status === 'cancelled') {
      const when = date ? `${date}${time ? ` at ${time}` : ''}` : '';
      return simple({
        subject: `Your ${service} has been cancelled`, who,
        lead: `We're sorry — the parish office has cancelled your ${service}${when ? ` on ${when}` : ''}.`,
        leadHtml: `We're sorry — the parish office has cancelled your <strong>${esc(service)}</strong>${when ? ` on <strong>${esc(when)}</strong>` : ''}.`,
        facts: declineReason ? [['Reason', declineReason]] : [],
        footer: 'Please contact the parish office if you have questions or would like to book again.',
      });
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
    // 'approved' = the parish office approved a pending request; 'rescheduled' =
    // the office moved a booking (reason in declineReason); anything else
    // (e.g. 'scheduled') = a booking confirmed without an approval step.
    const approved = status === 'approved';
    const rescheduled = status === 'rescheduled';
    if (rescheduled && declineReason) {
      factRows.push(['Reason', declineReason]);
      facts.push(`Reason: ${declineReason}`);
    }
    const verb = approved ? 'has been approved by the parish office'
      : rescheduled ? 'has been moved to a new date by the parish office' : 'is confirmed';
    return {
      subject: `${approved ? 'Approved' : rescheduled ? 'Rescheduled' : 'Confirmed'}: your ${service} request`,
      text: `Hi ${who},\n\n${rescheduled ? 'Please note' : 'Good news'} — your ${service} request ${verb}. Here are the details:\n\n${facts.join('\n')}\n\nYou can see this anytime under "Requested Services" in SacraDigit. If anything above looks wrong, please contact the parish office.\n\n— SacraDigit`,
      html: shell(`<p style="margin:0 0 4px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">${rescheduled ? 'Please note' : 'Good news'} — your <strong>${esc(service)}</strong> request ${verb}.</p>
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
  // Certificate requests: pending -> approved -> released (ready), or rejected.
  'certificate-update': ({ name, certificateType, status, declineReason }) => {
    const who = name || 'there';
    const cert = certificateType || 'certificate';
    const footer = 'You can see this anytime under "My Requests" in SacraDigit.';
    if (status === 'rejected') {
      return simple({
        subject: `Update on your ${cert} request`, who,
        lead: `We're sorry — your ${cert} request was not approved.`,
        leadHtml: `We're sorry — your <strong>${esc(cert)}</strong> request was not approved.`,
        facts: declineReason ? [['Reason', declineReason]] : [],
        footer: 'Please contact the parish office if you have questions.',
      });
    }
    if (status === 'released') {
      return simple({
        subject: `Your ${cert} is ready for pickup`, who,
        lead: `Good news — your ${cert} is ready. You can pick it up at the parish office; please bring a valid ID.`,
        leadHtml: `Good news — your <strong>${esc(cert)}</strong> is ready. You can pick it up at the parish office; please bring a valid ID.`,
        facts: [], footer,
      });
    }
    return simple({
      subject: `Approved: your ${cert} request`, who,
      lead: `Good news — your ${cert} request has been approved and is being prepared. We'll email you again when it's ready for pickup.`,
      leadHtml: `Good news — your <strong>${esc(cert)}</strong> request has been approved and is being prepared. We'll email you again when it's ready for pickup.`,
      facts: [], footer,
    });
  },
  // Mass intentions: cancelled by the office (reason in declineReason), or offered at Mass.
  'mass-intention-update': ({ name, status, date, time, declineReason, detailsLines }) => {
    const who = name || 'there';
    const when = date ? `${date}${time ? ` at ${time}` : ''}` : '';
    const forLine: Array<[string, string]> = detailsLines.length ? [['For', detailsLines.join('\n')]] : [];
    if (status === 'cancelled') {
      return simple({
        subject: 'Your Mass intention has been cancelled', who,
        lead: `We're sorry — the parish office has cancelled your Mass intention${when ? ` for ${when}` : ''}.`,
        leadHtml: `We're sorry — the parish office has cancelled your Mass intention${when ? ` for <strong>${esc(when)}</strong>` : ''}.`,
        facts: [...forLine, ...(declineReason ? [['Reason', declineReason] as [string, string]] : [])],
        footer: 'Please contact the parish office if you have questions.',
      });
    }
    return simple({
      subject: 'Your Mass intention was offered', who,
      lead: `Your Mass intention was offered${when ? ` at the Mass on ${when}` : ''}. Thank you, and God bless!`,
      leadHtml: `Your Mass intention was offered${when ? ` at the Mass on <strong>${esc(when)}</strong>` : ''}. Thank you, and God bless!`,
      facts: forLine,
      footer: 'You can see your intentions anytime under "Mass Intentions" in SacraDigit.',
    });
  },
};

/** A short email: greeting, one lead sentence, an optional fact sheet, and a grey footer line. */
function simple({ subject, who, lead, leadHtml, facts, footer }: {
  subject: string; who: string; lead: string; leadHtml: string; facts: Array<[string, string]>; footer: string;
}) {
  const factText = facts.map(([k, v]) => `${k}: ${v}`).join('\n');
  return {
    subject,
    text: `Hi ${who},\n\n${lead}${factText ? `\n\n${factText}` : ''}\n\n${footer}\n\n— SacraDigit`,
    html: shell(`<p style="margin:0 0 12px;">${greeting(who)}</p>
<p style="margin:0 0 4px;">${leadHtml}</p>
${facts.length ? factSheet(facts) : ''}
<p style="margin:12px 0 0;color:#6b7280;font-size:13px;">${esc(footer)}</p>`),
  };
}
