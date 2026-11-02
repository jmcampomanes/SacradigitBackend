import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/verifyRecord';
import { accountOf, callerOf, claimLogSlot, isoDate, listAll } from '../shared/parish';
import { normalizeName, recordMatches, recordTypeOf } from './match';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MAX_CHECKS_PER_HOUR = 10;

/**
 * Tells a parishioner whether the details they gave match a parish record,
 * without showing which one failed. The answer is held back until the check
 * is logged, so requests sent at the same moment can't pass the limit.
 */
export const handler: Schema['verifyRecord']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return { match: false };
  const { certificateType, fullName, birthdate, groomName, brideName, eventDate } = event.arguments;

  try {
    const prefix = `verify:${caller.sub}:${new Date().toISOString().slice(0, 13)}`;
    const last = await client.models.AccessLog.get({ id: `${prefix}:${MAX_CHECKS_PER_HOUR}` });
    if (last.errors?.length) throw new Error(JSON.stringify(last.errors));
    if (last.data) return { match: false, error: 'Too many checks this hour. Please try again later.' };

    const type = recordTypeOf(certificateType);
    const date = isoDate(eventDate);
    const asked = {
      type, fullName: normalizeName(fullName), birthdate: isoDate(birthdate),
      groomName: normalizeName(groomName), brideName: normalizeName(brideName),
    };
    const candidates = type && date ? await listAll((nextToken) => client.models.ParishRecord.list({
      filter: { type: { eq: type }, dateOfEvent: { eq: date } }, limit: 1000, nextToken,
    })) : [];
    const record = candidates.find((r) => recordMatches(r, asked));

    const { name } = await accountOf(caller);
    const logged = await claimLogSlot(client, prefix, MAX_CHECKS_PER_HOUR, {
      userName: name,
      fileName: `Record check: ${certificateType}`.slice(0, 200),
      action: 'Verify record',
      actorKey: caller.sub,
      targetType: 'ParishRecord',
      targetId: record?.id,
      after: JSON.stringify({ match: !!record }),
    });
    if (!logged) return { match: false, error: 'Too many checks this hour. Please try again later.' };
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
