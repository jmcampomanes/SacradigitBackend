import { listAll, manilaDate, parseJson, type DataClient } from './parish';

/* ============================================
   Whether a service slot still has room. Follows
   the frontend's shared/js/service-schedule.js and
   request-status.js: keep them in step.
   ============================================ */

export const TEMP_KEY = 'Temporary Approval';
export const PUBLIC_DATE_KEY = 'Public Baptism Date Id';
export const PUBLIC_BAPTISM_AUDIENCE = 'Public Baptism';

// SERVICE_SCHEDULES capacities; a ServiceSlot row overrides them.
const CAPACITY: Record<string, number> = {
  'Baptism': 10, 'Confirmation': 20, 'First Communion': 30, 'Confession / Reconciliation': 5,
  'Anointing of the Sick': 1, 'Wedding': 1, 'Holy Orders': 1,
  'Funeral Mass': 1, 'Inurnment': 1, 'Anniversary Mass': 1, 'Baccalaureate Mass': 1,
  'House Blessing': 1, 'Vehicle / Item Blessing': 5, 'Business Dedication': 1, 'Pet Blessing': 10,
};
const DEFAULT_CAPACITY = 1;

const HOLDING = new Set(['pending', 'temporary-approval', 'payment-submitted', 'scheduled']);

type Row = {
  id: string; type: string; status?: string | null; time?: string | null;
  date?: string | null; preferredDate?: string | null; details?: unknown;
};

export function minutes(time12: unknown): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(time12 ?? '').trim());
  if (!m) return -1;
  return (Number(m[1]) % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
}

/** An unpaid hold past its deadline frees the slot even before void-unpaid stores 'void'. */
const holdsSlot = (r: Row, today: string) => {
  if (!HOLDING.has(r.status ?? '')) return false;
  const deadline = parseJson(r.details)[TEMP_KEY]?.deadline;
  return !(r.status === 'temporary-approval' && deadline && deadline < today);
};

const slotDateOf = (r: Row) => (r.status === 'pending' ? (r.preferredDate || r.date) : (r.date || r.preferredDate));

/** How many active bookings of a type sit on a date and time. */
export async function seatsTaken(client: DataClient, type: string, date: string, time: string, excludeId?: string) {
  const rows = await listAll((nextToken) => client.models.Blessing.list({
    filter: { type: { eq: type }, or: [{ date: { eq: date } }, { preferredDate: { eq: date } }] },
    selectionSet: ['id', 'type', 'status', 'time', 'date', 'preferredDate', 'details'],
    limit: 1000, nextToken,
  }));
  const today = manilaDate();
  return rows.filter((r) => r.id !== excludeId && holdsSlot(r, today)
    && slotDateOf(r) === date && minutes(r.time) === minutes(time)).length;
}

async function capacityOf(client: DataClient, type: string) {
  const rows = await listAll((nextToken) => client.models.ServiceSlot.list({
    filter: { serviceType: { eq: type } }, limit: 1000, nextToken,
  }));
  const saved = rows.find((r) => (r.capacity ?? 0) > 0)?.capacity;
  return saved ?? CAPACITY[type] ?? DEFAULT_CAPACITY;
}

export type PublicDate = {
  id: string; date: string; time: string; location?: string;
  capacity: number; closesOn?: string; cancelled?: boolean;
};

/** The public baptism date held in an Announcement, or null. */
export function readPublicDate(a: { id: string; audience?: string | null; media?: unknown } | null | undefined): PublicDate | null {
  if (a?.audience !== PUBLIC_BAPTISM_AUDIENCE) return null;
  const b = parseJson(a.media).baptism;
  return b?.date ? { ...b, id: a.id, capacity: Number(b.capacity) || 0 } : null;
}

/** True when the date and time are an announced public baptism, so private bookings stay off it. */
async function isAnnouncedDate(client: DataClient, date: string, time: string) {
  const rows = await listAll((nextToken) => client.models.Announcement.list({
    filter: { audience: { eq: PUBLIC_BAPTISM_AUDIENCE } }, limit: 1000, nextToken,
  }));
  return rows.some((a) => {
    const d = readPublicDate(a);
    return !!d && a.published !== false && !d.cancelled && d.date === date && minutes(d.time) === minutes(time);
  });
}

/** Why this slot can't be booked, or '' when it can. excludeId: the booking being moved. */
export async function slotProblem(client: DataClient, type: string, date: string, time: string, excludeId?: string) {
  if (type === 'Baptism' && await isAnnouncedDate(client, date, time)) {
    return 'That date and time is a public baptism. Please choose Public Baptism or another time.';
  }
  const taken = await seatsTaken(client, type, date, time, excludeId);
  return taken >= await capacityOf(client, type) ? 'Sorry, that slot was just taken. Please pick another time.' : '';
}
