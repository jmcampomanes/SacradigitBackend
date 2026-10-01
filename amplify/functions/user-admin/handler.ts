import type { AppSyncIdentityCognito } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/userAdmin';

const cognito = new CognitoIdentityProviderClient();
const UserPoolId = env.AMPLIFY_AUTH_USERPOOL_ID;

const GROUPS = ['admin', 'staff', 'itech', 'media'] as const;
const ROLES = [...GROUPS, 'parishioner'] as const;
type Role = typeof ROLES[number];

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_NAME = 100;

const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);
const attr = (attrs: AttributeType[] | undefined, name: string) =>
  attrs?.find((a) => a.Name === name)?.Value ?? null;

// Log only the error type: Cognito messages can contain emails.
const errName = (err: unknown) => (err as { name?: string })?.name ?? 'Error';

/** The signed-in caller (Cognito user pool auth; every operation here is itech-only). */
function caller(identity: unknown) {
  const id = identity as AppSyncIdentityCognito | null;
  return { sub: id?.sub ?? null, username: id?.username ?? null };
}

/**
 * Looks up the target by username (or email alias) so "own account" checks
 * compare canonical Cognito usernames and subs.
 */
async function getUser(username: string) {
  try {
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: username }));
    return { username: u.Username!, sub: attr(u.UserAttributes, 'sub') };
  } catch (err) {
    if (errName(err) === 'UserNotFoundException') return null;
    throw err;
  }
}

function isSelf(identity: unknown, target: { username: string; sub: string | null }) {
  const me = caller(identity);
  return (!!me.username && me.username === target.username) || (!!me.sub && me.sub === target.sub);
}

/** Puts the user in exactly the group for `role` (no group for parishioner). */
async function applyRole(username: string, role: Role) {
  const current = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: username, Limit: 60 }));
  const inGroups = new Set((current.Groups ?? []).map((g) => g.GroupName));
  for (const group of GROUPS) {
    if (group !== role && inGroups.has(group)) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: username, GroupName: group }));
    }
  }
  if (role !== 'parishioner' && !inGroups.has(role)) {
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: username, GroupName: role }));
  }
}

// ---------- Operations ----------

const listUsers: Schema['listUsers']['functionHandler'] = async () => {
  const groupsOf = new Map<string, string[]>();
  for (const group of GROUPS) {
    let NextToken: string | undefined;
    do {
      const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId, GroupName: group, Limit: 60, NextToken }));
      for (const u of res.Users ?? []) {
        if (!u.Username) continue;
        groupsOf.set(u.Username, [...(groupsOf.get(u.Username) ?? []), group]);
      }
      NextToken = res.NextToken;
    } while (NextToken);
  }

  const users = [];
  let PaginationToken: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId, Limit: 60, PaginationToken }));
    for (const u of res.Users ?? []) {
      users.push({
        username: u.Username ?? null,
        sub: attr(u.Attributes, 'sub'),
        email: attr(u.Attributes, 'email'),
        firstName: attr(u.Attributes, 'given_name'),
        lastName: attr(u.Attributes, 'family_name'),
        groups: groupsOf.get(u.Username ?? '') ?? [],
        status: u.UserStatus ?? null,
        enabled: u.Enabled ?? false,
        createdAt: u.UserCreateDate?.toISOString() ?? null,
      });
    }
    PaginationToken = res.PaginationToken;
  } while (PaginationToken);

  return users;
};

const setUserRole: Schema['setUserRole']['functionHandler'] = async (event) => {
  const { username, role } = event.arguments;
  if (!isRole(role)) return { ok: false, message: `Role must be one of: ${ROLES.join(', ')}.` };

  try {
    const target = await getUser(username);
    if (!target) return { ok: false, message: 'User not found.' };
    if (isSelf(event.identity, target)) return { ok: false, message: 'You cannot change the role of your own account.' };

    await applyRole(target.username, role);
    return { ok: true, message: `Role set to ${role}.` };
  } catch (err) {
    console.error('setUserRole failed', errName(err));
    return { ok: false, message: 'Could not change the role. Please try again.' };
  }
};

const createStaffUser: Schema['createStaffUser']['functionHandler'] = async (event) => {
  const email = event.arguments.email.trim().toLowerCase();
  const firstName = event.arguments.firstName.trim().replace(/\s+/g, ' ');
  const lastName = event.arguments.lastName.trim().replace(/\s+/g, ' ');
  const { role } = event.arguments;

  if (!EMAIL_RE.test(email)) return { ok: false, username: null, message: 'Please enter a valid email address.' };
  if (!firstName || !lastName || firstName.length > MAX_NAME || lastName.length > MAX_NAME) {
    return { ok: false, username: null, message: 'Please enter a first and last name.' };
  }
  if (!isRole(role)) return { ok: false, username: null, message: `Role must be one of: ${ROLES.join(', ')}.` };

  let username: string;
  try {
    // Cognito emails the user a temporary password; they set their own on first sign-in.
    const res = await cognito.send(new AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: firstName },
        { Name: 'family_name', Value: lastName },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    }));
    username = res.User!.Username!;
  } catch (err) {
    const name = errName(err);
    if (name === 'UsernameExistsException' || name === 'AliasExistsException') {
      return { ok: false, username: null, message: 'An account with this email already exists. Change its role instead.' };
    }
    console.error('createStaffUser failed', name);
    return { ok: false, username: null, message: 'Could not create the account. Please try again.' };
  }

  try {
    await applyRole(username, role);
  } catch (err) {
    console.error('createStaffUser: role assignment failed', errName(err));
    return { ok: false, username, message: 'The account was created, but the role could not be set. Set it from the user list.' };
  }
  return { ok: true, username, message: 'Account created. A temporary password was emailed to the user.' };
};

const setUserEnabled: Schema['setUserEnabled']['functionHandler'] = async (event) => {
  const { username, enabled } = event.arguments;

  try {
    const target = await getUser(username);
    if (!target) return { ok: false, message: 'User not found.' };
    if (!enabled && isSelf(event.identity, target)) return { ok: false, message: 'You cannot disable your own account.' };

    await cognito.send(enabled
      ? new AdminEnableUserCommand({ UserPoolId, Username: target.username })
      : new AdminDisableUserCommand({ UserPoolId, Username: target.username }));
    return { ok: true, message: enabled ? 'Account enabled.' : 'Account disabled.' };
  } catch (err) {
    console.error('setUserEnabled failed', errName(err));
    return { ok: false, message: 'Could not update the account. Please try again.' };
  }
};

/**
 * One Lambda behind the four Roles & Access operations; AppSync tells us
 * which field was called. All four are restricted to the itech group in the
 * schema.
 */
const operations = { listUsers, setUserRole, createStaffUser, setUserEnabled };

export const handler = async (event: any, context: any, callback: any) => {
  // Amplify Gen 2 function handlers get the field name at the top level
  // (event.fieldName); plain AppSync Lambda resolvers use event.info.fieldName.
  const fieldName = event.fieldName ?? event.info?.fieldName;
  const op = operations[fieldName as keyof typeof operations];
  if (!op) throw new Error(`Unknown operation ${fieldName}`);
  return op(event, context, callback);
};
