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

  // Find insertion point using dnd-kit-style semantics:
  // - If dropping into a deeper level (targetDepth > overItem.depth): insert after overId (into it)
  // - If activeId was originally after overId (movingUp): insert before overId
  // - If activeId was originally before overId: insert after overId
  const activeOrigIdx = flat.findIndex(fc => fc.cat.id === activeId);
  const overOrigIdx = overId != null ? flat.findIndex(fc => fc.cat.id === overId) : -1;
  const overIdx = overId != null ? withoutSubtree.findIndex(fc => fc.cat.id === overId) : -1;
  const overDepth = overIdx >= 0 ? withoutSubtree[overIdx].depth : 0;
  const movingUp = overOrigIdx >= 0 && activeOrigIdx > overOrigIdx;
  const droppingInto = targetDepth > overDepth;
  const insertAt = overIdx >= 0
    ? (droppingInto || !movingUp ? overIdx + 1 : overIdx)
    : withoutSubtree.length;

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
