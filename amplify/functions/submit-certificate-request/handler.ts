import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitCertificateRequest';
import { accountOf, callerOf, listAll, must, ok, parseJson, refuse, text } from '../shared/parish';
import { checkAgainstRegister } from '../shared/record-check';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const VERIFIED_KEY = 'Verified Against Record';
// Keys only the server may write, from the matched record.
const RECORD_KEYS = [VERIFIED_KEY, 'Record Name', 'Record Event Date', 'Record Officiant'];

const CERTIFICATE_TYPES = [
  'Baptismal Certificate', 'Confirmation Certificate', 'First Communion Certificate',
  'Marriage Certificate', 'Death Certificate',
];

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
    if (!CERTIFICATE_TYPES.includes(certificateType)) return refuse('Please choose a certificate.');

    const details = parseJson(input.details);
    for (const key of RECORD_KEYS) delete details[key];
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

      const pending = await listAll((nextToken) => client.models.CertificateRequest.list({
        filter: {
          owner: { eq: caller.owner }, certificateType: { eq: certificateType },
          linkedRecordId: { eq: record.id }, status: { eq: 'pending' },
        },
        limit: 1000, nextToken,
      }));
      if (pending.length) return refuse('You already have a pending request for this certificate.');

      details[VERIFIED_KEY] = 'Yes';
      details['Record Name'] = String(record.fullName ?? '');
      details['Record Event Date'] = String(record.dateOfEvent ?? '');
      if (record.officiant) details['Record Officiant'] = String(record.officiant);
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
