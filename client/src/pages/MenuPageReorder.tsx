import { useDroppable, DragOverlay } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Product, Category } from '@downtown/shared';
import { formatMoney } from '../utils/money';
import { buildTree, flattenTree } from '../utils/categoryTree';

// ── SortableProductRow ───────────────────────────────────────────────────────

interface SortableProductRowProps {
  product: Product;
}

export function SortableProductRow({ product }: SortableProductRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
  });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="reorder-product-row">
      <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
      <span style={{ flex: 1 }}>{product.name}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {product.has_variants
          ? `${product.variants?.length ?? 0} Varianten`
          : formatMoney(product.price_cents)}
      </span>
    </div>
  );
}

// ── ProductDropZone ──────────────────────────────────────────────────────────

interface ProductDropZoneProps {
  categoryName: string;
  hasProducts: boolean;
  children: React.ReactNode;
}

export function ProductDropZone({ categoryName, hasProducts, children }: ProductDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `cat:${categoryName}` });
  return (
    <div
      ref={setNodeRef}
      className={`reorder-product-group__drop-zone${isOver ? ' reorder-product-group__drop-zone--over' : ''}`}
      style={{ minHeight: hasProducts ? undefined : 32 }}
    >
      {children}
    </div>
  );
}

// ── ReorderProductsView ──────────────────────────────────────────────────────

interface ReorderProductsViewProps {
  draftProducts: Product[];
  categories: Category[];
}

export function ReorderProductsView({ draftProducts, categories }: ReorderProductsViewProps) {
  const flatCats = flattenTree(buildTree(categories));
  const knownCatNames = new Set(categories.map(c => c.name));

  // Groups in display order: one per category that has products in draft
  const groups = flatCats
    .map(({ cat, depth }) => ({
      cat,
      depth,
      prods: draftProducts.filter(p => p.category === cat.name),
    }))
    .filter(g => g.prods.length > 0);

  // Orphaned products (category no longer exists)
  const orphans = draftProducts.filter(p => !knownCatNames.has(p.category));

  return (
    <>
      {groups.map(({ cat, depth, prods }) => (
        <div key={cat.id} className="reorder-product-group">
          <div
            className="reorder-product-group__header"
            style={depth > 0 ? { paddingLeft: depth * 16 + 14 } : undefined}
          >
            {cat.name}
          </div>
          <ProductDropZone categoryName={cat.name} hasProducts={prods.length > 0}>
            <SortableContext items={prods.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {prods.map(p => <SortableProductRow key={p.id} product={p} />)}
            </SortableContext>
          </ProductDropZone>
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="reorder-product-group">
          <div className="reorder-product-group__header">Andere</div>
          <ProductDropZone categoryName="__orphan__" hasProducts>
            <SortableContext items={orphans.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {orphans.map(p => <SortableProductRow key={p.id} product={p} />)}
            </SortableContext>
          </ProductDropZone>
        </div>
      )}
    </>
  );
}

// ── SortableCategoryRow ──────────────────────────────────────────────────────

interface SortableCategoryRowProps {
  cat: Category;
  depth: number;
}

export function SortableCategoryRow({ cat, depth }: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.2 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cat-row${depth === 0 ? ' cat-row--root' : ''}`}
    >
      <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
      {depth > 0 && <div className="cat-row__spacer" style={{ width: depth * 20 }} />}
      <span className="cat-row__name">{cat.name}</span>
      <span className={`cat-tax-badge cat-tax-badge--${cat.tax_category}`}>
        {cat.tax_category === 'reduced' ? '7 %' : '19 %'}
      </span>
    </div>
  );
}

// ── ReorderCategoriesView ────────────────────────────────────────────────────

interface ReorderCategoriesViewProps {
  draftCategories: Category[];
  dragActiveId: number | null;
  dragDepth: number;
}

export function ReorderCategoriesView({
  draftCategories,
  dragActiveId,
  dragDepth,
}: ReorderCategoriesViewProps) {
  const flat = flattenTree(buildTree(draftCategories));
  const activeCat = dragActiveId != null ? draftCategories.find(c => c.id === dragActiveId) : null;

  return (
    <>
      <div className="cat-list">
        <SortableContext items={flat.map(fc => fc.cat.id)} strategy={verticalListSortingStrategy}>
          {flat.map(({ cat, depth }) => (
            <SortableCategoryRow key={cat.id} cat={cat} depth={depth} />
          ))}
        </SortableContext>
      </div>
      <DragOverlay>
        {activeCat != null ? (
          <div className={`cat-row${dragDepth === 0 ? ' cat-row--root' : ''}`}
            style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'grabbing' }}
          >
            <span className="drag-handle">⠿</span>
            {dragDepth > 0 && <div className="cat-row__spacer" style={{ width: dragDepth * 20 }} />}
            <span className="cat-row__name">{activeCat.name}</span>
            <span className={`cat-tax-badge cat-tax-badge--${activeCat.tax_category}`}>
              {activeCat.tax_category === 'reduced' ? '7 %' : '19 %'}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </>
  );
}
