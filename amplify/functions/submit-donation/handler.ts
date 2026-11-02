import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitDonation';
import { accountOf, callerOf, isoDate, listAll, manilaDate, must, ok, refuse, text } from '../shared/parish';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

/** Saves a gift as submitted, for the office to verify, with its PaymentRecord. */
export const handler: Schema['submitDonation']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { amount, method, purpose, date, anonymous, referenceNumber } = event.arguments;

  try {
    if (!(amount > 0)) return refuse('Please enter an amount.');
    const fund = text(purpose);

    if (fund) {
      const goals = await listAll((nextToken) => client.models.DonationGoal.list({
        filter: { name: { eq: fund } }, limit: 1000, nextToken,
      }));
      if (goals.some((g) => g.active === false)) return refuse('That fund is closed. Please choose another.');
    }

    const { name } = await accountOf(caller);
    const donation = must(await client.models.Donation.create({
      donor: name,
      amount,
      method: text(method, 40),
      purpose: fund,
      date: isoDate(date) || manilaDate(),
      anonymous: !!anonymous,
      status: 'submitted',
      referenceNumber: text(referenceNumber, 60),
      owner: caller.owner,
    }));

    const payment = await client.models.PaymentRecord.create({
      requestType: 'Donation',
      requestId: donation.id,
      payerName: name,
      amount,
      method: text(method, 40),
      referenceNumber: text(referenceNumber, 60),
      status: 'submitted',
      owner: caller.owner,
    });
    if (payment.errors?.length || !payment.data) {
      await client.models.Donation.delete({ id: donation.id });
      throw new Error(JSON.stringify(payment.errors));
    }
    return ok(donation);
  } catch (err) {
    console.error('submitDonation failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
