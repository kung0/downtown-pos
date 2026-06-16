import { broadcast } from './server';
import db from '../db/client';
import { runningCostCents } from '../services/poolPricing';
import type { TableType } from '@downtown/shared';

const activeTickers = new Map<number, NodeJS.Timeout>();

export function startTicker(
  sessionId: number,
  tableId: number,
  startedAt: Date,
  hourlyRateCents: number
): void {
  stopTicker(sessionId);

  const tableType = ((db.prepare('SELECT type FROM pool_tables WHERE id = ?').get(tableId) as any)
    ?.type ?? 'billiard') as TableType;

  const interval = setInterval(() => {
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    broadcast({
      type: 'pool:tick',
      data: {
        table_id: tableId,
        session_id: sessionId,
        elapsed_seconds: elapsed,
        running_cost_cents: runningCostCents(tableType, startedAt, hourlyRateCents, now),
      },
    });
  }, 1000);

  activeTickers.set(sessionId, interval);
}

export function stopTicker(sessionId: number): void {
  const t = activeTickers.get(sessionId);
  if (t) {
    clearInterval(t);
    activeTickers.delete(sessionId);
  }
}

export function resumeActiveTickers(): void {
  const sessions = db.prepare(
    'SELECT * FROM billiard_sessions WHERE ended_at IS NULL'
  ).all() as any[];

  for (const s of sessions) {
    startTicker(s.id, s.pool_table_id, new Date(s.started_at), s.hourly_rate_snapshot_cents);
  }

  if (sessions.length > 0) {
    console.log(`  resumed ${sessions.length} active billiard ticker(s)`);
  }
}
