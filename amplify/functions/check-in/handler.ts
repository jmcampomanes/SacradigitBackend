import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/checkIn';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const MIN_NAME_LENGTH = 3;

const CHECK_IN_FIELDS = [
  'id', 'sessionId', 'parishionerName', 'parishionerKey',
  'massDate', 'massTime', 'title', 'checkedInAt',
] as const;

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function sameHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase(), 'utf8');
  const bb = Buffer.from(b.toLowerCase(), 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function getCheckIn(id: string) {
  const res = await client.models.MassCheckIn.get({ id }, { selectionSet: CHECK_IN_FIELDS });
  if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
  return res.data;
}

/**
 * Records that a parishioner attended a Mass, if they know the code shown at
 * that Mass. Expected failures come back as { ok:false, reason } rather than
 * thrown errors: not_found | closed | bad_code | bad_name.
 *
 * The check-in id is derived from sessionId + parishionerKey, so one person
 * can only ever have one record per session, even if they tap twice at once.
 */
export const handler: Schema['checkIn']['functionHandler'] = async (event) => {
  const { sessionId, code, parishionerName } = event.arguments;

  const sessionRes = await client.models.MassCheckInSession.get({ id: sessionId });
  if (sessionRes.errors?.length) throw new Error(JSON.stringify(sessionRes.errors));
  const session = sessionRes.data;
  if (!session) return { ok: false, reason: 'not_found' };

  const now = new Date();
  if (
    session.status !== 'open' ||
    !(now.getTime() >= Date.parse(session.opensAt)) ||
    !(now.getTime() <= Date.parse(session.closesAt))
  ) {
    return { ok: false, reason: 'closed' };
  }

  const codeOk = sameHex(sha256Hex(`${sessionId}:${code.trim().toUpperCase()}`), session.codeHash);
  if (!codeOk) return { ok: false, reason: 'bad_code' };

  const parishionerKey = parishionerName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (parishionerKey.length < MIN_NAME_LENGTH) return { ok: false, reason: 'bad_name' };

  const id = sha256Hex(`${sessionId}:${parishionerKey}`);

  // The signed-in caller owns the record (allow.owner() reads it). Same
  // format Amplify writes for owner fields: "<sub>::<username>".
  const identity = event.identity as AppSyncIdentityCognito | null;
  const owner = identity?.sub && identity.username ? `${identity.sub}::${identity.username}` : null;

  const existing = await getCheckIn(id);
  if (existing) return { ok: true, already: true, checkIn: existing };

  const created = await client.models.MassCheckIn.create(
    {
      id,
      sessionId,
      parishionerName: parishionerName.trim().replace(/\s+/g, ' '),
      parishionerKey,
      massDate: session.massDate,
      massTime: session.massTime,
      title: session.title,
      checkedInAt: now.toISOString(),
      owner,
    },
    { selectionSet: CHECK_IN_FIELDS },
  );

  if (created.errors?.length || !created.data) {
    // A simultaneous request may have created the same record first.
    const raced = await getCheckIn(id);
    if (raced) return { ok: true, already: true, checkIn: raced };
    console.error('checkIn create failed', { sessionId, errors: created.errors });
    throw new Error('Could not save check-in');
  }

  return { ok: true, already: false, checkIn: created.data };
};
