import type { EventBridgeHandler } from 'aws-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/blessingReminder';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
const ses = new SESv2Client();

// Tomorrow's date as YYYY-MM-DD in Philippine time (UTC+8, no DST).
function tomorrowInManila(): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const handler: EventBridgeHandler<'Scheduled Event', null, void> = async () => {
  const tomorrow = tomorrowInManila();
  let nextToken: string | null | undefined;
  let sent = 0;
  let failed = 0;

  do {
    const { data, errors, nextToken: next } = await client.models.Blessing.list({
      filter: { status: { eq: 'scheduled' }, date: { eq: tomorrow } },
      limit: 100,
      nextToken,
    });
    if (errors?.length) throw new Error(JSON.stringify(errors));
    nextToken = next;

    for (const b of data) {
      if (!b.email) continue;
      const when = b.time ? `${b.date} at ${b.time}` : `${b.date}`;
      const where = b.location ? `\nLocation: ${b.location}` : '';
      try {
        await ses.send(new SendEmailCommand({
          FromEmailAddress: env.SENDER_EMAIL,
          Destination: { ToAddresses: [b.email] },
          Content: {
            Simple: {
              Subject: { Data: `Reminder: your ${b.type} is tomorrow`, Charset: 'UTF-8' },
              Body: {
                Text: {
                  Data:
                    `Dear ${b.requesterName},\n\n` +
                    `This is a reminder that your ${b.type} is scheduled for ${when}.${where}\n\n` +
                    `God bless,\nThe Parish Office`,
                  Charset: 'UTF-8',
                },
              },
            },
          },
        }));
        sent++;
      } catch (err) {
        failed++;
        console.error(`Reminder failed for Blessing ${b.id}`, err);
      }
    }
  } while (nextToken);

  console.log(`Blessing reminders for ${tomorrow}: sent=${sent} failed=${failed}`);
};
