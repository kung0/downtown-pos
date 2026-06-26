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

// Like parseMoney but allows 0 and negative values (for variant price overrides, discounts, etc.)
export function parseMoneyAny(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  const euros = parseFloat(normalized);
  if (isNaN(euros)) return null;
  return Math.round(euros * 100);
}

export function computeTax(items: Array<{
  price_snapshot_cents: number;
  quantity: number;
  tax_category_snapshot: string;
}>, discount_cents = 0): { standard: number; reduced: number } {
  let stdSubtotal = 0, redSubtotal = 0;
  for (const item of items) {
    const lineTotal = item.price_snapshot_cents * item.quantity;
    if (item.tax_category_snapshot === 'reduced') redSubtotal += lineTotal;
    else stdSubtotal += lineTotal;
  }
  const subtotal = stdSubtotal + redSubtotal;
  const disc = subtotal > 0 ? Math.min(discount_cents, subtotal) : 0;
  const discStd = subtotal > 0 ? Math.round(disc * stdSubtotal / subtotal) : 0;
  const discRed = disc - discStd;
  return {
    standard: Math.round((stdSubtotal - discStd) * 19 / 119),
    reduced:  Math.round((redSubtotal - discRed) * 7 / 107),
  };
}

export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}
