import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/volunteerForSlot';
import { accountOf, approvedFor, callerOf, isoDate, listAll, manilaDate, must, ok, parishRules, refuse, text } from '../shared/parish';
import { minutes } from '../shared/slots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

// perMass in the frontend's shared/js/ministry.js.
const ROOM: Record<string, number> = { lector: 2, choir: 6, 'altar-server': 3, usher: 4 };

/** Puts the caller on a Mass, if they're approved for that ministry and it has room. */
export const handler: Schema['volunteerForSlot']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { ministry, massDate, massTime, massTitle } = event.arguments;

  try {
    const date = isoDate(massDate);
    if (!date || !ROOM[ministry]) return refuse('That Mass isn’t available.');
    if (!await approvedFor(client, caller.sub, ministry)) return refuse('You need an approved Parish Server application for this ministry.');

    const { serverSignupCloseDays } = await parishRules(client);
    if (manilaDate(serverSignupCloseDays) > date) return refuse(`Sign-ups close ${serverSignupCloseDays} days before the Mass.`);

    const signups = (await listAll((nextToken) => client.models.MinistrySignup.list({
      filter: { ministry: { eq: ministry }, massDate: { eq: date } }, limit: 1000, nextToken,
    }))).filter((s) => minutes(s.massTime) === minutes(massTime));
    if (signups.some((s) => s.volunteerId === caller.sub)) return refuse('You’re already signed up for this Mass.');
    if (signups.length >= ROOM[ministry]) return refuse('This Mass is already full for that ministry.');

    const { name } = await accountOf(caller);
    return ok(must(await client.models.MinistrySignup.create({
      ministry,
      massDate: date,
      massTime: text(massTime, 20),
      massTitle: text(massTitle),
      volunteerId: caller.sub,
      volunteerName: name,
      swapRequested: false,
    })));
  } catch (err) {
    console.error('volunteerForSlot failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
