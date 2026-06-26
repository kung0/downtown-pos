import { useState, useEffect, useCallback, Fragment } from 'react';
import type { Product, ProductVariant, Category } from '@downtown/shared';
import { productsApi, variantsApi, categoriesApi } from '../api';
import type { CategoryInput } from '../api';
import { formatMoney, parseMoney, parseMoneyAny, centsToInputValue } from '../utils/money';
import { buildTree, flattenTree, findNode, collectDescendantIds } from '../utils/categoryTree';
import type { TreeNode } from '../utils/categoryTree';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDelta(cents: number): string {
  if (cents === 0) return 'gratis';
  return (cents > 0 ? '+' : '') + formatMoney(cents);
}

function hasProducts(node: TreeNode, products: Product[]): boolean {
  return products.some(p => p.category === node.cat.name) ||
    node.children.some(child => hasProducts(child, products));
}

// ── product form ──────────────────────────────────────────────────────────────

interface ProductForm { name: string; category: string; price: string; sort_order: string; }
const EMPTY_PRODUCT_FORM: ProductForm = { name: '', category: '', price: '', sort_order: '0' };

function productToForm(p: Product): ProductForm {
  return { name: p.name, category: p.category, price: centsToInputValue(p.price_cents), sort_order: String(p.sort_order) };
}

interface VariantDraft { name: string; price: string; }

// ── category form ─────────────────────────────────────────────────────────────

interface CatForm { name: string; parent_id: string; tax_category: 'standard' | 'reduced'; }
const EMPTY_CAT_FORM: CatForm = { name: '', parent_id: '', tax_category: 'standard' };

// ── component ─────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const [view, setView] = useState<'products' | 'categories'>('products');

  // shared data
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState<string | null>(null);

  // product modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct,   setEditingProduct]   = useState<Product | null>(null);
  const [productForm,      setProductForm]      = useState<ProductForm>(EMPTY_PRODUCT_FORM);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [savingProduct,    setSavingProduct]    = useState(false);
  const [hasVariants,      setHasVariants]      = useState(false);
  const [productVariants,  setProductVariants]  = useState<ProductVariant[]>([]);
  const [variantDraft,     setVariantDraft]     = useState<VariantDraft | null>(null);
  const [savingVariant,    setSavingVariant]    = useState(false);

  // category modal
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCat,   setEditingCat]   = useState<Category | null>(null);
  const [catForm,      setCatForm]      = useState<CatForm>(EMPTY_CAT_FORM);
  const [catFormError, setCatFormError] = useState<string | null>(null);
  const [savingCat,    setSavingCat]    = useState(false);

  const load = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([productsApi.list(), categoriesApi.list()]);
      setProducts(prods);
      setCategories(cats);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const catTree = buildTree(categories);
  const flatCats = flattenTree(catTree);
  const nonRootCats = categories.filter(c => c.parent_id !== null);

  // ── product actions ──────────────────────────────────────────────────────

  function openCreateProduct() {
    setEditingProduct(null);
    const firstChild = nonRootCats[0];
    setProductForm({ ...EMPTY_PRODUCT_FORM, category: firstChild?.name ?? '' });
    setProductFormError(null);
    setHasVariants(false);
    setProductVariants([]);
    setVariantDraft(null);
    setShowProductModal(true);
  }

  function openEditProduct(p: Product) {
    setEditingProduct(p);
    setProductForm(productToForm(p));
    setProductFormError(null);
    setHasVariants(p.has_variants);
    setProductVariants(p.variants ?? []);
    setVariantDraft(null);
    setShowProductModal(true);
  }

  async function handleToggle(p: Product) {
    try {
      const updated = await productsApi.toggleAvailability(p.id);
      setProducts(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleSaveProduct() {
    const price_cents = parseMoney(productForm.price);
    if (!productForm.name.trim())   { setProductFormError('Name is required'); return; }
    if (!productForm.category)       { setProductFormError('Category is required'); return; }
    if (price_cents <= 0)            { setProductFormError('Enter a valid price'); return; }

    setSavingProduct(true);
    setProductFormError(null);
    try {
      const payload = {
        name: productForm.name.trim(),
        category: productForm.category,
        price_cents,
        has_variants: hasVariants,
        sort_order: parseInt(productForm.sort_order, 10) || 0,
      };
      if (editingProduct) {
        const updated = await productsApi.update(editingProduct.id, payload);
        setProducts(prev => prev.map(x => x.id === updated.id ? { ...updated, variants: productVariants } : x));
      } else {
        const created = await productsApi.create(payload);
        setProducts(prev => [...prev, created]);
      }
      setShowProductModal(false);
    } catch (e) {
      setProductFormError((e as Error).message);
    } finally {
      setSavingProduct(false);
    }
  }

  // ── variant actions ──────────────────────────────────────────────────────

  async function handleAddVariant() {
    if (!editingProduct || !variantDraft) return;
    const price_cents = variantDraft.price.trim() === '' ? 0 : parseMoneyAny(variantDraft.price);
    if (!variantDraft.name.trim()) { setProductFormError('Variant name is required'); return; }
    if (price_cents === null) { setProductFormError('Enter a valid variant price'); return; }
    setSavingVariant(true);
    setProductFormError(null);
    try {
      const created = await variantsApi.create(editingProduct.id, { name: variantDraft.name.trim(), price_cents });
      setProductVariants(prev => [...prev, created]);
      setProducts(prev => prev.map(p => p.id === editingProduct.id
        ? { ...p, variants: [...(p.variants ?? []), created] }
        : p
      ));
      setVariantDraft(null);
    } catch (e) {
      setProductFormError((e as Error).message);
    } finally {
      setSavingVariant(false);
    }
  }

  async function handleDeleteVariant(variantId: number) {
    if (!editingProduct) return;
    try {
      await variantsApi.delete(editingProduct.id, variantId);
      setProductVariants(prev => prev.filter(v => v.id !== variantId));
      setProducts(prev => prev.map(p => p.id === editingProduct.id
        ? { ...p, variants: (p.variants ?? []).filter(v => v.id !== variantId) }
        : p
      ));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleToggleVariant(variant: ProductVariant) {
    if (!editingProduct) return;
    try {
      const updated = await variantsApi.toggleAvailability(editingProduct.id, variant.id);
      setProductVariants(prev => prev.map(v => v.id === updated.id ? updated : v));
      setProducts(prev => prev.map(p => p.id === editingProduct.id
        ? { ...p, variants: (p.variants ?? []).map(v => v.id === updated.id ? updated : v) }
        : p
      ));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── category actions ─────────────────────────────────────────────────────

  function openCreateCat(parentId?: number) {
    setEditingCat(null);
    const parent = parentId != null ? categories.find(c => c.id === parentId) : undefined;
    setCatForm({ ...EMPTY_CAT_FORM, parent_id: parentId != null ? String(parentId) : '', tax_category: parent?.tax_category ?? 'standard' });
    setCatFormError(null);
    setShowCatModal(true);
  }

  function openEditCat(cat: Category) {
    setEditingCat(cat);
    setCatForm({
      name:         cat.name,
      parent_id:    cat.parent_id === null ? '' : String(cat.parent_id),
      tax_category: cat.tax_category,
    });
    setCatFormError(null);
    setShowCatModal(true);
  }

  async function handleSaveCat() {
    if (!catForm.name.trim()) { setCatFormError('Name is required'); return; }

    const parentId = catForm.parent_id !== '' ? parseInt(catForm.parent_id, 10) : null;

    setSavingCat(true);
    setCatFormError(null);
    try {
      const payload: CategoryInput = {
        name: catForm.name.trim(),
        parent_id: parentId,
        tax_category: catForm.tax_category,
      };
      if (editingCat) {
        const updated = await categoriesApi.update(editingCat.id, payload);
        setCategories(prev => prev.map(c => c.id === updated.id ? updated : c));
        if (updated.name !== editingCat.name) {
          setProducts(prev => prev.map(p =>
            p.category === editingCat.name ? { ...p, category: updated.name } : p
          ));
        }
      } else {
        const created = await categoriesApi.create(payload);
        setCategories(prev => [...prev, created]);
      }
      setShowCatModal(false);
    } catch (e) {
      setCatFormError((e as Error).message);
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCat(node: TreeNode) {
    const label = node.cat.parent_id === null
      ? `category "${node.cat.name}" and all subcategories`
      : `subcategory "${node.cat.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await categoriesApi.delete(node.cat.id);
      const removedIds = new Set(collectDescendantIds(node));
      setCategories(prev => prev.filter(c => !removedIds.has(c.id)));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  if (loading)   return <div className="page"><p style={{ color: 'var(--text-muted)' }}>Loading…</p></div>;
  if (loadError) return <div className="page"><p className="error">{loadError}</p></div>;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Menu</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {view === 'products' && (
            <button className="btn btn--primary" onClick={openCreateProduct}>+ Produkt</button>
          )}
          {view === 'categories' && (
            <button className="btn btn--primary" onClick={() => openCreateCat()}>+ Kategorie</button>
          )}
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="menu-tabs">
        <button className={`menu-tab${view === 'products'   ? ' menu-tab--active' : ''}`} onClick={() => setView('products')}>
          Produkte
        </button>
        <button className={`menu-tab${view === 'categories' ? ' menu-tab--active' : ''}`} onClick={() => setView('categories')}>
          Kategorien
        </button>
      </div>

      {/* ════════════════ PRODUCTS VIEW ════════════════ */}
      {view === 'products' && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>On</th>
                <th>Name</th>
                <th>Kategorie</th>
                <th>Preis</th>
                <th style={{ width: 72 }}></th>
              </tr>
            </thead>
            <tbody>
              {flatCats
                .filter(({ cat }) => {
                  const node = findNode(catTree, cat.id);
                  return node ? hasProducts(node, products) : false;
                })
                .map(({ cat, depth }) => (
                  <Fragment key={cat.id}>
                    <tr className={depth === 0 ? 'category-parent-header' : 'category-header'}>
                      <td colSpan={5} style={depth > 1 ? { paddingLeft: depth * 12 } : undefined}>{cat.name}</td>
                    </tr>
                    {products.filter(p => p.category === cat.name).map(p => (
                      <tr key={p.id}>
                        <td>
                          <label className="toggle">
                            <input type="checkbox" checked={p.available} onChange={() => handleToggle(p)} />
                            <span className="toggle__slider" />
                          </label>
                        </td>
                        <td style={{ color: p.available ? 'inherit' : 'var(--text-muted)', textDecoration: p.available ? 'none' : 'line-through' }}>
                          {p.name}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{p.category}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.has_variants
                            ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.variants?.length ?? 0} Varianten</span>
                            : formatMoney(p.price_cents)}
                        </td>
                        <td>
                          <button className="btn btn--ghost btn--sm" onClick={() => openEditProduct(p)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              {/* Uncategorized — products whose category isn't in any tree node */}
              {(() => {
                const knownCats = new Set(categories.map(c => c.name));
                const orphans = products.filter(p => !knownCats.has(p.category));
                if (orphans.length === 0) return null;
                return (
                  <Fragment>
                    <tr className="category-parent-header"><td colSpan={5}>Andere</td></tr>
                    {orphans.map(p => (
                      <tr key={p.id}>
                        <td>
                          <label className="toggle">
                            <input type="checkbox" checked={p.available} onChange={() => handleToggle(p)} />
                            <span className="toggle__slider" />
                          </label>
                        </td>
                        <td style={{ color: p.available ? 'inherit' : 'var(--text-muted)', textDecoration: p.available ? 'none' : 'line-through' }}>
                          {p.name}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{p.category}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.has_variants
                            ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.variants?.length ?? 0} Varianten</span>
                            : formatMoney(p.price_cents)}
                        </td>
                        <td><button className="btn btn--ghost btn--sm" onClick={() => openEditProduct(p)}>Edit</button></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* ════════════════ CATEGORIES VIEW ════════════════ */}
      {view === 'categories' && (
        <div className="cat-list">
          {catTree.length === 0 ? (
            <p className="cat-list__empty">Noch keine Kategorien — oben „+ Kategorie" klicken.</p>
          ) : flatCats.map(({ cat, depth }) => (
            <div key={cat.id} className={`cat-row${depth === 0 ? ' cat-row--root' : ''}`}>
              {depth > 0 && <div className="cat-row__spacer" style={{ width: depth * 20 }} />}
              <span className="cat-row__name">{cat.name}</span>
              <span className={`cat-tax-badge cat-tax-badge--${cat.tax_category}`}>
                {cat.tax_category === 'reduced' ? '7 %' : '19 %'}
              </span>
              <div className="cat-row__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => openCreateCat(cat.id)}>+ Sub</button>
                <button className="btn btn--ghost btn--sm" onClick={() => openEditCat(cat)}>Edit</button>
                <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => handleDeleteCat(findNode(catTree, cat.id)!)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════ PRODUCT MODAL ════════════════ */}
      {showProductModal && (
        <div className="modal-overlay" onClick={() => setShowProductModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">{editingProduct ? 'Produkt bearbeiten' : 'Neues Produkt'}</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowProductModal(false)}>✕</button>
            </div>
            <div className="modal__body">
              {productFormError && <p className="error">{productFormError}</p>}
              <div className="field">
                <label className="field__label">Name</label>
                <input
                  className="field__input" autoFocus
                  value={productForm.name}
                  onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSaveProduct()}
                />
              </div>
              <div className="field">
                <label className="field__label">Kategorie</label>
                <select
                  className="field__input"
                  value={productForm.category}
                  onChange={e => setProductForm(f => ({ ...f, category: e.target.value }))}
                >
                  <option value="">— wählen —</option>
                  {flatCats.map(({ cat, depth }) => (
                    <option key={cat.id} value={cat.name}>
                      {'— '.repeat(depth)}{cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label">Preis</label>
                <div className="price-input">
                  <span className="price-input__prefix">€</span>
                  <input
                    className="price-input__field" type="text" inputMode="decimal" placeholder="0.00"
                    value={productForm.price}
                    onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleSaveProduct()}
                  />
                </div>
              </div>
              <div className="field">
                <label className="field__label">Sortierung</label>
                <input
                  className="field__input" type="number"
                  value={productForm.sort_order}
                  onChange={e => setProductForm(f => ({ ...f, sort_order: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={hasVariants}
                    onChange={e => setHasVariants(e.target.checked)}
                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                  />
                  Hat Varianten
                </label>
              </div>
              {hasVariants && editingProduct && (
                <div className="variants-admin-section">
                  <div className="field__label" style={{ marginBottom: 8 }}>Varianten</div>
                  {productVariants.map(v => (
                    <div key={v.id} className="variant-admin-row">
                      <label className="toggle" style={{ flexShrink: 0 }}>
                        <input type="checkbox" checked={v.available} onChange={() => handleToggleVariant(v)} />
                        <span className="toggle__slider" />
                      </label>
                      <span style={{ flex: 1, fontSize: 14, color: v.available ? 'inherit' : 'var(--text-muted)', textDecoration: v.available ? 'none' : 'line-through' }}>
                        {v.name}
                      </span>
                      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                        {formatDelta(v.price_cents)}
                      </span>
                      <button
                        className="btn btn--ghost btn--sm btn--danger-text"
                        style={{ padding: '2px 6px' }}
                        onClick={() => handleDeleteVariant(v.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {variantDraft ? (
                    <div className="variant-admin-row variant-admin-row--draft">
                      <input
                        className="field__input"
                        placeholder="Name"
                        autoFocus
                        value={variantDraft.name}
                        onChange={e => setVariantDraft(d => d ? { ...d, name: e.target.value } : d)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddVariant(); if (e.key === 'Escape') setVariantDraft(null); }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <div className="price-input" style={{ width: 100, flexShrink: 0 }}>
                        <span className="price-input__prefix">€</span>
                        <input
                          className="price-input__field" type="text" inputMode="decimal" placeholder="gratis"
                          value={variantDraft.price}
                          onChange={e => setVariantDraft(d => d ? { ...d, price: e.target.value } : d)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddVariant(); }}
                        />
                      </div>
                      <button className="btn btn--primary btn--sm" onClick={handleAddVariant} disabled={savingVariant}>+</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setVariantDraft(null)}>✕</button>
                    </div>
                  ) : (
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: 6 }}
                      onClick={() => setVariantDraft({ name: '', price: '' })}
                    >
                      + Variante
                    </button>
                  )}
                </div>
              )}
              {hasVariants && !editingProduct && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Erst speichern, dann Varianten hinzufügen.
                </p>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setShowProductModal(false)}>Abbrechen</button>
              <button className="btn btn--primary" onClick={handleSaveProduct} disabled={savingProduct}>
                {savingProduct ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ CATEGORY MODAL ════════════════ */}
      {showCatModal && (
        <div className="modal-overlay" onClick={() => setShowCatModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">
                {editingCat ? 'Kategorie bearbeiten' : catForm.parent_id ? 'Neue Unterkategorie' : 'Neue Kategorie'}
              </h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowCatModal(false)}>✕</button>
            </div>
            <div className="modal__body">
              {catFormError && <p className="error">{catFormError}</p>}
              <div className="field">
                <label className="field__label">Name</label>
                <input
                  className="field__input" autoFocus
                  value={catForm.name}
                  onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSaveCat()}
                />
              </div>
              <div className="field">
                <label className="field__label">Übergeordnete Kategorie</label>
                <select
                  className="field__input"
                  value={catForm.parent_id}
                  onChange={e => {
                    const pid = e.target.value;
                    const parent = categories.find(c => String(c.id) === pid);
                    setCatForm(f => ({ ...f, parent_id: pid, tax_category: parent?.tax_category ?? f.tax_category }));
                  }}
                >
                  <option value="">— keine (oberste Ebene) —</option>
                  {flatCats
                    .filter(({ cat }) => editingCat == null || !collectDescendantIds(findNode(catTree, editingCat.id)!).includes(cat.id))
                    .map(({ cat, depth }) => (
                      <option key={cat.id} value={String(cat.id)}>
                        {'— '.repeat(depth)}{cat.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label">Steuersatz</label>
                <select
                  className="field__input"
                  value={catForm.tax_category}
                  onChange={e => setCatForm(f => ({ ...f, tax_category: e.target.value as 'standard' | 'reduced' }))}
                >
                  <option value="standard">19 % (Standard)</option>
                  <option value="reduced">7 % (Ermäßigt)</option>
                </select>
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setShowCatModal(false)}>Abbrechen</button>
              <button className="btn btn--primary" onClick={handleSaveCat} disabled={savingCat}>
                {savingCat ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
