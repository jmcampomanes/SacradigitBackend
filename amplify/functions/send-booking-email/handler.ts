import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/sendBookingEmail';

const ses = new SESv2Client();

// Any signed-in user can call this mutation, so keep it to one plain
// recipient and short messages.
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export const handler: Schema['sendBookingEmail']['functionHandler'] = async (event) => {
  const { to, subject, body } = event.arguments;

  const recipient = to.trim();
  if (!EMAIL_RE.test(recipient)) {
    console.warn('Rejected invalid recipient address');
    return false;
  }
  if (!subject.trim() || subject.length > MAX_SUBJECT || !body.trim() || body.length > MAX_BODY) {
    console.warn('Rejected subject/body: empty or too long');
    return false;
  }

  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: env.SENDER_EMAIL,
      Destination: { ToAddresses: [recipient] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      },
    }));
    return true;
  } catch (err) {
    console.error('SES send failed', err);
    return false;
  }
};
