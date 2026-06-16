# downtown pos — claude.md

this is the POS system for **Downtown**, a community bar/café in central Darmstadt, Germany. ~40–70 seats, pool tables, drinks + coffee/matcha + food (bánh mì, popcorn chicken, fries, phở, fried rice). a fried chicken spot next door may eventually share this system.

## the rules (read before touching anything)

**money is always integer cents.** `3.50 €` → `350`. no floats, ever. display with german formatting: `8,50 €`.

**tabs are identified by customer name, not table number.** "Lukas + friends", "Maria's group", "guy at the bar with the hat". there are no table numbers in this POS.

**closed tabs are immutable.** once a tab is closed, it cannot be edited or deleted. voiding creates a new record referencing the original — it does NOT mutate the original. this is non-negotiable for future TSE compliance.

**every state change is logged in the `events` table.** append-only. tab opened, item added, item removed, tab closed, tab voided, billiard started, billiard stopped — all of it. never delete from events.

**timestamps are UTC in the DB, Europe/Berlin in the UI.** 24-hour time. german number formatting throughout.

**tax rates are per product category.** drinks + coffee & matcha → 19% (standard). food + snacks → 7% (reduced). tax is always *included* in the price (never added on top). formula: `Math.round(lineTotal * rate / (100 + rate))`. both amounts are stored on closed tabs (`tax_standard_cents`, `tax_reduced_cents`) and shown separately on receipts.

**TSE placeholder fields on tabs** (`tse_signature`, `tse_timestamp`, `tse_transaction_number`) are nullable now and will be filled in Phase 2.

## tech stack

- node.js + express backend (`/server`)
- react + vite frontend (`/client`)
- shared typescript types (`/shared`)
- sqlite via better-sqlite3 (local file, no cloud)
- websocket (`ws`) for real-time sync across devices
- runs on windows PC, accessed over local wifi from tablets/phones

## phase 2 (not yet)

phase 2 adds:
- **fiskaly TSE integration** for german fiscal law compliance (Kassensicherungsverordnung)
- **epson TM-M30 receipt printer**
- DSFinV-K export format

the data model is already structured for this — don't add hacks that would require a rewrite.

## communication style

casual, lowercase, like a friend texting. no corporate speak.
