/* The name rules for verifyRecord. No AWS imports, so they can be tested alone. */

/**
 * Lowercase and single-spaced, with accents dropped (so a missing ñ still
 * matches) and "Ma." read as Maria, the flaws older entries contain.
 */
export function normalizeName(name: unknown): string {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(^|\s)ma\.(?=\s|$)/g, '$1maria')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RecordType = 'baptism' | 'confirmation' | 'marriage' | 'death';

/** ParishRecord.type for a certificate's display name. First Communion has none. */
export function recordTypeOf(certificateType: string): RecordType | null {
  if (/marriage/i.test(certificateType)) return 'marriage';
  if (/baptis/i.test(certificateType)) return 'baptism';
  if (/confirmation/i.test(certificateType)) return 'confirmation';
  if (/death|burial/i.test(certificateType)) return 'death';
  return null;
}

/** Lowercase, accent-free, letters only: the lookup keys MockParishioner is indexed by. */
export const lookupKey = (s: unknown): string => normalizeName(s).replace(/[^a-z]/g, '');

/**
 * The (first, last) pairs worth querying MockParishioner with for a typed full name.
 * Surnames can be several words ("San Jose") and an extension may trail the name,
 * so the last one to three words are each tried as the surname.
 */
export function surnameGuesses(fullName: string): { firstKey: string; lastKey: string }[] {
  const words = normalizeName(fullName).split(' ').filter(Boolean);
  if (words.length < 2) return [];
  const out: { firstKey: string; lastKey: string }[] = [];
  for (let n = 1; n <= Math.min(3, words.length - 1); n++) {
    for (const skipExt of [0, 1]) {
      const end = words.length - skipExt;
      if (end - n < 1) continue;
      const last = lookupKey(words.slice(end - n, end).join(' '));
      if (last) out.push({ firstKey: lookupKey(words[0]), lastKey: last });
    }
  }
  return out.filter((g, i) => out.findIndex(o => o.lastKey === g.lastKey) === i);
}

type MockName = { firstName: string; middleName?: string | null; lastName: string; extension?: string | null };
const fullNameOf = (n: MockName) => normalizeName([n.firstName, n.middleName, n.lastName, n.extension].filter(Boolean).join(' '));

/**
 * The register entry of a MockParishioner row (the data the admin autofill uses)
 * that matches what a parishioner typed: the name as the register holds it (a
 * married woman under her maiden surname) or as she uses it now, the birthdate,
 * and the entry of this type on this date.
 */
export function mockRecordFor(
  row: MockName & { maidenLastName?: string | null; birthDate?: string | null; sacraments?: unknown },
  asked: { type: RecordType | null; fullName: string; birthdate: string },
  eventDate: string,
): { recordId: string; date: string; officiant?: string | null } | null {
  if (!asked.type || !asked.fullName || !row.birthDate || row.birthDate !== asked.birthdate) return null;
  const names = [fullNameOf(row), fullNameOf({ ...row, lastName: row.maidenLastName || row.lastName })];
  if (!names.includes(asked.fullName)) return null;
  let sacraments: any = row.sacraments;
  if (typeof sacraments === 'string') { try { sacraments = JSON.parse(sacraments); } catch { sacraments = null; } }
  const entry = (sacraments?.parishRecords || []).find((r: any) => r.type === asked.type && r.date === eventDate && r.recordId);
  return entry ? { recordId: entry.recordId, date: entry.date, officiant: entry.officiant } : null;
}

type Asked = { type: RecordType | null; fullName: string; birthdate: string; groomName: string; brideName: string };

/** The date of the event is already compared by the query. Names are normalized by the caller. */
export function recordMatches(record: { fullName: string; birthdate?: string | null }, asked: Asked): boolean {
  if (asked.type === 'marriage') {
    const names = record.fullName.split('&').map(normalizeName);
    return names.length === 2 && !!asked.groomName && !!asked.brideName
      && names[0] === asked.groomName && names[1] === asked.brideName;
  }
  return !!record.birthdate && !!asked.fullName
    && normalizeName(record.fullName) === asked.fullName
    && record.birthdate === asked.birthdate;
}
