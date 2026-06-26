export type ProductCategory = string;

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  tax_category: TaxCategory;
  sort_order: number;
  created_at: string;
}
export type TaxCategory = 'standard' | 'reduced';
export type TabStatus = 'open' | 'closed' | 'voided' | 'deleted';
export type PaymentMethod = 'cash' | 'card';
export type LineItemKind = 'product' | 'billiard';
export type PoolTableStatus = 'free' | 'in_use';

export interface ProductVariant {
  id: number;
  product_id: number;
  name: string;
  price_cents: number;
  available: boolean;
  sort_order: number;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  category: ProductCategory;
  price_cents: number;
  tax_category: TaxCategory;
  available: boolean;
  has_variants: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  variants?: ProductVariant[];
}

export interface LineItem {
  id: number;
  tab_id: number;
  product_id: number | null;
  variant_id: number | null;
  name_snapshot: string;
  price_snapshot_cents: number;
  tax_category_snapshot: TaxCategory;
  quantity: number;
  note: string | null;
  kind: LineItemKind;
  created_at: string;
  session_started_at?: string | null;
  session_ended_at?: string | null;
  session_computed_cost_cents?: number | null;
}

export interface Tab {
  id: number;
  customer_name: string;
  notes: string | null;
  status: TabStatus;
  opened_at: string;
  closed_at: string | null;
  payment_method: PaymentMethod | null;
  subtotal_cents: number | null;
  tip_cents: number;
  total_cents: number | null;
  tax_cents: number | null;
  tax_standard_cents: number | null;
  tax_reduced_cents: number | null;
  discount_cents: number;
  void_reason: string | null;
  voided_at: string | null;
  deleted_at: string | null;
  original_tab_id: number | null;
  card_auth_code: string | null;
  card_masked_pan: string | null;
  tse_signature: string | null;
  tse_start_time: string | null;
  tse_timestamp: string | null;
  tse_transaction_number: string | null;
  tse_signature_counter: number | null;
  tse_status: 'ok' | 'offline' | null;
  subtotal_standard_cents: number | null;
  subtotal_reduced_cents: number | null;
  session_id: number | null;
  items?: LineItem[];
  running_total_cents?: number;
  active_sessions?: BilliardSession[];
}

export type TableType = 'billiard' | 'dart';

export interface PoolTable {
  id: number;
  label: string;
  type: TableType;
  status: PoolTableStatus;
  created_at: string;
  active_session?: BilliardSession | null;
}

export interface BilliardSession {
  id: number;
  tab_id: number;
  pool_table_id: number;
  started_at: string;
  ended_at: string | null;
  hourly_rate_snapshot_cents: number;
  computed_cost_cents: number | null;
  line_item_id: number | null;
  created_at: string;
  tab?: Pick<Tab, 'id' | 'customer_name'>;
  table_label?: string;
  table_type?: TableType;
}

export interface BilliardHistoryItem {
  id: number;
  tab_id: number;
  tab_customer_name: string;
  started_at: string;
  ended_at: string;
  computed_cost_cents: number;
}

export interface Settings {
  pool_rate_standard_cents: number;
  pool_rate_peak_cents: number;
  pool_rate_daytime_discount_cents: number;
  dart_hourly_rate_cents: number;
  printer_ip: string;
  printer_auto_print: boolean;
  dsfinvk_kassen_id: string;
  dsfinvk_betreiber_name: string;
  dsfinvk_strasse: string;
  dsfinvk_plz: string;
  dsfinvk_ort: string;
  dsfinvk_land: string;
  dsfinvk_stnr: string;
  dsfinvk_ustid: string;
}

export interface DailySummary {
  date: string;
  tab_count: number;
  subtotal_cents: number;
  tip_cents: number;
  total_cents: number;
  tax_cents: number;
  tax_standard_cents: number;
  tax_reduced_cents: number;
  avg_tab_cents: number;
  cash_cents: number;
  card_cents: number;
  cash_count: number;
  card_count: number;
  billiard_cents: number;
  by_category: Array<{ category: string; total_cents: number }>;
}

export interface WaitlistEntry {
  id: number;
  pager_number: string;
  notes: string | null;
  status: 'waiting' | 'called' | 'seated';
  type: TableType;
  sort_order: number;
  tab_id: number | null;
  tab?: { id: number; customer_name: string };
  created_at: string;
  called_at: string | null;
}

export type SessionStatus = 'open' | 'closed';

export interface Session {
  id: number;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
}

export interface ShiftSummary {
  session: Session;
  tab_count: number;
  subtotal_cents: number;
  tip_cents: number;
  total_cents: number;
  tax_standard_cents: number;
  tax_reduced_cents: number;
  cash_cents: number;
  card_cents: number;
  cash_count: number;
  card_count: number;
  by_category: Array<{ category: string; total_cents: number }>;
}

export interface TabEvent {
  id: number;
  event_type: string;
  tab_id: number;
  payload: Record<string, unknown>;
  created_at: string;
}

export type WSEventType =
  | 'tab:opened'
  | 'tab:updated'
  | 'tab:closed'
  | 'tab:voided'
  | 'tab:deleted'
  | 'tab:tse_signed'
  | 'pool:session_started'
  | 'pool:session_stopped'
  | 'pool:tick'
  | 'menu:product_updated'
  | 'menu:product_deleted'
  | 'waitlist:updated';

export interface WSMessage {
  type: WSEventType;
  data: unknown;
}

export interface PoolTickData {
  table_id: number;
  session_id: number;
  elapsed_seconds: number;
  running_cost_cents: number;
}
