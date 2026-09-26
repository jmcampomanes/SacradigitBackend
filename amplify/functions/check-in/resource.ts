import { defineFunction } from '@aws-amplify/backend';

export const checkInFunction = defineFunction({
  name: 'checkIn',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Reads MassCheckInSession and reads/creates MassCheckIn through the data API.
  resourceGroupName: 'data',
});
