import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/takenSlots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

type Slot = Schema['TakenSlot']['type'];

/**
 * Returns which slots are taken, across all parishioners, between `from` and
 * `to` (inclusive, YYYY-MM-DD). Only the fields needed to detect double
 * booking are returned: no names, contacts, emails, notes or ids.
 * Declined bookings are left out because they don't hold a slot.
 */
export const handler: Schema['takenSlots']['functionHandler'] = async (event) => {
  const { kind, from, to } = event.arguments;

  const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (!(span >= 0) || span > MAX_RANGE_DAYS) {
    throw new Error(`"from" must be on or before "to", at most ${MAX_RANGE_DAYS} days apart`);
  }

  const slots: Slot[] = [];
  let nextToken: string | null | undefined;

  if (kind === 'blessing') {
    do {
      const res = await client.models.Blessing.list({
        filter: { date: { between: [from, to] } },
        selectionSet: ['type', 'date', 'time', 'status'],
        limit: 1000,
        nextToken,
      });
      if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
      for (const b of res.data) {
        if (b.status === 'declined') continue;
        slots.push({ name: b.type, date: b.date, time: b.time, endTime: null, status: b.status });
      }
      nextToken = res.nextToken;
    } while (nextToken);
  } else if (kind === 'facility') {
    do {
      const res = await client.models.FacilityBooking.list({
        filter: { date: { between: [from, to] } },
        selectionSet: ['facilityName', 'date', 'startTime', 'endTime', 'status'],
        limit: 1000,
        nextToken,
      });
      if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
      for (const f of res.data) {
        if (f.status === 'declined') continue;
        slots.push({ name: f.facilityName, date: f.date, time: f.startTime, endTime: f.endTime, status: f.status });
      }
      nextToken = res.nextToken;
    } while (nextToken);
  } else {
    throw new Error('kind must be "blessing" or "facility"');
  }

  return slots;
};
