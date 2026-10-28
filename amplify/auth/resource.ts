import { defineAuth } from '@aws-amplify/backend';
import { userAdmin } from '../functions/user-admin/resource';
import { notifyParishioner } from '../functions/notify-parishioner/resource';
import { setServerRoleFn } from '../functions/set-server-role/resource';

/**
 * Roles are Cognito groups:
 *   admin – Head Admin (Admin portal + Media portal, full access)
 *   staff – Secretary (Admin portal, day-to-day work; see data/resource.ts)
 *   itech – IT team (Sacra ITech portal)
 *   media – media team (Media portal)
 *   (no group) – parishioner: only their own records
 *   server – verified Parish Server: still a parishioner, plus serving perks.
 *            Lowest precedence, so a staff member's main role stays staff.
 *            Added/removed by the Head Admin via setServerRole.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // Verification codes, invites and password resets use Cognito's default
  // no-reply@verificationemail.com sender for now. A custom sender via SES
  // (sacradigit@gmail.com, already verified as an SES identity) is ready to
  // switch on, but SES production access is still pending — while the
  // account is in the SES sandbox, Cognito could only deliver to recipients
  // that are themselves verified in SES, which would silently break sign-up
  // for everyone else. Re-add the `senders` block below once production
  // access is granted:
  //   senders: { email: { fromEmail: 'sacradigit@gmail.com', fromName: 'SacraDigit' } },
  // Standard attributes, optional so the existing pool doesn't have to change
  // (Cognito can't make an attribute required after the pool exists). The
  // sign-up form sends given_name and family_name.
  userAttributes: {
    givenName: { mutable: true, required: false },
    familyName: { mutable: true, required: false },
  },
  groups: ['admin', 'staff', 'itech', 'media', 'server'],
  // Sacra ITech → Roles & Access (functions/user-admin).
  access: (allow) => [
    allow.resource(userAdmin).to([
      'manageUsers',            // AdminCreateUser, AdminEnable/DisableUser, AdminGetUser
      'manageGroupMembership',  // AdminAddUserToGroup, AdminRemoveUserFromGroup
      'listUsers',
      'listUsersInGroup',
      'listGroupsForUser',
    ]),
    // The caller's access token (what AppSync actually verifies for
    // allow.authenticated()) has no email claim — only the ID token does.
    // notify-parishioner needs AdminGetUser to resolve the signed-in
    // caller's real email for the self-booking-confirmation check.
    allow.resource(notifyParishioner).to(['manageUsers']),
    // Head Admin → Parish Servers: find the user by sub, then add/remove the
    // "server" group only (functions/set-server-role).
    allow.resource(setServerRoleFn).to(['listUsers', 'manageGroupMembership']),
  ],
});
