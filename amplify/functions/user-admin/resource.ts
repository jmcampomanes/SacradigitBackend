import { defineFunction } from '@aws-amplify/backend';

export const userAdmin = defineFunction({
  name: 'userAdmin',
  entry: './handler.ts',
  timeoutSeconds: 30,
  // Calls Cognito only (no data API). Its permissions are attached in the auth
  // stack (see auth/resource.ts), so it lives there too; putting it in the data
  // stack makes auth and data depend on each other.
  resourceGroupName: 'auth',
});
