import { defineFunction } from '@aws-amplify/backend';

export const changeMyRequestFn = defineFunction({
  name: 'changeMyRequest',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads and writes Blessing through the data API.
  resourceGroupName: 'data',
});
