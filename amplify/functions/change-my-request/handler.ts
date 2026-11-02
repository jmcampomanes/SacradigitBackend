import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/changeMyRequest';
import { callerOf, isoDate, manilaDate, must, ok, ownsRow, parishRules, parseJson, refuse, text } from '../shared/parish';
import { slotProblem } from '../shared/slots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

const ACTIVE = new Set(['pending', 'temporary-approval', 'payment-submitted', 'scheduled']);

// detailsWithRescheduleReason() in the frontend's shared/js/service-schedule.js.
const onToday = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

/** The owner cancels, reschedules, or changes the reminder choice on their own request. */
export const handler: Schema['changeMyRequest']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { id, action, date, time, reason, reminder } = event.arguments;

  try {
    const found = await client.models.Blessing.get({ id });
    if (found.errors?.length) throw new Error(JSON.stringify(found.errors));
    const row = found.data;
    if (!row || !ownsRow(row, caller)) return refuse('We couldn’t find that request.');
    const details = parseJson(row.details);

    if (action === 'set-reminder') {
      details['Day-before reminder'] = text(reminder, 40);
      return ok(must(await client.models.Blessing.update({ id, details: JSON.stringify(details) })));
    }

    if (!ACTIVE.has(row.status ?? '')) return refuse('This request can no longer be changed.');

    if (action === 'cancel') {
      const rules = await parishRules(client);
      const on = row.date || row.preferredDate;
      if (on && manilaDate(rules.freeCancelDays) > on) {
        return refuse(`You can cancel in the app until ${rules.freeCancelDays} days before the date. After that, please call or visit the parish office.`);
      }
      return ok(must(await client.models.Blessing.update({
        id, status: 'declined', declineReason: 'Cancelled by the parishioner.',
      })));
    }

    if (action === 'reschedule') {
      if (details['Baptism Type'] === 'Public') return refuse('A public baptism date can’t be moved. Please contact the parish office.');
      const newDate = isoDate(date);
      const newTime = text(time, 20);
      const why = text(reason, 300);
      if (!newDate || !newTime) return refuse('Please pick a new date and time.');
      if (newDate < manilaDate()) return refuse('Please pick a date that hasn’t passed.');
      if (!why) return refuse('Please say why you need to reschedule.');
      const problem = await slotProblem(client, row.type, newDate, newTime, id);
      if (problem) return refuse(problem);

      details['Reschedule Reason'] = `${why} — by ${row.requesterName || 'Parishioner'} on ${onToday()}`;
      return ok(must(await client.models.Blessing.update({
        id, preferredDate: newDate, date: newDate, time: newTime, details: JSON.stringify(details),
      })));
    }

    return refuse('That change isn’t available.');
  } catch (err) {
    console.error('changeMyRequest failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
