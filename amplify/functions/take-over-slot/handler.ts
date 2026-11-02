import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/takeOverSlot';
import { accountOf, approvedFor, callerOf, manilaDate, must, ok, refuse } from '../shared/parish';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

/** Moves a slot marked for swap to the caller, if they're approved for that ministry. */
export const handler: Schema['takeOverSlot']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { id } = event.arguments;

  try {
    const found = await client.models.MinistrySignup.get({ id });
    if (found.errors?.length) throw new Error(JSON.stringify(found.errors));
    const signup = found.data;
    if (!signup?.swapRequested) return refuse('That slot isn’t open for a swap.');
    if (signup.massDate < manilaDate()) return refuse('This Mass has already passed.');
    if (!await approvedFor(client, caller.sub, signup.ministry)) return refuse('You need an approved Parish Server application for this ministry.');

    const { name } = await accountOf(caller);
    return ok(must(await client.models.MinistrySignup.update({
      id, volunteerId: caller.sub, volunteerName: name, swapRequested: false,
    })));
  } catch (err) {
    console.error('takeOverSlot failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
