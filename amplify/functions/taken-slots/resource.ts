import { defineFunction } from '@aws-amplify/backend';

export const takenSlots = defineFunction({
  name: 'takenSlots',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads Blessing/FacilityBooking through the data API.
  resourceGroupName: 'data',
});
