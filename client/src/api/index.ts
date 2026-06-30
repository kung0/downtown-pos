import type { Product, ProductVariant, Tab, TabEvent, DailySummary, PoolTable, WaitlistEntry, BilliardHistoryItem, Settings, Session, ShiftSummary, Category } from '@downtown/shared';

const BASE = '/api';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CategoryInput {
  name: string;
  parent_id: number | null;
  tax_category?: 'standard' | 'reduced';
  sort_order?: number;
  avail_days?: string | null;
  avail_start?: string | null;
  avail_end?: string | null;
}

export interface ProductReorderItem {
  id: number;
  sort_order: number;
  category: string;
}

export interface CategoryReorderItem {
  id: number;
  sort_order: number;
  parent_id: number | null;
}

export const categoriesApi = {
  list: () => req<Category[]>('/categories'),
  create: (data: CategoryInput) =>
    req<Category>('/categories', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<CategoryInput> & { name: string }) =>
    req<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    req<{ id: number }>(`/categories/${id}`, { method: 'DELETE' }),
  reorder: (items: CategoryReorderItem[]) =>
    req<void>('/categories/reorder', { method: 'PATCH', body: JSON.stringify(items) }),
};

export interface ProductInput {
  name: string;
  category: string;
  price_cents: number;
  tax_category?: string;
  sort_order?: number;
}

export const productsApi = {
  list: () => req<Product[]>('/products'),
  create: (data: ProductInput) =>
    req<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: ProductInput & { has_variants?: boolean }) =>
    req<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleAvailability: (id: number) =>
    req<Product>(`/products/${id}/availability`, { method: 'PATCH' }),
  delete: (id: number) =>
    req<void>(`/products/${id}`, { method: 'DELETE' }),
  reorder: (items: ProductReorderItem[]) =>
    req<void>('/products/reorder', { method: 'PATCH', body: JSON.stringify(items) }),
};

export interface ProductVariantInput {
  name: string;
  price_cents: number;
  sort_order?: number;
}

export const variantsApi = {
  create: (productId: number, data: ProductVariantInput) =>
    req<ProductVariant>(`/products/${productId}/variants`, { method: 'POST', body: JSON.stringify(data) }),
  update: (productId: number, variantId: number, data: ProductVariantInput) =>
    req<ProductVariant>(`/products/${productId}/variants/${variantId}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (productId: number, variantId: number) =>
    req<{ id: number }>(`/products/${productId}/variants/${variantId}`, { method: 'DELETE' }),
  toggleAvailability: (productId: number, variantId: number) =>
    req<ProductVariant>(`/products/${productId}/variants/${variantId}/availability`, { method: 'PATCH' }),
};

export const tabsApi = {
  list: () => req<Tab[]>('/tabs'),
  get: (id: number) => req<Tab>(`/tabs/${id}`),
  create: (customer_name: string, notes?: string) =>
    req<Tab>('/tabs', { method: 'POST', body: JSON.stringify({ customer_name, notes }) }),
  updateNotes: (tabId: number, notes: string) =>
    req<Tab>(`/tabs/${tabId}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) }),
  updateName: (tabId: number, customer_name: string) =>
    req<Tab>(`/tabs/${tabId}/name`, { method: 'PATCH', body: JSON.stringify({ customer_name }) }),
  addItem: (tabId: number, product_id: number, quantity = 1, note?: string, variant_id?: number, custom_price_cents?: number) =>
    req<Tab>(`/tabs/${tabId}/items`, { method: 'POST', body: JSON.stringify({ product_id, quantity, note, variant_id, custom_price_cents }) }),
  removeItem: (tabId: number, itemId: number) =>
    req<Tab>(`/tabs/${tabId}/items/${itemId}`, { method: 'DELETE' }),
  close: (tabId: number, payment_method: 'cash' | 'card', tip_cents: number, discount_cents = 0) =>
    req<Tab>(`/tabs/${tabId}/close`, { method: 'POST', body: JSON.stringify({ payment_method, tip_cents, discount_cents }) }),
  delete: (tabId: number) =>
    req<{ id: number }>(`/tabs/${tabId}`, { method: 'DELETE' }),
  quickPay: (items: Array<{ product_id: number; quantity: number; variant_id?: number; custom_price_cents?: number }>, payment_method: 'cash' | 'card', tip_cents: number, discount_cents = 0) =>
    req<Tab>('/tabs/quick-pay', { method: 'POST', body: JSON.stringify({ items, payment_method, tip_cents, discount_cents }) }),
  splitPay: (tabId: number, items: Array<{ id: number; quantity: number }>, payment_method: 'cash' | 'card', tip_cents: number, discount_cents = 0) =>
    req<{ paid_tab: Tab; remaining_tab: Tab }>(`/tabs/${tabId}/split-pay`, {
      method: 'POST',
      body: JSON.stringify({ items, payment_method, tip_cents, discount_cents }),
    }),
  history: (sessionId?: number) => req<Tab[]>('/tabs/history' + (sessionId != null ? `?session_id=${sessionId}` : '')),
  events: (tabId: number) => req<TabEvent[]>(`/tabs/${tabId}/events`),
  park: (tabId: number) => req<Tab>(`/tabs/${tabId}/park`, { method: 'PATCH' }),
  unpark: (tabId: number) => req<Tab>(`/tabs/${tabId}/unpark`, { method: 'PATCH' }),
};

export const poolApi = {
  list: () => req<PoolTable[]>('/pool'),
  start: (tableId: number, tab_id: number) =>
    req<PoolTable>(`/pool/${tableId}/start`, { method: 'POST', body: JSON.stringify({ tab_id }) }),
  stop: (tableId: number) =>
    req<PoolTable>(`/pool/${tableId}/stop`, { method: 'POST' }),
  cancel: (tableId: number) =>
    req<PoolTable>(`/pool/${tableId}/cancel`, { method: 'POST' }),
  reopen: (tableId: number) =>
    req<PoolTable>(`/pool/${tableId}/reopen`, { method: 'POST' }),
  history: (tableId: number) =>
    req<BilliardHistoryItem[]>(`/pool/${tableId}/history`),
  adjustStart: (tableId: number, started_at_berlin: string) =>
    req<PoolTable>(`/pool/${tableId}/session/start`, { method: 'PATCH', body: JSON.stringify({ started_at_berlin }) }),
};

export const waitlistApi = {
  list: () => req<WaitlistEntry[]>('/waitlist'),
  add: (pager_number: string, type: 'billiard' | 'dart', tab_id: number, notes?: string) =>
    req<WaitlistEntry[]>('/waitlist', { method: 'POST', body: JSON.stringify({ pager_number, type, tab_id, notes }) }),
  call: (id: number) => req<WaitlistEntry[]>(`/waitlist/${id}/call`, { method: 'PATCH' }),
  move: (id: number, direction: 'up' | 'down') =>
    req<WaitlistEntry[]>(`/waitlist/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) }),
  restore: (id: number) => req<WaitlistEntry[]>(`/waitlist/${id}/restore`, { method: 'PATCH' }),
  remove: (id: number) => req<WaitlistEntry[]>(`/waitlist/${id}`, { method: 'DELETE' }),
};

export const reportsApi = {
  daily: (date: string) => req<DailySummary>(`/reports/daily?date=${date}`),
};

export const sessionsApi = {
  list: () => req<Session[]>('/sessions'),
  current: () => req<Session | null>('/sessions/current'),
  open: () => req<Session>('/sessions', { method: 'POST' }),
  close: (id: number) => req<ShiftSummary>(`/sessions/${id}/close`, { method: 'POST' }),
  summary: (id: number) => req<ShiftSummary>(`/sessions/${id}/summary`),
};

export const settingsApi = {
  get: () => req<Settings>('/settings'),
  update: (data: Partial<Settings>) =>
    req<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
};

export const printerApi = {
  status: () => req<{ configured: boolean; ip?: string; online: boolean }>('/printer/status'),
  test: () => req<{ ok: boolean }>('/printer/test', { method: 'POST' }),
  printReceipt: (tabId: number, opts?: { bewirtung?: boolean }) =>
    req<{ ok: boolean }>(`/printer/receipt/${tabId}`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  printOrder: (customer_name: string, items: Array<{ name: string; quantity: number; note?: string | null; category_name?: string }>) =>
    req<{ ok: boolean }>('/printer/order', { method: 'POST', body: JSON.stringify({ customer_name, items }) }),
};

export const exportApi = {
  dsfinvk: async (from: string, to: string): Promise<void> => {
    const res = await fetch(`${BASE}/export/dsfinvk?from=${from}&to=${to}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? res.statusText);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `dsfinvk_${from}_${to}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
