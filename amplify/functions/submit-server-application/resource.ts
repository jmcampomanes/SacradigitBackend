import { defineFunction } from '@aws-amplify/backend';

export const submitServerApplicationFn = defineFunction({
  name: 'submitServerApplication',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Writes ServerApplication through the data API.
  resourceGroupName: 'data',
});
