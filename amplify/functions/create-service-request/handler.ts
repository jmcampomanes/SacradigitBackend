import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/createServiceRequest';
import { accountOf, callerOf, isoDate, manilaDate, must, ok, parishRules, parseJson, refuse, text, type Account, type Details } from '../shared/parish';
import { PUBLIC_DATE_KEY, TEMP_KEY, readPublicDate, seatsTaken, slotProblem } from '../shared/slots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const BLESSINGS = new Set(['House Blessing', 'Vehicle / Item Blessing', 'Business Dedication', 'Pet Blessing']);
const MIN_MARRYING_AGE = 18;

// The frontend's wedding-rules.js: first and last name match, middle names and extensions ignored.
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

function samePerson(accountName: string, person: Details | undefined) {
  const words = norm(accountName).split(' ');
  return !!person?.firstName && !!person?.lastName
    && norm(person.firstName).split(' ').every((w) => words.includes(w))
    && norm(person.lastName).split(' ').every((w) => words.includes(w));
}

function ageOn(birth: string, on: string) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function weddingProblem(details: Details, date: string, account: Account) {
  if (!samePerson(account.name, details["Groom's Full Name"]) && !samePerson(account.name, details["Bride's Full Name"])) {
    return 'The name on your account must match the groom or the bride.';
  }
  const births = [details["Groom's Birthdate"], details["Bride's Birthdate"]].map(isoDate);
  if (births.some((b) => !b)) return 'Please enter the birthdates of the groom and the bride.';
  if (births.some((b) => ageOn(b, date) < MIN_MARRYING_AGE)) return `The groom and the bride must both be at least ${MIN_MARRYING_AGE} on the wedding date.`;
  return '';
}

/** A public baptism takes its date, time and place from the announcement, not the browser. */
async function publicDateProblem(dateId: string) {
  const res = await client.models.Announcement.get({ id: dateId });
  if (res.errors?.length) throw new Error(JSON.stringify(res.errors));
  const announced = readPublicDate(res.data);
  if (!announced || announced.cancelled) return { error: 'That public baptism date is no longer open. Please pick another date.' };
  if (announced.closesOn && manilaDate() > announced.closesOn) return { error: 'Registration for that date has closed. Please pick another date.' };
  const taken = await seatsTaken(client, 'Baptism', announced.date, announced.time);
  if (taken >= announced.capacity) return { error: 'Sorry, that date just filled up. Please pick another date.' };
  return { announced };
}

/** Creates a Blessing for the caller. The status is always pending: the office approves everything. */
export const handler: Schema['createServiceRequest']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');

  try {
    const input = parseJson(event.arguments.input);
    const details = parseJson(input.details);
    delete details[TEMP_KEY];

    const type = text(input.type, 100);
    let date = isoDate(input.date ?? input.preferredDate);
    let time = text(input.time, 20);
    let location = text(input.location);
    if (!type) return refuse('Please choose a service.');

    const dateId = type === 'Baptism' ? text(details[PUBLIC_DATE_KEY]) : '';
    if (!dateId) delete details[PUBLIC_DATE_KEY];
    if (type === 'Baptism' && details['Baptism Type'] === 'Public' && !dateId) return refuse('Please pick a public baptism date.');

    if (dateId) {
      const { error, announced } = await publicDateProblem(dateId);
      if (!announced) return refuse(error!);
      date = announced.date;
      time = announced.time;
      location = announced.location || location;
    } else {
      if (!date || !time) return refuse('Please pick a date and time.');
      const problem = await slotProblem(client, type, date, time);
      if (problem) return refuse(problem);
    }

    if (BLESSINGS.has(type)) {
      const { fees } = await parishRules(client);
      if (!(Number(details['Offered Amount']) >= fees.blessingMin)) return refuse(`The minimum offering is ₱${fees.blessingMin}.`);
    }

    const account = await accountOf(caller);
    if (type === 'Wedding') {
      const problem = weddingProblem(details, date, account);
      if (problem) return refuse(problem);
    }

    const row = must(await client.models.Blessing.create({
      requesterName: account.name,
      type,
      email: account.email || text(input.email),
      contact: text(input.contact, 40),
      notes: text(input.notes, 2000),
      details: JSON.stringify(details),
      location,
      preferredDate: date,
      date,
      time,
      status: 'pending',
      owner: caller.owner,
    }));
    return ok(row);
  } catch (err) {
    console.error('createServiceRequest failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
