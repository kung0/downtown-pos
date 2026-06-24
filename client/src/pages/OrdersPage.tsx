import { useState, useEffect, useCallback, useRef } from 'react';
import type { Tab, Product, ProductVariant, Category, WSMessage } from '@downtown/shared';
import { tabsApi, productsApi, categoriesApi, printerApi } from '../api';
import { subscribe } from '../lib/liveUpdates';

interface CategoryGroup { parent: Category; children: Category[]; }

function buildCatTree(cats: Category[]): CategoryGroup[] {
  const parents = cats
    .filter(c => c.parent_id === null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return parents.map(parent => ({
    parent,
    children: cats
      .filter(c => c.parent_id === parent.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }));
}
import { formatMoney, parseMoney, computeTax } from '../utils/money';
import { elapsed, formatDateTime, formatTime } from '../utils/time';

function fmtDuration(startIso: string, endIso: string): string {
  const mins = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}


interface CartItem {
  product: Product;
  quantity: number;
  note?: string;
  _key: number;
  variantId?: number;
  variantName?: string;
  variantPrice?: number;
}

interface Props { jumpTabId?: number | null; onJumpConsumed?: () => void; }

export default function OrdersPage({ jumpTabId, onJumpConsumed }: Props = {}) {
  const [tabs, setTabs]           = useState<Tab[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView]           = useState<'detail' | 'products'>('detail');
  const [cart, setCart]           = useState<CartItem[]>([]);
  const [showNewTab, setShowNewTab]   = useState(false);
  const [showPickTab, setShowPickTab] = useState(false);
  const [newTabName, setNewTabName]   = useState('');
  const [newTabNotes, setNewTabNotes] = useState('');
  const [creating, setCreating]   = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput]   = useState('');
  const [tabSearch, setTabSearch] = useState('');
  const [pickTabSearch, setPickTabSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showClose, setShowClose]       = useState(false);
  const [payMethod, setPayMethod]       = useState<'cash' | 'card'>('cash');
  const [tipInput, setTipInput]         = useState('');
  const [closing, setClosing]           = useState(false);
  const [receipt, setReceipt]           = useState<import('@downtown/shared').Tab | null>(null);
  const [printing, setPrinting]         = useState(false);
  const [printMsg, setPrintMsg]         = useState('');
  const [bewirtung, setBewirtung]       = useState(false);
  const [showDirectPay, setShowDirectPay] = useState(false);
  const [directPayMethod, setDirectPayMethod] = useState<'cash' | 'card'>('cash');
  const [directPayTip, setDirectPayTip]   = useState('');
  const [directPaying, setDirectPaying]   = useState(false);
  const [, setTick] = useState(0);
  const [sessionTicks, setSessionTicks] = useState<Record<number, { elapsed_seconds: number; running_cost_cents: number }>>({});
  const [tabsPanelOpen, setTabsPanelOpen] = useState(() => window.innerWidth >= 768);
  const [showSplit, setShowSplit] = useState(false);
  const [splitQtys, setSplitQtys] = useState<Record<number, number>>({});
  const [splitBilliardInputs, setSplitBilliardInputs] = useState<Record<number, string>>({});
  const [splitPayMethod, setSplitPayMethod] = useState<'cash' | 'card'>('cash');
  const [splitTipInput, setSplitTipInput] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [itemQtyOverrides, setItemQtyOverrides] = useState<Record<number, number>>({});
  const [highlightedKey, setHighlightedKey] = useState<number | null>(null);
  const [noteModal, setNoteModal] = useState<{ productName: string; input: string } | null>(null);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [printOrders, setPrintOrders] = useState(() => localStorage.getItem('printOrders') !== '0');
  const [printError, setPrintError] = useState<{ customerName: string; message: string } | null>(null);
  const [variantPicker, setVariantPicker] = useState<Product | null>(null);

  const newTabInputRef = useRef<HTMLInputElement>(null);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const cartKeyRef = useRef(0);
  const selectedTab = tabs.find(t => t.id === selectedId) ?? null;

  // ── cart helpers ──────────────────────────────────────────────
  const cartQty   = (id: number) => cart.filter(c => c.product.id === id).reduce((s, c) => s + c.quantity, 0);
  const cartTotal = cart.reduce((s, c) => s + (c.variantPrice ?? c.product.price_cents) * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  function cartAdd(product: Product) {
    if (product.has_variants) {
      setVariantPicker(product);
      return;
    }
    const unnoted = cart.find(c => c.product.id === product.id && !c.note);
    if (unnoted) {
      setHighlightedKey(unnoted._key);
      setCart(prev => prev.map(c => c._key === unnoted._key ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      const k = cartKeyRef.current++;
      setHighlightedKey(k);
      setCart(prev => [...prev, { product, quantity: 1, _key: k }]);
    }
  }

  function cartAddVariant(product: Product, variant: ProductVariant) {
    const existing = cart.find(c => c.product.id === product.id && c.variantId === variant.id && !c.note);
    if (existing) {
      setHighlightedKey(existing._key);
      setCart(prev => prev.map(c => c._key === existing._key ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      const k = cartKeyRef.current++;
      setHighlightedKey(k);
      setCart(prev => [...prev, { product, quantity: 1, variantId: variant.id, variantName: variant.name, variantPrice: product.price_cents + variant.price_cents, _key: k }]);
    }
    setVariantPicker(null);
  }

  function cartRemove(productId: number) {
    setCart(prev => {
      const e = prev.find(c => c.product.id === productId && !c.note);
      if (!e) return prev;
      return e.quantity <= 1
        ? prev.filter(c => c !== e)
        : prev.map(c => c === e ? { ...c, quantity: c.quantity - 1 } : c);
    });
  }

  function handleAddNote(note: string) {
    if (highlightedKey === null) return;
    const entry = cart.find(c => c._key === highlightedKey);
    if (!entry) { setNoteModal(null); return; }
    if (entry.note !== undefined || entry.quantity === 1) {
      setCart(prev => prev.map(c => c._key === highlightedKey ? { ...c, note } : c));
    } else {
      const k = cartKeyRef.current++;
      setCart(prev => {
        const i = prev.findIndex(c => c._key === highlightedKey);
        if (i === -1) return prev;
        const e = prev[i];
        return [...prev.slice(0, i), { ...e, quantity: e.quantity - 1 }, ...prev.slice(i + 1), { ...e, quantity: 1, note, _key: k }];
      });
      setHighlightedKey(k);
    }
    setNoteModal(null);
  }

  // ── order ticket printing ─────────────────────────────────────
  type OrderLine = { name: string; quantity: number; note?: string | null };
  const cartOrderLines = (): OrderLine[] =>
    cart.map(c => ({
      name: c.variantName ? `${c.product.name} (${c.variantName})` : c.product.name,
      quantity: c.quantity,
      note: c.note ?? null,
    }));

  function togglePrintOrders(v: boolean) {
    setPrintOrders(v);
    localStorage.setItem('printOrders', v ? '1' : '0');
  }

  // Fire-and-forget: the order ticket is a side effect; a missing/offline
  // printer must never block sending the order.
  function firePrintOrder(customerName: string, lines: OrderLine[]) {
    if (!printOrders || lines.length === 0) return;
    printerApi.printOrder(customerName, lines).catch(e => {
      const message = (e as Error).message;
      console.error('[printer] order print failed:', message);
      setPrintError({ customerName, message });
    });
  }

  function renderPrintToggle(noteButton?: JSX.Element) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!printOrders}
            onChange={e => togglePrintOrders(!e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'pointer' }}
          />
          <span>Don't print ticket</span>
        </label>
        {noteButton}
      </div>
    );
  }

  // ── data loading ──────────────────────────────────────────────
  const loadTabs = useCallback(async () => {
    try { setTabs(await tabsApi.list()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadTabs();
    productsApi.list().then(setProducts).catch(console.error);
    categoriesApi.list().then(setCategories).catch(console.error);
    const tick = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(tick);
  }, [loadTabs]);

  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (msg.type === 'tab:updated') {
        const tab = msg.data as Tab;
        setTabs(prev => {
          const exists = prev.some(t => t.id === tab.id);
          if (exists) return prev.map(t => t.id === tab.id ? tab : t);
          return tab.status === 'open' ? [...prev, tab] : prev;
        });
      } else if (msg.type === 'tab:opened') {
        setTabs(prev => [...prev, msg.data as Tab]);
      } else if (msg.type === 'tab:closed' || msg.type === 'tab:voided' || msg.type === 'tab:deleted') {
        const tab = msg.data as { id: number };
        setTabs(prev => prev.filter(t => t.id !== tab.id));
        setSelectedId(prev => prev === tab.id ? null : prev);
      } else if (msg.type === 'tab:tse_signed') {
        const tab = msg.data as Tab;
        setReceipt(prev => prev?.id === tab.id ? tab : prev);
      } else if (msg.type === 'menu:product_updated') {
        const product = msg.data as Product;
        setProducts(prev => prev.map(p => p.id === product.id ? product : p));
      } else if (msg.type === 'pool:tick') {
        const d = msg.data as { session_id: number; elapsed_seconds: number; running_cost_cents: number };
        setSessionTicks(prev => ({ ...prev, [d.session_id]: { elapsed_seconds: d.elapsed_seconds, running_cost_cents: d.running_cost_cents } }));
      }
    });
  }, []);

  useEffect(() => {
    setEditingNotes(false);
    setCart([]);
    setItemQtyOverrides({});
    setHighlightedKey(null);
    setCartExpanded(false);
  }, [selectedId]);

  useEffect(() => {
    if (!jumpTabId) return;
    setSelectedId(jumpTabId);
    setView('detail');
    onJumpConsumed?.();
  }, [jumpTabId, onJumpConsumed]);

  useEffect(() => {
    if (view === 'products') setTimeout(() => productSearchRef.current?.focus(), 30);
  }, [view]);

  useEffect(() => {
    if (selectedId === null) setTimeout(() => productSearchRef.current?.focus(), 30);
  }, [selectedId]);

  function updateTab(updated: Tab) {
    setTabs(prev => prev.map(t => t.id === updated.id ? updated : t));
  }

  // ── tab-mode item actions ─────────────────────────────────────
  async function handleSendOrder() {
    if (!selectedId) return;
    const hasOverrides = (selectedTab?.items ?? []).some(i => (itemQtyOverrides[i.id] ?? i.quantity) !== i.quantity);
    if (cartCount === 0 && !hasOverrides) return;

    // Capture what's being added for the order ticket (new items + qty bumps).
    const customerName = selectedTab?.customer_name ?? '';
    const orderLines: OrderLine[] = cartOrderLines();
    for (const item of (selectedTab?.items ?? [])) {
      const staged = itemQtyOverrides[item.id];
      if (staged !== undefined && staged > item.quantity) {
        orderLines.push({ name: item.name_snapshot, quantity: staged - item.quantity, note: item.note });
      }
    }

    try {
      let updated: Tab | undefined;
      for (const { product, quantity, note, variantId } of cart) {
        updated = await tabsApi.addItem(selectedId, product.id, quantity, note, variantId);
      }
      for (const item of (selectedTab?.items ?? [])) {
        const staged = itemQtyOverrides[item.id];
        if (staged === undefined || staged === item.quantity) continue;
        const delta = staged - item.quantity;
        if (delta > 0) {
          updated = await tabsApi.addItem(selectedId, item.product_id!, delta, undefined, item.variant_id ?? undefined);
        } else {
          for (let i = 0; i < Math.abs(delta); i++) {
            updated = await tabsApi.removeItem(selectedId, item.id);
          }
        }
      }
      if (updated) updateTab(updated);
      firePrintOrder(customerName, orderLines);
      setCart([]);
      setItemQtyOverrides({});
      setHighlightedKey(null);
      setView('detail');
      setProductSearch('');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── direct pay ───────────────────────────────────────────────
  function openDirectPay() {
    setDirectPayMethod('cash');
    setDirectPayTip('');
    setShowDirectPay(true);
  }

  async function handleDirectPay() {
    if (directPaying || cartCount === 0) return;
    const tipCents = parseMoney(directPayTip);
    const items    = cart.map(c => ({ product_id: c.product.id, quantity: c.quantity, variant_id: c.variantId }));
    const orderLines = cartOrderLines();

    setDirectPaying(true);
    try {
      const closed = await tabsApi.quickPay(items, directPayMethod, tipCents);
      firePrintOrder(closed.customer_name, orderLines);
      setCart([]);
      setShowDirectPay(false);
      setReceipt(closed);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDirectPaying(false);
    }
  }

  // ── cart → new tab ───────────────────────────────────────────
  function openNewTabModal() {
    setShowNewTab(true);
    setTimeout(() => newTabInputRef.current?.focus(), 30);
  }

  async function handleCreateTab() {
    if (!newTabName.trim() || creating) return;
    const orderLines = cartOrderLines();
    setCreating(true);
    try {
      let currentTab = await tabsApi.create(newTabName.trim(), newTabNotes.trim() || undefined);
      for (const { product, quantity, note, variantId } of cart) {
        currentTab = await tabsApi.addItem(currentTab.id, product.id, quantity, note, variantId);
      }
      firePrintOrder(currentTab.customer_name, orderLines);
      setTabs(prev => {
        const exists = prev.find(t => t.id === currentTab.id);
        return exists ? prev.map(t => t.id === currentTab.id ? currentTab : t) : [...prev, currentTab];
      });
      setSelectedId(currentTab.id);
      setView('detail');
      setCart([]);
      setHighlightedKey(null);
      setShowNewTab(false);
      setNewTabName('');
      setNewTabNotes('');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  // ── cart → existing tab ──────────────────────────────────────
  async function handleAddCartToTab(tabId: number) {
    setShowPickTab(false);
    const orderLines = cartOrderLines();
    try {
      let currentTab: Tab | undefined;
      for (const { product, quantity, note, variantId } of cart) {
        currentTab = await tabsApi.addItem(tabId, product.id, quantity, note, variantId);
      }
      if (currentTab) {
        updateTab(currentTab);
        firePrintOrder(currentTab.customer_name, orderLines);
      }
      setSelectedId(tabId);
      setView('detail');
      setCart([]);
      setHighlightedKey(null);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── tab notes ────────────────────────────────────────────────
  function openNotesEdit() {
    setNotesInput(selectedTab?.notes ?? '');
    setEditingNotes(true);
  }

  async function handleSaveNotes() {
    if (!selectedId) return;
    setEditingNotes(false);
    try { updateTab(await tabsApi.updateNotes(selectedId, notesInput)); }
    catch (e) { alert((e as Error).message); }
  }

  // ── delete tab ───────────────────────────────────────────────
  async function handleDeleteTab() {
    if (!selectedId) return;
    const tab = tabs.find(t => t.id === selectedId);
    if (!window.confirm(`Delete "${tab?.customer_name}"? This cannot be undone.`)) return;
    try {
      await tabsApi.delete(selectedId);
      setTabs(prev => prev.filter(t => t.id !== selectedId));
      setSelectedId(null);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── split payment ────────────────────────────────────────────
  function openSplitModal() {
    setSplitQtys({});
    setSplitBilliardInputs({});
    setSplitPayMethod('cash');
    setSplitTipInput('');
    setShowSplit(true);
  }

  function stepSplitQty(itemId: number, delta: number, max: number) {
    setSplitQtys(prev => ({
      ...prev,
      [itemId]: Math.min(max, Math.max(0, (prev[itemId] ?? 0) + delta)),
    }));
  }

  async function handleSplitPay() {
    if (!selectedId || splitting) return;
    const items = (selectedTab?.items ?? []).flatMap(i => {
      if (i.kind === 'billiard') {
        const amount = Math.min(i.price_snapshot_cents, Math.max(0, parseMoney(splitBilliardInputs[i.id] ?? '')));
        return amount > 0 ? [{ id: i.id, quantity: 1, amount_cents: amount }] : [];
      }
      const qty = splitQtys[i.id] ?? 0;
      return qty > 0 ? [{ id: i.id, quantity: qty }] : [];
    });
    if (items.length === 0) return;
    const tipCents = parseMoney(splitTipInput);

    setSplitting(true);
    try {
      const result = await tabsApi.splitPay(selectedId, items, splitPayMethod, tipCents);
      updateTab(result.remaining_tab);
      setShowSplit(false);
      setReceipt(result.paid_tab);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSplitting(false);
    }
  }

  // ── close tab ────────────────────────────────────────────────
  function openCloseModal() {
    setPayMethod('cash');
    setTipInput('');
    setShowClose(true);
  }

  async function handleCloseTab() {
    if (!selectedId || closing) return;
    const tipCents = parseMoney(tipInput);

    setClosing(true);
    try {
      const closed = await tabsApi.close(selectedId, payMethod, tipCents);
      setTabs(prev => prev.filter(t => t.id !== closed.id));
      setSelectedId(null);
      setShowClose(false);
      setReceipt(closed);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setClosing(false);
    }
  }

  // ── product grid (shared between cart mode and tab mode) ──────
  const isCartMode = !selectedTab;

  function renderCartDetail() {
    return (
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginBottom: 8 }}>
        {cart.map(item => {
          const isHighlighted = item._key === highlightedKey;
          return (
            <div
              key={item._key}
              onClick={() => setHighlightedKey(item._key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                borderRadius: 6, cursor: 'pointer',
                background: isHighlighted ? 'var(--border, #e2e8f0)' : 'transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.name}</div>
                {item.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{item.note}</div>}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{formatMoney(item.product.price_cents * item.quantity)}</span>
              <button
                className="btn btn--ghost btn--icon"
                style={{ minWidth: 28, minHeight: 28, fontSize: 15, flexShrink: 0 }}
                onMouseDown={e => e.preventDefault()}
                onClick={e => {
                  e.stopPropagation();
                  setCart(prev => {
                    const entry = prev.find(c => c._key === item._key);
                    if (!entry) return prev;
                    return entry.quantity <= 1
                      ? prev.filter(c => c._key !== item._key)
                      : prev.map(c => c._key === item._key ? { ...c, quantity: c.quantity - 1 } : c);
                  });
                }}
              >−</button>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center', flexShrink: 0 }}>{item.quantity}</span>
              <button
                className="btn btn--ghost btn--icon"
                style={{ minWidth: 28, minHeight: 28, fontSize: 15, flexShrink: 0 }}
                onMouseDown={e => e.preventDefault()}
                onClick={e => {
                  e.stopPropagation();
                  setCart(prev => prev.map(c => c._key === item._key ? { ...c, quantity: c.quantity + 1 } : c));
                }}
              >+</button>
            </div>
          );
        })}
      </div>
    );
  }

  function renderProductGrid() {
    const query = productSearch.trim().toLowerCase();
    const visibleProducts = query
      ? products.filter(p => p.available && p.name.toLowerCase().includes(query))
      : null;

    function renderCard(p: Product) {
      const stagedQty = cartQty(p.id);
      const committedQty = !isCartMode
        ? (selectedTab!.items ?? [])
            .filter(i => i.product_id === p.id && i.kind === 'product')
            .reduce((s, i) => s + i.quantity, 0)
        : 0;
      const totalQty = committedQty + stagedQty;
      const availableVariants = (p.variants ?? []).filter(v => v.available);
      const minVariantPrice = availableVariants.length > 0
        ? Math.min(...availableVariants.map(v => p.price_cents + v.price_cents))
        : null;
      return (
        <div
          key={p.id}
          className={`product-card${stagedQty > 0 ? ' product-card--in-tab' : ''}`}
          onClick={() => cartAdd(p)}
          onMouseDown={e => e.preventDefault()}
        >
          {totalQty > 0 && (
            <span className={`product-card__badge${stagedQty === 0 ? ' product-card__badge--committed' : ''}`}>
              {stagedQty > 0 && committedQty > 0 ? `${committedQty}+${stagedQty}` : totalQty}
            </span>
          )}
          {cart.some(c => c.product.id === p.id && !!c.note) && (
            <span className="product-card__note-icon">📝</span>
          )}
          <div className="product-card__name">{p.name}</div>
          <div className="product-card__price">
            {p.has_variants && minVariantPrice !== null
              ? `ab ${formatMoney(minVariantPrice)}`
              : formatMoney(p.price_cents)}
          </div>
          {!p.has_variants && stagedQty > 0 && (
            <button
              className="product-card__remove"
              onMouseDown={e => e.preventDefault()}
              onClick={e => { e.stopPropagation(); cartRemove(p.id); }}
            >
              −
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="product-grid-scroll">
        {visibleProducts ? (
          visibleProducts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '28px 0' }}>
              no match
            </p>
          ) : (
            <div className="product-category-section">
              <div className="product-grid">{visibleProducts.map(renderCard)}</div>
            </div>
          )
        ) : (
          buildCatTree(categories).map(({ parent, children }) => {
            const childSections = children
              .map(child => ({
                child,
                catProducts: products.filter(p => p.category === child.name && p.available),
              }))
              .filter(({ catProducts }) => catProducts.length > 0);
            if (childSections.length === 0) return null;
            return (
              <div key={parent.id} className="product-parent-section">
                <div className="product-parent-label">{parent.name}</div>
                {childSections.map(({ child, catProducts }) => (
                  <div key={child.id} className="product-category-section">
                    <div className="product-category-label">{child.name}</div>
                    <div className="product-grid">{catProducts.map(renderCard)}</div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    );
  }

  const filteredTabs = tabSearch.trim()
    ? tabs.filter(t => t.customer_name.toLowerCase().includes(tabSearch.toLowerCase()))
    : tabs;

  const mobileHideTabs = selectedTab !== null;

  return (
    <div className="orders-layout">

      {/* ── Left: tab list ───────────────────────────────────── */}
      <div className={`tabs-panel${mobileHideTabs ? ' tabs-panel--mobile-hidden' : ''}${!tabsPanelOpen ? ' tabs-panel--collapsed' : ''}`}>
        <div className="tabs-panel__header" onClick={() => setTabsPanelOpen(o => !o)}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span className="tabs-panel__title">Open tabs ({tabs.length})</span>
            <span className="tabs-panel__toggle">{tabsPanelOpen ? '▲' : '▼'}</span>
          </div>
          <button className="btn btn--primary btn--sm tabs-panel__new-order-btn" onClick={e => { e.stopPropagation(); setSelectedId(null); }}>+ New order</button>
        </div>
        <div className="tabs-panel__search">
          <input
            className="field__input"
            placeholder="Search tabs…"
            value={tabSearch}
            onChange={e => setTabSearch(e.target.value)}
          />
        </div>
        <div className="tabs-panel__list">
          {tabs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '28px 0' }}>
              No open tabs
            </p>
          ) : filteredTabs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '28px 0' }}>
              No match
            </p>
          ) : filteredTabs.map(t => (
            <button
              key={t.id}
              className={`tab-card${t.id === selectedId ? ' tab-card--active' : ''}`}
              onClick={() => { setSelectedId(t.id === selectedId ? null : t.id); setView('detail'); }}
            >
              <div className="tab-card__name">{t.customer_name}</div>
              <div className="tab-card__meta">
                <span>{elapsed(t.opened_at)}</span>
                <span>{formatMoney(t.running_total_cents ?? 0)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right ────────────────────────────────────────────── */}
      {isCartMode ? (
        /* Cart mode: product grid + cart bar */
        <div className="product-grid-panel">
          <div className="product-grid-header">
            <span style={{ fontSize: 14, fontWeight: 600 }}>New order</span>
            <input
              ref={productSearchRef}
              className="field__input"
              style={{ flex: 1, maxWidth: 200 }}
              placeholder="Search products…"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
          </div>

          {renderProductGrid()}

          <div className="cart-bar">
            {cartCount === 0 ? (
              <div className="cart-bar--empty">nothing selected yet</div>
            ) : (
              <>
                <div className="cart-bar__row" style={{ cursor: 'pointer' }} onClick={() => setCartExpanded(e => !e)}>
                  <span className="cart-bar__label">{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
                  <span className="cart-bar__total">{formatMoney(cartTotal)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cartExpanded ? '▲' : '▼'}</span>
                </div>
                {cartExpanded && renderCartDetail()}
                {renderPrintToggle(highlightedKey !== null ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ fontSize: 14, padding: '5px 14px' }}
                    onClick={() => {
                      const entry = cart.find(c => c._key === highlightedKey);
                      setNoteModal({ productName: entry?.product.name ?? '', input: entry?.note ?? '' });
                    }}
                  >
                    + note
                  </button>
                ) : undefined)}
                <div className="cart-bar__actions">
                  <button className="btn btn--primary" style={{ flex: 1 }} onClick={openDirectPay}>
                    Pay now
                  </button>
                </div>
                <div className="cart-bar__actions" style={{ marginTop: 6 }}>
                  <button className="btn btn--ghost" style={{ flex: 1 }} onClick={openNewTabModal}>
                    + Open tab
                  </button>
                  <button
                    className="btn btn--ghost"
                    style={{ flex: 1 }}
                    onClick={() => { setPickTabSearch(''); setShowPickTab(true); }}
                    disabled={tabs.length === 0}
                    title={tabs.length === 0 ? 'No open tabs' : undefined}
                  >
                    Add to tab →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

      ) : view === 'detail' ? (
        /* Tab detail */
        <div className="detail-panel">
          <div className="detail-header">
            <button className="btn btn--ghost btn--sm mobile-back" onClick={() => setSelectedId(null)}>←</button>
            <div className="detail-header__info">
              <div className="detail-header__name">{selectedTab.customer_name}</div>
              <div className="detail-header__meta">opened {elapsed(selectedTab.opened_at)}</div>
              {editingNotes ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <input
                    className="field__input"
                    style={{ fontSize: 12, padding: '2px 6px', flex: 1 }}
                    value={notesInput}
                    onChange={e => setNotesInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveNotes(); if (e.key === 'Escape') setEditingNotes(false); }}
                    autoFocus
                  />
                  <button className="btn btn--primary btn--sm" onClick={handleSaveNotes}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditingNotes(false)}>✕</button>
                </div>
              ) : (
                <div
                  className="detail-header__notes"
                  onClick={openNotesEdit}
                  title="Click to edit notes"
                >
                  {selectedTab.notes
                    ? <span className="detail-header__notes-text">{selectedTab.notes}</span>
                    : <span className="detail-header__notes-empty">+ add note</span>
                  }
                </div>
              )}
            </div>
            <button className="btn btn--primary btn--sm" onClick={() => { setView('products'); setProductSearch(''); }}>
              + Add items
            </button>
            <button className="btn btn--ghost btn--sm btn--icon" onClick={handleDeleteTab} title="Delete tab" style={{ color: 'var(--danger, #e53e3e)' }}>
              🗑
            </button>
            <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setSelectedId(null)} title="Deselect tab">
              ✕
            </button>
          </div>

          {(selectedTab.active_sessions ?? []).length > 0 && (
            <div className="active-sessions">
              {(selectedTab.active_sessions ?? []).map(session => {
                const tick = sessionTicks[session.id];
                const elapsedSecs = tick?.elapsed_seconds
                  ?? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000);
                const cost = tick?.running_cost_cents ?? 0;
                const mins = Math.floor(elapsedSecs / 60);
                const h = Math.floor(mins / 60), m = mins % 60;
                const elapsed = mins < 60 ? `${mins} min` : (m > 0 ? `${h}h ${m}m` : `${h}h`);
                return (
                  <div key={session.id} className="active-session">
                    <span className="active-session__label">{session.table_label}</span>
                    <span className="active-session__elapsed">{elapsed}</span>
                    <span className="active-session__cost">{formatMoney(cost)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="line-items">
            {(selectedTab.items ?? []).length === 0 ? (
              <div className="line-items__empty">No items yet — tap Add items</div>
            ) : (selectedTab.items ?? []).map(item => {
              const displayQty = itemQtyOverrides[item.id] ?? item.quantity;
              const changed = displayQty !== item.quantity;
              const warning = changed ? { color: 'var(--warning, #f59e0b)', fontWeight: 700 } : undefined;
              return (
                <div key={item.id} className="line-item" style={displayQty === 0 ? { opacity: 0.4 } : undefined}>
                  <span className="line-item__qty" style={warning}>{displayQty}×</span>
                  <div className="line-item__info">
                    <div className="line-item__name">{item.kind === 'billiard' ? item.name_snapshot.split(' · ')[0] : item.name_snapshot}</div>
                    {item.kind === 'billiard' && item.session_started_at && item.session_ended_at && (
                      <div className="line-item__note">
                        {formatTime(item.session_started_at)} – {formatTime(item.session_ended_at)} · {fmtDuration(item.session_started_at, item.session_ended_at)}
                        {item.session_computed_cost_cents != null && item.price_snapshot_cents < item.session_computed_cost_cents && (
                          <span style={{ marginLeft: 6, color: 'var(--warning, #f59e0b)' }}>
                            · {formatMoney(item.session_computed_cost_cents - item.price_snapshot_cents)} bereits bezahlt
                          </span>
                        )}
                      </div>
                    )}
                    {item.note && <div className="line-item__note">{item.note}</div>}
                  </div>
                  <span className="line-item__price">
                    {formatMoney(item.price_snapshot_cents * displayQty)}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    style={{ flexShrink: 0, ...warning }}
                    onClick={() => setItemQtyOverrides(prev => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] ?? item.quantity) - 1) }))}
                  >
                    −
                  </button>
                  {item.kind === 'product' && (
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      style={{ flexShrink: 0, ...warning }}
                      onClick={() => setItemQtyOverrides(prev => ({ ...prev, [item.id]: (prev[item.id] ?? item.quantity) + 1 }))}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {(() => {
            const hasOverrides = (selectedTab.items ?? []).some(i => (itemQtyOverrides[i.id] ?? i.quantity) !== i.quantity);
            if (cartCount === 0 && !hasOverrides) return null;
            return (
              <div className="cart-bar">
                <div className="cart-bar__row">
                  <span className="cart-bar__label">
                    {cartCount > 0 && `${cartCount} new`}{cartCount > 0 && hasOverrides && ' · '}{hasOverrides && 'qty changes'}
                  </span>
                  {cartCount > 0 && <span className="cart-bar__total">{formatMoney(cartTotal)}</span>}
                </div>
                {renderPrintToggle(cartCount > 0 && highlightedKey !== null ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ fontSize: 14, padding: '5px 14px' }}
                    onClick={() => {
                      const entry = cart.find(c => c._key === highlightedKey);
                      setNoteModal({ productName: entry?.product.name ?? '', input: entry?.note ?? '' });
                    }}
                  >
                    + note
                  </button>
                ) : undefined)}
                <div className="cart-bar__actions">
                  <button className="btn btn--ghost" onClick={() => { setCart([]); setItemQtyOverrides({}); }}>Discard</button>
                  <button className="btn btn--primary" style={{ flex: 1 }} onClick={handleSendOrder}>Send to tab</button>
                </div>
              </div>
            );
          })()}

          <div className="detail-footer">
            <div className="detail-total">
              <span className="detail-total__label">Total</span>
              <span className="detail-total__amount">
                {formatMoney(selectedTab.running_total_cents ?? 0)}
              </span>
            </div>
            <div className="detail-actions">
              <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => { setView('products'); setProductSearch(''); }}>
                + Add items
              </button>
              <button
                className="btn btn--ghost"
                style={{ flex: 1 }}
                onClick={openSplitModal}
                disabled={(selectedTab.running_total_cents ?? 0) === 0}
                title="Pay selected items separately"
              >
                Split
              </button>
              <button
                className="btn btn--ghost"
                style={{ flex: 1 }}
                onClick={openCloseModal}
                disabled={(selectedTab.running_total_cents ?? 0) === 0 || (selectedTab.active_sessions ?? []).length > 0}
                title={(selectedTab.active_sessions ?? []).length > 0 ? 'Stop the running table first' : undefined}
              >
                Close & Pay
              </button>
            </div>
          </div>
        </div>

      ) : (
        /* Tab product grid (adding to existing tab) */
        <div className="product-grid-panel">
          <div className="product-grid-header">
            <button className="btn btn--ghost btn--sm" onClick={() => { setView('detail'); setProductSearch(''); setCart([]); }}>
              ← {selectedTab.customer_name}
            </button>
            <input
              ref={productSearchRef}
              className="field__input"
              style={{ flex: 1, maxWidth: 200 }}
              placeholder="Search products…"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
          </div>
          {renderProductGrid()}
          <div className="cart-bar">
            {cartCount === 0 ? (
              <div className="cart-bar--empty">tap products to stage an order</div>
            ) : (
              <>
                <div className="cart-bar__row" style={{ cursor: 'pointer' }} onClick={() => setCartExpanded(e => !e)}>
                  <span className="cart-bar__label">{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
                  <span className="cart-bar__total">{formatMoney(cartTotal)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cartExpanded ? '▲' : '▼'}</span>
                </div>
                {cartExpanded && renderCartDetail()}
                {renderPrintToggle(highlightedKey !== null ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ fontSize: 14, padding: '5px 14px' }}
                    onClick={() => {
                      const entry = cart.find(c => c._key === highlightedKey);
                      setNoteModal({ productName: entry?.product.name ?? '', input: entry?.note ?? '' });
                    }}
                  >
                    + note
                  </button>
                ) : undefined)}
                <div className="cart-bar__actions">
                  <button className="btn btn--primary" style={{ flex: 1 }} onClick={handleSendOrder}>Send to tab</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Direct pay modal ────────────────────────────────── */}
      {showDirectPay && (() => {
        const tip = parseMoney(directPayTip);
        const { standard: taxStd, reduced: taxRed } = computeTax(
          cart.map(c => ({
            price_snapshot_cents: c.product.price_cents,
            tax_category_snapshot: c.product.tax_category,
            quantity: c.quantity,
          }) as any)
        );
        const total = cartTotal + tip;
        return (
          <div className="modal-overlay" onClick={() => setShowDirectPay(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <h2 className="modal__title">Pay now</h2>
                <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowDirectPay(false)}>✕</button>
              </div>
              <div className="modal__body">
                <div className="pay-method-row">
                  <button
                    className={`pay-method-btn${directPayMethod === 'cash' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setDirectPayMethod('cash')}
                  >Cash</button>
                  <button
                    className={`pay-method-btn${directPayMethod === 'card' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setDirectPayMethod('card')}
                  >Card</button>
                </div>
                <div className="field" style={{ marginTop: 16 }}>
                  <label className="field__label">Tip (optional)</label>
                  <div className="price-input">
                    <span className="price-input__prefix">€</span>
                    <input
                      className="field__input"
                      placeholder="0,00"
                      value={directPayTip}
                      onChange={e => setDirectPayTip(e.target.value)}
                    />
                  </div>
                </div>
                <div className="pay-summary">
                  <div className="pay-summary__row">
                    <span>Subtotal</span>
                    <span>{formatMoney(cartTotal)}</span>
                  </div>
                  {taxStd > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 19 %</span>
                      <span>{formatMoney(taxStd)}</span>
                    </div>
                  )}
                  {taxRed > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 7 %</span>
                      <span>{formatMoney(taxRed)}</span>
                    </div>
                  )}
                  {tip > 0 && (
                    <div className="pay-summary__row">
                      <span>Tip</span>
                      <span>{formatMoney(tip)}</span>
                    </div>
                  )}
                  <div className="pay-summary__row pay-summary__row--total">
                    <span>Total</span>
                    <span>{formatMoney(total)}</span>
                  </div>
                </div>
              </div>
              <div className="modal__footer" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {renderPrintToggle()}
                <button className="btn btn--ghost" onClick={() => setShowDirectPay(false)}>Cancel</button>
                <button className="btn btn--primary" onClick={handleDirectPay} disabled={directPaying} style={{ flex: 1 }}>
                  {directPaying ? 'Processing…' : `Confirm ${directPayMethod === 'cash' ? 'cash' : 'card'} — ${formatMoney(total)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── New tab modal ───────────────────────────────────── */}
      {showNewTab && (
        <div className="modal-overlay" onClick={() => setShowNewTab(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Open new tab</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowNewTab(false)}>✕</button>
            </div>
            <div className="modal__body">
              {cartCount > 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {cartCount} item{cartCount !== 1 ? 's' : ''} ({formatMoney(cartTotal)}) will be added to this tab.
                </p>
              )}
              <div className="field">
                <label className="field__label">Customer name</label>
                <input
                  ref={newTabInputRef}
                  className="field__input"
                  placeholder='"Lukas + friends"'
                  value={newTabName}
                  onChange={e => setNewTabName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTab()}
                  autoFocus
                />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field__label">Notes (optional)</label>
                <input
                  className="field__input"
                  placeholder="allergies, preferences…"
                  value={newTabNotes}
                  onChange={e => setNewTabNotes(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTab()}
                />
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setShowNewTab(false)}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={handleCreateTab}
                disabled={creating || !newTabName.trim()}
              >
                {creating ? 'Opening…' : 'Open tab'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Split payment modal ────────────────────────────── */}
      {showSplit && selectedTab && (() => {
        const allItems = selectedTab.items ?? [];
        const getBilliardAmount = (item: typeof allItems[0]) =>
          Math.min(item.price_snapshot_cents, Math.max(0, parseMoney(splitBilliardInputs[item.id] ?? '')));
        const getItemAmount = (item: typeof allItems[0]) =>
          item.kind === 'billiard'
            ? getBilliardAmount(item)
            : item.price_snapshot_cents * (splitQtys[item.id] ?? 0);
        const splitSubtotal = allItems.reduce((s, i) => s + getItemAmount(i), 0);
        const splitTip = parseMoney(splitTipInput);
        const { standard: splitTaxStd, reduced: splitTaxRed } = computeTax(
          allItems.filter(i => getItemAmount(i) > 0).map(i => ({
            ...i, price_snapshot_cents: getItemAmount(i), quantity: 1,
          }))
        );
        const splitTotal = splitSubtotal + splitTip;
        const allMaxed = allItems.length > 0 && allItems.every(i =>
          i.kind === 'billiard'
            ? getBilliardAmount(i) >= i.price_snapshot_cents
            : (splitQtys[i.id] ?? 0) >= i.quantity
        );
        return (
          <div className="modal-overlay" onClick={() => setShowSplit(false)}>
            <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <h2 className="modal__title">Split — {selectedTab.customer_name}</h2>
                <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowSplit(false)}>✕</button>
              </div>
              <div className="modal__body" style={{ paddingBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      if (allMaxed) {
                        setSplitQtys({});
                        setSplitBilliardInputs({});
                      } else {
                        const qtys: Record<number, number> = {};
                        const bill: Record<number, string> = {};
                        allItems.forEach(i => {
                          if (i.kind === 'billiard') bill[i.id] = (i.price_snapshot_cents / 100).toFixed(2).replace('.', ',');
                          else qtys[i.id] = i.quantity;
                        });
                        setSplitQtys(qtys);
                        setSplitBilliardInputs(bill);
                      }
                    }}
                  >
                    {allMaxed ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                  {allItems.map(item => {
                    const amount = getItemAmount(item);
                    const active = amount > 0;
                    const selectedQty = splitQtys[item.id] ?? 0;
                    const itemName = item.kind === 'billiard' ? item.name_snapshot.split(' · ')[0] : item.name_snapshot;
                    const subtext = item.kind === 'billiard' && item.session_started_at && item.session_ended_at
                      ? `${formatTime(item.session_started_at)} – ${formatTime(item.session_ended_at)} · total ${formatMoney(item.price_snapshot_cents)}`
                      : `${formatMoney(item.price_snapshot_cents)} each · ${item.quantity} on tab`;
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 6,
                          background: active ? 'var(--accent-subtle, rgba(99,102,241,.08))' : 'transparent',
                          border: '1px solid',
                          borderColor: active ? 'var(--accent, #6366f1)' : 'var(--border, #e2e8f0)',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14 }}>{itemName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtext}</div>
                        </div>
                        {item.kind === 'billiard' ? (
                          <div className="price-input" style={{ width: 96, flexShrink: 0 }}>
                            <span className="price-input__prefix">€</span>
                            <input
                              className="field__input"
                              placeholder="0,00"
                              value={splitBilliardInputs[item.id] ?? ''}
                              onChange={e => setSplitBilliardInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                            />
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--icon"
                              style={{ minWidth: 44, minHeight: 44, fontSize: 18 }}
                              onClick={() => stepSplitQty(item.id, -1, item.quantity)}
                              disabled={selectedQty === 0}
                            >−</button>
                            <span style={{ minWidth: 28, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>
                              {selectedQty}
                            </span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--icon"
                              style={{ minWidth: 44, minHeight: 44, fontSize: 18 }}
                              onClick={() => stepSplitQty(item.id, +1, item.quantity)}
                              disabled={selectedQty >= item.quantity}
                            >+</button>
                          </div>
                        )}
                        <span style={{ fontSize: 14, fontWeight: active ? 500 : 400, color: active ? 'inherit' : 'var(--text-muted)', flexShrink: 0, minWidth: 64, textAlign: 'right' }}>
                          {active ? formatMoney(amount) : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="pay-method-row">
                  <button
                    className={`pay-method-btn${splitPayMethod === 'cash' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setSplitPayMethod('cash')}
                  >Cash</button>
                  <button
                    className={`pay-method-btn${splitPayMethod === 'card' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setSplitPayMethod('card')}
                  >Card</button>
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label className="field__label">Tip (optional)</label>
                  <div className="price-input">
                    <span className="price-input__prefix">€</span>
                    <input
                      className="field__input"
                      placeholder="0,00"
                      value={splitTipInput}
                      onChange={e => setSplitTipInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="pay-summary" style={{ marginTop: 12 }}>
                  <div className="pay-summary__row">
                    <span>Subtotal</span>
                    <span>{formatMoney(splitSubtotal)}</span>
                  </div>
                  {splitTaxStd > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 19 %</span>
                      <span>{formatMoney(splitTaxStd)}</span>
                    </div>
                  )}
                  {splitTaxRed > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 7 %</span>
                      <span>{formatMoney(splitTaxRed)}</span>
                    </div>
                  )}
                  {splitTip > 0 && (
                    <div className="pay-summary__row">
                      <span>Tip</span>
                      <span>{formatMoney(splitTip)}</span>
                    </div>
                  )}
                  <div className="pay-summary__row pay-summary__row--total">
                    <span>Total</span>
                    <span>{formatMoney(splitTotal)}</span>
                  </div>
                </div>
              </div>
              <div className="modal__footer" style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--ghost" onClick={() => setShowSplit(false)}>Cancel</button>
                <button
                  className="btn btn--primary"
                  onClick={handleSplitPay}
                  disabled={splitting || splitTotal === 0}
                  style={{ flex: 1 }}
                >
                  {splitting
                    ? 'Processing…'
                    : splitTotal === 0
                    ? 'Select items to pay'
                    : `Confirm ${splitPayMethod} — ${formatMoney(splitTotal)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Close & Pay modal ──────────────────────────────── */}
      {showClose && selectedTab && (() => {
        const subtotal = selectedTab.running_total_cents ?? 0;
        const tip = parseMoney(tipInput);
        const { standard: taxStd, reduced: taxRed } = computeTax(selectedTab.items ?? []);
        const total = subtotal + tip;
        return (
          <div className="modal-overlay" onClick={() => setShowClose(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal__header">
                <h2 className="modal__title">Close & Pay — {selectedTab.customer_name}</h2>
                <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowClose(false)}>✕</button>
              </div>
              <div className="modal__body">
                <div className="pay-method-row">
                  <button
                    className={`pay-method-btn${payMethod === 'cash' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setPayMethod('cash')}
                  >Cash</button>
                  <button
                    className={`pay-method-btn${payMethod === 'card' ? ' pay-method-btn--active' : ''}`}
                    onClick={() => setPayMethod('card')}
                  >Card</button>
                </div>
                <div className="field" style={{ marginTop: 16 }}>
                  <label className="field__label">Tip (optional)</label>
                  <div className="price-input">
                    <span className="price-input__prefix">€</span>
                    <input
                      className="field__input"
                      placeholder="0,00"
                      value={tipInput}
                      onChange={e => setTipInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="pay-summary">
                  <div className="pay-summary__row">
                    <span>Subtotal</span>
                    <span>{formatMoney(subtotal)}</span>
                  </div>
                  {taxStd > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 19 %</span>
                      <span>{formatMoney(taxStd)}</span>
                    </div>
                  )}
                  {taxRed > 0 && (
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>inkl. MwSt. 7 %</span>
                      <span>{formatMoney(taxRed)}</span>
                    </div>
                  )}
                  {tip > 0 && (
                    <div className="pay-summary__row">
                      <span>Tip</span>
                      <span>{formatMoney(tip)}</span>
                    </div>
                  )}
                  <div className="pay-summary__row pay-summary__row--total">
                    <span>Total</span>
                    <span>{formatMoney(total)}</span>
                  </div>
                </div>
              </div>
              <div className="modal__footer" style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--ghost" onClick={() => setShowClose(false)}>Cancel</button>
                <button className="btn btn--primary" onClick={handleCloseTab} disabled={closing} style={{ flex: 1 }}>
                  {closing ? 'Closing…' : `Confirm ${payMethod === 'cash' ? 'cash' : 'card'} — ${formatMoney(total)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Receipt modal ───────────────────────────────────── */}
      {receipt && (
        <div className="modal-overlay" onClick={() => { setReceipt(null); setBewirtung(false); }}>
          <div className="modal modal--receipt" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Receipt</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => { setReceipt(null); setBewirtung(false); }}>✕</button>
            </div>
            <div className="modal__body">
              <div className="receipt-name">{receipt.customer_name}</div>
              <div className="receipt-meta">
                {formatDateTime(receipt.opened_at)} → {formatDateTime(receipt.closed_at!)}
              </div>
              <div className="receipt-items">
                {(receipt.items ?? []).map(item => (
                  <div key={item.id} className="receipt-item">
                    <span className="receipt-item__qty">{item.quantity}×</span>
                    <div className="receipt-item__name">
                      {item.kind === 'billiard' ? item.name_snapshot.split(' · ')[0] : item.name_snapshot}
                      {item.kind === 'billiard' && item.session_started_at && item.session_ended_at && (
                        <div className="receipt-item__sub">
                          {formatTime(item.session_started_at)} – {formatTime(item.session_ended_at)} · {fmtDuration(item.session_started_at, item.session_ended_at)}
                        </div>
                      )}
                    </div>
                    <span className="receipt-item__price">
                      {formatMoney(item.price_snapshot_cents * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pay-summary">
                <div className="pay-summary__row">
                  <span>Subtotal</span>
                  <span>{formatMoney(receipt.subtotal_cents ?? 0)}</span>
                </div>
                {(receipt.tax_standard_cents ?? 0) > 0 && (
                  <div className="pay-summary__row pay-summary__row--muted">
                    <span>inkl. MwSt. 19 %</span>
                    <span>{formatMoney(receipt.tax_standard_cents!)}</span>
                  </div>
                )}
                {(receipt.tax_reduced_cents ?? 0) > 0 && (
                  <div className="pay-summary__row pay-summary__row--muted">
                    <span>inkl. MwSt. 7 %</span>
                    <span>{formatMoney(receipt.tax_reduced_cents!)}</span>
                  </div>
                )}
                {(receipt.tip_cents ?? 0) > 0 && (
                  <div className="pay-summary__row">
                    <span>Tip</span>
                    <span>{formatMoney(receipt.tip_cents)}</span>
                  </div>
                )}
                <div className="pay-summary__row pay-summary__row--total">
                  <span>Total</span>
                  <span>{formatMoney(receipt.total_cents ?? 0)}</span>
                </div>
                <div className="pay-summary__row pay-summary__row--muted" style={{ marginTop: 4 }}>
                  <span>Payment</span>
                  <span style={{ textTransform: 'capitalize' }}>{receipt.payment_method}</span>
                </div>
              </div>
              {receipt.tse_status === 'offline' && (
                <div className="receipt-tse receipt-tse--offline">
                  <div className="receipt-tse__label">TSE ausgefallen</div>
                  <div className="receipt-tse__offline-note">
                    Signatur wird nachgeholt sobald Verbindung wiederhergestellt ist.
                  </div>
                </div>
              )}
              {receipt.tse_transaction_number && (
                <div className="receipt-tse">
                  <div className="receipt-tse__label">TSE-Beleg</div>
                  <div className="receipt-tse__row">
                    <span>Tx-Nr.</span>
                    <span>{receipt.tse_transaction_number}</span>
                  </div>
                  <div className="receipt-tse__row">
                    <span>Zeitstempel</span>
                    <span>{formatDateTime(receipt.tse_timestamp!)}</span>
                  </div>
                  <div className="receipt-tse__sig">
                    <span className="receipt-tse__sig-label">Signatur</span>
                    <span className="receipt-tse__sig-value">{receipt.tse_signature}</span>
                  </div>
                </div>
              )}

              <label className="bewirtung-toggle">
                <input
                  type="checkbox"
                  checked={bewirtung}
                  onChange={e => setBewirtung(e.target.checked)}
                />
                <span>Bewirtungsbeleg anhängen</span>
              </label>

              {bewirtung && (
                <div className="bewirtung">
                  <div className="bewirtung__title">Bewirtungsbeleg</div>
                  <div className="bewirtung__sub">Bewirtung aus geschäftlichem Anlass</div>

                  <div className="bewirtung__line">
                    <span>Ort der Bewirtung</span>
                    <span>Downtown, Grafenstraße 20, Darmstadt</span>
                  </div>
                  <div className="bewirtung__line">
                    <span>Tag der Bewirtung</span>
                    <span>{formatDateTime(receipt.closed_at!)}</span>
                  </div>

                  <div className="pay-summary" style={{ marginTop: 8, paddingTop: 8 }}>
                    <div className="pay-summary__row">
                      <span>Bewirtungskosten lt. Rechnung</span>
                      <span>{formatMoney((receipt.total_cents ?? 0) - (receipt.tip_cents ?? 0))}</span>
                    </div>
                    <div className="pay-summary__row pay-summary__row--muted">
                      <span>Trinkgeld</span>
                      <span>{(receipt.tip_cents ?? 0) > 0 ? formatMoney(receipt.tip_cents) : '—'}</span>
                    </div>
                    <div className="pay-summary__row pay-summary__row--total" style={{ fontSize: 14 }}>
                      <span>Gesamtbetrag</span>
                      <span>{formatMoney(receipt.total_cents ?? 0)}</span>
                    </div>
                  </div>

                  <div className="bewirtung__fill"><span>Anlass der Bewirtung</span></div>
                  <div className="bewirtung__fill"><span>Bewirtete Personen (inkl. Gastgeber)</span></div>
                  <div className="bewirtung__fill"><span>Ort, Datum, Unterschrift</span></div>

                  <div className="bewirtung__note">
                    Felder für Anlass, Teilnehmer und Unterschrift werden beim Druck
                    als Linien zum handschriftlichen Ausfüllen ergänzt. Angaben gem.
                    § 4 Abs. 5 Satz 1 Nr. 2 EStG · geschäftliche Bewirtung 70 % abziehbar.
                  </div>
                </div>
              )}
            </div>
            <div className="modal__footer">
              <button
                className="btn"
                disabled={printing}
                onClick={async () => {
                  setPrinting(true);
                  setPrintMsg('');
                  try {
                    await printerApi.printReceipt(receipt.id, { bewirtung });
                    setPrintMsg('Sent!');
                  } catch (e) {
                    setPrintMsg((e as Error).message);
                  } finally {
                    setPrinting(false);
                    setTimeout(() => setPrintMsg(''), 3000);
                  }
                }}
              >
                {printing ? 'Printing…' : (bewirtung ? 'Print + Bewirtung' : 'Print')}
              </button>
              {printMsg && (
                <span style={{ fontSize: 13, color: printMsg === 'Sent!' ? '#22c55e' : 'var(--danger)', alignSelf: 'center' }}>
                  {printMsg}
                </span>
              )}
              <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => { setReceipt(null); setPrintMsg(''); setBewirtung(false); }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to existing tab modal ───────────────────────── */}
      {showPickTab && (
        <div className="modal-overlay" onClick={() => setShowPickTab(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Add to tab</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowPickTab(false)}>✕</button>
            </div>
            <div className="modal__body" style={{ paddingTop: 0 }}>
              <input
                className="field__input"
                placeholder="Search tabs…"
                value={pickTabSearch}
                onChange={e => setPickTabSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ paddingBottom: 4 }}>
              {tabs
                .filter(t => t.customer_name.toLowerCase().includes(pickTabSearch.toLowerCase()))
                .map(t => (
                  <button key={t.id} className="tab-pick-btn" onClick={() => handleAddCartToTab(t.id)}>
                    <span className="tab-pick-btn__name">{t.customer_name}</span>
                    <span className="tab-pick-btn__meta">
                      {elapsed(t.opened_at)} · {formatMoney(t.running_total_cents ?? 0)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Variant picker ──────────────────────────────────────── */}
      {variantPicker && (
        <div className="modal-overlay" onClick={() => setVariantPicker(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">{variantPicker.name}</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setVariantPicker(null)}>✕</button>
            </div>
            <div className="modal__body">
              <div className="variant-picker-grid">
                {(variantPicker.variants ?? []).filter(v => v.available).map(v => (
                  <button
                    key={v.id}
                    className="variant-picker-btn"
                    onClick={() => cartAddVariant(variantPicker, v)}
                  >
                    <div className="variant-picker-btn__name">{v.name}</div>
                    <div className="variant-picker-btn__price">{formatMoney(variantPicker.price_cents + v.price_cents)}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {noteModal && (
        <div className="modal-overlay" onClick={() => setNoteModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Note — {noteModal.productName}</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setNoteModal(null)}>✕</button>
            </div>
            <div className="modal__body">
              <input
                className="field__input"
                placeholder="e.g. no coriander, extra spicy…"
                value={noteModal.input}
                autoFocus
                onChange={e => setNoteModal(prev => prev ? { ...prev, input: e.target.value } : null)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && noteModal.input.trim()) handleAddNote(noteModal.input.trim());
                  if (e.key === 'Escape') setNoteModal(null);
                }}
              />
            </div>
            <div className="modal__footer" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--ghost" onClick={() => setNoteModal(null)}>Cancel</button>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                disabled={!noteModal.input.trim()}
                onClick={() => handleAddNote(noteModal.input.trim())}
              >
                Add note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order print failed modal ─────────────────────────── */}
      {printError && (
        <div className="modal-overlay" onClick={() => setPrintError(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">⚠ Ticket not printed</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setPrintError(null)}>✕</button>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: 14, marginBottom: 10 }}>
                The order for <strong>{printError.customerName}</strong> was saved, but the kitchen
                ticket could <strong>not</strong> be printed.
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                Tell the kitchen/bar manually, then check the printer.
              </p>
              <div style={{ fontSize: 12, color: 'var(--danger, #e53e3e)', background: 'var(--surface-2, rgba(0,0,0,.04))', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace' }}>
                {printError.message}
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => setPrintError(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
