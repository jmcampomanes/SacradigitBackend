import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { sendBookingEmail } from '../functions/send-booking-email/resource';
import { blessingReminder } from '../functions/blessing-reminder/resource';
import { takenSlots } from '../functions/taken-slots/resource';
import { checkInFunction } from '../functions/check-in/resource';
import { faithfulGivers } from '../functions/faithful-givers/resource';
import { donationTotals } from '../functions/donation-totals/resource';
import { communityIntentions } from '../functions/community-intentions/resource';
import { userAdmin } from '../functions/user-admin/resource';

/**
 * Role-based access. Roles are Cognito groups (see auth/resource.ts):
 *   admin – Head Admin: Admin portal + Media portal, full access
 *   staff – Secretary: Admin portal, day-to-day work. Can't delete parish
 *           records, certificate requests or announcements; can't edit or
 *           delete donations; read-only on Mass/special/service schedules.
 *           (Approving requests and publishing announcements are Head Admin
 *           only in the portal UI too.)
 *   itech – Sacra ITech portal               media – Media portal
 *   signed in, no group – parishioner: only records they own (allow.owner())
 *   public API key – guests: read-only public schedules and announcements
 *
 * Every model is readable by itech: the ITech backup page exports every table.
 * Records created before sign-in existed have no owner, so only the groups
 * can see them.
 */

const schema = a.schema({

  ParishRecord: a.model({
    type: a.enum(['baptism', 'confirmation', 'marriage', 'death']),
    fullName: a.string().required(),
    dateOfEvent: a.date(),
    officiant: a.string(),
    status: a.enum(['digitized', 'processing', 'queued']),
    fileURL: a.string(),
    addedByName: a.string(),
  }).authorization(allow => [
    allow.groups(['admin']),
    allow.groups(['staff']).to(['create', 'read', 'update']), // Secretary: no delete
    allow.groups(['itech']).to(['read']),
  ]),

  CertificateRequest: a.model({
    requesterName: a.string().required(),
    certificateType: a.string().required(),
    purpose: a.string(),
    notes: a.string(),
    details: a.json(),           // dynamic fields per cert type (baptized name, dates, etc.)
    status: a.enum(['pending', 'approved', 'released', 'rejected']),
    rejectionReason: a.string(),
    linkedRecordId: a.id(),
  }).authorization(allow => [
    allow.owner(),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['create', 'read', 'update']), // Secretary: no delete
    allow.groups(['itech']).to(['read']),
  ]),

  Mass: a.model({
    date: a.date().required(),
    time: a.string().required(),
    type: a.enum(['daily', 'anticipated', 'special', 'binyag']),
    title: a.string(),
    officiant: a.string(),
    location: a.string(),
    isSpecial: a.boolean().default(false),
    note: a.string(),
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['read']), // Secretary: schedules are Head Admin only
    allow.groups(['itech']).to(['read']),
  ]),

  // One row per day of the week — the recurring pattern shown in
  // "Regular Weekly Mass Schedule" on both the admin Masses page and
  // the parishioner Mass Schedule page. A day with no row yet just
  // falls back to a hardcoded default in the frontend (see
  // weekly-mass-schedule.js) until an admin edits and saves it here.
  WeeklyMassSchedule: a.model({
    dayOfWeek: a.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
    times: a.json(),             // array of "h:mm AM/PM" strings, e.g. ["6:00 AM", "7:00 AM"]
    massType: a.enum(['daily', 'anticipated', 'special', 'binyag']),
    label: a.string(),           // optional override title (e.g. "Sunday Mass"); falls back to massType's label
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['read']), // Secretary: schedules are Head Admin only
    allow.groups(['itech']).to(['read']),
  ]),

  MassIntention: a.model({
    donor: a.string().required(),
    type: a.string(),
    names: a.json(),          // array of names the intention is for
    startTime: a.string(),
    endTime: a.string(),
    massDate: a.date(),        // assigned mass date, null until scheduled
    massTime: a.string(),
    offering: a.float(),
    status: a.enum(['pending', 'scheduled', 'completed']),
  }).authorization(allow => [
    allow.owner(),
    allow.groups(['admin', 'staff']),
    allow.groups(['itech']).to(['read']),
  ]),

  FacilityBooking: a.model({
    requesterName: a.string(),
    facilityName: a.string().required(),
    date: a.date().required(),
    startTime: a.string(),
    endTime: a.string(),
    purpose: a.string(),
    attendees: a.integer(),
    notes: a.string(),
    status: a.enum(['pending', 'approved', 'declined']),
    email: a.string(),           // parishioner's email for booking notifications (optional)
  }).authorization(allow => [
    allow.owner(),
    allow.groups(['admin', 'staff']),
    allow.groups(['itech']).to(['read']),
  ]),

  Donation: a.model({
    donor: a.string(),
    amount: a.float().required(),
    method: a.string(),
    purpose: a.string(),
    date: a.date(),
    anonymous: a.boolean().default(false),
  }).authorization(allow => [
    allow.owner(),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['create', 'read']), // Secretary records gifts; corrections are Head Admin only
    allow.groups(['itech']).to(['read']),
  ]),

  Announcement: a.model({
    title: a.string().required(),
    body: a.string().required(),
    audience: a.string(),
    published: a.boolean().default(true),
    media: a.json(),
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['admin', 'media']),
    allow.groups(['staff']).to(['create', 'read', 'update']), // Secretary drafts; no delete
    allow.groups(['itech']).to(['read']),
  ]),

  Blessing: a.model({
    requesterName: a.string().required(),
    type: a.string().required(),
    location: a.string(),
    contact: a.string(),
    notes: a.string(),
    details: a.json(),           // dynamic fields per service type (child's name, address, etc.)
    status: a.enum(['pending', 'scheduled', 'completed', 'declined']),
    preferredDate: a.date(),
    date: a.date(),
    time: a.string(),
    declineReason: a.string(),
    email: a.string(),           // parishioner's email for booking notifications (optional)
  }).authorization(allow => [
    allow.owner(),
    allow.groups(['admin', 'staff']),
    allow.groups(['itech']).to(['read']),
  ]),

  CloudFile: a.model({
    name: a.string().required(),
    url: a.string().required(),
    folder: a.string(),
    bytes: a.integer(),
  }).authorization(allow => [
    allow.groups(['itech', 'admin', 'media', 'staff']),
  ]),

  SpecialSchedule: a.model({
    name: a.string().required(),
    type: a.string(),
    status: a.string(),
    startDate: a.date(),
    endDate: a.date(),
    note: a.string(),
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['read']), // Secretary: schedules are Head Admin only
    allow.groups(['itech']).to(['read']),
  ]),

  // Tamper-evident audit trail: no one can update or delete entries.
  AccessLog: a.model({
    userName: a.string(),
    fileName: a.string(),
    action: a.string(),
  }).authorization(allow => [
    allow.authenticated().to(['create']),
    allow.groups(['itech', 'admin']).to(['read']),
  ]),

  Role: a.model({
    role: a.string().required(),
    permissions: a.json(),
    users: a.string(),
  }).authorization(allow => [
    allow.groups(['itech']),
    allow.groups(['admin']).to(['read']),
  ]),

  // ---------- Media team ----------

  ContentCalendarEntry: a.model({
    date: a.date().required(),
    title: a.string().required(),
    platform: a.string(),        // "Facebook" | "Instagram" | ...
    status: a.string(),          // "draft" | "scheduled" | "published"
    notes: a.string(),
  }).authorization(allow => [
    allow.groups(['media', 'admin']),
    allow.groups(['itech']).to(['read']),
  ]),

  PostTemplate: a.model({
    title: a.string().required(),
    category: a.string(),        // "Mass Schedule" | "Feast Day Greeting" | "Novena Reminder" | ...
    body: a.string().required(),
  }).authorization(allow => [
    allow.groups(['media', 'admin']),
    allow.groups(['itech']).to(['read']),
  ]),

  EventCoverageRequest: a.model({
    eventName: a.string().required(),
    date: a.date().required(),
    location: a.string(),
    contact: a.string(),         // ministry or person requesting
    requestedBy: a.string(),     // who submitted it (ministry name for now)
    notes: a.string(),
    status: a.string(),          // "pending" | "approved" | "rejected"
    rejectionReason: a.string(),
  }).authorization(allow => [
    allow.groups(['media', 'admin']),
    allow.groups(['staff']).to(['create', 'read']),
    allow.groups(['itech']).to(['read']),
  ]),

  // The frontend keeps exactly ONE record of this model.
  // No delete rule on purpose: livestream records can't be deleted from the app.
  LivestreamStatus: a.model({
    isLive: a.boolean(),
    platform: a.string(),
    url: a.string(),
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['media', 'admin']).to(['create', 'read', 'update']),
    allow.groups(['itech']).to(['read']),
  ]),

  // One record per "Go Live", for history. Not deletable from the app.
  LivestreamSession: a.model({
    platform: a.string(),
    url: a.string(),
    startedAt: a.datetime(),
  }).authorization(allow => [
    allow.groups(['media', 'admin']).to(['create', 'read', 'update']),
    allow.groups(['itech']).to(['read']),
  ]),

  // ---------- Editable service schedules ----------

  // One record per service type.
  ServiceSlot: a.model({
    serviceType: a.string().required(),  // must match Blessing.type exactly, e.g. "Baptism", "Wedding"
    days: a.integer().array(),           // 0=Sunday ... 6=Saturday
    times: a.string().array(),           // 12-hour strings like "09:00 AM", "02:00 PM"
    capacity: a.integer(),               // bookings allowed per slot
    leadDays: a.integer(),               // earliest bookable day from today
    windowDays: a.integer(),             // how far ahead booking is open
    location: a.string(),                // e.g. "Main Church"
    locationField: a.string(),           // optional: use this requester-typed detail as location, e.g. "Complete Address"
    active: a.boolean(),
  }).authorization(allow => [
    allow.publicApiKey().to(['read']),
    allow.authenticated().to(['read']),
    allow.groups(['admin']),
    allow.groups(['staff']).to(['read']), // Secretary: schedules are Head Admin only
    allow.groups(['itech']).to(['read']),
  ]),

  // ---------- Booking notifications ----------

  sendBookingEmail: a.mutation()
    .arguments({
      to: a.string().required(),
      subject: a.string().required(),
      body: a.string().required(),
    })
    .returns(a.boolean())
    .handler(a.handler.function(sendBookingEmail))
    .authorization(allow => [allow.authenticated()]),

  // ---------- Double-booking check ----------

  // One booked slot, with no personal details.
  TakenSlot: a.customType({
    name: a.string(),      // Blessing.type or FacilityBooking.facilityName
    date: a.date(),
    time: a.string(),      // Blessing.time or FacilityBooking.startTime
    endTime: a.string(),   // FacilityBooking.endTime (null for blessings)
    status: a.string(),
  }),

  // Every non-declined booking between from and to (inclusive, max 400 days),
  // across all parishioners. kind: "blessing" | "facility".
  takenSlots: a.query()
    .arguments({
      kind: a.string().required(),
      from: a.date().required(),
      to: a.date().required(),
    })
    .returns(a.ref('TakenSlot').array())
    .handler(a.handler.function(takenSlots))
    .authorization(allow => [allow.publicApiKey(), allow.authenticated()]),

  // ---------- Mass attendance check-in ----------

  // One per Mass that has check-in open (created by the parish office).
  MassCheckInSession: a.model({
    massId: a.id(),                      // optional link to Mass
    massDate: a.date().required(),
    massTime: a.string().required(),     // same format as Mass.time, e.g. "06:00 AM"
    title: a.string(),                   // e.g. "Sunday Mass", "Simbang Gabi – Day 3"
    codeHash: a.string().required(),     // SHA-256 hex of `${id}:${CODE}`; the plain code is never stored
    opensAt: a.datetime().required(),
    closesAt: a.datetime().required(),
    status: a.enum(['open', 'closed']),
  }).authorization(allow => [
    allow.authenticated().to(['read']),
    allow.groups(['admin', 'staff']),
    allow.groups(['itech']).to(['read']),
  ]),

  // One per parishioner per session. Read-only through the API; only the
  // checkIn function (IAM, see schema authorization below) creates these,
  // with the caller as owner.
  MassCheckIn: a.model({
    sessionId: a.id().required(),
    parishionerName: a.string().required(),  // display name
    parishionerKey: a.string().required(),   // lowercased, trimmed, single-spaced name
    massDate: a.date().required(),
    massTime: a.string().required(),
    title: a.string(),
    checkedInAt: a.datetime().required(),
  })
  .secondaryIndexes(index => [
    index('parishionerKey'),   // one person's history
    index('sessionId'),        // a session's live count
  ])
  .authorization(allow => [
    allow.owner().to(['read']),
    allow.groups(['admin', 'staff']).to(['read']),
    allow.groups(['itech']).to(['read']),
  ]),

  // Per-parishioner settings.
  ParishionerPreference: a.model({
    parishionerKey: a.string().required(),
    displayName: a.string(),
    showOnHonorRoll: a.boolean().default(true),  // "Faithful Givers" list opt-out
  })
  .secondaryIndexes(index => [index('parishionerKey')])
  .authorization(allow => [
    allow.owner(),
    allow.groups(['admin', 'staff']).to(['read']),
    allow.groups(['itech']).to(['read']),
  ]),

  // Validates the session code and records one MassCheckIn per parishioner.
  // Returns { ok, reason? , already?, checkIn? } — see functions/check-in/handler.ts.
  checkIn: a.mutation()
    .arguments({
      sessionId: a.id().required(),
      code: a.string().required(),
      parishionerName: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(checkInFunction))
    .authorization(allow => [allow.authenticated()]),

  // ---------- Parish-wide summaries (no contact details) ----------

  // Honor roll: [{ name, key, streak }] — donors with 3+ consecutive months of
  // giving, ending this month or last. Never includes amounts.
  faithfulGivers: a.query()
    .returns(a.json())
    .handler(a.handler.function(faithfulGivers))
    .authorization(allow => [allow.authenticated()]),

  // [{ purpose, total }] — sum of Donation.amount per purpose. No names.
  donationTotals: a.query()
    .returns(a.json())
    .handler(a.handler.function(donationTotals))
    .authorization(allow => [allow.authenticated()]),

  // [{ massDate, massTime, type, names, startTime, endTime }] for Mass
  // intentions between from and to (inclusive). No donor, no offering.
  communityIntentions: a.query()
    .arguments({
      from: a.date().required(),
      to: a.date().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(communityIntentions))
    .authorization(allow => [allow.authenticated()]),

  // ---------- User administration (Sacra ITech → Roles & Access) ----------
  // All handled by functions/user-admin. role: admin | staff | itech | media | parishioner

  // [{ username, sub, email, firstName, lastName, groups, status, enabled, createdAt }]
  listUsers: a.query()
    .returns(a.json())
    .handler(a.handler.function(userAdmin))
    .authorization(allow => [allow.groups(['itech'])]),

  // { ok, message }
  setUserRole: a.mutation()
    .arguments({
      username: a.string().required(),
      role: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(userAdmin))
    .authorization(allow => [allow.groups(['itech'])]),

  // { ok, username, message } — Cognito emails a temporary password.
  createStaffUser: a.mutation()
    .arguments({
      email: a.string().required(),
      firstName: a.string().required(),
      lastName: a.string().required(),
      role: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(userAdmin))
    .authorization(allow => [allow.groups(['itech'])]),

  // { ok, message }
  setUserEnabled: a.mutation()
    .arguments({
      username: a.string().required(),
      enabled: a.boolean().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(userAdmin))
    .authorization(allow => [allow.groups(['itech'])]),

})
// Server-side functions that read data with IAM (not reachable from the browser).
.authorization(allow => [
  allow.resource(blessingReminder).to(['query']),
  allow.resource(takenSlots).to(['query']),
  allow.resource(checkInFunction).to(['query', 'mutate']),
  allow.resource(faithfulGivers).to(['query']),
  allow.resource(donationTotals).to(['query']),
  allow.resource(communityIntentions).to(['query']),
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Signed-in users by default; the API key stays for public (guest) pages.
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});