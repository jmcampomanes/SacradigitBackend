import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/setServerRole';

const cognito = new CognitoIdentityProviderClient();
const UserPoolId = env.AMPLIFY_AUTH_USERPOOL_ID;

// The only group this function ever touches. A verified Parish Server stays an
// ordinary parishioner otherwise; staff roles are managed by user-admin.
const GroupName = 'server';

// Cognito subs are UUIDs; anything else can't match and must not reach the filter string.
const SUB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Log only the error type: Cognito messages can contain emails.
const errName = (err: unknown) => (err as { name?: string })?.name ?? 'Error';

/** Head Admin only (see data/resource.ts): adds or removes the user's "server" group. */
export const handler: Schema['setServerRole']['functionHandler'] = async (event) => {
  const { sub, enabled } = event.arguments;
  if (!SUB_RE.test(sub)) return { success: false, error: 'User not found' };

  try {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId, Filter: `sub = "${sub}"`, Limit: 1 }));
    const Username = res.Users?.[0]?.Username;
    if (!Username) return { success: false, error: 'User not found' };

    await cognito.send(enabled
      ? new AdminAddUserToGroupCommand({ UserPoolId, Username, GroupName })
      : new AdminRemoveUserFromGroupCommand({ UserPoolId, Username, GroupName }));
    return { success: true };
  } catch (err) {
    console.error('setServerRole failed', errName(err));
    return { success: false, error: 'Could not update the Parish Server role. Please try again.' };
  }
};
