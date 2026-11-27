import nodemailer from 'nodemailer';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/loginCode';
import { callerOf, accountOf, ok, refuse } from '../shared/parish';
import { loginCodeEmail } from '../notify-parishioner/emails';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
});

/* ============================================
   Email sign-in code ("Extra sign-in protection").
   One TwoFactor row per user (keyed by Cognito sub),
   reachable only from this function — the browser
   never sees the code or its hash.

   status → { enabled }
   send   → emails a fresh 6-digit code to the account's own address
            (10 minutes, one every 30 seconds)
   verify → checks the code (5 tries per code). purpose 'enable' turns the
            protection on, 'disable' turns it off, 'signin' just confirms.
   ============================================ */

const CODE_MINUTES = 10;
const RESEND_SECONDS = 30;
const MAX_TRIES = 5;

/** Test accounts have no real inbox, so they can't receive a code. */
const EXEMPT = (process.env.TWOFA_EXEMPT_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const RESERVED = /@(?:[^@s]+.)?(?:[^@s.]+.(?:test|example|invalid|local|localhost)|example.(?:com|org|net))$/;
function isExempt(email: string) {
  const e = email.toLowerCase();
  return RESERVED.test(e) || EXEMPT.some((x) => (x.startsWith('@') ? e.endsWith(x) : e === x));
}

const hash = (sub: string, code: string) => createHash('sha256').update(`${sub}:${code}`).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const handler: Schema['loginCode']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Sign-in required');
  const { action, purpose } = event.arguments;
  const code = String(event.arguments.code ?? '').replace(/\D/g, '').slice(0, 6);

  try {
    const account = await accountOf(caller);
    // Test accounts are never asked for a code, and can't turn it on.
    if (isExempt(account.email)) {
      if (action === 'status') return ok({ enabled: false, exempt: true });
      return refuse('This is a test account, so it skips the email code.');
    }

    const { data: row } = await client.models.TwoFactor.get({ sub: caller.sub });

    if (action === 'status') return ok({ enabled: !!row?.enabled });

    if (action === 'send') {
      if (purpose === 'signin' && !row?.enabled) return refuse('Extra sign-in protection is off for this account.');
      const sentAt = row?.codeSentAt ? Date.parse(row.codeSentAt) : 0;
      if (Date.now() - sentAt < RESEND_SECONDS * 1000) return refuse(`Please wait a few seconds before asking for another code.`);
      if (!account.email) return refuse('No email address is on file for this account.');
      const fresh = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const fields = {
        sub: caller.sub, codeHash: hash(caller.sub, fresh), attempts: 0,
        codeSentAt: new Date().toISOString(),
        codeExpires: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
      };
      const res = row ? await client.models.TwoFactor.update(fields) : await client.models.TwoFactor.create({ ...fields, enabled: false });
      if (res.errors?.length) { console.error(res.errors); return refuse('Could not send the code. Please try again.'); }
      const mail = loginCodeEmail({ name: account.firstName || account.name, code: fresh, minutes: CODE_MINUTES, purpose: String(purpose || 'signin') });
      await transporter.sendMail({ from: env.GMAIL_USER, to: account.email, ...mail });
      return ok({ sent: true, minutes: CODE_MINUTES, hint: maskEmail(account.email) });
    }

    if (action === 'verify') {
      if (!row?.codeHash || !row.codeExpires || Date.parse(row.codeExpires) < Date.now()) return refuse('That code has expired. Ask for a new one.');
      if ((row.attempts ?? 0) >= MAX_TRIES) return refuse('Too many wrong tries. Ask for a new code.');
      if (code.length !== 6 || !sameHash(row.codeHash, hash(caller.sub, code))) {
        await client.models.TwoFactor.update({ sub: caller.sub, attempts: (row.attempts ?? 0) + 1 });
        return refuse('That code is not right. Please check it and try again.');
      }
      const enabled = purpose === 'enable' ? true : purpose === 'disable' ? false : !!row.enabled;
      // One use only.
      await client.models.TwoFactor.update({ sub: caller.sub, enabled, codeHash: '', codeExpires: '', attempts: 0 });
      return ok({ verified: true, enabled });
    }

    return refuse('Unsupported action');
  } catch (err) {
    console.error(err);
    return refuse('Something went wrong. Please try again.');
  }
};

function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}
