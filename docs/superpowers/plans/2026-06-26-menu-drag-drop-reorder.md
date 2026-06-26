# Menu Drag-and-Drop Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "edit order" mode to the Menu page's Products and Categories tabs so users can drag-and-drop items (including cross-category moves) and categories (including reparenting) into a new order, then persist with a single save button.

**Architecture:** A "Reihenfolge" button in the menu header enters an edit-order mode that clones the current list into local draft state. All drag operations mutate the draft. "Speichern" sends one bulk PATCH to the server; "Abbrechen" discards the draft. Products switch from a `<table>` layout to a flex-list in reorder mode to avoid CSS-transform issues with `<tr>` elements. Categories use horizontal drag offset to determine reparenting depth.

**Tech Stack:** React 18, `@dnd-kit/core` + `@dnd-kit/sortable` (touch-capable), Node/Express, better-sqlite3, TypeScript, Vitest.

## Global Constraints

- Money is never involved in this feature, but all existing rules still apply to unchanged code.
- No schema changes — `sort_order` columns already exist on `products`, `categories`, and `product_variants`.
- `PATCH /api/products/reorder` and `PATCH /api/categories/reorder` must run in a single SQLite transaction.
- Categories reorder must pass cycle detection (server-side, and client-side for fast feedback).
- All UI copy is German.
- No floats, no table numbers — none of this feature touches money or tabs.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `client/src/utils/categoryTree.ts` | **Create** | Pure tree helpers + reorder logic (extracted from MenuPage) |
| `client/src/utils/categoryTree.test.ts` | **Create** | Vitest unit tests for tree/reorder helpers |
| `client/src/pages/MenuPageReorder.tsx` | **Create** | Sortable row components for products and categories |
| `client/src/pages/MenuPage.tsx` | **Modify** | Import tree utils from new file, add reorder mode state/UI |
| `client/src/api/index.ts` | **Modify** | Handle 204, add `reorder` methods to productsApi and categoriesApi |
| `client/package.json` | **Modify** | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `server/src/routes/products.ts` | **Modify** | Add `PATCH /reorder` endpoint |
| `server/src/routes/categories.ts` | **Modify** | Add `PATCH /reorder` endpoint |
| `client/src/index.css` | **Modify** | Add drag handle, reorder banner, reorder product row styles |

---

### Task 1: Extract category tree helpers and add reorder logic

**Files:**
- Create: `client/src/utils/categoryTree.ts`
- Create: `client/src/utils/categoryTree.test.ts`
- Modify: `client/src/pages/MenuPage.tsx` (remove duplicated helpers, add import)

**Interfaces:**
- Produces:
  - `TreeNode`, `buildTree`, `flattenTree`, `findNode`, `collectDescendantIds` (moved from MenuPage)
  - `applyCategoryReorder(cats, activeId, overId, targetDepth): Category[]`
  - `detectCycle(cats): boolean`

- [ ] **Step 1: Write the failing tests**

Create `client/src/utils/categoryTree.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTree, flattenTree, applyCategoryReorder, detectCycle } from './categoryTree';
import type { Category } from '@downtown/shared';

function cat(id: number, name: string, parent_id: number | null, sort_order = 0): Category {
  return { id, name, parent_id, sort_order, tax_category: 'standard', created_at: '' };
}

describe('buildTree + flattenTree', () => {
  it('builds a two-level tree in sort_order', () => {
    const cats = [cat(1, 'Drinks', null, 0), cat(2, 'Food', null, 1), cat(3, 'Beer', 1, 0)];
    const flat = flattenTree(buildTree(cats));
    expect(flat.map(f => f.cat.name)).toEqual(['Drinks', 'Beer', 'Food']);
    expect(flat.map(f => f.depth)).toEqual([0, 1, 0]);
  });
});

describe('detectCycle', () => {
  it('returns false for a valid tree', () => {
    const cats = [cat(1, 'A', null), cat(2, 'B', 1)];
    expect(detectCycle(cats)).toBe(false);
  });

  it('detects a self-loop', () => {
    const cats = [cat(1, 'A', 1)];
    expect(detectCycle(cats)).toBe(true);
  });

  it('detects a mutual reference', () => {
    const cats = [cat(1, 'A', 2), cat(2, 'B', 1)];
    expect(detectCycle(cats)).toBe(true);
  });
});

describe('applyCategoryReorder', () => {
  it('reorders siblings within the same level', () => {
    const cats = [cat(1, 'A', null, 0), cat(2, 'B', null, 1)];
    const result = applyCategoryReorder(cats, 2, 1, 0);
    expect(result.find(c => c.id === 2)!.sort_order).toBe(0);
    expect(result.find(c => c.id === 1)!.sort_order).toBe(1);
  });

  it('reparents a root category to become a child', () => {
    // B is root. Drag B after A at depth 1 → B becomes child of A
    const cats = [cat(1, 'A', null, 0), cat(2, 'B', null, 1)];
    const result = applyCategoryReorder(cats, 2, 1, 1);
    expect(result.find(c => c.id === 2)!.parent_id).toBe(1);
  });

  it('moves a subcategory to root level', () => {
    // B is child of A. Drag B after A at depth 0 → B becomes root
    const cats = [cat(1, 'A', null, 0), cat(2, 'B', 1, 0)];
    const result = applyCategoryReorder(cats, 2, 1, 0);
    expect(result.find(c => c.id === 2)!.parent_id).toBeNull();
  });

  it('moves a subtree together', () => {
    // A (root) → B (child). Move A after C at root level.
    const cats = [cat(1, 'A', null, 0), cat(2, 'B', 1, 0), cat(3, 'C', null, 1)];
    const result = applyCategoryReorder(cats, 1, 3, 0);
    const flat = flattenTree(buildTree(result));
    expect(flat.map(f => f.cat.name)).toEqual(['C', 'A', 'B']);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/kevin.nguyen/downtown-pos/server && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: Tests fail because `categoryTree.ts` doesn't exist yet.

- [ ] **Step 3: Create `client/src/utils/categoryTree.ts`**

```typescript
import type { Category } from '@downtown/shared';

export interface TreeNode {
  cat: Category;
  children: TreeNode[];
}

export function buildTree(cats: Category[]): TreeNode[] {
  const byParent = new Map<number | null, Category[]>();
  cats.forEach(c => {
    const key = c.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  });
  const sort = (list: Category[]) =>
    [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  function nodes(parentId: number | null): TreeNode[] {
    return sort(byParent.get(parentId) ?? []).map(cat => ({ cat, children: nodes(cat.id) }));
  }
  return nodes(null);
}

export function flattenTree(nodes: TreeNode[], depth = 0): Array<{ cat: Category; depth: number }> {
  return nodes.flatMap(n => [{ cat: n.cat, depth }, ...flattenTree(n.children, depth + 1)]);
}

export function findNode(nodes: TreeNode[], id: number): TreeNode | undefined {
  for (const n of nodes) {
    if (n.cat.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
}

export function collectDescendantIds(node: TreeNode): number[] {
  return [node.cat.id, ...node.children.flatMap(collectDescendantIds)];
}

export function detectCycle(cats: Category[]): boolean {
  const parentMap = new Map(cats.map(c => [c.id, c.parent_id]));
  for (const cat of cats) {
    const seen = new Set<number>();
    let cursor = cat.parent_id;
    while (cursor !== null) {
      if (cursor === cat.id) return true;
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentMap.get(cursor) ?? null;
    }
  }
  return false;
}

/**
 * Moves `activeId` to appear after `overId` in the flat DFS tree order,
 * assigns the given `targetDepth` (which determines new parent_id),
 * and recalculates all sort_order values.
 * The entire subtree of activeId moves with it.
 */
export function applyCategoryReorder(
  cats: Category[],
  activeId: number,
  overId: number | null,
  targetDepth: number
): Category[] {
  const tree = buildTree(cats);
  const flat = flattenTree(tree);

  const activeNode = findNode(tree, activeId);
  if (!activeNode) return cats;

  const subtreeIds = new Set(collectDescendantIds(activeNode));

  // Flat list without the active subtree
  const withoutSubtree = flat.filter(fc => !subtreeIds.has(fc.cat.id));

  // Find insertion point (after overId in the pruned list)
  const overIdx = overId != null ? withoutSubtree.findIndex(fc => fc.cat.id === overId) : -1;
  const insertAt = overIdx >= 0 ? overIdx + 1 : withoutSubtree.length;

  // Determine new parent from targetDepth
  const clampedDepth = Math.max(0, targetDepth);
  let newParentId: number | null = null;
  if (clampedDepth > 0) {
    for (let i = insertAt - 1; i >= 0; i--) {
      if (withoutSubtree[i].depth === clampedDepth - 1) {
        newParentId = withoutSubtree[i].cat.id;
        break;
      }
    }
    // If no suitable parent found at that depth, stays at root (newParentId = null)
  }

  // Active subtree in DFS order; root gets updated parent_id, descendants keep their relative parent
  const activeSubtreeItems = flat
    .filter(fc => subtreeIds.has(fc.cat.id))
    .map(fc => fc.cat.id === activeId ? { ...fc.cat, parent_id: newParentId } : fc.cat);

  // Merge back into ordered list
  const orderedCats: Category[] = [
    ...withoutSubtree.slice(0, insertAt).map(fc => fc.cat),
    ...activeSubtreeItems,
    ...withoutSubtree.slice(insertAt).map(fc => fc.cat),
  ];

  // Recalculate sort_order per sibling group (keyed by parent_id string)
  const counters = new Map<string, number>();
  return orderedCats.map(cat => {
    const key = String(cat.parent_id);
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    return { ...cat, sort_order: n };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kevin.nguyen/downtown-pos/server && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: All `categoryTree` tests pass.

- [ ] **Step 5: Update MenuPage.tsx to use the new utils**

At the top of `client/src/pages/MenuPage.tsx`, remove the locally defined `TreeNode`, `buildTree`, `flattenTree`, `findNode`, `collectDescendantIds` and replace with:

```typescript
import { buildTree, flattenTree, findNode, collectDescendantIds } from '../utils/categoryTree';
import type { TreeNode } from '../utils/categoryTree';
```

Remove the `hasProducts` function too — it stays in MenuPage since it uses `products` state and is only needed there. Keep it as a local function.

Also remove these interfaces/functions from MenuPage.tsx (lines 14–53):
```typescript
// DELETE these from MenuPage.tsx:
interface TreeNode { ... }
function buildTree(...) { ... }
function flattenTree(...) { ... }
function hasProducts(...) { ... }   // keep this one — it's MenuPage-specific
function collectDescendantIds(...) { ... }
function findNode(...) { ... }
```

`hasProducts` stays in MenuPage. The others move to the new util.

- [ ] **Step 6: Verify the app still compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/categoryTree.ts client/src/utils/categoryTree.test.ts client/src/pages/MenuPage.tsx
git commit -m "Extract category tree helpers to util; add applyCategoryReorder + detectCycle"
```

---

### Task 2: Install @dnd-kit and update API client

**Files:**
- Modify: `client/package.json`
- Modify: `client/src/api/index.ts`

**Interfaces:**
- Produces:
  - `productsApi.reorder(items: ProductReorderItem[]): Promise<void>`
  - `categoriesApi.reorder(items: CategoryReorderItem[]): Promise<void>`
  - `req<T>` now returns `undefined` (as T) for 204 responses

- [ ] **Step 1: Install @dnd-kit packages**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: `package.json` updated, no errors.

- [ ] **Step 2: Fix `req` to handle 204 responses**

In `client/src/api/index.ts`, update the `req` function (the last line before the closing brace):

Old:
```typescript
  return res.json() as Promise<T>;
```

New:
```typescript
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
```

- [ ] **Step 3: Add reorder types and API methods**

In `client/src/api/index.ts`, add after the `CategoryInput` interface:

```typescript
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
```

Add `reorder` to `categoriesApi`:
```typescript
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
```

Add `reorder` to `productsApi`:
```typescript
export const productsApi = {
  list: () => req<Product[]>('/products'),
  create: (data: ProductInput) =>
    req<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: ProductInput & { has_variants?: boolean }) =>
    req<Product>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleAvailability: (id: number) =>
    req<Product>(`/products/${id}/availability`, { method: 'PATCH' }),
  reorder: (items: ProductReorderItem[]) =>
    req<void>('/products/reorder', { method: 'PATCH', body: JSON.stringify(items) }),
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/package-lock.json client/src/api/index.ts
git commit -m "Add @dnd-kit deps; add reorder API methods; fix req() for 204"
```

---

### Task 3: Server — products reorder endpoint

**Files:**
- Modify: `server/src/routes/products.ts`

**Interfaces:**
- Consumes: `PATCH /api/products/reorder` body: `[{ id, sort_order, category }]`
- Produces: `204 No Content` on success

- [ ] **Step 1: Add the endpoint to `server/src/routes/products.ts`**

Add this block **before** the `router.put('/:id', ...)` route (so that `/reorder` is never matched as `/:id`):

```typescript
router.patch('/reorder', (req: Request, res: Response) => {
  const items = req.body as Array<{ id: number; sort_order: number; category: string }>;
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'body must be a non-empty array' });
  }

  // Validate all categories exist up front
  for (const item of items) {
    if (!resolveCategory(item.category)) {
      return void res.status(400).json({ error: `invalid category: ${item.category}` });
    }
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE products SET sort_order = ?, category = ?, tax_category = ?, updated_at = ? WHERE id = ?'
  );

  db.transaction(() => {
    for (const item of items) {
      const cat = resolveCategory(item.category)!;
      stmt.run(item.sort_order, item.category, cat.tax_category, now, item.id);
    }
  })();

  const updated = items.map(({ id }) =>
    attachVariants([normalize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!)])[0]
  );
  for (const product of updated) {
    broadcast({ type: 'menu:product_updated', data: product });
  }

  res.status(204).send();
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/server && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 3: Start the dev server and test with curl**

In one terminal: `npm run dev` (from repo root or server dir — whatever starts the server).

Then in another terminal:

```bash
# Get a valid category name first
curl -s http://localhost:3001/api/categories | python3 -m json.tool | grep '"name"' | head -5

# Replace CATEGORY_NAME and IDs with real values from your DB
curl -s -X PATCH http://localhost:3001/api/products/reorder \
  -H 'Content-Type: application/json' \
  -d '[{"id":1,"sort_order":0,"category":"CATEGORY_NAME"},{"id":2,"sort_order":1,"category":"CATEGORY_NAME"}]' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 204` with no body.

```bash
# Test invalid category
curl -s -X PATCH http://localhost:3001/api/products/reorder \
  -H 'Content-Type: application/json' \
  -d '[{"id":1,"sort_order":0,"category":"DOES_NOT_EXIST"}]' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 400` with `{"error":"invalid category: DOES_NOT_EXIST"}`.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/products.ts
git commit -m "Add PATCH /api/products/reorder endpoint"
```

---

### Task 4: Server — categories reorder endpoint

**Files:**
- Modify: `server/src/routes/categories.ts`

**Interfaces:**
- Consumes: `PATCH /api/categories/reorder` body: `[{ id, sort_order, parent_id }]`
- Produces: `204 No Content` on success, or `400` with `"circular reference detected"`

- [ ] **Step 1: Add the endpoint to `server/src/routes/categories.ts`**

Add this block **before** the `router.put('/:id', ...)` route:

```typescript
router.patch('/reorder', (req: Request, res: Response) => {
  const items = req.body as Array<{ id: number; sort_order: number; parent_id: number | null }>;
  if (!Array.isArray(items) || items.length === 0) {
    return void res.status(400).json({ error: 'body must be a non-empty array' });
  }

  // Build proposed parent map for cycle detection
  const parentMap = new Map<number, number | null>(items.map(i => [i.id, i.parent_id]));

  for (const item of items) {
    const seen = new Set<number>();
    let cursor = item.parent_id;
    while (cursor !== null) {
      if (cursor === item.id) {
        return void res.status(400).json({ error: 'circular reference detected' });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentMap.has(cursor) ? (parentMap.get(cursor) ?? null) : null;
    }
  }

  const stmt = db.prepare('UPDATE categories SET sort_order = ?, parent_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, item.parent_id, item.id);
    }
  })();

  res.status(204).send();
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/server && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 3: Test with curl**

```bash
# Get category IDs first
curl -s http://localhost:3001/api/categories | python3 -m json.tool | grep '"id"\|"name"\|"parent_id"'

# Reorder two root categories (adjust IDs to real values)
curl -s -X PATCH http://localhost:3001/api/categories/reorder \
  -H 'Content-Type: application/json' \
  -d '[{"id":1,"sort_order":1,"parent_id":null},{"id":2,"sort_order":0,"parent_id":null}]' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 204`.

```bash
# Test cycle detection (cat 1 as child of cat 2, cat 2 as child of cat 1)
curl -s -X PATCH http://localhost:3001/api/categories/reorder \
  -H 'Content-Type: application/json' \
  -d '[{"id":1,"sort_order":0,"parent_id":2},{"id":2,"sort_order":0,"parent_id":1}]' \
  -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 400` with `{"error":"circular reference detected"}`.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/categories.ts
git commit -m "Add PATCH /api/categories/reorder endpoint with cycle detection"
```

---

### Task 5: CSS for drag-and-drop UI

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Add styles to `client/src/index.css`**

Append at the end of the file:

```css
/* ── Drag-and-drop reorder ─────────────────────────────────────────────────── */

.drag-handle {
  cursor: grab;
  color: var(--text-muted);
  font-size: 16px;
  padding: 0 6px;
  flex-shrink: 0;
  line-height: 1;
  user-select: none;
  touch-action: none;
}
.drag-handle:active { cursor: grabbing; }

.reorder-banner {
  background: #ebf4ff;
  color: #2b6cb0;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius);
  margin-bottom: 12px;
  text-align: center;
}

.reorder-product-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-height: 44px;
  font-size: 14px;
}
.reorder-product-row:last-child { border-bottom: none; }

.reorder-product-group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 8px;
  box-shadow: var(--shadow-sm);
}

.reorder-product-group__header {
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: #edf2f7;
  color: var(--text-muted);
}

.reorder-product-group__drop-zone {
  min-height: 32px;
}
.reorder-product-group__drop-zone--over {
  background: #ebf4ff;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "Add CSS for drag-and-drop reorder mode"
```

---

### Task 6: Reorder mode state and header in MenuPage

**Files:**
- Modify: `client/src/pages/MenuPage.tsx`

**Interfaces:**
- Produces:
  - `isReordering: boolean` state
  - `draftProducts: Product[]` state  
  - `draftCategories: Category[]` state
  - `savingOrder: boolean` state
  - `reorderError: string | null` state
  - `enterReorderMode()` function
  - `cancelReorder()` function

- [ ] **Step 1: Add reorder mode state to `MenuPage`**

In the "// shared data" state block of MenuPage.tsx, add after the existing state declarations:

```typescript
// reorder mode
const [isReordering,     setIsReordering]     = useState(false);
const [draftProducts,    setDraftProducts]     = useState<Product[]>([]);
const [draftCategories,  setDraftCategories]   = useState<Category[]>([]);
const [savingOrder,      setSavingOrder]       = useState(false);
const [reorderError,     setReorderError]      = useState<string | null>(null);
```

- [ ] **Step 2: Add enter/cancel handlers**

Add these two functions in the "// product actions" section (before the existing product action functions):

```typescript
function enterReorderMode() {
  setDraftProducts([...products]);
  setDraftCategories([...categories]);
  setReorderError(null);
  setIsReordering(true);
}

function cancelReorder() {
  setIsReordering(false);
  setReorderError(null);
}
```

- [ ] **Step 3: Update the page header in the render section**

Replace the existing header `<div style={{ display: 'flex', gap: 8 }}>` block (the one containing the "+ Produkt" / "+ Kategorie" buttons) with:

```tsx
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
  {isReordering ? (
    <>
      {reorderError && (
        <span style={{ fontSize: 13, color: 'var(--error, #e53e3e)' }}>{reorderError}</span>
      )}
      <button className="btn btn--ghost" onClick={cancelReorder} disabled={savingOrder}>
        Abbrechen
      </button>
      <button
        className="btn btn--primary"
        onClick={view === 'products' ? handleSaveProductOrder : handleSaveCategoryOrder}
        disabled={savingOrder}
      >
        {savingOrder ? 'Speichern…' : 'Speichern'}
      </button>
    </>
  ) : (
    <>
      <button className="btn btn--ghost btn--sm" onClick={enterReorderMode}>
        Reihenfolge
      </button>
      {view === 'products' && (
        <button className="btn btn--primary" onClick={openCreateProduct}>+ Produkt</button>
      )}
      {view === 'categories' && (
        <button className="btn btn--primary" onClick={() => openCreateCat()}>+ Kategorie</button>
      )}
    </>
  )}
</div>
```

Note: `handleSaveProductOrder` and `handleSaveCategoryOrder` will be added in Tasks 7 and 8. TypeScript will complain until then — that's expected. You can add stub functions temporarily:

```typescript
async function handleSaveProductOrder() { /* Task 7 */ }
async function handleSaveCategoryOrder() { /* Task 8 */ }
```

- [ ] **Step 4: Add the reorder banner above the tab switcher**

Add this just before the `{/* ── Tab switcher ── */}` comment:

```tsx
{isReordering && (
  <div className="reorder-banner">Ziehen zum Sortieren — Änderungen werden erst beim Speichern übernommen</div>
)}
```

- [ ] **Step 5: Verify TypeScript compiles (with stubs)**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npx tsc --noEmit 2>&1
```

Expected: No errors (the stub functions satisfy the type checker).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/MenuPage.tsx
git commit -m "Add reorder mode state, header UI, and banner to MenuPage"
```

---

### Task 7: Product drag-and-drop

**Files:**
- Create: `client/src/pages/MenuPageReorder.tsx`
- Modify: `client/src/pages/MenuPage.tsx`

**Interfaces:**
- Consumes:
  - `draftProducts`, `setDraftProducts` from MenuPage state
  - `flattenTree(buildTree(categories))` for category group ordering
  - `productsApi.reorder(items)` from api
- Produces:
  - `<ReorderProductsView>` component (used in products view branch)
  - `handleSaveProductOrder()` in MenuPage

- [ ] **Step 1: Create `client/src/pages/MenuPageReorder.tsx` with sortable product components**

```typescript
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
```

- [ ] **Step 2: Add product DnD wiring to MenuPage.tsx**

Add these imports at the top of MenuPage.tsx:

```typescript
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { ReorderProductsView } from './MenuPageReorder';
import { productsApi, categoriesApi } from '../api';
// (categoriesApi was already imported — just add to the existing import if needed)
```

Add these functions inside the `MenuPage` component, in the product actions section:

```typescript
const dndSensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
);

function onProductDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over) return;

  const activeId = active.id as number;
  const overId = over.id;

  // Determine target category
  let targetCategory: string;
  let overProductId: number | null = null;

  if (typeof overId === 'string' && overId.startsWith('cat:')) {
    targetCategory = overId.slice(4);
  } else {
    overProductId = overId as number;
    const overProd = draftProducts.find(p => p.id === overProductId);
    if (!overProd) return;
    targetCategory = overProd.category;
  }

  const activeProd = draftProducts.find(p => p.id === activeId);
  if (!activeProd) return;

  setDraftProducts(prev => {
    const withoutActive = prev.filter(p => p.id !== activeId);
    const movedProd = { ...activeProd, category: targetCategory };

    let insertAt: number;
    if (overProductId !== null && overProductId !== activeId) {
      insertAt = withoutActive.findIndex(p => p.id === overProductId);
      if (insertAt < 0) insertAt = withoutActive.length;
    } else {
      // Dropped onto a category zone — append at end of that group
      const lastInGroup = withoutActive.reduce(
        (acc, p, i) => (p.category === targetCategory ? i : acc),
        -1
      );
      insertAt = lastInGroup + 1;
    }

    const result = [...withoutActive];
    result.splice(insertAt, 0, movedProd);

    // Recalculate sort_order per group
    const counters = new Map<string, number>();
    return result.map(p => {
      const n = counters.get(p.category) ?? 0;
      counters.set(p.category, n + 1);
      return { ...p, sort_order: n };
    });
  });
}

async function handleSaveProductOrder() {
  setSavingOrder(true);
  setReorderError(null);
  try {
    await productsApi.reorder(
      draftProducts.map(p => ({ id: p.id, sort_order: p.sort_order, category: p.category }))
    );
    setProducts(draftProducts);
    setIsReordering(false);
  } catch (e) {
    setReorderError((e as Error).message);
  } finally {
    setSavingOrder(false);
  }
}
```

- [ ] **Step 3: Wire `ReorderProductsView` into the products view branch**

In the `{/* ════ PRODUCTS VIEW ════ */}` section of MenuPage.tsx, wrap the existing `<div className="table-container">` with a conditional so that reorder mode shows a different layout:

```tsx
{view === 'products' && (
  isReordering ? (
    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onProductDragEnd}>
      <ReorderProductsView draftProducts={draftProducts} categories={categories} />
    </DndContext>
  ) : (
    <div className="table-container">
      {/* ... existing table unchanged ... */}
    </div>
  )
)}
```

Remove the stub `handleSaveProductOrder` added in Task 6.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 5: Manual smoke test**

Start the dev server (`npm run dev` from the repo root). In the browser:
1. Navigate to Menu → Produkte tab
2. Click "Reihenfolge" — banner appears, table is replaced by the drag list
3. Drag a product up or down within its category — it moves
4. Drag a product to a different category group — it moves and shows its new category
5. Click "Abbrechen" — original order is restored with no API call
6. Drag to reorder again, click "Speichern" — HTTP 204, order persists after page refresh

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/MenuPageReorder.tsx client/src/pages/MenuPage.tsx
git commit -m "Add product drag-and-drop reorder mode with cross-category support"
```

---

### Task 8: Category drag-and-drop with reparenting

**Files:**
- Modify: `client/src/pages/MenuPageReorder.tsx`
- Modify: `client/src/pages/MenuPage.tsx`

**Interfaces:**
- Consumes:
  - `applyCategoryReorder` and `detectCycle` from `../utils/categoryTree`
  - `draftCategories`, `setDraftCategories` from MenuPage state
  - `categoriesApi.reorder(items)` from api
- Produces:
  - `<SortableCategoryRow>` component
  - `handleSaveCategoryOrder()` in MenuPage

- [ ] **Step 1: Add `SortableCategoryRow` to `MenuPageReorder.tsx`**

Add these imports to the top of `client/src/pages/MenuPageReorder.tsx`:

```typescript
import { DragOverlay } from '@dnd-kit/core';
```

Add the component and the `ReorderCategoriesView` at the bottom of the file:

```typescript
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
```

- [ ] **Step 2: Add category DnD state and handlers to MenuPage.tsx**

Add these new imports at the top of MenuPage.tsx:

```typescript
import type { DragStartEvent, DragMoveEvent } from '@dnd-kit/core';
import { applyCategoryReorder, detectCycle } from '../utils/categoryTree';
import { ReorderCategoriesView } from './MenuPageReorder';
```

Add state for category dragging inside the component (near the other reorder state):

```typescript
const [dragActiveId, setDragActiveId] = useState<number | null>(null);
const [dragDepth,    setDragDepth]    = useState(0);
```

Add these three event handlers (in the category actions section, near the bottom of the actions):

```typescript
function onCatDragStart(event: DragStartEvent) {
  const id = event.active.id as number;
  setDragActiveId(id);
  const flat = flattenTree(buildTree(draftCategories));
  setDragDepth(flat.find(fc => fc.cat.id === id)?.depth ?? 0);
}

function onCatDragMove(event: DragMoveEvent) {
  if (dragActiveId === null) return;
  const flat = flattenTree(buildTree(draftCategories));
  const baseDepth = flat.find(fc => fc.cat.id === dragActiveId)?.depth ?? 0;
  // 30px per indent level — feels natural on both pointer and touch
  const newDepth = Math.max(0, baseDepth + Math.round(event.delta.x / 30));
  setDragDepth(newDepth);
}

function onCatDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  setDragActiveId(null);

  if (!over) { setDragDepth(0); return; }

  const activeId = active.id as number;
  const overId = active.id === over.id ? null : (over.id as number);

  setDraftCategories(prev => applyCategoryReorder(prev, activeId, overId, dragDepth));
  setDragDepth(0);
}

async function handleSaveCategoryOrder() {
  if (detectCycle(draftCategories)) {
    setReorderError('Reihenfolge erzeugt eine kreisförmige Referenz. Bitte neu anordnen.');
    return;
  }
  setSavingOrder(true);
  setReorderError(null);
  try {
    await categoriesApi.reorder(
      draftCategories.map(c => ({ id: c.id, sort_order: c.sort_order, parent_id: c.parent_id }))
    );
    setCategories(draftCategories);
    setIsReordering(false);
  } catch (e) {
    setReorderError((e as Error).message);
  } finally {
    setSavingOrder(false);
  }
}
```

Remove the stub `handleSaveCategoryOrder` added in Task 6.

- [ ] **Step 3: Wire `ReorderCategoriesView` into the categories view branch**

In the `{/* ════ CATEGORIES VIEW ════ */}` section, replace the existing `<div className="cat-list">...` with:

```tsx
{view === 'categories' && (
  isReordering ? (
    <DndContext
      sensors={dndSensors}
      collisionDetection={closestCenter}
      onDragStart={onCatDragStart}
      onDragMove={onCatDragMove}
      onDragEnd={onCatDragEnd}
    >
      <ReorderCategoriesView
        draftCategories={draftCategories}
        dragActiveId={dragActiveId}
        dragDepth={dragDepth}
      />
    </DndContext>
  ) : (
    <div className="cat-list">
      {/* ... existing cat-list content unchanged ... */}
    </div>
  )
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kevin.nguyen/downtown-pos/client && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 5: Manual smoke test**

In the browser:
1. Navigate to Menu → Kategorien tab
2. Click "Reihenfolge"
3. Drag a root category up or down — it reorders; the DragOverlay shows it at the correct depth
4. Drag a root category to the right while dropping after another category — it indents and becomes a subcategory; the DragOverlay shows the increased indent
5. Drag a subcategory to the left while dropping at the root level — it becomes a root category
6. Click "Abbrechen" — original structure restored
7. Reorder and click "Speichern" — 204, persists after page refresh
8. Verify that subcategories still appear under their correct parent after save + reload

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/MenuPageReorder.tsx client/src/pages/MenuPage.tsx
git commit -m "Add category drag-and-drop reorder with reparenting support"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - "Reihenfolge" button entering edit-order mode → Task 6
  - Header swaps to Speichern/Abbrechen → Task 6
  - Ziehen zum Sortieren banner → Task 6
  - Products: drag within group (reorder) → Task 7
  - Products: drag to different group (changes category) → Task 7
  - Categories: drag within level (reorder siblings) → Task 8
  - Categories: reparenting via horizontal offset → Task 8
  - DragOverlay shows projected depth → Task 8
  - Save sends one bulk API call → Tasks 7, 8
  - Cancel discards draft → Task 6
  - API errors shown inline → Tasks 7, 8
  - `PATCH /api/products/reorder` in single transaction with WS broadcast → Task 3
  - `PATCH /api/categories/reorder` with cycle detection, single transaction → Task 4
  - No WS broadcast for categories → Task 4 ✓ (intentionally omitted)
  - Client-side cycle detection → Task 8 (`detectCycle`)
  - `@dnd-kit` with touch support → Task 2 (`TouchSensor`)

- [x] **No placeholders** — all steps have actual code.

- [x] **Type consistency:**
  - `applyCategoryReorder(cats, activeId, overId, targetDepth)` defined in Task 1, called in Task 8 ✓
  - `detectCycle(cats)` defined in Task 1, called in Task 8 ✓
  - `productsApi.reorder(items: ProductReorderItem[])` defined in Task 2, called in Task 7 ✓
  - `categoriesApi.reorder(items: CategoryReorderItem[])` defined in Task 2, called in Task 8 ✓
  - `ReorderProductsView` exported in Task 7, imported in Task 7 ✓
  - `ReorderCategoriesView`, `SortableCategoryRow` exported in Task 8, imported in Task 8 ✓
  - `dndSensors` defined in Task 7, reused in Task 8 ✓
  - `dragActiveId`, `dragDepth` state defined in Task 8, consumed in Task 8 ✓
