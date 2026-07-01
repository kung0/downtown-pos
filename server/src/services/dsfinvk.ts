import type { Settings } from '@downtown/shared';

// ─── Internal data shapes ────────────────────────────────────────────────────

export interface DsfLineItem {
  tab_id: number;
  name_snapshot: string;
  price_snapshot_cents: number;
  tax_category_snapshot: 'standard' | 'reduced';
  quantity: number;
  kind: string;
  category: string | null; // resolved from product join
}

export interface DsfTab {
  id: number;
  customer_name: string;
  status: string;
  opened_at: string;
  closed_at: string;
  payment_method: string | null;
  subtotal_cents: number;
  subtotal_standard_cents: number;
  subtotal_reduced_cents: number;
  tax_standard_cents: number;
  tax_reduced_cents: number;
  tip_cents: number;
  total_cents: number;
  session_id: number | null;
  items: DsfLineItem[];
}

export interface DsfSession {
  id: number;
  opened_at: string;
  closed_at: string | null;
}

export interface ZRecord {
  session: DsfSession;
  tabs: DsfTab[];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const EUR = (cents: number) => (cents / 100).toFixed(2);

const UST_PCT: Record<1 | 2 | 3, string> = { 1: '19.00', 2: '7.00', 3: '0.00' };

function taxKey(cat: 'standard' | 'reduced'): 1 | 2 {
  return cat === 'reduced' ? 2 : 1;
}

// ─── CSV serialiser ───────────────────────────────────────────────────────────

type Row = Record<string, string | number>;

function csvField(v: string | number): string {
  const s = String(v);
  return s.includes(';') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCsv(headers: string[], rows: Row[]): string {
  const lines = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => csvField(r[h] ?? '')).join(';')),
  ];
  // UTF-8 BOM + CRLF — required for Excel / German auditor tools
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ─── index.xml ───────────────────────────────────────────────────────────────

export function buildIndexXml(from: string, to: string, now: string, config: Settings): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DSFinV_K version="2.5">',
    `  <Exportzeitraum>`,
    `    <Anfang>${from}</Anfang>`,
    `    <Ende>${to}</Ende>`,
    `    <Erstellungszeitpunkt>${now}</Erstellungszeitpunkt>`,
    `  </Exportzeitraum>`,
    `  <Kassensystem>`,
    `    <Name>Downtown POS</Name>`,
    `    <Version>1.0</Version>`,
    `    <KassenId>${config.dsfinvk_kassen_id}</KassenId>`,
    `  </Kassensystem>`,
    `  <Dateien>`,
    `    <Datei name="Kassenabschluss.csv" typ="Kassenabschluss" />`,
    `    <Datei name="Z_GV_TYP.csv" typ="Z_GV_TYP" />`,
    `    <Datei name="Z_ZAHLARTEN.csv" typ="Z_ZAHLARTEN" />`,
    `    <Datei name="Z_WARENGRUPPEN.csv" typ="Z_WARENGRUPPEN" />`,
    `    <Datei name="Bonkopf.csv" typ="Bonkopf" />`,
    `    <Datei name="Bonpos.csv" typ="Bonpos" />`,
    `  </Dateien>`,
    '</DSFinV_K>',
  ].join('\n');
}

// ─── Kassenabschluss.csv ─────────────────────────────────────────────────────

const KA_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'Z_ANFANG', 'Z_ENDE',
  'NAME', 'STRASSE', 'PLZ', 'ORT', 'LAND', 'STNR', 'USTID',
];

export function buildKassenabschluss(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = zRecords.map(({ session }) => ({
    Z_KASSE_ID:        config.dsfinvk_kassen_id,
    Z_ERSTELLUNGSDATUM: now,
    Z_NR:              session.id,
    Z_ANFANG:          session.opened_at,
    Z_ENDE:            session.closed_at ?? now,
    NAME:              config.dsfinvk_betreiber_name,
    STRASSE:           config.dsfinvk_strasse,
    PLZ:               config.dsfinvk_plz,
    ORT:               config.dsfinvk_ort,
    LAND:              config.dsfinvk_land,
    STNR:              config.dsfinvk_stnr,
    USTID:             config.dsfinvk_ustid,
  }));
  return toCsv(KA_HEADERS, rows);
}

// ─── Z_GV_TYP.csv ────────────────────────────────────────────────────────────

const ZGVT_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'GV_TYP', 'GV_NAME', 'AGENTUR_ID', 'UST_SCHLUESSEL',
  'E_UST_BRUTTO', 'BRUTTO', 'NETTO', 'UST',
  'NACHLASS_BRUTTO', 'VORSCHUSS_BRUTTO', 'MENGE', 'INHAUS',
];

export function buildZGvTyp(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = [];

  for (const { session, tabs } of zRecords) {
    const base = {
      Z_KASSE_ID: config.dsfinvk_kassen_id,
      Z_ERSTELLUNGSDATUM: now,
      Z_NR: session.id,
      AGENTUR_ID: 0,
      E_UST_BRUTTO: '0.00',
      NACHLASS_BRUTTO: '0.00',
      VORSCHUSS_BRUTTO: '0.00',
      INHAUS: 1,
    };

    // Aggregate Umsatz by UST_SCHLUESSEL across all tabs in this Z
    const umsatz: Record<1 | 2, { brutto_cents: number; ust_cents: number; menge: number }> = {
      1: { brutto_cents: 0, ust_cents: 0, menge: 0 },
      2: { brutto_cents: 0, ust_cents: 0, menge: 0 },
    };
    let tipCents = 0;

    for (const tab of tabs) {
      umsatz[1].brutto_cents += tab.subtotal_standard_cents;
      umsatz[1].ust_cents    += tab.tax_standard_cents;
      umsatz[2].brutto_cents += tab.subtotal_reduced_cents;
      umsatz[2].ust_cents    += tab.tax_reduced_cents;
      // count item quantities per key
      for (const item of tab.items) {
        umsatz[taxKey(item.tax_category_snapshot)].menge += item.quantity;
      }
      tipCents += tab.tip_cents;
    }

    for (const key of [1, 2] as const) {
      if (umsatz[key].brutto_cents === 0) continue;
      const brutto = umsatz[key].brutto_cents;
      const ust    = umsatz[key].ust_cents;
      rows.push({
        ...base,
        GV_TYP:       'Umsatz',
        GV_NAME:      'Umsatz',
        UST_SCHLUESSEL: key,
        BRUTTO:       EUR(brutto),
        NETTO:        EUR(brutto - ust),
        UST:          EUR(ust),
        MENGE:        umsatz[key].menge,
      });
    }

    if (tipCents > 0) {
      rows.push({
        ...base,
        GV_TYP:       'TrinkgeldAN',
        GV_NAME:      'Trinkgeld',
        UST_SCHLUESSEL: 3,
        BRUTTO:       EUR(tipCents),
        NETTO:        EUR(tipCents),
        UST:          '0.00',
        MENGE:        1,
      });
    }
  }

  return toCsv(ZGVT_HEADERS, rows);
}

// ─── Z_ZAHLARTEN.csv ─────────────────────────────────────────────────────────

const ZZA_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'ZAHLART_TYP', 'ZAHLART_NAME', 'ZAHLART_BETRAG',
];

export function buildZZahlarten(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = [];

  for (const { session, tabs } of zRecords) {
    const base = { Z_KASSE_ID: config.dsfinvk_kassen_id, Z_ERSTELLUNGSDATUM: now, Z_NR: session.id };
    const cashCents = tabs.filter(t => t.payment_method === 'cash').reduce((s, t) => s + t.total_cents, 0);
    const cardCents = tabs.filter(t => t.payment_method === 'card').reduce((s, t) => s + t.total_cents, 0);
    if (cashCents > 0) rows.push({ ...base, ZAHLART_TYP: 'Bar',   ZAHLART_NAME: 'Bargeld',           ZAHLART_BETRAG: EUR(cashCents) });
    if (cardCents > 0) rows.push({ ...base, ZAHLART_TYP: 'Unbar', ZAHLART_NAME: 'Kartenzahlung',     ZAHLART_BETRAG: EUR(cardCents) });
  }

  return toCsv(ZZA_HEADERS, rows);
}

// ─── Z_WARENGRUPPEN.csv ──────────────────────────────────────────────────────

const ZWG_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'WARENGRUPPE', 'UST_SCHLUESSEL', 'BRUTTO', 'NETTO', 'UST', 'ERMAESSIGUNG_BRUTTO',
];

export function buildZWarengruppen(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = [];

  for (const { session, tabs } of zRecords) {
    const base = { Z_KASSE_ID: config.dsfinvk_kassen_id, Z_ERSTELLUNGSDATUM: now, Z_NR: session.id };
    // group by (category, ust_key)
    const groups = new Map<string, { brutto_cents: number; ust_cents: number; key: 1 | 2 }>();

    for (const tab of tabs) {
      for (const item of tab.items) {
        const cat = item.kind === 'billiard' ? 'Billiard' : (item.category ?? 'Sonstige');
        const key = taxKey(item.tax_category_snapshot);
        const mapKey = `${cat}|${key}`;
        const lineTotal = item.price_snapshot_cents * item.quantity;
        const lineUst   = Math.round(lineTotal * (key === 1 ? 19 : 7) / (key === 1 ? 119 : 107));
        const entry = groups.get(mapKey) ?? { brutto_cents: 0, ust_cents: 0, key };
        entry.brutto_cents += lineTotal;
        entry.ust_cents    += lineUst;
        groups.set(mapKey, entry);
      }
    }

    for (const [mapKey, { brutto_cents, ust_cents, key }] of groups) {
      const warengruppe = mapKey.split('|')[0];
      rows.push({
        ...base,
        WARENGRUPPE:       warengruppe,
        UST_SCHLUESSEL:    key,
        BRUTTO:            EUR(brutto_cents),
        NETTO:             EUR(brutto_cents - ust_cents),
        UST:               EUR(ust_cents),
        ERMAESSIGUNG_BRUTTO: '0.00',
      });
    }
  }

  return toCsv(ZWG_HEADERS, rows);
}

// ─── Bonkopf.csv ─────────────────────────────────────────────────────────────

const BK_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'BON_NR', 'BON_TYP', 'TRAINING', 'STORNO', 'BON_STORNO',
  'BON_START', 'BON_ENDE', 'BON_DATUM',
  'AGENTUR_ID', 'KUNDEN_ID', 'KUNDEN_NAME', 'BON_NAME',
  'ZAHLART_TYP', 'ZAHLART_NAME', 'ZAHLART_BETRAG',
  'BON_UST_BRUTTO', 'BEMERKUNG',
];

export function buildBonkopf(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = [];

  for (const { session, tabs } of zRecords) {
    const base = { Z_KASSE_ID: config.dsfinvk_kassen_id, Z_ERSTELLUNGSDATUM: now, Z_NR: session.id };

    for (const tab of tabs) {
      const isVoid = tab.status === 'voided';
      rows.push({
        ...base,
        BON_NR:          tab.id,
        BON_TYP:         isVoid ? 'Storno' : 'Beleg',
        TRAINING:        0,
        STORNO:          isVoid ? 1 : 0,
        BON_STORNO:      '',
        BON_START:       tab.opened_at,
        BON_ENDE:        tab.closed_at,
        BON_DATUM:       tab.closed_at,
        AGENTUR_ID:      0,
        KUNDEN_ID:       tab.id,
        KUNDEN_NAME:     tab.customer_name,
        BON_NAME:        `Bon #${tab.id}`,
        ZAHLART_TYP:     tab.payment_method === 'cash' ? 'Bar' : 'Unbar',
        ZAHLART_NAME:    tab.payment_method === 'cash' ? 'Bargeld' : 'Kartenzahlung',
        ZAHLART_BETRAG:  EUR(tab.total_cents),
        BON_UST_BRUTTO:  EUR(tab.subtotal_cents),
        BEMERKUNG:       '',
      });
    }
  }

  return toCsv(BK_HEADERS, rows);
}

// ─── Bonpos.csv ──────────────────────────────────────────────────────────────

const BP_HEADERS = [
  'Z_KASSE_ID', 'Z_ERSTELLUNGSDATUM', 'Z_NR',
  'BON_NR', 'POS_ZEILE', 'GUTSCHEIN_ID',
  'ARTIKELTEXT', 'POS_ZEILEN_TYP', 'GV_TYP', 'GV_NAME',
  'INHAUS', 'P_MWS', 'UST_SCHLUESSEL',
  'E_UST_BRUTTO', 'BASISPREIS_BRUTTO', 'MENGE', 'FAKTOR', 'EINHEIT', 'BRUTTO',
];

export function buildBonpos(zRecords: ZRecord[], now: string, config: Settings): string {
  const rows: Row[] = [];

  for (const { session, tabs } of zRecords) {
    const base = { Z_KASSE_ID: config.dsfinvk_kassen_id, Z_ERSTELLUNGSDATUM: now, Z_NR: session.id };

    for (const tab of tabs) {
      let pos = 1;

      for (const item of tab.items) {
        const key = taxKey(item.tax_category_snapshot);
        const lineTotal = item.price_snapshot_cents * item.quantity;
        rows.push({
          ...base,
          BON_NR:           tab.id,
          POS_ZEILE:        pos++,
          GUTSCHEIN_ID:     '',
          ARTIKELTEXT:      item.name_snapshot,
          POS_ZEILEN_TYP:   'Artikel',
          GV_TYP:           'Umsatz',
          GV_NAME:          'Umsatz',
          INHAUS:           1,
          P_MWS:            UST_PCT[key],
          UST_SCHLUESSEL:   key,
          E_UST_BRUTTO:     EUR(item.price_snapshot_cents),
          BASISPREIS_BRUTTO: EUR(item.price_snapshot_cents),
          MENGE:            item.quantity,
          FAKTOR:           1,
          EINHEIT:          'Stk',
          BRUTTO:           EUR(lineTotal),
        });
      }

      // Tip as a separate exempt line. Emit for non-zero (incl. negative Storno
      // reversals) so tips net out in the export the same way goods do.
      if (tab.tip_cents !== 0) {
        rows.push({
          ...base,
          BON_NR:           tab.id,
          POS_ZEILE:        pos++,
          GUTSCHEIN_ID:     '',
          ARTIKELTEXT:      'Trinkgeld',
          POS_ZEILEN_TYP:   'Artikel',
          GV_TYP:           'TrinkgeldAN',
          GV_NAME:          'Trinkgeld',
          INHAUS:           1,
          P_MWS:            UST_PCT[3],
          UST_SCHLUESSEL:   3,
          E_UST_BRUTTO:     EUR(tab.tip_cents),
          BASISPREIS_BRUTTO: EUR(tab.tip_cents),
          MENGE:            1,
          FAKTOR:           1,
          EINHEIT:          'Stk',
          BRUTTO:           EUR(tab.tip_cents),
        });
      }
    }
  }

  return toCsv(BP_HEADERS, rows);
}
