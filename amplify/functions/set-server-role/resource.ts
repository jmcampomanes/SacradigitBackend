import { defineFunction } from '@aws-amplify/backend';

export const setServerRoleFn = defineFunction({
  name: 'setServerRole',
  entry: './handler.ts',
  timeoutSeconds: 30,
  // Calls Cognito only, like user-admin: its permissions are attached in the
  // auth stack (see auth/resource.ts), so it lives there too.
  resourceGroupName: 'auth',
});
