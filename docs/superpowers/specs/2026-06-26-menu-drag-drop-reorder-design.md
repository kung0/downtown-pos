# Menu drag-and-drop reorder — design spec
**Date:** 2026-06-26

## Summary

Add drag-and-drop reordering to the Menu page for both products and categories. Users enter an explicit "edit order" mode, arrange items by dragging, then save with a single button. Changes are discarded if the user cancels.

---

## UX flow

Both the "Produkte" and "Kategorien" tabs get a "Reihenfolge" button in the header (alongside the existing "+ Produkt" / "+ Kategorie" button).

**Entering edit-order mode:**
- The header swaps: "Reihenfolge" disappears, "Speichern" and "Abbrechen" appear
- The normal action button ("+ Produkt" / "+ Kategorie") disappears
- A subtle banner ("Ziehen zum Sortieren") indicates the mode is active
- Rows replace their action controls (toggles, edit buttons) with a drag handle (⠿) on the left

**Products in edit-order mode:**
- Products shown grouped by category (same layout as normal view)
- Drag a product within its group → reorders within that category
- Drag a product into a different group → changes its category and places it at the drop position
- Category group headers are fixed drop zones; they are not themselves draggable in this tab

**Categories in edit-order mode:**
- Flat indented list with drag handles
- Drag within the same level → reorders siblings
- Reparenting via horizontal offset: dragging right makes the item a child of the row above; dragging left decreases depth (becomes sibling or root)
- A projected drop line + depth indicator shows where the item will land while dragging
- Depth is not artificially capped — the tree already supports arbitrary nesting and this feature does not change that

**Saving / cancelling:**
- "Abbrechen" discards all local draft changes and exits the mode immediately
- "Speichern" sends one bulk API call, updates local state on success, and exits the mode
- If the API call fails, an error is shown inline and the user stays in edit-order mode

---

## Data model

No schema changes required. Both tables already have `sort_order` columns:
- `products.sort_order INTEGER NOT NULL DEFAULT 0`
- `categories.sort_order INTEGER NOT NULL DEFAULT 0`

---

## API

### `PATCH /api/products/reorder`

Bulk-updates sort order and optionally category for all products.

**Request body:**
```json
[
  { "id": 1, "sort_order": 0, "category": "Drinks" },
  { "id": 2, "sort_order": 1, "category": "Drinks" },
  { "id": 3, "sort_order": 0, "category": "Food" }
]
```

**Behaviour:**
- Runs as a single SQLite transaction
- For each item: updates `sort_order`, `category`, and `tax_category` (derived from the category row)
- Returns `204 No Content` on success
- Broadcasts `menu:product_updated` via WebSocket for each changed product so other connected devices see the new order

**Errors:**
- `400` if any `category` name doesn't exist in the categories table
- `400` if body is not a non-empty array

### `PATCH /api/categories/reorder`

Bulk-updates sort order and optionally parent for all categories.

**Request body:**
```json
[
  { "id": 1, "sort_order": 0, "parent_id": null },
  { "id": 2, "sort_order": 0, "parent_id": 1 },
  { "id": 3, "sort_order": 1, "parent_id": null }
]
```

**Behaviour:**
- Runs a cycle-detection pass over the entire proposed tree before touching the DB (reusing the same ancestor-walk logic from `PUT /api/categories/:id`)
- If no cycles detected, updates all rows in a single SQLite transaction
- Returns `204 No Content` on success
- No WebSocket broadcast needed (only MenuPage consumes categories)

**Errors:**
- `400` with message `"circular reference detected"` if any category would become its own ancestor
- `400` if body is not a non-empty array

---

## Frontend components

**Library:** `@dnd-kit/core` + `@dnd-kit/sortable` (touch support required for tablet use; this is the only actively maintained option with solid touch handling).

**State additions to `MenuPage`:**
- `isReordering: boolean` — whether edit-order mode is active
- `draftProducts: Product[]` — local copy mutated during drag; initialised from `products` on mode entry
- `draftCategories: Category[]` — local copy mutated during drag; initialised from `categories` on mode entry

**New sub-components (can live in `MenuPage.tsx` or split into a sibling file if the component grows too large):**

| Component | Purpose |
|---|---|
| `SortableProductRow` | Wraps a product row with `useSortable`; renders drag handle instead of toggle+edit |
| `SortableProductGroup` | Droppable zone per category group; accepts products dropped from other groups |
| `SortableCategoryRow` | Wraps a category row with `useSortable`; renders drag handle + projected indent overlay |

**Reparenting logic for categories:**
- On drag move, compute `newDepth = clamp(pointerOffsetDepth, 0, 2)` from the horizontal position of the drag pointer relative to the list left edge
- Show a drop line at the projected position with a small depth indicator
- This is pure local geometry — no network calls during drag

**Client-side cycle guard (categories):**
- Before calling the API on "Speichern", walk the draft tree and verify no category is its own ancestor
- Show an inline error and stay in edit-order mode if a cycle is detected
- The server also validates, but catching it client-side gives a faster, friendlier error

**API client additions (`client/src/api.ts`):**
- `productsApi.reorder(items: { id: number; sort_order: number; category: string }[]): Promise<void>`
- `categoriesApi.reorder(items: { id: number; sort_order: number; parent_id: number | null }[]): Promise<void>`

---

## Files changed

| File | Change |
|---|---|
| `client/src/pages/MenuPage.tsx` | Add reorder mode, draft state, sortable rows/groups |
| `client/src/api.ts` | Add `reorderProducts` and `reorderCategories` |
| `server/src/routes/products.ts` | Add `PATCH /reorder` endpoint |
| `server/src/routes/categories.ts` | Add `PATCH /reorder` endpoint |
| `client/package.json` | Add `@dnd-kit/core` and `@dnd-kit/sortable` |

---

## Out of scope

- Reordering product variants (not requested)
- Drag-and-drop on the order-taking / tab views
- Keyboard-based reordering (arrow keys etc.)
