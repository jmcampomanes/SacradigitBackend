import { defineFunction } from '@aws-amplify/backend';

export const volunteerForSlotFn = defineFunction({
  name: 'volunteerForSlot',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads and writes through the data API. Cognito access is added in backend.ts.
  resourceGroupName: 'data',
});
