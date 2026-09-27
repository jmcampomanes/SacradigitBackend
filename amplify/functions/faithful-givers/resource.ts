import { defineFunction } from '@aws-amplify/backend';

export const faithfulGivers = defineFunction({
  name: 'faithfulGivers',
  entry: './handler.ts',
  timeoutSeconds: 30,
  // Reads Donation/ParishionerPreference through the data API.
  resourceGroupName: 'data',
});
