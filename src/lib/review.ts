// 证据复核：在隔离的候选快照上重算等同类、传递约简、年代/分期传播与冲突，
// 并给出“当前解释 → 候选解释”的结构化差异。任何计算都不改动传入的假设。
import type {
  ConflictChain,
  DateRange,
  EvidenceType,
  Hypothesis,
  ReviewItem,
} from './types';
import { findAnyCycle, transitiveReduction } from './graph';
import { buildClasses } from './equivalence';
import { propagate, type BoundSource, type PropagationResult } from './dates';

/** 一条悬空/失效的复核引用：证据已被直接编辑删除，候选不能静默处理 */
export interface DanglingRef {
  itemId: string;
  evidence: EvidenceType;
  refId: string;
  /** missing = 证据已不存在；stale = 下标处内容已被直接编辑改变 */
  status: 'missing' | 'stale';
  reason: string;
  relatedUnitIds: string[];
}

/** 撤回后失去全部早晚/等同联系、无法在矩阵中定位的单元 */
export interface OrphanUnit {
  unitId: string;
  reason: string;
}

export interface BoundChange {
  unitId: string;
  kind: 'earliest' | 'latest' | 'phaseLo' | 'phaseHi';
  before: number | null;
  after: number | null;
  beforeSource: BoundSource | null;
  afterSource: BoundSource | null;
}

export interface ConflictRef {
  kind: 'date' | 'phase' | 'cycle';
  message: string;
  /** 稳定身份：日期/分期冲突按证据集，循环按链上边集合 */
  signature: string;
  edgeIds: string[];
  unitIds: string[];
  chain: ConflictChain | null;
}

export interface ReviewDiff {
  /** 当前解释 → 候选解释中受影响的单元（类拆分、界值变化、关系改动、孤立） */
  affectedUnitIds: string[];
  /** 候选中新合并为同期的单元对 */
  merged: [string, string][];
  /** 候选中被拆开的原同期单元对 */
  split: [string, string][];
  boundChanges: BoundChange[];
  conflictsBefore: ConflictRef[];
  conflictsAfter: ConflictRef[];
  conflictsAdded: ConflictRef[];
  conflictsRemoved: ConflictRef[];
  /** 采用后新成为约简隐藏边的关系 id */
  reducedAdded: string[];
  /** 采用后重新成为直接边的关系 id */
  reducedRemoved: string[];
  dangling: DanglingRef[];
  orphans: OrphanUnit[];
  /** 候选快照本身是否含环（撤回证据通常不会产生，仅作防御） */
  cycleAfter: ConflictChain | null;
}

// ---------- 候选快照 ----------

/** 出土物年代证据的稳定引用 id */
export function dateRefId(unitId: string, index: number): string {
  return `date:${unitId}:${index}`;
}

/** 人工分期证据的稳定引用 id */
export function phaseRefId(unitId: string): string {
  return `phase:${unitId}`;
}

/** 在当前假设中定位一条年代证据：优先按创建时内容匹配，避免下标漂移误删 */
export function resolveDateIndex(
  h: Hypothesis,
  unitId: string,
  dateIndex: number,
  snapshot?: DateRange,
): number | null {
  const dates = h.units[unitId]?.dates;
  if (!dates) return null;
  if (snapshot) {
    const i = dates.findIndex(
      (d) => d.early === snapshot.early && d.late === snapshot.late && d.label === snapshot.label,
    );
    if (i >= 0) return i;
  }
  return dateIndex >= 0 && dateIndex < dates.length ? dateIndex : null;
}

/** 深拷贝假设（候选与当前矩阵完全隔离） */
export function cloneHypothesis(h: Hypothesis): Hypothesis {
  return structuredClone(h);
}

/**
 * 把复核处置应用到副本上：
 * - withdraw：从候选中移除证据（年代删除、分期清空、关系/等同移除）
 * - keep / defer：解释结构不变（defer 仅标记本轮暂不采用）
 * 返回未能落实的条目 id（证据缺失或下标失效）。
 */
export function applyReviewItems(h: Hypothesis, items: ReviewItem[]): string[] {
  const unresolved: string[] = [];
  for (const item of items) {
    if (item.disposition !== 'withdraw') continue;
    switch (item.evidence) {
      case 'above':
        if (!h.above.some((r) => r.id === item.refId)) {
          unresolved.push(item.id);
          break;
        }
        h.above = h.above.filter((r) => r.id !== item.refId);
        break;
      case 'equiv':
        if (!h.equivs.some((e) => e.id === item.refId)) {
          unresolved.push(item.id);
          break;
        }
        h.equivs = h.equivs.filter((e) => e.id !== item.refId);
        break;
      case 'phase': {
        const u = item.unitId ? h.units[item.unitId] : undefined;
        if (u) u.phaseId = null;
        else unresolved.push(item.id);
        break;
      }
      case 'date': {
        if (!item.unitId) {
          unresolved.push(item.id);
          break;
        }
        const dates = h.units[item.unitId]?.dates;
        if (!dates) {
          unresolved.push(item.id);
          break;
        }
        // 有内容快照时必须精确匹配；内容已被直接编辑（stale）则不落实，避免误删同下标另一条证据。
        // 无快照（兼容旧候选）时才退化为下标定位。
        let idx = -1;
        if (item.dateSnapshot) {
          idx = dates.findIndex(
            (d) =>
              d.early === item.dateSnapshot!.early &&
              d.late === item.dateSnapshot!.late &&
              d.label === item.dateSnapshot!.label,
          );
        } else {
          idx = item.dateIndex ?? -1;
        }
        if (idx < 0 || idx >= dates.length) {
          unresolved.push(item.id);
          break;
        }
        dates.splice(idx, 1);
        break;
      }
    }
  }
  return unresolved;
}

/** 构造候选快照（不修改当前假设） */
export function buildCandidate(base: Hypothesis, items: ReviewItem[]): Hypothesis {
  const cand = cloneHypothesis(base);
  applyReviewItems(cand, items);
  return cand;
}

// ---------- 悬空引用 ----------

export function findDangling(base: Hypothesis, items: ReviewItem[]): DanglingRef[] {
  const out: DanglingRef[] = [];
  for (const item of items) {
    const push = (status: DanglingRef['status'], reason: string, units: string[]): void => {
      out.push({
        itemId: item.id,
        evidence: item.evidence,
        refId: item.refId,
        status,
        reason,
        relatedUnitIds: units,
      });
    };
    if (item.evidence === 'above') {
      const rel = base.above.find((r) => r.id === item.refId);
      if (!rel) push('missing', '该早晚关系已在矩阵中被直接删除', []);
      else if (!base.units[rel.younger] || !base.units[rel.older])
        push('missing', '该关系指向的单元已不存在', [rel.younger, rel.older]);
    } else if (item.evidence === 'equiv') {
      const eq = base.equivs.find((e) => e.id === item.refId);
      if (!eq) push('missing', '该等同关系已在矩阵中被直接拆组', []);
      else if (!base.units[eq.a] || !base.units[eq.b])
        push('missing', '该等同指向的单元已不存在', [eq.a, eq.b]);
    } else if (item.evidence === 'phase') {
      const u = item.unitId ? base.units[item.unitId] : undefined;
      if (!u) push('missing', '该单元已被删除', item.unitId ? [item.unitId] : []);
    } else {
      const u = item.unitId ? base.units[item.unitId] : undefined;
      if (!u) {
        push('missing', '该出土物所在单元已被删除', item.unitId ? [item.unitId] : []);
      } else {
        const idx = resolveDateIndex(base, u.id, item.dateIndex ?? -1, item.dateSnapshot);
        if (idx === null) {
          push('missing', '该出土物年代已在矩阵中被直接删除', [u.id]);
        } else if (
          item.dateSnapshot &&
          (u.dates[idx].early !== item.dateSnapshot.early ||
            u.dates[idx].late !== item.dateSnapshot.late ||
            u.dates[idx].label !== item.dateSnapshot.label)
        ) {
          push('stale', '该出土物年代已被直接编辑，撤回将作用于下标处的当前内容', [u.id]);
        }
      }
    }
  }
  return out;
}

/** 候选中没有任何早晚/等同联系的单元（撤回关系后无法定位） */
export function findOrphans(base: Hypothesis, cand: Hypothesis): OrphanUnit[] {
  if (cand.unitIds.length <= 1) return [];
  const incident = new Set<string>();
  for (const r of cand.above) {
    incident.add(r.younger);
    incident.add(r.older);
  }
  for (const e of cand.equivs) {
    incident.add(e.a);
    incident.add(e.b);
  }
  const out: OrphanUnit[] = [];
  for (const id of cand.unitIds) {
    if (!incident.has(id)) {
      const wasLinked =
        base.above.some((r) => r.younger === id || r.older === id) ||
        base.equivs.some((e) => e.a === id || e.b === id);
      out.push({
        unitId: id,
        reason: wasLinked
          ? '撤回后该单元失去全部早晚与等同联系，无法在矩阵中定位（单元本身保留，未被删除）'
          : '该单元在矩阵中没有任何早晚或等同联系，无法定位',
      });
    }
  }
  return out;
}

// ---------- 差异 ----------

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function equivPairs(h: Hypothesis): Map<string, [string, string]> {
  const cls = buildClasses(h);
  const map = new Map<string, [string, string]>();
  for (const members of cls.members.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        map.set(pairKey(members[i], members[j]), [members[i], members[j]]);
      }
    }
  }
  return map;
}

function classDiffs(before: Hypothesis, after: Hypothesis): {
  merged: [string, string][];
  split: [string, string][];
  touched: Set<string>;
} {
  const a = equivPairs(before);
  const b = equivPairs(after);
  const merged: [string, string][] = [];
  const split: [string, string][] = [];
  const touched = new Set<string>();
  for (const [key, pair] of b) {
    if (!a.has(key)) {
      merged.push(pair);
      touched.add(pair[0]);
      touched.add(pair[1]);
    }
  }
  for (const [key, pair] of a) {
    if (!b.has(key)) {
      split.push(pair);
      touched.add(pair[0]);
      touched.add(pair[1]);
    }
  }
  merged.sort();
  split.sort();
  return { merged, split, touched };
}

interface UnitBounds {
  earliest: BoundSource | null;
  latest: BoundSource | null;
  phaseLo: BoundSource | null;
  phaseHi: BoundSource | null;
}

function unitBounds(h: Hypothesis, p: PropagationResult): Map<string, UnitBounds> {
  const map = new Map<string, UnitBounds>();
  for (const id of h.unitIds) {
    const root = p.q.classes.rootOf.get(id);
    map.set(id, root
      ? {
          earliest: p.earliest.get(root) ?? null,
          latest: p.latest.get(root) ?? null,
          phaseLo: p.phaseLo.get(root) ?? null,
          phaseHi: p.phaseHi.get(root) ?? null,
        }
      : { earliest: null, latest: null, phaseLo: null, phaseHi: null });
  }
  return map;
}

function boundDifferences(
  h: Hypothesis,
  before: PropagationResult,
  after: PropagationResult,
): { changes: BoundChange[]; touched: Set<string> } {
  const bm = unitBounds(h, before);
  const am = unitBounds(h, after);
  const changes: BoundChange[] = [];
  const touched = new Set<string>();
  const kinds: BoundChange['kind'][] = ['earliest', 'latest', 'phaseLo', 'phaseHi'];
  for (const id of h.unitIds) {
    const b = bm.get(id)!;
    const a = am.get(id)!;
    for (const k of kinds) {
      const bv = b[k]?.value ?? null;
      const av = a[k]?.value ?? null;
      if (bv !== av || (b[k]?.unitId ?? null) !== (a[k]?.unitId ?? null)) {
        changes.push({ unitId: id, kind: k, before: bv, after: av, beforeSource: b[k], afterSource: a[k] });
        touched.add(id);
      }
    }
  }
  return { changes, touched };
}

function conflictRefs(p: PropagationResult, cycle: ConflictChain | null): ConflictRef[] {
  const refs: ConflictRef[] = [];
  for (const c of p.dateConflicts) {
    refs.push({
      kind: 'date',
      message: c.message,
      signature: `date|${[...c.evidenceIds].sort().join('|')}`,
      edgeIds: c.evidenceIds.filter((id) => id !== c.youngerEvidence.unitId && id !== c.olderEvidence.unitId),
      unitIds: [c.youngerEvidence.unitId, c.olderEvidence.unitId],
      chain: { message: c.message, steps: c.steps, unitIds: [], edgeIds: [] },
    });
  }
  for (const c of p.phaseConflicts) {
    refs.push({
      kind: 'phase',
      message: c.message,
      signature: `phase|${[...c.evidenceIds].sort().join('|')}`,
      edgeIds: c.steps.filter((s) => s.kind === 'above').map((s) => s.refId),
      unitIds: [c.youngerUnit, c.olderUnit],
      chain: { message: c.message, steps: c.steps, unitIds: [], edgeIds: [] },
    });
  }
  if (cycle) {
    refs.push({
      kind: 'cycle',
      message: cycle.message,
      signature: `cycle|${[...cycle.edgeIds].sort().join('|')}`,
      edgeIds: [...cycle.edgeIds],
      unitIds: [...cycle.unitIds],
      chain: cycle,
    });
  }
  return refs;
}

function reductionChanges(
  base: Hypothesis,
  cand: Hypothesis,
): { reducedAdded: string[]; reducedRemoved: string[]; touched: Set<string> } {
  const before = transitiveReduction(base);
  const after = transitiveReduction(cand);
  const added: string[] = [];
  const removed: string[] = [];
  const touched = new Set<string>();
  // 只比较两快照中都存在的关系；被撤回的边不计入约简变化
  const common = new Set(
    cand.above.filter((r) => base.above.some((x) => x.id === r.id)).map((r) => r.id),
  );
  for (const id of after) {
    // 候选中新被隐藏（当前仍直接可见）
    if (common.has(id) && !before.has(id)) {
      added.push(id);
      const r = cand.above.find((x) => x.id === id);
      if (r) {
        touched.add(r.younger);
        touched.add(r.older);
      }
    }
  }
  for (const id of before) {
    // 候选中重新成为直接边（当前被隐藏）
    if (common.has(id) && !after.has(id)) {
      removed.push(id);
      const r = base.above.find((x) => x.id === id);
      if (r) {
        touched.add(r.younger);
        touched.add(r.older);
      }
    }
  }
  return { reducedAdded: added.sort(), reducedRemoved: removed.sort(), touched };
}

/** 当前解释 vs 候选解释的完整差异（纯计算） */
export function reviewDiff(base: Hypothesis, items: ReviewItem[]): ReviewDiff {
  const cand = buildCandidate(base, items);
  const before = propagate(base);
  const after = propagate(cand);
  const cycleAfter = findAnyCycle(cand);

  const { merged, split, touched: classTouched } = classDiffs(base, cand);
  const { changes, touched: boundTouched } = boundDifferences(base, before, after);
  const red = reductionChanges(base, cand);
  const dangling = findDangling(base, items);
  const orphans = findOrphans(base, cand);

  // 被撤回关系/等同的端点也算受影响（即使传播数值未变）
  const edgeTouched = new Set<string>();
  for (const item of items) {
    if (item.disposition !== 'withdraw') continue;
    if (item.evidence === 'above') {
      const r = base.above.find((x) => x.id === item.refId);
      if (r) {
        edgeTouched.add(r.younger);
        edgeTouched.add(r.older);
      }
    } else if (item.evidence === 'equiv') {
      const e = base.equivs.find((x) => x.id === item.refId);
      if (e) {
        edgeTouched.add(e.a);
        edgeTouched.add(e.b);
      }
    } else if (item.unitId) {
      edgeTouched.add(item.unitId);
    }
  }

  const refsBefore = conflictRefs(before, null);
  const refsAfter = conflictRefs(after, cycleAfter);
  const sigBefore = new Map(refsBefore.map((r) => [r.signature, r]));
  const sigAfter = new Map(refsAfter.map((r) => [r.signature, r]));
  const conflictsAdded = refsAfter.filter((r) => !sigBefore.has(r.signature));
  const conflictsRemoved = refsBefore.filter((r) => !sigAfter.has(r.signature));

  const affected = new Set<string>([
    ...classTouched,
    ...boundTouched,
    ...red.touched,
    ...edgeTouched,
    ...orphans.map((o) => o.unitId),
    ...conflictsAdded.flatMap((c) => c.unitIds),
    ...conflictsRemoved.flatMap((c) => c.unitIds),
  ]);

  return {
    affectedUnitIds: [...affected].filter((id) => base.units[id]).sort(),
    merged,
    split,
    boundChanges: changes,
    conflictsBefore: refsBefore,
    conflictsAfter: refsAfter,
    conflictsAdded,
    conflictsRemoved,
    reducedAdded: red.reducedAdded,
    reducedRemoved: red.reducedRemoved,
    dangling,
    orphans,
    cycleAfter,
  };
}

/** 是否存在会改变解释结构的有效撤回（用于决定“采用”是否有意义） */
export function hasEffectiveWithdrawals(base: Hypothesis, items: ReviewItem[]): boolean {
  return items.some(
    (i) =>
      i.disposition === 'withdraw' &&
      ((i.evidence === 'above' && base.above.some((r) => r.id === i.refId)) ||
        (i.evidence === 'equiv' && base.equivs.some((e) => e.id === i.refId)) ||
        (i.evidence === 'phase' && !!i.unitId && base.units[i.unitId]?.phaseId) ||
        (i.evidence === 'date' &&
          !!i.unitId &&
          resolveDateIndex(base, i.unitId, i.dateIndex ?? -1, i.dateSnapshot) !== null)),
  );
}
