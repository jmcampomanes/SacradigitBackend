import { defineStorage } from '@aws-amplify/backend';

/**
 * TEMPORARY — guest access allowed for testing, matching the
 * RBAC-removed data/resource.ts. Restore allow.authenticated /
 * allow.groups(['staff','admin']) before this app is used for
 * real — right now anyone can upload/delete files here.
 */
export const storage = defineStorage({
  name: 'sacradigitFiles',
  access: (allow) => ({
    'announcements/*': [
      allow.guest.to(['read', 'write', 'delete']),
    ],
    'cloudFiles/*': [
      allow.guest.to(['read', 'write', 'delete']),
    ],
  }),
});