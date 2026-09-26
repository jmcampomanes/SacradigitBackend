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
  environment: {
    SENDER_EMAIL: secret('SENDER_EMAIL'),
  },
});
