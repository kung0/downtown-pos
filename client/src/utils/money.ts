export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

export function parseMoney(input: string): number {
  const normalized = input.trim().replace(',', '.');
  const euros = parseFloat(normalized);
  if (isNaN(euros) || euros < 0) return 0;
  return Math.round(euros * 100);
}

export function computeTax(items: Array<{
  price_snapshot_cents: number;
  quantity: number;
  tax_category_snapshot: string;
}>): { standard: number; reduced: number } {
  let standard = 0, reduced = 0;
  for (const item of items) {
    const lineTotal = item.price_snapshot_cents * item.quantity;
    if (item.tax_category_snapshot === 'reduced') {
      reduced += Math.round(lineTotal * 7 / 107);
    } else {
      standard += Math.round(lineTotal * 19 / 119);
    }
  }
  return { standard, reduced };
}

export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}
