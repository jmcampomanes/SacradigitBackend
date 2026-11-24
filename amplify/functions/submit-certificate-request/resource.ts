import { defineFunction } from '@aws-amplify/backend';

export const submitCertificateRequestFn = defineFunction({
  name: 'submitCertificateRequest',
  entry: './handler.ts',
  timeoutSeconds: 20,
  // Reads ParishRecord, writes AccessLog and CertificateRequest through the data API. Cognito access is added in backend.ts.
  resourceGroupName: 'data',
});
