import { defineFunction } from '@aws-amplify/backend';

export const donationTotals = defineFunction({
  name: 'donationTotals',
  entry: './handler.ts',
  timeoutSeconds: 30,
  // Reads Donation through the data API.
  resourceGroupName: 'data',
});
