import type { AppSyncIdentityCognito } from 'aws-lambda';
import type { generateClient } from 'aws-amplify/data';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';

/* ============================================
   Shared by the parishioner mutations, which all
   reply { success: true, data } or
   { success: false, error: <a sentence> }.
   ============================================ */

export type DataClient = ReturnType<typeof generateClient<Schema>>;
export type Details = Record<string, any>;

const cognito = new CognitoIdentityProviderClient();

// a.json() arrives as a JSON string, and the frontend may stringify it before saving.
export function parseJson(raw: unknown): Details {
  try {
    let value = raw;
    while (typeof value === 'string') value = JSON.parse(value);
    return value && typeof value === 'object' ? value as Details : {};
  } catch { return {}; }
}

export const ok = (data: unknown) => ({ success: true, data: JSON.parse(JSON.stringify(data)) });
export const refuse = (error: string) => ({ success: false, error });

/** Trims and strips control characters from a value sent by the browser. */
export const text = (value: unknown, max = 200) => String(value ?? '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, max);

/** The string when it's a real YYYY-MM-DD date, else ''. */
export function isoDate(value: unknown): string {
  const s = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : '';
}

/** YYYY-MM-DD in Philippine time (UTC+8, no DST), `offset` days from today. */
export function manilaDate(offset = 0): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

export type Caller = { sub: string; username: string; owner: string };

/** Who is calling, from the token. `owner` is the format Amplify writes on a row. */
export function callerOf(identity: unknown): Caller | null {
  const { sub, username } = (identity ?? {}) as Partial<AppSyncIdentityCognito>;
  return sub && username ? { sub, username, owner: `${sub}::${username}` } : null;
}

/** Older rows can hold just one half of the owner value. */
export const ownsRow = (row: { owner?: string | null }, caller: Caller) => {
  const [first, second] = String(row.owner ?? '').split('::');
  return first === caller.sub || first === caller.username || second === caller.username;
};

export type Account = { name: string; firstName: string; lastName: string; email: string };

/**
 * The caller's name and email. AppSync verifies the access token, which has
 * neither, so they come from Cognito. The name is built like the frontend's
 * currentUserName(): rows are matched to people by that name.
 */
export async function accountOf(caller: Caller): Promise<Account> {
  const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: caller.username }));
  const attr = (name: string) => res.UserAttributes?.find((a) => a.Name === name)?.Value || '';
  const firstName = attr('given_name');
  const lastName = attr('family_name');
  const email = attr('email');
  return {
    firstName, lastName, email,
    name: [firstName, lastName].filter(Boolean).join(' ') || attr('name') || email.split('@')[0],
  };
}

/** The saved row, or throws. For writes the caller can't carry on from. */
export function must<T>(res: { data?: T | null; errors?: unknown[] }): T {
  if (res.errors?.length || !res.data) throw new Error(JSON.stringify(res.errors ?? 'No data returned'));
  return res.data;
}

export async function listAll<T>(page: (nextToken?: string | null) => Promise<{ data: T[]; errors?: unknown[]; nextToken?: string | null }>) {
  const items: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await page(nextToken);
    if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    items.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return items;
}

/** Parish rules: the single ParishSettings row over the published defaults. */
export async function parishRules(client: DataClient) {
  const res = await client.models.ParishSettings.list({ limit: 1 });
  if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
  const saved = parseJson(res.data[0]?.settings);
  return {
    freeCancelDays: 3,
    serverSignupCloseDays: 3,
    ...saved,
    fees: { massIntentionMin: 50, blessingMin: 200, ...saved.fees },
  };
}

type LogFields = Omit<Schema['AccessLog']['createType'], 'id'>;

/**
 * Takes one of `max` numbered AccessLog ids, or returns false when all are
 * taken. A fixed id can only be created once, so a limit holds even when
 * requests arrive at the same moment.
 */
export async function claimLogSlot(client: DataClient, prefix: string, max: number, fields: LogFields): Promise<boolean> {
  for (let n = 1; n <= max; n++) {
    const res = await client.models.AccessLog.create({ id: `${prefix}:${n}`, ...fields });
    if (!res.errors?.length) return true;
    if (!JSON.stringify(res.errors).includes('ConditionalCheckFailed')) throw new Error(JSON.stringify(res.errors));
  }
  return false;
}

const MINISTRY_LABELS: Record<string, string> = {
  lector: 'Lectors', choir: 'Choir', 'altar-server': 'Altar Servers', usher: 'Ushers',
};

/** True when the person holds an approved, unexpired ServerApplication for this ministry. */
export async function approvedFor(client: DataClient, sub: string, ministry: string): Promise<boolean> {
  const label = MINISTRY_LABELS[ministry];
  if (!label) return false;
  const apps = await listAll((nextToken) => client.models.ServerApplication.list({
    filter: { applicantKey: { eq: sub }, status: { eq: 'approved' }, ministry: { eq: label } },
    limit: 1000, nextToken,
  }));
  const today = manilaDate();
  return apps.some((a) => !!a.validUntil && a.validUntil >= today);
}
