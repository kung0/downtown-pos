import { useDroppable } from '@dnd-kit/core';
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
