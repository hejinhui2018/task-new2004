import { describe, expect, it } from 'vitest';
import { diffHypotheses } from '../lib/hypothesis';
import { makeHypothesis } from './makeHypothesis';

describe('假设比较', () => {
  const base = makeHypothesis({
    ids: ['a', 'b', 'c', 'd'],
    edges: [['a', 'b'], ['b', 'c'], ['c', 'd']], // 约简后只剩相邻边
  });

  it('识别新增与删除（按约简后的直接关系）', () => {
    // B：删掉 a→b，新增 b→a 之外再加一条分支边 a→d（d 已在链上，a→d 会被约简）
    const hb = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['b', 'c'], ['c', 'd'], ['a', 'c']], // 新增 a→c（直接），删除 a→b
    });
    const diff = diffHypotheses(base, hb);
    expect(diff.added).toEqual([{ younger: 'a', older: 'c' }]);
    expect(diff.removed).toEqual([{ younger: 'a', older: 'b' }]);
    expect(diff.reversed).toHaveLength(0);
  });

  it('识别关系反转：同一对单元方向相反', () => {
    const hb = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['b', 'a'], ['b', 'c'], ['c', 'd']], // a→b 反转为 b→a
    });
    const diff = diffHypotheses(base, hb);
    expect(diff.reversed).toEqual([{ a: 'a', b: 'b' }]);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('单元按稳定 id 对应：仅一边存在的单元列入 onlyIn', () => {
    const hb = makeHypothesis({
      ids: ['a', 'b', 'c'],
      edges: [['a', 'b'], ['b', 'c']],
    });
    const diff = diffHypotheses(base, hb);
    expect(diff.onlyInA).toEqual(['d']);
    expect(diff.onlyInB).toEqual([]);
    expect(diff.commonUnits).toEqual(['a', 'b', 'c']);
  });

  it('识别等同组的合并与拆开', () => {
    const ha = makeHypothesis({ ids: ['a', 'b', 'c'], equivs: [['a', 'b']] });
    const hb = makeHypothesis({ ids: ['a', 'b', 'c'], equivs: [['b', 'c']] });
    const diff = diffHypotheses(ha, hb);
    expect(diff.equiv.merged).toEqual([['b', 'c']]);
    expect(diff.equiv.split).toEqual([['a', 'b']]);
  });

  it('结构一致时无差异', () => {
    const hb = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['b', 'c'], ['c', 'd']],
    });
    hb.units.a.note = '描述不同不影响结构';
    const diff = diffHypotheses(base, hb);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.reversed).toHaveLength(0);
    expect(diff.equiv.merged).toHaveLength(0);
    expect(diff.equiv.split).toHaveLength(0);
  });
});
