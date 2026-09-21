// 测试用：快速构造一个假设。edges 中 ['a','b'] 表示 a 晚于 b。
import type { Hypothesis, UnitKind } from '../lib/types';

export interface Spec {
  ids: string[];
  edges?: [string, string][];
  equivs?: [string, string][];
  dates?: Record<string, { early: number; late: number; label?: string }[]>;
  phases?: { id: string; name: string; rank: number }[];
  unitPhase?: Record<string, string>;
  kinds?: Record<string, UnitKind>;
}

export function makeHypothesis(spec: Spec): Hypothesis {
  const units: Hypothesis['units'] = {};
  for (const id of spec.ids) {
    units[id] = {
      id,
      code: `[${id}]`,
      note: '',
      kind: spec.kinds?.[id] ?? 'deposit',
      dates: (spec.dates?.[id] ?? []).map((d, i) => ({
        early: d.early,
        late: d.late,
        label: d.label ?? `证据${i}`,
      })),
      phaseId: spec.unitPhase?.[id] ?? null,
    };
  }
  return {
    id: 'h_test',
    name: '测试假设',
    unitIds: [...spec.ids],
    units,
    above: (spec.edges ?? []).map(([younger, older], i) => ({
      id: `rel${i + 1}`,
      younger,
      older,
      note: '',
    })),
    equivs: (spec.equivs ?? []).map(([a, b], i) => ({ id: `eq${i + 1}`, a, b })),
    phases: spec.phases ?? [],
    positions: {},
  };
}
