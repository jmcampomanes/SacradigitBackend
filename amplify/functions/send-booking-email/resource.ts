import { defineFunction, secret } from '@aws-amplify/backend';

export const sendBookingEmail = defineFunction({
  name: 'sendBookingEmail',
  entry: './handler.ts',
  timeoutSeconds: 15,
  environment: {
    // Set with: npx ampx sandbox secret set SENDER_EMAIL
    // (and in the Amplify console -> Secrets for the production branch)
    SENDER_EMAIL: secret('SENDER_EMAIL'),
  },
});
