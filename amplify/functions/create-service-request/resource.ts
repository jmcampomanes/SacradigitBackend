import { defineFunction } from '@aws-amplify/backend';

export const createServiceRequestFn = defineFunction({
  name: 'createServiceRequest',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads and writes through the data API. Cognito access is added in backend.ts.
  resourceGroupName: 'data',
});
