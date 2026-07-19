import type { Tab, ShiftSummary } from '@downtown/shared';

// TM-M30 III @ 80mm paper: Font A = 48 chars
const W_A = 48;

const ESC = 0x1B;
const GS = 0x1D;

const b = (...n: number[]) => Buffer.from(n);
const LF = b(0x0A);
const ESC_INIT = b(ESC, 0x40);
const CODEPAGE_CP1252 = b(ESC, 0x74, 16); // WPC1252 — covers ä ö ü ß é â
const ALIGN_LEFT = b(ESC, 0x61, 0);
const ALIGN_CENTER = b(ESC, 0x61, 1);
const BOLD_ON = b(ESC, 0x45, 1);
const BOLD_OFF = b(ESC, 0x45, 0);
const FONT_A = b(ESC, 0x4D, 0);
const FONT_B = b(ESC, 0x4D, 1);
const DBL_HEIGHT_ON = b(ESC, 0x21, 0x10);
const DBL_HEIGHT_OFF = b(ESC, 0x21, 0x00);
// Feed 4 lines then partial cut
const FEED_CUT = b(ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);

// Encode string to CP1252 bytes. German chars (ä ö ü ß é â …) live in CP1252
// and pass through untouched. The printer has no Vietnamese codepage, so for
// anything CP1252 can't show — Vietnamese tone marks like ở ầ ế ư — we strip
// the diacritics down to the base letter (phở → pho, bánh mì → banh mi).
// Truly unrepresentable characters become '?'.
function enc(s: string): Buffer {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 256) {
      out.push(cp);
      continue;
    }
    // đ/Đ have no canonical decomposition — map them by hand.
    const base =
      ch === 'đ' ? 'd' :
      ch === 'Đ' ? 'D' :
      ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); // combining diacritical marks
    for (const c of base) {
      const b = c.codePointAt(0)!;
      out.push(b < 256 ? b : 0x3F);
    }
  }
  return Buffer.from(out);
}

function line(s: string): Buffer {
  return Buffer.concat([enc(s), LF]);
}

function divider(ch = '-', width = W_A): Buffer {
  return line(ch.repeat(width));
}

// Left + right column layout, pads the space between them
function col(left: string, right: string, width = W_A): Buffer {
  const gap = width - left.length - right.length;
  if (gap <= 0) {
    const trimmed = left.slice(0, width - right.length - 1);
    return line(trimmed + ' ' + right);
  }
  return line(left + ' '.repeat(gap) + right);
}

function euro(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)},${(abs % 100).toString().padStart(2, '0')} EUR`;
}

function berlinDT(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function berlinDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// A full-width line to write on by hand.
const FILL = '_'.repeat(W_A);

export function buildReceipt(tab: Tab, opts: { bewirtung?: boolean } = {}): Buffer {
  const p: Buffer[] = [];

  // ── init ─────────────────────────────────────────────────────
  p.push(ESC_INIT, CODEPAGE_CP1252);

  // ── header ───────────────────────────────────────────────────
  p.push(ALIGN_CENTER, BOLD_ON, DBL_HEIGHT_ON);
  p.push(line('Downtown Darmstadt'));
  p.push(DBL_HEIGHT_OFF, BOLD_OFF);
  p.push(line('Cafe - Bar - Restaurant - Billard'));
  p.push(line('Grafenstraße 20 \xB7 64283 Darmstadt')); // · = 0xB7 in CP1252
  p.push(LF, ALIGN_LEFT, divider('='));

  // ── customer + date ──────────────────────────────────────────
  p.push(BOLD_ON, line(tab.customer_name.slice(0, W_A)), BOLD_OFF);
  if (tab.closed_at) p.push(line(berlinDT(tab.closed_at)));
  p.push(divider('-'));

  // ── line items ───────────────────────────────────────────────
  if (tab.items && tab.items.length > 0) {
    for (const item of tab.items) {
      const label = `${item.quantity}x ${item.name_snapshot}`;
      p.push(col(label, euro(item.price_snapshot_cents * item.quantity)));
      if (item.note) {
        p.push(FONT_B, line(`  (${item.note})`), FONT_A);
      }
    }
  }

  p.push(divider('-'));

  // ── financials ───────────────────────────────────────────────
  const hasStd      = (tab.tax_standard_cents ?? 0) > 0;
  const hasRed      = (tab.tax_reduced_cents ?? 0) > 0;
  const hasTip      = tab.tip_cents > 0;
  const hasDiscount = (tab.discount_cents ?? 0) > 0;

  // Show subtotal row when there's a discount or tip (otherwise it duplicates GESAMT)
  if ((hasTip || hasDiscount) && tab.subtotal_cents != null) {
    p.push(col('Zwischensumme', euro(tab.subtotal_cents)));
  }

  if (hasDiscount) {
    p.push(col('Rabatt', `-${euro(tab.discount_cents!)}`));
  }

  if (hasStd) {
    p.push(col('  davon MwSt. 19%', euro(tab.tax_standard_cents!)));
  }
  if (hasRed) {
    p.push(col('  davon MwSt. 7%', euro(tab.tax_reduced_cents!)));
  }

  if (hasTip) {
    p.push(col('Trinkgeld', euro(tab.tip_cents)));
  }

  p.push(divider('='));

  // ── total + payment ──────────────────────────────────────────
  if (tab.total_cents != null) {
    p.push(BOLD_ON, col('GESAMT', euro(tab.total_cents)), BOLD_OFF);
  }

  if (tab.payment_method) {
    p.push(col('Zahlung', tab.payment_method === 'cash' ? 'Bar' : 'EC-Karte'));
  }
  if (tab.card_masked_pan) {
    p.push(FONT_B, line(`  ${tab.card_masked_pan}`), FONT_A);
  }

  // ── TSE block (KassenSichV §6) ───────────────────────────────
  if (tab.tse_transaction_number) {
    p.push(divider('-'));
    p.push(FONT_B);
    p.push(line('Sicherheitseinrichtung (TSE)'));
    p.push(line(`TSE-Transaktion:  ${tab.tse_transaction_number}`));
    if (tab.tse_signature_counter != null) {
      p.push(line(`Signaturz\xE4hler:   ${tab.tse_signature_counter}`)); // ä = 0xE4
    }
    // DSFinV-K §2.7 simplification: first-order time must be printed in plain text
    p.push(line(`Erstbestellung: ${berlinDT(tab.opened_at)}`));
    if (tab.tse_start_time) {
      p.push(line(`Start:  ${berlinDT(tab.tse_start_time)}`));
    }
    if (tab.tse_timestamp) {
      p.push(line(`Ende:   ${berlinDT(tab.tse_timestamp)}`));
    }
    if (tab.tse_signature) {
      p.push(line('Signatur:'));
      // Wrap the base64 signature across 64-char lines (Font B width)
      const sig = tab.tse_signature;
      for (let i = 0; i < sig.length; i += 64) {
        p.push(line(sig.slice(i, i + 64)));
      }
    }
    p.push(FONT_A);
  }

  p.push(divider('='));

  // ── footer ───────────────────────────────────────────────────
  p.push(ALIGN_CENTER);
  p.push(line('Vielen Dank f\xFCr Ihren Besuch!')); // ü = 0xFC

  // ── Bewirtungsbeleg ──────────────────────────────────────────
  // Printed directly below the receipt on the same slip; a single cut closes
  // the whole job so receipt + Bewirtungsbeleg come out as one paper.
  if (opts.bewirtung) {
    p.push(buildBewirtungsbeleg(tab));
  }

  p.push(LF, FEED_CUT);

  return Buffer.concat(p);
}

// Supplemental entertainment-expense section (§ 4 Abs. 5 Satz 1 Nr. 2 EStG,
// BMF-Schreiben v. 30.06.2021). Printed below the receipt on the same slip.
// The machine receipt above already documents venue, date, itemised costs and
// total (and, in Phase 2, the TSE signature). The data the tax office requires
// that a register cannot supply — Anlass der Bewirtung, Teilnehmer and the
// host's signature — are emitted as blank fill-in lines to complete by hand.
function buildBewirtungsbeleg(tab: Tab): Buffer {
  const p: Buffer[] = [];

  // Separator from the receipt above (no cut — same paper).
  p.push(ALIGN_LEFT, LF);
  p.push(line('\xBB'.repeat(W_A))); // » row as a visible tear/fold guide

  // ── header ───────────────────────────────────────────────────
  p.push(ALIGN_CENTER, BOLD_ON, DBL_HEIGHT_ON);
  p.push(line('BEWIRTUNGSBELEG'));
  p.push(DBL_HEIGHT_OFF);
  p.push(line('Bewirtung aus gesch\xE4ftlichem Anlass')); // ä = 0xE4
  p.push(BOLD_OFF, LF, ALIGN_LEFT);

  // ── Ort und Tag der Bewirtung ────────────────────────────────
  p.push(line('Ort der Bewirtung:'));
  p.push(line('Downtown, Grafenstra\xDFe 20, 64283 Darmstadt')); // ß = 0xDF
  if (tab.closed_at) {
    p.push(col('Tag der Bewirtung:', berlinDate(tab.closed_at)));
  }
  p.push(divider('-'));

  // ── Höhe der Aufwendungen ────────────────────────────────────
  const tip = tab.tip_cents ?? 0;
  const total = tab.total_cents ?? 0;
  p.push(col('Bewirtungskosten lt. Rechnung', euro(total - tip)));
  // Tip is captured digitally when paid by card; for cash it may be added by
  // hand, so leave a writable line when we have no recorded amount.
  p.push(tip > 0 ? col('Trinkgeld', euro(tip)) : col('Trinkgeld', '________'));
  p.push(BOLD_ON, col('Gesamtbetrag', euro(total)), BOLD_OFF);
  p.push(divider('-'));

  // ── Anlass der Bewirtung ─────────────────────────────────────
  p.push(line('Anlass der Bewirtung:'));
  p.push(line(FILL));
  p.push(line(FILL));

  // ── Bewirtete Personen (inkl. Gastgeber) ─────────────────────
  p.push(LF, line('Bewirtete Personen (Name):'));
  p.push(line(FILL));
  p.push(line(FILL));
  p.push(line(FILL));
  p.push(line(FILL));

  p.push(LF, line('Bewirtende Person / Gastgeber:'));
  p.push(line(FILL));

  // ── Unterschrift ─────────────────────────────────────────────
  p.push(LF, LF, line(FILL));
  p.push(FONT_B, line('Ort, Datum, Unterschrift Bewirtende(r)'), FONT_A);

  // ── Hinweis ──────────────────────────────────────────────────
  p.push(divider('-'));
  p.push(FONT_B);
  p.push(line('Angaben gem. \xA7 4 Abs. 5 Satz 1 Nr. 2 EStG.')); // § = 0xA7
  p.push(FONT_A);

  return Buffer.concat(p);
}

// Kitchen/bar order ticket — printed when items are sent to a tab (or paid
// directly) so staff know what to make. Deliberately NOT a receipt: no prices,
// no tax, no totals. Big and readable, items + notes only.
export function buildOrderTicket(opts: {
  customer_name: string;
  items: { name: string; quantity: number; note?: string | null }[];
  placed_at?: string;
}): Buffer {
  const placed = opts.placed_at ?? new Date().toISOString();
  const p: Buffer[] = [];

  // ── init ─────────────────────────────────────────────────────
  p.push(ESC_INIT, CODEPAGE_CP1252);

  // ── header ───────────────────────────────────────────────────
  p.push(ALIGN_CENTER, BOLD_ON, DBL_HEIGHT_ON);
  p.push(line('BESTELLUNG'));
  p.push(DBL_HEIGHT_OFF, BOLD_OFF);
  p.push(ALIGN_LEFT, divider('='));

  // ── customer + time ──────────────────────────────────────────
  p.push(BOLD_ON, DBL_HEIGHT_ON, line(opts.customer_name.slice(0, W_A)), DBL_HEIGHT_OFF, BOLD_OFF);
  p.push(line(berlinDT(placed)));
  p.push(divider('-'));

  // ── items (no prices — this is for making the order) ─────────
  for (const item of opts.items) {
    p.push(BOLD_ON, DBL_HEIGHT_ON, line(`${item.quantity}x ${item.name}`), DBL_HEIGHT_OFF, BOLD_OFF);
    if (item.note) {
      p.push(line(`   \xBB ${item.note}`)); // » = 0xBB in CP1252
    }
  }

  p.push(divider('='));
  p.push(LF, FEED_CUT);

  return Buffer.concat(p);
}

export function buildTestPage(): Buffer {
  const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const p: Buffer[] = [
    ESC_INIT, CODEPAGE_CP1252,
    ALIGN_CENTER, BOLD_ON, DBL_HEIGHT_ON,
    line('DOWNTOWN POS'), DBL_HEIGHT_OFF, BOLD_OFF,
    line('Druckertest'), LF,
    ALIGN_LEFT, divider('='),
    line('Drucker ist verbunden!'),
    line(now), divider('='), LF,
    FEED_CUT,
  ];
  return Buffer.concat(p);
}

export function buildShiftReport(s: ShiftSummary): Buffer {
  const p: Buffer[] = [];

  p.push(ESC_INIT, CODEPAGE_CP1252);

  // ── header ───────────────────────────────────────────────────
  p.push(ALIGN_CENTER, BOLD_ON, DBL_HEIGHT_ON);
  p.push(line('Downtown Darmstadt'));
  p.push(DBL_HEIGHT_OFF, BOLD_OFF);
  p.push(line('SCHICHTBERICHT'));
  p.push(LF, ALIGN_LEFT, divider('='));

  // ── shift period ─────────────────────────────────────────────
  p.push(col('Start:', berlinDT(s.session.opened_at)));
  if (s.session.closed_at) p.push(col('Ende:', berlinDT(s.session.closed_at)));
  p.push(divider('='));

  // ── overview ─────────────────────────────────────────────────
  p.push(BOLD_ON, col('Gesamtumsatz', euro(s.total_cents)), BOLD_OFF);
  p.push(col('Tabs abgeschlossen', String(s.tab_count)));
  p.push(col('Durchschnitt / Tab', euro(s.avg_tab_cents)));
  p.push(col(`Trinkgeld`, euro(s.tip_cents)));
  if (s.discount_cents !== 0) p.push(col('Rabatte', euro(-s.discount_cents)));
  p.push(divider('-'));

  // ── payment breakdown ─────────────────────────────────────────
  p.push(col(`Bar (${s.cash_count}x)`, euro(s.cash_cents)));
  p.push(col(`EC-Karte (${s.card_count}x)`, euro(s.card_cents)));
  p.push(divider('-'));

  // ── revenue by top category ───────────────────────────────────
  p.push(line('Umsatz nach Kategorie:'));
  for (const row of s.by_top_category) {
    p.push(col(`  ${row.category}`, euro(row.total_cents)));
  }
  p.push(divider('-'));

  // ── top 3 drinks ──────────────────────────────────────────────
  if (s.top_drinks.length > 0) {
    p.push(line('Top Getr\xE4nke:')); // ä = 0xE4
    for (let i = 0; i < s.top_drinks.length; i++) {
      const d = s.top_drinks[i];
      const label = `  ${i + 1}. ${d.name}`;
      p.push(col(label, `${d.qty}x`));
    }
    p.push(LF);
  }

  // ── top 3 food ────────────────────────────────────────────────
  if (s.top_food.length > 0) {
    p.push(line('Top Speisen:'));
    for (let i = 0; i < s.top_food.length; i++) {
      const f = s.top_food[i];
      const label = `  ${i + 1}. ${f.name}`;
      p.push(col(label, `${f.qty}x`));
    }
    p.push(LF);
  }

  // ── tax ───────────────────────────────────────────────────────
  p.push(divider('-'));
  p.push(FONT_B);
  p.push(col('inkl. MwSt. 19%', euro(s.tax_standard_cents)));
  p.push(col('inkl. MwSt. 7%', euro(s.tax_reduced_cents)));
  p.push(FONT_A);

  p.push(divider('='), LF);
  p.push(FEED_CUT);

  return Buffer.concat(p);
}
