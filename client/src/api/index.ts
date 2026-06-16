import type { Product, Tab, DailySummary, PoolTable, WaitlistEntry, BilliardHistoryItem, Settings, Session, ShiftSummary, Category } from '@downtown/shared';

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
  return res.json() as Promise<T>;
}

export interface CategoryInput {
  name: string;
  parent_id: number | null;
  tax_category: 'standard' | 'reduced';
  sort_order?: number;
}

export const categoriesApi = {
  list: () => req<Category[]>('/categories'),
  create: (data: CategoryInput) =>
    req<Category>('/categories', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<CategoryInput> & { name: string }) =>
    req<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    req<{ id: number }>(`/categories/${id}`, { method: 'DELETE' }),
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
  update: (id: number, data: ProductInput) =>
    req<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleAvailability: (id: number) =>
    req<Product>(`/products/${id}/availability`, { method: 'PATCH' }),
};

export const tabsApi = {
  list: () => req<Tab[]>('/tabs'),
  get: (id: number) => req<Tab>(`/tabs/${id}`),
  create: (customer_name: string, notes?: string) =>
    req<Tab>('/tabs', { method: 'POST', body: JSON.stringify({ customer_name, notes }) }),
  updateNotes: (tabId: number, notes: string) =>
    req<Tab>(`/tabs/${tabId}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) }),
  addItem: (tabId: number, product_id: number, quantity = 1, note?: string) =>
    req<Tab>(`/tabs/${tabId}/items`, { method: 'POST', body: JSON.stringify({ product_id, quantity, note }) }),
  removeItem: (tabId: number, itemId: number) =>
    req<Tab>(`/tabs/${tabId}/items/${itemId}`, { method: 'DELETE' }),
  close: (tabId: number, payment_method: 'cash' | 'card', tip_cents: number) =>
    req<Tab>(`/tabs/${tabId}/close`, { method: 'POST', body: JSON.stringify({ payment_method, tip_cents }) }),
  delete: (tabId: number) =>
    req<{ id: number }>(`/tabs/${tabId}`, { method: 'DELETE' }),
  quickPay: (items: Array<{ product_id: number; quantity: number }>, payment_method: 'cash' | 'card', tip_cents: number) =>
    req<Tab>('/tabs/quick-pay', { method: 'POST', body: JSON.stringify({ items, payment_method, tip_cents }) }),
  splitPay: (tabId: number, items: Array<{ id: number; quantity: number }>, payment_method: 'cash' | 'card', tip_cents: number) =>
    req<{ paid_tab: Tab; remaining_tab: Tab }>(`/tabs/${tabId}/split-pay`, {
      method: 'POST',
      body: JSON.stringify({ items, payment_method, tip_cents }),
    }),
  history: (sessionId?: number) => req<Tab[]>('/tabs/history' + (sessionId != null ? `?session_id=${sessionId}` : '')),
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
  printReceipt: (tabId: number) => req<{ ok: boolean }>(`/printer/receipt/${tabId}`, { method: 'POST' }),
};
