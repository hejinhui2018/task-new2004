// 证据复核：在隔离的候选快照上应用“撤回”项，重算等同类 / 传递约简 / 年代分期传播 / 冲突证据，
// 并给出与当前解释的差异。纯函数：不改动输入假设，候选不污染当前矩阵。
import type { DateRange, Hypothesis, ReviewItem, ReviewTarget } from './types';
import { quotient, transitiveReduction } from './graph';
import { propagate, type PropagationResult } from './dates';

/** 复核警告：悬空解释或无法定位的目标；只提示，不静默删除 */
export interface ReviewWarning {
  type: 'missing-target' | 'isolated-unit' | 'dangling-position';
  message: string;
  /** missing-target：对应的复核项 */
  itemId?: string;
  /** isolated-unit：悬空的单元 */
  unitId?: string;
}

/** 一个等同类在某一时刻的年代/分期界 */
export interface BoundValues {
  early: number | null;
  late: number | null;
  phaseLo: number | null;
  phaseHi: number | null;
}

export interface BoundChange {
  /** 候选等同类成员 */
  members: string[];
  before: BoundValues;
  after: BoundValues;
}

export interface ConflictEntry {
  kind: 'date' | 'phase';
  key: string;
  message: string;
  unitIds: string[];
}

export interface ReviewDiff {
  /** 受影响的单元（等同类变化、界值变化、连线变化、冲突端点的并集），按编号排序 */
  affectedUnits: string[];
  /** 候选中被拆开的同期单元对 */
  splitPairs: [string, string][];
  /** 候选中新合并的同期单元对（纯撤回不会产生，保留字段以备扩展） */
  mergedPairs: [string, string][];
  /** 候选中不存在的直接关系 id（被撤回） */
  removedEdgeIds: string[];
  /** 当前被约简隐藏、候选中变为直接的关系 id */
  unhiddenEdgeIds: string[];
  /** 当前直接、候选中被约简隐藏的关系 id */
  hiddenEdgeIds: string[];
  /** 年代/分期界前后值（按候选等同类） */
  boundChanges: BoundChange[];
  conflictsBefore: number;
  conflictsAfter: number;
  newConflicts: ConflictEntry[];
  resolvedConflicts: ConflictEntry[];
}

export interface CandidateResult {
  /** 应用撤回后的候选假设（隔离副本，与当前假设同 id/name） */
  hypothesis: Hypothesis;
  /** 实际应用的撤回项（目标缺失的项被跳过并给出警告） */
  applied: ReviewItem[];
  warnings: ReviewWarning[];
  diff: ReviewDiff;
}

/** 复核目标的稳定键（去重用）；年代按内容而非下标，避免编辑后错位 */
export function targetKey(t: ReviewTarget): string {
  switch (t.kind) {
    case 'above':
      return `above:${t.relId}`;
    case 'equiv':
      return `equiv:${t.equivId}`;
    case 'phase':
      return `phase:${t.unitId}`;
    case 'date':
      return `date:${t.unitId}:${t.snapshot.early}:${t.snapshot.late}:${t.snapshot.label}`;
  }
}

/** 目标证据的人类可读描述；目标在当前假设中已不存在时返回 null */
export function describeTarget(h: Hypothesis, t: ReviewTarget): string | null {
  const code = (id: string): string => h.units[id]?.code ?? '?';
  switch (t.kind) {
    case 'above': {
      const r = h.above.find((x) => x.id === t.relId);
      if (!r) return null;
      return `早晚关系 ${code(r.younger)} 晚于 ${code(r.older)}`;
    }
    case 'equiv': {
      const e = h.equivs.find((x) => x.id === t.equivId);
      if (!e) return null;
      return `等同 ${code(e.a)} ＝ ${code(e.b)}`;
    }
    case 'date': {
      const u = h.units[t.unitId];
      if (!u) return null;
      const d = locateDate(u.dates, t);
      if (!d) return null;
      return `出土物年代 ${u.code}「${d.label}」${d.early}~${d.late}`;
    }
    case 'phase': {
      const u = h.units[t.unitId];
      if (!u || u.phaseId === null) return null;
      const p = h.phases.find((x) => x.id === u.phaseId);
      return `人工分期 ${u.code}「${p?.name ?? '未知分期'}」`;
    }
  }
}

/** 先按创建时的下标、再按值快照定位年代条目；找不到返回 -1 / null */
function locateDateIndex(dates: DateRange[], t: { index: number; snapshot: DateRange }): number {
  const match = (d: DateRange): boolean =>
    d.early === t.snapshot.early && d.late === t.snapshot.late && d.label === t.snapshot.label;
  if (t.index >= 0 && t.index < dates.length && match(dates[t.index])) return t.index;
  return dates.findIndex(match);
}

function locateDate(dates: DateRange[], t: { index: number; snapshot: DateRange }): DateRange | null {
  const i = locateDateIndex(dates, t);
  return i >= 0 ? dates[i] : null;
}

/** 参与任意早晚/等同关系的单元集合 */
function connectedUnits(h: Hypothesis): Set<string> {
  const s = new Set<string>();
  for (const r of h.above) {
    s.add(r.younger);
    s.add(r.older);
  }
  for (const e of h.equivs) {
    s.add(e.a);
    s.add(e.b);
  }
  return s;
}

/**
 * 构建候选快照：克隆当前假设并应用全部“撤回”项（保留 / 暂不采用项不改动）。
 * 目标已不存在的项跳过并记入 warnings；随后检测撤回导致的悬空单元与悬空布局。
 */
export function buildCandidate(h: Hypothesis, items: ReviewItem[]): CandidateResult {
  const cand = structuredClone(h);
  const warnings: ReviewWarning[] = [];
  const applied: ReviewItem[] = [];

  const missing = (item: ReviewItem): void => {
    warnings.push({
      type: 'missing-target',
      itemId: item.id,
      message: `复核项「${item.label || targetKey(item.target)}」的目标在当前矩阵中已不存在（无法定位），候选中未应用。`,
    });
  };

  for (const item of items) {
    if (item.action !== 'retract') continue;
    const t = item.target;
    if (t.kind === 'above') {
      const n = cand.above.length;
      cand.above = cand.above.filter((r) => r.id !== t.relId);
      if (cand.above.length === n) missing(item);
      else applied.push(item);
    } else if (t.kind === 'equiv') {
      const n = cand.equivs.length;
      cand.equivs = cand.equivs.filter((e) => e.id !== t.equivId);
      if (cand.equivs.length === n) missing(item);
      else applied.push(item);
    } else if (t.kind === 'phase') {
      const u = cand.units[t.unitId];
      if (!u || u.phaseId === null) missing(item);
      else {
        u.phaseId = null;
        applied.push(item);
      }
    } else {
      const u = cand.units[t.unitId];
      const idx = u ? locateDateIndex(u.dates, t) : -1;
      if (!u || idx < 0) missing(item);
      else {
        u.dates.splice(idx, 1);
        applied.push(item);
      }
    }
  }

  // 悬空单元：撤回后失去全部早晚/等同关联，无法在地层序列中相对定位
  const connNow = connectedUnits(h);
  const connCand = connectedUnits(cand);
  for (const id of cand.unitIds) {
    if (connNow.has(id) && !connCand.has(id)) {
      warnings.push({
        type: 'isolated-unit',
        unitId: id,
        message: `单元 ${cand.units[id].code} 在候选中失去全部早晚/等同关联，无法在地层序列中相对定位（悬空）。单元本身保留，不会被删除。`,
      });
    }
  }
  // 悬空布局：手动摆放的坐标锚点（等同类 root）在候选中已不存在
  const rootsCand = new Set(quotient(cand).classes.roots);
  for (const key of Object.keys(cand.positions)) {
    if (!rootsCand.has(key)) {
      warnings.push({
        type: 'dangling-position',
        message: `手动布局位置（锚点 ${key}）在候选中没有对应等同类，成为悬空布局；采用后数据保留但不再生效。`,
      });
    }
  }

  const diff = diffCandidate(h, cand, applied);
  return { hypothesis: cand, applied, warnings, diff };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function boundsOf(p: PropagationResult, root: string): BoundValues {
  return {
    early: p.earliest.get(root)?.value ?? null,
    late: p.latest.get(root)?.value ?? null,
    phaseLo: p.phaseLo.get(root)?.value ?? null,
    phaseHi: p.phaseHi.get(root)?.value ?? null,
  };
}

function conflictMap(p: PropagationResult): Map<string, ConflictEntry> {
  const m = new Map<string, ConflictEntry>();
  for (const c of p.dateConflicts) {
    const key = `date:${c.olderEvidence.unitId}:${c.olderEvidence.value}|${c.youngerEvidence.unitId}:${c.youngerEvidence.value}`;
    m.set(key, {
      kind: 'date',
      key,
      message: c.message,
      unitIds: [c.olderEvidence.unitId, c.youngerEvidence.unitId],
    });
  }
  for (const c of p.phaseConflicts) {
    const key = `phase:${c.olderUnit}:${c.olderRank}|${c.youngerUnit}:${c.youngerRank}`;
    m.set(key, { kind: 'phase', key, message: c.message, unitIds: [c.olderUnit, c.youngerUnit] });
  }
  return m;
}

/** 当前解释（now）与候选解释（cand）的差异 */
function diffCandidate(now: Hypothesis, cand: Hypothesis, applied: ReviewItem[]): ReviewDiff {
  const propNow = propagate(now);
  const propCand = propagate(cand);
  const clsNow = propNow.q.classes;
  const clsCand = propCand.q.classes;
  const codeOf = (id: string): string => cand.units[id]?.code ?? now.units[id]?.code ?? id;

  // 等同类划分变化（类内无序单元对）
  const pairsOf = (members: Map<string, string[]>): Map<string, [string, string]> => {
    const m = new Map<string, [string, string]>();
    for (const list of members.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          m.set(pairKey(list[i], list[j]), [list[i], list[j]]);
        }
      }
    }
    return m;
  };
  const pairsNow = pairsOf(clsNow.members);
  const pairsCand = pairsOf(clsCand.members);
  const splitPairs: [string, string][] = [];
  const mergedPairs: [string, string][] = [];
  for (const [k, p] of pairsNow) if (!pairsCand.has(k)) splitPairs.push(p);
  for (const [k, p] of pairsCand) if (!pairsNow.has(k)) mergedPairs.push(p);
  splitPairs.sort();
  mergedPairs.sort();

  // 直接连线变化：撤回 / 隐藏状态翻转
  const candEdgeIds = new Set(cand.above.map((r) => r.id));
  const removedEdgeIds = now.above.filter((r) => !candEdgeIds.has(r.id)).map((r) => r.id);
  const hidNow = transitiveReduction(now);
  const hidCand = transitiveReduction(cand);
  const unhiddenEdgeIds = cand.above
    .filter((r) => hidNow.has(r.id) && !hidCand.has(r.id))
    .map((r) => r.id);
  const hiddenEdgeIds = cand.above
    .filter((r) => !hidNow.has(r.id) && hidCand.has(r.id))
    .map((r) => r.id);

  // 年代/分期界前后值：候选类 → 其成员在当前所属的类
  const boundChanges: BoundChange[] = [];
  for (const root of clsCand.roots) {
    const members = clsCand.members.get(root)!;
    const nowRoot = clsNow.rootOf.get(members[0])!;
    const before = boundsOf(propNow, nowRoot);
    const after = boundsOf(propCand, root);
    if (
      before.early !== after.early ||
      before.late !== after.late ||
      before.phaseLo !== after.phaseLo ||
      before.phaseHi !== after.phaseHi
    ) {
      boundChanges.push({ members: [...members], before, after });
    }
  }
  boundChanges.sort((x, y) => codeOf(x.members[0]).localeCompare(codeOf(y.members[0])));

  // 冲突增减（按两端证据单元 + 界值作稳定键）
  const kn = conflictMap(propNow);
  const kc = conflictMap(propCand);
  const newConflicts = [...kc.values()].filter((c) => !kn.has(c.key));
  const resolvedConflicts = [...kn.values()].filter((c) => !kc.has(c.key));

  // 受影响单元：类变化、界变化、连线变化、冲突端点、被撤回目标的并集
  const aff = new Set<string>();
  for (const [x, y] of [...splitPairs, ...mergedPairs]) {
    aff.add(x);
    aff.add(y);
  }
  for (const b of boundChanges) for (const m of b.members) aff.add(m);
  const edgeEndpoints = (id: string): void => {
    const r = now.above.find((x) => x.id === id) ?? cand.above.find((x) => x.id === id);
    if (r) {
      aff.add(r.younger);
      aff.add(r.older);
    }
  };
  for (const id of [...removedEdgeIds, ...unhiddenEdgeIds, ...hiddenEdgeIds]) edgeEndpoints(id);
  for (const c of [...newConflicts, ...resolvedConflicts]) for (const u of c.unitIds) aff.add(u);
  for (const item of applied) {
    const t = item.target;
    if (t.kind === 'above') edgeEndpoints(t.relId);
    else if (t.kind === 'equiv') {
      const e = now.equivs.find((x) => x.id === t.equivId) ?? cand.equivs.find((x) => x.id === t.equivId);
      if (e) {
        aff.add(e.a);
        aff.add(e.b);
      }
    } else {
      aff.add(t.unitId);
    }
  }
  const affectedUnits = [...aff]
    .filter((id) => cand.units[id])
    .sort((x, y) => codeOf(x).localeCompare(codeOf(y)));

  return {
    affectedUnits,
    splitPairs,
    mergedPairs,
    removedEdgeIds,
    unhiddenEdgeIds,
    hiddenEdgeIds,
    boundChanges,
    conflictsBefore: propNow.dateConflicts.length + propNow.phaseConflicts.length,
    conflictsAfter: propCand.dateConflicts.length + propCand.phaseConflicts.length,
    newConflicts,
    resolvedConflicts,
  };
}
