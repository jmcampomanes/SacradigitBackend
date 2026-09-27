import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'sacradigitFiles',
  access: (allow) => ({
    // Images/attachments on public announcements.
    'announcements/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['admin', 'staff', 'media']).to(['read', 'write', 'delete']),
    ],
    // Parish cloud storage (ITech lists this folder; admin uploads scanned
    // parish records under cloudFiles/parishRecords/).
    'cloudFiles/*': [
      allow.groups(['admin', 'staff', 'itech', 'media']).to(['read', 'write', 'delete']),
    ],
    // Finished certificates; parishioners open their own from My Requests.
    'certificateUploads/*': [
      allow.authenticated.to(['read']),
      allow.groups(['admin']).to(['read', 'write', 'delete']),
      allow.groups(['staff']).to(['read', 'write']), // Secretary: no delete
    ],
  }),
});
