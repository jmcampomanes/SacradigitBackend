import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/faithfulGivers';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MIN_STREAK = 3;

// Same key the rest of the app uses: lowercased, trimmed, single-spaced.
const toKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

// "YYYY-MM" for this month in Philippine time (UTC+8, no DST).
function thisMonthInManila(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function previousMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Honor roll of donors who gave in at least MIN_STREAK consecutive calendar
 * months, ending this month or last month. Donation.date is already a local
 * (Manila) calendar date. Anonymous gifts and people who opted out
 * (ParishionerPreference.showOnHonorRoll === false) are left out.
 * Returns [{ name, key, streak }] — never amounts.
 */
export const handler: Schema['faithfulGivers']['functionHandler'] = async () => {
  const donors = new Map<string, { name: string; lastDate: string; months: Set<string> }>();
  let nextToken: string | null | undefined;

  do {
    const res = await client.models.Donation.list({
      selectionSet: ['donor', 'date', 'anonymous'],
      limit: 1000,
      nextToken,
    });
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    for (const d of res.data) {
      if (d.anonymous || !d.donor?.trim() || !d.date) continue;
      const key = toKey(d.donor);
      let donor = donors.get(key);
      if (!donor) donors.set(key, donor = { name: '', lastDate: '', months: new Set() });
      donor.months.add(d.date.slice(0, 7));
      // Show the name as written on their most recent gift.
      if (d.date >= donor.lastDate) {
        donor.lastDate = d.date;
        donor.name = d.donor.trim().replace(/\s+/g, ' ');
      }
    }
    nextToken = res.nextToken;
  } while (nextToken);

  const optedOut = new Set<string>();
  let prefToken: string | null | undefined;
  do {
    const res = await client.models.ParishionerPreference.list({
      filter: { showOnHonorRoll: { eq: false } },
      selectionSet: ['parishionerKey'],
      limit: 1000,
      nextToken: prefToken,
    });
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    for (const p of res.data) optedOut.add(toKey(p.parishionerKey));
    prefToken = res.nextToken;
  } while (prefToken);

  const thisMonth = thisMonthInManila();
  const lastMonth = previousMonth(thisMonth);
  const givers: { name: string; key: string; streak: number }[] = [];

  for (const [key, { name, months }] of donors) {
    if (optedOut.has(key)) continue;
    let month = months.has(thisMonth) ? thisMonth : lastMonth;
    let streak = 0;
    while (months.has(month)) {
      streak++;
      month = previousMonth(month);
    }
    if (streak >= MIN_STREAK) givers.push({ name, key, streak });
  }

  givers.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));
  return givers;
};
