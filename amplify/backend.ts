import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { sendBookingEmail } from './functions/send-booking-email/resource';
import { blessingReminder } from './functions/blessing-reminder/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';

/**
 * After `npx ampx sandbox` deploys this, go to:
 * AWS Console -> Cognito -> User pools -> (your pool) -> Groups
 * and create two groups: "staff" and "admin".
 * Assign yourself to "admin" so you can test the admin pages.
 * (Equivalent to setting role: 'admin' on a Firestore /users/{uid} doc.)
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  sendBookingEmail,
  blessingReminder,
});

// Leave the user pool's attribute schema out of the template, matching the
// last successful deploy. Cognito can't change attributes on an existing pool,
// and any Schema difference makes the update fail ("Required custom attributes
// are not supported" / "Invalid AttributeDataType input"). The live pool keeps
// its email attribute as-is.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyDeletionOverride('Schema');

// Allow both email functions to send through SES using any verified
// identity (email address or domain) in this account/region.
for (const fn of [backend.sendBookingEmail, backend.blessingReminder]) {
  const stack = Stack.of(fn.resources.lambda);
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['ses:SendEmail'],
    resources: [`arn:aws:ses:${stack.region}:${stack.account}:identity/*`],
  }));
}