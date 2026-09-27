import { defineFunction } from '@aws-amplify/backend';

export const communityIntentions = defineFunction({
  name: 'communityIntentions',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads MassIntention through the data API.
  resourceGroupName: 'data',
});
