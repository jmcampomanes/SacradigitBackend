import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/submitServicePayment';
import { callerOf, manilaDate, must, ok, ownsRow, parseJson, refuse, text } from '../shared/parish';
import { TEMP_KEY } from '../shared/slots';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

/** Records the owner's payment. The amount comes from the office's approval, never the browser. */
export const handler: Schema['submitServicePayment']['functionHandler'] = async (event) => {
  const caller = callerOf(event.identity);
  if (!caller) return refuse('Please sign in again.');
  const { requestId, method, referenceNumber } = event.arguments;

  try {
    const found = await client.models.Blessing.get({ id: requestId });
    if (found.errors?.length) throw new Error(JSON.stringify(found.errors));
    const row = found.data;
    if (!row || !ownsRow(row, caller)) return refuse('We couldn’t find that request.');
    if (row.status !== 'temporary-approval') return refuse('This request isn’t waiting for a payment.');

    const approval = parseJson(row.details)[TEMP_KEY];
    const amount = Number(approval?.amount);
    if (!(amount > 0)) return refuse('The parish office hasn’t set the amount yet.');
    if (approval.deadline && manilaDate() > approval.deadline) return refuse('The payment deadline has passed. Please contact the parish office.');

    const payment = must(await client.models.PaymentRecord.create({
      requestType: 'Service',
      requestId,
      payerName: row.requesterName,
      amount,
      method: text(method, 40),
      referenceNumber: text(referenceNumber, 60),
      status: 'submitted',
      owner: caller.owner,
    }));

    const updated = await client.models.Blessing.update({ id: requestId, status: 'payment-submitted' });
    if (updated.errors?.length || !updated.data) {
      await client.models.PaymentRecord.delete({ id: payment.id });
      throw new Error(JSON.stringify(updated.errors));
    }
    return ok(updated.data);
  } catch (err) {
    console.error('submitServicePayment failed', err);
    return refuse('That didn’t save. Please try again.');
  }
};
