import db from '../db/client';
import { signTransaction, isNetworkError } from './tse';
import { buildTab } from '../db/helpers';
import { broadcast } from '../ws/server';

export function startRetryLoop(): void {
  // No-op in mock mode — offline tabs can't exist there
  if (!process.env.FISKALY_API_KEY) return;

  setInterval(async () => {
    const pending = db.prepare("SELECT * FROM tabs WHERE tse_status = 'offline'").all() as any[];
    if (pending.length === 0) return;

    console.log(`[tse] retrying ${pending.length} offline transaction(s)…`);

    for (const tab of pending) {
      try {
        const result = await signTransaction({
          payment_method: tab.payment_method as 'cash' | 'card',
          subtotal_standard_cents: tab.subtotal_standard_cents ?? 0,
          subtotal_reduced_cents: tab.subtotal_reduced_cents ?? 0,
          tip_cents: tab.tip_cents ?? 0,
          total_cents: tab.total_cents ?? 0,
        });

        db.prepare(`
          UPDATE tabs SET
            tse_signature = ?,
            tse_timestamp = ?,
            tse_transaction_number = ?,
            tse_status = 'ok'
          WHERE id = ?
        `).run(result.tse_signature, result.tse_timestamp, result.tse_transaction_number, tab.id);

        console.log(`[tse] retroactively signed tab ${tab.id} (${tab.customer_name}), tx=${result.tse_transaction_number}`);

        const updatedTab = buildTab(tab.id);
        if (updatedTab) broadcast({ type: 'tab:tse_signed', data: updatedTab });
      } catch (e: any) {
        if (!isNetworkError(e)) {
          console.error(`[tse] retry failed for tab ${tab.id}:`, e.message);
        }
        // network still down — silently retry next interval
      }
    }
  }, 30_000);
}
