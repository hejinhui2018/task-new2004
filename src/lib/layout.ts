// 矩阵自动布局：晚→自顶向下，等同类横向聚拢；节点可被用户拖动覆盖
import type { Hypothesis } from './types';
import { layering, quotient, reducedEdges } from './graph';

export interface NodeLayout {
  id: string; // 等同类 root
  members: string[];
  level: number;
  x: number;
  y: number;
}

export interface LayoutResult {
  nodes: Map<string, NodeLayout>;
  /** 层（0=最早，在底部） -> 类 roots */
  rows: string[][];
  width: number;
  height: number;
}

export const NODE_W = 92;
export const NODE_H = 44;
export const COL_GAP = 36;
export const ROW_GAP = 72;
export const MARGIN = 48;

/**
 * 简单而稳定的分层布局：
 * 1. 最长路径分层；
 * 2. 每层按邻居重心（barycenter）迭代排序；
 * 3. 用户在 override 中给定的坐标直接采用。
 */
export function layoutMatrix(
  h: Hypothesis,
  overrides?: Record<string, { x: number; y: number }>,
): LayoutResult {
  const q = quotient(h);
  const level = layering(q);
  const visible = new Set(reducedEdges(h).map((r) => r.id));

  const byLevel = new Map<number, string[]>();
  for (const r of q.classes.roots) {
    const lv = level.get(r)!;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(r);
  }
  const maxLevel = Math.max(-1, ...[...byLevel.keys()]);

  // 直接连线：younger 类 -> older 类
  const edges = q.edges.filter((e) => visible.has(e.rel.id));
  const aboveNeighbors = new Map<string, string[]>(); // 更晚（上方）邻居
  const belowNeighbors = new Map<string, string[]>(); // 更早（下方）邻居
  for (const r of q.classes.roots) {
    aboveNeighbors.set(r, []);
    belowNeighbors.set(r, []);
  }
  for (const e of edges) {
    aboveNeighbors.get(e.oc)!.push(e.yc);
    belowNeighbors.get(e.yc)!.push(e.oc);
  }

  const rows: string[][] = [];
  for (let lv = 0; lv <= maxLevel; lv++) rows.push(byLevel.get(lv) ?? []);
  for (const row of rows) row.sort();

  const pos = new Map<string, number>();
  const assignPositions = (): void => {
    rows.forEach((row, ri) => {
      row.forEach((r, ci) => pos.set(r, ci * 1000 + ri));
    });
  };
  assignPositions();

  const barycenter = (r: string, neighbors: string[]): number => {
    const xs = neighbors.map((n) => pos.get(n)).filter((v): v is number => v !== undefined);
    if (!xs.length) return pos.get(r)!;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  for (let iter = 0; iter < 4; iter++) {
    // 自顶向下：按上方（更晚）邻居重心排
    for (let lv = maxLevel; lv >= 0; lv--) {
      if (!rows[lv]) continue;
      rows[lv] = rows[lv]
        .map((r) => ({ r, b: barycenter(r, aboveNeighbors.get(r) ?? []) }))
        .sort((a, b) => a.b - b.b || (a.r < b.r ? -1 : 1))
        .map((x) => x.r);
    }
    assignPositions();
    // 自底向上：按下方（更早）邻居重心排
    for (let lv = 0; lv <= maxLevel; lv++) {
      if (!rows[lv]) continue;
      rows[lv] = rows[lv]
        .map((r) => ({ r, b: barycenter(r, belowNeighbors.get(r) ?? []) }))
        .sort((a, b) => a.b - b.b || (a.r < b.r ? -1 : 1))
        .map((x) => x.r);
    }
    assignPositions();
  }

  const maxCols = Math.max(1, ...rows.map((r) => r.length));
  const width = MARGIN * 2 + maxCols * NODE_W + (maxCols - 1) * COL_GAP;
  const height = MARGIN * 2 + (maxLevel + 1) * NODE_H + maxLevel * ROW_GAP;

  const nodes = new Map<string, NodeLayout>();
  rows.forEach((row, lv) => {
    const totalW = row.length * NODE_W + (row.length - 1) * COL_GAP;
    const startX = (width - totalW) / 2;
    // level 0（最早）在底部，y 最大
    const y = MARGIN + (maxLevel - lv) * (NODE_H + ROW_GAP);
    row.forEach((r, ci) => {
      const auto = { x: startX + ci * (NODE_W + COL_GAP), y };
      const ov = overrides?.[r];
      nodes.set(r, {
        id: r,
        members: q.classes.members.get(r)!,
        level: lv,
        x: ov?.x ?? auto.x,
        y: ov?.y ?? auto.y,
      });
    });
  });

  return { nodes, rows, width, height };
}
