import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/donationTotals';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

/**
 * Parish-wide giving per purpose: [{ purpose, total }], largest first.
 * Donations with no purpose are grouped under purpose: null. No names.
 */
export const handler: Schema['donationTotals']['functionHandler'] = async () => {
  const totals = new Map<string | null, number>();
  let nextToken: string | null | undefined;

  do {
    const res = await client.models.Donation.list({
      selectionSet: ['purpose', 'amount'],
      limit: 1000,
      nextToken,
    });
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    for (const d of res.data) {
      const purpose = d.purpose?.trim() || null;
      totals.set(purpose, (totals.get(purpose) ?? 0) + (d.amount ?? 0));
    }
    nextToken = res.nextToken;
  } while (nextToken);

  return [...totals]
    .map(([purpose, total]) => ({ purpose, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
};
