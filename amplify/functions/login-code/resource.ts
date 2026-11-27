import { defineFunction, secret } from '@aws-amplify/backend';

export const loginCodeFn = defineFunction({
  name: 'loginCode',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Same Gmail sender as notify-parishioner (secrets are shared by name).
  environment: {
    GMAIL_USER: secret('GMAIL_USER'),
    GMAIL_APP_PASSWORD: secret('GMAIL_APP_PASSWORD'),
    // Test accounts whose inbox doesn't exist skip the email code: comma-separated
    // full addresses or @domains, e.g. 'admin@sacradigit.test,@demo.example'.
    // Reserved test domains (.test, .example, .invalid, .local, example.com/org/net)
    // are always skipped — see isExempt in handler.ts.
    TWOFA_EXEMPT_EMAILS: '',
  },
    // Reads/writes TwoFactor through the data API and looks up the caller's email
  // in Cognito (AdminGetUser is granted in backend.ts).
  resourceGroupName: 'data',
});
