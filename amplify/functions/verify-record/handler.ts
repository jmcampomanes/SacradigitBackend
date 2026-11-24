import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/verifyRecord';
import { accountOf, callerOf } from '../shared/parish';
import { checkAgainstRegister } from '../shared/record-check';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const TOO_MANY = { match: false, error: 'Too many checks this hour. Please try again later.' };

/**
 * Tells a parishioner whether the details they gave match a parish record,
 * without showing which one failed. The matching and the 10-an-hour limit
 * live in shared/record-check.ts, shared with submitCertificateRequest.
 */
export const handler: Schema['verifyRecord']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return { match: false };
  try {
    const account = await accountOf(caller);
    const { limited, record } = await checkAgainstRegister(client, caller, account, event.arguments);
    if (limited) return TOO_MANY;
    if (!record) return { match: false };
    return {
      match: true, recordId: record.id, fullName: record.fullName,
      dateOfEvent: record.dateOfEvent, officiant: record.officiant,
    };
  } catch (err) {
    console.error('verifyRecord failed', err);
    throw new Error('The check isn’t working right now.');
  }
};
