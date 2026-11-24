import { isoDate, listAll, claimLogSlot, text, type Account, type Caller, type DataClient } from './parish';
import { mockRecordFor, normalizeName, recordMatches, recordTypeOf, surnameGuesses, type RecordType } from '../verify-record/match';

/* The one matcher behind verifyRecord and submitCertificateRequest, so they cannot disagree. */

export const MAX_CHECKS_PER_HOUR = 10;

export type RecordArgs = {
  certificateType?: unknown; fullName?: unknown; birthdate?: unknown;
  groomName?: unknown; brideName?: unknown; eventDate?: unknown;
};
export type FoundRecord = { id: string; fullName: string; dateOfEvent?: string | null; officiant?: string | null };

const hourPrefix = (sub: string) => `verify:${sub}:${new Date().toISOString().slice(0, 13)}`;

/** True when this account has used all its checks this hour (verifyRecord and submitCertificateRequest share it). */
export async function checksExhausted(client: DataClient, caller: Caller): Promise<boolean> {
  const last = await client.models.AccessLog.get({ id: `${hourPrefix(caller.sub)}:${MAX_CHECKS_PER_HOUR}` });
  if (last.errors?.length) throw new Error(JSON.stringify(last.errors));
  return !!last.data;
}

/**
 * Looks the typed details up in the register. Exactly one match returns the
 * record; none, or more than one, returns undefined. Counts as one check:
 * the answer is held back until the check is logged, so requests sent at the
 * same moment cannot pass the limit. `limited` is true when the limit is hit.
 */
export async function checkAgainstRegister(
  client: DataClient, caller: Caller, account: Account, args: RecordArgs,
): Promise<{ limited: boolean; record?: FoundRecord }> {
  const certificateType = text(args.certificateType, 100);
  if (await checksExhausted(client, caller)) return { limited: true };

  const type = recordTypeOf(certificateType);
  const date = isoDate(args.eventDate);
  const typedName = text(args.fullName);
  const asked = {
    type, fullName: normalizeName(args.fullName), birthdate: isoDate(args.birthdate),
    groomName: normalizeName(args.groomName), brideName: normalizeName(args.brideName),
  };

  let record: FoundRecord | undefined;
  if (type && date) {
    const candidates = await listAll((nextToken) => client.models.ParishRecord.list({
      filter: { type: { eq: type }, dateOfEvent: { eq: date } }, limit: 1000, nextToken,
    }));
    const hits = candidates.filter((r) => recordMatches(r, asked));
    if (hits.length === 1) record = hits[0];
    else if (hits.length === 0 && type !== 'marriage' && asked.fullName && asked.birthdate) {
      // Not in ParishRecord: the same parish data the staff autofill uses (MockParishioner).
      const found = new Map<string, FoundRecord>();
      const guesses = surnameGuesses(asked.fullName);
      const results = await Promise.all(guesses.flatMap(({ firstKey, lastKey }) => [
        client.models.MockParishioner.mockParishionersByLastName({ lastKey, firstKey: { beginsWith: firstKey } }),
        client.models.MockParishioner.mockParishionersByMaidenName({ maidenKey: lastKey, firstKey: { beginsWith: firstKey } }),
      ]));
      for (const res of results) {
        if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
        for (const row of res.data || []) {
          const hit = mockRecordFor(row, { type, fullName: asked.fullName, birthdate: asked.birthdate }, date);
          if (hit) found.set(hit.recordId, { id: hit.recordId, fullName: typedName, dateOfEvent: hit.date, officiant: hit.officiant });
        }
      }
      if (found.size === 1) record = [...found.values()][0];
    }
  }

  const logged = await claimLogSlot(client, hourPrefix(caller.sub), MAX_CHECKS_PER_HOUR, {
    userName: account.name,
    fileName: `Record check: ${certificateType}`.slice(0, 200),
    action: 'Verify record',
    actorKey: caller.sub,
    targetType: 'ParishRecord',
    targetId: record?.id,
    after: JSON.stringify({ match: !!record }),
  });
  if (!logged) return { limited: true };
  return { limited: false, record };
}
