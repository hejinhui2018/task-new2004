// 年代与人工分期沿“晚→早”关系传播，并给出收紧证据与最小冲突证据集
import type { ChainStep, Hypothesis, Unit } from './types';
import { classPath, liftPath, quotient, type Quotient } from './graph';
import { equivPath } from './equivalence';

/** 一条界值的出处 */
export interface BoundSource {
  value: number;
  unitId: string;
  label: string;
}

export interface DateConflict {
  kind: 'date';
  message: string;
  /** 要求“不早于”的证据（位于较早一端） */
  olderEvidence: BoundSource;
  /** 要求“不晚于”的证据（位于较晚一端） */
  youngerEvidence: BoundSource;
  /** 单元级证据链：从较晚证据单元到较早证据单元 */
  steps: ChainStep[];
  /** 最小冲突证据集：两端出土物证据 + 链上关系/等同 id */
  evidenceIds: string[];
}

export interface PhaseConflict {
  kind: 'phase';
  message: string;
  olderUnit: string;
  youngerUnit: string;
  olderRank: number;
  youngerRank: number;
  steps: ChainStep[];
  evidenceIds: string[];
}

export interface PropagationResult {
  q: Quotient;
  /** 每个等同类可行的最早年（含传播来源）；null 表示无下界 */
  earliest: Map<string, BoundSource | null>;
  /** 每个等同类可行的最晚年；null 表示无上界 */
  latest: Map<string, BoundSource | null>;
  /** 分期秩可行下界/上界（来源单元） */
  phaseLo: Map<string, BoundSource | null>;
  phaseHi: Map<string, BoundSource | null>;
  dateConflicts: DateConflict[];
  phaseConflicts: PhaseConflict[];
}

function pickMax(a: BoundSource | null, b: BoundSource | null): BoundSource | null {
  if (!a) return b;
  if (!b) return a;
  if (b.value > a.value) return b;
  if (b.value < a.value) return a;
  // 平局取较小单元 id，结果稳定
  return b.unitId < a.unitId ? b : a;
}

function pickMin(a: BoundSource | null, b: BoundSource | null): BoundSource | null {
  if (!a) return b;
  if (!b) return a;
  if (b.value < a.value) return b;
  if (b.value > a.value) return a;
  return b.unitId < a.unitId ? b : a;
}

/** 类内部出土物给出的最强年代界 */
function localDateBounds(units: Map<string, Unit>, members: string[]): {
  early: BoundSource | null;
  late: BoundSource | null;
} {
  let early: BoundSource | null = null;
  let late: BoundSource | null = null;
  for (const id of members) {
    for (const d of units.get(id)?.dates ?? []) {
      early = pickMax(early, { value: d.early, unitId: id, label: d.label });
      late = pickMin(late, { value: d.late, unitId: id, label: d.label });
    }
  }
  return { early, late };
}

export function propagate(h: Hypothesis): PropagationResult {
  const q = quotient(h);
  const units = new Map(h.unitIds.map((id) => [id, h.units[id]]));

  // DFS 后序（沿晚→早出边），得到 older-first 顺序
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (c: string): void => {
    state.set(c, 1);
    for (const e of q.out.get(c) ?? []) {
      if (state.get(e.oc) !== 2) {
        if (state.get(e.oc) === 0) visit(e.oc);
      }
    }
    state.set(c, 2);
    order.push(c);
  };
  for (const r of q.classes.roots) {
    state.set(r, 0);
  }
  for (const r of q.classes.roots) if (state.get(r) === 0) visit(r);

  const earliest = new Map<string, BoundSource | null>();
  const latest = new Map<string, BoundSource | null>();
  const phaseLo = new Map<string, BoundSource | null>();
  const phaseHi = new Map<string, BoundSource | null>();

  // 等同类内部分期一致性
  const localRank = new Map<string, BoundSource | null>();
  const phaseConflicts: PhaseConflict[] = [];
  for (const root of q.classes.roots) {
    const members = q.classes.members.get(root)!;
    let seen: { rank: number; unitId: string; name: string } | null = null;
    for (const id of members) {
      const ph = units.get(id)!.phaseId;
      if (ph === null) continue;
      const phase = h.phases.find((p) => p.id === ph);
      if (!phase) continue;
      if (seen && seen.rank !== phase.rank) {
        phaseConflicts.push({
          kind: 'phase',
          message: `等同类内分期不一致：${units.get(seen.unitId)!.code} 属于「${seen.name}」，${units.get(id)!.code} 属于「${phase.name}」`,
          olderUnit: id,
          youngerUnit: seen.unitId,
          olderRank: phase.rank,
          youngerRank: seen.rank,
          steps: equivPath(q.classes.adj, id, seen.unitId) ?? [],
          evidenceIds: [id, seen.unitId],
        });
      }
      if (!seen) seen = { rank: phase.rank, unitId: id, name: phase.name };
    }
    localRank.set(
      root,
      seen ? { value: seen.rank, unitId: seen.unitId, label: '人工分期' } : null,
    );
  }

  // older-first：最早年与分期下界向“晚”方向抬升
  for (const c of order) {
    const { early } = localDateBounds(units, q.classes.members.get(c)!);
    let e: BoundSource | null = early;
    let rlo: BoundSource | null = localRank.get(c)!;
    for (const edge of q.out.get(c) ?? []) {
      e = pickMax(e, earliest.get(edge.oc) ?? null);
      rlo = pickMax(rlo, phaseLo.get(edge.oc) ?? null);
    }
    earliest.set(c, e);
    phaseLo.set(c, rlo);
  }

  // younger-first：最晚年与分期上界向“早”方向压低
  for (let i = order.length - 1; i >= 0; i--) {
    const c = order[i];
    const { late } = localDateBounds(units, q.classes.members.get(c)!);
    let l: BoundSource | null = late;
    let rhi: BoundSource | null = localRank.get(c)!;
    for (const root of q.classes.roots) {
      for (const edge of q.out.get(root) ?? []) {
        if (edge.oc === c) {
          l = pickMin(l, latest.get(edge.yc) ?? null);
          rhi = pickMin(rhi, phaseHi.get(edge.yc) ?? null);
        }
      }
    }
    latest.set(c, l);
    phaseHi.set(c, rhi);
  }

  // 年代无解：按“出土物证据对”检测，每个矛盾给出最小证据集（两端年代 + 最短关系链）
  const dateConflicts: DateConflict[] = [];
  const localLates: BoundSource[] = [];
  const localEarlys: BoundSource[] = [];
  for (const root of q.classes.roots) {
    for (const id of q.classes.members.get(root)!) {
      for (const d of units.get(id)?.dates ?? []) {
        localLates.push({ value: d.late, unitId: id, label: d.label });
        localEarlys.push({ value: d.early, unitId: id, label: d.label });
      }
    }
  }
  const seenDateKeys = new Set<string>();
  for (const yb of localLates) {
    const cy = q.classes.rootOf.get(yb.unitId)!;
    for (const eb of localEarlys) {
      if (eb.value <= yb.value) continue;
      const ce = q.classes.rootOf.get(eb.unitId)!;
      let steps: ChainStep[] | null;
      if (cy === ce) {
        steps =
          yb.unitId === eb.unitId
            ? []
            : equivPath(q.classes.adj, yb.unitId, eb.unitId);
      } else {
        const classes = classPath(q, cy, ce);
        steps = classes ? liftPath(q, classes, yb.unitId, eb.unitId) : null;
      }
      if (!steps) continue;
      const evidenceIds = [yb.unitId, eb.unitId, ...steps.map((s) => s.refId)];
      const key = evidenceIds.join('|');
      if (seenDateKeys.has(key)) continue;
      seenDateKeys.add(key);
      dateConflicts.push({
        kind: 'date',
        message: `年代无解：${units.get(eb.unitId)!.code} 的「${eb.label}」要求不早于 ${eb.value} 年，而 ${units.get(yb.unitId)!.code} 的「${yb.label}」要求不晚于 ${yb.value} 年，但关系链要求前者早于后者`,
        olderEvidence: eb,
        youngerEvidence: yb,
        steps,
        evidenceIds,
      });
    }
  }

  // 分期无解：只取各单元实际所属分期（局部秩），按对检测次序相反
  const localRanks: BoundSource[] = [];
  for (const root of q.classes.roots) {
    for (const id of q.classes.members.get(root)!) {
      const ph = units.get(id)!.phaseId;
      const phase = ph ? h.phases.find((p) => p.id === ph) : undefined;
      if (phase) localRanks.push({ value: phase.rank, unitId: id, label: phase.name });
    }
  }
  const seenPhaseKeys = new Set<string>();
  for (const yb of localRanks) {
    const cy = q.classes.rootOf.get(yb.unitId)!;
    for (const ob of localRanks) {
      if (ob.value <= yb.value || ob.unitId === yb.unitId) continue;
      const co = q.classes.rootOf.get(ob.unitId)!;
      let steps: ChainStep[] | null;
      if (cy === co) {
        steps = equivPath(q.classes.adj, yb.unitId, ob.unitId);
      } else {
        const classes = classPath(q, cy, co);
        steps = classes ? liftPath(q, classes, yb.unitId, ob.unitId) : null;
      }
      if (!steps) continue;
      const evidenceIds = [yb.unitId, ob.unitId, ...steps.map((s) => s.refId)];
      const key = evidenceIds.join('|');
      if (seenPhaseKeys.has(key)) continue;
      seenPhaseKeys.add(key);
      const olderPhase = h.phases.find((p) => p.rank === ob.value);
      const youngerPhase = h.phases.find((p) => p.rank === yb.value);
      phaseConflicts.push({
        kind: 'phase',
        message: `分期无解：${units.get(ob.unitId)!.code} 属于「${olderPhase?.name ?? ob.value}」，却早于属于「${youngerPhase?.name ?? yb.value}」的 ${units.get(yb.unitId)!.code}，分期次序相反`,
        olderUnit: ob.unitId,
        youngerUnit: yb.unitId,
        olderRank: ob.value,
        youngerRank: yb.value,
        steps,
        evidenceIds,
      });
    }
  }

  return { q, earliest, latest, phaseLo, phaseHi, dateConflicts, phaseConflicts };
}

/** 年数值格式化（负数为公元前） */
export function formatYear(v: number | null | undefined): string {
  if (v === null || v === undefined) return '不限';
  return v < 0 ? `公元前 ${-v}` : `公元 ${v}`;
}
