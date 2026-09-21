// 并查集 + 等同关系连通性，用于把等同单元合并为“同期类”
import type { ChainStep, Equivalence, Hypothesis } from './types';

export interface EquivNeighbor {
  to: string;
  equivId: string;
}

export class DSU {
  private parent = new Map<string, string>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) return x;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      // 取较小 id 作根，保证结果稳定
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}

/** 单元级别的无向等同邻接表（保留每条等同的 id，便于还原矛盾链） */
export function equivAdjacency(equivs: Equivalence[]): Map<string, EquivNeighbor[]> {
  const adj = new Map<string, EquivNeighbor[]>();
  for (const e of equivs) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ to: e.b, equivId: e.id });
    adj.get(e.b)!.push({ to: e.a, equivId: e.id });
  }
  return adj;
}

/**
 * 求同一等同类内两个单元之间的等同路径（BFS，最短）。
 * 若二者本就相同返回空数组；不在同一连通块返回 null。
 */
export function equivPath(
  adj: Map<string, EquivNeighbor[]>,
  from: string,
  to: string,
): ChainStep[] | null {
  if (from === to) return [];
  const prev = new Map<string, { from: string; equivId: string }>();
  const queue = [from];
  prev.set(from, { from: '', equivId: '' });
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of adj.get(cur) ?? []) {
      if (!prev.has(n.to)) {
        prev.set(n.to, { from: cur, equivId: n.equivId });
        queue.push(n.to);
      }
    }
  }
  if (!prev.has(to)) return null;
  const steps: ChainStep[] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur)!;
    steps.push({ kind: 'equiv', refId: p.equivId, from: p.from, to: cur });
    cur = p.from;
  }
  steps.reverse();
  return steps;
}

export interface Classes {
  rootOf: Map<string, string>;
  /** root -> 成员单元（按 id 排序） */
  members: Map<string, string[]>;
  roots: string[];
  adj: Map<string, EquivNeighbor[]>;
}

export function buildClasses(h: Pick<Hypothesis, 'unitIds' | 'equivs'>): Classes {
  const dsu = new DSU(h.unitIds);
  for (const e of h.equivs) {
    if (h.unitIds.includes(e.a) && h.unitIds.includes(e.b)) dsu.union(e.a, e.b);
  }
  const rootOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const id of h.unitIds) {
    const r = dsu.find(id);
    rootOf.set(id, r);
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(id);
  }
  for (const list of members.values()) list.sort();
  const roots = [...members.keys()].sort();
  return { rootOf, members, roots, adj: equivAdjacency(h.equivs) };
}
