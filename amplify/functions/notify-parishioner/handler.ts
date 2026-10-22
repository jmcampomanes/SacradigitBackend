import nodemailer from 'nodemailer';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/notifyParishioner';
import { EMAIL_RE, KIND_BUILDERS, clean, cleanLines, type BuilderInput, type Kind } from './emails';

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
  return identity?.username ? emailForUsername(identity.username) : '';
}

/** A Cognito user's email, looked up by their username. */
async function emailForUsername(username: string): Promise<string> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({
      UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      Username: username,
    }));
    return (res.UserAttributes?.find((a) => a.Name === 'email')?.Value || '').toLowerCase();
  } catch {
    return '';
  }
}

export const handler: Schema['notifyParishioner']['functionHandler'] = async (event) => {
  const { kind } = event.arguments;
  const build = KIND_BUILDERS[kind as Kind];
  if (!build) return { success: false, error: 'Unsupported notification kind' };

  const identity = (event.identity ?? null) as AppSyncIdentityCognito | null;

  // The pool signs in with email, so usernames are generated IDs: a record's
  // owner is "<id>::<id>" and carries no email. Staff pass that owner ID as
  // `to`, and the real address is looked up here.
  let to = String(event.arguments.to || '').trim();
  if (!EMAIL_RE.test(to) && isStaff(identity) && /^[\w-]{1,128}$/.test(to)) to = await emailForUsername(to);
  if (!EMAIL_RE.test(to)) {
    console.warn(`notifyParishioner: no usable recipient for ${kind}`);
    return { success: false, error: 'Invalid recipient email' };
  }

  if (kind !== 'signup-code' && kind !== 'password-reset' && !isStaff(identity)) {
    // Everything except the two sign-in courtesy notes is the parish office
    // telling someone about their request — staff only. The one exception: a
    // parishioner confirming their own self-booked slot (service-update,
    // 'scheduled'). Never trust the client's `to` for that case — it must be
    // the verified caller's own address.
    const selfConfirm = kind === 'service-update' && event.arguments.status === 'scheduled';
    if (!selfConfirm) return { success: false, error: 'Staff sign-in required' };
    if (await callerEmail(identity) !== to.toLowerCase()) return { success: false, error: 'Sign-in required' };
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
