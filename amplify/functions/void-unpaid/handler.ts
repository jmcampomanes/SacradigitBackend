import type { EventBridgeHandler } from 'aws-lambda';
import nodemailer from 'nodemailer';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/void-unpaid';
import { EMAIL_RE, KIND_BUILDERS, clean } from '../notify-parishioner/emails';
import { listAll, longDate, manilaDate, must, parseJson } from '../shared/parish';
import { TEMP_KEY } from '../shared/slots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
});

const DECLINE_REASON = 'Payment was not received by the deadline.';

/** Every hour: voids temporary approvals whose payment deadline passed, freeing the slot. */
export const handler: EventBridgeHandler<'Scheduled Event', null, void> = async () => {
  const today = manilaDate();
  const held = await listAll((nextToken) => client.models.Blessing.list({
    filter: { status: { eq: 'temporary-approval' } }, limit: 200, nextToken,
  }));

  let voided = 0;
  for (const b of held) {
    const deadline = parseJson(b.details)[TEMP_KEY]?.deadline;
    if (!deadline || deadline >= today) continue;

    must(await client.models.Blessing.update({ id: b.id, status: 'void', declineReason: DECLINE_REASON }));
    voided++;

    if (!b.email || !EMAIL_RE.test(b.email)) continue;
    const when = b.date || b.preferredDate;
    try {
      const { subject, text, html } = KIND_BUILDERS['service-update']({
        name: clean(b.requesterName, 100), serviceType: clean(b.type, 100), certificateType: '', status: 'cancelled',
        date: when ? longDate(when) : '', time: clean(b.time, 40), declineReason: DECLINE_REASON,
        location: '', contact: '', detailsLines: [],
      });
      await transporter.sendMail({ from: env.GMAIL_USER, to: b.email, subject, text, html });
    } catch (err) {
      console.error(`Email failed: void notice for Blessing ${b.id}`, err);
    }
  }
  console.log(`void-unpaid (today=${today}): voided=${voided}`);
};
