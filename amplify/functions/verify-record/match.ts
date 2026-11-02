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
