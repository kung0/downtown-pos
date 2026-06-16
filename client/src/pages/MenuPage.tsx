import { useState, useEffect, useCallback } from 'react';
import type { Product, Category } from '@downtown/shared';
import { productsApi, categoriesApi } from '../api';
import type { CategoryInput } from '../api';
import { formatMoney, parseMoney, centsToInputValue } from '../utils/money';

// ── helpers ──────────────────────────────────────────────────────────────────

interface CategoryGroup {
  parent: Category;
  children: Category[];
}

function buildTree(cats: Category[]): CategoryGroup[] {
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

// ── product form ──────────────────────────────────────────────────────────────

interface ProductForm { name: string; category: string; price: string; sort_order: string; }
const EMPTY_PRODUCT_FORM: ProductForm = { name: '', category: '', price: '', sort_order: '0' };

function productToForm(p: Product): ProductForm {
  return { name: p.name, category: p.category, price: centsToInputValue(p.price_cents), sort_order: String(p.sort_order) };
}

// ── category form ─────────────────────────────────────────────────────────────

interface CatForm { name: string; parent_id: string; tax_category: 'standard' | 'reduced'; sort_order: string; }
const EMPTY_CAT_FORM: CatForm = { name: '', parent_id: '', tax_category: 'standard', sort_order: '0' };

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
  const childCats = categories.filter(c => c.parent_id !== null);

  // ── product actions ──────────────────────────────────────────────────────

  function openCreateProduct() {
    setEditingProduct(null);
    const firstChild = childCats[0];
    setProductForm({ ...EMPTY_PRODUCT_FORM, category: firstChild?.name ?? '' });
    setProductFormError(null);
    setShowProductModal(true);
  }

  function openEditProduct(p: Product) {
    setEditingProduct(p);
    setProductForm(productToForm(p));
    setProductFormError(null);
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
        sort_order: parseInt(productForm.sort_order, 10) || 0,
      };
      if (editingProduct) {
        const updated = await productsApi.update(editingProduct.id, payload);
        setProducts(prev => prev.map(x => x.id === updated.id ? updated : x));
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

  // ── category actions ─────────────────────────────────────────────────────

  function openCreateParent() {
    setEditingCat(null);
    setCatForm({ ...EMPTY_CAT_FORM, parent_id: '', tax_category: 'standard' });
    setCatFormError(null);
    setShowCatModal(true);
  }

  function openCreateChild(parentId: number) {
    setEditingCat(null);
    const parent = categories.find(c => c.id === parentId);
    setCatForm({ ...EMPTY_CAT_FORM, parent_id: String(parentId), tax_category: parent?.tax_category ?? 'standard' });
    setCatFormError(null);
    setShowCatModal(true);
  }

  function openEditCat(cat: Category) {
    setEditingCat(cat);
    setCatForm({
      name:         cat.name,
      parent_id:    cat.parent_id === null ? '' : String(cat.parent_id),
      tax_category: cat.tax_category,
      sort_order:   String(cat.sort_order),
    });
    setCatFormError(null);
    setShowCatModal(true);
  }

  async function handleSaveCat() {
    if (!catForm.name.trim()) { setCatFormError('Name is required'); return; }

    const isChild  = catForm.parent_id !== '';
    const parentId = isChild ? parseInt(catForm.parent_id, 10) : null;

    setSavingCat(true);
    setCatFormError(null);
    try {
      const payload: CategoryInput = {
        name:         catForm.name.trim(),
        parent_id:    parentId,
        tax_category: catForm.tax_category,
        sort_order:   parseInt(catForm.sort_order, 10) || 0,
      };
      if (editingCat) {
        const updated = await categoriesApi.update(editingCat.id, payload);
        setCategories(prev => prev.map(c => c.id === updated.id ? updated : c));
        // also update product category references in local state if renamed
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

  async function handleDeleteCat(cat: Category) {
    const label = cat.parent_id === null ? `parent category "${cat.name}" and all its subcategories` : `subcategory "${cat.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await categoriesApi.delete(cat.id);
      setCategories(prev => prev.filter(c => c.id !== cat.id && c.parent_id !== cat.id));
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
            <button className="btn btn--primary" onClick={openCreateParent}>+ Kategorie</button>
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
            {catTree.map(({ parent, children }) => {
              const groupItems = children.flatMap(child =>
                products.filter(p => p.category === child.name)
              );
              if (groupItems.length === 0) return null;
              return (
                <tbody key={parent.id}>
                  <tr className="category-parent-header">
                    <td colSpan={5}>{parent.name}</td>
                  </tr>
                  {children.flatMap(child => {
                    const items = products.filter(p => p.category === child.name);
                    if (items.length === 0) return [];
                    return [
                      <tr key={`h-${child.id}`} className="category-header">
                        <td colSpan={5}>{child.name}</td>
                      </tr>,
                      ...items.map(p => (
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
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.price_cents)}</td>
                          <td>
                            <button className="btn btn--ghost btn--sm" onClick={() => openEditProduct(p)}>Edit</button>
                          </td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              );
            })}
            {/* Uncategorized — products whose category isn't in the tree */}
            {(() => {
              const knownCats = new Set(childCats.map(c => c.name));
              const orphans = products.filter(p => !knownCats.has(p.category));
              if (orphans.length === 0) return null;
              return (
                <tbody>
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
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.price_cents)}</td>
                      <td><button className="btn btn--ghost btn--sm" onClick={() => openEditProduct(p)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              );
            })()}
          </table>
        </div>
      )}

      {/* ════════════════ CATEGORIES VIEW ════════════════ */}
      {view === 'categories' && (
        <div className="cat-tree">
          {catTree.length === 0 && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
              No categories yet — add one above.
            </p>
          )}
          {catTree.map(({ parent, children }) => (
            <div key={parent.id} className="cat-group">
              <div className="cat-parent-row">
                <span className="cat-parent-row__name">{parent.name}</span>
                <div className="cat-row-actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => openEditCat(parent)}>Edit</button>
                  <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => handleDeleteCat(parent)}>Delete</button>
                </div>
              </div>

              <div className="cat-children">
                {children.map(child => (
                  <div key={child.id} className="cat-child-row">
                    <span className="cat-child-row__name">{child.name}</span>
                    <span className={`cat-tax-badge cat-tax-badge--${child.tax_category}`}>
                      {child.tax_category === 'reduced' ? '7 %' : '19 %'}
                    </span>
                    <div className="cat-row-actions">
                      <button className="btn btn--ghost btn--sm" onClick={() => openEditCat(child)}>Edit</button>
                      <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => handleDeleteCat(child)}>Delete</button>
                    </div>
                  </div>
                ))}
                <button className="cat-add-child-btn" onClick={() => openCreateChild(parent.id)}>
                  + Unterkategorie
                </button>
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
                  {catTree.map(({ parent, children }) => (
                    <optgroup key={parent.id} label={parent.name}>
                      {children.map(child => (
                        <option key={child.id} value={child.name}>{child.name}</option>
                      ))}
                    </optgroup>
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
                {editingCat
                  ? `Kategorie bearbeiten`
                  : catForm.parent_id
                    ? 'Neue Unterkategorie'
                    : 'Neue Elternkategorie'}
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
                <label className="field__label">Elternkategorie</label>
                <select
                  className="field__input"
                  value={catForm.parent_id}
                  onChange={e => setCatForm(f => ({ ...f, parent_id: e.target.value }))}
                >
                  <option value="">— keine (ist selbst Elternelement) —</option>
                  {catTree.map(({ parent }) => (
                    <option key={parent.id} value={String(parent.id)}>{parent.name}</option>
                  ))}
                </select>
              </div>
              {catForm.parent_id !== '' && (
                <div className="field">
                  <label className="field__label">Steuersatz</label>
                  <select
                    className="field__input"
                    value={catForm.tax_category}
                    onChange={e => setCatForm(f => ({ ...f, tax_category: e.target.value as 'standard' | 'reduced' }))}
                  >
                    <option value="standard">Standard 19 %</option>
                    <option value="reduced">Ermäßigt 7 %</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field__label">Sortierung</label>
                <input
                  className="field__input" type="number"
                  value={catForm.sort_order}
                  onChange={e => setCatForm(f => ({ ...f, sort_order: e.target.value }))}
                />
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
