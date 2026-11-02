import { defineFunction, secret } from '@aws-amplify/backend';

export const voidUnpaid = defineFunction({
  name: 'void-unpaid',
  entry: './handler.ts',
  timeoutSeconds: 60,
  schedule: 'every 1h',
  // Updates Blessing through the data API, like blessing-reminder.
  resourceGroupName: 'data',
  environment: {
    GMAIL_USER: secret('GMAIL_USER'),
    GMAIL_APP_PASSWORD: secret('GMAIL_APP_PASSWORD'),
  },
});
