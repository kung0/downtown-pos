import { Router } from 'express';
import type { Request, Response } from 'express';
import archiver from 'archiver';
import db from '../db/client';
import { getSettings } from './settings';
import {
  buildIndexXml,
  buildKassenabschluss,
  buildZGvTyp,
  buildZZahlarten,
  buildZWarengruppen,
  buildBonkopf,
  buildBonpos,
  type ZRecord,
  type DsfTab,
  type DsfSession,
} from '../services/dsfinvk';

const router = Router();

// Mirrors the Berlin-day-boundary logic from reports.ts so date ranges are consistent.
function berlinDayStartUtc(year: number, month: number, day: number): Date {
  const mm = String(month).padStart(2, '0'), dd = String(day).padStart(2, '0');
  const guess = new Date(`${year}-${mm}-${dd}T00:00:00+01:00`);
  const actualHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(guess),
    10,
  );
  return new Date(guess.getTime() - actualHour * 3_600_000);
}

function berlinDayRangeUtc(dateStr: string): [string, string] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = berlinDayStartUtc(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  const [ny, nm, nd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(next).split('-').map(Number);
  const end = berlinDayStartUtc(ny, nm, nd);
  return [start.toISOString(), end.toISOString()];
}

// GET /api/export/dsfinvk?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/dsfinvk', (req: Request, res: Response) => {
  const from = (req.query.from as string) ?? '';
  const to   = (req.query.to   as string) ?? '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: 'from must not be after to' });
    return;
  }

  const [startUtc] = berlinDayRangeUtc(from);
  const [, endUtc] = berlinDayRangeUtc(to);

  // Fetch closed tabs in the date range with their line items + product category
  const tabRows = db.prepare(`
    SELECT t.*,
           COALESCE(t.subtotal_standard_cents, 0) AS subtotal_standard_cents,
           COALESCE(t.subtotal_reduced_cents,  0) AS subtotal_reduced_cents,
           COALESCE(t.tax_standard_cents,      0) AS tax_standard_cents,
           COALESCE(t.tax_reduced_cents,       0) AS tax_reduced_cents,
           COALESCE(t.subtotal_cents,          0) AS subtotal_cents,
           COALESCE(t.total_cents,             0) AS total_cents
    FROM tabs t
    WHERE t.status IN ('closed', 'voided')
      AND t.closed_at >= ? AND t.closed_at < ?
    ORDER BY t.closed_at ASC
  `).all(startUtc, endUtc) as any[];

  if (tabRows.length === 0) {
    res.status(404).json({ error: 'Keine abgeschlossenen Bons im gewählten Zeitraum' });
    return;
  }

  const tabIds = tabRows.map((t: any) => t.id as number);

  const itemRows = tabIds.length === 0 ? [] : db.prepare(`
    SELECT li.*, COALESCE(p.category, 'Billiard') AS category
    FROM line_items li
    LEFT JOIN products p ON p.id = li.product_id
    WHERE li.tab_id IN (${tabIds.map(() => '?').join(',')})
    ORDER BY li.tab_id, li.created_at ASC
  `).all(...tabIds) as any[];

  // Group items by tab
  const itemsByTab = new Map<number, any[]>();
  for (const item of itemRows) {
    const arr = itemsByTab.get(item.tab_id) ?? [];
    arr.push(item);
    itemsByTab.set(item.tab_id, arr);
  }

  // Build DsfTab objects
  const dsfTabs: DsfTab[] = tabRows.map((t: any) => ({
    id: t.id,
    customer_name: t.customer_name,
    status: t.status,
    opened_at: t.opened_at,
    closed_at: t.closed_at,
    payment_method: t.payment_method,
    subtotal_cents: t.subtotal_cents,
    subtotal_standard_cents: t.subtotal_standard_cents,
    subtotal_reduced_cents: t.subtotal_reduced_cents,
    tax_standard_cents: t.tax_standard_cents,
    tax_reduced_cents: t.tax_reduced_cents,
    tip_cents: t.tip_cents ?? 0,
    total_cents: t.total_cents,
    session_id: t.session_id,
    items: (itemsByTab.get(t.id) ?? []).map((i: any) => ({
      tab_id: i.tab_id,
      name_snapshot: i.name_snapshot,
      price_snapshot_cents: i.price_snapshot_cents,
      tax_category_snapshot: i.tax_category_snapshot,
      quantity: i.quantity,
      kind: i.kind,
      category: i.category,
    })),
  }));

  // Group tabs by session_id; tabs with no session get virtual Z_NR=0
  const sessionIds = [...new Set(dsfTabs.map(t => t.session_id).filter((id): id is number => id !== null))];
  const sessionRows: DsfSession[] = sessionIds.length > 0
    ? (db.prepare(`SELECT * FROM sessions WHERE id IN (${sessionIds.map(() => '?').join(',')})`).all(...sessionIds) as any[])
    : [];

  const sessionMap = new Map<number, DsfSession>(sessionRows.map(s => [s.id, s]));

  // Virtual session for orphan tabs (session_id = null)
  const orphanTabs = dsfTabs.filter(t => t.session_id === null);
  const zRecords: ZRecord[] = [];

  for (const id of sessionIds) {
    const session = sessionMap.get(id);
    if (!session) continue;
    zRecords.push({ session, tabs: dsfTabs.filter(t => t.session_id === id) });
  }

  if (orphanTabs.length > 0) {
    zRecords.push({
      session: { id: 0, opened_at: startUtc, closed_at: endUtc },
      tabs: orphanTabs,
    });
  }

  // Sort Z-records by session opened_at
  zRecords.sort((a, b) => a.session.opened_at.localeCompare(b.session.opened_at));

  const config = getSettings();
  const now    = new Date().toISOString();

  const indexXml        = buildIndexXml(from, to, now, config);
  const kassenabschluss = buildKassenabschluss(zRecords, now, config);
  const zGvTyp          = buildZGvTyp(zRecords, now, config);
  const zZahlarten      = buildZZahlarten(zRecords, now, config);
  const zWarengruppen   = buildZWarengruppen(zRecords, now, config);
  const bonkopf         = buildBonkopf(zRecords, now, config);
  const bonpos          = buildBonpos(zRecords, now, config);

  const filename = `dsfinvk_${from}_${to}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { throw err; });
  archive.pipe(res);

  archive.append(indexXml,        { name: 'index.xml' });
  archive.append(kassenabschluss, { name: 'Kassenabschluss.csv' });
  archive.append(zGvTyp,          { name: 'Z_GV_TYP.csv' });
  archive.append(zZahlarten,      { name: 'Z_ZAHLARTEN.csv' });
  archive.append(zWarengruppen,   { name: 'Z_WARENGRUPPEN.csv' });
  archive.append(bonkopf,         { name: 'Bonkopf.csv' });
  archive.append(bonpos,          { name: 'Bonpos.csv' });

  archive.finalize();
});

export default router;
