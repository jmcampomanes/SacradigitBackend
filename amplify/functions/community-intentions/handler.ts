import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/communityIntentions';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mass intentions offered between `from` and `to` (inclusive, YYYY-MM-DD),
 * across all parishioners, for the community intentions list. Only what is
 * read out at Mass is returned: no donor, no offering, no ids. Cancelled and
 * rejected intentions are left out.
 */
export const handler: Schema['communityIntentions']['functionHandler'] = async (event) => {
  const { from, to } = event.arguments;

  const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (!(span >= 0) || span > MAX_RANGE_DAYS) {
    throw new Error(`"from" must be on or before "to", at most ${MAX_RANGE_DAYS} days apart`);
  }

  const intentions: {
    massDate: string | null; massTime: string | null; type: string | null;
    names: unknown; startTime: string | null; endTime: string | null; status: string | null;
  }[] = [];
  let nextToken: string | null | undefined;

  do {
    const res = await client.models.MassIntention.list({
      filter: { massDate: { between: [from, to] } },
      selectionSet: ['massDate', 'massTime', 'type', 'names', 'startTime', 'endTime', 'status'],
      limit: 1000,
      nextToken,
    });
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    for (const m of res.data) {
      if (m.status === 'cancelled' || m.status === 'rejected') continue;
      intentions.push({
        massDate: m.massDate, massTime: m.massTime, type: m.type,
        names: m.names, startTime: m.startTime, endTime: m.endTime, status: m.status,
      });
    }
    nextToken = res.nextToken;
  } while (nextToken);

  intentions.sort((a, b) => (a.massDate ?? '').localeCompare(b.massDate ?? ''));
  return intentions;
};
