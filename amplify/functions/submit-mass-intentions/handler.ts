import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitMassIntentions';
import { accountOf, callerOf, isoDate, must, ok, parishRules, parseJson, refuse, text, type Details } from '../shared/parish';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MAX_RECORDS = 100;

// parseJson() returns the array as an object; keep it an array.
const listOf = (raw: unknown): Details[] => Object.values(parseJson(raw));

/** Saves one form's intentions as pending, with one PaymentRecord for the whole offering. */
export const handler: Schema['submitMassIntentions']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { records: raw, amount, method, referenceNumber } = event.arguments;

  try {
    const records = listOf(raw);
    if (!records.length || records.length > MAX_RECORDS) return refuse('Please add the names for your intention.');

    // The minimum is per intention, however many names it has.
    const { fees } = await parishRules(client);
    if (!(amount >= fees.massIntentionMin)) return refuse(`The minimum offering is ₱${fees.massIntentionMin}.`);

    const { name, email } = await accountOf(caller);
    const results = await Promise.all(records.map((r) => client.models.MassIntention.create({
      donor: name,
      email: email || text(r.email),
      type: text(r.type, 100),
      names: typeof r.names === 'string' ? r.names : JSON.stringify(r.names ?? []),
      massDate: isoDate(r.massDate) || undefined,
      offering: Number(r.offering) || 0,
      status: 'pending',
      owner: caller.owner,
    })));
    const ids = results.flatMap((r) => (r.data ? [r.data.id] : []));

    try {
      if (ids.length !== records.length) throw new Error(JSON.stringify(results.flatMap((r) => r.errors ?? [])));
      must(await client.models.PaymentRecord.create({
        requestType: 'Mass Intention',
        requestId: ids[0],
        payerName: name,
        amount,
        method: text(method, 40),
        referenceNumber: text(referenceNumber, 60),
        status: 'submitted',
        note: ids.join(','),
        owner: caller.owner,
      }));
    } catch (err) {
      await Promise.all(ids.map((id) => client.models.MassIntention.delete({ id })));
      throw err;
    }
    return ok(results.map((r) => r.data));
  } catch (err) {
    console.error('submitMassIntentions failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
