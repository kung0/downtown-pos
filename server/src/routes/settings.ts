import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db/client';
import type { Settings } from '@downtown/shared';

const router = Router();

const NUMERIC_KEYS: (keyof Settings)[] = [
  'pool_rate_standard_cents',
  'pool_rate_peak_cents',
  'pool_rate_daytime_discount_cents',
  'dart_hourly_rate_cents',
];

const DEFAULTS: Settings = {
  pool_rate_standard_cents: 1200,
  pool_rate_peak_cents: 1600,
  pool_rate_daytime_discount_cents: 400,
  dart_hourly_rate_cents: 800,
  printer_ip: '',
  printer_auto_print: false,
};

function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    pool_rate_standard_cents:         Number(map.pool_rate_standard_cents)         || DEFAULTS.pool_rate_standard_cents,
    pool_rate_peak_cents:             Number(map.pool_rate_peak_cents)             || DEFAULTS.pool_rate_peak_cents,
    pool_rate_daytime_discount_cents: Number(map.pool_rate_daytime_discount_cents) || DEFAULTS.pool_rate_daytime_discount_cents,
    dart_hourly_rate_cents:           Number(map.dart_hourly_rate_cents)           || DEFAULTS.dart_hourly_rate_cents,
    printer_ip:                       map.printer_ip ?? '',
    printer_auto_print:               map.printer_auto_print === '1',
  };
}

// GET /api/settings
router.get('/', (_req: Request, res: Response) => {
  res.json(getSettings());
});

// PATCH /api/settings
router.patch('/', (req: Request, res: Response) => {
  const body = req.body as Partial<Record<keyof Settings, unknown>>;
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const run = db.transaction(() => {
    for (const key of NUMERIC_KEYS) {
      if (key in body) {
        const val = Number(body[key]);
        if (!Number.isInteger(val) || val < 0) throw new Error(`invalid value for ${key}`);
        upsert.run(key, String(val));
      }
    }
    if ('printer_ip' in body) {
      const val = String(body.printer_ip ?? '').trim();
      upsert.run('printer_ip', val);
    }
    if ('printer_auto_print' in body) {
      upsert.run('printer_auto_print', body.printer_auto_print ? '1' : '0');
    }
  });

  try {
    run();
    res.json(getSettings());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
