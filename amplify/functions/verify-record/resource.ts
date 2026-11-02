import { defineFunction } from '@aws-amplify/backend';

export const verifyRecordFn = defineFunction({
  name: 'verifyRecord',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads ParishRecord and writes AccessLog through the data API. Cognito access is added in backend.ts.
  resourceGroupName: 'data',
});
