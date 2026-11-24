import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitCertificateRequest';
import { accountOf, callerOf, must, ok, parseJson, refuse, text } from '../shared/parish';
import { checkAgainstRegister } from '../shared/record-check';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const VERIFIED_KEY = 'Verified Against Record';

/**
 * Saves a certificate request for the caller. Status is always pending, the
 * name and email come from the account, and linkedRecordId is only ever set
 * here, from a register match. Anything the browser sends for those is ignored.
 */
export const handler: Schema['submitCertificateRequest']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');

  try {
    const input = parseJson(event.arguments.input);
    const certificateType = text(input.certificateType, 100);
    if (!certificateType) return refuse('Please choose a certificate.');

    const details = parseJson(input.details);
    delete details[VERIFIED_KEY];
    const account = await accountOf(caller);

    let linkedRecordId: string | undefined;
    const v = input.verification;
    if (v && typeof v === 'object') {
      const { limited, record } = await checkAgainstRegister(client, caller, account, {
        certificateType, fullName: v.fullName, birthdate: v.birthdate,
        groomName: v.groomName, brideName: v.brideName, eventDate: v.eventDate,
      });
      if (limited) return refuse('Too many checks this hour. Please try again later.');
      if (!record) return refuse("We couldn't match those details to a record.");
      linkedRecordId = record.id;
      details[VERIFIED_KEY] = 'Yes';
    }

    const row = must(await client.models.CertificateRequest.create({
      requesterName: account.name,
      email: account.email,
      certificateType,
      purpose: text(input.purpose, 500),
      notes: text(input.notes, 2000),
      details: JSON.stringify(details),
      status: 'pending',
      linkedRecordId,
      owner: caller.owner,
    }));
    return ok(row);
  } catch (err) {
    console.error('submitCertificateRequest failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
