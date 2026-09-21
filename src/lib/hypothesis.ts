// 假设比较：单元按稳定 id 对应，比较直接（约简后）关系与等同类划分
import type { Hypothesis } from './types';
import { reducedEdges } from './graph';
import { buildClasses } from './equivalence';

export interface PairDiff {
  younger: string;
  older: string;
}

export interface ReversedDiff {
  a: string;
  b: string;
}

export interface EquivGroupDiff {
  /** B 中新合并为同期的单元对 */
  merged: [string, string][];
  /** A 中同期、B 中拆开的单元对 */
  split: [string, string][];
}

export interface HypothesisDiff {
  commonUnits: string[];
  onlyInA: string[];
  onlyInB: string[];
  added: PairDiff[];
  removed: PairDiff[];
  reversed: ReversedDiff[];
  equiv: EquivGroupDiff;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 等同类划分 -> 所有类内无序单元对 */
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

/**
 * 比较两套解释假设。方向以 a 为基准：
 * added = b 有而 a 没有；removed 反之；reversed = 同一对单元方向相反。
 */
export function diffHypotheses(a: Hypothesis, b: Hypothesis): HypothesisDiff {
  const setA = new Set(a.unitIds);
  const setB = new Set(b.unitIds);
  const commonUnits = a.unitIds.filter((id) => setB.has(id));
  const common = new Set(commonUnits);
  const onlyInA = a.unitIds.filter((id) => !setB.has(id));
  const onlyInB = b.unitIds.filter((id) => !setA.has(id));

  // 约简后的有向单元对（只比较两假设共有的单元）
  const dirA = new Map<string, PairDiff>();
  const dirB = new Map<string, PairDiff>();
  for (const r of reducedEdges(a)) {
    if (common.has(r.younger) && common.has(r.older)) {
      dirA.set(pairKey(r.younger, r.older), { younger: r.younger, older: r.older });
    }
  }
  for (const r of reducedEdges(b)) {
    if (common.has(r.younger) && common.has(r.older)) {
      dirB.set(pairKey(r.younger, r.older), { younger: r.younger, older: r.older });
    }
  }

  const added: PairDiff[] = [];
  const removed: PairDiff[] = [];
  const reversed: ReversedDiff[] = [];
  const handled = new Set<string>();

  for (const [key, pa] of dirA) {
    const pb = dirB.get(key);
    if (pb) {
      // 同一对单元：方向一致即无变化，否则为反转
      if (pb.younger !== pa.younger || pb.older !== pa.older) {
        reversed.push({ a: pa.younger, b: pa.older });
      }
      handled.add(key);
    } else {
      removed.push(pa);
    }
  }
  for (const [key, pb] of dirB) {
    if (handled.has(key)) continue;
    added.push(pb);
  }

  const eqA = equivPairs(a);
  const eqB = equivPairs(b);
  const merged: [string, string][] = [];
  const split: [string, string][] = [];
  for (const [key, pair] of eqB) {
    if (!eqA.has(key) && common.has(pair[0]) && common.has(pair[1])) merged.push(pair);
  }
  for (const [key, pair] of eqA) {
    if (!eqB.has(key) && common.has(pair[0]) && common.has(pair[1])) split.push(pair);
  }

  const cmpPair = (x: PairDiff, y: PairDiff): number =>
    x.younger === y.younger
      ? x.older < y.older
        ? -1
        : 1
      : x.younger < y.younger
        ? -1
        : 1;
  added.sort(cmpPair);
  removed.sort(cmpPair);
  reversed.sort((x, y) => (x.a === y.a ? (x.b < y.b ? -1 : 1) : x.a < y.a ? -1 : 1));
  merged.sort();
  split.sort();

  return { commonUnits, onlyInA, onlyInB, added, removed, reversed, equiv: { merged, split } };
}
