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
