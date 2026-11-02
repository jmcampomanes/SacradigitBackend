import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitServerApplication';
import { callerOf, must, ok, parseJson, refuse, text } from '../shared/parish';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

/** Saves a Parish Server application as pending. Only the fields an applicant fills in are read. */
export const handler: Schema['submitServerApplication']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');

  try {
    const input = parseJson(event.arguments.input);
    const applicantName = text(input.applicantName, 100);
    const ministry = text(input.ministry, 100);
    const role = text(input.role, 100);
    if (!applicantName || !ministry || !role) return refuse('Please fill in your ministry and role.');

    const row = must(await client.models.ServerApplication.create({
      applicantKey: caller.sub,
      applicantName,
      email: text(input.email),
      contact: text(input.contact, 40),
      ministry,
      role,
      servingSince: text(input.servingSince, 10),
      confirmWith: text(input.confirmWith),
      message: text(input.message, 2000),
      conditions: input.conditions === undefined ? undefined : JSON.stringify(Object.values(parseJson(input.conditions))),
      isFirstTime: typeof input.isFirstTime === 'boolean' ? input.isFirstTime : undefined,
      status: 'pending',
      owner: caller.owner,
    }));
    return ok(row);
  } catch (err) {
    console.error('submitServerApplication failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
