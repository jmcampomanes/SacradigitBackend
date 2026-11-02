import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { sendBookingEmail } from './functions/send-booking-email/resource';
import { blessingReminder } from './functions/blessing-reminder/resource';
import { notifyParishioner } from './functions/notify-parishioner/resource';
import { createServiceRequestFn } from './functions/create-service-request/resource';
import { submitDonationFn } from './functions/submit-donation/resource';
import { submitMassIntentionsFn } from './functions/submit-mass-intentions/resource';
import { volunteerForSlotFn } from './functions/volunteer-for-slot/resource';
import { takeOverSlotFn } from './functions/take-over-slot/resource';
import { verifyRecordFn } from './functions/verify-record/resource';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';

/**
 * Roles are the Cognito groups admin / staff / itech / media, created by
 * auth/resource.ts. To bootstrap the first IT account: sign up on the site,
 * then add that user to the "itech" group (Cognito console -> User pools ->
 * (your pool) -> Groups -> itech -> Add user). From then on ITech manages
 * everyone in Sacra ITech -> Roles & Access.
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  sendBookingEmail,
  blessingReminder,
  notifyParishioner,
  createServiceRequestFn,
  submitDonationFn,
  submitMassIntentionsFn,
  volunteerForSlotFn,
  takeOverSlotFn,
  verifyRecordFn,
});

// Leave the user pool's attribute schema out of the template, matching the
// last successful deploy. Cognito can't change attributes on an existing pool,
// and any Schema difference makes the update fail ("Required custom attributes
// are not supported" / "Invalid AttributeDataType input"). The live pool keeps
// its email attribute as-is.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyDeletionOverride('Schema');

// Allow sendBookingEmail to send through SES using any verified identity
// (email address or domain) in this account/region. (blessingReminder sends
// through Gmail now, like notify-parishioner.)
for (const fn of [backend.sendBookingEmail]) {
  const stack = Stack.of(fn.resources.lambda);
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['ses:SendEmail'],
    resources: [`arn:aws:ses:${stack.region}:${stack.account}:identity/*`],
  }));
}

// These read the data API and also look up the caller in Cognito, because the
// access token AppSync verifies has no name or email. They live in the data
// stack, which already depends on auth; a grant in auth/resource.ts would make
// the two stacks depend on each other.
for (const fn of [
  backend.notifyParishioner, backend.createServiceRequestFn, backend.submitDonationFn,
  backend.submitMassIntentionsFn, backend.volunteerForSlotFn, backend.takeOverSlotFn, backend.verifyRecordFn,
]) {
  fn.addEnvironment('USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
  fn.resources.lambda.addToRolePolicy(new PolicyStatement({
    actions: ['cognito-idp:AdminGetUser'],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }));
}

// A verified Parish Server signs in through the "server" group's IAM role, which
// allow.entity('identity') doesn't cover, and they still send documents as a
// parishioner. A groups rule would open every folder, so this is limited to their
// own. It lives in the storage stack, which already depends on auth.
const { bucket } = backend.storage.resources;
new Policy(Stack.of(bucket), 'ServerRequirementUploads', {
  statements: [new PolicyStatement({
    actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    resources: [`${bucket.bucketArn}/requirementUploads/${'$'}{cognito-identity.amazonaws.com:sub}/*`],
  })],
}).attachToRole(backend.auth.resources.groups['server'].role);
