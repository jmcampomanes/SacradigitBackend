import { defineFunction } from '@aws-amplify/backend';

export const submitMassIntentionsFn = defineFunction({
  name: 'submitMassIntentions',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads and writes through the data API. Cognito access is added in backend.ts.
  resourceGroupName: 'data',
});
