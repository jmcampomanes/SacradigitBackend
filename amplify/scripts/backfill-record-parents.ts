/**
 * One-off: copy parents onto ParishRecord from the newest CertificateRequest
 * that links to it (details["father-name"], details["mother-name"]).
 *
 *   Dry run (default, writes nothing):
 *     ADMIN_USERNAME=... ADMIN_PASSWORD=... npx tsx amplify/scripts/backfill-record-parents.ts
 *   Apply, only after reading the dry-run report:
 *     ... npx tsx amplify/scripts/backfill-record-parents.ts --write
 *
 * Signs in as an admin or staff user against amplify_outputs.json (set
 * AMPLIFY_OUTPUTS to use amplify_outputs.sandbox.json instead). Only fills
 * fatherName / motherName when they are empty on the record. Marriage records
 * are skipped: the groom's and bride's parents don't map to one person.
 */
import { readFileSync } from 'node:fs';
import { Amplify } from 'aws-amplify';
import { signIn } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../data/resource';

const write = process.argv.includes('--write');
const outputs = JSON.parse(readFileSync(process.env.AMPLIFY_OUTPUTS || 'amplify_outputs.json', 'utf8'));
Amplify.configure(outputs);

type Name = { firstName?: string; middleName?: string; lastName?: string; extension?: string };

/** An object name as saved, or the JSON string of one. Anything else can't be placed safely. */
function asName(value: unknown): Name | null {
  let v = value;
  try { while (typeof v === 'string') v = JSON.parse(v); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const n = v as Name;
  return n.firstName || n.lastName ? n : null;
}
const parse = (raw: unknown) => { try { let v = raw; while (typeof v === 'string') v = JSON.parse(v); return (v && typeof v === 'object' ? v : {}) as Record<string, unknown>; } catch { return {}; } };
const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && (v === '' || v === 'null' || v === '{}'));

async function all<T>(page: (t?: string | null) => Promise<{ data: T[]; errors?: unknown[]; nextToken?: string | null }>) {
  const out: T[] = []; let t: string | null | undefined;
  do { const r = await page(t); if (r.errors?.length) throw new Error(JSON.stringify(r.errors)); out.push(...r.data); t = r.nextToken; } while (t);
  return out;
}

async function main() {
  await signIn({ username: process.env.ADMIN_USERNAME!, password: process.env.ADMIN_PASSWORD! });
  const client = generateClient<Schema>({ authMode: 'userPool' });

  const records = await all((nextToken) => client.models.ParishRecord.list({ limit: 1000, nextToken }));
  const requests = await all((nextToken) => client.models.CertificateRequest.list({ limit: 1000, nextToken }));

  const newest = new Map<string, (typeof requests)[number]>();
  for (const r of requests) {
    if (!r.linkedRecordId) continue;
    const cur = newest.get(r.linkedRecordId);
    if (!cur || String(r.createdAt) > String(cur.createdAt)) newest.set(r.linkedRecordId, r);
  }

  const report = { wouldUpdate: 0, skippedMarriage: 0, alreadyHasParents: 0, noRequest: 0, noParentsInRequest: 0, unreadable: 0 };
  for (const rec of records) {
    if (rec.type === 'marriage') { report.skippedMarriage++; continue; }
    if (!isEmpty(rec.fatherName) || !isEmpty(rec.motherName)) { report.alreadyHasParents++; continue; }
    const req = newest.get(rec.id);
    if (!req) { report.noRequest++; continue; }
    const details = parse(req.details);
    const rawF = details['father-name'], rawM = details['mother-name'];
    if (isEmpty(rawF) && isEmpty(rawM)) { report.noParentsInRequest++; continue; }
    const father = isEmpty(rawF) ? null : asName(rawF);
    const mother = isEmpty(rawM) ? null : asName(rawM);
    if (!father && !mother) { report.unreadable++; console.log(`UNREADABLE ${rec.id} (${rec.fullName}):`, rawF, rawM); continue; }

    report.wouldUpdate++;
    console.log(`${write ? 'UPDATE' : 'WOULD UPDATE'} ${rec.id} (${rec.fullName}) from request ${req.id}`, { father, mother });
    if (write) {
      const res = await client.models.ParishRecord.update({
        id: rec.id,
        ...(father ? { fatherName: JSON.stringify(father) } : {}),
        ...(mother ? { motherName: JSON.stringify(mother) } : {}),
      });
      if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
    }
  }
  console.log(write ? '\nApplied.' : '\nDry run only. Nothing was written.', report);
}

main().catch((e) => { console.error(e); process.exit(1); });
