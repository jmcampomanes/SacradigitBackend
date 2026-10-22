import { defineFunction, secret } from '@aws-amplify/backend';

export const blessingReminder = defineFunction({
  name: 'blessingReminder',
  entry: './handler.ts',
  timeoutSeconds: 60,
  // 8:00 AM Philippine time, every day
  schedule: { cron: '0 8 * * ?', timezone: 'Asia/Manila' },
  // Reads Blessing records through the data API, so it lives in the data stack
  // (avoids a circular dependency between the function and data stacks).
  resourceGroupName: 'data',
  // Same Gmail sender as notify-parishioner (SES can only reach addresses
  // verified in SES, so it never reached most parishioners).
  environment: {
    GMAIL_USER: secret('GMAIL_USER'),
    GMAIL_APP_PASSWORD: secret('GMAIL_APP_PASSWORD'),
  },
});
