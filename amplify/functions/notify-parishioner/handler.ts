import nodemailer from 'nodemailer';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/notifyParishioner';
import { EMAIL_RE, KIND_BUILDERS, clean, cleanLines, type BuilderInput, type Kind } from './emails';
import { callerOf, claimLogSlot, listAll } from '../shared/parish';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
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


const MAX_RECEIVED_SENDS = 2;

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
      UserPoolId: process.env.USER_POOL_ID,
      Username: username,
    }));
    return (res.UserAttributes?.find((a) => a.Name === 'email')?.Value || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * "We received your request" may go to any address (the other person on a
 * wedding), so it's tied to a request the caller really made, at most
 * MAX_RECEIVED_SENDS times. Returns that request, or null when it's refused.
 */
async function claimReceivedSend(identity: AppSyncIdentityCognito | null, args: { serviceType?: string | null; date?: string | null; time?: string | null }) {
  const caller = callerOf(identity);
  if (!caller || !args.serviceType || !args.date || !args.time) return null;
  const rows = await listAll((nextToken) => client.models.Blessing.list({
    filter: {
      owner: { eq: caller.owner }, type: { eq: args.serviceType! }, date: { eq: args.date! },
      time: { eq: args.time! }, status: { eq: 'pending' },
    },
    limit: 1000, nextToken,
  }));
  const request = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!request) return null;
  const claimed = await claimLogSlot(client, `received-email:${request.id}`, MAX_RECEIVED_SENDS, {
    userName: request.requesterName,
    fileName: `Booking: ${request.type} — ${request.requesterName}`,
    action: 'Received email',
    actorKey: caller.sub,
    targetType: 'Blessing',
    targetId: request.id,
  });
  return claimed ? request : null;
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

  // Filled in from the saved request when a parishioner sends 'received', so the
  // browser can't choose the words that reach someone else's inbox.
  let received: Awaited<ReturnType<typeof claimReceivedSend>> = null;

  if (kind !== 'signup-code' && kind !== 'password-reset' && !isStaff(identity)) {
    // Everything except the two sign-in courtesy notes is the parish office
    // telling someone about their request — staff only. The exceptions: a
    // parishioner confirming their own self-booked slot (service-update,
    // 'scheduled'), where `to` must be the verified caller's own address, and
    // 'received', which is limited per request instead.
    const { status } = event.arguments;
    const selfConfirm = kind === 'service-update' && status === 'scheduled';
    const isReceived = kind === 'service-update' && status === 'received';
    if (!selfConfirm && !isReceived) return { success: false, error: 'Staff sign-in required' };
    if (selfConfirm && await callerEmail(identity) !== to.toLowerCase()) return { success: false, error: 'Sign-in required' };
    if (isReceived) {
      try {
        received = await claimReceivedSend(identity, event.arguments);
      } catch (err) {
        console.error(err);
      }
      if (!received) return { success: false, error: 'Could not send the email' };
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
    ...(received ? {
      name: clean(received.requesterName, 100), serviceType: clean(received.type, 100),
      location: clean(received.location, 200), contact: '', detailsLines: [],
    } : {}),
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
