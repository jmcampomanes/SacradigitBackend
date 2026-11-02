import { defineFunction } from '@aws-amplify/backend';

export const submitServicePaymentFn = defineFunction({
  name: 'submitServicePayment',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads and writes through the data API.
  resourceGroupName: 'data',
});
