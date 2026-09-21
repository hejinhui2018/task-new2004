// 商图（等同类合并）、循环检测与完整矛盾链、传递约简、路径解释、分层
import type { AboveRelation, ChainStep, ConflictChain, Equivalence, Hypothesis } from './types';
import { buildClasses, equivPath, type Classes } from './equivalence';

export interface QEdge {
  rel: AboveRelation;
  yc: string; // younger class root
  oc: string; // older class root
}

export interface Quotient {
  classes: Classes;
  edges: QEdge[];
  /** 类 -> 出边（指向更早的类） */
  out: Map<string, QEdge[]>;
}

export function quotient(h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>): Quotient {
  const classes = buildClasses(h);
  const edges: QEdge[] = [];
  for (const rel of h.above) {
    const yc = classes.rootOf.get(rel.younger)!;
    const oc = classes.rootOf.get(rel.older)!;
    if (yc === oc) continue; // 理论上不会出现：加入时已被阻断
    edges.push({ rel, yc, oc });
  }
  const out = new Map<string, QEdge[]>();
  for (const r of classes.roots) out.set(r, []);
  for (const e of edges) out.get(e.yc)!.push(e);
  return { classes, edges, out };
}

/**
 * 把类级有向路径提升为单元级矛盾链：
 * 类之间用早晚关系连接，跨越等同类内部时插入等同步骤。
 * pathClasses 至少含一个类；start 属于首个类，end 属于末个类。
 */
export function liftPath(q: Quotient, pathClasses: string[], start: string, end: string): ChainStep[] {
  const steps: ChainStep[] = [];
  let cur = start;
  for (let i = 0; i < pathClasses.length - 1; i++) {
    const edge = q.out
      .get(pathClasses[i])!
      .find((e) => e.oc === pathClasses[i + 1])!;
    if (cur !== edge.rel.younger) {
      steps.push(...equivPath(q.classes.adj, cur, edge.rel.younger)!);
    }
    steps.push({
      kind: 'above',
      refId: edge.rel.id,
      from: edge.rel.younger,
      to: edge.rel.older,
    });
    cur = edge.rel.older;
  }
  if (cur !== end) {
    steps.push(...equivPath(q.classes.adj, cur, end)!);
  }
  return steps;
}

/** 在商图上 BFS 求从 from 类到 to 类的类序列（不含直接边限制），不可达返回 null */
export function classPath(q: Quotient, from: string, to: string[]): string[] | null;
export function classPath(q: Quotient, from: string, to: string): string[] | null;
export function classPath(q: Quotient, from: string, to: string | string[]): string[] | null {
  const targets = Array.isArray(to) ? new Set(to) : new Set([to]);
  if (targets.has(from)) return [from];
  const prev = new Map<string, string>();
  const queue = [from];
  prev.set(from, from);
  while (queue.length) {
    const c = queue.shift()!;
    if (targets.has(c)) {
      const path = [c];
      let p = prev.get(c)!;
      while (p !== path[0]) {
        path.unshift(p);
        p = prev.get(p)!;
      }
      return path;
    }
    for (const e of q.out.get(c) ?? []) {
      if (!prev.has(e.oc)) {
        prev.set(e.oc, c);
        queue.push(e.oc);
      }
    }
  }
  return null;
}

function chainFromSteps(steps: ChainStep[], message: string): ConflictChain {
  const unitIds: string[] = [];
  const edgeIds: string[] = [];
  const seenU = new Set<string>();
  const seenE = new Set<string>();
  for (const s of steps) {
    for (const u of [s.from, s.to]) {
      if (u && !seenU.has(u)) {
        seenU.add(u);
        unitIds.push(u);
      }
    }
    if (!seenE.has(s.refId)) {
      seenE.add(s.refId);
      edgeIds.push(s.refId);
    }
  }
  return { message, steps, unitIds, edgeIds };
}

/**
 * 校验拟新增的早晚关系 younger 晚于 older。
 * 通过返回 null；否则返回完整矛盾链（含拟新增边，refId 用 newRelId 占位）。
 */
export function validateAbove(
  h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>,
  younger: string,
  older: string,
  newRelId: string,
): ConflictChain | null {
  if (younger === older) {
    return chainFromSteps(
      [{ kind: 'above', refId: newRelId, from: younger, to: older }],
      '单元不能晚于自身',
    );
  }
  const q = quotient(h);
  const yc = q.classes.rootOf.get(younger)!;
  const oc = q.classes.rootOf.get(older)!;
  const newStep: ChainStep = { kind: 'above', refId: newRelId, from: younger, to: older };

  if (yc === oc) {
    // 同一等同类内不能再有早晚：新边 + 等同回路
    const eq = equivPath(q.classes.adj, older, younger)!;
    return chainFromSteps(
      [newStep, ...eq],
      '与等同关系冲突：被合并为同期的两个单元之间不能存在早晚关系',
    );
  }
  // 若 older 类已能到达 younger 类，新边闭合为环
  const path = classPath(q, oc, yc);
  if (path) {
    const rest = liftPath(q, path, older, younger);
    return chainFromSteps([newStep, ...rest], '该关系会形成循环（单元晚于自身的传递链）');
  }
  return null;
}

/**
 * 校验拟新增的等同关系。若两个类已可由早晚关系比较，则合并会产生矛盾。
 */
export function validateEquiv(
  h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>,
  a: string,
  b: string,
  newEquivId: string,
): ConflictChain | null {
  if (a === b) return null;
  const q = quotient(h);
  const ca = q.classes.rootOf.get(a)!;
  const cb = q.classes.rootOf.get(b)!;
  if (ca === cb) return null; // 已同期
  const newStep: ChainStep = { kind: 'equiv', refId: newEquivId, from: a, to: b };

  const ab = classPath(q, ca, cb);
  if (ab) {
    // a 类已晚于 b 类：早晚链 a→…→b，再以新等同 b→a 闭合
    const rest = liftPath(q, ab, a, b);
    return chainFromSteps(
      [...rest, { ...newStep, from: b, to: a }],
      '与早晚关系冲突：两个单元已有明确先后，不能标记为同期',
    );
  }
  const ba = classPath(q, cb, ca);
  if (ba) {
    const rest = liftPath(q, ba, b, a);
    return chainFromSteps(
      [...rest, newStep],
      '与早晚关系冲突：两个单元已晚于/早于对方，不能标记为同期',
    );
  }
  return null;
}

/**
 * 传递约简：在无环商图上，若一条边的两端之间还存在长度 ≥2 的路径，
 * 则该边是冗余的。平行边（不同单元、同类对）互不掩盖。
 * 返回冗余关系 id 集合。
 */
export function transitiveReduction(h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>): Set<string> {
  const q = quotient(h);
  const redundant = new Set<string>();
  for (const e of q.edges) {
    // 不使用任何 e.yc→e.oc 的直达边，且要求经过至少一个中间类
    const prev = new Map<string, string>();
    const queue = [e.yc];
    prev.set(e.yc, e.yc);
    while (queue.length) {
      const c = queue.shift()!;
      if (c === e.oc) break;
      for (const f of q.out.get(c) ?? []) {
        if (c === e.yc && f.oc === e.oc) continue; // 跳过所有同类对直达边
        if (!prev.has(f.oc)) {
          prev.set(f.oc, c);
          queue.push(f.oc);
        }
      }
    }
    if (prev.has(e.oc) && prev.get(e.oc) !== e.yc) {
      redundant.add(e.rel.id);
    }
  }
  return redundant;
}

/** 矩阵中实际绘制的边：所有非冗余关系 */
export function reducedEdges(h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>): AboveRelation[] {
  const hidden = transitiveReduction(h);
  return h.above.filter((r) => !hidden.has(r.id));
}

/**
 * 解释两个单元之间的（可能被隐藏的）传递关系。
 * 返回类路径提升后的单元级步骤；不可达返回 null。
 */
export function explainPath(
  h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>,
  fromYounger: string,
  toOlder: string,
): ChainStep[] | null {
  const q = quotient(h);
  const cFrom = q.classes.rootOf.get(fromYounger)!;
  const cTo = q.classes.rootOf.get(toOlder)!;
  if (cFrom === cTo) {
    return fromYounger === toOlder
      ? []
      : equivPath(q.classes.adj, fromYounger, toOlder);
  }
  // 优先用约简后的边找规范路径
  const hidden = transitiveReduction(h);
  const visibleOut = new Map<string, QEdge[]>();
  for (const r of q.classes.roots) visibleOut.set(r, []);
  for (const e of q.edges) if (!hidden.has(e.rel.id)) visibleOut.get(e.yc)!.push(e);

  const prev = new Map<string, string>();
  const queue = [cFrom];
  prev.set(cFrom, cFrom);
  while (queue.length) {
    const c = queue.shift()!;
    if (c === cTo) break;
    for (const e of visibleOut.get(c) ?? []) {
      if (!prev.has(e.oc)) {
        prev.set(e.oc, c);
        queue.push(e.oc);
      }
    }
  }
  if (!prev.has(cTo)) return null;
  const classes: string[] = [];
  let cur = cTo;
  classes.push(cur);
  while (cur !== cFrom) {
    cur = prev.get(cur)!;
    classes.unshift(cur);
  }
  const q2: Quotient = { ...q, out: visibleOut };
  return liftPath(q2, classes, fromYounger, toOlder);
}

/** 防御性：商图中若已存在环，返回其中一条（正常流程下不会发生） */
export function findAnyCycle(h: Pick<Hypothesis, 'unitIds' | 'equivs' | 'above'>): ConflictChain | null {
  const q = quotient(h);
  const state = new Map<string, 0 | 1 | 2>();
  for (const r of q.classes.roots) state.set(r, 0);
  const stack: string[] = [];

  const dfs = (c: string): string[] | null => {
    state.set(c, 1);
    stack.push(c);
    for (const e of q.out.get(c) ?? []) {
      const s = state.get(e.oc);
      if (s === 1) {
        const i = stack.indexOf(e.oc);
        return [...stack.slice(i), e.oc];
      }
      if (s === 0) {
        const found = dfs(e.oc);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(c, 2);
    return null;
  };

  for (const r of q.classes.roots) {
    if (state.get(r) === 0) {
      const cyc = dfs(r);
      if (cyc) {
        const steps = liftPath(q, cyc, cyc[0], cyc[0]);
        return chainFromSteps(steps, '矩阵中存在循环');
      }
    }
  }
  return null;
}

/**
 * 最长路径分层：最早（没有更早对象）的类为 0 层，越晚层数越大。
 * Kahn 先得到的是“最晚”类，因此最后用最大层反转，使最早=0、最晚=最高层。
 */
export function layering(q: Quotient): Map<string, number> {
  const indeg = new Map<string, number>();
  for (const r of q.classes.roots) indeg.set(r, 0);
  for (const e of q.edges) indeg.set(e.oc, (indeg.get(e.oc) ?? 0) + 1);

  const raw = new Map<string, number>();
  const queue: string[] = [];
  for (const r of q.classes.roots) {
    if ((indeg.get(r) ?? 0) === 0) {
      queue.push(r);
      raw.set(r, 0); // 最晚的类
    }
  }
  while (queue.length) {
    const c = queue.shift()!;
    for (const e of q.out.get(c) ?? []) {
      const nl = Math.max(raw.get(e.oc) ?? 0, (raw.get(c) ?? 0) + 1);
      raw.set(e.oc, nl);
      indeg.set(e.oc, indeg.get(e.oc)! - 1);
      if (indeg.get(e.oc) === 0) queue.push(e.oc);
    }
  }
  // 环兜底
  for (const r of q.classes.roots) if (!raw.has(r)) raw.set(r, 0);

  const maxRaw = Math.max(0, ...[...raw.values()]);
  const level = new Map<string, number>();
  for (const [r, v] of raw) level.set(r, maxRaw - v); // 最早=0，最晚=最高层
  return level;
}

export type { Equivalence };
