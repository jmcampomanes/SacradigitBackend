import type { EventBridgeHandler } from 'aws-lambda';
import nodemailer from 'nodemailer';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/blessingReminder';
import { EMAIL_RE, KIND_BUILDERS, clean, cleanLines, type BuilderInput, type Kind } from '../notify-parishioner/emails';

/* ============================================
   Daily parishioner emails — runs once a day at
   8:00 AM Philippine time (see resource.ts):
   - a reminder for each service booked tomorrow
     (unless the parishioner chose not to get one)
   - "your appointment is complete" for each
     service that took place yesterday
   - "your Mass intention was offered" for each
     intention said at yesterday's Masses

   Running once a day on fixed dates means each
   email goes out exactly once — this used to run
   in the admin's browser when the Blessings page
   was opened, which missed days and could repeat.
   Only records with an email on file are emailed
   (parishioners' own requests save one; walk-ins
   only when the office typed one in).
   ============================================ */

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
});

const REMINDER_FIELD = 'Day-before reminder'; // saved on the booking by the request form

/** YYYY-MM-DD in Philippine time (UTC+8, no DST), `offset` days from today. */
function manilaDate(offset: number): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

const detailsOf = (raw: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
};

/** A JSON-array field (e.g. MassIntention.names, saved as a JSON string) as an array. */
const jsonList = (raw: unknown): unknown[] => {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

async function listAll<T>(page: (nextToken?: string | null) => Promise<{ data: T[]; errors?: unknown[]; nextToken?: string | null }>) {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await page(nextToken);
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    items.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return items;
}

let sent = 0;
let failed = 0;

async function send(kind: Kind, to: string | null | undefined, fields: Partial<BuilderInput>, label: string) {
  if (!to || !EMAIL_RE.test(to)) return;
  const data: BuilderInput = {
    name: clean(fields.name, 100), serviceType: clean(fields.serviceType, 100), certificateType: '',
    status: clean(fields.status, 30), date: clean(fields.date, 40), time: clean(fields.time, 40),
    declineReason: '', location: clean(fields.location, 200), contact: '', detailsLines: cleanLines(fields.detailsLines),
  };
  try {
    const { subject, text, html } = KIND_BUILDERS[kind](data);
    await transporter.sendMail({ from: env.GMAIL_USER, to, subject, text, html });
    sent++;
  } catch (err) {
    failed++;
    console.error(`Email failed: ${label}`, err);
  }
}

export const handler: EventBridgeHandler<'Scheduled Event', null, void> = async () => {
  sent = 0;
  failed = 0;
  const tomorrow = manilaDate(1);
  const yesterday = manilaDate(-1);

  const blessings = await listAll((nextToken) => client.models.Blessing.list({
    filter: { status: { eq: 'scheduled' }, or: [{ date: { eq: tomorrow } }, { date: { eq: yesterday } }] },
    limit: 200, nextToken,
  }));
  for (const b of blessings) {
    if (b.date === tomorrow) {
      // Older bookings have no choice saved and still get the email.
      if ((detailsOf(b.details)[REMINDER_FIELD] || 'Email') !== 'Email') continue;
      await send('service-reminder', b.email, {
        name: b.requesterName, serviceType: b.type, date: longDate(b.date), time: b.time ?? '', location: b.location ?? '',
      }, `reminder for Blessing ${b.id}`);
    } else {
      await send('service-update', b.email, {
        name: b.requesterName, serviceType: b.type, status: 'completed', date: longDate(b.date!), time: b.time ?? '',
      }, `completion for Blessing ${b.id}`);
    }
  }

  // The admin Mass Intentions page marks them completed on the day; either status means it was said.
  const intentions = await listAll((nextToken) => client.models.MassIntention.list({
    filter: { massDate: { eq: yesterday }, or: [{ status: { eq: 'scheduled' } }, { status: { eq: 'completed' } }] },
    limit: 200, nextToken,
  }));
  for (const it of intentions) {
    const names = jsonList(it.names).map(String).join(', ');
    await send('mass-intention-update', it.email, {
      name: it.donor, status: 'offered', date: longDate(it.massDate!), time: it.massTime ?? '',
      detailsLines: [[it.type, names].filter(Boolean).join(': ')].filter(Boolean),
    }, `offered notice for MassIntention ${it.id}`);
  }

  console.log(`Daily emails (tomorrow=${tomorrow}, yesterday=${yesterday}): sent=${sent} failed=${failed}`);
};
