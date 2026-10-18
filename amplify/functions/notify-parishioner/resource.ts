import { defineFunction, secret } from '@aws-amplify/backend';

export const notifyParishioner = defineFunction({
  name: 'notifyParishioner',
  entry: './handler.ts',
  timeoutSeconds: 15,
  environment: {
    // Set with: npx ampx sandbox secret set GMAIL_USER / GMAIL_APP_PASSWORD
    // (and in the Amplify console -> Secrets for the production branch).
    // GMAIL_APP_PASSWORD is an App Password (not the real Google password) —
    // generate one at https://myaccount.google.com/apppasswords, requires
    // 2-Step Verification turned on first. SES stays off for this: SES
    // production access was denied for this account, so it can only email
    // addresses manually verified in SES — Gmail can email any parishioner.
    GMAIL_USER: secret('GMAIL_USER'),
    GMAIL_APP_PASSWORD: secret('GMAIL_APP_PASSWORD'),
  },
  // Needs AdminGetUser (see auth/resource.ts's access grant) to resolve the
  // signed-in caller's real email, so it lives in the auth stack, same as
  // user-admin — assigning it to the data stack instead would make auth
  // and data depend on each other (the access grant reaches into whichever
  // stack owns this function's role).
  resourceGroupName: 'auth',
});
